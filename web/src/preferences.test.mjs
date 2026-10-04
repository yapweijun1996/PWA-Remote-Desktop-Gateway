import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import {getLocale, setLocale} from './i18n.mjs';
import {browserLocale, PREFERENCE_STORAGE, resolveTheme, setupPreferences, THEME_COLORS} from './preferences.mjs';

class Element extends EventTarget {
  constructor(attributes = {}) { super(); this.attributes = new Map(Object.entries(attributes)); this.dataset = {}; this.style = {}; this.value = ''; this.textContent = ''; this.hidden = false; this.disabled = false; }
  hasAttribute(name) { return this.attributes.has(name); }
  getAttribute(name) { return this.attributes.get(name); }
  setAttribute(name, value) { this.attributes.set(name, value); }
}
class Media extends EventTarget {
  constructor(matches) { super(); this.matches = matches; }
  change(matches) { this.matches = matches; this.dispatchEvent(new Event('change')); }
}
function fixture({dark = false, standalone = false, saved = {}, navigator = {language: 'en', userAgent: 'Browser'}, storage} = {}) {
  const window = new EventTarget();
  const darkQuery = new Media(dark), displayQuery = new Media(standalone);
  window.matchMedia = query => query.includes('color-scheme') ? darkQuery : displayQuery;
  window.navigator = navigator;
  const stored = new Map(Object.entries(saved));
  window.localStorage = storage ?? {getItem: key => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value)};
  const nodes = Object.fromEntries(['themePreference', 'languagePreference', 'installApp', 'installHint'].map(id => [id, new Element()]));
  const metas = [new Element({media: '(prefers-color-scheme: light)'}), new Element({media: '(prefers-color-scheme: dark)'})];
  const document = {nodeType: 9, documentElement: new Element(), getElementById: id => nodes[id] ?? null, querySelectorAll: selector => selector === 'meta[name="theme-color"]' ? metas : []};
  return {window, document, navigator, nodes, metas, darkQuery, displayQuery, stored};
}

test('system theme and browser locale apply synchronously; system changes only affect system choice', () => {
  setLocale('en');
  const f = fixture({dark: true, navigator: {languages: ['zh-SG', 'en'], language: 'en'}});
  const preferences = setupPreferences(f);
  assert.equal(preferences.getTheme(), 'system');
  assert.equal(preferences.getEffectiveTheme(), 'dark');
  assert.equal(f.document.documentElement.dataset.theme, 'dark');
  assert.equal(f.document.documentElement.style.colorScheme, 'dark');
  assert.equal(f.nodes.languagePreference.value, 'zh-CN');
  assert.equal(f.document.documentElement.lang, 'zh-CN');
  assert.ok(f.metas.every(meta => meta.getAttribute('content') === THEME_COLORS.dark));
  f.darkQuery.change(false);
  assert.equal(preferences.getEffectiveTheme(), 'light');
  preferences.setTheme('dark');
  f.darkQuery.change(true);
  f.darkQuery.change(false);
  assert.equal(preferences.getEffectiveTheme(), 'dark');
  assert.equal(f.document.documentElement.dataset.themePreference, 'dark');
  assert.equal(f.stored.get(PREFERENCE_STORAGE.theme), 'dark');
  preferences.destroy();
  setLocale('en');
});

test('saved choices override browser preferences and only nonsecret preference keys are written', () => {
  const f = fixture({saved: {'rdg:theme': 'light', 'rdg:locale': 'en'}, dark: true, navigator: {language: 'zh-CN'}});
  const preferences = setupPreferences(f);
  assert.equal(preferences.getEffectiveTheme(), 'light');
  assert.equal(getLocale(), 'en');
  preferences.setLocale('zh-CN');
  preferences.setTheme('system');
  assert.deepEqual([...f.stored.keys()].sort(), ['rdg:locale', 'rdg:theme']);
  assert.equal(f.stored.get('rdg:locale'), 'zh-CN');
  assert.equal(f.stored.get('rdg:theme'), 'system');
  preferences.destroy();
  setLocale('en');
});

