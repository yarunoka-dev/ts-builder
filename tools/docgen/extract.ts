import path from 'node:path';
import type {
  ClassDeclaration,
  ConstructorDeclaration,
  FunctionDeclaration,
  InterfaceDeclaration,
  MethodDeclaration,
  Node,
  PropertyDeclaration,
  SourceFile,
  TypeAliasDeclaration,
  VariableStatement,
} from 'typescript/unstable/ast';
import {
  getLeadingCommentRanges,
  getTokenPosOfNode,
  isClassDeclaration,
  isConstructorDeclaration,
  isExportDeclaration,
  isFunctionDeclaration,
  isIdentifier,
  isImportDeclaration,
  isInterfaceDeclaration,
  isMethodDeclaration,
  isNamedExports,
  isPrivateIdentifier,
  isPropertyDeclaration,
  isStringLiteral,
  isTypeAliasDeclaration,
  isVariableStatement,
  NodeFlags,
  SyntaxKind,
} from 'typescript/unstable/ast';
import { API } from 'typescript/unstable/sync';

export type MemberDoc = {
  readonly signature: string;
  readonly doc: string;
};

export type EntryDoc = {
  readonly name: string;
  readonly kind: 'function' | 'class' | 'constant' | 'type';
  readonly declaration: string;
  readonly doc: string;
  readonly members?: readonly MemberDoc[];
};

type TopLevelDeclaration =
  | FunctionDeclaration
  | ClassDeclaration
  | TypeAliasDeclaration
  | InterfaceDeclaration
  | VariableStatement;

/**
 * The public surface of the package rooted at the given entry point: the
 * declarations its export statements name, resolved in their home
 * modules. The entry point is the definition of "public" — TypeScript's
 * module system already draws that line — and @internal narrows it
 * further, mirroring the generic rule the PHP docgen uses.
 */
export function extractPublicSurface(entry: string): EntryDoc[] {
  const entryPath = path.resolve(entry);
  const api = new API();

  try {
    const snapshot = api.updateSnapshot({ openFiles: [entryPath] });
    const project = snapshot.getDefaultProjectForFile(entryPath);

    if (project === undefined) {
      throw new Error(`no tsconfig covers ${entryPath}`);
    }

    const sourceFileFor = (file: string): SourceFile => {
      const sourceFile = project.program.getSourceFile(file);

      if (sourceFile === undefined) {
        throw new Error(`not part of the project: ${file}`);
      }

      return sourceFile;
    };

    const entries: EntryDoc[] = [];

    for (const exported of exportsOf(sourceFileFor(entryPath), sourceFileFor)) {
      const doc = docCommentOf(exported.declaration, exported.sourceFile);

      if (doc !== null && isInternal(doc)) {
        continue;
      }

      entries.push(
        entryDoc(exported.name, exported.localName, exported.declaration, exported.sourceFile, doc),
      );
    }

    return entries;
  } finally {
    api.close();
  }
}

type Exported = {
  readonly name: string;
  readonly localName: string;
  readonly declaration: TopLevelDeclaration;
  readonly sourceFile: SourceFile;
};

/**
 * Walks the entry point's statements and yields [exported name,
 * declaration] pairs. Only the forms the sources use are supported;
 * anything else fails loudly rather than silently dropping part of the
 * public surface.
 */
function* exportsOf(
  entrySourceFile: SourceFile,
  sourceFileFor: (file: string) => SourceFile,
): Generator<Exported> {
  for (const statement of entrySourceFile.statements) {
    if (isImportDeclaration(statement)) {
      continue;
    }

    if (!isExportDeclaration(statement)) {
      throw new Error('the entry point must contain re-exports only');
    }

    const clause = statement.exportClause;

    if (clause === undefined || !isNamedExports(clause)) {
      throw new Error('star and namespace re-exports are not supported');
    }

    const specifier = statement.moduleSpecifier;

    if (specifier !== undefined && !isStringLiteral(specifier)) {
      throw new Error('a module specifier must be a string literal');
    }

    const sourceFile =
      specifier === undefined
        ? entrySourceFile
        : sourceFileFor(path.resolve(path.dirname(entrySourceFile.fileName), specifier.text));

    for (const element of clause.elements) {
      const exportedName = element.name.text;
      const localName = element.propertyName?.text ?? exportedName;

      yield {
        name: exportedName,
        localName,
        declaration: declarationNamed(localName, sourceFile),
        sourceFile,
      };
    }
  }
}

function declarationNamed(name: string, sourceFile: SourceFile): TopLevelDeclaration {
  for (const statement of sourceFile.statements) {
    if (
      isFunctionDeclaration(statement) ||
      isClassDeclaration(statement) ||
      isTypeAliasDeclaration(statement) ||
      isInterfaceDeclaration(statement)
    ) {
      if (statement.name?.text === name) {
        return statement;
      }

      continue;
    }

    if (isVariableStatement(statement)) {
      for (const declarator of statement.declarationList.declarations) {
        if (isIdentifier(declarator.name) && declarator.name.text === name) {
          return statement;
        }
      }
    }
  }

  throw new Error(`no declaration named ${name} in ${sourceFile.fileName}`);
}

