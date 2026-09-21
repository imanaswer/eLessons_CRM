import 'server-only'
import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { cache } from 'react'
import { claimsForToken } from './auth-core.ts'
import { withTenant, type Claims } from './db.ts'
import type pg from 'pg'

export const SESSION_COOKIE = 'elessons_session'

export async function clientIp(): Promise<string | null> {
  const h = await headers()
  const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? h.get('x-real-ip')
  return ip && /^[0-9a-fA-F:.]+$/.test(ip) ? ip : null
}

export async function setSessionCookie(token: string) {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true, sameSite: 'lax', path: '/', secure: process.env.NODE_ENV === 'production', maxAge: 60 * 60 * 24,
  })
}

// One DB lookup per request (React cache), always fresh: no stale-claims window.
export const getClaims = cache(async (): Promise<Claims | null> =>
  claimsForToken((await cookies()).get(SESSION_COOKIE)?.value, await clientIp()))

export async function requireClaims(): Promise<Claims> {
  const claims = await getClaims()
  if (!claims) redirect('/login')
  return claims
}

export async function tenant<T>(fn: (db: pg.PoolClient, claims: Claims) => Promise<T>): Promise<T> {
  const claims = await requireClaims()
  return withTenant(claims, (db) => fn(db, claims))
}

// UI-only hint for hiding nav. Authorization itself is enforced in Postgres.
export const can = (db: pg.PoolClient, key: string) =>
  db.query<{ ok: boolean }>('select app.has_perm($1) as ok', [key]).then((r) => r.rows[0]!.ok)
