'use server'
import { redirect } from 'next/navigation'
import { requireClaims } from '@/lib/session.ts'
import { beginSetup } from '@/lib/totp.ts'
export async function enableTotpAction() {
  const c = await requireClaims()
  await beginSetup(c.user_id, c.display_name)
  redirect('/login/2fa?setup=1')
}
