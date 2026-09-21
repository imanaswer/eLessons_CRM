'use client'
import { useActionState } from 'react'
import type { FormState } from '@/app/(app)/actions.ts'

// Server-action form with pending, error and success feedback in one place.
export function ActionForm({ action, submit, children, className, danger }: {
  action: (s: FormState, f: FormData) => Promise<FormState>
  submit: string; children: React.ReactNode; className?: string; danger?: boolean
}) {
  const [state, run, pending] = useActionState(action, null)
  return (
    <form action={run} className={className}>
      {children}
      <div className="flex items-center gap-3">
        <button className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} disabled={pending}>{pending ? 'Saving…' : submit}</button>
        {state?.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
        {state?.ok && <p role="status" className="text-sm text-ok">{state.ok}</p>}
      </div>
    </form>
  )
}
