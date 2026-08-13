import type {
  DraftCalendar,
  DraftDateSetPosition,
  DraftDocument,
  DraftEntry,
  DraftId,
  DraftSchedule,
  DraftTimeSpec,
} from './draft.ts';
import { expandDocument } from './from-yrnk.ts';
import type { IdAllocator } from './ids.ts';
import type { BuilderOp, DateSetTarget } from './ops.ts';

/**
 * The reducer behind dispatch: a new draft out of the previous one and
 * one op, with structural sharing everywhere the op did not reach.
 * Writing is all it does — validity is derived later, and only
 * addressing can fail here: an id that names nothing is the caller's
 * bug, and throwing is what surfaces it.
 */
export function applyOp(draft: DraftDocument, op: BuilderOp, alloc: IdAllocator): DraftDocument {
  switch (op.type) {
    case 'document/set-label':
      return { ...draft, label: op.value };
    case 'document/set-description':
      return { ...draft, description: op.value };
    case 'document/set-timezone':
      return { ...draft, timezone: op.value };
    case 'document/replace':
      return op.draft;
    case 'document/load':
      return expandDocument(op.document, alloc);

    case 'resolvers/add':
      return { ...draft, resolvers: [...draft.resolvers, { id: alloc(), value: '' }] };
    case 'resolvers/set':
      return { ...draft, resolvers: setEntry(draft.resolvers, op.id, op.name) };
    case 'resolvers/remove':
      return { ...draft, resolvers: removeEntry(draft.resolvers, op.id) };

    case 'calendar/set-date-set-mode':
      return withPosition(draft, op.target, (position) =>
        // Re-dispatching the current mode is a no-op, not a reset: a UI
        // control re-emitting its selection must not clear typed content.
        position.mode === op.mode
          ? position
          : op.mode === 'unset'
            ? { mode: 'unset' }
            : op.mode === 'list'
              ? { mode: 'list', dates: [] }
              : { mode: 'name', name: '' },
      );
    case 'calendar/set-date-set-name':
      return withPosition(draft, op.target, (position) => {
        if (position.mode !== 'name') {
          throw new Error(`The ${op.target} position is not in name mode`);
        }

        return { mode: 'name', name: op.name };
      });
    case 'calendar/add-date':
      return withPosition(draft, op.target, (position) => ({
        mode: 'list',
        dates: [...datesOf(position, op.target), { id: alloc(), value: '' }],
      }));
    case 'calendar/set-date':
      return withPosition(draft, op.target, (position) => ({
        mode: 'list',
        dates: setEntry(datesOf(position, op.target), op.id, op.date),
      }));
    case 'calendar/remove-date':
      return withPosition(draft, op.target, (position) => ({
        mode: 'list',
        dates: removeEntry(datesOf(position, op.target), op.id),
      }));

    case 'calendar/set-workweek':
      return withCalendar(draft, { workweek: op.days });
    case 'calendar/add-business-hours-window':
      return withCalendar(draft, {
        businessHours: [
          ...draft.calendar.businessHours,
          { id: alloc(), value: { start: '', end: '' } },
        ],
      });
    case 'calendar/set-business-hours-window':
      return withCalendar(draft, {
        businessHours: setEntry(draft.calendar.businessHours, op.id, {
          start: op.start,
          end: op.end,
        }),
      });
    case 'calendar/remove-business-hours-window':
      return withCalendar(draft, {
        businessHours: removeEntry(draft.calendar.businessHours, op.id),
      });

    case 'calendar/add-date-set':
      return withCalendar(draft, {
        dateSets: [...draft.calendar.dateSets, { id: alloc(), name: '', dates: [] }],
      });
    case 'calendar/rename-date-set':
      return withCalendar(draft, {
        dateSets: mapFound(draft.calendar.dateSets, op.id, (set) => ({ ...set, name: op.name })),
      });
    case 'calendar/remove-date-set':
      return withCalendar(draft, {
        dateSets: filterFound(draft.calendar.dateSets, op.id),
      });
    case 'calendar/add-date-set-date':
      return withCalendar(draft, {
        dateSets: mapFound(draft.calendar.dateSets, op.setId, (set) => ({
          ...set,
          dates: [...set.dates, { id: alloc(), value: '' }],
        })),
      });
    case 'calendar/set-date-set-date':
      return withCalendar(draft, {
        dateSets: mapFound(draft.calendar.dateSets, op.setId, (set) => ({
          ...set,
          dates: setEntry(set.dates, op.id, op.date),
        })),
      });
    case 'calendar/remove-date-set-date':
      return withCalendar(draft, {
        dateSets: mapFound(draft.calendar.dateSets, op.setId, (set) => ({
          ...set,
          dates: removeEntry(set.dates, op.id),
        })),
      });

    case 'schedules/add':
      return {
        ...draft,
        schedules: [
          ...draft.schedules,
          {
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
          },
        ],
      };
    case 'schedules/remove':
      return { ...draft, schedules: filterFound(draft.schedules, op.id) };
    case 'schedules/move': {
      const from = draft.schedules.findIndex((schedule) => schedule.id === op.id);

      if (from < 0) {
        throw missing(op.id);
      }

      const schedules = [...draft.schedules];
      const [moved] = schedules.splice(from, 1) as [DraftSchedule];

      schedules.splice(Math.max(0, Math.min(op.to, schedules.length)), 0, moved);

      return { ...draft, schedules };
    }

    case 'schedule/set-label':
      return withSchedule(draft, op.scheduleId, (schedule) => ({ ...schedule, label: op.value }));
    case 'schedule/set-description':
      return withSchedule(draft, op.scheduleId, (schedule) => ({
        ...schedule,
        description: op.value,
      }));
    case 'schedule/set-from':
      return withSchedule(draft, op.scheduleId, (schedule) => ({ ...schedule, from: op.value }));
    case 'schedule/set-until':
      return withSchedule(draft, op.scheduleId, (schedule) => ({ ...schedule, until: op.value }));

    case 'schedule/add-year':
      return withSchedule(draft, op.scheduleId, (schedule) => ({
        ...schedule,
        years: [...schedule.years, { id: alloc(), value: '' }],
      }));
    case 'schedule/set-year':
      return withSchedule(draft, op.scheduleId, (schedule) => ({
        ...schedule,
        years: setEntry(schedule.years, op.id, op.value),
      }));
    case 'schedule/remove-year':
      return withSchedule(draft, op.scheduleId, (schedule) => ({
        ...schedule,
        years: removeEntry(schedule.years, op.id),
      }));
    case 'schedule/add-month':
      return withSchedule(draft, op.scheduleId, (schedule) => ({
        ...schedule,
        months: [...schedule.months, { id: alloc(), value: '' }],
      }));
    case 'schedule/set-month':
      return withSchedule(draft, op.scheduleId, (schedule) => ({
        ...schedule,
        months: setEntry(schedule.months, op.id, op.value),
      }));
    case 'schedule/remove-month':
      return withSchedule(draft, op.scheduleId, (schedule) => ({
        ...schedule,
        months: removeEntry(schedule.months, op.id),
      }));

    case 'schedule/add-day-atom':
      return withSchedule(draft, op.scheduleId, (schedule) => ({
        ...schedule,
        days: [...schedule.days, { id: alloc(), atom: { kind: null } }],
      }));
    case 'schedule/set-day-atom':
      return withSchedule(draft, op.scheduleId, (schedule) => ({
        ...schedule,
        days: mapFound(schedule.days, op.id, (entry) => ({ ...entry, atom: op.atom })),
      }));
    case 'schedule/remove-day-atom':
      return withSchedule(draft, op.scheduleId, (schedule) => ({
        ...schedule,
        days: filterFound(schedule.days, op.id),
      }));

    case 'schedule/set-shift':
      return withSchedule(draft, op.scheduleId, (schedule) => ({ ...schedule, shift: op.shift }));
    case 'schedule/set-if':
      return withSchedule(draft, op.scheduleId, (schedule) => ({ ...schedule, if: op.if }));

    case 'schedule/set-time-kind':
      return withSchedule(draft, op.scheduleId, (schedule) => ({
        ...schedule,
        // Same no-op rule as the date-set mode: only an actual form
        // switch gets fresh content.
        time: schedule.time.kind === op.kind ? schedule.time : freshTimeSpec(op.kind),
      }));
    case 'schedule/add-time':
      return withTimes(draft, op.scheduleId, (times) => [...times, { id: alloc(), value: '' }]);
    case 'schedule/set-time':
      return withTimes(draft, op.scheduleId, (times) => setEntry(times, op.id, op.value));
    case 'schedule/remove-time':
      return withTimes(draft, op.scheduleId, (times) => removeEntry(times, op.id));
    case 'schedule/set-grid-every':
      return withSchedule(draft, op.scheduleId, (schedule) => {
        if (schedule.time.kind !== 'grid') {
          throw new Error('The time form is not the grid');
        }

        return {
          ...schedule,
          time: { ...schedule.time, every: { count: op.count, unit: op.unit } },
        };
      });
    case 'schedule/set-grid-between':
      return withSchedule(draft, op.scheduleId, (schedule) => {
        if (schedule.time.kind !== 'grid') {
          throw new Error('The time form is not the grid');
        }

        return { ...schedule, time: { ...schedule.time, between: op.between } };
      });
    case 'schedule/set-sequence-every':
      return withSchedule(draft, op.scheduleId, (schedule) => {
        if (schedule.time.kind !== 'sequence') {
          throw new Error('The time form is not the sequence');
        }

        return {
          ...schedule,
          time: { kind: 'sequence', every: { count: op.count, unit: op.unit } },
        };
      });
  }
}

