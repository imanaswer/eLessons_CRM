// The one background worker (PRD s13). Postgres is the queue: every queue is claimed with FOR UPDATE SKIP LOCKED,
// so several workers can run side by side. Connects as `elessons_worker`, the only RLS-exempt principal.
// External calls go through `deps.fetch` so the whole worker runs against a mock in tests.
import { mkdirSync, createWriteStream } from 'node:fs'
import { once } from 'node:events'
import pg from 'pg'
import { decrypt, hmacHex } from '../src/lib/crypto.ts'
import { applyMapping, normaliseLead } from '../src/lib/ingest/normalize.ts'
import { buildLeadQuery, EXPORT_COLUMNS } from '../src/lib/leads-query.ts'
import { capiPayload, fetchLead, fetchSpend, mapLeadFields, MetaError, sendCapi, type Fetch } from '../src/lib/meta.ts'
import { sendMessage } from '../src/lib/whatsapp.ts'

export const log = (level: string, msg: string, extra: object = {}) => console.log(JSON.stringify({ ts: new Date().toISOString(), level, msg, ...extra }))
export const EXPORT_DIR = process.env.EXPORT_DIR ?? 'storage/exports'
export type Deps = { fetch: Fetch; sendPush?: (endpoint: string, keys: object, payload: string) => Promise<void> }
const secret = (enc: string | null) => (enc ? decrypt(enc) : null)

// ---------------------------------------------------------------- inbound events (every channel)
export async function processEvents(pool: pg.Pool, deps: Deps, limit = 20): Promise<number> {
  // RETURNING order is not the subquery's order: sort so events are processed first-in first-out (round-robin fairness)
  const { rows: events } = await pool.query('select * from app.claim_events($1) order by received_at, id', [limit])
  for (const e of events) {
    const db = await pool.connect()
    try {
      await db.query('begin')
      const r = await processOne(db, deps, e)
      await db.query('commit')
      if (e.connector_id) await pool.query('select app.connection_result($1, null)', [e.connector_id])
      log('info', 'event processed', { event_id: e.id, channel: e.channel, ...r })
    } catch (err) {
      await db.query('rollback').catch(() => {})
      const { rows: [f] } = await pool.query('select app.fail_event($1, $2) as status', [e.id, String(err)])
      if (e.connector_id) await pool.query('select app.connection_result($1, $2)', [e.connector_id, String(err)])
      log(f.status === 'dead' ? 'error' : 'warn', 'event failed', { event_id: e.id, channel: e.channel, status: f.status, error: String(err) })
    } finally { db.release() }
  }
  if (events.length) await pool.query('select app.finish_imports()')
  return events.length
}

