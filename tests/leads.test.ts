// Phase 1: ingestion gate, isolation on real leads (PRD s50 critical test), lifecycle, custody, import, export.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { after, before, describe, test } from 'node:test'
import { pool, withTenant, type Claims } from '../src/lib/db.ts'
import { buildLeadQuery } from '../src/lib/leads-query.ts'
import { normalisePhone } from '../src/lib/ingest/normalize.ts'
import { processEvents, processExport } from '../worker/index.ts'
import { addLead, as, denied, disposition, ensureSeed, noFetch, one, owner, workerPool } from './helpers.ts'

let A: Claims, A1: Claims, A2: Claims, B: Claims, HQ: Claims, DM: Claims
let centreA: string, centreB: string, centreA2: string, orgId: string
let leadA: string
const list = (c: Claims, filters: object, scope: object = c) => withTenant(c, async (db) => { const q = buildLeadQuery(filters, 50, scope as Claims); return (await db.query(q.sql, q.params)).rows })
const hostileEvent = (payload: object, centre: string | null, key: string, channel = 'website') =>
  workerPool.query('select app.receive_event($1,$2,$3,$4,null,null,$5,$6) as id', [channel, centre, key, JSON.stringify(payload), 'pending', orgId]).then((r) => r.rows[0].id as string)

before(async () => {
  await ensureSeed()
  orgId = (await one('select id from orgs')).id
  centreA = (await one("select id from centres where code = 'EKM-07'")).id
  centreA2 = (await one("select id from centres where code = 'EKM-01'")).id
  centreB = (await one("select id from centres where code = 'KKD-03'")).id
  A = await as('EKM-07', 'admin'); A1 = await as('EKM-07', 'counsellor1'); A2 = await as('EKM-07', 'counsellor2')
  B = await as('KKD-03', 'admin'); HQ = await as('', 'hqadmin'); DM = await as('EKM', 'manager')
})
after(async () => { await pool.end(); await workerPool.end(); await owner.end() })

