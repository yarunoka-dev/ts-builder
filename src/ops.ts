import type { YrnkDayName, YrnkDocument, YrnkTimeUnit } from '@yarunoka/core';
import type {
  DraftBetween,
  DraftDayAtom,
  DraftDocument,
  DraftId,
  DraftIf,
  DraftShift,
  DraftTimeSpec,
} from './draft.ts';

/**
 * The closed set of editing operations. An op writes the draft and
 * nothing else — no validation, no refusal: the draft accepts what was
 * typed, validity is derived afterwards (errors / optionsAt), and
 * "don't offer that" is the UI's move, informed by optionsAt. Two
 * classes of caller bug throw instead of writing: addressing an id
 * that does not exist, and aiming a form-specific op at another form
 * (a date-list op at a position not in list mode, a times / grid /
 * sequence op at another time form).
 *
 * Granularity: lists whose elements carry ids get element-level ops
 * (add / set / remove); small sum-typed values (an atom, shift, if,
 * between) are set whole — the UI builds the value, the op places it.
 */
export type BuilderOp =
  // document
  | { readonly type: 'document/set-label'; readonly value: string }
  | { readonly type: 'document/set-description'; readonly value: string }
  | { readonly type: 'document/set-timezone'; readonly value: string }
  // bulk
  | { readonly type: 'document/replace'; readonly draft: DraftDocument }
  | { readonly type: 'document/load'; readonly document: YrnkDocument }
  // resolvers
  | { readonly type: 'resolvers/add' }
  | { readonly type: 'resolvers/set'; readonly id: DraftId; readonly name: string }
  | { readonly type: 'resolvers/remove'; readonly id: DraftId }
  // calendar — the three built-in date-list positions
  | {
      readonly type: 'calendar/set-date-set-mode';
      readonly target: DateSetTarget;
      readonly mode: 'unset' | 'list' | 'name';
    }
  | {
      readonly type: 'calendar/set-date-set-name';
      readonly target: DateSetTarget;
      readonly name: string;
    }
  | { readonly type: 'calendar/add-date'; readonly target: DateSetTarget }
  | {
      readonly type: 'calendar/set-date';
      readonly target: DateSetTarget;
      readonly id: DraftId;
      readonly date: string;
    }
  | { readonly type: 'calendar/remove-date'; readonly target: DateSetTarget; readonly id: DraftId }
  // calendar — workweek and business hours
  | { readonly type: 'calendar/set-workweek'; readonly days: readonly YrnkDayName[] }
  | { readonly type: 'calendar/add-business-hours-window' }
  | {
      readonly type: 'calendar/set-business-hours-window';
      readonly id: DraftId;
      readonly start: string;
      readonly end: string;
    }
  | { readonly type: 'calendar/remove-business-hours-window'; readonly id: DraftId }
  // calendar — the date_sets namespace
  | { readonly type: 'calendar/add-date-set' }
  | { readonly type: 'calendar/rename-date-set'; readonly id: DraftId; readonly name: string }
  | { readonly type: 'calendar/remove-date-set'; readonly id: DraftId }
  | { readonly type: 'calendar/add-date-set-date'; readonly setId: DraftId }
  | {
      readonly type: 'calendar/set-date-set-date';
      readonly setId: DraftId;
      readonly id: DraftId;
      readonly date: string;
    }
  | {
      readonly type: 'calendar/remove-date-set-date';
      readonly setId: DraftId;
      readonly id: DraftId;
    }
  // schedules list
  | { readonly type: 'schedules/add' }
  | { readonly type: 'schedules/remove'; readonly id: DraftId }
  | { readonly type: 'schedules/move'; readonly id: DraftId; readonly to: number }
  // one schedule
  | { readonly type: 'schedule/set-label'; readonly scheduleId: DraftId; readonly value: string }
  | {
      readonly type: 'schedule/set-description';
      readonly scheduleId: DraftId;
      readonly value: string;
    }
  | { readonly type: 'schedule/set-from'; readonly scheduleId: DraftId; readonly value: string }
  | { readonly type: 'schedule/set-until'; readonly scheduleId: DraftId; readonly value: string }
  | { readonly type: 'schedule/add-year'; readonly scheduleId: DraftId }
  | {
      readonly type: 'schedule/set-year';
      readonly scheduleId: DraftId;
      readonly id: DraftId;
      readonly value: string;
    }
  | { readonly type: 'schedule/remove-year'; readonly scheduleId: DraftId; readonly id: DraftId }
  | { readonly type: 'schedule/add-month'; readonly scheduleId: DraftId }
  | {
      readonly type: 'schedule/set-month';
      readonly scheduleId: DraftId;
      readonly id: DraftId;
      readonly value: string;
    }
  | { readonly type: 'schedule/remove-month'; readonly scheduleId: DraftId; readonly id: DraftId }
  | { readonly type: 'schedule/add-day-atom'; readonly scheduleId: DraftId }
  | {
      readonly type: 'schedule/set-day-atom';
      readonly scheduleId: DraftId;
      readonly id: DraftId;
      readonly atom: DraftDayAtom;
    }
  | {
      readonly type: 'schedule/remove-day-atom';
      readonly scheduleId: DraftId;
      readonly id: DraftId;
    }
  | {
      readonly type: 'schedule/set-shift';
      readonly scheduleId: DraftId;
      readonly shift: DraftShift | null;
    }
  | { readonly type: 'schedule/set-if'; readonly scheduleId: DraftId; readonly if: DraftIf | null }
  | {
      readonly type: 'schedule/set-time-kind';
      readonly scheduleId: DraftId;
      readonly kind: DraftTimeSpec['kind'];
    }
  | { readonly type: 'schedule/add-time'; readonly scheduleId: DraftId }
  | {
      readonly type: 'schedule/set-time';
      readonly scheduleId: DraftId;
      readonly id: DraftId;
      readonly value: string;
    }
  | { readonly type: 'schedule/remove-time'; readonly scheduleId: DraftId; readonly id: DraftId }
  | {
      readonly type: 'schedule/set-grid-every';
      readonly scheduleId: DraftId;
      readonly count: string;
      readonly unit: YrnkTimeUnit | null;
    }
  | {
      readonly type: 'schedule/set-grid-between';
      readonly scheduleId: DraftId;
      readonly between: DraftBetween;
    }
  | {
      readonly type: 'schedule/set-sequence-every';
      readonly scheduleId: DraftId;
      readonly count: string;
      readonly unit: YrnkTimeUnit | null;
    };

/** Which built-in date-list position of the calendar an op addresses. */
export type DateSetTarget = 'holidays' | 'business-holidays' | 'business-days';
