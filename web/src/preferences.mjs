import {applyTranslations, getLocale, onLocaleChange, resolveLocale, setLocale, SUPPORTED_LOCALES, t} from './i18n.mjs';

export const THEME_COLORS = Object.freeze({light: '#f3f6f5', dark: '#111d23'});
export const PREFERENCE_STORAGE = Object.freeze({theme: 'rdg:theme', locale: 'rdg:locale'});
const THEMES = Object.freeze(['system', 'light', 'dark']);

export function resolveTheme(value) { return THEMES.includes(value) ? value : 'system'; }

export function browserLocale(navigator = globalThis.navigator) {
  return resolveLocale(navigator?.languages?.[0] ?? navigator?.language);
}

function readPreference(storage, key) { try { return storage?.getItem(key); } catch { return null; } }
function savePreference(storage, key, value) { try { storage?.setItem(key, value); } catch { /* Private browsing may refuse storage. */ } }
function browserStorage(window) { try { return window?.localStorage; } catch { return null; } }

/** Apply preferences synchronously before the app starts network/session work. */
export function setupPreferences(options = {}) {
  const document = options.document ?? globalThis.document;
  const window = options.window ?? globalThis.window;
  const navigator = options.navigator ?? window?.navigator ?? globalThis.navigator;
  const storage = Object.hasOwn(options, 'storage') ? options.storage : browserStorage(window);
  const root = document?.documentElement;
  const themeSelect = document?.getElementById('themePreference');
  const languageSelect = document?.getElementById('languagePreference');
  const installButton = document?.getElementById('installApp');
  const installHint = document?.getElementById('installHint');
  const darkQuery = window?.matchMedia?.('(prefers-color-scheme: dark)');
  const displayQuery = window?.matchMedia?.('(display-mode: standalone)');
  const disposers = [];
  let theme = resolveTheme(readPreference(storage, PREFERENCE_STORAGE.theme));
  let effectiveTheme = theme === 'system' ? (darkQuery?.matches ? 'dark' : 'light') : theme;
  let installPrompt = null;
  let installed = displayQuery?.matches === true || navigator?.standalone === true;
  const safari = /Safari/i.test(navigator?.userAgent ?? '') && !/(Chrome|Chromium|CriOS|FxiOS|Edg|OPR|Android)/i.test(navigator?.userAgent ?? '');
  let installKey = installed ? 'preferences.installedHint' : safari ? 'preferences.installSafari' : 'preferences.installUnavailable';

  function listen(target, name, callback) {
    if (!target?.addEventListener) return;
    target.addEventListener(name, callback);
    disposers.push(() => target.removeEventListener(name, callback));
  }

  function notify(source, nextTheme = theme, nextLocale = getLocale()) {
    options.onChange?.({source, theme: nextTheme, effectiveTheme: nextTheme === 'system' ? (darkQuery?.matches ? 'dark' : 'light') : nextTheme, locale: nextLocale});
  }

  function applyTheme() {
    effectiveTheme = theme === 'system' ? (darkQuery?.matches ? 'dark' : 'light') : theme;
    if (root) {
      root.dataset.theme = effectiveTheme;
      root.dataset.themePreference = theme;
      root.style.colorScheme = effectiveTheme;
    }
    for (const meta of document?.querySelectorAll('meta[name="theme-color"]') ?? []) meta.setAttribute('content', THEME_COLORS[effectiveTheme]);
    if (themeSelect) themeSelect.value = theme;
  }

  function renderInstall() {
    if (installHint) installHint.textContent = t(installKey);
    if (installButton) {
      installButton.hidden = installed || !installPrompt;
      installButton.textContent = t('preferences.install');
    }
  }

  function renderLanguage() {
    applyTranslations(document);
    if (languageSelect) languageSelect.value = getLocale();
    renderInstall();
  }

  function chooseTheme(value) {
    const next = resolveTheme(value);
    if (next !== theme) notify('theme', next);
    theme = next;
    savePreference(storage, PREFERENCE_STORAGE.theme, theme);
    applyTheme();
    return theme;
  }

  function chooseLocale(value) {
    const next = resolveLocale(value);
    if (next !== getLocale()) notify('locale', theme, next);
    setLocale(next);
    savePreference(storage, PREFERENCE_STORAGE.locale, next);
    renderLanguage();
    return next;
  }

  // Refused/invalid storage always falls back to the current browser preference.
  const savedLocale = readPreference(storage, PREFERENCE_STORAGE.locale);
  setLocale(SUPPORTED_LOCALES.includes(savedLocale) ? savedLocale : browserLocale(navigator));
  applyTheme();
  renderLanguage();
  disposers.push(onLocaleChange(renderLanguage));
  listen(themeSelect, 'change', () => chooseTheme(themeSelect.value));
  listen(languageSelect, 'change', () => chooseLocale(languageSelect.value));
  listen(darkQuery, 'change', () => {
    if (theme !== 'system') return;
    applyTheme();
    notify('system');
  });
  listen(displayQuery, 'change', () => {
    installed = displayQuery.matches || navigator?.standalone === true;
    installKey = installed ? 'preferences.installedHint' : installPrompt ? 'preferences.installAvailable' : safari ? 'preferences.installSafari' : 'preferences.installUnavailable';
    renderInstall();
  });

  if (installButton || installHint) {
    listen(window, 'beforeinstallprompt', event => {
      event.preventDefault();
      if (installed) return;
      installPrompt = event;
      installKey = 'preferences.installAvailable';
      if (installButton) installButton.disabled = false;
      renderInstall();
    });
    listen(window, 'appinstalled', () => {
      installed = true;
      installPrompt = null;
      installKey = 'preferences.installComplete';
      renderInstall();
    });
    listen(installButton, 'click', async () => {
      if (!installPrompt || installed || installButton.disabled) return;
      notify('install');
      const prompt = installPrompt;
      installPrompt = null;
      installButton.disabled = true;
      installKey = 'preferences.installPrompt';
      renderInstall();
      try {
        // prompt() is invoked inside the user's click; never auto-prompt on load.
        await prompt.prompt();
        const choice = await prompt.userChoice;
        if (!installed) installKey = choice?.outcome === 'accepted' ? 'preferences.installAccepted' : 'preferences.installDismissed';
      } catch { installKey = 'preferences.installFailed'; }
      installButton.disabled = false;
      renderInstall();
    });
  }

  return {
    getTheme: () => theme,
    getEffectiveTheme: () => effectiveTheme,
    setTheme: chooseTheme,
    getLocale,
    setLocale: chooseLocale,
    destroy: () => { for (const dispose of disposers.splice(0)) dispose(); installPrompt = null; },
  };
}
