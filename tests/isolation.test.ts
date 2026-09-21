// PRD s14: "Automated tests attempt cross-centre reads and must fail. Run on every deploy."
// These connect as `elessons_app` — NOT the table owner, NOT superuser — because owners and
// superusers bypass RLS and would make every assertion here meaningless.
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import pg from 'pg'
import { claimsForToken, login, logout, setImpersonation } from '../src/lib/auth-core.ts'
import { pool, withTenant, type Claims } from '../src/lib/db.ts'
import { hashPassword } from '../src/lib/password.ts'
import { seed, SEED_PASSWORD } from '../scripts/seed.ts'

const owner = new pg.Client({ connectionString: process.env.TEST_MIGRATE_DATABASE_URL ?? 'postgres:///elessons_test' })
const ownerId = async (sql: string, p: unknown[] = []) => (await owner.query(sql, p)).rows[0].id as string
const as = async (code: string, username: string): Promise<Claims> => {
  const r = await login(code, username, SEED_PASSWORD, '10.0.0.1', 'test')
  assert.ok(r.ok, `login ${code}/${username}`)
  return (await claimsForToken(r.token))!
}
const denied = (p: Promise<unknown>, re = /permission denied|PERMISSION_DENIED|row-level security/) => assert.rejects(p, re)

let A: Claims, B: Claims, counsellorB: Claims, HQ: Claims, DM: Claims
let centreA: string, centreB: string, userA: string

before(async () => {
  await owner.connect()
  if (!(await owner.query('select 1 from orgs')).rowCount) await seed(owner)
  centreA = await ownerId("select id from centres where code = 'EKM-07'")
  centreB = await ownerId("select id from centres where code = 'KKD-03'")
  userA = await ownerId("select id from users where centre_id = $1 and username = 'counsellor1'", [centreA])
  A = await as('EKM-07', 'admin'); B = await as('KKD-03', 'admin'); counsellorB = await as('KKD-03', 'counsellor1')
  HQ = await as('', 'hqadmin'); DM = await as('EKM', 'manager')
})
after(async () => { await pool.end(); await owner.end() })

test('the test connection is genuinely unprivileged', async () => {
  const { rows: [r] } = await pool.query('select current_user, (select rolsuper or rolbypassrls from pg_roles where rolname = current_user) as priv')
  assert.deepEqual(r, { current_user: 'elessons_app', priv: false })
  const { rows: [o] } = await pool.query("select tableowner from pg_tables where tablename = 'centres'")
  assert.notEqual(o.tableowner, 'elessons_app')
})

