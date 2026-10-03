/** Test-only native logger metadata; never retain or echo raw native messages. */
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import {homedir} from 'node:os';
import {writeArtifact} from '../scripts/atomic-artifact.mjs';

export const labels = new Set([
  'NETWORK_CONNECT_FAILURE', 'SERVER_CLOSED', 'AUTHENTICATION_SUCCEEDED',
  'SERVER_REPORTED_AUTHENTICATION_FAILURE', 'NATIVE_CONNECTION_FAILURE_UNCLASSIFIED',
  'TRANSPORT_TIMEOUT', 'TRANSPORT_WRITE_FAILURE', 'SERVER_INIT_COMPLETED',
  'FRAMEBUFFER_ALLOCATION_FAILURE'
]);
export function validateBuild(manifest, expectedBuilder, sourceSha, librarySha) {
  if (!/^sha256:[a-f0-9]{64}$/.test(expectedBuilder)
      || manifest.scope !== 'TEST_ONLY_NATIVE_LOGGER' || manifest.builderImageId !== expectedBuilder
      || !/^[a-f0-9]{64}$/.test(sourceSha) || !/^[a-f0-9]{64}$/.test(librarySha)
      || manifest.sourceSha256 !== sourceSha || manifest.librarySha256 !== librarySha) throw new Error();
  return librarySha;
}
export function checkedDiagnostic(diagnostic, runId, librarySha256) {
  if (diagnostic.scope !== 'TEST_ONLY_NATIVE_LOGGER' || diagnostic.runId !== runId
      || diagnostic.librarySha256 !== librarySha256 || diagnostic.status !== 'COMPLETE'
      || diagnostic.rawLogsSaved !== false || !Number.isInteger(diagnostic.discardedLines)
      || diagnostic.discardedLines < 0 || diagnostic.discardedLines > 1000000
      || typeof diagnostic.stages !== 'object' || diagnostic.stages === null
      || Array.isArray(diagnostic.stages)
      || Object.entries(diagnostic.stages).some(([key, count]) => !labels.has(key)
        || !Number.isInteger(count) || count < 1 || count > 1000)) throw new Error();
  // Construct the closed artifact schema explicitly; unknown fields never cross this boundary.
  return {scope: 'TEST_ONLY_NATIVE_LOGGER', status: 'COMPLETE', runId, librarySha256,
    stages: {...diagnostic.stages}, discardedLines: diagnostic.discardedLines, rawLogsSaved: false};
}
export function createCollector() {
  const stages = Object.create(null);
  let line = '', dropping = false, discardedLines = 0;
  return {
    ingest(chunk) {
      for (const character of chunk.toString('utf8')) {
        if (character === '\n') {
          const prefix = 'RDG_NATIVE_VNC_DIAG:';
          const label = !dropping && line.startsWith(prefix) ? line.slice(prefix.length) : '';
          if (labels.has(label)) stages[label] = Math.min(1000, (stages[label] ?? 0) + 1);
          else discardedLines = Math.min(1000000, discardedLines + 1);
          line = ''; dropping = false;
        } else if (!dropping) {
          if (line.length >= 8192) { line = ''; dropping = true; }
          else line += character;
        }
      }
    },
    result(runId, librarySha256, status = 'COMPLETE') {
      return {scope: 'TEST_ONLY_NATIVE_LOGGER', status, runId, librarySha256,
        stages: {...stages}, discardedLines, rawLogsSaved: false};
    }
  };
}
export async function captureProcess(command, args, runId, librarySha256) {
  const collector = createCollector();
  let child;
  try { child = spawn(command, args, {stdio: ['ignore', 'pipe', 'ignore']}); }
  catch { return collector.result(runId, librarySha256, 'CAPTURE_UNAVAILABLE'); }
  const exited = new Promise(resolve => {
    child.once('error', () => resolve(false));
    child.once('close', (code, signal) => resolve(code === 0 && signal === null));
  });
  const timer = setTimeout(() => child.kill('SIGKILL'), 10000);
  let readable = true;
  try { for await (const chunk of child.stdout) collector.ingest(chunk); }
  catch { readable = false; }
  const successful = await exited;
  clearTimeout(timer);
  return collector.result(runId, librarySha256,
    readable && successful ? 'COMPLETE' : 'CAPTURE_UNAVAILABLE');
}
async function main() {
  const [mode, inputPath, outputPath, runId, librarySha256, dockerEndpoint, containerName] = process.argv.slice(2);
  if (!/^local-mac-view\.[a-zA-Z0-9]{6}$/.test(runId ?? '')
      || !/^[a-f0-9]{64}$/.test(librarySha256 ?? '')) throw new Error();
  if (mode === 'capture') {
    if (dockerEndpoint !== `unix://${homedir()}/.docker/run/docker.sock`
        || !/^rdg-(local-mac-view\.[a-zA-Z0-9]{6}|native-diagnostics-check\.[a-zA-Z0-9]{6}-daemon)$/.test(containerName ?? '')) throw new Error();
    const diagnostic = await captureProcess('docker', ['--host', dockerEndpoint, 'exec',
      containerName, 'sh', '-c',
      'test -f /tmp/rdg-native-vnc-diagnostics && cat /tmp/rdg-native-vnc-diagnostics'], runId, librarySha256);
    await writeArtifact(inputPath, JSON.stringify(diagnostic, null, 2) + '\n');
    if (diagnostic.status !== 'COMPLETE') {
      console.error('NATIVE_DIAGNOSTIC_CAPTURE_UNAVAILABLE');
      process.exitCode = 1;
    }
  } else if (mode === 'collect') {
    const collector = createCollector();
    let status = 'COMPLETE';
    try { for await (const chunk of process.stdin) collector.ingest(chunk); }
    catch { status = 'COLLECTOR_ERROR'; }
    await writeArtifact(inputPath, JSON.stringify(collector.result(runId, librarySha256, status), null, 2) + '\n');
    if (status !== 'COMPLETE') process.exitCode = 1;
  } else if (mode === 'merge') {
    const diagnostic = JSON.parse(await readFile(inputPath, 'utf8'));
    const evidence = JSON.parse(await readFile(outputPath, 'utf8'));
    if (evidence.runId !== runId) throw new Error();
    evidence.nativeDiagnostics = checkedDiagnostic(diagnostic, runId, librarySha256);
    await writeArtifact(outputPath, JSON.stringify(evidence, null, 2) + '\n');
  } else throw new Error();
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { console.error('NATIVE_DIAGNOSTIC_METADATA_REFUSED'); process.exitCode = 2; });
}