describe('ingestion gate', () => {
  test('phones normalise to E.164 for India and the Gulf; junk is rejected', () => {
    assert.equal(normalisePhone('098470 12345', 'IN')?.e164, '+919847012345')
    assert.equal(normalisePhone('+971 50 123 4567', 'IN')?.country, 'AE')
    assert.equal(normalisePhone('0501234567', 'AE')?.e164, '+971501234567')
    assert.equal(normalisePhone('12345', 'IN'), null)
  })
  test('manual entry: raw event stored, lead owned by the entering counsellor, activity, consent, day-0 task', async () => {
    const r = await addLead(A1, { phone: '9847012345', name: 'Asha Menon', students: [{ name: 'Rahul', grade: '11', stream: 'PCMB' }], consent: { status: 'granted' } })
    assert.equal(r.outcome, 'created'); leadA = r.lead_id
    const l = await one('select * from leads where id = $1', [leadA])
    assert.equal(l.primary_phone, '+919847012345'); assert.equal(l.owner_user_id, A1.user_id)
    assert.equal(l.current_centre_id, centreA); assert.equal(l.origin_centre_id, centreA); assert.equal(l.lifecycle, 'ENQUIRY')
    assert.equal(l.consent_status, 'granted'); assert.ok(l.next_followup_at)
    assert.equal((await one("select count(*)::int n from inbound_events where lead_id = $1 and processing_status = 'processed' and payload->>'phone' = '9847012345'", [leadA])).n, 1)
    assert.equal((await one('select count(*)::int n from students where lead_id = $1', [leadA])).n, 1)
    assert.equal((await one("select count(*)::int n from consents where lead_id = $1 and status = 'granted'", [leadA])).n, 1)
    assert.deepEqual((await owner.query('select type from activities where lead_id = $1 order by id', [leadA])).rows.map((x) => x.type), ['lead_created', 'lead_assigned'])
  })
  test('NOTHING reaches leads except through the gate: no select, insert, update or delete for app roles', async () => {
    for (const sql of ['select * from leads', "insert into leads (org_id, source_l1) values (gen_random_uuid(), 'x')", "update leads set lifecycle = 'ENROLLED'",
      'delete from leads', 'select * from lead_phones', 'select * from parent_identities', "insert into activities (org_id, lead_id, type) select org_id, id, 'x' from lead_list",
      "update tasks set status = 'done'", "insert into students (org_id, lead_id, name) select org_id, id, 'x' from lead_list"]) {
      await denied(withTenant(HQ, (db) => db.query(sql)), /permission denied/)
    }
    await denied(withTenant(A, (db) => db.query('select app.project_activity($1, $2, $3, now())', [leadA, 'lifecycle_change', '{"to":"ENROLLED"}'])), /permission denied/)
    await denied(withTenant(A, (db) => db.query('select app.claim_events(5)')), /permission denied/)
  })
  test('origin_centre_id and the activity log are immutable even for the table owner', async () => {
    await assert.rejects(owner.query('update leads set origin_centre_id = $1 where id = $2', [centreB, leadA]), /never changes/)
    await assert.rejects(owner.query('update activities set payload = $1', ['{}']), /append-only/)
    await assert.rejects(owner.query('delete from activities'), /append-only/)
  })
  test('dedupe is strict within the centre, across formats and users', async () => {
    const r = await addLead(A, { phone: '+91 98470-12345', name: 'Someone Else' })
    assert.deepEqual([r.outcome, r.lead_id], ['duplicate', leadA])
    assert.equal((await one("select count(*)::int n from leads where primary_phone = '+919847012345' and current_centre_id = $1", [centreA])).n, 1)
  })
  test('idempotency: the same event key twice creates one event, one lead, one set of activities', async () => {
    const a = await addLead(A1, { phone: '9847000001', name: 'Idem' }, { key: 'idem-1' })
    const b = await addLead(A1, { phone: '9847000001', name: 'Idem' }, { key: 'idem-1' })
    assert.equal(b.lead_id, a.lead_id); assert.equal(b.replayed, true)
    assert.equal((await one("select count(*)::int n from inbound_events where idempotency_key = 'idem-1'")).n, 1)
    assert.equal((await one("select count(*)::int n from activities where lead_id = $1 and type = 'lead_created'", [a.lead_id])).n, 1)
  })
  test('concurrent ingestion of one number yields one lead', async () => {
    const rs = await Promise.all([1, 2, 3, 4, 5].map((i) => addLead(A, { phone: '9847000002', name: 'Race ' + i })))
    assert.equal(new Set(rs.map((r) => r.lead_id)).size, 1)
    assert.equal(rs.filter((r) => r.outcome === 'created').length, 1)
  })
  test('DNC blocks ingestion; centre users cannot read or edit the registry', async () => {
    await withTenant(HQ, (db) => db.query("select app.dnc_add('+919847000003', 'asked not to be called')"))
    assert.deepEqual(await addLead(A1, { phone: '9847000003' }), { outcome: 'dnc', lead_id: null })
    await withTenant(A, async (db) => assert.equal((await db.query('select 1 from dnc')).rowCount, 0))
    await denied(withTenant(A, (db) => db.query("select app.dnc_add('+919847000099', 'x')")))
  })
  test('a centre user cannot ingest into another centre, whatever centre id they pass', async () => {
    const r = await addLead(B, { phone: '9847000004', name: 'Smuggled' }, { centre: centreA })
    assert.equal((await one('select current_centre_id c from leads where id = $1', [r.lead_id])).c, centreB)
  })
})

describe('cross-centre conflicts (LT-4)', () => {
  let leadB: string
  test('the second centre saves normally and learns nothing; HQ sees the conflict; first touch = earliest lead', async () => {
    const r = await addLead(B, { phone: '9847012345', name: 'Asha (at KKD)' })
    assert.equal(r.outcome, 'created'); assert.notEqual(r.lead_id, leadA); leadB = r.lead_id
    for (const c of [A, B, DM]) await withTenant(c, async (db) => assert.equal((await db.query('select 1 from conflicts')).rowCount, 0))
    await withTenant(HQ, async (db) => {
      const { rows } = await db.query('select * from conflicts where new_lead_id = $1', [leadB])
      assert.equal(rows[0].first_lead_id, leadA); assert.equal(rows[0].status, 'auto_resolved'); assert.deepEqual(rows[0].credited_centre_ids, [centreA])
      await db.query("select app.resolve_conflict($1, 'share_credit', 'both worked it')", [rows[0].id])
    })
    assert.equal((await one('select cardinality(credited_centre_ids) n from conflicts where new_lead_id = $1', [leadB])).n, 2)
    await denied(withTenant(B, (db) => db.query("select app.resolve_conflict((select id from conflicts limit 1), 'keep_first')")))
  })
  test("policy 'hq_decides' leaves the conflict open", async () => {
    await owner.query("update orgs set cross_centre_policy = 'hq_decides'")
    await addLead(A, { phone: '9847000005' }); const r = await addLead(B, { phone: '9847000005' })
    assert.equal((await one('select status from conflicts where new_lead_id = $1', [r.lead_id])).status, 'open')
    await owner.query("update orgs set cross_centre_policy = 'first_touch_wins'")
  })
})

