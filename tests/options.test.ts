// The "what can be chosen here" derivation — the rule table mirroring
// the spec's closed sets. Unavailable options stay in the answer with a
// reason (hiding versus disabling is the UI's call), and each rule row
// is checked against core's parse in both directions: an available
// choice exports, an unavailable one is what parse rejects.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { DraftDocument, DraftSchedule } from '../src/draft.ts';
import { emptyDraftDocument } from '../src/from-yrnk.ts';
import { optionsAt } from '../src/options.ts';
import { toYrnk } from '../src/to-yrnk.ts';

function bareSchedule(): DraftSchedule {
  return {
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
    time: { kind: 'allday' },
  };
}

function draftWith(schedule: Partial<DraftSchedule>): DraftDocument {
  return {
    ...emptyDraftDocument(),
    timezone: 'UTC',
    schedules: [{ ...bareSchedule(), ...schedule }],
  };
}

function availabilityOf(
  options: readonly { value: string; available: boolean }[],
): Record<string, boolean> {
  return Object.fromEntries(options.map((option) => [option.value, option.available]));
}

describe('optionsAt day-atom-kind', () => {
  it('offers every form, with the day cycle gated on from', () => {
    const without = optionsAt(draftWith({}), { at: 'day-atom-kind', scheduleId: 's1' });
    const withFrom = optionsAt(draftWith({ from: '2026-01-01 00:00' }), {
      at: 'day-atom-kind',
      scheduleId: 's1',
    });

    assert.deepEqual(availabilityOf(without), {
      'month-day': true,
      weekday: true,
      'ordinal-weekday': true,
      'last-day-of-month': true,
      'calendar-word': true,
      name: true,
      'day-cycle': false,
    });
    assert.equal(without.find((o) => o.value === 'day-cycle')?.reason?.includes('from'), true);
    assert.equal(availabilityOf(withFrom)['day-cycle'], true);
  });

  it('agrees with parse on the day cycle rule', () => {
    const blocked = draftWith({
      days: [{ id: 'a1', atom: { kind: 'day-cycle', interval: '3' } }],
    });
    const allowed = draftWith({
      from: '2026-01-01 00:00',
      days: [{ id: 'a1', atom: { kind: 'day-cycle', interval: '3' } }],
    });

    assert.equal(toYrnk(blocked, {}).ok, false);
    assert.equal(toYrnk(allowed, {}).ok, true);
  });
});

describe('optionsAt condition-kind', () => {
  it('never offers the day cycle', () => {
    const options = optionsAt(draftWith({ from: '2026-01-01 00:00' }), {
      at: 'condition-kind',
      scheduleId: 's1',
      of: 'shift',
    });

    assert.ok(!options.some((option) => option.value === 'day-cycle'));
    assert.ok(options.every((option) => option.available));
  });
});

describe('optionsAt time-kind', () => {
  it('gates the sequence on the date axes and modifiers', () => {
    const withDays = optionsAt(
      draftWith({
        from: '2026-01-01 00:00',
        days: [{ id: 'a1', atom: { kind: 'weekday', day: 'mon' } }],
      }),
      { at: 'time-kind', scheduleId: 's1' },
    );

    assert.equal(availabilityOf(withDays).sequence, false);
    assert.match(
      withDays.find((o) => o.value === 'sequence')?.reason as string,
      /cannot be combined/,
    );
  });

  it('gates the sequence on from and frees it when both rules pass', () => {
    const withoutFrom = optionsAt(draftWith({}), { at: 'time-kind', scheduleId: 's1' });
    const clear = optionsAt(draftWith({ from: '2026-01-01 00:00' }), {
      at: 'time-kind',
      scheduleId: 's1',
    });

    assert.equal(availabilityOf(withoutFrom).sequence, false);
    assert.match(withoutFrom.find((o) => o.value === 'sequence')?.reason as string, /from/);
    assert.deepEqual(availabilityOf(clear), {
      times: true,
      grid: true,
      allday: true,
      sequence: true,
    });
  });

  it('agrees with parse on the sequence exclusivity', () => {
    const blocked = draftWith({
      from: '2026-01-01 00:00',
      days: [{ id: 'a1', atom: { kind: 'weekday', day: 'mon' } }],
      time: { kind: 'sequence', every: { count: '6', unit: 'hour' } },
    });
    const allowed = draftWith({
      from: '2026-01-01 00:00',
      time: { kind: 'sequence', every: { count: '6', unit: 'hour' } },
    });

    assert.equal(toYrnk(blocked, {}).ok, false);
    assert.equal(toYrnk(allowed, {}).ok, true);
  });
});

