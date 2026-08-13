import type { YrnkDocument, YrnkResolver } from '@yarunoka/core';
import { applyOp } from './apply.ts';
import type { DraftDocument, DraftProblem } from './draft.ts';
import { emptyDraftDocument, expandDocument } from './from-yrnk.ts';
import { createIdAllocator, createIdAllocatorAfter, type IdAllocator } from './ids.ts';
import type { BuilderOp } from './ops.ts';
import { type OptionContext, type Options, optionsAt } from './options.ts';
import { type PreviewOccurrence, type PreviewRequest, preview } from './preview.ts';
import { type ToYrnkResult, toYrnk } from './to-yrnk.ts';

export type YrnkBuilderOptions = {
  /** The document to start editing; an empty new draft when omitted */
  readonly initial?: YrnkDocument;
  /** What the host binds the draft's declared resolver names to */
  readonly resolvers?: Readonly<Record<string, YrnkResolver>>;
};

export type PreviewResult =
  | {
      readonly ok: true;
      readonly occurrences: readonly PreviewOccurrence[];
      /** True when the horizon ended a "next N" search short of N */
      readonly exhausted: boolean;
    }
  | { readonly ok: false; readonly problems: readonly DraftProblem[] };

export type YrnkBuilder = {
  /** The current draft — an immutable snapshot */
  getState(): DraftDocument;
  /** Change notification; the returned function unsubscribes */
  subscribe(listener: () => void): () => void;
  dispatch(op: BuilderOp): void;
  setResolvers(resolvers: Readonly<Record<string, YrnkResolver>>): void;

  errors(): readonly DraftProblem[];
  optionsAt(context: OptionContext): Options;
  toYrnk(): ToYrnkResult;
  preview(request: PreviewRequest): PreviewResult;
};

/**
 * The store — the one stateful object of this package. One draft, one
 * "something changed" signal: finer subscription granularity is a
 * binding's concern, and this minimal contract is exactly what React's
 * useSyncExternalStore consumes in one line.
 *
 * The derived values are pure over (snapshot, resolvers), so the
 * expensive one — the exit through core's parse — is memoized per that
 * pair. Swapping resolvers replaces the snapshot identity even though
 * no field changed: the derived values change, and identity is the
 * signal subscribers watch.
 */
const NO_PROBLEMS: readonly DraftProblem[] = [];

export function createYrnkBuilder(options?: YrnkBuilderOptions): YrnkBuilder {
  let alloc: IdAllocator = createIdAllocator();
  let draft: DraftDocument =
    options?.initial !== undefined ? expandDocument(options.initial, alloc) : emptyDraftDocument();
  let resolvers: Readonly<Record<string, YrnkResolver>> = options?.resolvers ?? {};
  const listeners = new Set<() => void>();

  let exitMemo: {
    draft: DraftDocument;
    resolvers: Readonly<Record<string, YrnkResolver>>;
    result: ToYrnkResult;
  } | null = null;

  function exitOf(): ToYrnkResult {
    if (exitMemo === null || exitMemo.draft !== draft || exitMemo.resolvers !== resolvers) {
      exitMemo = { draft, resolvers, result: toYrnk(draft, resolvers) };
    }

    return exitMemo.result;
  }

  function notify(): void {
    for (const listener of [...listeners]) {
      listener();
    }
  }

  return {
    getState: () => draft,

    subscribe(listener) {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },

    dispatch(op) {
      draft = applyOp(draft, op, alloc);

      // A replaced draft can carry ids from another allocator's
      // counting; restart past them so future ids stay unique.
      if (op.type === 'document/replace') {
        alloc = createIdAllocatorAfter(draft);
      }

      notify();
    },

    setResolvers(next) {
      resolvers = next;
      draft = { ...draft };

      notify();
    },

    errors() {
      const result = exitOf();

      return result.ok ? NO_PROBLEMS : result.problems;
    },

    optionsAt(context) {
      return optionsAt(draft, context);
    },

    toYrnk() {
      return exitOf();
    },

    preview(request) {
      const result = exitOf();

      if (!result.ok) {
        return { ok: false, problems: result.problems };
      }

      return {
        ok: true,
        ...preview(
          result.document,
          draft.schedules.map((schedule) => schedule.id),
          request,
        ),
      };
    },
  };
}
