'use client'
import Link from 'next/link'
import { useActionState, useState, useTransition } from 'react'
import { addLeadAction, checkPhoneAction } from '../actions.ts'

// LT-1: the form is a single phone field until the number is valid.
export function NewLeadForm({ country, centres, allowPool, idempotencyKey }: { country: string; centres: { id: string; code: string }[]; allowPool: boolean; idempotencyKey: string }) {
  const [state, action, pending] = useActionState(addLeadAction, null)
  const [e164, setE164] = useState<string | null>(null)
  const [bad, setBad] = useState(false)
  const [checking, start] = useTransition()
  const [grade, setGrade] = useState('')
  const check = (v: string) => start(async () => { const r = v.replace(/\D/g, '').length >= 8 ? await checkPhoneAction(v, country) : null; setE164(r); setBad(!r && v.replace(/\D/g, '').length >= 10) })
  return (
    <form action={action} className="mx-auto max-w-xl space-y-4">
      <div className="flex items-center justify-between"><div><h1 className="text-[22px] font-semibold leading-tight">New lead</h1><p className="text-[13px] text-muted">Start with the phone number. The rest appears once it is valid.</p></div><Link href="/leads" className="btn btn-ghost">Cancel</Link></div>
      <input type="hidden" name="idempotency_key" value={idempotencyKey} />
      <div className="panel p-5">
        <label className="label" htmlFor="phone">Parent&apos;s phone number</label>
        <input id="phone" name="phone" type="tel" inputMode="tel" autoFocus autoComplete="off" className="input num h-12 text-[18px] tracking-[0.02em]" placeholder="98470 12345 or +971 50 123 4567"
          onChange={(e) => check(e.target.value)} aria-describedby="phone-hint" aria-invalid={bad} />
        <p id="phone-hint" className={`mt-2 text-[12.5px] ${bad ? 'text-danger' : e164 ? 'text-ok' : 'text-muted'}`}>
          {e164 ? `Will be saved as ${e164}` : bad ? "That doesn't look like a valid number. Add the country code for numbers outside your country." : checking ? 'Checking…' : 'If this number already exists in your centre, the existing lead opens instead.'}
        </p>
      </div>
      {e164 && <>
        <div className="panel grid gap-3 p-5 sm:grid-cols-2">
          <div className="sm:col-span-2"><label className="label" htmlFor="name">Parent name</label><input id="name" name="name" className="input" autoComplete="off" /></div>
          <div><label className="label" htmlFor="email">Email</label><input id="email" name="email" type="email" className="input" autoComplete="off" /></div>
          <div><label className="label" htmlFor="how">How did they reach you?</label><select id="how" name="how" className="input"><option>Walk-in</option><option>Phone call</option><option>Reference</option><option>Event</option><option>Other</option></select></div>
          <div><label className="label" htmlFor="city">City</label><input id="city" name="city" className="input" /></div>
          <div><label className="label" htmlFor="state">State</label><input id="state" name="state" className="input" /></div>
          {centres.length > 0 && <div className="sm:col-span-2"><label className="label" htmlFor="centre_id">Centre</label>
            <select id="centre_id" name="centre_id" className="input" required={!allowPool}>{allowPool && <option value="">HQ pool (route later)</option>}{centres.map((c) => <option key={c.id} value={c.id}>{c.code}</option>)}</select></div>}
        </div>
        <fieldset className="panel grid gap-3 p-5 sm:grid-cols-2">
          <legend className="sr-only">Student</legend>
          <div className="sm:col-span-2"><label className="label" htmlFor="student_name">Student name (you can add more later)</label><input id="student_name" name="student_name" className="input" autoComplete="off" /></div>
          <div><label className="label" htmlFor="grade">Grade</label><select id="grade" name="grade" className="input" value={grade} onChange={(e) => setGrade(e.target.value)}><option value="">—</option>{[8, 9, 10, 11, 12].map((g) => <option key={g} value={g}>{g}</option>)}</select></div>
          {(grade === '11' || grade === '12') && <div><label className="label" htmlFor="stream">Stream</label><select id="stream" name="stream" className="input"><option value="">—</option><option>PCMB</option><option>PCMC</option><option>Commerce</option></select></div>}
          <div className="sm:col-span-2"><label className="label" htmlFor="school">School</label><input id="school" name="school" className="input" /></div>
        </fieldset>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="consent" className="mt-1" /><span>The parent agreed to be contacted about eLessons. <span className="text-muted">Recorded with the time and your name.</span></span></label>
        <button className="btn btn-primary h-11 px-6 text-[14px]" disabled={pending}>{pending ? 'Saving…' : 'Save lead'}</button>
      </>}
      {state?.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
    </form>
  )
}
