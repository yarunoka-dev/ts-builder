// The preview computation over core's occurrencesIn: the per-schedule
// answers merged into one ascending union that remembers which draft
// schedules produced each occurrence, the "next N" search that widens
// its window until it has enough, and the horizon that cuts the search
// off with an honest exhausted flag.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parse } from '@yarunoka/core';
import { preview } from '../src/preview.ts';

const AFTER = '2026-01-01T00:00:00+09:00';

function parsed(schedules: unknown[], calendar?: unknown): ReturnType<typeof parse> {
  return parse({
    version: '1.0',
    timezone: 'Asia/Tokyo',
    ...(calendar !== undefined ? { calendar } : {}),
    schedules,
  });
}

describe('preview range', () => {
  it('merges the schedules into one ascending union with source ids', () => {
    const document = parsed([
      { days: ['mon'], allday: true },
      { days: ['mon', 'tue'], allday: true },
    ]);
    const result = preview(document, ['s-a', 's-b'], {
      range: { from: '2026-01-05T00:00:00+09:00', through: '2026-01-06T23:59:59+09:00' },
    });

    // 2026-01-05 is a Monday: both schedules produce it, merged into
    // one occurrence carrying both ids.
    assert.equal(result.exhausted, false);
    assert.deepEqual(
      result.occurrences.map((entry) => [entry.occurrence.toString(), [...entry.scheduleIds]]),
      [
        ['2026-01-05', ['s-a', 's-b']],
        ['2026-01-06', ['s-b']],
      ],
    );
  });

  it('keeps an all-day occurrence and a timed point at its midnight distinct', () => {
    const document = parsed([
      { days: ['mon'], allday: true },
      { days: ['mon'], times: ['00:00'] },
    ]);
    const result = preview(document, ['s-day', 's-point'], {
      range: { from: '2026-01-05T00:00:00+09:00', through: '2026-01-05T23:59:59+09:00' },
    });

    assert.equal(result.occurrences.length, 2);
    // The all-day occurrence precedes the timed point at the same instant.
    assert.deepEqual(
      result.occurrences.map((entry) => [...entry.scheduleIds]),
      [['s-day'], ['s-point']],
    );
  });
});

describe('preview next', () => {
  it('answers the next N occurrences after the given instant', () => {
    const document = parsed([{ days: [25], times: ['09:00'] }]);
    const result = preview(document, ['s1'], { next: 3, after: AFTER });

    assert.equal(result.exhausted, false);
    assert.deepEqual(
      result.occurrences.map((entry) => entry.occurrence.toString()),
      [
        '2026-01-25T09:00:00+09:00[Asia/Tokyo]',
        '2026-02-25T09:00:00+09:00[Asia/Tokyo]',
        '2026-03-25T09:00:00+09:00[Asia/Tokyo]',
      ],
    );
  });

  it('widens the window far enough for sparse schedules', () => {
    // Once a year: the third occurrence is over two years out, well
    // past any initial window.
    const document = parsed([{ months: [2], days: [29], allday: true }]);
    const result = preview(document, ['s1'], { next: 2, after: AFTER });

    assert.deepEqual(
      result.occurrences.map((entry) => entry.occurrence.toString()),
      ['2028-02-29', '2032-02-29'],
    );
    assert.equal(result.exhausted, false);
  });

  it('reports exhaustion when the horizon ends the search short', () => {
    const document = parsed([{ months: [2], days: [29], allday: true }]);
    const result = preview(document, ['s1'], {
      next: 5,
      after: AFTER,
      horizon: Temporal.Duration.from({ years: 3 }),
    });

    assert.deepEqual(
      result.occurrences.map((entry) => entry.occurrence.toString()),
      ['2028-02-29'],
    );
    assert.equal(result.exhausted, true);
  });

  it('stops early when a bounded schedule runs out', () => {
    const document = parsed([
      {
        from: '2026-01-01 00:00',
        until: '2026-03-01 00:00',
        days: [25],
        times: ['09:00'],
      },
    ]);
    const result = preview(document, ['s1'], { next: 5, after: AFTER });

    assert.equal(result.occurrences.length, 2);
    assert.equal(result.exhausted, true);
  });

  it('answers nothing for a non-positive count', () => {
    const document = parsed([{ days: [25], times: ['09:00'] }]);
    const result = preview(document, ['s1'], { next: 0, after: AFTER });

    assert.deepEqual(result.occurrences, []);
    assert.equal(result.exhausted, false);
  });
});
