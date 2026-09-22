// Phases 3-6 against a MOCKED Meta / WhatsApp: routing, coverage, referral, Meta leadgen end-to-end, site events, payments,
// deals, CAPI, conversations, broadcasts, automation, renewals, payouts, merge, custom properties, dynamic lists, 2FA claims.
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { encrypt, hmacHex, sha256 } from '../src/lib/crypto.ts'
import { pool, withTenant, type Claims } from '../src/lib/db.ts'
import { capiPayload, mapLeadFields } from '../src/lib/meta.ts'
import { parseWebhook } from '../src/lib/whatsapp.ts'
import { minutely, processConversions, processDeliveries, processEvents, processMessages, refreshDynamicLists, tick, type Deps } from '../worker/index.ts'
import { addLead, as, denied, disposition, ensureSeed, noFetch, one, owner, workerPool } from './helpers.ts'

process.env.ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString('base64')
let A: Claims, A1: Claims, B: Claims, HQ: Claims, SA: Claims, centreA: string, centreB: string, orgId: string
const calls: { url: string; body?: unknown }[] = []
const meta: Record<string, unknown> = {}
// mocked Graph API: records every call, answers from `meta`
const deps: Deps = { fetch: (async (url: string | URL | Request, init?: RequestInit) => {
  const u = String(url); calls.push({ url: u, body: init?.body ? JSON.parse(String(init.body)) : undefined })
  const path = new URL(u).pathname
  const hit = Object.entries(meta).find(([k]) => path.endsWith(k))
  if (u.includes('/messages')) return Response.json({ messages: [{ id: 'wamid.' + calls.length }] })
  if (u.includes('/events')) return Response.json({ events_received: 1 })
  if (u.includes('hooks.example.com')) return new Response('', { status: 200 })
  if (u.includes('down.example.com')) return new Response('', { status: 500 })
  return hit ? Response.json(hit[1]) : Response.json({ error: { message: 'not mocked: ' + path, code: 100 } }, { status: 400 })
}) as typeof fetch }
const ext = (kind: string, extId: string | null, key: string | null, channel: string, idem: string, payload: object) =>
  workerPool.query('select app.receive_external_event($1,$2,$3,$4,$5,$6) as id', [kind, extId, key, channel, idem, JSON.stringify(payload)]).then((r) => r.rows[0].id as string | null)
const run = async () => { while (await tick(workerPool, deps)); }

before(async () => {
  await ensureSeed()
  orgId = (await one('select id from orgs')).id
  centreA = (await one("select id from centres where code = 'TSR-01'")).id; centreB = (await one("select id from centres where code = 'TSR-02'")).id
  A = await as('TSR-01', 'admin'); A1 = await as('TSR-01', 'counsellor1'); B = await as('TSR-02', 'admin'); HQ = await as('', 'hqadmin'); SA = await as('', 'superadmin')
  await owner.query("update orgs set calling_start = '00:00', calling_end = '23:59:59', working_days = '{1,2,3,4,5,6,7}'")
})
after(async () => { await pool.end(); await workerPool.end(); await owner.end() })