async function processOne(db: pg.PoolClient, deps: Deps, e: Record<string, any>): Promise<object> {
  const { rows: [ctx] } = await db.query(
    `select coalesce(c.default_country, 'IN') as country, coalesce(c.timezone, 'Asia/Kolkata') as tz, b.mapping, b.list_id, b.kind as batch_kind,
            k.secret_enc, k.config, k.kind as conn_kind, k.centre_id as conn_centre
     from (select 1) x left join centres c on c.id = $1 left join import_batches b on b.id = $2 left join connections k on k.id = $3`, [e.centre_id, e.import_batch_id, e.connector_id])
  let raw: Record<string, unknown> = e.payload
  switch (e.channel) {
    case 'meta': {           // leadgen webhook: fetch the lead with the PAGE token, then map
      const token = secret(ctx.secret_enc); if (!token) throw new Error('Page token missing: reconnect the page')
      const lead = await fetchLead(deps.fetch, String(e.payload.leadgen_id), token)
      const { rows: [fm] } = await db.query('select mapping from field_mappings where connection_id = $1 and form_id in ($2, $3) order by (form_id = $2) desc limit 1', [e.connector_id, lead.form_id ?? '', ''])
      const { rows: [form] } = await db.query('select name, list_id from connection_forms where connection_id = $1 and form_id = $2', [e.connector_id, lead.form_id ?? ''])
      const { rows: [conn] } = await db.query('select name from connections where id = $1', [e.connector_id])
      raw = { ...mapLeadFields(lead.field_data, fm?.mapping ?? {}), meta: { page_id: e.payload.page_id, form_id: lead.form_id, campaign_id: lead.campaign_id, ad_id: lead.ad_id, leadgen_id: lead.id },
        source: { l1: 'Meta', l2: conn?.name, l3: lead.campaign_name ?? lead.campaign_id, l4: form?.name ?? lead.ad_name ?? lead.form_id }, list_id: form?.list_id,
        consent: { status: 'granted', source: 'meta_lead_form', evidence: { leadgen_id: lead.id, created_time: lead.created_time } } }
      break
    }
    case 'website': case 'lms': case 'payment': {
      const p = e.payload as Record<string, any>, type = String(p.event ?? p.type ?? (e.channel === 'payment' ? 'payment' : 'lead'))
      if (/^(payment|payment_.*)$/.test(type) || e.channel === 'payment') return await money(db, deps, e, p, ctx)
      if (['demo_completed', 'checkout_started', 'checkout_abandoned', 'signup', 'lms_activity'].includes(type)) {
        const phone = p.phone ? normaliseLead({ phone: p.phone }, ctx.country, ctx.tz)?.phone ?? null : null
        let { rows: [m] } = await db.query('select app.match_lead($1, $2, $3, $4) as id', [e.org_id, phone, p.email ?? null, e.centre_id])
        if (!m.id && type === 'signup' && phone) {          // an unknown parent signing up is a lead like any other
          const lead = normaliseLead({ ...p, source: { l1: 'Website', l2: 'Signup' } }, ctx.country, ctx.tz)
          const { rows: [r] } = await db.query('select app.ingest_lead($1, $2) as result', [e.id, JSON.stringify(lead ?? { phone: null })])
          return r.result
        }
        if (!m.id) { await db.query('select app.ignore_event($1, $2)', [e.id, 'No matching lead for this event']); return { outcome: 'ignored' } }
        await db.query('select app.record_site_event($1, $2, $3, $4)', [e.id, type, m.id, JSON.stringify(p)])
        return { outcome: 'event', type, lead_id: m.id }
      }
      raw = { ...p, source: { l1: p.source?.l1 ?? 'Website', l2: p.source?.l2 ?? p.form_name ?? p.utm_source ?? 'elessons.net', l3: p.utm_campaign, l4: p.utm_content }, referral_code: p.ref ?? p.referral_code ?? p.coupon }
      break
    }
    case 'whatsapp': {
      const p = e.payload as Record<string, any>
      const { rows: [r] } = await db.query('select app.record_inbound_message($1,$2,$3,$4,$5,$6,$7,$8) as r', [e.id, e.connector_id, p.wa_id, p.id, p.kind ?? 'text', p.body ?? null, p.media ?? null, p.at ?? new Date()])
      return r.r
    }
    case 'whatsapp_status': {
      const p = e.payload as Record<string, any>
      await db.query('select app.message_status($1, $2, $3)', [p.id, p.status, p.at ?? new Date()])
      await db.query("select app.ignore_event($1, 'status update applied')", [e.id])
      return { outcome: 'status', status: p.status }
    }
    case 'api': case 'google_ads': raw = { ...e.payload, source: e.payload.source ?? { l1: e.channel === 'google_ads' ? 'Google Ads' : 'API', l2: e.payload.source_name ?? e.channel } }; break
    case 'migration': raw = ctx.mapping ? salesmaxRow(e.payload, ctx.mapping) : e.payload; break
    default: raw = ctx.mapping ? applyMapping(e.payload, ctx.mapping) : e.payload
  }
  const lead = normaliseLead(raw, ctx.country, ctx.tz)
  const payload = lead ? { ...lead, list_id: lead.list_id ?? ctx.list_id ?? undefined } : { phone: null }    // unparseable phone = final "invalid", not a retry
  const { rows: [r] } = await db.query('select app.ingest_lead($1, $2) as result', [e.id, JSON.stringify(payload)])
  return r.result
}

// Salesmax export row -> gate payload with the migration block (MG-2). Mapping: {field: column}; extra keys prefixed sm_.
function salesmaxRow(row: Record<string, unknown>, m: Record<string, string>) {
  const g = (k: string) => (m[k] ? row[m[k]!] : undefined)
  return { ...applyMapping(row, m), source: { l1: g('sm_source_l1') ?? 'Salesmax', l2: g('sm_source_l2'), l3: g('sm_source_l3'), l4: g('sm_source_l4') },
    tags: String(g('sm_tags') ?? '').split(/[;,]/).map((t) => t.trim()).filter(Boolean),
    migration: { id: g('salesmax_id'), created_at: g('sm_created_at'), owner_username: g('sm_owner'), centre_code: g('sm_centre_code'), lifecycle: g('sm_lifecycle'),
      last_disposition: g('sm_last_disposition'), next_followup_at: g('sm_next_followup'), attempts: g('sm_attempts'), closed_reason: g('sm_closed_reason') } }
}

