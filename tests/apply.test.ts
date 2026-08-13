// The reducer behind dispatch: each op writes its slot of the draft and
// nothing else, snapshots stay immutable (the previous draft is
// untouched), and an op addressed at a missing id throws instead of
// silently doing nothing.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parse } from '@yarunoka/core';
import { applyOp } from '../src/apply.ts';
import type { DraftDocument, DraftSchedule } from '../src/draft.ts';
import { emptyDraftDocument } from '../src/from-yrnk.ts';
import { createIdAllocator } from '../src/ids.ts';
import type { BuilderOp } from '../src/ops.ts';

function editor(): { current: () => DraftDocument; run: (...ops: BuilderOp[]) => DraftDocument } {
  const alloc = createIdAllocator();
  let draft = emptyDraftDocument();

  return {
    current: () => draft,
    run: (...ops) => {
      for (const op of ops) {
        draft = applyOp(draft, op, alloc);
      }

      return draft;
    },
  };
}

function scheduleOf(draft: DraftDocument): DraftSchedule {
  const schedule = draft.schedules[0];

  assert.ok(schedule);

  return schedule;
}

describe('document ops', () => {
  it('sets the annotations and the timezone', () => {
    const { run } = editor();
    const draft = run(
      { type: 'document/set-label', value: 'Payroll' },
      { type: 'document/set-description', value: 'All the paydays' },
      { type: 'document/set-timezone', value: 'Asia/Tokyo' },
    );

    assert.equal(draft.label, 'Payroll');
    assert.equal(draft.description, 'All the paydays');
    assert.equal(draft.timezone, 'Asia/Tokyo');
  });

  it('leaves the previous snapshot untouched', () => {
    const { current, run } = editor();
    const before = current();

    run({ type: 'document/set-label', value: 'changed' });

    assert.equal(before.label, '');
  });

  it('replaces the whole draft', () => {
    const { run } = editor();
    const replacement = emptyDraftDocument();
    const draft = run({ type: 'document/replace', draft: replacement });

    assert.equal(draft, replacement);
  });

  it('loads a parsed document by expanding it', () => {
    const document = parse({
      version: '1.0',
      timezone: 'UTC',
      schedules: [{ days: ['mon'], allday: true }],
    });
    const { run } = editor();
    const draft = run({ type: 'document/load', document });

    assert.equal(draft.timezone, 'UTC');
    assert.deepEqual(scheduleOf(draft).days[0]?.atom, { kind: 'weekday', day: 'mon' });
  });
});

describe('resolvers ops', () => {
  it('adds, renames, and removes an entry', () => {
    const { run } = editor();
    let draft = run({ type: 'resolvers/add' });
    const id = draft.resolvers[0]?.id as string;

    assert.deepEqual(draft.resolvers[0]?.value, '');

    draft = run({ type: 'resolvers/set', id, name: 'company_holidays' });
    assert.equal(draft.resolvers[0]?.value, 'company_holidays');

    draft = run({ type: 'resolvers/remove', id });
    assert.deepEqual(draft.resolvers, []);
  });

  it('throws on a missing id', () => {
    const { run } = editor();

    assert.throws(() => run({ type: 'resolvers/set', id: 'nope', name: 'x' }), /nope/);
  });
});