describe('PRD s50 CRITICAL: Centre B against Lead A', () => {
  test('GET, SEARCH, FILTER, related rows: nothing', async () => {
    await withTenant(B, async (db) => {
      assert.equal((await db.query('select 1 from lead_list where id = $1', [leadA])).rowCount, 0)
      assert.equal((await db.query('select 1 from lead_phone_list where lead_id = $1', [leadA])).rowCount, 0)
      for (const t of ['students', 'activities', 'tasks', 'consents', 'list_members'])
        assert.equal((await db.query(`select 1 from ${t} where lead_id = $1`, [leadA])).rowCount, 0, t)
      assert.equal((await db.query("select 1 from inbound_events where centre_id = $1", [centreA])).rowCount, 0)
      for (const q of ['9847012345', 'Asha Menon']) assert.deepEqual((await db.query('select app.search_lead_ids($1) as ids', [q])).rows[0].ids.filter((x: string) => x === leadA), [])
    })
    // the scope argument is only an index hint: forging Centre A's scope (or none) must still return nothing of A's
    for (const forged of [A, HQ, {}]) assert.equal((await list(B, {}, forged)).some((r) => r.current_centre_code === 'EKM-07' || r.centre_code === 'EKM-07'), false)
    for (const f of [{ q: 'Asha Menon' }, { q: '9847012345' }, { centre: centreA }, { owner: A1.user_id }, { ids: [leadA] }, { view: 'enquiry' }])
      assert.equal((await list(B, f)).some((r) => r.id === leadA), false, JSON.stringify(f))
  })
  test('UPDATE / DELETE / every write function: "not found", and the lead is untouched', async () => {
    const d = await disposition('Not interested')
    const before = await one('select row_to_json(l) j from leads l where id = $1', [leadA])
    for (const [sql, p] of [
      ['select app.add_note($1, $2)', [leadA, 'hi']], ['select app.apply_disposition($1, $2, $3)', [leadA, d, 'x']],
      ['select app.add_student($1, $2, 9)', [leadA, 'Mole']], ['select app.update_lead_contact($1, $2, null, null, null, null)', [leadA, 'pwned']],
      ['select app.tag_leads($1, $2)', [[leadA], 'pwned']], ['select app.create_task($1, $2, $3, now() + interval \'1 day\')', [leadA, 'call', 'x']],
      ['select app.assign_leads($1, $2)', [[leadA], B.user_id]], ['select app.anonymise_lead($1, $2)', [leadA, 'spite']],
      ['select app.rebuild_projection($1)', [leadA]],
      ['select app.complete_task((select id from tasks where lead_id = $1 limit 1))', [leadA]],
    ] as const) await denied(withTenant(B, (db) => db.query(sql, [...p] as unknown[])), /LEAD_NOT_FOUND|PERMISSION_DENIED/)
    await denied(withTenant(B, (db) => db.query('select app.transfer_leads($1, $2, $3)', [[leadA], centreB, 'mine now'])))
    assert.equal((await withTenant(B, (db) => db.query('select app.add_to_list($1, (select id from lists limit 1))', [[leadA]])).catch(() => ({ rows: [{ add_to_list: 0 }] }))).rows[0].add_to_list, 0)
    assert.deepEqual((await one('select row_to_json(l) j from leads l where id = $1', [leadA])).j, before.j)
  })
  test('EXPORT: denied without permission; with permission the file contains only Centre B rows', async () => {
    await denied(withTenant(B, (db) => db.query("select app.request_export('{}')")))
    await owner.query("update role_permissions set allowed = true where role = 'CENTRE_ADMIN' and permission_key = 'leads.export'")
    const { rows: [j] } = await withTenant(B, (db) => db.query('select app.request_export($1) as id', [JSON.stringify({ ids: [leadA], view: 'active' })]))
    const { rows: [j2] } = await withTenant(B, (db) => db.query("select app.request_export('{}') as id"))
    while (await processExport(workerPool));
    assert.equal((await one('select row_count n from export_jobs where id = $1', [j.id])).n, 0)       // asked for Lead A by id: zero rows
    const file = readFileSync((await one('select file_path p from export_jobs where id = $1', [j2.id])).p, 'utf8')
    assert.ok(!file.includes('Asha Menon') && !file.includes('EKM-07')); assert.ok(file.includes('KKD-03'))
    assert.ok(!file.includes('+919847012345') && /\+91•+\d{4}/.test(file), 'centre export is phone-masked without exports.unmasked_phone')
    await withTenant(A, async (db) => assert.equal((await db.query('select 1 from export_jobs where id = $1', [j2.id])).rowCount, 0))
    await owner.query("update role_permissions set allowed = false where role = 'CENTRE_ADMIN' and permission_key = 'leads.export'")
  })
  test('HQ succeeds at all of it, and the export is audited', async () => {
    assert.ok((await list(HQ, { q: 'Asha Menon' })).some((r) => r.id === leadA))
    assert.ok((await list(HQ, { q: '98470 12345' })).some((r) => r.id === leadA))
    assert.ok((await list(HQ, { centre: centreA })).every((r) => r.centre_code === 'EKM-07'))
    await withTenant(HQ, (db) => db.query('select app.add_note($1, $2)', [leadA, 'HQ reviewed']))
    const { rows: [j] } = await withTenant(HQ, (db) => db.query('select app.request_export($1) as id', [JSON.stringify({ ids: [leadA] })]))
    while (await processExport(workerPool));
    const job = await one('select * from export_jobs where id = $1', [j.id])
    assert.equal(job.row_count, 1); assert.ok(readFileSync(job.file_path, 'utf8').includes('+919847012345'))
    const log = await owner.query("select action, metadata from audit_log where target_id = $1 order by id", [j.id])
    assert.deepEqual(log.rows.map((r) => r.action), ['export.requested', 'export.completed']); assert.equal(log.rows[1].metadata.row_count, 1)
  })
  test('District Manager sees the district only; impersonating HQ cannot write', async () => {
    assert.ok((await list(DM, {})).some((r) => r.id === leadA)); assert.ok((await list(DM, {})).every((r) => r.centre_code.startsWith('EKM-')))
    await denied(withTenant({ ...HQ, role: 'CENTRE_ADMIN', centre_id: centreA, read_only: true }, (db) => db.query('select app.add_note($1, $2)', [leadA, 'x'])), /READ_ONLY/)
  })
})

