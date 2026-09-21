// Phase 2: calling hours, SLA, pull-back, saved views, funnel report + drill-down, query builder, activity scope.
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { pool, withTenant, type Claims } from '../src/lib/db.ts'
import { buildLeadQuery } from '../src/lib/leads-query.ts'
import { funnelQuery } from '../src/lib/reports.ts'
import { addLead, as, denied, disposition, ensureSeed, one, owner, workerPool } from './helpers.ts'

let A: Claims, A1: Claims, B: Claims, HQ: Claims, DM: Claims, centreA: string
const list = (c: Claims, f: object) => withTenant(c, async (db) => { const q = buildLeadQuery(f, 200, c); return (await db.query(q.sql, q.params)).rows })
before(async () => {
  await ensureSeed()
  await owner.query("update orgs set calling_start = '09:00', calling_end = '20:00', working_days = '{1,2,3,4,5,6}', sla_first_touch_minutes = 15")
  centreA = (await one("select id from centres where code = 'EKM-02'")).id
  A = await as('EKM-02', 'admin'); A1 = await as('EKM-02', 'counsellor1'); B = await as('KKD-02', 'admin'); HQ = await as('', 'hqadmin'); DM = await as('EKM', 'manager')
})
after(async () => { await pool.end(); await workerPool.end(); await owner.end() })