describe('calendar date-list position ops', () => {
  it('switches modes with fresh empty content', () => {
    const { run } = editor();
    let draft = run({ type: 'calendar/set-date-set-mode', target: 'holidays', mode: 'list' });

    assert.deepEqual(draft.calendar.holidays, { mode: 'list', dates: [] });

    draft = run({ type: 'calendar/set-date-set-mode', target: 'holidays', mode: 'name' });
    assert.deepEqual(draft.calendar.holidays, { mode: 'name', name: '' });

    draft = run({ type: 'calendar/set-date-set-mode', target: 'holidays', mode: 'unset' });
    assert.deepEqual(draft.calendar.holidays, { mode: 'unset' });
  });

  it('sets the referenced name', () => {
    const { run } = editor();
    const draft = run(
      { type: 'calendar/set-date-set-mode', target: 'business-holidays', mode: 'name' },
      { type: 'calendar/set-date-set-name', target: 'business-holidays', name: 'externals' },
    );

    assert.deepEqual(draft.calendar.businessHolidays, { mode: 'name', name: 'externals' });
  });

  it('adds, edits, and removes dates in list mode', () => {
    const { run } = editor();
    let draft = run(
      { type: 'calendar/set-date-set-mode', target: 'business-days', mode: 'list' },
      { type: 'calendar/add-date', target: 'business-days' },
    );
    const position = draft.calendar.businessDays;
    const id = (position.mode === 'list' ? position.dates[0]?.id : undefined) as string;

    draft = run({ type: 'calendar/set-date', target: 'business-days', id, date: '2026-08-13' });
    assert.deepEqual(
      draft.calendar.businessDays.mode === 'list'
        ? draft.calendar.businessDays.dates.map((d) => d.value)
        : [],
      ['2026-08-13'],
    );

    draft = run({ type: 'calendar/remove-date', target: 'business-days', id });
    assert.deepEqual(
      draft.calendar.businessDays.mode === 'list' ? draft.calendar.businessDays.dates : undefined,
      [],
    );
  });

  it('throws when dates are edited outside list mode', () => {
    const { run } = editor();

    assert.throws(() => run({ type: 'calendar/add-date', target: 'holidays' }), /list/);
  });

  it('keeps the content when the current mode is dispatched again', () => {
    const { run } = editor();
    let draft = run(
      { type: 'calendar/set-date-set-mode', target: 'holidays', mode: 'list' },
      { type: 'calendar/add-date', target: 'holidays' },
    );
    const position = draft.calendar.holidays;
    const id = (position.mode === 'list' ? position.dates[0]?.id : undefined) as string;

    draft = run(
      { type: 'calendar/set-date', target: 'holidays', id, date: '2026-01-01' },
      { type: 'calendar/set-date-set-mode', target: 'holidays', mode: 'list' },
    );
    assert.deepEqual(
      draft.calendar.holidays.mode === 'list'
        ? draft.calendar.holidays.dates.map((d) => d.value)
        : [],
      ['2026-01-01'],
    );
  });
});

describe('calendar workweek, business hours, and date_sets ops', () => {
  it('sets the workweek whole', () => {
    const { run } = editor();
    const draft = run({ type: 'calendar/set-workweek', days: ['mon', 'tue'] });

    assert.deepEqual(draft.calendar.workweek, ['mon', 'tue']);
  });

  it('adds, edits, and removes a business hours window', () => {
    const { run } = editor();
    let draft = run({ type: 'calendar/add-business-hours-window' });
    const id = draft.calendar.businessHours[0]?.id as string;

    assert.deepEqual(draft.calendar.businessHours[0]?.value, { start: '', end: '' });

    draft = run({ type: 'calendar/set-business-hours-window', id, start: '09:00', end: '17:00' });
    assert.deepEqual(draft.calendar.businessHours[0]?.value, { start: '09:00', end: '17:00' });

    draft = run({ type: 'calendar/remove-business-hours-window', id });
    assert.deepEqual(draft.calendar.businessHours, []);
  });

  it('adds, renames, fills, and removes a date_sets entry', () => {
    const { run } = editor();
    let draft = run({ type: 'calendar/add-date-set' });
    const setId = draft.calendar.dateSets[0]?.id as string;

    assert.deepEqual(draft.calendar.dateSets[0], { id: setId, name: '', dates: [] });

    draft = run(
      { type: 'calendar/rename-date-set', id: setId, name: 'paydays' },
      { type: 'calendar/add-date-set-date', setId },
    );
    const dateId = draft.calendar.dateSets[0]?.dates[0]?.id as string;

    draft = run({ type: 'calendar/set-date-set-date', setId, id: dateId, date: '2026-04-25' });
    assert.deepEqual(
      draft.calendar.dateSets.map((set) => ({
        name: set.name,
        dates: set.dates.map((d) => d.value),
      })),
      [{ name: 'paydays', dates: ['2026-04-25'] }],
    );

    draft = run({ type: 'calendar/remove-date-set-date', setId, id: dateId });
    assert.deepEqual(draft.calendar.dateSets[0]?.dates, []);

    draft = run({ type: 'calendar/remove-date-set', id: setId });
    assert.deepEqual(draft.calendar.dateSets, []);
  });
});

describe('schedules list ops', () => {
  it('adds an empty schedule with a fresh id', () => {
    const { run } = editor();
    const draft = run({ type: 'schedules/add' });

    assert.equal(draft.schedules.length, 1);
    assert.deepEqual(scheduleOf(draft).time, { kind: null });
  });

  it('removes a schedule by id', () => {
    const { run } = editor();
    let draft = run({ type: 'schedules/add' }, { type: 'schedules/add' });
    const [first, second] = draft.schedules.map((s) => s.id) as [string, string];

    draft = run({ type: 'schedules/remove', id: first });
    assert.deepEqual(
      draft.schedules.map((s) => s.id),
      [second],
    );
  });

  it('moves a schedule to a new position', () => {
    const { run } = editor();
    let draft = run(
      { type: 'schedules/add' },
      { type: 'schedules/add' },
      { type: 'schedules/add' },
    );
    const ids = draft.schedules.map((s) => s.id);

    draft = run({ type: 'schedules/move', id: ids[2] as string, to: 0 });
    assert.deepEqual(
      draft.schedules.map((s) => s.id),
      [ids[2], ids[0], ids[1]],
    );
  });
});

