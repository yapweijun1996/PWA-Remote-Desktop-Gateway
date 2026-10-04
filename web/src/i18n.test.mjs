import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {applyTranslations, formatDate, getLocale, onLocaleChange, resolveLocale, setLocale, SUPPORTED_LOCALES, t, TRANSLATIONS} from './i18n.mjs';

test('catalogs have matching nonempty keys and interpolation contracts', () => {
  assert.deepEqual(SUPPORTED_LOCALES, ['en', 'zh-CN']);
  assert.deepEqual(Object.keys(TRANSLATIONS.en), Object.keys(TRANSLATIONS['zh-CN']));
  for (const [key, english] of Object.entries(TRANSLATIONS.en)) {
    const chinese = TRANSLATIONS['zh-CN'][key];
    assert.ok(english.length > 0 && chinese.length > 0, key);
    assert.deepEqual(english.match(/\{\w+\}/g) ?? [], chinese.match(/\{\w+\}/g) ?? [], key);
  }
});

test('launcher and offline UI translation annotations resolve in the catalog', () => {
  for (const filename of ['index.html', 'offline.html']) {
    const html = readFileSync(new URL(`../public/${filename}`, import.meta.url), 'utf8');
    for (const [, key] of html.matchAll(/data-i18n(?:-label|-title|-placeholder)?="([^"]+)"/g)) {
      assert.ok(Object.hasOwn(TRANSLATIONS.en, key), `${filename}: ${key}`);
    }
  }
});

test('locale selection supports browser regions and notifies only on change', () => {
  setLocale('en');
  const changes = [];
  const unsubscribe = onLocaleChange(value => changes.push(value));
  assert.equal(resolveLocale('zh-SG'), 'zh-CN');
  assert.equal(resolveLocale('zh-Hant'), 'zh-CN');
  assert.equal(resolveLocale('fr-FR'), 'en');
  assert.equal(resolveLocale(null), 'en');
  setLocale('zh-CN');
  setLocale('zh-SG');
  assert.deepEqual(changes, ['zh-CN']);
  unsubscribe();
  setLocale('en');
  assert.equal(getLocale(), 'en');
  assert.deepEqual(changes, ['zh-CN']);
});

test('translation parameters are plain text and missing keys have a visible fallback', () => {
  setLocale('en');
  assert.equal(t('trusted.revokeLabel', {id: '<script>{date}</script>'}), 'Revoke trusted device <script>{date}</script>');
  assert.equal(t('device.checked'), 'Checked {date}');
  assert.equal(t('missing.catalog.key'), 'missing.catalog.key');
  assert.equal(t('status.READY'), 'READY');
  setLocale('zh-CN');
  assert.equal(t('status.READY'), '就绪');
  assert.equal(t('version.current', {version: '1.2.3'}), '版本 1.2.3');
  assert.equal(t('offline.pageTitle'), '远程网关 · 离线');
  assert.equal(t('diagnostics.historyEntry', {date: '2026年10月4日', event: 'SESSION_ENDED', reason: 'USER_REQUEST'}), '2026年10月4日 · SESSION_ENDED · USER_REQUEST');
  setLocale('en');
});

test('DOM translations use explicit annotations and safe text and attributes only', () => {
  setLocale('zh-CN');
  const attributes = new Map([['data-i18n', 'actions.close'], ['data-i18n-label', 'workspace.surfaceLabel'], ['data-i18n-title', 'workspace.releaseTitle'], ['data-i18n-placeholder', 'fields.password']]);
  const annotated = {
    textContent: '',
    get innerHTML() { throw new Error('HTML translation is forbidden'); },
    set innerHTML(_) { throw new Error('HTML translation is forbidden'); },
    hasAttribute: name => attributes.has(name),
    getAttribute: name => attributes.get(name),
    setAttribute: (name, value) => attributes.set(name, value),
  };
  const untouched = {textContent: '<private clipboard text>'};
  const document = {nodeType: 9, documentElement: {lang: 'en'}, querySelectorAll: () => [annotated]};
  applyTranslations(document);
  assert.equal(annotated.textContent, '关闭');
  assert.equal(attributes.get('aria-label'), '远程桌面输入。Shift+Escape 暂停输入。');
  assert.equal(attributes.get('title'), '释放所有按住的按键并暂停输入');
  assert.equal(attributes.get('placeholder'), '屏幕共享 VNC 密码');
  assert.equal(document.documentElement.lang, 'zh-CN');
  assert.equal(untouched.textContent, '<private clipboard text>');
  setLocale('en');
});

test('date formatting follows the UI locale and rejects missing or invalid dates', () => {
  setLocale('en');
  const options = {year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'UTC'};
  assert.equal(formatDate('2026-10-04T00:00:00Z', options), new Intl.DateTimeFormat('en', options).format(new Date('2026-10-04T00:00:00Z')));
  assert.equal(formatDate('invalid'), 'Unavailable');
  assert.equal(formatDate(null), 'Unavailable');
  assert.equal(formatDate(''), 'Unavailable');
  setLocale('zh-CN');
  assert.equal(formatDate(undefined), '不可用');
  assert.equal(formatDate('2026-10-04T00:00:00Z', options), new Intl.DateTimeFormat('zh-CN', options).format(new Date('2026-10-04T00:00:00Z')));
  setLocale('en');
});
