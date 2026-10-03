/** Verify the untouched handoff; implementation assets have a separate ledger. */
import {readFile} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {fileURLToPath, pathToFileURL} from 'node:url';
import path from 'node:path';

export const HANDOFF_REVISION = '96bc1331015ff5c8e3aae6049e35f10ee3c812d1';
const root = fileURLToPath(new URL('../', import.meta.url));
const git = promisify(execFile);

export async function verifyManifest(manifest, readSource) {
  const errors = [], paths = new Set();
  let count = 0;
  for (const line of manifest.trim().split('\n')) {
    const match = /^([0-9a-f]{64})  (.+)$/.exec(line);
    if (!match) { errors.push('Malformed manifest entry'); continue; }
    const [, expected, relative] = match;
    if (path.isAbsolute(relative) || relative.split(/[\\/]/).some(part => part === '..')
        || relative.includes('\0') || paths.has(relative)) {
      errors.push('Unsafe or duplicate manifest path'); continue;
    }
    paths.add(relative);
    try {
      const actual = createHash('sha256').update(await readSource(relative)).digest('hex');
      if (actual !== expected) errors.push(`Mismatch: ${relative}`);
      else count++;
    } catch { errors.push(`Missing/unreadable: ${relative}`); }
  }
  return {count, errors};
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== '--handoff'))
    throw new Error('Use --handoff to verify the pinned original revision');
  const archived = args[0] === '--handoff';
  const readSource = archived
    ? async relative => (await git('git', ['show', `${HANDOFF_REVISION}:${relative}`],
      {cwd: root, encoding: 'buffer', maxBuffer: 32 * 1024 * 1024})).stdout
    : relative => readFile(path.join(root, relative));
  const manifest = (await readSource('MANIFEST.sha256')).toString('utf8');
  const {count, errors} = await verifyManifest(manifest, readSource);
  if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; return; }
  const scope = archived ? `pinned handoff ${HANDOFF_REVISION}` : 'current checkout';
  console.log(`PASS: ${count} shipped files match MANIFEST.sha256 in ${scope}. This verifies handoff integrity, not implementation or remote-desktop readiness.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { console.error('Cannot verify handoff: SOURCE_UNAVAILABLE_OR_INVALID'); process.exitCode = 1; });
}
