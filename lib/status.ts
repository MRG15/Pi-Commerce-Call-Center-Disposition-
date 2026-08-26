export function normalizeStatus(raw: string | null | undefined) {
  if (!raw) return null;
  return raw.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function displayOutcome(call: any) {
  if (call.l0_label_snapshot) {
    return [call.l0_label_snapshot, call.l1_label_snapshot, call.l2_label_snapshot].filter(Boolean).join(' → ');
  }
  if (call.status_raw) return call.status_raw;
  if (call.remark) return call.remark;
  return 'No outcome recorded';
}

// Centralized and intentionally conservative. You can change these later without touching historical data.
export const NON_CONNECTED = new Set([
  'call not picked',
  'voice mail',
  'voicemail',
]);

export function connectionBucket(rawOrL0: string | null | undefined) {
  if (!rawOrL0) return 'unknown';
  const n = normalizeStatus(rawOrL0)!;
  if (NON_CONNECTED.has(n)) return 'not_connected';
  if (n === 'wrap up') return 'unknown';
  return 'connected';
}