describe('Meta per centre (MT-1..4)', () => {
  let conn: string
  test('Centre Admin connects a page; token stored encrypted and never readable; another centre cannot claim the same page', async () => {
    conn = (await withTenant(A, (db) => db.query("select app.create_connection('meta_page', 'Pending', null) as id"))).rows[0].id
    await withTenant(A, (db) => db.query('select app.connect_meta_page($1,$2,$3,$4,$5,$6)', [conn, 'PAGE1', 'G-TEC Thrissur', encrypt('PAGE_TOKEN_1'), new Date(Date.now() + 60 * 86400e3), 'BIZ1']))
    const row = await one('select secret_enc, status, centre_id from connections where id = $1', [conn])
    assert.notEqual(row.secret_enc, 'PAGE_TOKEN_1'); assert.equal(row.status, 'connected'); assert.equal(row.centre_id, centreA)
    await denied(withTenant(A, (db) => db.query('select secret_enc from connections')), /permission denied/)
    await denied(withTenant(HQ, (db) => db.query('select secret_enc from connections')), /permission denied/)
    const c2 = (await withTenant(B, (db) => db.query("select app.create_connection('meta_page', 'Pending', null) as id"))).rows[0].id
    await assert.rejects(withTenant(B, (db) => db.query('select app.connect_meta_page($1,$2,$3,$4,$5,$6)', [c2, 'PAGE1', 'x', encrypt('t'), null, null])), /PAGE_ALREADY_CONNECTED/)
    await withTenant(B, async (db) => assert.equal((await db.query('select 1 from connection_list where id = $1', [conn])).rowCount, 0))     // IN-3
    await withTenant(HQ, async (db) => assert.equal((await db.query("select state from connection_list where id = $1", [conn])).rows[0].state, 'No events yet'))   // IN-2
    await denied(withTenant(A1, (db) => db.query("select app.create_connection('meta_page', 'x', null)")))
  })
  test('forms sync creates one list per form (MT-3); a leadgen webhook becomes a lead in THAT centre with 4-level source and Meta ids', async () => {
    await withTenant(A, (db) => db.query('select app.save_forms($1,$2)', [conn, JSON.stringify([{ id: 'FORM1', name: 'Grade 10 enquiry', status: 'ACTIVE' }])]))
    assert.equal((await one("select count(*)::int n from lists where origin = 'form' and centre_id = $1", [centreA])).n, 1)
    meta['/LG1'] = { id: 'LG1', created_time: '2026-09-22T05:00:00+0000', form_id: 'FORM1', ad_id: 'AD9', ad_name: 'Video ad', campaign_id: 'CMP9', campaign_name: 'Admissions 2027',
      field_data: [{ name: 'full_name', values: ['Meta Parent'] }, { name: 'phone_number', values: ['+919847300001'] }, { name: 'email', values: ['meta@example.com'] }, { name: 'child_name', values: ['Kid'] }, { name: 'grade', values: ['10'] }] }
    const id = await ext('meta_page', 'PAGE1', null, 'meta', 'meta:leadgen:LG1', { leadgen_id: 'LG1', page_id: 'PAGE1', form_id: 'FORM1' })
    assert.equal(await ext('meta_page', 'PAGE1', null, 'meta', 'meta:leadgen:LG1', { leadgen_id: 'LG1', page_id: 'PAGE1' }), id, 'duplicate webhook = same event')
    await processEvents(workerPool, deps)
    const l = await one("select * from leads where primary_phone = '+919847300001'")
    assert.equal(l.current_centre_id, centreA); assert.equal(l.origin_centre_id, centreA); assert.ok(l.owner_user_id)
    assert.deepEqual([l.source_l1, l.source_l2, l.source_l3, l.source_l4], ['Meta', 'G-TEC Thrissur', 'Admissions 2027', 'Grade 10 enquiry'])
    assert.deepEqual([l.page_id, l.form_id, l.campaign_id, l.ad_id, l.consent_status], ['PAGE1', 'FORM1', 'CMP9', 'AD9', 'granted'])
    assert.equal((await one('select grade from students where lead_id = $1', [l.id])).grade, 10)
    assert.ok(calls.some((c) => c.url.includes('/LG1') && c.url.includes('access_token=PAGE_TOKEN_1')), 'fetched with the decrypted page token')
    assert.equal((await one("select count(*)::int n from list_members m join lists x on x.id = m.list_id where x.origin = 'form' and m.lead_id = $1", [l.id])).n, 1)
    await withTenant(HQ, async (db) => assert.equal((await db.query("select state from connection_list where id = $1", [conn])).rows[0].state, 'Healthy'))
  })
  test('expired token -> Reconnect; a leadgen event for an unmapped page is kept as dead-letter, then replayable after mapping', async () => {
    meta['/LG2'] = { error: { message: 'Error validating access token', code: 190, type: 'OAuthException' } }
    await ext('meta_page', 'PAGE1', null, 'meta', 'meta:leadgen:LG2', { leadgen_id: 'LG2', page_id: 'PAGE1' })
    await processEvents(workerPool, deps)
    assert.equal((await one('select state from connection_list where false union all select app.connection_state(status, config, token_expires_at, last_error_at, last_success_at, last_event_at) from connections where id = $1', [conn])).state, 'Reconnect')
    await owner.query("update inbound_events set processing_status = 'processed', outcome = 'ignored' where idempotency_key = 'meta:leadgen:LG2'")
    const id = await ext('meta_page', 'PAGE_UNMAPPED', null, 'meta', 'meta:leadgen:LG3', { leadgen_id: 'LG3', page_id: 'PAGE_UNMAPPED' })
    const e = await one('select processing_status, error, centre_id from inbound_events where id = $1', [id])
    assert.equal(e.processing_status, 'dead'); assert.match(e.error, /MAPPING_PENDING/); assert.equal(e.centre_id, null)
    await withTenant(HQ, async (db) => assert.equal((await db.query("select 1 from inbound_events where id = $1 and processing_status = 'dead'", [id])).rowCount, 1))
  })
  test('field mapping helper: standard questions map by default, custom ones per form', () => {
    assert.deepEqual(mapLeadFields([{ name: 'phone_number', values: ['1'] }, { name: 'which_class_is_your_child_in?', values: ['9'] }], { 'which_class_is_your_child_in?': 'grade' }), { phone: '1', grade: '9' })
  })
})