describe('counsellor visibility and privacy toggles', () => {
  test("'own' (default): a counsellor cannot see a colleague's lead; 'all' opens the centre", async () => {
    assert.equal((await list(A2, { ids: [leadA] })).length, 0)
    await denied(withTenant(A2, (db) => db.query('select app.add_note($1, $2)', [leadA, 'x'])))
    await owner.query("update centres set counsellor_lead_visibility = 'all' where id = $1", [centreA])
    assert.equal((await list(A2, { ids: [leadA] })).length, 1)
    await owner.query("update centres set counsellor_lead_visibility = 'own' where id = $1", [centreA])
  })
  test('mask phone + hide source apply to list, drawer data and phone search', async () => {
    await owner.query("update role_permissions set allowed = false where role = 'COUNSELLOR' and permission_key in ('leads.view_phone','leads.view_source')")
    const [r] = await list(A1, { ids: [leadA] })
    assert.match(r.primary_phone, /^\+91•+2345$/); assert.equal(r.source_l1, null)
    await withTenant(A1, async (db) => assert.match((await db.query('select phone_e164 p from lead_phone_list where lead_id = $1', [leadA])).rows[0].p, /•/))
    assert.equal((await list(A1, { q: '9847012345' })).length, 0)
    await owner.query("update role_permissions set allowed = true where role = 'COUNSELLOR' and permission_key in ('leads.view_phone','leads.view_source')")
  })
})