describe('Centre B attacking Centre A — every operation must fail safely', () => {
  test('GET by id', () => withTenant(B, async (db) => {
    assert.equal((await db.query('select * from centres where id = $1', [centreA])).rowCount, 0)
    assert.equal((await db.query('select id from users where id = $1', [userA])).rowCount, 0)
  }))
  test('SEARCH / FILTER / unfiltered list never include Centre A', () => withTenant(B, async (db) => {
    assert.equal((await db.query("select id from users where display_name ilike '%EKM-07%'")).rowCount, 0)
    assert.equal((await db.query('select id from users where centre_id = $1', [centreA])).rowCount, 0)
    const all = await db.query('select distinct centre_id from users')
    assert.deepEqual(all.rows.map((r) => r.centre_id), [centreB])
    assert.deepEqual((await db.query('select code from centres')).rows, [{ code: 'KKD-03' }])
    assert.deepEqual((await db.query('select code from districts')).rows, [{ code: 'KKD' }])
  }))
  test('UPDATE touches zero rows and changes nothing', async () => {
    await denied(withTenant(B, (db) => db.query("update centres set name = 'pwned' where id = $1", [centreA])).then((r) => {
      assert.equal(r.rowCount, 0); throw new Error('permission denied (0 rows)')
    }))
    assert.equal((await owner.query('select name from centres where id = $1', [centreA])).rows[0].name, 'G-TEC Ernakulam 7')
    await denied(withTenant(B, (db) => db.query("update users set display_name = 'pwned' where id = $1", [userA])))
  })
  test('DELETE is not granted to anyone', async () => {
    await denied(withTenant(B, (db) => db.query('delete from centres where id = $1', [centreA])))
    await denied(withTenant(B, (db) => db.query('delete from users where id = $1', [userA])))
    await denied(withTenant(HQ, (db) => db.query('delete from centres where id = $1', [centreA])))
  })
  test('INSERT into another tenant / user management across centres', async () => {
    const h = await hashPassword('x'.repeat(12))
    await denied(withTenant(B, (db) => db.query("select app.create_user('mole','Mole','COUNSELLOR',$1,$2)", [h, centreA])))
    await denied(withTenant(B, (db) => db.query('select app.set_user_active($1, false)', [userA])))
    await denied(withTenant(B, (db) => db.query('select app.set_user_password($1, $2)', [userA, h])))
    await denied(withTenant(B, (db) => db.query('select app.deactivate_centre($1, $2)', [centreA, 'spite'])))
    await denied(withTenant(B, (db) => db.query("insert into centres (org_id, district_id, code, name) select org_id, district_id, 'KKD-99', 'x' from centres limit 1")))
  })
  test('privilege escalation: Centre Admin cannot mint admins; Counsellor cannot mint anyone', async () => {
    const h = await hashPassword('x'.repeat(12))
    await denied(withTenant(B, (db) => db.query("select app.create_user('boss','Boss','HQ_ADMIN',$1)", [h])))
    await denied(withTenant(B, (db) => db.query("select app.create_user('admin2','A2','CENTRE_ADMIN',$1,$2)", [h, centreB])))
    await denied(withTenant(counsellorB, (db) => db.query("select app.create_user('pal','Pal','COUNSELLOR',$1,$2)", [h, centreB])))
    await denied(withTenant(B, (db) => db.query("update role_permissions set allowed = true where role = 'CENTRE_ADMIN'")).then((r) => {
      assert.equal(r.rowCount, 0); throw new Error('permission denied (0 rows)')
    }))
  })
  test('secrets are unreachable: password hashes, sessions, auth functions, audit of other centres', async () => {
    await denied(withTenant(B, (db) => db.query('select password_hash from users')))
    await denied(withTenant(B, (db) => db.query('select * from users')))   // * includes password_hash
    await denied(withTenant(HQ, (db) => db.query('select password_hash from users')))
    await denied(withTenant(B, (db) => db.query('select * from sessions')))
    await denied(withTenant(B, (db) => db.query("select * from app.auth_lookup('EKM-07','admin')")))
    await withTenant(B, async (db) => {
      const r = await db.query('select distinct centre_id from audit_log')
      assert.deepEqual(r.rows.map((x) => x.centre_id), [centreB])
    })
  })
  test('no claims, or claims for a disabled principal, see nothing', async () => {
    await withTenant({} as Claims, async (db) => {
      for (const t of ['orgs', 'districts', 'centres', 'audit_log', 'role_permissions'])
        assert.equal((await db.query(`select 1 from ${t}`)).rowCount, 0, t)
      assert.equal((await db.query('select id from users')).rowCount, 0)
    })
  })
})

describe('legitimate access succeeds', () => {
  test('Centre Admin sees exactly their centre and manages their counsellors', async () => {
    const h = await hashPassword('x'.repeat(12))
    await withTenant(A, async (db) => {
      assert.deepEqual((await db.query('select code from centres')).rows, [{ code: 'EKM-07' }])
      assert.equal((await db.query('select id from users')).rowCount, 3)
      await db.query("select app.create_user('newbie','New Counsellor','COUNSELLOR',$1,$2)", [h, centreA])
      assert.equal((await db.query('select id from users')).rowCount, 4)
    })
    const r = await login('EKM-07', 'newbie', 'x'.repeat(12), null, null)
    assert.ok(r.ok)
  })
  test('District Manager sees all centres of the district and no others', () => withTenant(DM, async (db) => {
    const codes = (await db.query('select code from centres order by code')).rows.map((r) => r.code)
    assert.equal(codes.length, 8)
    assert.ok(codes.every((c: string) => c.startsWith('EKM-')))
  }))
  test('HQ sees every district, centre and user, can create a centre, and it is audited', () => withTenant(HQ, async (db) => {
    assert.equal((await db.query('select 1 from districts')).rowCount, 5)
    assert.equal((await db.query('select 1 from centres')).rowCount, 20)
    assert.equal((await db.query('select id from users where id = $1', [userA])).rowCount, 1)
    const { rows: [c] } = await db.query(
      "insert into centres (org_id, district_id, code, name) select org_id, id, 'TSR-09', 'G-TEC Thrissur 9' from districts where code = 'TSR' returning id")
    const log = await db.query("select actor_user_id from audit_log where action = 'centres.insert' and target_id = $1", [c.id])
    assert.equal(log.rows[0].actor_user_id, HQ.user_id)
  }))
})

