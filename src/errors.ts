import {
  dateLiteralProblem,
  descriptionProblem,
  isTimeLiteral,
  labelProblem,
  nameProblem,
  timezoneProblem,
  windowProblem,
} from '@yarunoka/core';
import type {
  DraftDateSetPosition,
  DraftDayAtom,
  DraftDocument,
  DraftEveryTuple,
  DraftPath,
  DraftProblem,
  DraftSchedule,
  DraftTimeSpec,
} from './draft.ts';

/**
 * The field-level walk: every free-input leaf judged by core's
 * validation helpers, every unchosen closed-set leaf reported as
 * unchosen. The walk knows where it is, which is what turns a helper's
 * bare message into a problem with a draft path. What no single field
 * can decide (name resolution, from < until, the axis exclusivity of
 * the interval sequence) is left to core's parse at the document gate —
 * re-deciding it here would be the re-implementation this package
 * exists to avoid.
 *
 * Empty spellings that read as "key omitted" are not judged: absence is
 * a valid state of the draft. The two spellable-but-invalid emptinesses
 * (no schedules, an empty times enumeration) are reported here so they
 * carry a path.
 */
export function leafProblems(draft: DraftDocument): readonly DraftProblem[] {
  const problems: DraftProblem[] = [];
  const report = (path: DraftPath, message: string | null): void => {
    if (message !== null) {
      problems.push({ path, message, origin: 'field' });
    }
  };

  if (draft.label !== '') {
    report(['label'], labelProblem(draft.label));
  }

  if (draft.description !== '') {
    report(['description'], descriptionProblem(draft.description));
  }

  report(['timezone'], timezoneProblem(draft.timezone));

  for (const entry of draft.resolvers) {
    report(['resolvers', entry.id], nameProblem(entry.value));
  }

  walkPosition(draft.calendar.holidays, ['calendar', 'holidays'], report);
  walkPosition(draft.calendar.businessHolidays, ['calendar', 'businessHolidays'], report);
  walkPosition(draft.calendar.businessDays, ['calendar', 'businessDays'], report);

  for (const entry of draft.calendar.businessHours) {
    report(
      ['calendar', 'businessHours', entry.id],
      windowProblem(entry.value.start, entry.value.end),
    );
  }

  for (const set of draft.calendar.dateSets) {
    report(['calendar', 'dateSets', set.id, 'name'], nameProblem(set.name));

    for (const date of set.dates) {
      report(['calendar', 'dateSets', set.id, date.id], dateLiteralProblem(date.value));
    }
  }

  if (draft.schedules.length === 0) {
    report(['schedules'], 'schedules cannot be empty');
  }

  for (const schedule of draft.schedules) {
    walkSchedule(schedule, report);
  }

  return problems;
}

type Report = (path: DraftPath, message: string | null) => void;

const NOT_CHOSEN = 'Not chosen yet';

function walkPosition(position: DraftDateSetPosition, at: DraftPath, report: Report): void {
  if (position.mode === 'name') {
    report([...at, 'name'], nameProblem(position.name));
  }

  if (position.mode === 'list') {
    for (const date of position.dates) {
      report([...at, date.id], dateLiteralProblem(date.value));
    }
  }
}

function walkSchedule(schedule: DraftSchedule, report: Report): void {
  const at = ['schedules', schedule.id];

  if (schedule.label !== '') {
    report([...at, 'label'], labelProblem(schedule.label));
  }

  if (schedule.description !== '') {
    report([...at, 'description'], descriptionProblem(schedule.description));
  }

  if (schedule.from !== '') {
    report([...at, 'from'], boundaryProblem(schedule.from));
  }

  if (schedule.until !== '') {
    report([...at, 'until'], boundaryProblem(schedule.until));
  }

  for (const entry of schedule.years) {
    report([...at, 'years', entry.id], integerProblem(entry.value));
  }

  for (const entry of schedule.months) {
    report([...at, 'months', entry.id], integerProblem(entry.value));
  }

  for (const entry of schedule.days) {
    walkAtom(entry.atom, [...at, 'days', entry.id], report);
  }

  if (schedule.shift !== null) {
    if (schedule.shift.direction === null) {
      report([...at, 'shift', 'direction'], NOT_CHOSEN);
    }

    walkAtom(schedule.shift.condition, [...at, 'shift', 'condition'], report);
  }

  // A null if direction is "the day itself", not an unchosen state.
  if (schedule.if !== null) {
    walkAtom(schedule.if.condition, [...at, 'if', 'condition'], report);
  }

  walkTime(schedule.time, [...at, 'time'], report);
}

