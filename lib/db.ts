import postgres from 'postgres';

let client: ReturnType<typeof postgres> | null = null;

export function db() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
  if (!client) {
    const isLocal = process.env.DATABASE_URL.includes('localhost') || process.env.DATABASE_URL.includes('127.0.0.1');
    client = postgres(process.env.DATABASE_URL, {
      ssl: isLocal ? false : 'require',
      max: 5,
      idle_timeout: 20,
      connect_timeout: 20,
      // No server-side prepared statements: a cached plan breaks with "cached plan must not
      // change result type" when a migration adds columns while connections are open, and
      // Neon's pooled connections don't keep them across transactions anyway.
      prepare: false,
    });
  }
  return client;
}
