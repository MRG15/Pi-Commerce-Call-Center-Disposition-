import { createHash, randomBytes } from 'crypto';
import { cookies } from 'next/headers';
import { db } from './db';

const COOKIE = 'pi_session';
const DAYS = 7;

function tokenHash(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

export async function createSession(agentId: string) {
  const token = randomBytes(32).toString('base64url');
  const hash = tokenHash(token);
  const expires = new Date(Date.now() + DAYS * 86400_000);
  const sql = db();
  await sql`INSERT INTO sessions (token_hash, agent_id, expires_at) VALUES (${hash}, ${agentId}::uuid, ${expires})`;
  const jar = await cookies();
  jar.set(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires,
  });
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) {
    const sql = db();
    await sql`DELETE FROM sessions WHERE token_hash = ${tokenHash(token)}`;
  }
  jar.set(COOKIE, '', { httpOnly: true, path: '/', expires: new Date(0) });
}

export async function currentAgent() {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return null;
  const sql = db();
  const rows = await sql`
    SELECT a.id, a.name, a.username, a.role
    FROM sessions s
    JOIN agents a ON a.id = s.agent_id
    WHERE s.token_hash = ${tokenHash(token)}
      AND s.expires_at > now()
      AND a.active = TRUE
    LIMIT 1
  `;
  return rows[0] ?? null;
}
