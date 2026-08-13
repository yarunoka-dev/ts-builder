import type { YrnkDocument, YrnkInstant, YrnkOccurrence } from '@yarunoka/core';
import { occurrencesIn } from '@yarunoka/core';
import type { DraftId } from './draft.ts';

export type PreviewRequest =
  | {
      /** How many upcoming occurrences to answer */
      readonly next: number;
      /** The instant to count from; the current instant when omitted */
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
    return {
      occurrences: collect(document, scheduleIds, request.range.from, request.range.through),
      exhausted: false,
    };
  }

  if (request.next <= 0) {
    return { occurrences: [], exhausted: false };
  }

  const after = zonedOf(request.after ?? Temporal.Now.instant(), document.timezone);
  const limit = after.add(request.horizon ?? DEFAULT_HORIZON);

  // Widen by doubling: a dense schedule answers within the first
  // windows and never reaches far — which also keeps far-out resolver
  // consultations to the sparse cases that need them.
  let days = 32;

  for (;;) {
    const through = after.add({ days });
    const cut = Temporal.ZonedDateTime.compare(through, limit) >= 0;
    const found = collect(document, scheduleIds, after, cut ? limit : through);

    if (found.length >= request.next) {
      return { occurrences: found.slice(0, request.next), exhausted: false };
    }

    if (cut) {
      return { occurrences: found, exhausted: true };
    }

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

/**
 * One merged enumeration: deduplicated within a kind (an all-day
 * occurrence by its day, a timed one by its instant — the kinds never
 * merge), ascending by instant with an all-day occurrence standing at
 * the start of its day and before a timed point at the same instant.
 */
function collect(
  document: YrnkDocument,
  scheduleIds: readonly DraftId[],
  from: YrnkInstant,
  through: YrnkInstant,
): PreviewOccurrence[] {
  const found = new Map<string, { occurrence: YrnkOccurrence; scheduleIds: DraftId[] }>();

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

  return [...found.values()]
    .map((entry) => ({
      entry,
      instant:
        entry.occurrence instanceof Temporal.PlainDate
          ? entry.occurrence.toZonedDateTime(document.timezone).epochMilliseconds
          : entry.occurrence.epochMilliseconds,
      timed: entry.occurrence instanceof Temporal.PlainDate ? 0 : 1,
    }))
    .sort((a, b) => a.instant - b.instant || a.timed - b.timed)
    .map(({ entry }) => ({ occurrence: entry.occurrence, scheduleIds: entry.scheduleIds }));
}
