// Dev/test seed: 1 org, 5 districts, 20 centres (incl. EKM-07), users for every role, 48 sample leads with students,
// activities and follow-ups. Deals, payments and Meta samples are seeded by the phases that add those tables.
import pg from 'pg'
import { normaliseLead } from '../src/lib/ingest/normalize.ts'
import { hashPassword } from '../src/lib/password.ts'

export const SEED_PASSWORD = process.env.SEED_PASSWORD ?? 'dev-only-password-1'
const DISTRICTS: [string, string, number][] = [
  ['EKM', 'Ernakulam', 8], ['KKD', 'Kozhikode', 4], ['TVM', 'Thiruvananthapuram', 3], ['TSR', 'Thrissur', 3], ['DXB', 'Dubai', 2],
]

export async function seed(db: pg.Client, opts: { leads?: boolean } = {}) {
  const { rows: [{ name }] } = await db.query('select current_database() as name')
  if (!/_(test|dev)$/.test(name)) throw new Error(`refusing to seed database "${name}"`)
  const hash = await hashPassword(SEED_PASSWORD)
  await db.query('begin')
  const { rows: [org] } = await db.query("insert into orgs (name) values ('G-TEC eLessons') returning id")
  await db.query('select app.seed_default_role_permissions($1)', [org.id])
  await db.query('select app.seed_default_dispositions($1)', [org.id])
  await db.query('select app.seed_default_deal_stages($1)', [org.id])
  const user = (username: string, display: string, role: string, district: string | null, centre: string | null) =>
    db.query(
      `insert into users (org_id, district_id, centre_id, username, display_name, role, password_hash, must_change_password)
       values ($1,$2,$3,$4,$5,$6,$7,false)`, [org.id, district, centre, username, display, role, hash])
  await user('superadmin', 'Super Admin', 'SUPERADMIN', null, null)
  await user('hqadmin', 'HQ Admin', 'HQ_ADMIN', null, null)
  await user('hqcounsellor', 'HQ Counsellor', 'HQ_COUNSELLOR', null, null)
  for (const [code, dname, n] of DISTRICTS) {
    const { rows: [d] } = await db.query('insert into districts (org_id, code, name) values ($1,$2,$3) returning id', [org.id, code, dname])
    await user('manager', `${dname} District Manager`, 'DISTRICT_MANAGER', d.id, null)
    for (let i = 1; i <= n; i++) {
      const ccode = `${code}-${String(i).padStart(2, '0')}`
      const tz = code === 'DXB' ? 'Asia/Dubai' : 'Asia/Kolkata'
      const { rows: [c] } = await db.query(
        'insert into centres (org_id, district_id, code, name, timezone, default_country) values ($1,$2,$3,$4,$5,$6) returning id',
        [org.id, d.id, ccode, `G-TEC ${dname} ${i}`, tz, code === 'DXB' ? 'AE' : 'IN'])
      await user('admin', `${ccode} Centre Admin`, 'CENTRE_ADMIN', d.id, c.id)
      await user('counsellor1', `${ccode} Counsellor 1`, 'COUNSELLOR', d.id, c.id)
      await user('counsellor2', `${ccode} Counsellor 2`, 'COUNSELLOR', d.id, c.id)
    }
  }
  await db.query('commit')
  // EKM-07 demonstrates round-robin among counsellors; the others use the default (Centre Admin receives)
  await db.query("update centres set intra_centre_assignment = 'round_robin' where code = 'EKM-07'")
  if (opts.leads) await seedLeads(db, org.id)
  return org.id as string
}

