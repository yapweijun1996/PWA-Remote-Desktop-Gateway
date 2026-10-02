/** Pure predicates only: callers MUST supply already verified identity/session values.
 * This is NOT a JWT validator, atomic intent store, timer or production auth middleware.
 */
function timestamp(value) { return Number.isSafeInteger(value) && value >= 0; }
export function exactOriginAllowed(origin, expected) {
  if (typeof origin !== 'string' || typeof expected !== 'string' || origin === 'null') return false;
  try {
    const parsed = new URL(expected);
    return parsed.protocol === 'https:' && parsed.username === '' && parsed.password === ''
      && parsed.origin === expected && origin === expected;
  } catch { return false; }
}
export function makeDeadline({createdAtMs, verifiedAccessExpiryMs, capMs = 3_600_000}) {
  if (![createdAtMs, verifiedAccessExpiryMs, capMs].every(timestamp) || capMs === 0) throw new TypeError('Invalid deadline input');
  if (verifiedAccessExpiryMs <= createdAtMs) throw new RangeError('Identity is already expired');
  if (!Number.isSafeInteger(createdAtMs + capMs)) throw new RangeError('Deadline overflow');
  return Math.min(verifiedAccessExpiryMs, createdAtMs + capMs);
}
export function evaluateSession({nowMs, createdAtMs, lastInputAtMs, deadlineMs, idleMs = 900_000, revoked = false}) {
  if (![nowMs, createdAtMs, lastInputAtMs, deadlineMs, idleMs].every(timestamp)
      || idleMs === 0 || lastInputAtMs < createdAtMs || lastInputAtMs > nowMs
      || createdAtMs > nowMs || deadlineMs <= createdAtMs || typeof revoked !== 'boolean') {
    return {allowed: false, reason: 'INVALID_STATE'};
  }
  if (revoked) return {allowed: false, reason: 'REVOKED'};
  if (nowMs >= deadlineMs) return {allowed: false, reason: 'ABSOLUTE_EXPIRED'};
  if (nowMs - lastInputAtMs >= idleMs) return {allowed: false, reason: 'IDLE_EXPIRED'};
  return {allowed: true, reason: 'ACTIVE'};
}
export function evaluateIntent(intent, request, nowMs) {
  if (!intent || !request || !timestamp(nowMs) || !timestamp(intent.createdAtMs)
      || !timestamp(intent.expiresAtMs) || intent.expiresAtMs <= intent.createdAtMs
      || intent.expiresAtMs-intent.createdAtMs > 30_000 || nowMs < intent.createdAtMs) {
    return {allowed: false, reason: 'INVALID_INTENT'};
  }
  for (const field of ['id', 'ownerId', 'appSessionId', 'nodeId', 'deviceId']) {
    if (typeof intent[field] !== 'string' || !intent[field] || intent[field] !== request[field])
      return {allowed: false, reason: 'BINDING_MISMATCH'};
  }
  if (!['control', 'view'].includes(intent.mode) || intent.mode !== request.mode)
    return {allowed: false, reason: 'MODE_MISMATCH'};
  if (intent.revoked !== false || request.sessionActive !== true) return {allowed: false, reason: 'REVOKED'};
  if (intent.consumedAtMs !== null) return {allowed: false, reason: 'ALREADY_USED'};
  if (nowMs >= intent.expiresAtMs) return {allowed: false, reason: 'EXPIRED'};
  return {allowed: true, reason: 'ELIGIBLE_FOR_ATOMIC_CONSUME'};
}
