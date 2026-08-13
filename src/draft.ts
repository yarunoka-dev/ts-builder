import type {
  YrnkCalendarWord,
  YrnkDayName,
  YrnkDirection,
  YrnkOrdinal,
  YrnkTimeUnit,
} from '@yarunoka/core';

/**
 * The draft model — the document model of @yarunoka/core mirrored with
 * every node loosened to tolerate work in progress. Three loosenings and
 * nothing else:
 *
 * - A freely-typed leaf (a time, a date, a boundary, an integer, a name,
 *   the timezone, an annotation) holds whatever string was typed.
 *   Validation is derived at read time; the draft never stores its own
 *   error state.
 * - A closed-set leaf holds its value or null (not chosen yet), and a
 *   structural choice (the time form, the day atom form) holds
 *   kind: null the same way.
 * - "Absent" splits by whether the document could spell it: where an
 *   empty spelling is invalid (annotations, boundaries, the axes, the
 *   resolvers list, workweek, business hours), the empty string / empty
 *   list reads as "key omitted"; where an explicit empty list is a
 *   meaningful statement (a date list), an explicit mode tells the
 *   forms apart.
 */

/** Opaque, draft-only; the UI's list key and the ops' address. toYrnk drops it. */
export type DraftId = string;

/** A list element wrapped for identity: the id names the slot, not the value. */
export type DraftEntry<T> = { readonly id: DraftId; readonly value: T };

export type DraftDocument = {
  /** '' reads as "key omitted" */
  readonly label: string;
  readonly description: string;
  /** Always written out: a document cannot omit its timezone */
  readonly timezone: string;
  /** [] reads as "key omitted" */
  readonly resolvers: readonly DraftEntry<string>[];
  readonly calendar: DraftCalendar;
  /** [] is spellable but invalid; parse rejects it at the exit */
  readonly schedules: readonly DraftSchedule[];
};
// version is not part of the draft: the supported version is core's
// SUPPORTED_VERSION constant, not something an editor edits. toYrnk
// writes it out as that constant.

/**
 * A built-in date-list position (holidays / business_holidays /
 * business_days). An explicit empty list is a meaningful statement
 * ("there are no such days"), so absence needs its own mode rather than
 * the empty-equals-omitted reading.
 */
export type DraftDateSetPosition =
  | { readonly mode: 'unset' }
  | { readonly mode: 'list'; readonly dates: readonly DraftEntry<string>[] }
  | { readonly mode: 'name'; readonly name: string };

export type DraftCalendar = {
  readonly holidays: DraftDateSetPosition;
  readonly businessHolidays: DraftDateSetPosition;
  readonly businessDays: DraftDateSetPosition;
  /** [] reads as "key omitted" (the default Mon–Fri workweek) */
  readonly workweek: readonly YrnkDayName[];
  /** [] reads as "key omitted" */
  readonly businessHours: readonly DraftEntry<{ readonly start: string; readonly end: string }>[];
  readonly dateSets: readonly DraftDateSetEntry[];
};

/**
 * An entry of date_sets. The model holds a Record, but a draft holds a
 * list of named entries: renaming is then an in-place text edit, and a
 * duplicated name is representable mid-edit (parse rejects it at the
 * exit).
 */
export type DraftDateSetEntry = {
  readonly id: DraftId;
  readonly name: string;
  readonly dates: readonly DraftEntry<string>[];
};

export type DraftSchedule = {
  readonly id: DraftId;
  readonly label: string;
  readonly description: string;
  /** '' reads as "key omitted" */
  readonly from: string;
  readonly until: string;
  /** [] reads as "axis absent" (no restriction) */
  readonly years: readonly DraftEntry<string>[];
  readonly months: readonly DraftEntry<string>[];
  readonly days: readonly DraftDayAtomEntry[];
  readonly shift: DraftShift | null;
  readonly if: DraftIf | null;
  readonly time: DraftTimeSpec;
};

export type DraftDayAtomEntry = { readonly id: DraftId; readonly atom: DraftDayAtom };

export type DraftDayAtom =
  | { readonly kind: null }
  | { readonly kind: 'month-day'; readonly day: string }
  | { readonly kind: 'weekday'; readonly day: YrnkDayName | null }
  | {
      readonly kind: 'ordinal-weekday';
      readonly ordinal: YrnkOrdinal | null;
      readonly day: YrnkDayName | null;
    }
  | { readonly kind: 'last-day-of-month' }
  | { readonly kind: 'calendar-word'; readonly word: YrnkCalendarWord | null }
  | { readonly kind: 'name'; readonly name: string }
  | { readonly kind: 'day-cycle'; readonly interval: string };

/** A day atom legal as a shift / if condition — every form except the day cycle. */
export type DraftDayCondition = Exclude<DraftDayAtom, { kind: 'day-cycle' }>;

export type DraftShift = {
  readonly direction: YrnkDirection | null;
  readonly orSame: boolean;
  readonly condition: DraftDayCondition;
};

export type DraftIf = {
  /**
   * null means "the day itself", exactly as in the model — the default
   * is itself a valid choice, so "not chosen yet" needs no extra state
   */
  readonly direction: YrnkDirection | null;
  readonly negated: boolean;
  readonly condition: DraftDayCondition;
};

export type DraftEveryTuple = {
  readonly count: string;
  readonly unit: YrnkTimeUnit | null;
};

export type DraftBetween =
  | { readonly kind: 'whole-day' }
  | { readonly kind: 'window'; readonly start: string; readonly end: string }
  | { readonly kind: 'business-hour' };

export type DraftTimeSpec =
  | { readonly kind: null }
  | { readonly kind: 'times'; readonly times: readonly DraftEntry<string>[] }
  | { readonly kind: 'grid'; readonly every: DraftEveryTuple; readonly between: DraftBetween }
  | { readonly kind: 'allday' }
  | { readonly kind: 'sequence'; readonly every: DraftEveryTuple };

/**
 * Where a problem sits in the draft: field names and draft ids,
 * outermost first (e.g. ['schedules', 's3', 'from']). Ids rather than
 * indexes, so the path survives list edits around it.
 */
export type DraftPath = readonly string[];

/**
 * One validation finding. A field problem is a core validation helper's
 * answer placed at its draft path; a document problem is core's parse()
 * rejecting the whole (it carries no path — it appears only once every
 * field is individually clean).
 */
export type DraftProblem = {
  readonly path: DraftPath;
  /** Wording comes from @yarunoka/core wherever core has the rule */
  readonly message: string;
  readonly origin: 'field' | 'document';
};
