import assert from 'node:assert/strict'
import pg from 'pg'
import { claimsForToken, login } from '../src/lib/auth-core.ts'
import { withTenant, type Claims } from '../src/lib/db.ts'
import { normaliseLead } from '../src/lib/ingest/normalize.ts'
import { seed, SEED_PASSWORD } from '../scripts/seed.ts'

export const owner = new pg.Client({ connectionString: process.env.TEST_MIGRATE_DATABASE_URL ?? 'postgres:///elessons_test' })
export const workerPool = new pg.Pool({ connectionString: process.env.TEST_WORKER_DATABASE_URL ?? 'postgres://elessons_worker@localhost/elessons_test', max: 3 })

export async function ensureSeed() {
  await owner.connect()
  if (!(await owner.query('select 1 from orgs')).rowCount) await seed(owner)
}
export const one = async <T = any>(sql: string, p: unknown[] = []): Promise<T> => (await owner.query(sql, p)).rows[0]
export const as = async (code: string, username: string): Promise<Claims> => {
  const r = await login(code, username, SEED_PASSWORD, '10.0.0.1', 'test')
  assert.ok(r.ok, `login ${code}/${username}`)
  return (await claimsForToken(r.token))!
}
export const denied = (p: Promise<unknown>, re = /permission denied|PERMISSION_DENIED|row-level security|NOT_FOUND|READ_ONLY|EXPORT_DENIED/) => assert.rejects(p, re)

let seq = 0
// Manual entry exactly as the server action does it: normalise in TS, then receive + ingest in one transaction.
export async function addLead(claims: Claims, raw: Record<string, unknown>, opts: { key?: string; centre?: string | null } = {}) {
  const lead = normaliseLead(raw, 'IN', 'Asia/Kolkata')
  assert.ok(lead, 'test phone must be valid')
  return withTenant(claims, async (db) => {
    const { rows: [e] } = await db.query('select app.receive_event($1,$2,$3,$4) as id',
      ['manual', opts.centre ?? claims.centre_id, opts.key ?? `test:${process.pid}:${++seq}`, JSON.stringify(raw)])
    const { rows: [r] } = await db.query('select app.ingest_lead($1,$2) as r', [e.id, JSON.stringify(lead)])
    return r.r as { outcome: string; lead_id: string; replayed?: boolean }
  })
}
export const disposition = async (name: string) => (await one('select id from dispositions where name = $1', [name])).id as string

// a fetch that must never be reached by tests that don't involve an external API
export const noFetch = { fetch: (async (url: unknown) => { throw new Error('unexpected external call: ' + url) }) as typeof fetch }
