---
title: Installation
description: Installing the package with npm alongside the core engine, and the Temporal polyfill where one is needed.
sidebar:
  order: 3
---

## npm

```console
npm install @yarunoka/builder @yarunoka/core
```

`@yarunoka/core` is a peer dependency, so it is installed explicitly:
your application owns the engine version, and the builder drives that
instance. The package registers nothing, runs no install scripts, and
has no bootstrapping step.

:::caution
The 0.x releases exist to exercise the release pipeline and to track
the specification on its way to 1.0.0. They are **not intended for
use**.
:::

## The Temporal polyfill

For runtimes without the Temporal API, install a polyfill once, in
your application:

```console
npm install temporal-polyfill
```

```js
import 'temporal-polyfill/global';
```

The polyfill belongs to the application rather than to this package —
an environment that has Temporal natively should not carry one, and
only the application knows which environments it runs in.

## Verifying the installation

```js
import { createYrnkBuilder } from '@yarunoka/builder';

const builder = createYrnkBuilder();

builder.getState().timezone;   // "" — a new draft, nothing typed yet
builder.errors().length;       // > 0 — an empty draft is not a document yet
```
