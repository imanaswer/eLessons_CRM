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
