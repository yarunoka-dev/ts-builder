// Entry point for `npm run docs:generate` / `npm run docs:check`.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { extractPublicSurface } from './extract.ts';
import { render } from './render.ts';

const root = path.resolve(import.meta.dirname, '..', '..');
const target = path.join(root, 'docs', 'reference.md');

const page = render(extractPublicSurface(path.join(root, 'src', 'index.ts')));

if (process.argv.includes('--check')) {
  let current: string | null = null;

  try {
    current = readFileSync(target, 'utf8');
  } catch {
    // Missing counts as stale below.
  }

  if (current !== page) {
    process.stderr.write(
      'docs/reference.md is stale — run `npm run docs:generate` and commit the result\n',
    );
    process.exit(1);
  }

  process.stdout.write('docs/reference.md is up to date\n');
} else {
  writeFileSync(target, page);
  process.stdout.write('wrote docs/reference.md\n');
}
