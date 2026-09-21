import { ActionForm } from '@/components/form.tsx'
import { changePasswordAction } from '../actions.ts'

export default function Account() {
  return (
    <div className="max-w-sm space-y-4">
      <h1 className="text-xl font-semibold">Change password</h1>
      <ActionForm action={changePasswordAction} submit="Change password" className="panel space-y-3 p-4">
        <div><label className="label" htmlFor="password">New password (10+ characters)</label><input id="password" name="password" type="password" className="input" required minLength={10} autoComplete="new-password" /></div>
        <div><label className="label" htmlFor="confirm">Confirm</label><input id="confirm" name="confirm" type="password" className="input" required autoComplete="new-password" /></div>
      </ActionForm>
    </div>
  )
}
