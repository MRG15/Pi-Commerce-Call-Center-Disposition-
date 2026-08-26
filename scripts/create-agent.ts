import { db } from '../lib/db';
import { hashPassword } from '../lib/password';

function arg(name: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i+1] : undefined;
}

async function main() {
  const username = arg('username');
  const name = arg('name');
  const password = arg('password');
  const role = arg('role') || 'agent';
  if (!username || !name || !password) {
    throw new Error('Usage: npm run agent:create -- --username madhav --name "Madhav" --password "..." --role admin');
  }
  if (!['agent','admin'].includes(role)) throw new Error('role must be agent or admin');
  const {salt,hash} = hashPassword(password);
  const sql = db();
  await sql`
    INSERT INTO agents (name,username,password_hash,password_salt,role)
    VALUES (${name},${username},${hash},${salt},${role})
    ON CONFLICT (username) DO UPDATE SET name=EXCLUDED.name,password_hash=EXCLUDED.password_hash,password_salt=EXCLUDED.password_salt,role=EXCLUDED.role,active=TRUE
  `;
  console.log(`Agent ${username} created/updated.`);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