function entryDoc(
  name: string,
  localName: string,
  declaration: TopLevelDeclaration,
  sourceFile: SourceFile,
  doc: string | null,
): EntryDoc {
  const text = sourceFile.text;
  const start = getTokenPosOfNode(declaration, sourceFile);
  const cleanedDoc = doc === null ? '' : cleanDoc(doc);

  // An aliased re-export documents the declaration under the exported
  // name, so the declared identifier is replaced by position wherever
  // the declaration text carries it.
  const renamed = (sliceStart: number, sliceEnd: number, nameNode: Node): string =>
    text.slice(sliceStart, getTokenPosOfNode(nameNode, sourceFile)) +
    name +
    text.slice(nameNode.end, sliceEnd);

  if (isFunctionDeclaration(declaration)) {
    if (declaration.name === undefined) {
      throw new Error(`an exported function must be named: ${name}`);
    }

    const header = text.slice(declaration.name.end, declaration.body?.pos ?? declaration.end);

    return {
      name,
      kind: 'function',
      declaration: name + collapse(header),
      doc: cleanedDoc,
    };
  }

  if (isClassDeclaration(declaration)) {
    const nameNode = declaration.name;

    if (nameNode === undefined) {
      throw new Error(`an exported class must be named: ${name}`);
    }

    const headerEnd = declaration.heritageClauses?.at(-1)?.end ?? nameNode.end;

    return {
      name,
      kind: 'class',
      declaration: withoutExport(collapse(renamed(start, headerEnd, nameNode))),
      doc: cleanedDoc,
      members: [...membersOf(declaration, sourceFile)],
    };
  }

  if (isVariableStatement(declaration)) {
    const declarator = declaration.declarationList.declarations.find(
      (candidate) => isIdentifier(candidate.name) && candidate.name.text === localName,
    );

    if (declarator === undefined) {
      throw new Error(`no declarator named ${localName} in the statement`);
    }

    const flags = declaration.declarationList.flags;
    const keyword = flags & NodeFlags.Const ? 'const' : flags & NodeFlags.Let ? 'let' : 'var';
    const raw = text.slice(declarator.name.end, declarator.end);

    // A declaration spanning lines keeps its spelling whole — folding a
    // long initializer into one line would bury the very content the
    // constant is exported to show — and the renderer fences it.
    if (raw.includes('\n')) {
      return {
        name,
        kind: 'constant',
        declaration: `${keyword} ${name}${withoutSemicolon(raw)}`,
        doc: cleanedDoc,
      };
    }

    const rest = collapse(raw);

    return {
      name,
      kind: 'constant',
      declaration: `${keyword} ${name}${rest === '' ? '' : ` ${rest}`}`,
      doc: cleanedDoc,
    };
  }

  return {
    name,
    kind: 'type',
    declaration: withoutExport(renamed(start, declaration.end, declaration.name)),
    doc: cleanedDoc,
  };
}

/** The class members the page lists: public, named plainly, not @internal. */
function* membersOf(declaration: ClassDeclaration, sourceFile: SourceFile): Generator<MemberDoc> {
  const text = sourceFile.text;

  for (const member of declaration.members) {
    if (
      !isPropertyDeclaration(member) &&
      !isMethodDeclaration(member) &&
      !isConstructorDeclaration(member)
    ) {
      throw new Error(`unsupported class member kind (${member.kind})`);
    }

    if (isNonPublic(member)) {
      continue;
    }

    const doc = docCommentOf(member, sourceFile);

    if (doc !== null && isInternal(doc)) {
      continue;
    }

    const end = isPropertyDeclaration(member) ? member.end : (member.body?.pos ?? member.end);

    yield {
      signature: collapse(text.slice(getTokenPosOfNode(member, sourceFile), end)),
      doc: doc === null ? '' : cleanDoc(doc),
    };
  }
}

function isNonPublic(
  member: PropertyDeclaration | MethodDeclaration | ConstructorDeclaration,
): boolean {
  const modified =
    member.modifiers?.some(
      (modifier) =>
        modifier.kind === SyntaxKind.PrivateKeyword ||
        modifier.kind === SyntaxKind.ProtectedKeyword,
    ) ?? false;

  return modified || (!isConstructorDeclaration(member) && isPrivateIdentifier(member.name));
}

/**
 * The last /** comment before the node, raw — and only when attached: a
 * blank line between the comment and the declaration reads it as a file
 * or section header, not as this declaration's doc.
 */
function docCommentOf(node: Node, sourceFile: SourceFile): string | null {
  const text = sourceFile.text;
  const tokenStart = getTokenPosOfNode(node, sourceFile);
  const last = (getLeadingCommentRanges(text, node.pos) ?? []).at(-1);

  if (last === undefined || /\n\s*\n/.test(text.slice(last.end, tokenStart))) {
    return null;
  }

  const comment = text.slice(last.pos, last.end);

  return comment.startsWith('/**') ? comment : null;
}

function isInternal(rawDoc: string): boolean {
  return /(^|\s)@internal\b/.test(rawDoc);
}

/**
 * The comment body as markdown paragraphs: hard-wrapped lines join into
 * one line per paragraph, blank lines separate paragraphs.
 */
function cleanDoc(rawDoc: string): string {
  const lines = rawDoc
    .replace(/^\/\*\*/, '')
    .replace(/\*\/$/, '')
    .split('\n')
    .map((line) => line.replace(/^\s*\* ?/, '').trim());

  const paragraphs: string[][] = [[]];

  for (const line of lines) {
    if (line === '') {
      paragraphs.push([]);
    } else {
      paragraphs.at(-1)?.push(line);
    }
  }

  return paragraphs
    .filter((paragraph) => paragraph.length > 0)
    .map((paragraph) => paragraph.join(' '))
    .join('\n\n');
}

function collapse(fragment: string): string {
  // A parameter list wrapped across lines leaves "( " and a trailing
  // comma behind once whitespace folds; both are spelling, not content
  return withoutSemicolon(
    fragment
      .replace(/\s+/g, ' ')
      .replace(/\( /g, '(')
      .replace(/,\s*\)/g, ')')
      .trim(),
  );
}

function withoutSemicolon(fragment: string): string {
  return fragment.replace(/;$/, '');
}

function withoutExport(fragment: string): string {
  return fragment.replace(/^export /, '');
}
