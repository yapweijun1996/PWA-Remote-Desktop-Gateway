import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFile, unlink} from 'node:fs/promises';
import {createHash, randomBytes} from 'node:crypto';
import {writeArtifact} from './atomic-artifact.mjs';

const root = new URL('../', import.meta.url);
test('Artifact CLI refuses empty, tampered and unsafe ledgers without claiming verification', async () => {
  const relative = `qa/implementation/ledger-test-${randomBytes(8).toString('hex')}.json`;
  const target = new URL(relative, root);
  const digest = createHash('sha256').update(await readFile(new URL('README.md', root))).digest('hex');
  const group = {'README.md': digest};
  const cases = [
    {sources: {}, outputs: group, evidence: group},
    {sources: group, outputs: [], evidence: group},
    {sources: {'README.md': '0'.repeat(64)}, outputs: group, evidence: group},
    {sources: {'../README.md': digest}, outputs: group, evidence: group}
  ];
  try {
    for (const ledger of cases) {
      await writeArtifact(target.pathname, JSON.stringify(ledger));
      const result = spawnSync(process.execPath, ['scripts/verify-artifacts.mjs', relative], {cwd: root, encoding: 'utf8'});
      assert.equal(result.status, 1);
      assert.doesNotMatch(result.stdout, /^Verified/);
      assert.match(result.stderr, /Empty or invalid artifact group|Artifact digest mismatch|Invalid artifact ledger/);
    }
  } finally { await unlink(target).catch(error => {if (error.code !== 'ENOENT') throw error;}); }
});