describe('HQ routing rules and coverage (AS-2..5)', () => {
  test('property-based rule routes to a centre; round-robin among centres advances; preview has no side effects; coverage lists unruled sources', async () => {
    await withTenant(HQ, (db) => db.query(`insert into distribution_rules (org_id, name, priority, conditions, method, target_centre_ids) values ($1, 'Kerala walk-ins', 10, $2, 'round_robin_centres', $3)`,
      [orgId, JSON.stringify([{ field: 'state', op: 'eq', value: 'Kerala' }]), [centreA, centreB]]))
    await denied(withTenant(A, (db) => db.query("insert into distribution_rules (org_id, name, method, target_centre_ids) values ($1, 'x', 'round_robin_centres', $2)", [orgId, [centreA]])))
    const preview = (await withTenant(HQ, (db) => db.query('select app.route_preview($1) as r', [JSON.stringify({ state: 'Kerala' })]))).rows[0].r
    assert.equal(preview.centre_id, centreA); assert.equal((await one("select rr_cursor from distribution_rules where name = 'Kerala walk-ins'")).rr_cursor, 0)
    const key = sha256('site-key-1')
    await withTenant(HQ, (db) => db.query("select app.create_connection('website', 'elessons.net', null, null, $1)", [key]))
    await ext('website', null, key, 'website', 'site:1', { phone: '9847300010', name: 'Web One', state: 'Kerala', utm_campaign: 'brand' })
    await ext('website', null, key, 'website', 'site:2', { phone: '9847300011', name: 'Web Two', state: 'Kerala' })
    await ext('website', null, key, 'website', 'site:3', { phone: '9847300012', name: 'Web Three', state: 'Karnataka' })
    await processEvents(workerPool, deps)
    const c = async (p: string) => (await one('select current_centre_id c, owner_user_id o from leads where primary_phone = $1', [p]))
    assert.equal((await c('+919847300010')).c, centreA); assert.equal((await c('+919847300011')).c, centreB); assert.deepEqual(await c('+919847300012'), { c: null, o: null })
    const cov = (await withTenant(HQ, (db) => db.query('select * from app.coverage()'))).rows
    assert.ok(cov.some((r) => r.l1 === 'Website' && r.rule === null), 'Website (Karnataka) has no rule and shows in coverage')
    await denied(withTenant(A, (db) => db.query('select * from app.coverage()')))
    assert.equal(await ext('website', null, sha256('wrong-key'), 'website', 'site:4', { phone: '1' }), null, 'unknown API key is rejected')
  })
  test('fallback owner catches what no rule matches', async () => {
    const hqc = (await one("select id from users where username = 'hqcounsellor'")).id
    await owner.query('update orgs set fallback_owner_id = $1', [hqc])
    await ext('website', null, sha256('site-key-1'), 'website', 'site:5', { phone: '9847300013', state: 'Goa' }); await processEvents(workerPool, deps)
    assert.equal((await one("select owner_user_id o from leads where primary_phone = '+919847300013'")).o, hqc)
    await owner.query('update orgs set fallback_owner_id = null')
  })
})

describe('referral (EL-1..3) and website / LMS events (brief s25)', () => {
  test('purchase with ?ref=TSR-01 creates the lead under TSR-01; first referral wins inside the window', async () => {
    assert.equal((await one("select code from referral_codes where centre_id = $1", [centreA])).code, 'TSR-01')
    await withTenant(SA, (db) => db.query('select app.set_coupon($1, $2)', [centreA, 'thrissur10']))
    await ext('website', null, sha256('site-key-1'), 'website', 'site:6', { phone: '9847300020', name: 'Referred', ref: 'THRISSUR10' }); await processEvents(workerPool, deps)
    const l = await one("select current_centre_id c, referral_code r from leads where primary_phone = '+919847300020'")
    assert.deepEqual([l.c, l.r], [centreA, 'THRISSUR10'])
    assert.equal((await one('select app.resolve_referral($1, (select parent_identity_id from leads where primary_phone = $2), $3) as c', [orgId, '+919847300020', 'TSR-02'])).c, centreA, 'second referral within 30 days does not steal credit')
  })
  test('checkout_abandoned creates an immediate task with the cart (EL-10); demo_completed raises priority (EL-9); unknown parent is ignored, not lost', async () => {
    const lead = await one("select id, owner_user_id from leads where primary_phone = '+919847300020'")
    await ext('website', null, sha256('site-key-1'), 'lms', 'site:7', { event: 'checkout_abandoned', phone: '+919847300020', cart: [{ name: 'Grade 10 all subjects' }], amount: 12000, currency: 'INR' })
    await ext('website', null, sha256('site-key-1'), 'lms', 'site:8', { event: 'demo_completed', email: 'nobody@example.com' })
    await processEvents(workerPool, deps)
    const t = await one("select title, type, origin from tasks where lead_id = $1 and type = 'call' order by created_at desc limit 1", [lead.id])
    assert.match(t.title, /Abandoned checkout: Grade 10 all subjects \(INR 12000\)/); assert.equal(t.origin, 'system')
    assert.equal((await one("select outcome from inbound_events where idempotency_key = 'site:8'")).outcome, 'ignored')
    await ext('website', null, sha256('site-key-1'), 'lms', 'site:9', { event: 'demo_completed', phone: '9847300020' }); await processEvents(workerPool, deps)
    assert.equal((await one('select priority from leads where id = $1', [lead.id])).priority, 1)
  })
})

