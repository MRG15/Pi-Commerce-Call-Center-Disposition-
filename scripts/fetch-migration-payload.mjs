import fs from 'fs';
import crypto from 'crypto';
import zlib from 'zlib';

const repo = process.env.GITHUB_REPOSITORY;
const token = process.env.GITHUB_TOKEN;
const keyB64 = process.env.MIGRATION_DATA_KEY;
const issue = process.env.MIGRATION_PAYLOAD_ISSUE || '1';
const out = process.env.MIGRATION_PAYLOAD_JSON || '/tmp/pi-migration-payload.json';

if (!repo || !token || !keyB64) throw new Error('Missing GITHUB_REPOSITORY, GITHUB_TOKEN or MIGRATION_DATA_KEY');
const key = Buffer.from(keyB64, 'base64');
if (key.length !== 32) throw new Error('MIGRATION_DATA_KEY must decode to exactly 32 bytes');

const res = await fetch(`https://api.github.com/repos/${repo}/issues/${issue}/comments?per_page=100`, {
  headers: {
    authorization: `Bearer ${token}`,
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
  },
});
if (!res.ok) throw new Error(`Could not fetch encrypted payload comments: ${res.status} ${await res.text()}`);
const comments = await res.json();

const parts = comments
  .map(c => String(c.body || ''))
  .map(body => {
    const m = body.match(/^PART(\d{2})\n([\s\S]+)$/);
    return m ? { n: Number(m[1]), data: m[2].trim() } : null;
  })
  .filter(Boolean)
  .sort((a,b) => a.n - b.n);

if (!parts.length) throw new Error('No migration payload parts found');
for (let i = 0; i < parts.length; i++) {
  if (parts[i].n !== i + 1) throw new Error(`Missing/out-of-order migration payload part: expected PART${String(i+1).padStart(2,'0')}`);
}

const envelope = JSON.parse(parts.map(p => p.data).join(''));
if (envelope.alg !== 'AES-256-GCM' || envelope.format !== 'gzip-json') throw new Error('Unsupported migration payload format');

const nonce = Buffer.from(envelope.nonce, 'base64');
const packed = Buffer.from(envelope.ciphertext, 'base64');
const tag = packed.subarray(packed.length - 16);
const ciphertext = packed.subarray(0, packed.length - 16);
const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce);
decipher.setAuthTag(tag);
const compressed = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
const json = zlib.gunzipSync(compressed).toString('utf8');
const payload = JSON.parse(json);

const locked = payload.locked || {};
const expected = { customers:1039, standard_calls:1650, legacy_followups:233, total_interactions:1883 };
for (const [k,v] of Object.entries(expected)) {
  if (Number(locked[k]) !== v) throw new Error(`Encrypted payload baseline mismatch for ${k}`);
}

fs.writeFileSync(out, JSON.stringify(payload));
console.log(`Decrypted and verified migration payload -> ${out}`);
