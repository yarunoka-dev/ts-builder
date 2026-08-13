# @yarunoka/builder

[![CI](https://github.com/yarunoka-dev/ts-builder/actions/workflows/ci.yml/badge.svg)](https://github.com/yarunoka-dev/ts-builder/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/%40yarunoka%2Fbuilder)](https://www.npmjs.com/package/@yarunoka/builder)
[![License](https://img.shields.io/npm/l/%40yarunoka%2Fbuilder)](LICENSE)

Headless editing foundation for Yrnk schedule documents.

## What is this?

[Yarunoka](https://github.com/yarunoka-dev/spec) states calendar-aware
schedule rules as data — a small JSON DSL called **Yrnk** — and
[@yarunoka/core](https://github.com/yarunoka-dev/ts-core) answers
questions about them. This package is the layer between that engine and
a schedule editing UI.

It is **headless**: it renders nothing and depends on no framework. What
it provides is the editing state and the judgment calls an editor needs:

- **A draft model** that mirrors the document model of `@yarunoka/core`
  but tolerates work in progress — half-typed times, not-yet-chosen
  forms, empty fields. Any valid Yrnk document loads into a draft, and
  an unedited draft writes back the structurally identical document.
- **A store** in the external-store shape (`getState` / `subscribe` /
  `dispatch`), so a React binding is one `useSyncExternalStore` call and
  other frameworks are equally thin.
- **Derived values**: field-level and document-level validation
  aggregated from `@yarunoka/core` (`errors`), the options currently
  choosable at each decision point (`optionsAt`), the strict document
  when the draft is clean (`toYrnk`), and upcoming occurrences computed
  through the engine (`preview`).

Validation is never re-implemented here: fields are judged by core's own
validation helpers, and `toYrnk()` goes through core's `parse()` — what
this package adds is where the problems sit in the draft, not what the
rules are.

## Installation

```console
npm install @yarunoka/builder @yarunoka/core
```

`@yarunoka/core` is a peer dependency: the draft's exit and every
preview go through the one engine instance your application already has.
Distributed as ESM only.

### Runtime requirements

The same as `@yarunoka/core`: all date-time work goes through the
[Temporal API](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Temporal)
(ES2026) on the global `Temporal` object — no polyfill is shipped.

- **Node.js 26 or newer** has it built in.
- Any runtime without it needs a polyfill, installed in your
  application once:

  ```console
  npm install temporal-polyfill
  ```

  ```js
  import 'temporal-polyfill/global';
  ```

### TypeScript

Temporal is not yet part of a versioned TypeScript `lib` entry; enable it
explicitly in your `tsconfig.json` until it lands in `es2026`:

```jsonc
{
  "compilerOptions": {
    "lib": ["es2025", "esnext.temporal"]
  }
}
```

## Status

Pre-release. The public API may change until 1.0.0.

## License

[MIT](LICENSE)