function walkAtom(atom: DraftDayAtom, at: DraftPath, report: Report): void {
  switch (atom.kind) {
    case null:
      report([...at, 'kind'], NOT_CHOSEN);

      return;
    case 'month-day':
      report([...at, 'day'], integerProblem(atom.day));

      return;
    case 'weekday':
      if (atom.day === null) {
        report([...at, 'day'], NOT_CHOSEN);
      }

      return;
    case 'ordinal-weekday':
      if (atom.ordinal === null) {
        report([...at, 'ordinal'], NOT_CHOSEN);
      }

      if (atom.day === null) {
        report([...at, 'day'], NOT_CHOSEN);
      }

      return;
    case 'last-day-of-month':
      return;
    case 'calendar-word':
      if (atom.word === null) {
        report([...at, 'word'], NOT_CHOSEN);
      }

      return;
    case 'name':
      report([...at, 'name'], nameProblem(atom.name));

      return;
    case 'day-cycle':
      report([...at, 'interval'], integerProblem(atom.interval));

      return;
  }
}

function walkTime(time: DraftTimeSpec, at: DraftPath, report: Report): void {
  switch (time.kind) {
    case null:
      report([...at, 'kind'], NOT_CHOSEN);

      return;
    case 'times':
      if (time.times.length === 0) {
        report(at, 'Times enumeration cannot be empty');
      }

      for (const entry of time.times) {
        report([...at, entry.id], timeProblem(entry.value));
      }

      return;
    case 'grid':
      walkEvery(time.every, at, report);

      if (time.between.kind === 'window') {
        report([...at, 'between'], windowProblem(time.between.start, time.between.end));
      }

      return;
    case 'allday':
      return;
    case 'sequence':
      walkEvery(time.every, at, report);

      return;
  }
}

function walkEvery(every: DraftEveryTuple, at: DraftPath, report: Report): void {
  report([...at, 'every', 'count'], integerProblem(every.count));

  if (every.unit === null) {
    report([...at, 'every', 'unit'], NOT_CHOSEN);
  }
}

/**
 * The one format judgment core cannot make for the draft: the draft
 * holds its integers as typed strings, so the digits themselves need
 * checking before Number() may read them. Ranges (a 13th month, a zero
 * interval) stay with parse — those are the spec's rules, not the
 * form's.
 */
function integerProblem(value: string): string | null {
  return /^\d+$/.test(value) ? null : `Must be an integer: ${value}`;
}

/**
 * The boundary literal, judged by composing what core exports: the
 * "date, one space, time" shape here, the date's reality through
 * dateLiteralProblem, the time through isTimeLiteral.
 */
function boundaryProblem(value: string): string | null {
  const parts = value.split(' ');

  if (parts.length !== 2) {
    return `Must be a "YYYY-MM-DD HH:MM" string: ${value}`;
  }

  const [date, time] = parts as [string, string];

  if (!isTimeLiteral(time)) {
    return `Must be a "YYYY-MM-DD HH:MM" string: ${value}`;
  }

  return dateLiteralProblem(date);
}

function timeProblem(value: string): string | null {
  return isTimeLiteral(value) ? null : `Must be a zero-padded HH:MM time: ${value}`;
}