// Sample leads enter through the real gate, acting as the seeded HQ Admin. Nothing is inserted into leads directly.
async function seedLeads(db: pg.Client, orgId: string) {
  const { rows: [hq] } = await db.query("select id from users where username = 'hqadmin'")
  await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ user_id: hq.id, org_id: orgId, role: 'HQ_ADMIN', read_only: false })])
  const disp = Object.fromEntries((await db.query('select name, id from dispositions')).rows.map((r) => [r.name, r.id]))
  const names = ['Asha Menon', 'Rajesh Nair', 'Fathima Rahman', 'Suresh Kumar', 'Lakshmi Pillai', 'Thomas Mathew', 'Priya Varma', 'Abdul Kareem', 'Deepa Joseph', 'Vinod Krishnan', 'Shalini George', 'Imran Sheikh']
  const sources = [['Manual', 'Walk-in'], ['Manual', 'Reference'], ['Meta', 'G-TEC Page', 'Admissions 2027', 'CBSE Grade 10 form'], ['Website', 'elessons.net']]
  const script = [[], ['Not reachable'], ['Need details'], ['Not reachable', 'Interested'], ['Not interested'], ['Price concern'], ['Wrong number'], ['Interested', 'Enrolled']]
  let n = 0
  for (const code of ['EKM-07', 'EKM-01', 'KKD-03', 'DXB-01']) {
    const { rows: [c] } = await db.query('select id, default_country, timezone from centres where code = $1', [code])
    for (let i = 0; i < 12; i++, n++) {
      const src = sources[n % sources.length]!
      const raw = { phone: code === 'DXB-01' ? `050${String(1000000 + n * 7919).slice(-7)}` : `98950${String(10000 + n * 13).slice(-5)}`, name: names[i], city: code === 'DXB-01' ? 'Dubai' : undefined,
        students: [{ name: `${names[i]!.split(' ')[0]} Jr`, grade: String(8 + (n % 5)), stream: n % 5 >= 3 ? 'PCMB' : undefined }],
        source: { l1: src[0], l2: src[1], l3: src[2], l4: src[3] }, consent: { status: n % 3 ? 'granted' : 'unknown', source: 'seed' } }
      const { rows: [e] } = await db.query('select app.receive_event($1,$2,$3,$4) as id', [src[0] === 'Manual' ? 'manual' : src[0]!.toLowerCase(), c.id, `seed:${n}`, JSON.stringify(raw)])
      const { rows: [r] } = await db.query('select app.ingest_lead($1,$2) as r', [e.id, JSON.stringify(normaliseLead(raw, c.default_country, c.timezone))])
      if (!r.r.lead_id) throw new Error(`seed lead ${raw.phone} was rejected: ${r.r.outcome}`)
      for (const d of script[n % script.length]!) await db.query('select app.apply_disposition($1,$2,$3)', [r.r.lead_id, disp[d], d === 'Not interested' ? 'Chose a local tutor' : null])
    }
  }
  // Phase 2-6 samples: catalogue, a Meta connection (fake token), campaign spend, a payment, a WhatsApp conversation, an automation rule, a payout rule
  const { rows: [item] } = await db.query("insert into catalogue_items (org_id, name, grade, plan) values ($1, 'Grade 10 · All subjects', 10, 'all_subjects') returning id", [orgId])
  await db.query("insert into prices (item_id, currency, region, amount) values ($1, 'INR', '', 12000), ($1, 'AED', '', 600)", [item.id])
  await db.query("insert into catalogue_items (org_id, name, grade, plan, stream) values ($1, 'Grade 12 · PCMB', 12, 'all_subjects', 'PCMB')", [orgId])
  const { rows: [ekm] } = await db.query("select id, district_id from centres where code = 'EKM-07'")
  const { rows: [conn] } = await db.query(`insert into connections (org_id, district_id, centre_id, kind, name, status, external_id, secret_enc, token_expires_at, config, last_event_at, last_success_at, created_by)
    values ($1, $2, $3, 'meta_page', 'G-TEC Ernakulam 7 (sample)', 'connected', 'SAMPLE_PAGE_1', 'v1.sample.sample.sample', now() + interval '50 days', '{"pixel_id":"SAMPLE_PIXEL","ad_account_id":"123"}', now() - interval '2 hours', now() - interval '2 hours', $4) returning id`, [orgId, ekm.district_id, ekm.id, hq.id])
  await db.query("insert into connection_forms (connection_id, form_id, name, status) values ($1, 'SAMPLE_FORM', 'CBSE Grade 10 form', 'ACTIVE')", [conn.id])
  for (let i = 0; i < 14; i++) await db.query("insert into campaign_spend (org_id, district_id, centre_id, connection_id, day, campaign_id, campaign_name, ad_id, ad_name, spend, currency, impressions, clicks) values ($1,$2,$3,$4, current_date - $5::int, 'CMP-SAMPLE', 'Admissions 2027', 'AD-1', 'Video ad', 850 + $5::int * 10, 'INR', 4000, 120)", [orgId, ekm.district_id, ekm.id, conn.id, i])
  await db.query("update leads set campaign_id = 'CMP-SAMPLE', page_id = 'SAMPLE_PAGE_1' where source_l1 = 'Meta' and current_centre_id = $1", [ekm.id])
  await db.query("insert into distribution_rules (org_id, name, priority, conditions, method, target_centre_ids, created_by) select $1, 'Dubai enquiries', 10, '[{\"field\":\"country\",\"op\":\"eq\",\"value\":\"AE\"}]', 'round_robin_centres', array_agg(id), $2 from centres where code like 'DXB-%'", [orgId, hq.id])
  await db.query("insert into payout_rules (org_id, kind, rate, created_by) values ($1, 'percent', 10, $2)", [orgId, hq.id])
  await db.query("insert into templates (org_id, name, body, status, external_id, created_by) values ($1, 'welcome', 'Hello {{1}}, welcome to eLessons. Your counsellor at {{2}} will call you shortly.', 'approved', 'SAMPLE_T1', $2)", [orgId, hq.id])
  await db.query("insert into automation_rules (org_id, name, trigger, conditions, actions, created_by) values ($1, 'Demo link on Demo requested', 'call_outcome', '[{\"field\":\"disposition\",\"op\":\"eq\",\"value\":\"Demo requested\"}]', '[{\"type\":\"create_task\",\"title\":\"Send demo link\",\"task_type\":\"send_demo\",\"due_in_minutes\":30}]', $2)", [orgId, hq.id])
  const { rows: [enrolled] } = await db.query("select id, primary_phone from leads where lifecycle = 'ENROLLED' and current_centre_id = $1 limit 1", [ekm.id])
  if (enrolled) {
    const { rows: [e] } = await db.query("select app.receive_event('payment', $1, 'seed:pay:1', $2) as id", [ekm.id, JSON.stringify({ status: 'received', amount: 12000, currency: 'INR', payment_id: 'SEED-P1', phone: enrolled.primary_phone })])
    await db.query("update inbound_events set channel = 'payment' where id = $1", [e.id])
  }
  await db.query("select set_config('request.jwt.claims', '', false)")
}

if (import.meta.main) {
  const db = new pg.Client({ connectionString: process.env.MIGRATE_DATABASE_URL ?? 'postgres:///elessons_dev' })
  await db.connect()
  await seed(db, { leads: true })
  await db.end()
  console.log(`seeded. Log in e.g. centre code EKM-07 / admin / ${SEED_PASSWORD}; HQ: (blank) / hqadmin`)
}
