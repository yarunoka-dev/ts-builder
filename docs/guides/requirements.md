---
title: Requirements
description: The runtimes the package supports, and its one dependency — the core engine as a peer.
sidebar:
  order: 2
---

## Runtime

The same as `@yarunoka/core`: all date-time work happens through the
[Temporal API](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Temporal)
(ES2026) on the global `Temporal` object, and no polyfill is shipped.

- **Node.js 26 or newer** has Temporal built in.
- **Browsers**: Firefox, Chrome, and Edge ship Temporal natively. For
  runtimes without it (Safari stable, older Node.js), your application
  installs a polyfill once — see
  [Installation](installation#the-temporal-polyfill).

## Module format

**ESM only.** Browsers load ESM natively, and Node.js 22 and newer can
`require()` a synchronous ESM module graph — one free of top-level
`await`, which this package is — from CommonJS code, so CommonJS
applications on the supported Node.js versions are not excluded.

## Dependencies

**One peer dependency: `@yarunoka/core`.** The draft's exit and every
preview go through the engine, and making it a peer means they go
through the one engine instance your application already has — never a
second copy with its own idea of the language.

Nothing else: no framework, no UI library, no runtime dependency of
its own. The store is framework-agnostic on purpose — a React binding
is one `useSyncExternalStore` call, and other frameworks are equally
thin.

## TypeScript

TypeScript is optional — the package is plain ESM and works from
JavaScript as it is. For TypeScript users: Temporal is not yet part of
a versioned `lib` entry, so enable it explicitly in your
`tsconfig.json` until it lands in `es2026`:

```jsonc
{
  "compilerOptions": {
    "lib": ["es2025", "esnext.temporal"]
  }
}
```
