// Framework-free auth: opaque session tokens (not JWTs), stored hashed, so revocation is instant.
import { createHash, randomBytes } from 'node:crypto'
import { authQuery, type Claims } from './db.ts'
import { hashPassword, verifyPassword } from './password.ts'

export type LoginResult = { ok: true; token: string } | { ok: false; code: 'INVALID_CREDENTIALS' | 'LOCKED' }

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')
// Burned when the user doesn't exist so response time doesn't reveal which (centre, username) pairs are real.
const dummyHash = hashPassword('timing-equaliser')

export async function login(code: string, username: string, password: string, ip: string | null, userAgent: string | null): Promise<LoginResult> {
  const [u] = await authQuery<{ user_id: string; password_hash: string; locked_until: Date | null }>(
    'select * from app.auth_lookup($1, $2)', [code, username])
  if (!u) {
    await verifyPassword(password, await dummyHash)
    return { ok: false, code: 'INVALID_CREDENTIALS' }
  }
  if (u.locked_until && u.locked_until > new Date()) return { ok: false, code: 'LOCKED' }
  if (!(await verifyPassword(password, u.password_hash))) {
    await authQuery('select app.auth_record_failure($1, $2)', [u.user_id, ip])
    return { ok: false, code: 'INVALID_CREDENTIALS' }
  }
  const token = randomBytes(32).toString('base64url')
  await authQuery('select app.auth_create_session($1, $2, $3, $4)', [u.user_id, sha256(token), ip, userAgent])
  return { ok: true, token }
}

export async function claimsForToken(token: string | undefined, ip: string | null = null): Promise<Claims | null> {
  if (!token) return null
  const [row] = await authQuery<{ claims: Claims | null }>('select app.auth_session($1) as claims', [sha256(token)])
  return row?.claims ? { ...row.claims, ip: ip ?? undefined } : null
}

export const logout = (token: string, ip: string | null) =>
  authQuery('select app.auth_revoke_session($1, $2)', [sha256(token), ip])

export const setImpersonation = (token: string, centreId: string | null, ip: string | null) =>
  authQuery('select app.auth_set_impersonation($1, $2, $3)', [sha256(token), centreId, ip])
