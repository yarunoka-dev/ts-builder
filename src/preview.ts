import type { YrnkDocument, YrnkInstant, YrnkOccurrence } from '@yarunoka/core';
import { occurrencesIn } from '@yarunoka/core';
import type { DraftId } from './draft.ts';

export type PreviewRequest =
  | {
      /** How many upcoming occurrences to answer */
      readonly next: number;
      /**
       * The instant the answered occurrences lie strictly after; the
       * current instant when omitted
       */
      readonly after?: YrnkInstant;
      /** How far the search may reach; ten years when omitted */
      readonly horizon?: Temporal.Duration;
    }
  | { readonly range: { readonly from: YrnkInstant; readonly through: YrnkInstant } };

export type PreviewOccurrence = {
  readonly occurrence: YrnkOccurrence;
  /** The draft schedules this occurrence came from */
  readonly scheduleIds: readonly DraftId[];
};

/**
 * The default cut-off of the "next N" search. Two considerations bound
 * it: resolvers are consulted per walked year (a large horizon is a
 * license for that many callbacks, each answering past the host's
 * prepared data), and the widening search only reaches the horizon
 * when occurrences are running out. Ten years fills "the next ten" of
 * a yearly schedule; rarer patterns are for the caller to ask about
 * with an explicit horizon.
 */
const DEFAULT_HORIZON = { years: 10 };

/**
 * The preview computation over an exported document: core's
 * occurrencesIn asked per schedule, the answers merged into one
 * ascending union — the same composition the top-level enumeration
 * query has — with each occurrence remembering which draft schedules
 * produced it. scheduleIds addresses the document's schedules in
 * order: the export preserves the draft's order, which is what lets a
 * preview line point back at a draft schedule.
 *
 * The "next N" form is not a core query, so it is searched: a window
 * after `after`, doubling until it holds N occurrences or reaches the
 * horizon. `exhausted` says the horizon was reached first — an honest
 * "fewer than asked", never a silent one.
 */
export function preview(
  document: YrnkDocument,
  scheduleIds: readonly DraftId[],
  request: PreviewRequest,
): { readonly occurrences: readonly PreviewOccurrence[]; readonly exhausted: boolean } {
  if ('range' in request) {
    const found: Found = new Map();

    collectInto(found, document, scheduleIds, request.range.from, request.range.through);

    return { occurrences: ordered(found, document.timezone), exhausted: false };
  }

  if (request.next <= 0) {
    return { occurrences: [], exhausted: false };
  }

  // Scheduled points are whole seconds, so "strictly after" is the
  // range starting at floor(after) + 1 — the same reading core's
  // period judgment gives its after. An all-day occurrence still
  // answers while its day overlaps the searched range: a day is due
  // for as long as it lasts.
  const start = zonedOf(request.after ?? Temporal.Now.instant(), document.timezone)
    .round({ smallestUnit: 'second', roundingMode: 'floor' })
    .add({ seconds: 1 });
  const limit = start.add(request.horizon ?? DEFAULT_HORIZON);

  // Widen by doubling, enumerating only the slice each pass adds: a
  // dense schedule answers within the first windows and never reaches
  // far, and the years already walked are not re-walked (nor their
  // resolvers re-consulted) when the search does widen. Points are
  // whole seconds, so consecutive slices meet at a one-second step; an
  // all-day occurrence overlapping the seam lands in both slices and
  // the accumulator's keying folds it back into one.
  const found: Found = new Map();
  let sliceFrom = start;
  let days = 32;

  for (;;) {
    const through = start.add({ days });
    const cut = Temporal.ZonedDateTime.compare(through, limit) >= 0;
    const sliceThrough = cut ? limit : through;

    collectInto(found, document, scheduleIds, sliceFrom, sliceThrough);

    const occurrences = ordered(found, document.timezone);

    if (occurrences.length >= request.next) {
      return { occurrences: occurrences.slice(0, request.next), exhausted: false };
    }

    if (cut) {
      return { occurrences, exhausted: true };
    }

    sliceFrom = sliceThrough.add({ seconds: 1 });
    days *= 2;
  }
}

function zonedOf(instant: YrnkInstant, timezone: string): Temporal.ZonedDateTime {
  if (instant instanceof Temporal.ZonedDateTime) {
    return instant.withTimeZone(timezone);
  }

  if (instant instanceof Temporal.Instant) {
    return instant.toZonedDateTimeISO(timezone);
  }

  if (instant instanceof Date) {
    return Temporal.Instant.fromEpochMilliseconds(instant.getTime()).toZonedDateTimeISO(timezone);
  }

  return Temporal.Instant.from(instant).toZonedDateTimeISO(timezone);
}

/** The accumulator of a merged enumeration, keyed within a kind. */
type Found = Map<string, { occurrence: YrnkOccurrence; scheduleIds: DraftId[] }>;

/**
 * One slice of the merged enumeration, folded into the accumulator:
 * deduplicated within a kind (an all-day occurrence by its day, a
 * timed one by its instant — the kinds never merge), with a later
 * slice still able to add a schedule id to an occurrence found
 * earlier.
 */
function collectInto(
  found: Found,
  document: YrnkDocument,
  scheduleIds: readonly DraftId[],
  from: YrnkInstant,
  through: YrnkInstant,
): void {
  document.schedules.forEach((schedule, index) => {
    const scheduleId = scheduleIds[index];

    if (scheduleId === undefined) {
      throw new Error(`No draft id for schedule ${index}`);
    }

    for (const occurrence of occurrencesIn(document, schedule, from, through)) {
      const key =
        occurrence instanceof Temporal.PlainDate
          ? `d:${occurrence.toString()}`
          : `t:${occurrence.epochMilliseconds}`;
      const entry = found.get(key);

      if (entry === undefined) {
        found.set(key, { occurrence, scheduleIds: [scheduleId] });
      } else if (!entry.scheduleIds.includes(scheduleId)) {
        entry.scheduleIds.push(scheduleId);
      }
    }
  });
}

/**
 * The accumulator read out in the enumeration's order: ascending by
 * instant, with an all-day occurrence standing at the start of its day
 * and before a timed point at the same instant.
 */
function ordered(found: Found, timezone: string): PreviewOccurrence[] {
  return [...found.values()]
    .map((entry) => ({
      entry,
      instant:
        entry.occurrence instanceof Temporal.PlainDate
          ? entry.occurrence.toZonedDateTime(timezone).epochMilliseconds
          : entry.occurrence.epochMilliseconds,
      timed: entry.occurrence instanceof Temporal.PlainDate ? 0 : 1,
    }))
    .sort((a, b) => a.instant - b.instant || a.timed - b.timed)
    .map(({ entry }) => ({ occurrence: entry.occurrence, scheduleIds: entry.scheduleIds }));
}