describe('disposition engine drives lifecycle (TE-1..4)', () => {
  const apply = (c: Claims, lead: string, d: string, note: string | null = null, at: string | null = null) =>
    withTenant(c, (db) => db.query('select app.apply_disposition($1,$2,$3,$4) as lc', [lead, d, note, at])).then((r) => r.rows[0].lc)
  const state = (lead: string) => one('select lifecycle, attempts, closed_reason, next_followup_at, next_followup_origin, first_touch_at, tags from leads where id = $1', [lead])
  test('first attempt -> Prospect with a system follow-up on the cadence; user-set follow-up overrides it', async () => {
    await owner.query("update orgs set calling_start = '00:00', calling_end = '23:59:59', working_days = '{1,2,3,4,5,6,7}'")   // cadence maths without the calling-hours clamp
    assert.equal(await apply(A1, leadA, await disposition('Not reachable')), 'PROSPECT')
    let s = await state(leadA)
    assert.equal(s.attempts, 1); assert.equal(s.next_followup_origin, 'system'); assert.ok(s.first_touch_at)
    assert.ok(Math.abs(+s.next_followup_at - (+s.first_touch_at + 86400e3)) < 5000, 'attempt 2 is due on day 1')
    const when = new Date(Date.now() + 3 * 3600e3).toISOString()
    await withTenant(A1, (db) => db.query("select app.create_task($1, 'followup', 'Call after school', $2)", [leadA, when]))
    s = await state(leadA); assert.equal(s.next_followup_origin, 'user'); assert.equal(s.next_followup_at.toISOString(), when)
    assert.equal((await one("select count(*)::int n from tasks where lead_id = $1 and status = 'open'", [leadA])).n, 1)
  })
  test('validation: mandatory note, mandatory callback time, no past follow-ups', async () => {
    await assert.rejects(apply(A1, leadA, await disposition('Not interested')), /NOTE_REQUIRED/)
    await assert.rejects(apply(A1, leadA, await disposition('Call back later')), /FOLLOWUP_REQUIRED/)
    await assert.rejects(apply(A1, leadA, await disposition('Need details'), null, '2020-01-01T00:00:00Z'), /FOLLOWUP_IN_PAST/)
  })
  test('side effects: tag; positive -> Interested; negative -> Dead with reason, tasks closed, then locked', async () => {
    await apply(A1, leadA, await disposition('Price concern')); assert.deepEqual((await state(leadA)).tags, ['price-concern'])
    assert.equal(await apply(A1, leadA, await disposition('Interested')), 'INTERESTED')
    assert.equal(await apply(A1, leadA, await disposition('Not interested'), 'chose a tutor'), 'DEAD')
    const s = await state(leadA); assert.equal(s.closed_reason, 'Not interested'); assert.equal(s.next_followup_at, null)
    await assert.rejects(apply(A1, leadA, await disposition('Interested')), /LEAD_CLOSED/)
    assert.ok((await list(A1, { view: 'worked' })).some((r) => r.id === leadA)); assert.ok(!(await list(A1, { view: 'active' })).some((r) => r.id === leadA))
  })
  test('attempts exhausted closes the lead after the configured cadence (6)', async () => {
    const { lead_id } = await addLead(A1, { phone: '9847000006', name: 'Never answers' }); const d = await disposition('Not reachable')
    for (let i = 1; i <= 5; i++) assert.equal(await apply(A1, lead_id, d), 'PROSPECT')
    assert.equal(await apply(A1, lead_id, d), 'DEAD'); assert.equal((await state(lead_id)).closed_reason, 'Attempts exhausted')
  })
  test('the projection can be rebuilt from the activity log and matches (AL-2)', async () => {
    const cols = 'lifecycle, closed_reason, attempts, total_calls, first_touch_at, last_call_at, last_note_at, last_disposition_id, times_re_engaged, is_customer'
    const live = await one(`select ${cols} from leads where id = $1`, [leadA])
    await owner.query("update leads set lifecycle = 'ENQUIRY', attempts = 99, total_calls = 0, closed_reason = 'garbage' where id = $1", [leadA])
    await withTenant(HQ, (db) => db.query('select app.rebuild_projection($1)', [leadA]))
    assert.deepEqual(await one(`select ${cols} from leads where id = $1`, [leadA]), live)
  })
})

