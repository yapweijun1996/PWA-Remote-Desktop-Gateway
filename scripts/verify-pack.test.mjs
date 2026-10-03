import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync, existsSync} from 'node:fs';
const root = new URL('../', import.meta.url);
test('Every MANIFEST.sha256 entry exists in the checkout', () => {
  const paths = readFileSync(new URL('MANIFEST.sha256', root), 'utf8').trim().split('\n').map(l => l.slice(66));
  assert.deepEqual(paths.filter(p => !existsSync(new URL(p, root))), []);
});
test('verify-pack passes on the current tree', () => {
  assert.match(execFileSync('node', ['scripts/verify-pack.mjs'], {cwd: root, encoding: 'utf8'}), /^PASS/);
});
