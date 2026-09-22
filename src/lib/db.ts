// The ONLY way application code reaches tenant data. Every query runs as the unprivileged
// `authenticated` role with this request's claims, so Postgres RLS is the boundary — not the caller.
import pg from 'pg'

export type Role = 'SUPERADMIN' | 'HQ_ADMIN' | 'HQ_COUNSELLOR' | 'DISTRICT_MANAGER' | 'CENTRE_ADMIN' | 'COUNSELLOR'
export type Claims = {
  user_id: string
  real_user_id?: string
  org_id: string
  district_id: string | null
  centre_id: string | null
  role: Role
  read_only: boolean
  display_name: string
  must_change_password: boolean
  impersonating_centre_code?: string
  totp_required?: boolean
  totp_enabled?: boolean
  ip?: string
}

const g = globalThis as { __elessonsPool?: pg.Pool }
export const pool = (g.__elessonsPool ??= new pg.Pool({
  connectionString: process.env.DATABASE_URL ?? 'postgres://elessons_app@localhost/elessons_dev',
  max: 10,
}))

export async function withTenant<T>(claims: Claims, fn: (db: pg.PoolClient) => Promise<T>): Promise<T> {
  const db = await pool.connect()
  try {
    await db.query('begin')
    await db.query('set local role authenticated')
    await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)])
    const out = await fn(db)
    await db.query('commit')
    return out
  } catch (e) {
    await db.query('rollback').catch(() => {})
    throw e
  } finally {
    db.release()
  }
}

// Pre-auth calls (app.auth_* functions only). Runs as elessons_app, which has no table grants at all.
export async function authQuery<R extends pg.QueryResultRow>(sql: string, params: unknown[]): Promise<R[]> {
  return (await pool.query<R>(sql, params)).rows
}
