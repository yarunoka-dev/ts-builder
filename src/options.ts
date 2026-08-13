import type { DraftDocument, DraftId, DraftSchedule } from './draft.ts';

/**
 * A decision point the UI can ask about. Every context is addressed
 * through a schedule: the questions are asked while editing one, and
 * the answers that depend on the document (the calendar, the names)
 * read it through the draft as a whole.
 */
export type OptionContext =
  | { readonly at: 'day-atom-kind'; readonly scheduleId: DraftId }
  | { readonly at: 'condition-kind'; readonly scheduleId: DraftId; readonly of: 'shift' | 'if' }
  | { readonly at: 'time-kind'; readonly scheduleId: DraftId }
  | { readonly at: 'between-kind'; readonly scheduleId: DraftId }
  | { readonly at: 'calendar-word'; readonly scheduleId: DraftId }
  | { readonly at: 'name'; readonly scheduleId: DraftId };

/**
 * What a decision point offers: every value of its closed set, each
 * marked available or not. Unavailable options are answered rather
 * than dropped — whether to hide or to disable is the UI's decision.
 */
export type Options = readonly {
  readonly value: string;
  readonly available: boolean;
  /** Why not, when available is false */
  readonly reason?: string;
}[];

/**
 * The rule table behind "what can be chosen here" — the spec's closed
 * sets written down with their availability conditions. This is not a
 * re-implementation of validation: the deciding is still core's parse
 * at the exit; the table only projects the same closed sets onto the
 * draft so the UI can steer before the exit is tried. Unavailable
 * options are answered rather than dropped — whether to hide or to
 * disable is the UI's decision. Agreement with parse is pinned by
 * tests that try each rule row against the real exit.
 */
export function optionsAt(draft: DraftDocument, context: OptionContext): Options {
  const schedule = scheduleOf(draft, context.scheduleId);

  switch (context.at) {
    case 'day-atom-kind':
      return [...conditionKinds(), dayCycleOption(schedule)];
    case 'condition-kind':
      return conditionKinds();
    case 'time-kind':
      return timeKinds(schedule);
    case 'between-kind':
      return betweenKinds(draft);
    case 'calendar-word':
      return calendarWords(draft);
    case 'name':
      return names(draft);
  }
}

function scheduleOf(draft: DraftDocument, id: DraftId): DraftSchedule {
  const schedule = draft.schedules.find((candidate) => candidate.id === id);

  if (schedule === undefined) {
    throw new Error(`No such draft id: ${id}`);
  }

  return schedule;
}

function available(value: string): { value: string; available: true } {
  return { value, available: true };
}

function blocked(value: string, reason: string): Options[number] {
  return { value, available: false, reason };
}

function conditionKinds(): Options[number][] {
  return [
    available('month-day'),
    available('weekday'),
    available('ordinal-weekday'),
    available('last-day-of-month'),
    available('calendar-word'),
    available('name'),
  ];
}

function dayCycleOption(schedule: DraftSchedule): Options[number] {
  return schedule.from === ''
    ? blocked(
        'day-cycle',
        'A day cycle requires from (there is no way to start counting without it)',
      )
    : available('day-cycle');
}

function timeKinds(schedule: DraftSchedule): Options {
  const combined =
    schedule.years.length > 0 ||
    schedule.months.length > 0 ||
    schedule.days.length > 0 ||
    schedule.shift !== null ||
    schedule.if !== null;
  const sequence = combined
    ? blocked(
        'sequence',
        'The interval every cannot be combined with years / months / days / shift / if',
      )
    : schedule.from === ''
      ? blocked(
          'sequence',
          'The interval every requires from (there is no way to start counting without it)',
        )
      : available('sequence');

  return [available('times'), available('grid'), available('allday'), sequence];
}

function betweenKinds(draft: DraftDocument): Options {
  return [
    available('whole-day'),
    available('window'),
    draft.calendar.businessHours.length > 0
      ? available('business-hour')
      : blocked('business-hour', 'Using business_hour requires the business_hours definition'),
  ];
}

function calendarWords(draft: DraftDocument): Options {
  const defined = {
    holidays: draft.calendar.holidays.mode !== 'unset',
    business_holidays: draft.calendar.businessHolidays.mode !== 'unset',
    business_days: draft.calendar.businessDays.mode !== 'unset',
  };
  const wordOption = (word: string, required: readonly (keyof typeof defined)[]) => {
    const missing = required.filter((key) => !defined[key]);

    return missing.length === 0
      ? available(word)
      : blocked(
          word,
          `Using ${word} requires the ${missing.join(
            ', ',
          )} definition (write an empty list if there are no such days)`,
        );
  };

  return [
    available('weekday'),
    available('weekend'),
    wordOption('holiday', ['holidays']),
    wordOption('business_day', ['holidays', 'business_holidays', 'business_days']),
    wordOption('business_holiday', ['holidays', 'business_holidays', 'business_days']),
  ];
}

/**
 * The names a day expression can refer to: the document's own date_sets
 * entries and the names it declares under resolvers — one namespace,
 * answered in that order. Entries still unnamed mid-edit are skipped,
 * and a name defined and declared at once (invalid, parse rejects it)
 * is answered once.
 */
function names(draft: DraftDocument): Options {
  const seen = new Set<string>();
  const options: Options[number][] = [];
  const offer = (name: string): void => {
    if (name !== '' && !seen.has(name)) {
      seen.add(name);
      options.push(available(name));
    }
  };

  for (const set of draft.calendar.dateSets) {
    offer(set.name);
  }

  for (const entry of draft.resolvers) {
    offer(entry.value);
  }

  return options;
}
