// Field-level validation: each free-input leaf is judged by core's
// validation helpers (plus the integer-format checks the draft's
// stringified integers need), each unchosen closed-set leaf is reported
// as such, and every finding carries the draft path it sits at.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { nameProblem, parse, timezoneProblem } from '@yarunoka/core';
import type { DraftPath } from '../src/draft.ts';
import { leafProblems } from '../src/errors.ts';
import { emptyDraftDocument, expandDocument } from '../src/from-yrnk.ts';
import { createIdAllocator } from '../src/ids.ts';

function pathsOf(problems: readonly { path: DraftPath }[]): string[] {
  return problems.map((problem) => problem.path.join('.'));
}

describe('leafProblems', () => {
  it('finds nothing in a clean expanded document', () => {
    const document = parse(
      {
        version: '1.0',
        timezone: 'Asia/Tokyo',
        resolvers: ['externals'],
        calendar: {
          holidays: ['2026-01-01'],
          business_holidays: 'externals',
          business_days: [],
          workweek: ['mon'],
          business_hours: [['09:00', '17:00']],
          date_sets: { paydays: ['2026-04-25'] },
        },
        schedules: [
          {
            from: '2026-01-01 00:00',
            until: '2027-01-01 00:00',
            years: [2026],
            months: [4],
            days: [25, ['every', 3, 'day']],
            shift: ['prev', 'business_day'],
            if: ['not', 'holiday'],
            times: { every: [90, 'minute'], between: ['09:00', '17:00'] },
          },
        ],
      },
      { resolvers: { externals: () => [] } },
    );

    assert.deepEqual(leafProblems(expandDocument(document, createIdAllocator())), []);
  });

  it('judges the document head with core wording', () => {
    const draft = {
      ...emptyDraftDocument(),
      label: 'x'.repeat(201),
      timezone: 'Mars/Olympus',
    };
    const problems = leafProblems(draft);

    assert.ok(pathsOf(problems).includes('label'));
    assert.ok(
      problems.some(
        (problem) =>
          problem.path.join('.') === 'timezone' &&
          problem.message === timezoneProblem('Mars/Olympus'),
      ),
    );
    assert.ok(problems.every((problem) => problem.origin === 'field'));
  });

  it('reports the unfilled timezone of an empty draft', () => {
    const problems = leafProblems(emptyDraftDocument());

    assert.ok(pathsOf(problems).includes('timezone'));
    // The empty schedules list is spellable but invalid, and it should
    // surface with a path rather than wait for the document gate.
    assert.ok(pathsOf(problems).includes('schedules'));
  });

  it('judges resolver names, calendar names, dates, and windows', () => {
    const base = emptyDraftDocument();
    const draft = {
      ...base,
      timezone: 'UTC',
      resolvers: [{ id: 'r1', value: 'holiday' }],
      calendar: {
        ...base.calendar,
        holidays: { mode: 'name', name: '2026-01-01' } as const,
        businessDays: {
          mode: 'list',
          dates: [{ id: 'd1', value: '2026-02-30' }],
        } as const,
        businessHours: [{ id: 'w1', value: { start: '9:00', end: '17:00' } }],
        dateSets: [{ id: 's1', name: '', dates: [{ id: 's1d1', value: '' }] }],
      },
      schedules: base.schedules,
    };
    const problems = leafProblems(draft);
    const paths = pathsOf(problems);

    assert.ok(paths.includes('resolvers.r1'));
    assert.ok(paths.includes('calendar.holidays.name'));
    assert.ok(paths.includes('calendar.businessDays.d1'));
    assert.ok(paths.includes('calendar.businessHours.w1'));
    assert.ok(paths.includes('calendar.dateSets.s1.name'));
    assert.ok(paths.includes('calendar.dateSets.s1.s1d1'));
    assert.ok(
      problems.some(
        (problem) =>
          problem.path.join('.') === 'resolvers.r1' && problem.message === nameProblem('holiday'),
      ),
    );
  });

  it('judges schedule boundaries, axes, and annotations', () => {
    const base = emptyDraftDocument();
    const draft = {
      ...base,
      timezone: 'UTC',
      schedules: [
        {
          id: 's1',
          label: '',
          description: '',
          from: '2026-1-1 00:00',
          until: '2026-02-30 09:00',
          years: [{ id: 'y1', value: 'twenty' }],
          months: [{ id: 'm1', value: '' }],
          days: [],
          shift: null,
          if: null,
          time: { kind: 'allday' } as const,
        },
      ],
    };
    const paths = pathsOf(leafProblems(draft));

    assert.ok(paths.includes('schedules.s1.from'));
    assert.ok(paths.includes('schedules.s1.until'));
    assert.ok(paths.includes('schedules.s1.years.y1'));
    assert.ok(paths.includes('schedules.s1.months.m1'));
  });

  it('reports unchosen forms and judges atom leaves', () => {
    const base = emptyDraftDocument();
    const draft = {
      ...base,
      timezone: 'UTC',
      schedules: [
        {
          id: 's1',
          label: '',
          description: '',
          from: '',
          until: '',
          years: [],
          months: [],
          days: [
            { id: 'a1', atom: { kind: null } as const },
            { id: 'a2', atom: { kind: 'weekday', day: null } as const },
            { id: 'a3', atom: { kind: 'month-day', day: '25x' } as const },
            { id: 'a4', atom: { kind: 'name', name: 'not' } as const },
          ],
          shift: {
            direction: null,
            orSame: false,
            condition: { kind: 'ordinal-weekday', ordinal: null, day: null } as const,
          },
          if: null,
          time: { kind: null } as const,
        },
      ],
    };
    const paths = pathsOf(leafProblems(draft));

    assert.ok(paths.includes('schedules.s1.days.a1.kind'));
    assert.ok(paths.includes('schedules.s1.days.a2.day'));
    assert.ok(paths.includes('schedules.s1.days.a3.day'));
    assert.ok(paths.includes('schedules.s1.days.a4.name'));
    assert.ok(paths.includes('schedules.s1.shift.direction'));
    assert.ok(paths.includes('schedules.s1.shift.condition.ordinal'));
    assert.ok(paths.includes('schedules.s1.shift.condition.day'));
    assert.ok(paths.includes('schedules.s1.time.kind'));
  });

  it('judges the time forms', () => {
    const base = emptyDraftDocument();
    const schedule = {
      id: 's1',
      label: '',
      description: '',
      from: '',
      until: '',
      years: [],
      months: [],
      days: [],
      shift: null,
      if: null,
    };
    const emptyTimes = leafProblems({
      ...base,
      timezone: 'UTC',
      schedules: [{ ...schedule, time: { kind: 'times', times: [] } as const }],
    });
    const badGrid = leafProblems({
      ...base,
      timezone: 'UTC',
      schedules: [
        {
          ...schedule,
          time: {
            kind: 'grid',
            every: { count: '', unit: null },
            between: { kind: 'window', start: '09:00', end: '08:00' },
          } as const,
        },
      ],
    });

    assert.ok(pathsOf(emptyTimes).includes('schedules.s1.time'));
    assert.ok(pathsOf(badGrid).includes('schedules.s1.time.every.count'));
    assert.ok(pathsOf(badGrid).includes('schedules.s1.time.every.unit'));
    assert.ok(pathsOf(badGrid).includes('schedules.s1.time.between'));
  });
});
