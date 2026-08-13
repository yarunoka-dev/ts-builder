import type {
  YrnkCalendar,
  YrnkDateSet,
  YrnkDayAtom,
  YrnkDayCondition,
  YrnkDocument,
  YrnkIf,
  YrnkSchedule,
  YrnkShift,
  YrnkTimeSpec,
} from '@yarunoka/core';
import type {
  DraftBetween,
  DraftCalendar,
  DraftDateSetPosition,
  DraftDayAtom,
  DraftDayAtomEntry,
  DraftDayCondition,
  DraftDocument,
  DraftEntry,
  DraftIf,
  DraftSchedule,
  DraftShift,
  DraftTimeSpec,
} from './draft.ts';
import type { IdAllocator } from './ids.ts';

/**
 * Expansion of a parsed document into the draft model — the loosening
 * direction of the mirror. Every leaf that the draft holds as a string
 * is stringified from the model's value; the model's absent keys become
 * the draft's empty spellings. The inverse lives in to-yrnk.ts, and
 * expanding then writing back yields the structurally identical
 * document (the round-trip the tests pin down).
 */
export function expandDocument(document: YrnkDocument, alloc: IdAllocator): DraftDocument {
  return {
    label: document.label ?? '',
    description: document.description ?? '',
    timezone: document.timezone,
    resolvers: document.resolvers.map((name) => entryOf(name, alloc)),
    calendar: expandCalendar(document.calendar, alloc),
    schedules: document.schedules.map((schedule) => expandSchedule(schedule, alloc)),
  };
}

export function emptyDraftDocument(): DraftDocument {
  return {
    label: '',
    description: '',
    timezone: '',
    resolvers: [],
    calendar: {
      holidays: { mode: 'unset' },
      businessHolidays: { mode: 'unset' },
      businessDays: { mode: 'unset' },
      workweek: [],
      businessHours: [],
      dateSets: [],
    },
    schedules: [],
  };
}

export function emptyDraftSchedule(alloc: IdAllocator): DraftSchedule {
  return {
    id: alloc(),
    label: '',
    description: '',
    from: '',
    until: '',
    years: [],
    months: [],
    days: [],
    shift: null,
    if: null,
    time: { kind: null },
  };
}

function entryOf<T>(value: T, alloc: IdAllocator): DraftEntry<T> {
  return { id: alloc(), value };
}

function expandCalendar(calendar: YrnkCalendar, alloc: IdAllocator): DraftCalendar {
  return {
    holidays: expandDateSetPosition(calendar.holidays, alloc),
    businessHolidays: expandDateSetPosition(calendar.businessHolidays, alloc),
    businessDays: expandDateSetPosition(calendar.businessDays, alloc),
    workweek: calendar.workweek ?? [],
    businessHours: (calendar.businessHours ?? []).map(([start, end]) =>
      entryOf({ start, end }, alloc),
    ),
    dateSets: Object.entries(calendar.dateSets).map(([name, dates]) => ({
      id: alloc(),
      name,
      dates: dates.map((date) => entryOf(date, alloc)),
    })),
  };
}

function expandDateSetPosition(
  position: YrnkDateSet | undefined,
  alloc: IdAllocator,
): DraftDateSetPosition {
  if (position === undefined) {
    return { mode: 'unset' };
  }

  if (typeof position === 'string') {
    return { mode: 'name', name: position };
  }

  return { mode: 'list', dates: position.map((date) => entryOf(date, alloc)) };
}

function expandSchedule(schedule: YrnkSchedule, alloc: IdAllocator): DraftSchedule {
  return {
    id: alloc(),
    label: schedule.label ?? '',
    description: schedule.description ?? '',
    from: schedule.from ?? '',
    until: schedule.until ?? '',
    years: (schedule.years ?? []).map((year) => entryOf(String(year), alloc)),
    months: (schedule.months ?? []).map((month) => entryOf(String(month), alloc)),
    days: (schedule.days ?? []).map(
      (atom): DraftDayAtomEntry => ({ id: alloc(), atom: expandAtom(atom) }),
    ),
    shift: schedule.shift !== undefined ? expandShift(schedule.shift) : null,
    if: schedule.if !== undefined ? expandIf(schedule.if) : null,
    time: expandTimeSpec(schedule.time, alloc),
  };
}

function expandAtom(atom: YrnkDayAtom): DraftDayAtom {
  switch (atom.kind) {
    case 'month-day':
      return { kind: 'month-day', day: String(atom.day) };
    case 'day-cycle':
      return { kind: 'day-cycle', interval: String(atom.interval) };
    default:
      // The remaining forms hold closed-set values only; the model's
      // node is already the draft's chosen state.
      return atom;
  }
}

function expandCondition(condition: YrnkDayCondition): DraftDayCondition {
  // The day cycle cannot appear in a condition, so the expansion cannot
  // produce one either; the types just cannot carry that knowledge
  // through the shared atom expansion.
  return expandAtom(condition) as DraftDayCondition;
}

function expandShift(shift: YrnkShift): DraftShift {
  return {
    direction: shift.direction,
    orSame: shift.orSame,
    condition: expandCondition(shift.condition),
  };
}

function expandIf(guard: YrnkIf): DraftIf {
  return {
    direction: guard.direction,
    negated: guard.negated,
    condition: expandCondition(guard.condition),
  };
}

function expandTimeSpec(time: YrnkTimeSpec, alloc: IdAllocator): DraftTimeSpec {
  switch (time.kind) {
    case 'times':
      return { kind: 'times', times: time.times.map((value) => entryOf(value, alloc)) };
    case 'grid':
      return {
        kind: 'grid',
        every: { count: String(time.every[0]), unit: time.every[1] },
        between: expandBetween(time.between),
      };
    case 'allday':
      return { kind: 'allday' };
    case 'sequence':
      return { kind: 'sequence', every: { count: String(time.every[0]), unit: time.every[1] } };
  }
}

function expandBetween(between: readonly [string, string] | 'business_hour' | null): DraftBetween {
  if (between === null) {
    return { kind: 'whole-day' };
  }

  if (between === 'business_hour') {
    return { kind: 'business-hour' };
  }

  return { kind: 'window', start: between[0], end: between[1] };
}
