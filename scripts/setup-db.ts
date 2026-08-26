import fs from 'fs';
import path from 'path';
import postgres from 'postgres';

async function main() {
  const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!url) throw new Error('Set DATABASE_URL (or DIRECT_URL) first');
  const isLocal = url.includes('localhost') || url.includes('127.0.0.1');
  const sql = postgres(url, { ssl: isLocal ? false : 'require', max: 1 });
  const migration = fs.readFileSync(path.join(process.cwd(),'db','001_init.sql'),'utf8');
  await sql.unsafe(migration);
  await sql.end();
  console.log('Database tables created/verified.');
}
main().catch(e => { console.error(e); process.exit(1); });
