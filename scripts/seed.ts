// Dev/test seed for Phase 0 tenancy: 1 org, 5 districts, 20 centres (incl. EKM-07), users for every role.
// Leads/deals/Meta sample data are seeded by later phases when those tables exist.
import pg from 'pg'
import { hashPassword } from '../src/lib/password.ts'

export const SEED_PASSWORD = process.env.SEED_PASSWORD ?? 'dev-only-password-1'
const DISTRICTS: [string, string, number][] = [
  ['EKM', 'Ernakulam', 8], ['KKD', 'Kozhikode', 4], ['TVM', 'Thiruvananthapuram', 3], ['TSR', 'Thrissur', 3], ['DXB', 'Dubai', 2],
]

export async function seed(db: pg.Client) {
  const { rows: [{ name }] } = await db.query('select current_database() as name')
  if (!/_(test|dev)$/.test(name)) throw new Error(`refusing to seed database "${name}"`)
  const hash = await hashPassword(SEED_PASSWORD)
  await db.query('begin')
  const { rows: [org] } = await db.query("insert into orgs (name) values ('G-TEC eLessons') returning id")
  await db.query('select app.seed_default_role_permissions($1)', [org.id])
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
        'insert into centres (org_id, district_id, code, name, timezone) values ($1,$2,$3,$4,$5) returning id',
        [org.id, d.id, ccode, `G-TEC ${dname} ${i}`, tz])
      await user('admin', `${ccode} Centre Admin`, 'CENTRE_ADMIN', d.id, c.id)
      await user('counsellor1', `${ccode} Counsellor 1`, 'COUNSELLOR', d.id, c.id)
      await user('counsellor2', `${ccode} Counsellor 2`, 'COUNSELLOR', d.id, c.id)
    }
  }
  await db.query('commit')
  return org.id as string
}

if (import.meta.main) {
  const db = new pg.Client({ connectionString: process.env.MIGRATE_DATABASE_URL ?? 'postgres:///elessons_dev' })
  await db.connect()
  await seed(db)
  await db.end()
  console.log(`seeded. Log in e.g. centre code EKM-07 / admin / ${SEED_PASSWORD}; HQ: (blank) / hqadmin`)
}
