/** Safe-list predicate reference. No service worker, cache writes or user data. */
export const SAFE_ASSETS = Object.freeze({
  '/offline.html': 'text/html',
  '/assets/shell.v1.js': 'text/javascript',
  '/assets/shell.v1.css': 'text/css',
  '/assets/icon-192.v1.png': 'image/png',
  '/assets/icon-512.v1.png': 'image/png'
});
export function mayCache({method, url, origin, status, redirected, contentType, cacheControl = ''}) {
  if (method !== 'GET' || status !== 200 || redirected !== false || typeof contentType !== 'string') return false;
  if (/\b(?:no-store|private)\b/i.test(cacheControl)) return false;
  let u, o;
  try { u = new URL(url); o = new URL(origin); } catch { return false; }
  if (o.protocol !== 'https:' || o.origin !== origin || u.origin !== origin || u.username || u.password || u.search || u.hash) return false;
  const expected = Object.hasOwn(SAFE_ASSETS, u.pathname) ? SAFE_ASSETS[u.pathname] : null;
  return expected !== null && contentType.split(';')[0].trim().toLowerCase() === expected;
}
