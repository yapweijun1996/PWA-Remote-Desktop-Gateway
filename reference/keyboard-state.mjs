/** Logical ownership reference only. No DOM capture, IME implementation or VNC keysyms. */
export const PROFILES = Object.freeze(['mac-native', 'windows-native', 'windows-alt-command']);
function requireString(value, name) {
  if (typeof value !== 'string' || !value.trim() || value.length > 160) throw new TypeError(`${name} must be a bounded nonempty string`);
}
function requireProfile(profile) {
  if (!PROFILES.includes(profile)) throw new RangeError('Unknown keyboard profile');
}
export function mapLogicalKey(profile, key, {code = '', physical = true} = {}) {
  requireProfile(profile); requireString(key, 'key');
  // The normalizer has already resolved AltGr/IME before calling this layer.
  return physical && profile === 'windows-alt-command' && code === 'AltLeft' && key === 'OptionLeft'
    ? 'CommandLeft' : key;
}
const MODIFIER_KEY = /^(?:Command|Option|Control|Shift)(?:Left|Right)$/;
export class KeyboardState {
  #sources = new Map(); #counts = new Map(); #emit; #profile; #broken = false; #sequence = 0;
  constructor({profile = 'mac-native', onTransition} = {}) {
    requireProfile(profile);
    if (typeof onTransition !== 'function') throw new TypeError('onTransition must be a function');
    this.#profile = profile; this.#emit = onTransition;
  }
  get profile() { return this.#profile; }
  get broken() { return this.#broken; }
  snapshot() {
    return Object.freeze({profile: this.#profile, broken: this.#broken,
      sources: [...this.#sources].map(([source, entry]) => ({source, ...entry})),
      remoteHeld: [...this.#counts.keys()]});
  }
  #ready() { if (this.#broken) throw new Error('Input session ended after sink failure; create a fresh session'); }
  #transition(key, down) {
    try { this.#emit(Object.freeze({key, down})); }
    catch (cause) {
      this.#sources.clear(); this.#counts.clear(); this.#broken = true;
      throw new Error('Input sink failed; local state cleared. Close upstream; delivery is unknown.', {cause});
    }
  }
  down(source, logicalKey, {code = '', physical = true} = {}) {
    this.#ready(); requireString(source, 'source'); requireString(logicalKey, 'logicalKey');
    if (typeof physical !== 'boolean' || typeof code !== 'string') throw new TypeError('Invalid source metadata');
    if (this.#sources.has(source)) return false; // Repeats cannot add a second owner.
    const key = mapLogicalKey(this.#profile, logicalKey, {code, physical});
    this.#sources.set(source, {key, physical});
    const count = this.#counts.get(key) ?? 0;
    this.#counts.set(key, count + 1);
    if (count === 0) this.#transition(key, true);
    return true;
  }
  up(source) {
    this.#ready(); requireString(source, 'source');
    const owned = this.#sources.get(source);
    if (!owned) return false;
    this.#sources.delete(source);
    const count = this.#counts.get(owned.key);
    if (count === 1) { this.#counts.delete(owned.key); this.#transition(owned.key, false); }
    else this.#counts.set(owned.key, count - 1);
    return true;
  }
  releaseAll() {
    if (this.#broken) return; // Sink failure already cleared all state; cleanup must stay safe on blur/hide.
    for (const source of [...this.#sources.keys()].reverse()) this.up(source);
  }
  /** Re-strike a physical non-modifier key whose keyup was never delivered (macOS Command held). */
  retrigger(source, logicalKey, opts = {}) {
    this.#ready(); requireString(source, 'source');
    const owned = this.#sources.get(source);
    if (owned?.physical && !MODIFIER_KEY.test(owned.key)) this.up(source);
    return this.down(source, logicalKey, opts);
  }
  /** macOS fires no keyup for non-modifier keys while Command is held; call when Command is released. */
  releasePhysicalNonModifiers() {
    if (this.#broken) return;
    const stale = [...this.#sources].filter(([, e]) => e.physical && !MODIFIER_KEY.test(e.key)).map(([source]) => source);
    for (const source of stale.reverse()) this.up(source);
  }
  setProfile(profile) {
    this.#ready(); requireProfile(profile);
    if (profile === this.#profile) return false;
    this.releaseAll(); this.#profile = profile; return true;
  }
  virtualChord(keys) {
    this.#ready();
    if (!Array.isArray(keys) || keys.length < 1 || keys.length > 8) throw new TypeError('Chord needs 1–8 logical keys');
    keys.forEach(k => requireString(k, 'chord key'));
    if (new Set(keys).size !== keys.length) throw new RangeError('Duplicate chord key');
    if ([...this.#sources.values()].some(e => e.physical)) throw new Error('Release physical keys before a virtual chord');
    const prefix = `virtual-chord:${++this.#sequence}:`;
    for (let i = 0; i < keys.length; i++) this.down(prefix+i, keys[i], {physical: false});
    for (let i = keys.length-1; i >= 0; i--) this.up(prefix+i);
  }
}