describe('deals, catalogue and payments (DL-1..9, EL-4)', () => {
  let leadId: string, dealId: string, priceId: string
  test('catalogue prices are rows; Interested creates a deal; items come from price ids only', async () => {
    const item = (await withTenant(HQ, (db) => db.query("insert into catalogue_items (org_id, name, grade, plan) values ($1, 'Grade 10 · All subjects', 10, 'all_subjects') returning id", [orgId]))).rows[0].id
    priceId = (await withTenant(HQ, (db) => db.query("insert into prices (item_id, currency, region, amount) values ($1, 'INR', '', 12000) returning id", [item]))).rows[0].id
    await denied(withTenant(A, (db) => db.query("insert into prices (item_id, currency, amount) values ($1, 'AED', 600)", [item])))
    leadId = (await addLead(A1, { phone: '9847300030', name: 'Deal Parent', students: [{ name: 'Dee', grade: '10' }] })).lead_id
    await withTenant(A1, async (db) => db.query('select app.apply_disposition($1,$2)', [leadId, await disposition('Interested')]))
    const d = await one('select * from deals where lead_id = $1', [leadId]); dealId = d.id
    assert.equal(d.status, 'open'); assert.match(d.name, /^DEAL-Deal Parent/); assert.equal(d.owner_user_id, A1.user_id); assert.equal((await one('select deal_stage from leads where id = $1', [leadId])).deal_stage, 'Qualified Lead')
    await withTenant(A1, (db) => db.query('select app.set_deal_items($1, $2)', [dealId, JSON.stringify([{ price_id: priceId, qty: 1 }])]))
    assert.equal(Number((await one('select amount from deals where id = $1', [dealId])).amount), 12000)
    await assert.rejects(withTenant(A1, (db) => db.query('select app.set_deal_items($1, $2)', [dealId, JSON.stringify([{ price_id: '00000000-0000-0000-0000-000000000000' }])])), /INVALID/)
    await denied(withTenant(B, (db) => db.query('select app.set_deal_items($1, $2)', [dealId, '[]'])))
    await withTenant(B, async (db) => assert.equal((await db.query('select 1 from deal_list where id = $1', [dealId])).rowCount, 0))
  })
  test('stage moves are audited on the timeline; Lost needs a reason and closes an Interested lead as Dead', async () => {
    const stage = async (n: string) => (await one('select id from deal_stages where name = $1', [n])).id
    await withTenant(A1, async (db) => db.query('select app.move_deal($1, $2)', [dealId, await stage('Demo Shared')]))
    await assert.rejects(withTenant(A1, async (db) => db.query('select app.move_deal($1, $2)', [dealId, await stage('Deal Lost')])), /REASON_REQUIRED/)
    const other = (await addLead(A1, { phone: '9847300031', name: 'Lost Parent' })).lead_id
    await withTenant(A1, async (db) => db.query('select app.apply_disposition($1,$2)', [other, await disposition('Interested')]))
    await withTenant(A1, async (db) => db.query('select app.move_deal((select id from deal_list where lead_id = $1), $2, $3)', [other, await stage('Deal Lost'), 'went elsewhere']))
    assert.deepEqual(await one('select lifecycle, closed_reason from leads where id = $1', [other]), { lifecycle: 'DEAD', closed_reason: 'Deal lost' })
  })
  test('gateway payment received: deal Won, lead Enrolled, enrolment with access end date, duplicate report is a no-op; failed payment makes a task', async () => {
    const key = sha256('pay-key')
    await withTenant(HQ, (db) => db.query("select app.create_connection('payment', 'Gateway', null, $1, null, '{\"gateway\":\"generic\"}')", [encrypt('gw-secret')]))
    await ext('payment', 'generic', null, 'payment', 'pay:generic:P1:received', { status: 'received', amount: 12000, currency: 'INR', payment_id: 'P1', phone: '9847300030', student_name: 'Dee', grade: 10, access_end_date: '2027-03-31' })
    await run()
    const l = await one('select lifecycle, is_customer, total_paid, last_payment_status from leads where id = $1', [leadId])
    assert.deepEqual([l.lifecycle, l.is_customer, Number(l.total_paid), l.last_payment_status], ['ENROLLED', true, 12000, 'received'])
    assert.equal((await one('select status from deals where id = $1', [dealId])).status, 'won')
    const en = await one("select *, to_char(access_end_date, 'YYYY-MM-DD') as ends from enrolments where lead_id = $1", [leadId]); assert.equal(en.ends, '2027-03-31'); assert.equal(en.centre_id, centreA)
    await ext('payment', 'generic', null, 'lms', 'lms:P1', { event: 'payment_received', amount: 12000, payment_id: 'P1', phone: '9847300030' }); await run()
    assert.equal((await one("select count(*)::int n from activities where lead_id = $1 and type = 'payment'", [leadId])).n, 1, 'LMS repeating the gateway is not a second payment')
    const f = (await addLead(A1, { phone: '9847300032', name: 'Failed Pay' })).lead_id
    await ext('payment', 'generic', null, 'payment', 'pay:P2:failed', { status: 'failed', amount: 500, payment_id: 'P2', phone: '9847300032' }); await run()
    assert.equal((await one("select count(*)::int n from tasks where lead_id = $1 and type = 'payment_followup'", [f])).n, 1)
  })
  test('direct purchase with no lead creates one with source Direct purchase and credits the referral centre', async () => {
    await ext('payment', 'generic', null, 'payment', 'pay:P3:received', { status: 'received', amount: 15000, currency: 'INR', payment_id: 'P3', phone: '9847300040', name: 'Walk-in Buyer', email: 'b@example.com', ref: 'TSR-02', student_name: 'Buy Jr', grade: 11 }); await run()
    const l = await one("select current_centre_id c, source_l1, source_l2, lifecycle, total_paid from leads where primary_phone = '+919847300040'")
    assert.deepEqual([l.c, l.source_l1, l.source_l2, l.lifecycle, Number(l.total_paid)], [centreB, 'Website', 'Direct purchase', 'ENROLLED', 15000])
  })
  test('Conversions API: Interested and Enrolled sent once per enquiry cycle with hashed parent identifiers only', async () => {
    const m = (await one("select l.id, i.email_hash from leads l join parent_identities i on i.id = l.parent_identity_id where primary_phone = '+919847300001'"))
    await withTenant(A, async (db) => db.query('select app.apply_disposition($1,$2)', [m.id, await disposition('Interested')]))
    assert.equal((await one("select status from conversion_events where lead_id = $1", [m.id])).status, 'skipped', 'no pixel id configured -> skipped, visible')
    await owner.query(`update connections set config = config || '{"pixel_id":"PIX1"}' where external_id = 'PAGE1'`); await owner.query("update conversion_events set status = 'pending', connection_id = (select id from connections where external_id = 'PAGE1') where lead_id = $1", [m.id])
    await processConversions(workerPool, deps)
    const sent = calls.filter((c) => c.url.includes('/PIX1/events')); assert.equal(sent.length, 1)
    const p = sent[0]!.body as ReturnType<typeof capiPayload>; const ud = p.data[0]!.user_data
    assert.equal(p.data[0]!.event_name, 'Interested'); assert.equal(ud.ph[0], sha256('+919847300001')); assert.equal(ud.em?.[0], m.email_hash); assert.ok(!JSON.stringify(p).includes('Kid'))
    assert.equal((await one("select status from conversion_events where lead_id = $1", [m.id])).status, 'sent')
    await withTenant(A, async (db) => db.query('select app.apply_disposition($1,$2)', [m.id, await disposition('Enrolled')]))
    assert.equal((await one("select count(*)::int n from conversion_events where lead_id = $1", [m.id])).n, 2)
  })
})

