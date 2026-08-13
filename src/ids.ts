import type { DraftDocument } from './draft.ts';

/**
 * Draft id allocation. Ids only need to be unique within one builder's
 * draft, so a counter with a fixed prefix is enough — and deterministic,
 * which keeps tests and snapshots stable.
 */
export type IdAllocator = () => string;

const PREFIX = 'd';
const NUMBERED = /^d(\d+)$/;

export function createIdAllocator(): IdAllocator {
  let next = 1;

  return () => `${PREFIX}${next++}`;
}

/**
 * An allocator that never collides with the ids a given draft already
 * carries. A replaced draft can come from elsewhere (another builder,
 * a persisted snapshot), so the counter restarts past the highest
 * numbered id found rather than trusting this builder's own history.
 */
export function createIdAllocatorAfter(draft: DraftDocument): IdAllocator {
  let highest = 0;

  for (const id of idsOf(draft)) {
    const numbered = NUMBERED.exec(id);

    if (numbered !== null) {
      highest = Math.max(highest, Number(numbered[1]));
    }
  }

  let next = highest + 1;

  return () => `${PREFIX}${next++}`;
}

function* idsOf(draft: DraftDocument): Generator<string> {
  for (const entry of draft.resolvers) {
    yield entry.id;
  }

  for (const position of [
    draft.calendar.holidays,
    draft.calendar.businessHolidays,
    draft.calendar.businessDays,
  ]) {
    if (position.mode === 'list') {
      for (const entry of position.dates) {
        yield entry.id;
      }
    }
  }

  for (const entry of draft.calendar.businessHours) {
    yield entry.id;
  }

  for (const set of draft.calendar.dateSets) {
    yield set.id;

    for (const entry of set.dates) {
      yield entry.id;
    }
  }

  for (const schedule of draft.schedules) {
    yield schedule.id;

    for (const entry of [...schedule.years, ...schedule.months]) {
      yield entry.id;
    }

    for (const entry of schedule.days) {
      yield entry.id;
    }

    if (schedule.time.kind === 'times') {
      for (const entry of schedule.time.times) {
        yield entry.id;
      }
    }
  }
}
