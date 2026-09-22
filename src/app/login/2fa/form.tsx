'use client'
import { useActionState } from 'react'
import { totpAction } from '../actions.ts'
export function TotpForm({ setup }: { setup: { secret: string; qr: string } | null }) {
  const [error, action, pending] = useActionState(totpAction, null)
  return (
    <main className="grid min-h-dvh place-items-center px-4" style={{ background: 'radial-gradient(60% 50% at 50% 0%, #e8edfb 0%, #f4f5f8 70%)' }}>
      <form action={action} className="float w-full max-w-sm p-6">
        <h1 className="text-lg font-semibold">{setup ? 'Set up two-factor authentication' : 'Two-factor authentication'}</h1>
        {setup ? <>
          <p className="mt-1 text-sm text-muted">Your role requires 2FA. Scan this in Google Authenticator, Authy or 1Password, then enter the 6-digit code.</p>
          <img src={setup.qr} alt="QR code for your authenticator app" className="mx-auto mt-4 h-44 w-44" />
          <p className="mt-2 break-all text-center font-mono text-xs text-muted">{setup.secret}</p>
        </> : <p className="mt-1 text-sm text-muted">Enter the 6-digit code from your authenticator app.</p>}
        <label className="label mt-4" htmlFor="code">Code</label>
        <input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" className="input text-center text-lg tracking-widest" required autoFocus />
        {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
        <button className="btn btn-primary mt-4 w-full" disabled={pending}>{pending ? 'Checking…' : 'Continue'}</button>
      </form>
    </main>
  )
}
