import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { verifyPassword } from '@/lib/password';
import { createSession } from '@/lib/auth';

export async function POST(req: Request) {
  const { username, password } = await req.json();
  if (!username || !password) return NextResponse.json({error:'Username and password required'}, {status:400});
  const sql = db();
  const rows = await sql`SELECT id,name,username,role,password_hash,password_salt FROM agents WHERE username=${String(username).trim()} AND active=TRUE LIMIT 1`;
  const agent = rows[0];
  if (!agent || !verifyPassword(String(password), agent.password_salt, agent.password_hash)) {
    return NextResponse.json({error:'Invalid username or password'}, {status:401});
  }
  await createSession(String(agent.id));
  return NextResponse.json({agent:{id:agent.id,name:agent.name,username:agent.username,role:agent.role}});
}
