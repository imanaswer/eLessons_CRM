import { redirect } from 'next/navigation'
import { getClaims } from '@/lib/session.ts'
import { beginSetup } from '@/lib/totp.ts'
import { TotpForm } from './form.tsx'

export default async function TwoFactor({ searchParams }: { searchParams: Promise<{ setup?: string }> }) {
  const c = await getClaims()
  if (!c) redirect('/login')
  const optIn = (await searchParams).setup === '1'
  if (!c.totp_required && !optIn) redirect('/')
  const setup = c.totp_enabled ? null : await beginSetup(c.user_id, c.display_name)
  return <TotpForm setup={setup} />
}