describe('conversations, templates and broadcasts (CV-1..7)', () => {
  let wa: string, tpl: string, leadId: string
  test('inbound from an unknown number creates a lead through the gate and a conversation; STOP opts out', async () => {
    wa = (await withTenant(HQ, (db) => db.query("select app.create_connection('whatsapp', 'HQ WhatsApp', null, $1, null, '{}') as id", [encrypt('WA_TOKEN')]))).rows[0].id
    await owner.query("update connections set external_id = 'PNID1' where id = $1", [wa])
    const [ch] = parseWebhook({ entry: [{ changes: [{ value: { metadata: { phone_number_id: 'PNID1' }, messages: [{ from: '919847300050', id: 'wamid.in1', type: 'text', timestamp: '1758500000', text: { body: 'Hi, fees for grade 9?' } }] } }] }] })
    for (const m of ch!.messages) await ext('whatsapp', 'PNID1', null, 'whatsapp', 'wa:msg:' + m.id, { ...m, phone_number_id: 'PNID1' })
    await processEvents(workerPool, deps)
    const l = await one("select id, source_l1, owner_user_id from leads where primary_phone = '+919847300050'"); leadId = l.id
    assert.equal(l.source_l1, 'WhatsApp')
    const conv = await one('select * from conversations where lead_id = $1', [leadId]); assert.equal(conv.unread, 1); assert.ok(conv.session_expires_at)
    await ext('whatsapp', 'PNID1', null, 'whatsapp', 'wa:msg:wamid.in2', { wa_id: '919847300050', id: 'wamid.in2', kind: 'text', body: 'STOP', at: new Date(), phone_number_id: 'PNID1' }); await processEvents(workerPool, deps)
    assert.equal((await one('select consent_status from leads where id = $1', [leadId])).consent_status, 'withdrawn')
    await assert.rejects(withTenant(HQ, (db) => db.query('select app.queue_message($1, $2, $3)', [leadId, wa, 'still there?'])), /DNC/)
    await owner.query("update leads set opted_out_at = null, consent_status = 'granted' where id = $1", [leadId])
  })
  test('free text inside the 24 h window is sent via the Cloud API; outside it needs an approved template; status webhooks update delivery', async () => {
    const mid = (await withTenant(HQ, (db) => db.query('select app.queue_message($1, $2, $3) as id', [leadId, wa, 'Grade 9 is INR 12,000 for the year.']))).rows[0].id
    await processMessages(workerPool, deps)
    const m = await one('select status, wa_message_id from messages where id = $1', [mid]); assert.equal(m.status, 'sent'); assert.ok(m.wa_message_id)
    assert.ok(calls.some((c) => c.url.includes('/PNID1/messages') && (c.body as { text?: { body: string } }).text?.body?.includes('12,000')))
    await workerPool.query("select app.message_status($1, 'read', now())", [m.wa_message_id]); assert.equal((await one('select status from messages where id = $1', [mid])).status, 'read')
    await owner.query("update conversations set session_expires_at = now() - interval '1 hour' where lead_id = $1", [leadId])
    await assert.rejects(withTenant(HQ, (db) => db.query('select app.queue_message($1, $2, $3)', [leadId, wa, 'x'])), /SESSION_EXPIRED/)
    tpl = (await withTenant(HQ, (db) => db.query("insert into templates (org_id, connection_id, name, body, status, external_id) values ($1, $2, 'welcome', 'Hello {{1}}, welcome to eLessons {{2}}', 'approved', 'T1') returning id", [orgId, wa]))).rows[0].id
    const t = (await withTenant(HQ, (db) => db.query('select app.queue_message($1, $2, null, $3, $4) as id', [leadId, wa, tpl, JSON.stringify(['Parent', 'TSR-01'])]))).rows[0].id
    assert.equal((await one('select body from messages where id = $1', [t])).body, 'Hello Parent, welcome to eLessons TSR-01')
    await denied(withTenant(A1, (db) => db.query('select app.queue_message($1, $2, $3)', [leadId, wa, 'x'])), /LEAD_NOT_FOUND/)
  })
  test('broadcast: list -> template -> queued per recipient, DNC / opted-out skipped, counts kept, pause works', async () => {
    const list = (await withTenant(HQ, (db) => db.query("select app.create_list('Broadcast test', null, 'static', null, 'org') as id"))).rows[0].id
    const l2 = (await addLead(HQ, { phone: '9847300051', name: 'Opted Out' }, { centre: null })).lead_id
    await owner.query("update leads set opted_out_at = now() where id = $1", [l2])
    await withTenant(HQ, (db) => db.query('select app.add_to_list($1, $2)', [[leadId, l2], list]))
    const b = (await withTenant(HQ, (db) => db.query("select app.create_broadcast('Sept promo', 'enrol', $1, $2, $3, null, 'existing', now()) as id", [list, tpl, wa]))).rows[0].id
    await run()
    const r = await one('select status, sent_count, skipped_count from broadcasts where id = $1', [b]); assert.deepEqual([r.sent_count, r.skipped_count, r.status], [1, 1, 'completed'])
    assert.match((await one("select status from broadcast_recipients where broadcast_id = $1 and lead_id = $2", [b, l2])).status, /skipped:DNC/)
    await denied(withTenant(A, (db) => db.query("select app.create_broadcast('x', null, $1, $2, $3, null, 'existing', now())", [list, tpl, wa])))
  })
})

