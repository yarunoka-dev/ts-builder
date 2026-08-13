import type { YrnkDocument, YrnkResolver } from '@yarunoka/core';
import { parse, SUPPORTED_VERSION, YrnkError } from '@yarunoka/core';
import type {
  DraftBetween,
  DraftDateSetPosition,
  DraftDayAtom,
  DraftDocument,
  DraftEveryTuple,
  DraftIf,
  DraftProblem,
  DraftSchedule,
  DraftShift,
  DraftTimeSpec,
} from './draft.ts';
import { leafProblems } from './errors.ts';

/**
 * The exit's answer: the parsed document with its raw spelling when
 * the draft exports cleanly, or the problems that keep it from the
 * wire.
 */
export type ToYrnkResult =
  | { readonly ok: true; readonly document: YrnkDocument; readonly raw: Record<string, unknown> }
  | { readonly ok: false; readonly problems: readonly DraftProblem[] };

/**
 * The draft's exit. Three steps: the field walk (a draft with a broken
 * leaf never reaches the wire), the write-back (ids dropped, empty
 * spellings mapped to omitted keys, integer strings read as numbers),
 * and core's parse — the final gate, whose YrnkError comes back as the
 * one pathless document problem. A document this returns went through
 * parse, so it carries core's brand and bindings like any other.
 */
export function toYrnk(
  draft: DraftDocument,
  resolvers: Readonly<Record<string, YrnkResolver>>,
): ToYrnkResult {
  const problems = leafProblems(draft);

  if (problems.length > 0) {
    return { ok: false, problems };
  }

  const raw = rawOf(draft);

  try {
    return { ok: true, document: parse(raw, { resolvers }), raw };
  } catch (error) {
    if (error instanceof YrnkError) {
      return { ok: false, problems: [{ path: [], message: error.message, origin: 'document' }] };
    }

    throw error;
  }
}

/**
 * The errors() view of the same pipeline: field problems while any
 * exist, the document gate's answer once the fields are clean, nothing
 * when the draft would export.
 */
export function draftProblems(
  draft: DraftDocument,
  resolvers: Readonly<Record<string, YrnkResolver>>,
): readonly DraftProblem[] {
  const result = toYrnk(draft, resolvers);

  return result.ok ? [] : result.problems;
}

/**
 * The write-back — the inverse of the expansion, shaped after core's
 * build(): the same key order and the same omission rules, so that an
 * unedited draft's output is structurally the document build() would
 * write.
 */
function rawOf(draft: DraftDocument): Record<string, unknown> {
  const raw: Record<string, unknown> = {};

  if (draft.label !== '') {
    raw.label = draft.label;
  }

  if (draft.description !== '') {
    raw.description = draft.description;
  }

  raw.version = SUPPORTED_VERSION;
  raw.timezone = draft.timezone;

  if (draft.resolvers.length > 0) {
    raw.resolvers = draft.resolvers.map((entry) => entry.value);
  }

  const calendar = rawCalendar(draft);

  if (Object.keys(calendar).length > 0) {
    raw.calendar = calendar;
  }

  raw.schedules = draft.schedules.map(rawSchedule);

  return raw;
}

function rawCalendar(draft: DraftDocument): Record<string, unknown> {
  const { calendar } = draft;
  const raw: Record<string, unknown> = {};

  for (const [key, position] of [
    ['holidays', calendar.holidays],
    ['business_holidays', calendar.businessHolidays],
    ['business_days', calendar.businessDays],
  ] as const) {
    const written = rawPosition(position);

    if (written !== undefined) {
      raw[key] = written;
    }
  }

  if (calendar.workweek.length > 0) {
    raw.workweek = [...calendar.workweek];
  }

  if (calendar.businessHours.length > 0) {
    raw.business_hours = calendar.businessHours.map((entry) => [
      entry.value.start,
      entry.value.end,
    ]);
  }

  if (calendar.dateSets.length > 0) {
    raw.date_sets = Object.fromEntries(
      calendar.dateSets.map((set) => [set.name, set.dates.map((date) => date.value)]),
    );
  }

  return raw;
}

