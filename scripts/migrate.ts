// Applies db/migrations/*.sql in order, each in its own transaction. Runs as the schema OWNER
// (MIGRATE_DATABASE_URL), never as the app role.  Flags: --test (use TEST_ url), --reset (dev/test only)
import { readdirSync, readFileSync } from 'node:fs'
import pg from 'pg'

const test = process.argv.includes('--test')
const url = test
  ? process.env.TEST_MIGRATE_DATABASE_URL ?? 'postgres:///elessons_test'
  : process.env.MIGRATE_DATABASE_URL ?? 'postgres:///elessons_dev'
const db = new pg.Client({ connectionString: url })
await db.connect()

if (process.argv.includes('--reset')) {
  const { rows } = await db.query('select current_database() as name')
  if (!/_(test|dev)$/.test(rows[0].name)) throw new Error(`refusing to reset database "${rows[0].name}"`)
  await db.query('drop schema if exists app cascade; drop schema public cascade; create schema public; grant usage on schema public to public')
}

await db.query('create table if not exists public.schema_migrations (name text primary key, applied_at timestamptz not null default now())')
const done = new Set((await db.query('select name from public.schema_migrations')).rows.map((r) => r.name))
for (const name of readdirSync('db/migrations').filter((f) => f.endsWith('.sql')).sort()) {
  if (done.has(name)) continue
  try {
    await db.query('begin')
    await db.query(readFileSync(`db/migrations/${name}`, 'utf8'))
    await db.query('insert into public.schema_migrations (name) values ($1)', [name])
    await db.query('commit')
    console.log('applied', name)
  } catch (e) {
    await db.query('rollback')
    console.error('FAILED', name)
    throw e
  }
}
await db.end()