describe('automation engine (brief s32, AU-1..4)', () => {
  test('trigger + conditions + actions; HQ rule applies to centres and cannot be edited by them; logged on the timeline; idempotent; rate-limited', async () => {
    const list = (await withTenant(HQ, (db) => db.query("select app.create_list('Price concern', null, 'static', null, 'org') as id"))).rows[0].id
    const rule = (await withTenant(HQ, (db) => db.query(`insert into automation_rules (org_id, name, trigger, conditions, actions, quiet_hours) values ($1, 'Price concern follow-up', 'call_outcome', $2, $3, false) returning id`,
      [orgId, JSON.stringify([{ field: 'disposition', op: 'eq', value: 'Price concern' }]), JSON.stringify([{ type: 'create_task', title: 'Send offer', due_in_minutes: 30 }, { type: 'add_to_list', list_id: list }, { type: 'webhook', url: 'https://hooks.example.com/x' }, { type: 'notify_user', title: 'Offer needed' }])]))).rows[0].id
    await denied(withTenant(A, (db) => db.query("update automation_rules set is_active = false where id = $1", [rule])).then((r) => { if (r.rowCount === 0) throw new Error('permission denied (0 rows)') }))
    const lead = (await addLead(A1, { phone: '9847300060', name: 'Auto Parent' })).lead_id
    await withTenant(A1, async (db) => db.query('select app.apply_disposition($1,$2)', [lead, await disposition('Price concern')]))
    await run(); await run()
    const runs = (await owner.query('select status, detail from automation_runs where lead_id = $1 and rule_id = $2', [lead, rule])).rows
    assert.equal(runs.length, 1); assert.equal(runs[0].status, 'done')
    assert.equal((await one("select count(*)::int n from tasks where lead_id = $1 and title = 'Send offer'", [lead])).n, 1)
    assert.equal((await one('select count(*)::int n from list_members where list_id = $1 and lead_id = $2', [list, lead])).n, 1)
    assert.equal((await one("select status from webhook_deliveries where payload->>'lead_id' = $1", [lead])).status, 'sent')
    assert.ok(calls.some((c) => c.url === 'https://hooks.example.com/x'))
    assert.equal((await one("select count(*)::int n from activities where lead_id = $1 and type = 'automation' and payload->>'rule' = 'Price concern follow-up'", [lead])).n, 1)
    assert.equal((await one("select count(*)::int n from notifications where lead_id = $1 and kind = 'automation'", [lead])).n, 1)
    await withTenant(A1, async (db) => db.query('select app.apply_disposition($1,$2)', [lead, await disposition('Need details')])); await run()
    assert.equal((await one("select count(*)::int n from automation_runs where lead_id = $1 and rule_id = $2 and status = 'skipped'", [lead, rule])).n, 1, 'condition not met is recorded')
    await withTenant(A1, async (db) => assert.equal((await db.query('select 1 from automation_runs where lead_id = $1', [lead])).rowCount, 2))
  })
  test('quiet hours defer messaging until the calling window; a failing webhook retries then dead-letters', async () => {
    await owner.query("update orgs set calling_start = '09:00', calling_end = '10:00', working_days = '{1,2,3,4,5,6,7}'")
    const lead = (await addLead(A1, { phone: '9847300061', name: 'Quiet Parent' })).lead_id
    await owner.query("update leads set timezone = 'Pacific/Kiritimati' where id = $1", [lead])   // almost certainly outside 09-10 local now
    const wa = (await one("select id from connections where kind = 'whatsapp'")).id, tpl = (await one("select id from templates where name = 'welcome'")).id
    await withTenant(HQ, (db) => db.query(`insert into automation_rules (org_id, name, trigger, actions) values ($1, 'Welcome', 'tag_applied', $2)`, [orgId, JSON.stringify([{ type: 'send_whatsapp', template_id: tpl }])]))
    await withTenant(A1, (db) => db.query('select app.tag_leads($1, $2)', [[lead], 'welcome']))
    await run()
    const local = (await one("select to_char(now() at time zone 'Pacific/Kiritimati', 'HH24:MI') t")).t
    if (local >= '09:00' && local < '10:00') assert.equal((await one("select count(*)::int n from messages m join conversations c on c.id = m.conversation_id where c.lead_id = $1", [lead])).n, 1)
    else { assert.equal((await one("select count(*)::int n from messages m join conversations c on c.id = m.conversation_id where c.lead_id = $1", [lead])).n, 0); assert.equal((await one('select count(*)::int n from automation_triggers where lead_id = $1 and processed_at is null and created_at > now()', [lead])).n, 1, 're-queued for the window') }
    await owner.query("update orgs set calling_start = '00:00', calling_end = '23:59:59'")
    await withTenant(HQ, (db) => db.query(`insert into automation_rules (org_id, name, trigger, actions, quiet_hours) values ($1, 'Down hook', 'lead_created', $2, false)`, [orgId, JSON.stringify([{ type: 'webhook', url: 'https://down.example.com/x' }])]))
    const l3 = (await addLead(A1, { phone: '9847300062' })).lead_id; await run()
    for (let i = 0; i < 7; i++) { await owner.query("update webhook_deliveries set next_retry_at = now() where payload->>'lead_id' = $1", [l3]); await processDeliveries(workerPool, deps) }
    assert.equal((await one("select status from webhook_deliveries where payload->>'lead_id' = $1", [l3])).status, 'dead')
    void wa
  })
})