function rawPosition(position: DraftDateSetPosition): unknown {
  switch (position.mode) {
    case 'unset':
      return undefined;
    case 'list':
      return position.dates.map((date) => date.value);
    case 'name':
      return position.name;
  }
}

function rawSchedule(schedule: DraftSchedule): Record<string, unknown> {
  const raw: Record<string, unknown> = {};

  if (schedule.label !== '') {
    raw.label = schedule.label;
  }

  if (schedule.description !== '') {
    raw.description = schedule.description;
  }

  if (schedule.from !== '') {
    raw.from = schedule.from;
  }

  if (schedule.until !== '') {
    raw.until = schedule.until;
  }

  if (schedule.years.length > 0) {
    raw.years = schedule.years.map((entry) => Number(entry.value));
  }

  if (schedule.months.length > 0) {
    raw.months = schedule.months.map((entry) => Number(entry.value));
  }

  if (schedule.days.length > 0) {
    raw.days = schedule.days.map((entry) => rawAtom(entry.atom));
  }

  if (schedule.shift !== null) {
    raw.shift = rawShift(schedule.shift);
  }

  if (schedule.if !== null) {
    raw.if = rawIf(schedule.if);
  }

  Object.assign(raw, rawTime(schedule.time));

  return raw;
}

function rawAtom(atom: DraftDayAtom): unknown {
  switch (atom.kind) {
    case null:
      throw unreachable('an unchosen day atom');
    case 'month-day':
      return Number(atom.day);
    case 'weekday':
      return atom.day ?? unreachableThrow('an unchosen day name');
    case 'ordinal-weekday':
      if (atom.ordinal === null || atom.day === null) {
        throw unreachable('an unchosen ordinal weekday');
      }

      return [atom.ordinal, atom.day];
    case 'last-day-of-month':
      return 'last_day_of_month';
    case 'calendar-word':
      return atom.word ?? unreachableThrow('an unchosen calendar word');
    case 'name':
      return atom.name;
    case 'day-cycle':
      return ['every', Number(atom.interval), 'day'];
  }
}

function rawShift(shift: DraftShift): unknown {
  if (shift.direction === null) {
    throw unreachable('an unchosen shift direction');
  }

  const condition = rawAtom(shift.condition);

  return shift.orSame ? [shift.direction, 'or_same', condition] : [shift.direction, condition];
}

function rawIf(guard: DraftIf): unknown {
  return [
    ...(guard.direction !== null ? [guard.direction] : []),
    ...(guard.negated ? ['not'] : []),
    rawAtom(guard.condition),
  ];
}

function rawTime(time: DraftTimeSpec): Record<string, unknown> {
  switch (time.kind) {
    case null:
      throw unreachable('an unchosen time form');
    case 'times':
      return { times: time.times.map((entry) => entry.value) };
    case 'grid': {
      const between = rawBetween(time.between);

      return {
        times: {
          every: rawEvery(time.every),
          ...(between !== undefined ? { between } : {}),
        },
      };
    }
    case 'allday':
      return { allday: true };
    case 'sequence':
      return { every: rawEvery(time.every) };
  }
}

function rawBetween(between: DraftBetween): unknown {
  switch (between.kind) {
    case 'whole-day':
      return undefined;
    case 'window':
      return [between.start, between.end];
    case 'business-hour':
      return 'business_hour';
  }
}

function rawEvery(every: DraftEveryTuple): unknown {
  if (every.unit === null) {
    throw unreachable('an unchosen every unit');
  }

  return [Number(every.count), every.unit];
}

/**
 * The write-back runs only after the field walk found nothing, and the
 * walk reports every unchosen leaf — so reaching one here is a bug in
 * the walk, not a state a caller can produce.
 */
function unreachable(what: string): Error {
  return new Error(`The field walk let ${what} through`);
}

function unreachableThrow(what: string): never {
  throw unreachable(what);
}
