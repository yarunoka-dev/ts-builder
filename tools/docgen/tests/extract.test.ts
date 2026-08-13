// What: extraction of the public surface from a fixture project — the
// entry point's re-exports resolved to their declarations, doc comments
// cleaned into paragraphs, @internal and non-public members excluded.
import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { extractPublicSurface } from '../extract.ts';

const entry = path.join(import.meta.dirname, 'fixtures', 'project', 'src', 'index.ts');

const entries = extractPublicSurface(entry);

function entryNamed(name: string) {
  const found = entries.find((candidate) => candidate.name === name);

  assert.ok(found, `expected an entry named ${name}`);

  return found;
}

test('collects every non-internal export of the entry point', () => {
  assert.deepEqual(entries.map((candidate) => candidate.name).toSorted(), [
    'Gadget',
    'SECOND',
    'Tone',
    'VERSION',
    'Voice',
    'WORDS',
    'Widget',
    'WidgetOptions',
    'greet',
    'plain',
    'wide',
    'yell',
  ]);
});

test('an aliased class renders its declaration under the exported name', () => {
  const gadget = entryNamed('Gadget');

  assert.equal(gadget.kind, 'class');
  assert.equal(gadget.declaration, 'class Gadget');
  assert.deepEqual(gadget.members, entryNamed('Widget').members);
});

test('an aliased type alias renders its declaration under the exported name', () => {
  assert.equal(entryNamed('Voice').declaration, "type Voice = 'soft' | 'loud';");
});

test('a re-export of one declarator picks it alone out of the statement', () => {
  assert.equal(entryNamed('SECOND').declaration, "const SECOND = '2'");
});

test('a multiline parameter list collapses into a one-line signature', () => {
  assert.equal(entryNamed('wide').declaration, 'wide(first: string, second: string): string');
});

test('a file header separated by a blank line is not the declaration doc', () => {
  assert.equal(entryNamed('plain').doc, '');
});

test('a function carries its signature and its doc paragraphs', () => {
  const greet = entryNamed('greet');

  assert.equal(greet.kind, 'function');
  assert.equal(greet.declaration, 'greet(name: string, tone?: Tone): string');
  assert.equal(greet.doc, 'Says hello to a name.\n\nWrapped lines join into one paragraph.');
});

test('an aliased export is documented under the exported name', () => {
  const yell = entryNamed('yell');

  assert.equal(yell.kind, 'function');
  assert.equal(yell.declaration, 'yell(name: string): string');
  assert.equal(yell.doc, 'Loud variant.');
});

test('an export whose doc comment says @internal is excluded', () => {
  assert.equal(
    entries.find((candidate) => candidate.name === 'hidden'),
    undefined,
  );
});

test('a type alias carries its full declaration text', () => {
  const tone = entryNamed('Tone');

  assert.equal(tone.kind, 'type');
  assert.equal(tone.declaration, "type Tone = 'soft' | 'loud';");
  assert.equal(tone.doc, 'The tones a greeting takes.');
});

test('an object type alias keeps its member comments in the declaration text', () => {
  const options = entryNamed('WidgetOptions');

  assert.equal(options.kind, 'type');
  assert.ok(options.declaration.includes('/** How wide. */'));
  assert.ok(options.declaration.includes('readonly width: number;'));
});

test('a constant carries its declaration without the trailing semicolon', () => {
  const version = entryNamed('VERSION');

  assert.equal(version.kind, 'constant');
  assert.equal(version.declaration, "const VERSION = '1.0'");
  assert.equal(version.doc, 'The version constant.');
});

test('a multi-line constant keeps its spelling whole', () => {
  const words = entryNamed('WORDS');

  assert.equal(words.kind, 'constant');
  assert.equal(
    words.declaration,
    "const WORDS: readonly string[] = [\n  // The first group\n  'alpha',\n  'beta',\n]",
  );
  assert.equal(words.doc, 'The word list constant.');
});

test('a class lists its public non-internal members in source order', () => {
  const widget = entryNamed('Widget');

  assert.equal(widget.kind, 'class');
  assert.equal(widget.declaration, 'class Widget');
  assert.deepEqual(
    widget.members?.map((member) => member.signature),
    [
      'readonly width: number',
      'constructor(options: WidgetOptions)',
      'render(depth: number): string',
    ],
  );
});

test("a member's doc rides along whole; the renderer trims it to a summary", () => {
  const widget = entryNamed('Widget');
  const render = widget.members?.find((member) => member.signature.startsWith('render'));

  assert.equal(render?.doc, 'Renders itself.\n\nA second paragraph a member summary leaves out.');
});

test('extraction is deterministic', () => {
  assert.deepEqual(extractPublicSurface(entry), entries);
});
