import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {readFileSync, existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {HANDOFF_REVISION, verifyManifest} from './verify-pack.mjs';
const root = new URL('../', import.meta.url);
test('Every MANIFEST.sha256 entry exists in the checkout', () => {
  const paths = readFileSync(new URL('MANIFEST.sha256', root), 'utf8').trim().split('\n').map(l => l.slice(66));
  assert.deepEqual(paths.filter(p => !existsSync(new URL(p, root))), []);
});
test('Pinned original handoff verifies without treating the implementation as an archive', () => {
  assert.match(execFileSync('node', ['scripts/verify-pack.mjs', '--handoff'], {cwd: root, encoding: 'utf8'}), /^PASS/);
  const current = spawnSync('node', ['scripts/verify-pack.mjs'], {cwd: root, encoding: 'utf8'});
  assert.equal(current.status, 1);
  assert.match(current.stderr, /Mismatch: package.json/);
});
test('Pinned handoff blobs match its original manifest byte for byte', t => {
  const git = args => execFileSync('git', args, {cwd: root, maxBuffer: 1 << 26});
  try { git(['rev-parse', '--git-dir']); } catch { return t.skip('not a git checkout'); }
  const original = git(['show', `${HANDOFF_REVISION}:MANIFEST.sha256`]).toString('utf8');
  assert.equal(readFileSync(new URL('MANIFEST.sha256', root), 'utf8'), original);
  const bad = original.trim().split('\n').filter(line => {
    const rel = line.slice(66);
    return createHash('sha256').update(git(['show', `${HANDOFF_REVISION}:${rel}`])).digest('hex') !== line.slice(0, 64);
  });
  assert.deepEqual(bad, []);
});
test('Integrity verification still rejects tampered, absent and malformed files', async () => {
  const digest = createHash('sha256').update('original').digest('hex');
  assert.deepEqual(await verifyManifest(`${digest}  sample.txt`, async () => Buffer.from('original')), {count: 1, errors: []});
  assert.deepEqual((await verifyManifest(`${digest}  sample.txt`, async () => Buffer.from('changed'))).errors, ['Mismatch: sample.txt']);
  assert.deepEqual((await verifyManifest(`${digest}  sample.txt`, async () => {throw new Error();})).errors, ['Missing/unreadable: sample.txt']);
  for (const manifest of ['', 'invalid', `${digest}  ../secret`, `${digest}  /secret`, `${digest}  sample.txt\n${digest}  sample.txt`]) {
    assert.ok((await verifyManifest(manifest, async () => Buffer.from('original'))).errors.length);
  }
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
test('.gitignore blocks secrets but keeps .env.example tracked', t => {
  try { execFileSync('git', ['rev-parse', '--git-dir'], {cwd: root, stdio: 'ignore'}); } catch { return t.skip('not a git checkout'); }
  const ignored = p => { try { execFileSync('git', ['check-ignore', '-q', p], {cwd: root}); return true; } catch { return false; } };
  for (const p of ['.env', 'deployment/.env', 'deployment/.env.local', 'tunnel-credentials.json', 'protected/cloudflared-credentials.json', 'cert.pem', 'rdg.key'])
    assert.equal(ignored(p), true, `${p} must be ignored`);
  for (const p of ['deployment/.env.example', 'contracts/device.schema.json', 'deployment/cloudflared.config.example.yml'])
    assert.equal(ignored(p), false, `${p} must stay trackable`);
});