describe('asynchronous events: retry, dead-letter, replay, rechurn', () => {
  test('a repeat enquiry from a website event rechurns the Dead lead with history intact (LT-8, TE-7)', async () => {
    const n = (await one('select count(*)::int n from activities where lead_id = $1', [leadA])).n
    await hostileEvent({ phone: '+919847012345', source: { l1: 'Website', l2: 'elessons.net' } }, centreA, 'web-1')
    await processEvents(workerPool, noFetch)
    const l = await one('select lifecycle, times_re_engaged, attempts, next_followup_at from leads where id = $1', [leadA])
    assert.deepEqual([l.lifecycle, l.times_re_engaged, l.attempts], ['ENQUIRY', 1, 0]); assert.ok(l.next_followup_at)
    assert.ok((await one('select count(*)::int n from activities where lead_id = $1', [leadA])).n > n)
    assert.equal((await one("select outcome from inbound_events where idempotency_key = 'web-1'")).outcome, 'rechurned')
  })
  test('invalid phone is a recorded outcome, not a retry; a duplicate webhook is a no-op', async () => {
    const id = await hostileEvent({ phone: '12', name: 'bad' }, centreA, 'web-2'); assert.equal(await hostileEvent({ phone: '12' }, centreA, 'web-2'), id)
    await processEvents(workerPool, noFetch)
    assert.deepEqual(await one('select processing_status s, outcome o, retry_count r from inbound_events where id = $1', [id]), { s: 'processed', o: 'invalid', r: 0 })
  })
  test('processing failure: backoff, then dead-letter visible to HQ only, then replay succeeds, nothing lost', async () => {
    await owner.query("create function public.boom() returns trigger language plpgsql as $$ begin raise exception 'simulated outage'; end $$; create trigger boom before insert on leads for each row execute function public.boom()")
    const id = await hostileEvent({ phone: '+919847000007', name: 'Survivor' }, centreA, 'web-3')
    await processEvents(workerPool, noFetch)
    let e = await one('select * from inbound_events where id = $1', [id])
    assert.equal(e.processing_status, 'failed'); assert.equal(e.retry_count, 1); assert.match(e.error, /simulated outage/); assert.ok(e.next_retry_at > new Date())
    assert.equal(await processEvents(workerPool, noFetch), 0, 'not retried before its backoff elapses')
    for (let i = 0; i < 5; i++) { await owner.query("update inbound_events set next_retry_at = now() where id = $1", [id]); await processEvents(workerPool, noFetch) }
    e = await one('select * from inbound_events where id = $1', [id]); assert.equal(e.processing_status, 'dead'); assert.equal(e.payload.name, 'Survivor')
    await withTenant(HQ, async (db) => assert.equal((await db.query("select 1 from inbound_events where id = $1 and processing_status = 'dead'", [id])).rowCount, 1))
    await withTenant(A1, async (db) => assert.equal((await db.query('select 1 from inbound_events')).rowCount, 0))
    await denied(withTenant(A, (db) => db.query('select app.replay_event($1)', [id])))
    await owner.query('drop trigger boom on leads; drop function public.boom()')       // "the fix"
    await withTenant(HQ, (db) => db.query('select app.replay_event($1)', [id])); await processEvents(workerPool, noFetch)
    e = await one('select * from inbound_events where id = $1', [id]); assert.deepEqual([e.processing_status, e.outcome], ['processed', 'created'])
    assert.equal((await one("select count(*)::int n from leads where primary_phone = '+919847000007'")).n, 1)
  })
  test('an event stuck in "processing" by a crashed worker is reclaimed', async () => {
    const id = await hostileEvent({ phone: '+919847000008' }, centreA, 'web-4')
    await owner.query("update inbound_events set processing_status = 'processing', locked_at = now() - interval '10 minutes' where id = $1", [id])
    await processEvents(workerPool, noFetch)
    assert.equal((await one('select processing_status s from inbound_events where id = $1', [id])).s, 'processed')
  })
  test('HQ-scoped events land in the HQ pool, unassigned, invisible to centres', async () => {
    await hostileEvent({ phone: '+971501234567', name: 'Gulf parent' }, null, 'web-5'); await processEvents(workerPool, noFetch)
    const l = await one("select * from leads where primary_phone = '+971501234567'")
    assert.deepEqual([l.current_centre_id, l.owner_user_id, l.timezone, l.country], [null, null, 'Asia/Dubai', 'AE'])
    assert.equal((await list(A, { ids: [l.id] })).length + (await list(DM, { ids: [l.id] })).length, 0); assert.equal((await list(HQ, { view: 'unassigned', ids: [l.id] })).length, 1)
  })
})

