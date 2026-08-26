import fs from 'fs';
import crypto from 'crypto';
import zlib from 'zlib';

const repo = process.env.GITHUB_REPOSITORY;
const token = process.env.GITHUB_TOKEN;
const keyB64 = process.env.MIGRATION_DATA_KEY;
const issue = process.env.MIGRATION_PAYLOAD_ISSUE || '1';
const out = process.env.MIGRATION_PAYLOAD_JSON || '/tmp/pi-migration-payload.json';

function fail(message) {
  // Keep failure messages intentionally small: never print the encrypted payload,
  // decrypted customer data, tokens, keys, or database credentials to Actions logs.
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

/*
 * The payload was split across GitHub comments after encryption. A quote was
 * introduced at one chunk seam, which makes a literal JSON.parse of the joined
 * comments invalid even though the encrypted bytes themselves are intact.
 *
 * Reconstruct the envelope defensively: read the small metadata fields from the
 * prefix, then collect only base64 characters belonging to ciphertext. AES-GCM
 * authentication below is the integrity check, so any altered/missing byte will
 * still fail closed before customer data is written anywhere.
 */
const joined = parts.map(p => p.data).join('');
const nonceMatch = joined.match(/"nonce"\s*:\s*"([A-Za-z0-9+/=]+)"/);
const cipherMarker = '"ciphertext":"';
const cipherStart = joined.indexOf(cipherMarker);
if (!nonceMatch || cipherStart < 0) fail('encrypted envelope metadata is malformed');

const afterMarker = joined.slice(cipherStart + cipherMarker.length);
// Ciphertext is the final value in this envelope. Ignore JSON punctuation and
// accidental quote characters at comment seams; retain only base64 bytes.
const cipherB64 = afterMarker.replace(/[^A-Za-z0-9+/=]/g, '');
if (!cipherB64 || cipherB64.length < 32) fail('encrypted ciphertext is missing or truncated');

let payload;
try {
  const nonce = Buffer.from(nonceMatch[1], 'base64');
  const packed = Buffer.from(cipherB64, 'base64');
  if (nonce.length !== 12 || packed.length <= 16) fail('encrypted payload dimensions are invalid');

  const tag = packed.subarray(packed.length - 16);
  const ciphertext = packed.subarray(0, packed.length - 16);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce);
  decipher.setAuthTag(tag);
  const compressed = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  const json = zlib.gunzipSync(compressed).toString('utf8');
  payload = JSON.parse(json);
} catch {
  fail('authentication/decryption failed; payload was not used');
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
