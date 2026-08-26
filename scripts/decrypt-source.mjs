import fs from 'fs';
import crypto from 'crypto';
import path from 'path';

const keyB64 = process.env.MIGRATION_DATA_KEY;
if (!keyB64) throw new Error('Missing MIGRATION_DATA_KEY');

const key = Buffer.from(keyB64, 'base64');
if (key.length !== 32) throw new Error('MIGRATION_DATA_KEY must decode to exactly 32 bytes');

const payloadPath = path.join(process.cwd(), 'migration', 'disposition-source.enc.json');
const outPath = path.join(process.cwd(), 'source', 'Disposition Sheet - Sellers.xlsx');
const payload = JSON.parse(fs.readFileSync(payloadPath, 'utf8'));

if (payload.alg !== 'AES-256-GCM') throw new Error('Unsupported encrypted source format');
const nonce = Buffer.from(payload.nonce, 'base64');
const packed = Buffer.from(payload.ciphertext, 'base64');
const tag = packed.subarray(packed.length - 16);
const ciphertext = packed.subarray(0, packed.length - 16);

const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce);
decipher.setAuthTag(tag);
const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, plaintext);
console.log(`Decrypted migration workbook to ${outPath}`);
