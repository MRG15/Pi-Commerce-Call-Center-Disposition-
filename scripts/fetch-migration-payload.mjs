import fs from 'fs';
import crypto from 'crypto';
import zlib from 'zlib';

const repo = process.env.GITHUB_REPOSITORY;
const token = process.env.GITHUB_TOKEN;
const keyB64 = process.env.MIGRATION_DATA_KEY;
const issue = process.env.MIGRATION_PAYLOAD_ISSUE || '1';
const out = process.env.MIGRATION_PAYLOAD_JSON || '/tmp/pi-migration-payload.json';

function fail(message) {
  // Never print encrypted/decrypted customer data, keys, tokens, or DB credentials.
  console.error(`Migration payload error: ${message}`);
  process.exit(1);
}

if (!repo || !token || !keyB64) fail('missing required GitHub or migration-key environment variable');

const key = Buffer.from(keyB64, 'base64');
if (key.length !== 32) fail('MIGRATION_DATA_KEY is invalid');

let comments;
try {
  const res = await fetch(`https://api.github.com/repos/${repo}/issues/${issue}/comments?per_page=100`, {
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
    },
  });
  if (!res.ok) fail(`could not fetch encrypted payload comments (HTTP ${res.status})`);
  comments = await res.json();
} catch (err) {
  fail(`could not fetch encrypted payload comments: ${err instanceof Error ? err.message : 'unknown error'}`);
}

const parts = comments
  .map(c => String(c.body || ''))
  .map(body => {
    const m = body.match(/^PART(\d{2})\n([\s\S]+)$/);
    return m ? { n: Number(m[1]), data: m[2].trim() } : null;
  })
  .filter(Boolean)
  .sort((a, b) => a.n - b.n);

if (!parts.length) fail('no migration payload parts found');
for (let i = 0; i < parts.length; i++) {
  if (parts[i].n !== i + 1) {
    fail(`missing/out-of-order migration payload part: expected PART${String(i + 1).padStart(2, '0')}`);
  }
}

const joined = parts.map(p => p.data).join('');
const nonceMatch = joined.match(/"nonce"\s*:\s*"([A-Za-z0-9+/=]+)"/);
const formatMatch = joined.match(/"format"\s*:\s*"([^"]+)"/);
const cipherMarker = '"ciphertext":"';
const cipherStart = joined.indexOf(cipherMarker);
if (!nonceMatch || !formatMatch || cipherStart < 0) fail('encrypted envelope metadata is malformed');

const afterMarker = joined.slice(cipherStart + cipherMarker.length);
// Ciphertext is the final value in the envelope. Ignore punctuation introduced
// at comment seams and retain only base64 bytes. AES-GCM authenticates integrity.
const cipherB64 = afterMarker.replace(/[^A-Za-z0-9+/=]/g, '');
if (!cipherB64 || cipherB64.length < 32) fail('encrypted ciphertext is missing or truncated');

let decoded;
try {
  const nonce = Buffer.from(nonceMatch[1], 'base64');
  const packed = Buffer.from(cipherB64, 'base64');
  if (nonce.length !== 12 || packed.length <= 16) fail('encrypted payload dimensions are invalid');

  const tag = packed.subarray(packed.length - 16);
  const ciphertext = packed.subarray(0, packed.length - 16);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce);
  decipher.setAuthTag(tag);
  const compressed = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

  if (formatMatch[1] === 'gzip-json') {
    decoded = JSON.parse(zlib.gunzipSync(compressed).toString('utf8'));
  } else if (formatMatch[1] === 'brotli-compact-v1') {
    decoded = JSON.parse(zlib.brotliDecompressSync(compressed).toString('utf8'));
  } else {
    fail('unsupported encrypted migration payload format');
  }
} catch {
  fail('authentication/decryption failed; payload was not used');
}

let payload;
if (formatMatch[1] === 'brotli-compact-v1') {
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
      sourceCallNum: typeCode === 1 ? `Legacy Callback ${n}` : `Call ${n}`,
      sourceType,
      date,
      agentName: agentName ?? null,
      statusRaw: statusRaw ?? null,
      whatHappened: whatHappened ?? null,
      remark: remark ?? null,
      sourceKey: typeCode === 1 ? `${sheet}|${row}|LEGACY_FOLLOWUP_${n}` : `${sheet}|${row}|CALL${n}`,
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
  payload = {
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
} else {
  payload = decoded;
}

const locked = payload?.locked || {};
const expected = {
  customers: 1039,
  standard_calls: 1650,
  legacy_followups: 233,
  total_interactions: 1883,
};
for (const [k, v] of Object.entries(expected)) {
  if (Number(locked[k]) !== v) fail(`locked baseline mismatch for ${k}`);
}

try {
  fs.writeFileSync(out, JSON.stringify(payload), { mode: 0o600 });
  console.log('Encrypted migration payload decrypted and locked baselines verified.');
} catch (err) {
  fail(`could not create temporary migration file: ${err instanceof Error ? err.message : 'unknown error'}`);
}