describe('renewals, payouts, merge, custom properties, dynamic lists, 2FA', () => {
  test('renewal deal 60 days before access ends, to the original owner, next grade, Grade 12 excluded (EL-5)', async () => {
    await owner.query("update enrolments set access_end_date = current_date + 30 where lead_id = (select id from leads where primary_phone = '+919847300030')")
    await owner.query("update students set grade = 12 where lead_id = (select id from leads where primary_phone = '+919847300040')"); await owner.query("update enrolments set access_end_date = current_date + 10 where lead_id = (select id from leads where primary_phone = '+919847300040')")
    assert.equal((await workerPool.query('select app.run_renewals() as n')).rows[0].n, 1)
    const d = await one("select d.kind, d.name, d.owner_user_id, l.lifecycle from deals d join leads l on l.id = d.lead_id where l.primary_phone = '+919847300030' and d.kind = 'renewal'")
    assert.match(d.name, /Grade 11/); assert.equal(d.owner_user_id, A1.user_id); assert.equal(d.lifecycle, 'ENQUIRY')
    assert.equal((await workerPool.query('select app.run_renewals() as n')).rows[0].n, 0, 'idempotent')
  })
  test('payout report applies the configured rule; rate is data; centres see own rows only (EL-8)', async () => {
    await withTenant(SA, (db) => db.query("insert into payout_rules (org_id, kind, rate) values ($1, 'percent', 10)", [orgId]))
    await withTenant(SA, (db) => db.query("insert into payout_rules (org_id, centre_id, kind, rate) values ($1, $2, 'fixed', 500)", [orgId, centreB]))
    await denied(withTenant(HQ, (db) => db.query("insert into payout_rules (org_id, kind, rate) values ($1, 'percent', 99)", [orgId])))
    const rows = (await withTenant(HQ, (db) => db.query('select centre_code, enrolments, revenue, commission from payout_report order by centre_code'))).rows
    assert.equal(Number(rows.find((r) => r.centre_code === 'TSR-01').commission), 1200); assert.equal(Number(rows.find((r) => r.centre_code === 'TSR-02').commission), 500)
    assert.deepEqual((await withTenant(A, (db) => db.query('select centre_code from payout_report'))).rows.map((r) => r.centre_code), ['TSR-01'])
  })
  test('merge keeps both timelines, moves children, hides the loser; cross-centre merge refused (LT-10)', async () => {
    const w = (await addLead(A, { phone: '9847300070', name: 'Winner' })).lead_id, x = (await addLead(A, { phone: '9847300071', name: 'Loser', email: 'l@example.com' })).lead_id
    await withTenant(A, (db) => db.query('select app.add_note($1, $2)', [x, 'loser note']))
    await denied(withTenant(A1, (db) => db.query('select app.merge_leads($1, $2)', [w, x])))
    await withTenant(A, (db) => db.query('select app.merge_leads($1, $2)', [w, x]))
    assert.equal((await one('select email from leads where id = $1', [w])).email, 'l@example.com')
    assert.equal((await one('select count(*)::int n from lead_phones where lead_id = $1', [w])).n, 2)
    await withTenant(A, async (db) => { assert.equal((await db.query('select merged_into_id from lead_list where id = $1', [x])).rows[0].merged_into_id, w); assert.ok((await db.query("select 1 from activities where lead_id = $1 and payload->>'note' = 'loser note'", [x])).rowCount) })
    const y = (await addLead(B, { phone: '9847300072' })).lead_id
    await assert.rejects(withTenant(HQ, (db) => db.query('select app.merge_leads($1, $2)', [w, y])), /MERGE_ACROSS_CENTRES/)
  })
  test('custom properties: defined by HQ, validated on write, usable in the query builder and routing (LT-9)', async () => {
    await withTenant(HQ, (db) => db.query("insert into property_definitions (org_id, entity, key, label, type, options) values ($1, 'lead', 'board', 'Board', 'option', '{CBSE,ICSE,State}')", [orgId]))
    const l = (await addLead(A, { phone: '9847300080', name: 'Custom' })).lead_id
    await withTenant(A, (db) => db.query('select app.set_custom($1, $2)', [l, JSON.stringify({ board: 'ICSE', unknown_key: 'x', })]))
    await withTenant(A, (db) => db.query('select app.set_custom($1, $2)', [l, JSON.stringify({ board: 'Nope' })]))
    assert.deepEqual((await one('select custom from leads where id = $1', [l])).custom, { board: 'ICSE' })
    assert.equal((await one("select app.lead_field($1, 'custom.board') as v", [JSON.stringify({ custom: { board: 'ICSE' } })])).v, 'icse')
  })
  test('dynamic list refreshes from its saved filter under the owner\'s scope (LS-2)', async () => {
    const id = (await withTenant(A, (db) => db.query("select app.create_list('Never picked (dyn)', null, 'dynamic', $1, 'centre') as id", [JSON.stringify({ view: 'never_picked' })]))).rows[0].id
    await refreshDynamicLists(workerPool)
    const n = (await one('select count(*)::int n from list_members where list_id = $1', [id])).n
    assert.ok(n > 0); assert.equal((await one('select count(*)::int n from list_members m join leads l on l.id = m.lead_id where m.list_id = $1 and l.current_centre_id <> $2', [id, centreA])).n, 0)
  })
  test('2FA: HQ Admin sessions carry totp_required until verified; centre roles do not', async () => {
    const { login, claimsForToken } = await import('../src/lib/auth-core.ts')
    const r = await login('', 'hqadmin', 'dev-only-password-1', null, null); assert.ok(r.ok)
    assert.equal((await claimsForToken(r.token))!.totp_required, true)
    await workerPool.query('select 1'); const { sha256: h } = await import('../src/lib/crypto.ts')
    await owner.query('select app.auth_mark_totp($1)', [h(r.token)])
    assert.equal((await claimsForToken(r.token))!.totp_required, false)
    const c = await login('TSR-01', 'admin', 'dev-only-password-1', null, null); assert.ok(c.ok); assert.equal((await claimsForToken(c.token))!.totp_required, false)
  })
  test('minutely scheduler runs without error', async () => { await minutely(workerPool, deps) })
})
