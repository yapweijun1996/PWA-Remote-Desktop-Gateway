import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync, existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
const root = new URL('../', import.meta.url);
test('Every MANIFEST.sha256 entry exists in the checkout', () => {
  const paths = readFileSync(new URL('MANIFEST.sha256', root), 'utf8').trim().split('\n').map(l => l.slice(66));
  assert.deepEqual(paths.filter(p => !existsSync(new URL(p, root))), []);
});
test('verify-pack passes on the current tree', () => {
  assert.match(execFileSync('node', ['scripts/verify-pack.mjs'], {cwd: root, encoding: 'utf8'}), /^PASS/);
});
test('Committed blobs match MANIFEST.sha256 byte for byte (no line-ending rewrite)', t => {
  const git = args => execFileSync('git', args, {cwd: root, maxBuffer: 1 << 26});
  try { git(['rev-parse', '--git-dir']); } catch { return t.skip('not a git checkout'); }
  const bad = readFileSync(new URL('MANIFEST.sha256', root), 'utf8').trim().split('\n').filter(line => {
    const rel = line.slice(66);
    return createHash('sha256').update(git(['show', `:${rel}`])).digest('hex') !== line.slice(0, 64);
  });
  assert.deepEqual(bad, []);
});
test('.gitattributes pins LF and keeps CSV bytes untouched', () => {
  const attrs = readFileSync(new URL('.gitattributes', root), 'utf8');
  assert.match(attrs, /^\* .*\beol=lf\b/m);
  assert.match(attrs, /^\*\.csv -text$/m);
});
test('.gitignore covers OS and tool droppings', () => {
  const lines = readFileSync(new URL('.gitignore', root), 'utf8').split('\n');
  for (const entry of ['.DS_Store', '__pycache__/', 'node_modules/']) assert.ok(lines.includes(entry), entry);
});
test('No ignored droppings are tracked by git', t => {
  try { execFileSync('git', ['rev-parse', '--git-dir'], {cwd: root, stdio: 'ignore'}); } catch { return t.skip('not a git checkout'); }
  const tracked = execFileSync('git', ['ls-files'], {cwd: root, encoding: 'utf8'}).split('\n');
  assert.deepEqual(tracked.filter(f => /(^|\/)\.DS_Store$|__pycache__\/|(^|\/)node_modules\//.test(f)), []);
});