describe('calling hours and SLA clock (TE-5, TE-6)', () => {
  const next = async (at: string, tz = 'Asia/Kolkata') => (await one('select app.next_calling_time($1::timestamptz, $2, o) as t from orgs o', [at, tz])).t.toISOString()
  const plus = async (at: string, mins: number) => (await one("select app.add_working_minutes($1::timestamptz, $2, 'Asia/Kolkata', o) as t from orgs o", [at, mins])).t.toISOString()
  test('inside hours: unchanged; before / after hours and Sunday: next opening, in the LEAD timezone', async () => {
    assert.equal(await next('2026-09-22T11:00:00+05:30'), '2026-09-22T05:30:00.000Z')           // Tue 11:00 IST stays
    assert.equal(await next('2026-09-22T07:00:00+05:30'), '2026-09-22T03:30:00.000Z')           // -> 09:00 IST
    assert.equal(await next('2026-09-22T21:30:00+05:30'), '2026-09-23T03:30:00.000Z')           // -> Wed 09:00 IST
    assert.equal(await next('2026-09-26T21:00:00+05:30'), '2026-09-28T03:30:00.000Z')           // Sat night -> Mon (Sunday closed)
    assert.equal(await next('2026-09-22T07:00:00+05:30', 'Asia/Dubai'), '2026-09-22T05:00:00.000Z')   // 05:30 in Dubai -> 09:00 GST
  })
  test('15 working minutes spans the night: 19:50 + 15 = 09:05 next day', async () => {
    assert.equal(await plus('2026-09-22T19:50:00+05:30', 15), '2026-09-23T03:35:00.000Z')
    assert.equal(await plus('2026-09-22T10:00:00+05:30', 15), '2026-09-22T04:45:00.000Z')
  })
  test('breach alerts the owner AND the Centre Admin once; a touched lead never breaches; 24 h flags for HQ', async () => {
    const waiting = (await addLead(A1, { phone: '9847100001', name: 'Waiting Parent' })).lead_id
    const worked = (await addLead(A1, { phone: '9847100002', name: 'Worked Parent' })).lead_id
    assert.ok((await one('select sla_due_at from leads where id = $1', [waiting])).sla_due_at, 'clock starts at ingestion')
    await withTenant(A1, async (db) => db.query('select app.apply_disposition($1,$2)', [worked, await disposition('Need details')]))
    await owner.query("update leads set sla_due_at = now() - interval '1 minute' where id = any($1)", [[waiting, worked]])
    const r1 = (await workerPool.query('select app.run_sla() as r')).rows[0].r, r2 = (await workerPool.query('select app.run_sla() as r')).rows[0].r
    assert.equal(r1.breach_15, 1); assert.equal(r2.breach_15, 0, 'idempotent')
    const notes = (await owner.query("select user_id from notifications where lead_id = $1 and kind = 'sla_15'", [waiting])).rows.map((r) => r.user_id).sort()
    assert.deepEqual(notes, [A.user_id, A1.user_id].sort())
    await withTenant(A1, async (db) => assert.equal((await db.query('select 1 from notifications')).rowCount, 1))     // own only
    await withTenant(B, async (db) => assert.equal((await db.query('select 1 from notifications')).rowCount, 0))
    await owner.query("update leads set enquiry_at = now() - interval '25 hours' where id = any($1)", [[waiting, worked]])
    assert.equal((await workerPool.query('select app.run_sla() as r')).rows[0].r.breach_24, 1)
    assert.deepEqual((await list(HQ, { sla: '24', view: 'all' })).map((r) => r.id), [waiting])
    assert.equal((await list(B, { sla: '24', view: 'all' })).length, 0)
    await denied(withTenant(A, (db) => db.query('select app.run_sla()')), /permission denied/)
  })
  test('HQ pulls an untouched lead back to the pool: custody recorded, centre loses it; centres cannot pull back', async () => {
    const id = (await addLead(A1, { phone: '9847100003', name: 'Pull Me Back' })).lead_id
    await denied(withTenant(A, (db) => db.query('select app.pull_back_leads($1,$2)', [[id], 'x'])))
    await denied(withTenant(DM, (db) => db.query('select app.pull_back_leads($1,$2)', [[id], 'x'])))
    await withTenant(HQ, (db) => db.query('select app.pull_back_leads($1,$2)', [[id], 'untouched 24h']))
    const l = await one('select current_centre_id c, owner_user_id o, origin_centre_id g, next_followup_at n from leads where id = $1', [id])
    assert.deepEqual([l.c, l.o, l.n, l.g], [null, null, null, centreA])
    assert.equal((await list(A, { ids: [id], view: 'all' })).length, 0); assert.equal((await list(HQ, { pool: '1', ids: [id] })).length, 1)
    assert.equal((await one('select to_centre_id t from transfers where lead_id = $1', [id])).t, null)
  })
  test('rechurn restarts the SLA clock', async () => {
    const id = (await addLead(A1, { phone: '9847100004' })).lead_id
    await withTenant(A1, async (db) => db.query('select app.apply_disposition($1,$2)', [id, await disposition('Wrong number')]))
    await owner.query("update leads set sla_15_breached_at = now(), sla_due_at = '2020-01-01' where id = $1", [id])
    await withTenant(A1, (db) => db.query('select app.repeat_enquiry($1)', [id]))
    const l = await one('select sla_15_breached_at b, sla_due_at > now() - interval \'1 day\' fresh, attempts from leads where id = $1', [id])
    assert.deepEqual([l.b, l.fresh, l.attempts], [null, true, 0])
  })
  test('system-set follow-ups land inside calling hours; a user-set time is never moved', async () => {
    const id = (await addLead(A1, { phone: '9847100005' })).lead_id
    await withTenant(A1, async (db) => db.query('select app.apply_disposition($1,$2)', [id, await disposition('Will watch demo')]))
    const t = await one("select (due_at at time zone 'Asia/Kolkata')::time between '09:00' and '20:00' ok, extract(isodow from due_at at time zone 'Asia/Kolkata') d from tasks where lead_id = $1 and status = 'open'", [id])
    assert.ok(t.ok && Number(t.d) !== 7)
    const late = new Date(Date.now() + 86400e3); late.setUTCHours(17, 30, 0, 0)     // 23:00 IST: outside hours, but the user asked for it
    await withTenant(A1, async (db) => db.query('select app.apply_disposition($1,$2,null,$3)', [id, await disposition('Call back later'), late.toISOString()]))
    assert.equal((await one("select due_at from tasks where lead_id = $1 and status = 'open'", [id])).due_at.toISOString(), late.toISOString())
  })
})

describe('saved views (WS-3)', () => {
  test('private by default; shared only with own centre; never across centres; delete own only', async () => {
    const mk = (c: Claims, name: string, shared: string | null) => withTenant(c, (db) => db.query('insert into saved_views (org_id, user_id, shared_centre_id, name, filters) values ($1,$2,$3,$4,$5) returning id', [c.org_id, c.user_id, shared, name, '{"view":"overdue"}']))
    await mk(A1, 'mine', null); const shared = (await mk(A, 'centre overdue', centreA)).rows[0].id
    await denied(mk(B, 'sneaky share', centreA)); await denied(mk({ ...A, read_only: true }, 'ro', null))
    await withTenant(A1, async (db) => assert.deepEqual((await db.query('select name from saved_views order by name')).rows.map((r) => r.name), ['centre overdue', 'mine']))
    await withTenant(B, async (db) => assert.equal((await db.query('select 1 from saved_views')).rowCount, 0))
    await withTenant(A1, async (db) => assert.equal((await db.query('delete from saved_views where id = $1', [shared])).rowCount, 0))
  })
})