function missing(id: DraftId): Error {
  return new Error(`No such draft id: ${id}`);
}

function setEntry<T>(
  entries: readonly DraftEntry<T>[],
  id: DraftId,
  value: T,
): readonly DraftEntry<T>[] {
  return mapFound(entries, id, (entry) => ({ ...entry, value }));
}

function removeEntry<T>(entries: readonly DraftEntry<T>[], id: DraftId): readonly DraftEntry<T>[] {
  return filterFound(entries, id);
}

function mapFound<T extends { readonly id: DraftId }>(
  items: readonly T[],
  id: DraftId,
  update: (item: T) => T,
): readonly T[] {
  const index = items.findIndex((item) => item.id === id);

  if (index < 0) {
    throw missing(id);
  }

  return items.map((item, at) => (at === index ? update(item) : item));
}

function filterFound<T extends { readonly id: DraftId }>(
  items: readonly T[],
  id: DraftId,
): readonly T[] {
  if (!items.some((item) => item.id === id)) {
    throw missing(id);
  }

  return items.filter((item) => item.id !== id);
}

function withCalendar(draft: DraftDocument, patch: Partial<DraftCalendar>): DraftDocument {
  return { ...draft, calendar: { ...draft.calendar, ...patch } };
}

function withPosition(
  draft: DraftDocument,
  target: DateSetTarget,
  update: (position: DraftDateSetPosition) => DraftDateSetPosition,
): DraftDocument {
  const key =
    target === 'holidays'
      ? 'holidays'
      : target === 'business-holidays'
        ? 'businessHolidays'
        : 'businessDays';

  return withCalendar(draft, { [key]: update(draft.calendar[key]) });
}

