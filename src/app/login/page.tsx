'use client'
import { useActionState } from 'react'
import { loginAction } from './actions.ts'

export default function LoginPage() {
  const [error, action, pending] = useActionState(loginAction, null)
  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <form action={action} className="panel w-full max-w-sm p-6">
        <h1 className="text-lg font-semibold">eLessons CRM</h1>
        <p className="mt-1 text-sm text-muted">Sign in to your centre.</p>
        <div className="mt-5 space-y-3.5">
          <div>
            <label className="label" htmlFor="code">Centre code</label>
            <input id="code" name="code" className="input uppercase" placeholder="EKM-07" autoCapitalize="characters" autoComplete="organization" aria-describedby="code-hint" />
            <p id="code-hint" className="mt-1 text-xs text-muted">HQ users: leave blank. District managers: use the district code.</p>
          </div>
          <div>
            <label className="label" htmlFor="username">Username</label>
            <input id="username" name="username" className="input" required autoComplete="username" autoCapitalize="none" />
          </div>
          <div>
            <label className="label" htmlFor="password">Password</label>
            <input id="password" name="password" type="password" className="input" required autoComplete="current-password" />
          </div>
        </div>
        {error && <p role="alert" className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-danger">{error}</p>}
        <button className="btn btn-primary mt-5 w-full" disabled={pending}>{pending ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </main>
  )
}