describe('schedule ops', () => {
  function withSchedule(): {
    id: string;
    run: (...ops: BuilderOp[]) => DraftDocument;
  } {
    const { current, run } = editor();

    run({ type: 'schedules/add' });

    return { id: scheduleOf(current()).id, run };
  }

  it('sets the head fields', () => {
    const { id, run } = withSchedule();
    const draft = run(
      { type: 'schedule/set-label', scheduleId: id, value: 'Payday' },
      { type: 'schedule/set-description', scheduleId: id, value: 'The 25th' },
      { type: 'schedule/set-from', scheduleId: id, value: '2026-01-01 00:00' },
      { type: 'schedule/set-until', scheduleId: id, value: '2027-01-01 00:00' },
    );
    const schedule = scheduleOf(draft);

    assert.equal(schedule.label, 'Payday');
    assert.equal(schedule.description, 'The 25th');
    assert.equal(schedule.from, '2026-01-01 00:00');
    assert.equal(schedule.until, '2027-01-01 00:00');
  });

  it('edits the years and months axes', () => {
    const { id, run } = withSchedule();
    let draft = run({ type: 'schedule/add-year', scheduleId: id });
    const yearId = scheduleOf(draft).years[0]?.id as string;

    draft = run({ type: 'schedule/set-year', scheduleId: id, id: yearId, value: '2026' });
    assert.deepEqual(
      scheduleOf(draft).years.map((e) => e.value),
      ['2026'],
    );

    draft = run({ type: 'schedule/remove-year', scheduleId: id, id: yearId });
    assert.deepEqual(scheduleOf(draft).years, []);

    draft = run({ type: 'schedule/add-month', scheduleId: id });
    const monthId = scheduleOf(draft).months[0]?.id as string;

    draft = run({ type: 'schedule/set-month', scheduleId: id, id: monthId, value: '4' });
    assert.deepEqual(
      scheduleOf(draft).months.map((e) => e.value),
      ['4'],
    );

    draft = run({ type: 'schedule/remove-month', scheduleId: id, id: monthId });
    assert.deepEqual(scheduleOf(draft).months, []);
  });

  it('edits the day atoms', () => {
    const { id, run } = withSchedule();
    let draft = run({ type: 'schedule/add-day-atom', scheduleId: id });
    const atomId = scheduleOf(draft).days[0]?.id as string;

    assert.deepEqual(scheduleOf(draft).days[0]?.atom, { kind: null });

    draft = run({
      type: 'schedule/set-day-atom',
      scheduleId: id,
      id: atomId,
      atom: { kind: 'month-day', day: '25' },
    });
    assert.deepEqual(scheduleOf(draft).days[0]?.atom, { kind: 'month-day', day: '25' });

    draft = run({ type: 'schedule/remove-day-atom', scheduleId: id, id: atomId });
    assert.deepEqual(scheduleOf(draft).days, []);
  });

  it('sets shift and if whole', () => {
    const { id, run } = withSchedule();
    let draft = run({
      type: 'schedule/set-shift',
      scheduleId: id,
      shift: { direction: 'prev', orSame: false, condition: { kind: null } },
    });

    assert.deepEqual(scheduleOf(draft).shift, {
      direction: 'prev',
      orSame: false,
      condition: { kind: null },
    });

    draft = run(
      {
        type: 'schedule/set-if',
        scheduleId: id,
        if: { direction: null, negated: true, condition: { kind: 'calendar-word', word: null } },
      },
      { type: 'schedule/set-shift', scheduleId: id, shift: null },
    );
    assert.equal(scheduleOf(draft).shift, null);
    assert.deepEqual(scheduleOf(draft).if, {
      direction: null,
      negated: true,
      condition: { kind: 'calendar-word', word: null },
    });
  });

  it('switches the time form with fresh content', () => {
    const { id, run } = withSchedule();
    let draft = run({ type: 'schedule/set-time-kind', scheduleId: id, kind: 'times' });

    assert.deepEqual(scheduleOf(draft).time, { kind: 'times', times: [] });

    draft = run({ type: 'schedule/set-time-kind', scheduleId: id, kind: 'grid' });
    assert.deepEqual(scheduleOf(draft).time, {
      kind: 'grid',
      every: { count: '', unit: null },
      between: { kind: 'whole-day' },
    });

    draft = run({ type: 'schedule/set-time-kind', scheduleId: id, kind: 'allday' });
    assert.deepEqual(scheduleOf(draft).time, { kind: 'allday' });

    draft = run({ type: 'schedule/set-time-kind', scheduleId: id, kind: 'sequence' });
    assert.deepEqual(scheduleOf(draft).time, {
      kind: 'sequence',
      every: { count: '', unit: null },
    });

    draft = run({ type: 'schedule/set-time-kind', scheduleId: id, kind: null });
    assert.deepEqual(scheduleOf(draft).time, { kind: null });
  });

  it('keeps the content when the current time form is dispatched again', () => {
    const { id, run } = withSchedule();
    let draft = run(
      { type: 'schedule/set-time-kind', scheduleId: id, kind: 'times' },
      { type: 'schedule/add-time', scheduleId: id },
    );
    const time = scheduleOf(draft).time;
    const timeId = (time.kind === 'times' ? time.times[0]?.id : undefined) as string;

    draft = run(
      { type: 'schedule/set-time', scheduleId: id, id: timeId, value: '09:00' },
      { type: 'schedule/set-time-kind', scheduleId: id, kind: 'times' },
    );
    assert.deepEqual(
      scheduleOf(draft).time.kind === 'times'
        ? (scheduleOf(draft).time as { times: readonly { value: string }[] }).times.map(
            (e) => e.value,
          )
        : [],
      ['09:00'],
    );
  });

  it('edits the fixed times enumeration', () => {
    const { id, run } = withSchedule();
    let draft = run(
      { type: 'schedule/set-time-kind', scheduleId: id, kind: 'times' },
      { type: 'schedule/add-time', scheduleId: id },
    );
    const time = scheduleOf(draft).time;
    const timeId = (time.kind === 'times' ? time.times[0]?.id : undefined) as string;

    draft = run({ type: 'schedule/set-time', scheduleId: id, id: timeId, value: '09:00' });
    assert.deepEqual(
      scheduleOf(draft).time.kind === 'times'
        ? (scheduleOf(draft).time as { times: readonly { value: string }[] }).times.map(
            (e) => e.value,
          )
        : [],
      ['09:00'],
    );

    draft = run({ type: 'schedule/remove-time', scheduleId: id, id: timeId });
    assert.deepEqual(
      scheduleOf(draft).time.kind === 'times'
        ? (scheduleOf(draft).time as { times: readonly unknown[] }).times
        : undefined,
      [],
    );
  });

  it('edits the grid tuple and window', () => {
    const { id, run } = withSchedule();
    let draft = run(
      { type: 'schedule/set-time-kind', scheduleId: id, kind: 'grid' },
      { type: 'schedule/set-grid-every', scheduleId: id, count: '90', unit: 'minute' },
      {
        type: 'schedule/set-grid-between',
        scheduleId: id,
        between: { kind: 'window', start: '09:00', end: '17:00' },
      },
    );

    assert.deepEqual(scheduleOf(draft).time, {
      kind: 'grid',
      every: { count: '90', unit: 'minute' },
      between: { kind: 'window', start: '09:00', end: '17:00' },
    });

    draft = run({
      type: 'schedule/set-grid-between',
      scheduleId: id,
      between: { kind: 'business-hour' },
    });
    assert.deepEqual(
      scheduleOf(draft).time.kind === 'grid'
        ? (scheduleOf(draft).time as { between: unknown }).between
        : undefined,
      { kind: 'business-hour' },
    );
  });

  it('edits the sequence tuple', () => {
    const { id, run } = withSchedule();
    const draft = run(
      { type: 'schedule/set-time-kind', scheduleId: id, kind: 'sequence' },
      { type: 'schedule/set-sequence-every', scheduleId: id, count: '6', unit: 'hour' },
    );

    assert.deepEqual(scheduleOf(draft).time, {
      kind: 'sequence',
      every: { count: '6', unit: 'hour' },
    });
  });

  it('throws when a form-specific op meets another form', () => {
    const { id, run } = withSchedule();

    run({ type: 'schedule/set-time-kind', scheduleId: id, kind: 'allday' });

    assert.throws(() => run({ type: 'schedule/add-time', scheduleId: id }), /times/);
    assert.throws(
      () => run({ type: 'schedule/set-grid-every', scheduleId: id, count: '1', unit: 'hour' }),
      /grid/,
    );
  });

  it('throws on a missing schedule id', () => {
    const { run } = editor();

    assert.throws(
      () => run({ type: 'schedule/set-label', scheduleId: 'nope', value: 'x' }),
      /nope/,
    );
  });
});