function datesOf(
  position: DraftDateSetPosition,
  target: DateSetTarget,
): readonly DraftEntry<string>[] {
  if (position.mode !== 'list') {
    throw new Error(`The ${target} position is not in list mode`);
  }

  return position.dates;
}

function withSchedule(
  draft: DraftDocument,
  scheduleId: DraftId,
  update: (schedule: DraftSchedule) => DraftSchedule,
): DraftDocument {
  return { ...draft, schedules: mapFound(draft.schedules, scheduleId, update) };
}

function withTimes(
  draft: DraftDocument,
  scheduleId: DraftId,
  update: (times: readonly DraftEntry<string>[]) => readonly DraftEntry<string>[],
): DraftDocument {
  return withSchedule(draft, scheduleId, (schedule) => {
    if (schedule.time.kind !== 'times') {
      throw new Error('The time form is not times');
    }

    return { ...schedule, time: { kind: 'times', times: update(schedule.time.times) } };
  });
}

function freshTimeSpec(kind: DraftTimeSpec['kind']): DraftTimeSpec {
  switch (kind) {
    case null:
      return { kind: null };
    case 'times':
      return { kind: 'times', times: [] };
    case 'grid':
      return { kind: 'grid', every: { count: '', unit: null }, between: { kind: 'whole-day' } };
    case 'allday':
      return { kind: 'allday' };
    case 'sequence':
      return { kind: 'sequence', every: { count: '', unit: null } };
  }
}
