import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createCollector, validateBuild, checkedDiagnostic, captureProcess} from './native-vnc-diagnostics.mjs';

test('only exact fixed labels survive split stream chunks', () => {
  const collector = createCollector();
  collector.ingest(Buffer.from('RDG_NATIVE_VNC_DIAG:SERVER_REPORTED_'));
  collector.ingest(Buffer.from('AUTHENTICATION_FAILURE\nRDG_NATIVE_VNC_DIAG:SERVER_INIT_COMPLETED\n'));
  assert.deepEqual(collector.result('test', 'test').stages,
    {SERVER_REPORTED_AUTHENTICATION_FAILURE: 1, SERVER_INIT_COMPLETED: 1});
});
test('private-looking, malformed and oversized messages never enter metadata', () => {
  const collector = createCollector();
  const privateMarker = 'fixture-private-content-do-not-retain';
  collector.ingest(Buffer.from(privateMarker + '\nRDG_NATIVE_VNC_DIAG:' + privateMarker
    + '\nRDG_NATIVE_VNC_DIAG:SERVER_CLOSED ' + privateMarker + '\n'
    + 'x'.repeat(9000) + 'RDG_NATIVE_VNC_DIAG:SERVER_CLOSED\n'
    + 'RDG_NATIVE_VNC_DIAG:SERVER_CLOSED\n'));
  const result = collector.result('test', 'test');
  assert.deepEqual(result.stages, {SERVER_CLOSED: 1});
  assert.equal(result.discardedLines, 4);
  assert.equal(JSON.stringify(result).includes(privateMarker), false);
});
test('changed builder, source or binary provenance refuses logger loading', () => {
  const builder = 'sha256:' + 'a'.repeat(64);
  const source = 'b'.repeat(64), library = 'c'.repeat(64);
  const valid = {scope: 'TEST_ONLY_NATIVE_LOGGER', builderImageId: builder,
    sourceSha256: source, librarySha256: library};
  assert.equal(validateBuild(valid, builder, source, library), library);
  for (const changed of [
    {...valid, builderImageId: 'sha256:' + 'd'.repeat(64)},
    {...valid, sourceSha256: 'e'.repeat(64)},
    {...valid, librarySha256: 'f'.repeat(64)},
    {...valid, scope: 'UNREVIEWED_LOGGER'}
  ]) assert.throws(() => validateBuild(changed, builder, source, library));
});
test('unrecognized fields cannot carry raw data into the merged artifact', () => {
  const marker = 'synthetic-private-field-do-not-retain';
  const input = {scope: 'TEST_ONLY_NATIVE_LOGGER', status: 'COMPLETE', runId: 'fixture',
    librarySha256: 'a'.repeat(64), stages: {SERVER_CLOSED: 1}, discardedLines: 0,
    rawLogsSaved: false, rawMessage: marker};
  const output = checkedDiagnostic(input, 'fixture', 'a'.repeat(64));
  assert.equal(Object.hasOwn(output, 'rawMessage'), false);
  assert.equal(JSON.stringify(output).includes(marker), false);
  assert.throws(() => checkedDiagnostic({...input, stages: {[marker]: 1}}, 'fixture', 'a'.repeat(64)));
});

test('capture checks child exit and excludes stderr even after valid labels', async () => {
  const marker = 'synthetic-private-stderr-do-not-retain';
  const script = `process.stdout.write('RDG_NATIVE_VNC_DIAG:SERVER_CLOSED\\n'); process.stderr.write('${marker}'); process.exitCode = Number(process.argv[1]);`;
  const good = await captureProcess(process.execPath, ['-e', script, '0'], 'fixture', 'test');
  const failed = await captureProcess(process.execPath, ['-e', script, '2'], 'fixture', 'test');
  assert.equal(good.status, 'COMPLETE');
  assert.deepEqual(good.stages, {SERVER_CLOSED: 1});
  assert.equal(failed.status, 'CAPTURE_UNAVAILABLE');
  assert.equal(JSON.stringify([good, failed]).includes(marker), false);
  assert.throws(() => checkedDiagnostic(failed, 'fixture', 'test'));
});
test('missing capture executable cannot claim completed diagnostics', async () => {
  const result = await captureProcess('/rdg-nonexistent-fixture-executable', [], 'fixture', 'test');
  assert.equal(result.status, 'CAPTURE_UNAVAILABLE');
  assert.deepEqual(result.stages, {});
});
