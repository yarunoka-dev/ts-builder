// The package entry point: the runtime surface is the one factory —
// everything else this package exports is types.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as api from '../src/index.ts';

describe('the package entry point', () => {
  it('exports exactly the factory at runtime', () => {
    assert.deepEqual(Object.keys(api).sort(), ['createYrnkBuilder']);
    assert.equal(typeof api.createYrnkBuilder, 'function');
  });
});