describe('funnel report (RP-1, RP-2, RP-11)', () => {
  const funnel = (c: Claims, pivot: Parameters<typeof funnelQuery>[0], f: object = {}) => withTenant(c, async (db) => { const q = funnelQuery(pivot, f, c); return (await db.query(q.sql, q.params)).rows })
  test('every number equals the drill-down list behind it, and is scoped per role', async () => {
    await addLead(A1, { phone: '9847100010', source: { l1: 'Meta', l2: 'EKM Page' }, students: [{ name: 'G9', grade: '9' }] })
    const j = (await addLead(A1, { phone: '9847100011', source: { l1: 'Meta', l2: 'EKM Page' } })).lead_id
    await withTenant(A1, async (db) => db.query('select app.apply_disposition($1,$2)', [j, await disposition('Wrong number')]))
    const rows = await funnel(A, 'source'); const meta = rows.find((r) => r.key === 'Meta')
    assert.deepEqual([meta.total, meta.dead, meta.junk, meta.touched], [2, 1, 1, 1])
    assert.equal((await list(A, { view: 'all', source: 'Meta' })).length, meta.total)
    assert.equal((await list(A, { view: 'all', source: 'Meta', junk: '1' })).length, meta.junk)
    assert.equal((await list(A, { view: 'all', source: 'Meta', lifecycle: 'DEAD' })).length, meta.dead)
    assert.equal((await funnel(A, 'grade')).find((r) => r.key === '9').total, (await list(A, { view: 'all', grade: 9 })).length)
    const byCentre = await funnel(A, 'centre'); assert.deepEqual(byCentre.map((r) => r.key), ['EKM-02'])
    assert.ok((await funnel(DM, 'centre')).every((r) => r.key.startsWith('EKM-'))); assert.ok((await funnel(HQ, 'centre')).length > 1)
    assert.equal((await funnel(B, 'source', { source: 'Meta' })).reduce((n, r) => n + r.total, 0), 0)
  })
})

describe('query builder (WS-4)', () => {
  test('AND / OR groups over lead and student fields; hostile input is ignored, never executed', async () => {
    const qb = (g: object) => list(A, { view: 'all', qb: JSON.stringify(g) })
    const meta = await qb({ join: 'and', rules: [{ field: 'source_l1', op: 'eq', value: 'meta' }, { join: 'or', rules: [{ field: 'student_grade', op: 'eq', value: '9' }, { field: 'lifecycle', op: 'eq', value: 'DEAD' }] }] })
    assert.equal(meta.length, 2)
    assert.equal((await qb({ join: 'and', rules: [{ field: 'source_l1', op: 'eq', value: 'Meta' }, { field: 'attempts', op: 'gt', value: '0' }] })).length, 1)
    const all = (await list(A, { view: 'all' })).length
    for (const bad of [{ join: 'and', rules: [{ field: 'primary_phone; drop table leads', op: 'eq', value: 'x' }] }, { join: 'and', rules: [{ field: 'attempts', op: 'gt', value: '1 or 1=1' }] }, 'not json'])
      assert.equal((await list(A, { view: 'all', qb: typeof bad === 'string' ? bad : JSON.stringify(bad) })).length, all)
    assert.equal((await list(B, { view: 'all', qb: JSON.stringify({ join: 'or', rules: [{ field: 'source_l1', op: 'eq', value: 'Meta' }, { field: 'name', op: 'not_empty' }] }) })).some((r) => r.centre_code !== 'KKD-02'), false)
  })
})

test('activity metrics are scoped by where the work happened', async () => {
  const count = (c: Claims) => withTenant(c, async (db) => (await db.query("select count(*)::int n, count(distinct centre_id)::int centres from activity_scope where type = 'call_outcome'")).rows[0])
  const a = await count(A), a1 = await count(A1), b = await count(B), hq = await count(HQ)
  assert.ok(a.n >= 4 && a.centres === 1); assert.ok(a1.n <= a.n); assert.equal(b.n, 0); assert.ok(hq.n >= a.n)
  await denied(withTenant(A, (db) => db.query('select payload from activity_scope')), /does not exist/)
})
