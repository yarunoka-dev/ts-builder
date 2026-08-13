---
title: Usage
description: Creating the store, editing through ops, rendering the errors and options, and previewing occurrences.
sidebar:
  order: 4
---

The package provides one stateful object — a **store** holding a
**draft**: the document model of `@yarunoka/core` loosened to tolerate
work in progress. A UI dispatches **ops** against the store, and
renders the draft together with the **derived values**: the aggregated
validation, the options at each decision point, the strict document,
and upcoming occurrences.

## Creating the store

```ts
import { createYrnkBuilder } from '@yarunoka/builder';

const builder = createYrnkBuilder();    // an empty new draft
```

To edit an existing document, parse it with the engine and hand it
over:

```ts
import { parse } from '@yarunoka/core';

const builder = createYrnkBuilder({
  initial: parse(json),
  resolvers: {
    'company-holidays': ({ from, through }) =>
      holidayRepository.between(from.toString(), through.toString()),
  },
});
```

Any valid Yrnk document loads into a draft, and an unedited draft
writes back the structurally identical document. The resolver bindings
are the engine's own contract — see the core documentation — and can
be swapped later with `setResolvers`.

## The external-store shape

`getState` answers the current draft — an immutable snapshot whose
identity changes exactly when the draft changes — and `subscribe`
registers a change listener. That pair is the external-store contract,
so a React binding is one call inside a hook:

```ts
import { useSyncExternalStore } from 'react';
import type { DraftDocument, YrnkBuilder } from '@yarunoka/builder';

function useDraft(builder: YrnkBuilder): DraftDocument {
  return useSyncExternalStore(builder.subscribe, builder.getState);
}
```

Other frameworks are equally thin: re-read `getState` (and the derived
values) whenever the subscription fires.

## Editing through ops

Every edit is one dispatched op from a closed set — the reference
lists them all. An op writes the draft and nothing else: no
validation, no refusal. The draft accepts whatever was typed, and
validity is derived afterwards — that is what lets an editor hold
half-typed times and not-yet-chosen forms without fighting its own
state.

```ts
builder.dispatch({ type: 'document/set-timezone', value: 'Asia/Tokyo' });
builder.dispatch({ type: 'schedules/add' });

const { id: scheduleId } = builder.getState().schedules[0];

// Every two hours on weekdays
builder.dispatch({ type: 'schedule/add-day-atom', scheduleId });
builder.dispatch({
  type: 'schedule/set-day-atom',
  scheduleId,
  id: builder.getState().schedules[0].days[0].id,
  atom: { kind: 'calendar-word', word: 'weekday' },
});
builder.dispatch({ type: 'schedule/set-time-kind', scheduleId, kind: 'grid' });
builder.dispatch({ type: 'schedule/set-grid-every', scheduleId, count: '2', unit: 'hour' });
```

List elements are addressed by **draft ids** — opaque strings the
draft allocates, stable across edits around them. A UI rarely reads
them back like the linear code above does: it renders the lists, so
each rendered row already holds the id it dispatches with.

## Rendering the errors

`errors()` aggregates field-level and document-level validation over
the current draft:

```ts
for (const problem of builder.errors()) {
  problem.path;      // e.g. ['schedules', 's1', 'from'] — field names and draft ids
  problem.message;   // wording from @yarunoka/core wherever core has the rule
  problem.origin;    // 'field' | 'document'
}
```

A field problem is a core validation helper's answer placed at its
draft path. Document problems are core's `parse()` rejecting the
whole, and appear only once every field is individually clean.
Validation is never re-implemented in this package — what it adds is
where a problem sits in the draft, not what the rules are.

## Offering the options

`optionsAt` answers "what can be chosen here" for the closed sets: the
day atom forms, the shift and if condition forms, the time forms, the
grid's between forms, the calendar words, and the names in scope.

```ts
const options = builder.optionsAt({ at: 'time-kind', scheduleId });

for (const option of options) {
  option.value;       // e.g. 'sequence'
  option.available;   // false when the draft rules it out here
  option.reason;      // why not, when available is false
}
```

Unavailable options are answered rather than dropped — whether to hide
or to disable is the UI's decision.

## The exit

`toYrnk()` answers the strict document when the draft is clean:

```ts
const result = builder.toYrnk();

if (result.ok) {
  result.document;               // the parsed model, ready for the engine's queries
  JSON.stringify(result.raw);    // the document text for the wire
} else {
  result.problems;               // the same problems errors() reports
}
```

## Previewing occurrences

`preview` computes upcoming occurrences through the engine — the next
N after an instant, or every occurrence in an explicit range:

```ts
const result = builder.preview({ next: 5 });

if (result.ok) {
  for (const line of result.occurrences) {
    line.occurrence;    // Temporal.ZonedDateTime or Temporal.PlainDate, as core answers
    line.scheduleIds;   // which draft schedules produced it
  }

  result.exhausted;     // true when the horizon ended a "next N" search short of N
}
```

A preview needs a clean draft, exactly like the exit — the problems
come back otherwise, so a preview pane and an error pane are two
renderings of the same state.