async function money(db: pg.PoolClient, deps: Deps, e: Record<string, any>, p: Record<string, any>, ctx: Record<string, any>) {
  const phone = p.phone ? normaliseLead({ phone: p.phone }, ctx.country, ctx.tz)?.phone ?? null : null
  const status = String(p.status ?? p.event ?? '').replace(/^payment[_.]?/, '') || 'received'
  const norm = { status: ({ captured: 'received', paid: 'received', success: 'received', succeeded: 'received', completed: 'received', authorized: 'requested', created: 'requested', pending: 'requested', partial: 'partial', failed: 'failed', declined: 'failed' } as Record<string, string>)[status] ?? status,
    amount: p.amount, currency: p.currency, external_id: p.payment_id ?? p.order_id ?? p.id, gateway: p.gateway ?? ctx.conn_kind, channel: e.channel, paid_at: p.paid_at,
    deal_id: p.deal_id, student_name: p.student_name, grade: p.grade, academic_year: p.academic_year, access_end_date: p.access_end_date }
  let { rows: [m] } = await db.query('select app.match_lead($1, $2, $3, $4) as id', [e.org_id, phone, p.email ?? null, e.centre_id])
  if (!m.id) {             // DL-9: no lead exists -> create one (source Direct purchase / referral) through the gate, then attach the payment
    if (!phone) { await db.query('select app.ignore_event($1, $2)', [e.id, 'Payment without a phone number and no matching email']); return { outcome: 'ignored' } }
    const lead = normaliseLead({ phone: p.phone, name: p.name ?? p.customer_name, email: p.email, source: { l1: 'Website', l2: 'Direct purchase' }, referral_code: p.ref ?? p.referral_code ?? p.coupon,
      students: p.student_name ? [{ name: p.student_name, grade: p.grade }] : [], consent: { status: 'granted', source: 'checkout' } }, ctx.country, ctx.tz)
    const { rows: [r] } = await db.query('select app.ingest_lead($1, $2) as result', [e.id, JSON.stringify(lead ?? { phone: null })])
    if (!r.result.lead_id) return r.result
    await db.query('select app.reopen_event($1)', [e.id])
    m = { id: r.result.lead_id }
  }
  const { rows: [r] } = await db.query('select app.record_payment($1, $2, $3) as result', [e.id, m.id, JSON.stringify(norm)])
  return { outcome: 'payment', ...r.result }
}

// ---------------------------------------------------------------- exports (unchanged: runs AS THE REQUESTER)
const csvCell = (v: unknown) => {
  let s = v == null ? '' : Array.isArray(v) ? v.join('; ') : v instanceof Date ? v.toISOString() : String(v)
  if (/^[=+\-@\t\r]/.test(s) && !/^\+\d+$/.test(s)) s = "'" + s
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
    await db.query('set local role authenticated')
    await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(c.claims)])
    const { rows: [p] } = await db.query("select app.has_perm('leads.export') as ok")
    if (!p.ok) throw new Error('EXPORT_DENIED: permission was revoked')
    out.write('﻿' + EXPORT_COLUMNS.map((x) => x.header).join(',') + '\n')
    let cursor: string | undefined
    for (;;) {
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
  } catch (err) {
    await db.query('rollback').catch(() => {})
    await pool.query('select app.finish_export($1, $2, null, $3)', [job.id, rows, String(err)])
    log('error', 'export failed', { job_id: job.id, error: String(err) })
  } finally { db.release() }
  return true
}

