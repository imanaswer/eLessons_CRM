'use client'
import { useActionState } from 'react'
import type { FormState } from '@/app/(app)/actions.ts'
// Server-action form with pending, error and success feedback in one place.
export function ActionForm({ action, submit, children, className, danger, quiet }: {
  action: (s: FormState, f: FormData) => Promise<FormState>
  submit: string; children: React.ReactNode; className?: string; danger?: boolean; quiet?: boolean
}) {
  const [state, run, pending] = useActionState(action, null)
  return (
    <form action={run} className={className}>
      {children}
      <div className="flex flex-wrap items-center gap-3">
        <button className={`btn ${danger ? 'btn-danger' : quiet ? 'btn-quiet' : 'btn-primary'}`} disabled={pending} aria-busy={pending}>{pending ? <span className="inline-flex items-center gap-2"><Spinner />{submit}</span> : submit}</button>
        {state?.error && <p role="alert" className="text-[13px] text-danger">{state.error}</p>}
        {state?.ok && <p role="status" className="text-[13px] text-ok">{state.ok}</p>}
      </div>
    </form>
  )
}
export const Spinner = () => <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-[1.5px] border-current border-t-transparent" style={{ animationDuration: '600ms' }} aria-hidden="true" />
