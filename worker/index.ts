// The one background worker (PRD s13). Postgres is the queue: claim with FOR UPDATE SKIP LOCKED,
// so several workers can run side by side. Connects as `elessons_worker`.
// ponytail: polling every 2s, no LISTEN/NOTIFY. Add NOTIFY if sub-second webhook latency ever matters.
import { mkdirSync, createWriteStream } from 'node:fs'
import { once } from 'node:events'
import pg from 'pg'
import { applyMapping, normaliseLead } from '../src/lib/ingest/normalize.ts'
import { buildLeadQuery, EXPORT_COLUMNS } from '../src/lib/leads-query.ts'

const log = (level: string, msg: string, extra: object = {}) => console.log(JSON.stringify({ ts: new Date().toISOString(), level, msg, ...extra }))
export const EXPORT_DIR = process.env.EXPORT_DIR ?? 'storage/exports'

export async function processEvents(pool: pg.Pool, limit = 20): Promise<number> {
  const { rows: events } = await pool.query('select * from app.claim_events($1)', [limit])
  for (const e of events) {
    const db = await pool.connect()
    try {
      await db.query('begin')
      const { rows: [ctx] } = await db.query(
        `select coalesce(c.default_country, 'IN') as country, coalesce(c.timezone, 'Asia/Kolkata') as tz, b.mapping, b.list_id
         from (select 1) x left join centres c on c.id = $1 left join import_batches b on b.id = $2`, [e.centre_id, e.import_batch_id])
      const raw = ctx.mapping ? applyMapping(e.payload, ctx.mapping) : e.payload
      const lead = normaliseLead(raw, ctx.country, ctx.tz)
      // an unparseable phone is a final answer ("Invalid"), not a failure to retry
      const payload = lead ? { ...lead, list_id: lead.list_id ?? ctx.list_id ?? undefined } : { phone: null }
      const { rows: [r] } = await db.query('select app.ingest_lead($1, $2) as result', [e.id, JSON.stringify(payload)])
      await db.query('commit')
      log('info', 'event processed', { event_id: e.id, channel: e.channel, ...r.result })
    } catch (err) {
      await db.query('rollback').catch(() => {})
      const { rows: [f] } = await pool.query('select app.fail_event($1, $2) as status', [e.id, String(err)])
      log(f.status === 'dead' ? 'error' : 'warn', 'event failed', { event_id: e.id, status: f.status, error: String(err) })
    } finally { db.release() }
  }
  if (events.length) await pool.query('select app.finish_imports()')
  return events.length
}

const csvCell = (v: unknown) => {
  let s = v == null ? '' : Array.isArray(v) ? v.join('; ') : v instanceof Date ? v.toISOString() : String(v)
  if (/^[=+\-@\t\r]/.test(s) && !/^\+\d+$/.test(s)) s = "'" + s      // CSV formula injection
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export async function processExport(pool: pg.Pool): Promise<boolean> {
  const { rows: [job] } = await pool.query('select * from app.claim_export()')
  if (!job?.id) return false
  const db = await pool.connect()
  let rows = 0
  try {
    const { rows: [c] } = await db.query('select app.claims_for_export($1) as claims', [job.id])
    if (!c.claims) throw new Error('EXPORT_DENIED: user is no longer active')
    mkdirSync(EXPORT_DIR, { recursive: true })
    const path = `${EXPORT_DIR}/${job.id}.csv`
    const out = createWriteStream(path)
    await db.query('begin')
    await db.query('set local role authenticated')            // from here on: the requester's RLS, not the worker's bypass
    await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(c.claims)])
    const { rows: [p] } = await db.query("select app.has_perm('leads.export') as ok")
    if (!p.ok) throw new Error('EXPORT_DENIED: permission was revoked')
    out.write('\uFEFF' + EXPORT_COLUMNS.map((x) => x.header).join(',') + '\n')   // BOM: Excel reads UTF-8 correctly
    let cursor: string | undefined
    for (;;) {   // keyset pages: constant memory at any size
      const q = buildLeadQuery({ ...job.filters, cursor }, 1000, c.claims)
      const page = (await db.query(q.sql, q.params)).rows
      for (const r of page) {
        if (job.mask_phone) r.primary_phone = r.primary_phone && String(r.primary_phone).replace(/^(.{3}).*(.{4})$/, (_, a, b) => a + '•'.repeat(6) + b)
        if (!out.write(EXPORT_COLUMNS.map((x) => csvCell(r[x.key])).join(',') + '\n')) await once(out, 'drain')
      }
      rows += page.length
      if (page.length < 1000) break
      cursor = page.at(-1).cursor
    }
    await db.query('commit')
    out.end(); await once(out, 'finish')
    await pool.query('select app.finish_export($1, $2, $3, null)', [job.id, rows, path])
    log('info', 'export done', { job_id: job.id, rows })
  } catch (err) {
    await db.query('rollback').catch(() => {})
    await pool.query('select app.finish_export($1, $2, null, $3)', [job.id, rows, String(err)])
    log('error', 'export failed', { job_id: job.id, error: String(err) })
  } finally { db.release() }
  return true
}

if (import.meta.main) {
  const pool = new pg.Pool({ connectionString: process.env.WORKER_DATABASE_URL ?? 'postgres://elessons_worker@localhost/elessons_dev', max: 4 })
  let running = true
  for (const s of ['SIGINT', 'SIGTERM'] as const) process.on(s, () => { running = false })
  log('info', 'worker started')
  while (running) {
    try {
      const n = await processEvents(pool)
      const x = await processExport(pool)
      if (!n && !x) await new Promise((r) => setTimeout(r, 2000))
    } catch (err) {
      log('error', 'worker loop error', { error: String(err) })
      await new Promise((r) => setTimeout(r, 5000))
    }
  }
  await pool.end()
}