describe('optionsAt between-kind', () => {
  it('gates business_hour on the business_hours definition', () => {
    const without = optionsAt(draftWith({}), { at: 'between-kind', scheduleId: 's1' });
    const base = draftWith({});
    const withHours = optionsAt(
      {
        ...base,
        calendar: {
          ...base.calendar,
          businessHours: [{ id: 'w1', value: { start: '09:00', end: '17:00' } }],
        },
      },
      { at: 'between-kind', scheduleId: 's1' },
    );

    assert.deepEqual(availabilityOf(without), {
      'whole-day': true,
      window: true,
      'business-hour': false,
    });
    assert.equal(availabilityOf(withHours)['business-hour'], true);
  });

  it('agrees with parse on the business_hours requirement', () => {
    const blocked = draftWith({
      days: [{ id: 'a1', atom: { kind: 'weekday', day: 'mon' } }],
      time: {
        kind: 'grid',
        every: { count: '1', unit: 'hour' },
        between: { kind: 'business-hour' },
      },
    });

    assert.equal(toYrnk(blocked, {}).ok, false);
  });
});

describe('optionsAt calendar-word', () => {
  it('gates the definition-consulting words on the calendar', () => {
    const bare = optionsAt(draftWith({}), { at: 'calendar-word', scheduleId: 's1' });

    assert.deepEqual(availabilityOf(bare), {
      weekday: true,
      weekend: true,
      holiday: false,
      business_day: false,
      business_holiday: false,
    });
    // The reason enumerates what is missing, in core's wording.
    assert.match(
      bare.find((o) => o.value === 'business_day')?.reason as string,
      /holidays, business_holidays, business_days/,
    );
  });

  it('frees each word as its definitions arrive', () => {
    const base = draftWith({});
    const options = optionsAt(
      {
        ...base,
        calendar: {
          ...base.calendar,
          holidays: { mode: 'list', dates: [] },
          businessHolidays: { mode: 'name', name: 'externals' },
          businessDays: { mode: 'list', dates: [] },
        },
      },
      { at: 'calendar-word', scheduleId: 's1' },
    );

    assert.deepEqual(availabilityOf(options), {
      weekday: true,
      weekend: true,
      holiday: true,
      business_day: true,
      business_holiday: true,
    });
  });

  it('agrees with parse on the holiday requirement', () => {
    const blocked = draftWith({
      days: [{ id: 'a1', atom: { kind: 'calendar-word', word: 'holiday' } }],
    });
    const base = draftWith({
      days: [{ id: 'a1', atom: { kind: 'calendar-word', word: 'holiday' } }],
    });
    const allowed = {
      ...base,
      calendar: { ...base.calendar, holidays: { mode: 'list', dates: [] } as const },
    };

    assert.equal(toYrnk(blocked, {}).ok, false);
    assert.equal(toYrnk(allowed, {}).ok, true);
  });
});

describe('optionsAt name', () => {
  it('answers the union of date_sets names and declared resolver names', () => {
    const base = draftWith({});
    const options = optionsAt(
      {
        ...base,
        resolvers: [
          { id: 'r1', value: 'externals' },
          { id: 'r2', value: '' },
        ],
        calendar: {
          ...base.calendar,
          dateSets: [
            { id: 'set1', name: 'paydays', dates: [] },
            { id: 'set2', name: '', dates: [] },
            { id: 'set3', name: 'externals', dates: [] },
          ],
        },
      },
      { at: 'name', scheduleId: 's1' },
    );

    assert.deepEqual(
      options.map((option) => option.value),
      ['paydays', 'externals'],
    );
    assert.ok(options.every((option) => option.available));
  });
});

describe('optionsAt addressing', () => {
  it('throws on a missing schedule id', () => {
    assert.throws(() => optionsAt(draftWith({}), { at: 'time-kind', scheduleId: 'nope' }), /nope/);
  });
});
