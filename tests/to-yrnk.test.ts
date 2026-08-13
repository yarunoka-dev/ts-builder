// The draft's exit: leaf problems block it, a leaf-clean draft is
// written back to the wire shape and put through core's parse — the
// final gate — and an unedited expansion of a valid document writes
// back the structurally identical document (the round-trip guarantee).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { build, parse } from '@yarunoka/core';
import type { DraftDocument } from '../src/draft.ts';
import { emptyDraftDocument, expandDocument } from '../src/from-yrnk.ts';
import { createIdAllocator } from '../src/ids.ts';
import { draftProblems, toYrnk } from '../src/to-yrnk.ts';

const FULL_WIRE = {
  label: 'Payroll',
  description: 'Company payroll calendar',
  version: '1.0',
  timezone: 'Asia/Tokyo',
  resolvers: ['externals'],
  calendar: {
    holidays: ['2026-01-01', '2026-05-05'],
    business_holidays: 'externals',
    business_days: [],
    workweek: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'],
    business_hours: [
      ['09:00', '12:00'],
      ['13:00', '17:30'],
    ],
    date_sets: { paydays: ['2026-04-25', '2026-05-25'] },
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
      from: '2026-01-01 00:00',
      days: [['every', 10, 'day']],
      times: { every: [90, 'minute'], between: ['09:00', '17:00'] },
    },
    {
      days: ['weekday'],
      times: { every: [1, 'hour'], between: 'business_hour' },
    },
    { days: ['sun'], allday: true },
    { from: '2026-01-01 00:00', every: [6, 'hour'] },
  ],
};

const RESOLVERS = { externals: () => ['2026-08-11'] };

function minimalDraft(): DraftDocument {
  return {
    ...emptyDraftDocument(),
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
        days: [{ id: 'a1', atom: { kind: 'weekday', day: 'mon' } }],
        shift: null,
        if: null,
        time: { kind: 'allday' },
      },
    ],
  };
}

describe('toYrnk', () => {
  it('writes an unedited expansion back to the structurally identical document', () => {
    const document = parse(FULL_WIRE, { resolvers: RESOLVERS });
    const draft = expandDocument(document, createIdAllocator());
    const result = toYrnk(draft, RESOLVERS);

    assert.ok(result.ok);
    assert.deepEqual(result.raw, build(document));
  });

  it('maps the empty spellings to omitted keys', () => {
    const result = toYrnk(minimalDraft(), {});

    assert.ok(result.ok);
    assert.deepEqual(result.raw, {
      version: '1.0',
      timezone: 'UTC',
      schedules: [{ days: ['mon'], allday: true }],
    });
  });

  it('normalizes non-canonical integer input on the way out', () => {
    const draft = minimalDraft();
    const edited = {
      ...draft,
      schedules: [
        {
          ...(draft.schedules[0] as DraftDocument['schedules'][number]),
          days: [{ id: 'a1', atom: { kind: 'month-day', day: '07' } as const }],
        },
      ],
    };
    const result = toYrnk(edited, {});

    assert.ok(result.ok);
    assert.deepEqual((result.raw.schedules as unknown[])[0], { days: [7], allday: true });
  });

  it('refuses a draft with field problems and reports them', () => {
    const result = toYrnk(emptyDraftDocument(), {});

    assert.ok(!result.ok);
    assert.ok(result.problems.length > 0);
    assert.ok(result.problems.every((problem) => problem.origin === 'field'));
  });

  it('reports what only the whole document can reveal as a document problem', () => {
    const draft = minimalDraft();
    // Leaf-clean: every field is individually fine, but the day cycle
    // requires from, which no single field knows.
    const edited = {
      ...draft,
      schedules: [
        {
          ...(draft.schedules[0] as DraftDocument['schedules'][number]),
          days: [{ id: 'a1', atom: { kind: 'day-cycle', interval: '3' } as const }],
        },
      ],
    };
    const result = toYrnk(edited, {});

    assert.ok(!result.ok);
    assert.equal(result.problems.length, 1);
    assert.deepEqual(result.problems[0]?.path, []);
    assert.equal(result.problems[0]?.origin, 'document');
    assert.match(result.problems[0]?.message as string, /requires from/);
  });

  it('needs the declared resolvers bound at the exit', () => {
    const base = minimalDraft();
    const draft = { ...base, resolvers: [{ id: 'r1', value: 'externals' }] };
    const unbound = toYrnk(draft, {});
    const bound = toYrnk(draft, RESOLVERS);

    assert.ok(!unbound.ok);
    assert.match(unbound.problems[0]?.message as string, /externals/);
    assert.ok(bound.ok);
  });
});

describe('draftProblems', () => {
  it('answers field problems while any exist, the document gate after', () => {
    const empty = draftProblems(emptyDraftDocument(), {});

    assert.ok(empty.length > 0);
    assert.ok(empty.every((problem) => problem.origin === 'field'));

    const clean = draftProblems(minimalDraft(), {});

    assert.deepEqual(clean, []);
  });
});
