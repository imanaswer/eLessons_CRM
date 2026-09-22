'use client'
import { useActionState } from 'react'
import { loginAction } from './actions.ts'

export default function LoginPage() {
  const [error, action, pending] = useActionState(loginAction, null)
  return (
    <main className="grid min-h-dvh place-items-center px-4" style={{ background: 'radial-gradient(60% 50% at 50% 0%, #e8edfb 0%, #f4f5f8 70%)' }}>
      <div className="w-full max-w-[380px]">
        <div className="mb-6 flex items-center gap-2.5"><span className="inline-flex h-9 w-9 items-center justify-center rounded-[10px] bg-brand text-[14px] font-bold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_1px_2px_rgba(53,87,214,0.3)]">eL</span><div className="leading-tight"><p className="text-[15px] font-semibold tracking-[-0.01em]">eLessons CRM</p><p className="text-[12px] text-muted">G-TEC centres and HQ</p></div></div>
        <form action={action} className="float p-6">
          <h1 className="text-[18px] font-semibold tracking-[-0.01em]">Sign in</h1>
          <p className="mt-1 text-[13px] text-muted">Use your centre code, username and password.</p>
          <div className="mt-5 space-y-4">
            <div><label className="label" htmlFor="code">Centre code</label><input id="code" name="code" className="input uppercase" placeholder="EKM-07" autoCapitalize="characters" autoComplete="organization" aria-describedby="code-hint" /><p id="code-hint" className="mt-1.5 text-[12px] text-muted">HQ users leave this blank. District managers use the district code.</p></div>
            <div><label className="label" htmlFor="username">Username</label><input id="username" name="username" className="input" required autoComplete="username" autoCapitalize="none" /></div>
            <div><label className="label" htmlFor="password">Password</label><input id="password" name="password" type="password" className="input" required autoComplete="current-password" /></div>
          </div>
          {error && <p role="alert" className="mt-4 rounded-[var(--radius-control)] bg-danger-soft px-3 py-2 text-[13px] text-danger">{error}</p>}
          <button className="btn btn-primary mt-5 h-10 w-full text-[14px]" disabled={pending}>{pending ? 'Signing in…' : 'Sign in'}</button>
        </form>
        <p className="mt-4 text-center text-[12px] text-faint">Private system. Every sign-in is recorded.</p>
      </div>
    </main>
  )
}
