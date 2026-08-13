// Expansion of a parsed document into the draft model: every model node
// appears mirrored, leaves become strings as written, absent keys become
// the empty spellings, and every list element carries a fresh draft id.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parse } from '@yarunoka/core';
import type { DraftSchedule } from '../src/draft.ts';
import { emptyDraftDocument, emptyDraftSchedule, expandDocument } from '../src/from-yrnk.ts';
import { createIdAllocator } from '../src/ids.ts';

const FULL_DOCUMENT = {
  label: 'Payroll',
  description: 'Company payroll calendar',
  version: '1.0',
  timezone: 'Asia/Tokyo',
  resolvers: ['company_holidays'],
  calendar: {
    holidays: ['2026-01-01', '2026-05-05'],
    business_holidays: 'company_holidays',
    business_days: [],
    workweek: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'],
    business_hours: [
      ['09:00', '12:00'],
      ['13:00', '17:30'],
    ],
    date_sets: {
      paydays: ['2026-04-25', '2026-05-25'],
    },
  },
  schedules: [
    {
      label: 'Payday',
      from: '2026-01-01 00:00',
      until: '2027-01-01 00:00',
      years: [2026],
      months: [4, 5],
      days: [25, 'fri', ['1st', 'mon'], 'last_day_of_month', 'business_day', 'paydays'],
      shift: ['prev', 'or_same', 'business_day'],
      if: ['next', 'not', 'holiday'],
      times: ['09:00', '15:30'],
    },
    {
      days: [['every', 10, 'day']],
      from: '2026-01-01 00:00',
      times: { every: [90, 'minute'], between: ['09:00', '17:00'] },
    },
    {
      days: ['weekday'],
      times: { every: [1, 'hour'], between: 'business_hour' },
    },
    {
      days: ['sun'],
      allday: true,
    },
    {
      from: '2026-01-01 00:00',
      every: [6, 'hour'],
    },
  ],
};

const RESOLVERS = { company_holidays: () => ['2026-08-11'] };

function expandFull(): ReturnType<typeof expandDocument> {
  const document = parse(FULL_DOCUMENT, { resolvers: RESOLVERS });

  return expandDocument(document, createIdAllocator());
}