// ---------------------------------------------------------------- outbound queues
export async function processMessages(pool: pg.Pool, deps: Deps): Promise<number> {
  const { rows } = await pool.query('select * from app.claim_outbound_messages(20)')
  for (const m of rows) {
    try {
      const token = secret(m.secret_enc); if (!token) throw new Error('WhatsApp token missing')
      const id = await sendMessage(deps.fetch, m.phone_number_id, token, { to: m.wa_id, body: m.body, kind: m.kind, template_name: m.template_name, language: m.language, header_media_url: m.header_media_url })
      await pool.query('select app.message_result($1, $2, null)', [m.id, id])
      await pool.query('select app.connection_result($1, null)', [m.connection_id])
    } catch (err) {
      await pool.query('select app.message_result($1, null, $2)', [m.id, String(err)])
      await pool.query('select app.connection_result($1, $2)', [m.connection_id, String(err)])
      log('warn', 'message failed', { message_id: m.id, error: String(err) })
    }
  }
  return rows.length
}
export async function processConversions(pool: pg.Pool, deps: Deps): Promise<number> {
  const { rows } = await pool.query('select * from app.claim_conversions(20)')
  for (const c of rows) {
    try {
      const token = secret(c.secret_enc); if (!token) throw new Error('Page token missing')
      await sendCapi(deps.fetch, c.pixel_id, token, capiPayload({ event_name: c.event_name, event_id: c.event_key, event_time: Math.floor(+c.created_at / 1000), phone_hash: c.phone_hash, email_hash: c.email_hash,
        value: c.event_name === 'Enrolled' && Number(c.revenue) > 0 ? Number(c.revenue) : undefined, currency: c.currency }))
      await pool.query('select app.finish_conversion($1, null)', [c.id]); await pool.query('select app.connection_result($1, null)', [c.connection_id])
    } catch (err) { await pool.query('select app.finish_conversion($1, $2)', [c.id, String(err)]); if (err instanceof MetaError && err.reconnect) await pool.query('select app.connection_result($1, $2)', [c.connection_id, String(err)]) }
  }
  return rows.length
}
export async function processDeliveries(pool: pg.Pool, deps: Deps): Promise<number> {
  const { rows } = await pool.query('select * from app.claim_deliveries(20)')
  for (const d of rows) {
    try {
      if (d.url.startsWith('mailto:')) {        // EMAIL: no provider configured (NEEDED.md). Logged, then marked failed so it is visible, never silently dropped.
        throw new Error('EMAIL_PROVIDER_NOT_CONFIGURED: set EMAIL_* in .env and implement src/lib/email.ts')
      }
      if (!/^https:\/\//.test(d.url)) throw new Error('Outbound webhooks must use https')
      const body = JSON.stringify({ event: d.event, id: d.id, sent_at: new Date().toISOString(), data: d.payload })
      const sig = d.secret_enc ? hmacHex(decrypt(d.secret_enc), body) : undefined
      const res = await deps.fetch(d.url, { method: 'POST', headers: { 'content-type': 'application/json', ...(sig ? { 'x-elessons-signature': `sha256=${sig}` } : {}) }, body, signal: AbortSignal.timeout(10000) })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      await pool.query('select app.finish_delivery($1, null)', [d.id])
    } catch (err) { await pool.query('select app.finish_delivery($1, $2)', [d.id, String(err)]) }
  }
  return rows.length
}
export async function processPushes(pool: pg.Pool, deps: Deps): Promise<number> {
  if (!deps.sendPush) return 0
  const { rows } = await pool.query('select * from app.claim_pushes(50)')
  for (const n of rows) {
    try { await deps.sendPush(n.endpoint, n.keys, JSON.stringify({ title: n.title, body: n.body, url: n.lead_id ? `/leads?lead=${n.lead_id}` : '/todos' })) }
    catch (err) { await pool.query('select app.push_failed($1)', [n.sub_id]); log('warn', 'push failed', { error: String(err) }) }
  }
  return rows.length
}

// ---------------------------------------------------------------- scheduled work
export async function refreshDynamicLists(pool: pg.Pool): Promise<number> {
  const { rows } = await pool.query("select id, owner_user_id, filters from lists where kind = 'dynamic' and filters is not null and (refreshed_at is null or refreshed_at < now() - interval '10 minutes') limit 20")
  for (const l of rows) {
    const db = await pool.connect()
    try {
      const { rows: [c] } = await db.query('select app.claims_for_user($1) as claims', [l.owner_user_id])
      if (!c.claims) continue
      await db.query('begin'); await db.query('set local role authenticated'); await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(c.claims)])
      const ids: string[] = []; let cursor: string | undefined
      for (;;) { const q = buildLeadQuery({ ...l.filters, cursor }, 1000, c.claims); const page = (await db.query(q.sql, q.params)).rows; ids.push(...page.map((r) => r.id)); if (page.length < 1000 || ids.length >= 50000) break; cursor = page.at(-1).cursor }
      await db.query('commit')
      await pool.query('select app.set_list_members($1, $2)', [l.id, ids])
    } catch (err) { await db.query('rollback').catch(() => {}); log('warn', 'dynamic list refresh failed', { list_id: l.id, error: String(err) }) } finally { db.release() }
  }
  return rows.length
}
export async function syncSpend(pool: pg.Pool, deps: Deps): Promise<number> {
  const { rows } = await pool.query(`select id, secret_enc, config from connections where kind = 'meta_page' and status = 'connected' and nullif(config->>'ad_account_id', '') is not null
                                     and coalesce((config->>'spend_synced_at')::timestamptz, '-infinity') < now() - interval '6 hours' limit 5`)
  for (const c of rows) {
    try {
      const token = secret(c.secret_enc); if (!token) continue
      const until = new Date().toISOString().slice(0, 10), since = new Date(Date.now() - 3 * 86400e3).toISOString().slice(0, 10)
      const data = await fetchSpend(deps.fetch, c.config.ad_account_id, token, since, until)
      await pool.query('select app.upsert_spend($1, $2)', [c.id, JSON.stringify(data)])
      await pool.query("update connections set config = config || jsonb_build_object('spend_synced_at', now()) where id = $1", [c.id])
    } catch (err) {
      // Stamp the attempt on failure too, or a broken connection is retried every minute instead of every 6 hours.
      await pool.query("update connections set config = config || jsonb_build_object('spend_synced_at', now()) where id = $1", [c.id])
      await pool.query('select app.connection_result($1, $2)', [c.id, String(err)]); log('warn', 'spend sync failed', { connection_id: c.id, error: String(err) })
    }
  }
  return rows.length
}
export async function tick(pool: pg.Pool, deps: Deps): Promise<number> {
  let n = 0
  n += await processEvents(pool, deps)
  n += (await processExport(pool)) ? 1 : 0
  n += await processMessages(pool, deps)
  n += await processConversions(pool, deps)
  n += await processDeliveries(pool, deps)
  n += await processPushes(pool, deps)
  n += (await pool.query('select app.run_automation_due(50) as n')).rows[0].n
  n += (await pool.query('select app.run_broadcasts(50) as n')).rows[0].n
  return n
}
export async function minutely(pool: pg.Pool, deps: Deps) {
  const sla = (await pool.query('select app.run_sla() as r')).rows[0].r
  await pool.query('select app.enqueue_due_triggers()')
  await refreshDynamicLists(pool)
  await syncSpend(pool, deps)
  if (sla.breach_15 || sla.breach_24) log('info', 'sla', sla)
}
export async function daily(pool: pg.Pool) {
  const n = (await pool.query('select app.run_renewals() as n')).rows[0].n
  log('info', 'renewals', { created: n })
}