describe('auth', () => {
  test('same username in two centres resolves by centre code; wrong code fails', async () => {
    assert.notEqual(A.user_id, B.user_id)
    assert.equal(A.centre_id, centreA)
    assert.deepEqual(await login('KKD-03', 'hqadmin', SEED_PASSWORD, null, null), { ok: false, code: 'INVALID_CREDENTIALS' })
    assert.deepEqual(await login('', 'admin', SEED_PASSWORD, null, null), { ok: false, code: 'INVALID_CREDENTIALS' })
  })
  test('lockout after repeated failures, even with the right password afterwards', async () => {
    for (let i = 0; i < 5; i++) await login('TVM-01', 'counsellor2', 'wrong-password', null, null)
    assert.deepEqual(await login('TVM-01', 'counsellor2', SEED_PASSWORD, null, null), { ok: false, code: 'LOCKED' })
  })
  test('logout and disabling a user kill the session on the next request', async () => {
    const r = await login('TVM-01', 'counsellor1', SEED_PASSWORD, null, null); assert.ok(r.ok)
    await logout(r.token, null)
    assert.equal(await claimsForToken(r.token), null)
    const r2 = await login('TVM-01', 'admin', SEED_PASSWORD, null, null); assert.ok(r2.ok)
    const victim = (await claimsForToken(r2.token))!
    await withTenant(HQ, (db) => db.query('select app.set_user_active($1, false)', [victim.user_id]))
    assert.equal(await claimsForToken(r2.token), null)
  })
  test('deactivating a centre locks out its users immediately and preserves all rows', async () => {
    const r = await login('DXB-02', 'admin', SEED_PASSWORD, null, null); assert.ok(r.ok)
    const dxb = (await claimsForToken(r.token))!.centre_id
    await withTenant(HQ, (db) => db.query('select app.deactivate_centre($1, $2)', [dxb, 'closed']))
    assert.equal(await claimsForToken(r.token), null)
    assert.deepEqual(await login('DXB-02', 'admin', SEED_PASSWORD, null, null), { ok: false, code: 'INVALID_CREDENTIALS' })
    assert.equal((await owner.query('select 1 from users where centre_id = $1', [dxb])).rowCount, 3)
  })
})

describe('impersonation (TEN-6) is read-only in the database', () => {
  test('HQ views as Centre A: scoped to A, cannot write, start/end audited; centre users cannot impersonate', async () => {
    const r = await login('', 'hqadmin', SEED_PASSWORD, null, null); assert.ok(r.ok)
    await setImpersonation(r.token, centreA, '10.0.0.9')
    const imp = (await claimsForToken(r.token))!
    assert.equal(imp.read_only, true)
    await withTenant(imp, async (db) => assert.deepEqual((await db.query('select code from centres')).rows, [{ code: 'EKM-07' }]))
    const h = await hashPassword('x'.repeat(12))
    await denied(withTenant(imp, (db) => db.query("select app.create_user('ghost','Ghost','COUNSELLOR',$1,$2)", [h, centreA])))
    await denied(withTenant(imp, (db) => db.query('select app.set_user_active($1, false)', [userA])))
    await setImpersonation(r.token, null, '10.0.0.9')
    assert.equal((await claimsForToken(r.token))!.role, 'HQ_ADMIN')
    const log = await owner.query("select action from audit_log where actor_user_id = $1 and action like 'impersonation.%' order by id", [imp.user_id])
    assert.deepEqual(log.rows.map((x) => x.action), ['impersonation.started', 'impersonation.ended'])
    const rb = await login('KKD-03', 'admin', SEED_PASSWORD, null, null); assert.ok(rb.ok)
    await denied(setImpersonation(rb.token, centreA, null))
  })
})

test('audit_log is append-only even for the table owner', async () => {
  await denied(owner.query("update audit_log set action = 'x'"), /append-only/)
  await denied(owner.query('delete from audit_log'), /append-only/)
  await denied(owner.query('truncate audit_log'), /append-only/)
})
