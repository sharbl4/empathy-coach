import { Pool } from 'pg';
import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export async function migrate(pool: Pool) {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock(748311902)');
    await client.query('CREATE SCHEMA IF NOT EXISTS app');
    await client.query('REVOKE ALL ON SCHEMA app FROM PUBLIC');
    await client.query('CREATE TABLE IF NOT EXISTS app.schema_migrations(version text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
    const directory = new URL('../../migrations/', import.meta.url);
    const files = (await readdir(directory)).filter(f => /^\d+_[a-z0-9_]+\.sql$/.test(f)).sort();
    if (!files.length) throw new Error('No migration files');
    const applied = await client.query<{version:string; checksum:string}>('SELECT version,checksum FROM app.schema_migrations');
    if (applied.rows.some(row => !files.includes(row.version))) throw new Error('Applied migration missing');
    for (const version of files) {
      const sql = await readFile(new URL(version, directory), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const old = applied.rows.find(row => row.version === version);
      if (old) { if (old.checksum !== checksum) throw new Error('Applied migration changed'); continue; }
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO app.schema_migrations(version,checksum) VALUES($1,$2)', [version,checksum]);
        await client.query('COMMIT');
      } catch (error) { await client.query('ROLLBACK'); throw error; }
    }
  } finally { await client.query('SELECT pg_advisory_unlock(748311902)').catch(() => {}); client.release(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.env.DATABASE_URL) { console.error('DATABASE_URL is required'); process.exitCode=1; }
  else {
    const pool = new Pool({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:5000});
    try { await migrate(pool); console.info('Migrations applied'); }
    catch { console.error('Migration failed; verify database access and migration history'); process.exitCode=1; }
    finally { await pool.end(); }
  }
}