if (import.meta.main) {
  const pool = new pg.Pool({ connectionString: process.env.WORKER_DATABASE_URL ?? 'postgres://elessons_worker@localhost/elessons_dev', max: 4 })
  const deps: Deps = { fetch: globalThis.fetch }
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    const { default: webpush } = await import('web-push')
    webpush.setVapidDetails(process.env.VAPID_SUBJECT ?? 'mailto:admin@example.com', process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY)
    deps.sendPush = async (endpoint, keys, payload) => { await webpush.sendNotification({ endpoint, keys: keys as { p256dh: string; auth: string } }, payload) }
  }
  let running = true, lastMinute = 0, lastDay = ''
  for (const s of ['SIGINT', 'SIGTERM'] as const) process.on(s, () => { running = false })
  log('info', 'worker started', { push: !!deps.sendPush })
  while (running) {
    try {
      const n = await tick(pool, deps)
      if (Date.now() - lastMinute > 60000) { lastMinute = Date.now(); await minutely(pool, deps) }
      const today = new Date().toISOString().slice(0, 10)
      if (today !== lastDay) { lastDay = today; await daily(pool) }
      if (!n) await new Promise((r) => setTimeout(r, 2000))
    } catch (err) { log('error', 'worker loop error', { error: String(err) }); await new Promise((r) => setTimeout(r, 5000)) }
  }
  await pool.end()
}