describe('expandDocument', () => {
  it('mirrors the document head with absent annotations as empty strings', () => {
    const draft = expandFull();

    assert.equal(draft.label, 'Payroll');
    assert.equal(draft.description, 'Company payroll calendar');
    assert.equal(draft.timezone, 'Asia/Tokyo');
    assert.deepEqual(
      draft.resolvers.map((entry) => entry.value),
      ['company_holidays'],
    );
  });

  it('expands each date-list position into its own mode', () => {
    const { calendar } = expandFull();

    assert.equal(calendar.holidays.mode, 'list');
    assert.deepEqual(
      calendar.holidays.mode === 'list' ? calendar.holidays.dates.map((d) => d.value) : [],
      ['2026-01-01', '2026-05-05'],
    );
    assert.deepEqual(calendar.businessHolidays, { mode: 'name', name: 'company_holidays' });
    assert.equal(calendar.businessDays.mode, 'list');
    assert.deepEqual(
      calendar.businessDays.mode === 'list' ? calendar.businessDays.dates : undefined,
      [],
    );
  });

  it('expands workweek, business hours, and date_sets entries', () => {
    const { calendar } = expandFull();

    assert.deepEqual(calendar.workweek, ['mon', 'tue', 'wed', 'thu', 'fri', 'sat']);
    assert.deepEqual(
      calendar.businessHours.map((entry) => entry.value),
      [
        { start: '09:00', end: '12:00' },
        { start: '13:00', end: '17:30' },
      ],
    );
    assert.deepEqual(
      calendar.dateSets.map((set) => ({ name: set.name, dates: set.dates.map((d) => d.value) })),
      [{ name: 'paydays', dates: ['2026-04-25', '2026-05-25'] }],
    );
  });

  it('stringifies the integer leaves as written', () => {
    const schedule = expandFull().schedules[0] as DraftSchedule;

    assert.deepEqual(
      schedule.years.map((entry) => entry.value),
      ['2026'],
    );
    assert.deepEqual(
      schedule.months.map((entry) => entry.value),
      ['4', '5'],
    );
    assert.deepEqual(schedule.days[0]?.atom, { kind: 'month-day', day: '25' });
  });

  it('expands every day atom form', () => {
    const schedule = expandFull().schedules[0] as DraftSchedule;
    const cycle = expandFull().schedules[1] as DraftSchedule;

    assert.deepEqual(
      schedule.days.map((entry) => entry.atom),
      [
        { kind: 'month-day', day: '25' },
        { kind: 'weekday', day: 'fri' },
        { kind: 'ordinal-weekday', ordinal: '1st', day: 'mon' },
        { kind: 'last-day-of-month' },
        { kind: 'calendar-word', word: 'business_day' },
        { kind: 'name', name: 'paydays' },
      ],
    );
    assert.deepEqual(cycle.days[0]?.atom, { kind: 'day-cycle', interval: '10' });
  });

  it('expands shift and if with their conditions', () => {
    const schedule = expandFull().schedules[0] as DraftSchedule;

    assert.deepEqual(schedule.shift, {
      direction: 'prev',
      orSame: true,
      condition: { kind: 'calendar-word', word: 'business_day' },
    });
    assert.deepEqual(schedule.if, {
      direction: 'next',
      negated: true,
      condition: { kind: 'calendar-word', word: 'holiday' },
    });
  });

  it('expands each time form', () => {
    const schedules = expandFull().schedules;
    const times = schedules[0] as DraftSchedule;
    const grid = schedules[1] as DraftSchedule;
    const businessHour = schedules[2] as DraftSchedule;
    const allday = schedules[3] as DraftSchedule;
    const sequence = schedules[4] as DraftSchedule;

    assert.equal(times.time.kind, 'times');
    assert.deepEqual(
      times.time.kind === 'times' ? times.time.times.map((entry) => entry.value) : [],
      ['09:00', '15:30'],
    );
    assert.deepEqual(grid.time, {
      kind: 'grid',
      every: { count: '90', unit: 'minute' },
      between: { kind: 'window', start: '09:00', end: '17:00' },
    });
    assert.deepEqual(businessHour.time, {
      kind: 'grid',
      every: { count: '1', unit: 'hour' },
      between: { kind: 'business-hour' },
    });
    assert.deepEqual(allday.time, { kind: 'allday' });
    assert.deepEqual(sequence.time, {
      kind: 'sequence',
      every: { count: '6', unit: 'hour' },
    });
  });

  it('reads absent keys as the empty spellings', () => {
    const bare = parse({
      version: '1.0',
      timezone: 'UTC',
      schedules: [{ days: ['mon'], allday: true }],
    });
    const draft = expandDocument(bare, createIdAllocator());
    const schedule = draft.schedules[0] as DraftSchedule;

    assert.equal(draft.label, '');
    assert.equal(draft.description, '');
    assert.deepEqual(draft.resolvers, []);
    assert.deepEqual(draft.calendar.holidays, { mode: 'unset' });
    assert.deepEqual(draft.calendar.workweek, []);
    assert.deepEqual(draft.calendar.businessHours, []);
    assert.deepEqual(draft.calendar.dateSets, []);
    assert.equal(schedule.from, '');
    assert.equal(schedule.until, '');
    assert.deepEqual(schedule.years, []);
    assert.equal(schedule.shift, null);
    assert.equal(schedule.if, null);
  });

  it('gives every list element a distinct id', () => {
    const draft = expandFull();
    const ids: string[] = [];

    for (const entry of draft.resolvers) {
      ids.push(entry.id);
    }

    if (draft.calendar.holidays.mode === 'list') {
      ids.push(...draft.calendar.holidays.dates.map((d) => d.id));
    }

    for (const set of draft.calendar.dateSets) {
      ids.push(set.id, ...set.dates.map((d) => d.id));
    }

    for (const schedule of draft.schedules) {
      ids.push(schedule.id);
      ids.push(...schedule.years.map((e) => e.id), ...schedule.months.map((e) => e.id));
      ids.push(...schedule.days.map((e) => e.id));

      if (schedule.time.kind === 'times') {
        ids.push(...schedule.time.times.map((e) => e.id));
      }
    }

    assert.equal(new Set(ids).size, ids.length);
  });
});

describe('emptyDraftDocument', () => {
  it('starts with nothing chosen and nothing written', () => {
    const draft = emptyDraftDocument();

    assert.equal(draft.label, '');
    assert.equal(draft.timezone, '');
    assert.deepEqual(draft.resolvers, []);
    assert.deepEqual(draft.calendar.holidays, { mode: 'unset' });
    assert.deepEqual(draft.schedules, []);
  });
});

describe('emptyDraftSchedule', () => {
  it('starts with no axes, no modifiers, and the time form unchosen', () => {
    const schedule = emptyDraftSchedule(createIdAllocator());

    assert.equal(schedule.from, '');
    assert.deepEqual(schedule.days, []);
    assert.equal(schedule.shift, null);
    assert.equal(schedule.if, null);
    assert.deepEqual(schedule.time, { kind: null });
  });
});
