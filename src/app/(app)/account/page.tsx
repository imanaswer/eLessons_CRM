import { ActionForm } from '@/components/form.tsx'
import { changePasswordAction } from '../actions.ts'

import { requireClaims } from '@/lib/session.ts'
import { enableTotpAction } from './actions.ts'

export default async function Account() {
  const c = await requireClaims()
  return (
    <div className="max-w-sm space-y-4">
      <h1 className="text-xl font-semibold">Change password</h1>
      <ActionForm action={changePasswordAction} submit="Change password" className="panel space-y-3 p-4">
        <div><label className="label" htmlFor="password">New password (10+ characters)</label><input id="password" name="password" type="password" className="input" required minLength={10} autoComplete="new-password" /></div>
        <div><label className="label" htmlFor="confirm">Confirm</label><input id="confirm" name="confirm" type="password" className="input" required autoComplete="new-password" /></div>
      </ActionForm>
      <section className="panel space-y-2 p-4"><h2 className="font-semibold">Two-factor authentication</h2><p className="text-sm text-muted">{c.totp_enabled ? 'Enabled on this account.' : 'Optional for your role; required for Superadmin and HQ Admin.'}</p>
        {!c.totp_enabled && <form action={enableTotpAction}><button className="btn btn-quiet">Set up 2FA</button></form>}</section>
    </div>
  )
}
