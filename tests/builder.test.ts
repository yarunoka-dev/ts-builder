// The store contract: immutable snapshots behind getState, one change
// signal behind subscribe, derived values memoized per snapshot, and
// resolver swaps that change what the derived values answer without
// changing any field.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parse } from '@yarunoka/core';
import { createYrnkBuilder } from '../src/builder.ts';
import { expandDocument } from '../src/from-yrnk.ts';
import { createIdAllocator } from '../src/ids.ts';

const WIRE = {
  version: '1.0',
  timezone: 'Asia/Tokyo',
  schedules: [{ days: [25], times: ['09:00'] }],
};

describe('createYrnkBuilder', () => {
  it('starts empty, or on the expansion of the given document', () => {
    const empty = createYrnkBuilder();
    const loaded = createYrnkBuilder({ initial: parse(WIRE) });

    assert.equal(empty.getState().timezone, '');
    assert.equal(loaded.getState().timezone, 'Asia/Tokyo');
    assert.equal(loaded.getState().schedules.length, 1);
  });

  it('notifies subscribers on dispatch and stops after unsubscribe', () => {
    const builder = createYrnkBuilder();
    let calls = 0;
    const unsubscribe = builder.subscribe(() => {
      calls++;
    });

    builder.dispatch({ type: 'document/set-label', value: 'x' });
    assert.equal(calls, 1);

    unsubscribe();
    builder.dispatch({ type: 'document/set-label', value: 'y' });
    assert.equal(calls, 1);
  });

  it('replaces the snapshot identity on every change', () => {
    const builder = createYrnkBuilder();
    const before = builder.getState();

    builder.dispatch({ type: 'document/set-timezone', value: 'UTC' });

    assert.notEqual(builder.getState(), before);
    assert.equal(before.timezone, '');
  });

  it('memoizes the exit per snapshot', () => {
    const builder = createYrnkBuilder({ initial: parse(WIRE) });

    assert.equal(builder.toYrnk(), builder.toYrnk());
    assert.equal(builder.errors(), builder.errors());

    const before = builder.toYrnk();

    builder.dispatch({ type: 'document/set-label', value: 'edited' });
    assert.notEqual(builder.toYrnk(), before);
  });

  it('answers errors, options, and previews over the current snapshot', () => {
    const builder = createYrnkBuilder({ initial: parse(WIRE) });
    const scheduleId = builder.getState().schedules[0]?.id as string;

    assert.deepEqual(builder.errors(), []);
    assert.ok(
      builder
        .optionsAt({ at: 'time-kind', scheduleId })
        .some((option) => option.value === 'times' && option.available),
    );

    const result = builder.preview({ next: 1, after: '2026-01-01T00:00:00+09:00' });

    assert.ok(result.ok);
    assert.equal(
      result.occurrences[0]?.occurrence.toString(),
      '2026-01-25T09:00:00+09:00[Asia/Tokyo]',
    );
    assert.deepEqual(result.occurrences[0]?.scheduleIds, [scheduleId]);
  });

  it('refuses a preview while the draft has problems', () => {
    const builder = createYrnkBuilder();
    const result = builder.preview({ next: 1 });

    assert.ok(!result.ok);
    assert.ok(result.problems.length > 0);
  });

  it('re-derives everything when the resolvers are swapped', () => {
    const document = parse(
      {
        version: '1.0',
        timezone: 'Asia/Tokyo',
        resolvers: ['externals'],
        schedules: [{ days: ['externals'], allday: true }],
      },
      { resolvers: { externals: () => [] } },
    );
    const builder = createYrnkBuilder({ initial: document });
    let notified = 0;

    builder.subscribe(() => {
      notified++;
    });

    // The builder holds its own resolvers, not the parse-time bindings:
    // without any set, the declared name is unbound at the exit.
    assert.equal(builder.errors().length, 1);
    assert.match(builder.errors()[0]?.message as string, /externals/);

    const before = builder.getState();

    builder.setResolvers({ externals: () => ['2026-08-11'] });

    assert.equal(notified, 1);
    assert.notEqual(builder.getState(), before);
    assert.deepEqual(builder.errors(), []);

    const result = builder.preview({
      range: { from: '2026-08-01T00:00:00+09:00', through: '2026-08-31T23:59:59+09:00' },
    });

    assert.ok(result.ok);
    assert.deepEqual(
      result.occurrences.map((entry) => entry.occurrence.toString()),
      ['2026-08-11'],
    );
  });

  it('keeps allocating unique ids after a foreign draft is replaced in', () => {
    const foreign = expandDocument(parse(WIRE), createIdAllocator());
    const builder = createYrnkBuilder();

    builder.dispatch({ type: 'document/replace', draft: foreign });
    builder.dispatch({ type: 'schedules/add' });

    const ids = builder.getState().schedules.map((schedule) => schedule.id);

    assert.equal(new Set(ids).size, ids.length);
  });
});
