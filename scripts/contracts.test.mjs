import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read = name => readFileSync(new URL(`../contracts/${name}`, import.meta.url), 'utf8');
const schema = JSON.parse(read('device.schema.json'));
const openapi = read('openapi.yaml');
const device = schema.properties.localDevice.properties;
const bookmark = schema.properties.bookmarks.items.properties;
const examples = ['device.mini.example.json', 'device.air.example.json'].map(n => JSON.parse(read(n)));
test('upstreamHost is only the host gateway name, never container-local 127.0.0.1', () => {
  assert.deepEqual(device.upstreamHost.enum, ['host.docker.internal']);
  for (const e of examples) assert.equal(e.localDevice.upstreamHost, 'host.docker.internal');
});
test('Bookmark ids use the same pattern as local device ids', () => {
  assert.equal(bookmark.id.pattern, device.id.pattern);
  assert.equal(bookmark.id.minLength, undefined);
  for (const e of examples) for (const b of e.bookmarks) assert.match(b.id, new RegExp(bookmark.id.pattern));
});
test('Device id pattern length bounds match the connect-intent deviceId bounds', () => {
  const [, min, max] = /\{(\d+),(\d+)\}\$$/.exec(device.id.pattern);
  const api = /deviceId: \{type: string, minLength: (\d+), maxLength: (\d+)\}/.exec(openapi);
  assert.ok(api, 'deviceId bounds present in openapi.yaml');
  assert.equal(Number(min) + 1, Number(api[1]));
  assert.equal(Number(max) + 1, Number(api[2]));
});
test('Connect-intent contract rejects bookmark devices with 404', () => {
  const section = /operationId: createConnectIntent[\s\S]*?\n  \/api\/desktop-session:/.exec(openapi)?.[0] ?? '';
  assert.match(section, /'404':[\s\S]*kind=bookmark/);
});