test('invalid or refused storage falls back safely without blocking UI changes', () => {
  assert.equal(resolveTheme('injected'), 'system');
  assert.equal(browserLocale({languages: ['de-DE']}), 'en');
  const invalid = fixture({saved: {'rdg:theme': 'injected', 'rdg:locale': 'bad'}, navigator: {language: 'zh-CN'}});
  const first = setupPreferences(invalid);
  assert.equal(first.getTheme(), 'system');
  assert.equal(first.getLocale(), 'zh-CN');
  first.destroy();
  const refusing = fixture({storage: {getItem() { throw new Error('Storage refused'); }, setItem() { throw new Error('Storage refused'); }}});
  const second = setupPreferences(refusing);
  assert.doesNotThrow(() => second.setTheme('dark'));
  assert.doesNotThrow(() => second.setLocale('zh-CN'));
  assert.equal(second.getEffectiveTheme(), 'dark');
  second.destroy();
  const denied = fixture();
  Object.defineProperty(denied.window, 'localStorage', {get() { throw new Error('Storage denied'); }});
  const third = setupPreferences(denied);
  assert.equal(third.getTheme(), 'system');
  third.destroy();
  setLocale('en');
});

test('user change callback runs before language/theme changes so input can release first', () => {
  const f = fixture();
  const observed = [];
  const preferences = setupPreferences({...f, onChange: change => observed.push({...change, previousLocale: getLocale(), previousTheme: f.document.documentElement.dataset.theme})});
  f.nodes.languagePreference.value = 'zh-CN';
  f.nodes.languagePreference.dispatchEvent(new Event('change'));
  f.nodes.themePreference.value = 'dark';
  f.nodes.themePreference.dispatchEvent(new Event('change'));
  assert.equal(observed[0].source, 'locale');
  assert.equal(observed[0].previousLocale, 'en');
  assert.equal(observed[0].locale, 'zh-CN');
  assert.equal(observed[1].source, 'theme');
  assert.equal(observed[1].previousTheme, 'light');
  assert.equal(observed[1].effectiveTheme, 'dark');
  preferences.destroy();
  setLocale('en');
});

test('installation is hidden until a browser offer and prompts only on explicit click', async () => {
  const f = fixture();
  const preferences = setupPreferences(f);
  assert.equal(f.nodes.installApp.hidden, true);
  let prompts = 0;
  const offer = new Event('beforeinstallprompt', {cancelable: true});
  offer.prompt = async () => { prompts++; };
  offer.userChoice = Promise.resolve({outcome: 'dismissed'});
  f.window.dispatchEvent(offer);
  assert.equal(offer.defaultPrevented, true);
  assert.equal(prompts, 0);
  assert.equal(f.nodes.installApp.hidden, false);
  f.nodes.installApp.dispatchEvent(new Event('click'));
  await setImmediate();
  assert.equal(prompts, 1);
  assert.equal(f.nodes.installApp.hidden, true);
  assert.match(f.nodes.installHint.textContent, /cancelled/);
  f.nodes.installApp.dispatchEvent(new Event('click'));
  await setImmediate();
  assert.equal(prompts, 1);
  preferences.destroy();
});

test('Safari gets installation guidance and installed mode never offers installation', () => {
  const safari = fixture({navigator: {language: 'en', userAgent: 'Version/18.0 Safari/605.1.15'}});
  const first = setupPreferences(safari);
  assert.equal(safari.nodes.installApp.hidden, true);
  assert.match(safari.nodes.installHint.textContent, /Add to Home Screen/);
  first.destroy();
  const installed = fixture({standalone: true});
  const second = setupPreferences(installed);
  assert.equal(installed.nodes.installApp.hidden, true);
  assert.match(installed.nodes.installHint.textContent, /running as an installed app/);
  second.destroy();
});

test('accepting an installation offer is pending until the browser confirms installation', async () => {
  const f = fixture();
  const preferences = setupPreferences(f);
  const offer = new Event('beforeinstallprompt', {cancelable: true});
  offer.prompt = async () => {};
  offer.userChoice = Promise.resolve({outcome: 'accepted'});
  f.window.dispatchEvent(offer);
  f.nodes.installApp.dispatchEvent(new Event('click'));
  await setImmediate();
  assert.match(f.nodes.installHint.textContent, /will finish installing/);
  assert.equal(f.nodes.installApp.hidden, true);
  f.window.dispatchEvent(new Event('appinstalled'));
  assert.match(f.nodes.installHint.textContent, /app is installed/);
  preferences.destroy();
});

test('optional controls may be absent and cleanup removes media listeners', () => {
  const f = fixture();
  f.document.getElementById = () => null;
  const preferences = setupPreferences(f);
  preferences.destroy();
  f.darkQuery.change(true);
  assert.equal(f.document.documentElement.dataset.theme, 'light');
  setLocale('en');
});
