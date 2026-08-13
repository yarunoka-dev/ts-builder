---
title: "@yarunoka/builder"
description: The headless editing foundation for Yrnk schedule documents — draft state, aggregated validation, options, and previews for a schedule editor.
sidebar:
  order: 1
---

`@yarunoka/builder` is the layer between
[`@yarunoka/core`](https://github.com/yarunoka-dev/ts-core) — the
TypeScript engine of **Yrnk**, the JSON DSL for calendar-aware
schedules — and a schedule editing UI. It holds the editing state and
the judgment calls an editor needs, and it renders nothing: no
components, no framework dependency.

The language itself — what a document may say and what it means — is
defined in the [spec repository](https://github.com/yarunoka-dev/spec/tree/1.0),
and the engine has documentation of its own. This documentation is
about the builder package only.

- **Guides** — what the package needs, how to install it, and how to
  drive the store from a UI
- **Reference** — the public functions and types, generated from the
  source
