import fs from 'fs';
import crypto from 'crypto';

const repo = process.env.GITHUB_REPOSITORY;
const token = process.env.GITHUB_TOKEN;
const keyB64 = process.env.MIGRATION_DATA_KEY;
const issue = process.env.MIGRATION_PAYLOAD_ISSUE || '1';
const out = process.env.MIGRATION_SOURCE_XLSX || '/tmp/Disposition Sheet - Sellers.xlsx';

function fail(message) {
  console.error(`Migration source error: ${message}`);
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
  if (!res.ok) fail(`could not fetch encrypted source comments (HTTP ${res.status})`);
  comments = await res.json();
} catch (err) {
  fail(`could not fetch encrypted source comments: ${err instanceof Error ? err.message : 'unknown error'}`);
}

const parts = comments
  .map(c => String(c.body || ''))
  .map(body => {
    const m = body.match(/^PART(\d{2})\n([\s\S]+)$/);
    return m ? { n: Number(m[1]), data: m[2].trim() } : null;
  })
  .filter(Boolean)
  .sort((a, b) => a.n - b.n);

if (!parts.length) fail('no encrypted source parts found');
for (let i = 0; i < parts.length; i++) {
  if (parts[i].n !== i + 1) fail(`missing/out-of-order encrypted source part: expected PART${String(i + 1).padStart(2, '0')}`);
}

let envelope;
try {
  envelope = JSON.parse(parts.map(p => p.data).join(''));
} catch {
  fail('encrypted source envelope is malformed');
}
if (envelope?.version !== 1 || envelope?.kind !== 'xlsx') fail('encrypted source envelope version/type is invalid');

let workbook;
try {
  const nonce = Buffer.from(envelope.nonce, 'base64');
  const packed = Buffer.from(envelope.ciphertext, 'base64');
  if (nonce.length !== 12 || packed.length <= 16) fail('encrypted source dimensions are invalid');
  const tag = packed.subarray(packed.length - 16);
  const ciphertext = packed.subarray(0, packed.length - 16);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce);
  decipher.setAuthTag(tag);
  workbook = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
} catch {
  fail('authentication/decryption failed; source workbook was not used');
}

// XLSX/ZIP files begin with PK. This is only a quick format guard; the parser and
// locked reconciliation checks remain the authoritative validation before writes.
if (workbook.length < 1000 || workbook[0] !== 0x50 || workbook[1] !== 0x4b) fail('decrypted source is not a valid XLSX container');

try {
  fs.writeFileSync(out, workbook, { mode: 0o600 });
  console.log('Encrypted historical workbook decrypted successfully.');
} catch (err) {
  fail(`could not create temporary workbook: ${err instanceof Error ? err.message : 'unknown error'}`);
}