describe('assignment and transfers (AS-7, TR-1..3)', () => {
  let lead: string
  test('assign within the centre only; history kept; counsellors cannot assign', async () => {
    lead = (await addLead(A, { phone: '9847000010', name: 'Transfer Me' })).lead_id
    await withTenant(A, (db) => db.query('select app.add_note($1, $2)', [lead, 'EKM private note']))
    await withTenant(A, (db) => db.query('select app.assign_leads($1, $2)', [[lead], A2.user_id]))
    assert.equal((await list(A2, { ids: [lead] })).length, 1)
    await assert.rejects(withTenant(A, (db) => db.query('select app.assign_leads($1, $2)', [[lead], B.user_id])), /OWNER_NOT_IN_CENTRE/)
    await denied(withTenant(A2, (db) => db.query('select app.assign_leads($1, $2)', [[lead], A1.user_id])))
    assert.equal((await one("select count(*)::int n from activities where lead_id = $1 and type = 'lead_assigned'", [lead])).n, 2)
  })
  test('who may transfer, and where', async () => {
    await denied(withTenant(A, (db) => db.query('select app.transfer_leads($1,$2,$3)', [[lead], centreA2, 'x'])))
    await denied(withTenant(DM, (db) => db.query('select app.transfer_leads($1,$2,$3)', [[lead], centreB, 'outside my district'])), /CENTRE_NOT_FOUND/)
    await assert.rejects(withTenant(HQ, (db) => db.query('select app.transfer_leads($1,$2,$3)', [[lead], centreB, '  '])), /REASON_REQUIRED/)
    const r = await withTenant(DM, (db) => db.query('select app.transfer_leads($1,$2,$3) as r', [[lead], centreA2, 'closer to home']))
    assert.equal(r.rows[0].r.transferred, 1)
  })
  test('after transfer: origin fixed, old centre blind, new centre sees the lead but not the old centre\'s notes, HQ sees the chain', async () => {
    await withTenant(HQ, (db) => db.query('select app.transfer_leads($1,$2,$3)', [[lead], centreB, 'parent moved to Kozhikode']))
    const l = await one('select * from leads where id = $1', [lead])
    assert.deepEqual([l.origin_centre_id, l.current_centre_id, l.assign_status], [centreA, centreB, 'assigned']); assert.equal(l.owner_user_id, B.user_id)
    assert.equal((await list(A, { ids: [lead] })).length + (await list(A2, { ids: [lead] })).length + (await list(DM, { ids: [lead] })).length, 0)
    await denied(withTenant(A, (db) => db.query('select app.add_note($1, $2)', [lead, 'still mine?'])))
    await withTenant(B, async (db) => {
      assert.equal((await db.query('select 1 from lead_list where id = $1', [lead])).rowCount, 1)
      const types = (await db.query('select type, payload from activities where lead_id = $1 order by id', [lead])).rows
      assert.deepEqual(types.map((t) => t.type), ['lead_transferred_in']); assert.ok(!JSON.stringify(types).includes('EKM'))
      assert.equal((await db.query('select 1 from transfers')).rowCount, 0)
    })
    await withTenant(HQ, async (db) => {
      assert.ok((await db.query("select 1 from activities where lead_id = $1 and payload->>'note' = 'EKM private note'", [lead])).rowCount)
      const chain = (await db.query('select from_centre_id f, to_centre_id t, reason from transfers where lead_id = $1 order by id', [lead])).rows
      assert.deepEqual(chain.map((c) => [c.f, c.t]), [[centreA, centreA2], [centreA2, centreB]])
    })
    assert.equal((await one("select count(*)::int n from audit_log where action = 'leads.transferred'")).n, 2)
  })
  test('bulk transfer skips a lead whose parent already has a record in the target centre', async () => {
    const x = (await addLead(A, { phone: '9847000011' })).lead_id; await addLead(B, { phone: '9847000011' })
    const y = (await addLead(A, { phone: '9847000012' })).lead_id
    const { rows: [r] } = await withTenant(HQ, (db) => db.query('select app.transfer_leads($1,$2,$3) as r', [[x, y], centreB, 'centre consolidation']))
    assert.deepEqual(r.r, { transferred: 1, skipped_duplicate_in_target: [x] })
  })
})

