import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const css = readFileSync(new URL('../prototype/styles.css', import.meta.url), 'utf8');
// Static regression guard only: real overflow is checked by qa/render-and-check-prototype.py in a browser.
test('Input status chip in the viewer toolbar may shrink and wrap', () => {
  const rule = /\.viewer-toolbar>\.status\{([^}]*)\}/.exec(css)?.[1] ?? '';
  assert.match(rule, /min-width:0/);
  assert.match(rule, /white-space:normal/);
});
test('Prototype app uses retrigger instead of a character-length check', () => {
  const app = readFileSync(new URL('../prototype/app.mjs', import.meta.url), 'utf8');
  assert.match(app, /state\.retrigger\(/);
  assert.doesNotMatch(app, /logical\.length===1/);
});
