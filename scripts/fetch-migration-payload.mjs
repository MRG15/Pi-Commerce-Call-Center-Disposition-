import fs from 'fs';
import crypto from 'crypto';
import zlib from 'zlib';

const keyB64 = process.env.MIGRATION_DATA_KEY;
const encryptedPath = process.env.MIGRATION_PAYLOAD_ENC || 'migration/historical-payload.enc';
const out = process.env.MIGRATION_PAYLOAD_JSON || '/tmp/pi-migration-payload.json';

function fail(message) {
  console.error(`Migration payload error: ${message}`);
  process.exit(1);
}

if (!keyB64) fail('MIGRATION_DATA_KEY is missing');
const key = Buffer.from(keyB64, 'base64');
if (key.length !== 32) fail('MIGRATION_DATA_KEY is invalid');
if (!fs.existsSync(encryptedPath)) fail(`encrypted migration payload file not found: ${encryptedPath}`);

let envelope;
try {
  envelope = JSON.parse(fs.readFileSync(encryptedPath, 'utf8'));
} catch {
  fail('encrypted migration envelope is malformed');
}

if (envelope?.v !== 2 || envelope?.alg !== 'AES-256-GCM' || envelope?.format !== 'brotli-compact-v1') {
  fail('encrypted migration envelope version/format is invalid');
}
if (!/^[A-Za-z0-9+/=]+$/.test(String(envelope.nonce || '')) || !/^[A-Za-z0-9+/=]+$/.test(String(envelope.ciphertext || ''))) {
  fail('encrypted migration envelope contains invalid characters');
}

let decoded;
try {
  const nonce = Buffer.from(envelope.nonce, 'base64');
  const packed = Buffer.from(envelope.ciphertext, 'base64');
  if (nonce.length !== 12 || packed.length <= 16) fail('encrypted payload dimensions are invalid');
  const tag = packed.subarray(packed.length - 16);
  const ciphertext = packed.subarray(0, packed.length - 16);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce);
  decipher.setAuthTag(tag);
  const compressed = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  decoded = JSON.parse(zlib.brotliDecompressSync(compressed).toString('utf8'));
} catch {
  fail('authentication/decryption failed; payload was not used');
}

const sheetMap = {
  U: 'Highly interested cx (Umesh)',
  S: 'Highly interested cx (Sheena)',
  A: 'Highly Interested CX (Ashish)',
};
const customerFields = ['customerId','merchantName','phone','category','subCategory','funnelStage','contactPriority'];
const flagFields = ['customerId','sheet','row','callOverWa','entryPointIssue','insightsIssue','fbLinkingIssue','adsCreativeIssue','paymentIssue','wantsVisit','wantsSampleOverWa','fbPageLinkingPending','legacyTotalTouches','legacyLastContact','legacyCurrentStatus'];
const toObject = (fields, values) => Object.fromEntries(fields.map((k, i) => [k, values[i]]));

const customers = (decoded.u || []).map(values => toObject(customerFields, values));
const calls = (decoded.c || []).map(values => {
  const [customerId, sheetCode, row, n, typeCode, date, agentName, statusRaw, whatHappened, remark, attemptNumber, callSeq] = values;
  const sheet = sheetMap[sheetCode];
  if (!sheet) fail('unknown source sheet code in migration payload');
  const sourceType = typeCode === 1 ? 'legacy_followup' : 'standard_call';
  return {
    customerId,
    sheet,
    row,
    sourceCallNum: typeCode === 1 ? `Callback ${n}` : `Call ${n}`,
    sourceType,
    date,
    agentName: agentName ?? null,
    statusRaw: statusRaw ?? null,
    whatHappened: whatHappened ?? null,
    remark: remark ?? null,
    sourceKey: typeCode === 1 ? `${sheet}|${row}|CB${n}` : `${sheet}|${row}|CALL${n}`,
    attemptNumber,
    callSeq,
  };
});
const flags = (decoded.f || []).map(values => {
  const expanded = [...values];
  const sheet = sheetMap[expanded[1]];
  if (!sheet) fail('unknown source sheet code in legacy flags');
  expanded[1] = sheet;
  return { ...toObject(flagFields, expanded), raw: {} };
});
const [customersN, standardN, followupN, totalN] = decoded.l || [];
const payload = {
  customers,
  calls,
  flags,
  locked: {
    customers: customersN,
    standard_calls: standardN,
    legacy_followups: followupN,
    total_interactions: totalN,
  },
};

const expected = { customers: 1039, standard_calls: 1650, legacy_followups: 233, total_interactions: 1883 };
for (const [k, v] of Object.entries(expected)) {
  if (Number(payload.locked[k]) !== v) fail(`locked baseline mismatch for ${k}`);
}
if (payload.customers.length !== 1039 || payload.calls.length !== 1883) fail('decoded payload row counts do not match locked baselines');
if (payload.calls.filter(c => c.sourceType === 'standard_call').length !== 1650) fail('decoded standard-call count mismatch');
if (payload.calls.filter(c => c.sourceType === 'legacy_followup').length !== 233) fail('decoded legacy-followup count mismatch');

try {
  fs.writeFileSync(out, JSON.stringify(payload), { mode: 0o600 });
  console.log('Encrypted migration payload decrypted and locked baselines verified.');
} catch (err) {
  fail(`could not create temporary migration file: ${err instanceof Error ? err.message : 'unknown error'}`);
}