describe('bulk import (LT-6, LS-3) and erasure', () => {
  test('report counts Success / Duplicate / DNC / Invalid; batch becomes a list; re-running is a no-op', async () => {
    const rows = [{ Mobile: '9847000020', Parent: 'Imp One', Child: 'Kid', Class: 'Grade 9' }, { Mobile: '98470 00020', Parent: 'Imp One again' },
      { Mobile: '9847000003', Parent: 'On DNC' }, { Mobile: 'n/a', Parent: 'No phone' }, { Mobile: '9847000021', Parent: 'Imp Two' }]
    const { rows: [b] } = await withTenant(A, (db) => db.query('select app.create_import_batch($1,$2,$3,$4) as id', [centreB, 'leads.csv', ['Mobile', 'Parent', 'Child', 'Class'], JSON.stringify(rows)]))
    assert.equal(await processEvents(workerPool, noFetch), 0, 'rows are held until the mapping is confirmed')
    const mapping = JSON.stringify({ phone: 'Mobile', name: 'Parent', student_name: 'Child', grade: 'Class' })
    await withTenant(A, (db) => db.query('select app.start_import($1,$2)', [b.id, mapping])); await withTenant(A, (db) => db.query('select app.start_import($1,$2)', [b.id, mapping]))
    while (await processEvents(workerPool, noFetch));
    const counts = Object.fromEntries((await owner.query('select outcome, count(*)::int n from inbound_events where import_batch_id = $1 group by 1', [b.id])).rows.map((r) => [r.outcome, r.n]))
    assert.deepEqual(counts, { created: 2, duplicate: 1, dnc: 1, invalid: 1 })
    const batch = await one('select * from import_batches where id = $1', [b.id]); assert.equal(batch.status, 'done'); assert.equal(batch.centre_id, centreA, 'centre admin cannot import into another centre')
    assert.equal((await one('select count(*)::int n from list_members where list_id = $1', [batch.list_id])).n, 2)
    assert.equal((await one("select s.grade from students s join leads l on l.id = s.lead_id where l.primary_phone = '+919847000020'")).grade, 9)
    assert.equal((await one('select count(*)::int n from lists where origin = $1 and centre_id = $2', ['upload', centreA])).n, 1)
    await denied(withTenant(A1, (db) => db.query('select app.create_import_batch($1,$2,$3,$4)', [centreA, 'x.csv', ['a'], '[]'])))
  })
  test('erasure anonymises, keeps the row for counts, is audited, and frees the number', async () => {
    const { lead_id } = await addLead(A, { phone: '9847000030', name: 'Forget Me', email: 'f@example.com', students: [{ name: 'Child', grade: '10' }] })
    await denied(withTenant(A1, (db) => db.query('select app.anonymise_lead($1, $2)', [lead_id, 'x'])))
    await withTenant(A, (db) => db.query('select app.anonymise_lead($1, $2)', [lead_id, 'parent request']))
    const l = await one('select name, primary_phone, email, parent_identity_id, lifecycle, anonymised_at from leads where id = $1', [lead_id])
    assert.deepEqual([l.name, l.primary_phone, l.email, l.parent_identity_id, l.lifecycle], [null, null, null, null, 'DEAD']); assert.ok(l.anonymised_at)
    assert.equal((await one('select name from students where lead_id = $1', [lead_id])).name, '[erased]')
    assert.equal((await one("select count(*)::int n from audit_log where action = 'lead.erased' and target_id = $1", [lead_id])).n, 1)
    assert.equal((await addLead(A, { phone: '9847000030', name: 'New enquiry' })).outcome, 'created')
  })
})

describe('repeat enquiry from the action menu, CSV parsing', () => {
  test('a closed lead is reopened through the gate, even by a user who only sees a masked phone', async () => {
    const { lead_id } = await addLead(A1, { phone: '9847000040', name: 'Comes Back' })
    await withTenant(A1, async (db) => db.query('select app.apply_disposition($1,$2,$3)', [lead_id, await disposition('Wrong number'), null]))
    await owner.query("update role_permissions set allowed = false where role = 'COUNSELLOR' and permission_key = 'leads.view_phone'")
    const { rows: [r] } = await withTenant(A1, (db) => db.query('select app.repeat_enquiry($1) as r', [lead_id]))
    await owner.query("update role_permissions set allowed = true where role = 'COUNSELLOR' and permission_key = 'leads.view_phone'")
    assert.deepEqual([r.r.outcome, r.r.lead_id], ['rechurned', lead_id])
    assert.equal((await one('select lifecycle from leads where id = $1', [lead_id])).lifecycle, 'ENQUIRY')
    await denied(withTenant(B, (db) => db.query('select app.repeat_enquiry($1)', [lead_id])))
  })
  test('CSV: quotes, embedded commas and newlines, CRLF, BOM', async () => {
    const { parseCsv } = await import('../src/lib/csv.ts')
    assert.deepEqual(parseCsv('﻿Name,Phone\r\n"Menon, Asha","98470 12345"\r\n"Line\nbreak ""q""",1\n'), [['Name', 'Phone'], ['Menon, Asha', '98470 12345'], ['Line\nbreak "q"', '1'], ['']])
  })
})
