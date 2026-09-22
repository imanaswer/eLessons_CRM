'use server'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { login } from '@/lib/auth-core.ts'
import { clientIp, setSessionCookie } from '@/lib/session.ts'
import { headers } from 'next/headers'

const schema = z.object({
  code: z.string().trim().max(16).default(''),
  username: z.string().trim().min(1).max(40),
  password: z.string().min(1).max(200),
})

export async function loginAction(_: string | null, form: FormData): Promise<string | null> {
  const parsed = schema.safeParse(Object.fromEntries(form))
  if (!parsed.success) return 'Enter your username and password.'
  const { code, username, password } = parsed.data
  const result = await login(code, username, password, await clientIp(), (await headers()).get('user-agent'))
  if (!result.ok) {
    return result.code === 'LOCKED'
      ? 'Too many failed attempts. This account is locked for a few minutes.'
      // deliberately identical for wrong code / username / password
      : 'Those details don\'t match. Check the centre code, username and password.'
  }
  await setSessionCookie(result.token)
  redirect('/')
}

export async function totpAction(_: string | null, form: FormData): Promise<string | null> {
  const { getClaims, SESSION_COOKIE } = await import('@/lib/session.ts')
  const { cookies } = await import('next/headers')
  const { confirmSetup, markSessionVerified, verify } = await import('@/lib/totp.ts')
  const c = await getClaims()
  if (!c) redirect('/login')
  const code = String(form.get('code') ?? '')
  const ok = c.totp_enabled ? await verify(c.user_id, code, c.display_name) : await confirmSetup(c.user_id, code, c.display_name)
  if (!ok) return "That code didn't match. Codes change every 30 seconds; try the current one."
  await markSessionVerified((await cookies()).get(SESSION_COOKIE)!.value)
  redirect('/')
}
