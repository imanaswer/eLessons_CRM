'use server'
import { randomBytes } from 'node:crypto'
import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { oauthUrl } from '@/lib/meta.ts'
import { tenant } from '@/lib/session.ts'
// MT-1: start OAuth. A pending connection row is created first so the callback has something to bind the page to.
export async function metaStartAction(form: FormData) {
  const centre = z.union([z.uuid(), z.literal('')]).optional().parse(form.get('centre_id') ?? '') || null
  const existing = z.union([z.uuid(), z.literal('')]).optional().parse(form.get('connection_id') ?? '') || null
  const connId = existing ?? await tenant(async (db) => (await db.query<{ id: string }>("select app.create_connection('meta_page', 'Facebook page (connecting…)', $1) as id", [centre])).rows[0]!.id)
  const state = randomBytes(16).toString('base64url')
  ;(await cookies()).set('meta_oauth', JSON.stringify({ state, connId }), { httpOnly: true, sameSite: 'lax', maxAge: 600, path: '/' })
  const h = await headers(); const redirectUri = `${process.env.APP_URL ?? `${h.get('x-forwarded-proto') ?? 'http'}://${h.get('host')}`}/integrations/meta/callback`
  redirect(oauthUrl(state, redirectUri))
}
