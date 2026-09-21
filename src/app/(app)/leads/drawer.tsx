import Link from 'next/link'
import { DrawerKeys, LocalTime } from '@/components/client.tsx'
import { ActionForm } from '@/components/form.tsx'
import { perms, tenant } from '@/lib/session.ts'
import { bulkAction, callOutcomeAction, completeTaskAction, contactAction, eraseAction, noteAction, repeatEnquiryAction, studentAction, taskAction } from './actions.ts'
import { OutcomeForm } from './outcome.tsx'

const CHIP: Record<string, string> = { ENQUIRY: 'text-brand', PROSPECT: 'text-warn', INTERESTED: 'text-ok', DEAD: 'text-muted', ENROLLED: 'text-ok bg-green-50' }
const LABEL: Record<string, string> = {
  lead_created: 'Lead created', lead_assigned: 'Assigned', lead_transferred_in: 'Transferred to this centre', lead_transferred_out: 'Transferred out',
  call_outcome: 'Call outcome', note: 'Note', task_created: 'Task created', task_completed: 'Task completed', lifecycle_change: 'Stage changed',
  repeat_enquiry: 'Repeat enquiry', student_added: 'Student added', contact_edited: 'Contact edited', tag_added: 'Tag added', lead_erased: 'Lead erased',
}
type Activity = { id: string; type: string; payload: Record<string, string | null>; created_at: Date; actor: string | null }

export async function LeadDrawer({ id, closeHref, baseHref, tab, existing }: { id: string; closeHref: string; baseHref: string; tab: string; existing: boolean }) {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null
  const d = await tenant(async (db, c) => {
    const { rows: [lead] } = await db.query(
      `select v.*, u.display_name as owner_name, c.code as centre_code, c.name as centre_name, o.code as origin_code
       from lead_list v left join users u on u.id = v.owner_user_id left join centres c on c.id = v.current_centre_id
       left join centres o on o.id = v.origin_centre_id where v.id = $1`, [id])
    if (!lead) return null
    const phones = await db.query<{ phone_e164: string; is_primary: boolean }>('select phone_e164, is_primary from lead_phone_list where lead_id = $1 order by is_primary desc', [id])
    const students = await db.query<{ id: string; name: string; grade: number | null; stream: string | null; school: string | null }>('select id, name, grade, stream, school from students where lead_id = $1 order by created_at', [id])
    const tasks = await db.query<{ id: string; type: string; title: string; due_at: Date; origin: string; status: string; owner: string | null }>(
        `select t.id, t.type, t.title, t.due_at, t.origin, t.status, u.display_name as owner from tasks t left join users u on u.id = t.owner_user_id
         where t.lead_id = $1 order by (t.status = 'open') desc, t.due_at desc limit 50`, [id])
    const acts = await db.query<Activity>(`select a.id, a.type, a.payload, a.created_at, u.display_name as actor from activities a left join users u on u.id = a.actor_user_id
         where a.lead_id = $1 order by a.id desc limit 200`, [id])
    const lists = await db.query<{ name: string }>('select l.name from list_members m join lists l on l.id = m.list_id where m.lead_id = $1', [id])
    const disps = await db.query<{ id: string; name: string; sentiment: string; followup: string; note_required: boolean }>('select id, name, sentiment, followup, note_required from dispositions where is_active order by sort')
    const p = await perms(db, ['leads.delete', 'leads.view_phone', 'leads.assign', 'leads.transfer'] as const)
    const erase = p['leads.delete'], viewPhone = p['leads.view_phone']
    const canAssign = p['leads.assign'], canTransfer = p['leads.transfer'] && c.role !== 'CENTRE_ADMIN'
    const owners = canAssign ? (await db.query<{ id: string; display_name: string }>('select id, display_name from users where is_active and centre_id is not distinct from $1 order by display_name', [lead.current_centre_id])).rows : []
    const centres = canTransfer ? (await db.query<{ id: string; code: string }>('select id, code from centres where is_active and id is distinct from $1 order by code', [lead.current_centre_id])).rows : []
    return { lead, phones: phones.rows, students: students.rows, tasks: tasks.rows, acts: acts.rows, lists: lists.rows, disps: disps.rows, erase, viewPhone, ro: c.read_only, owners, centres }
  })
  const shell = (body: React.ReactNode) => (
    <div className="fixed inset-0 z-30 flex justify-end" role="dialog" aria-modal="true" aria-label="Lead details">
      <Link href={closeHref} scroll={false} className="absolute inset-0 bg-ink/30" aria-label="Close" tabIndex={-1} />
      <div tabIndex={-1} className="relative flex h-full w-full max-w-4xl flex-col overflow-y-auto bg-canvas shadow-xl outline-none"><DrawerKeys closeHref={closeHref} />{body}</div>
    </div>
  )
  if (!d) return shell(<div className="p-8 text-center"><p className="font-medium">Lead not available</p><p className="mt-1 text-sm text-muted">It doesn&apos;t exist, or you don&apos;t have permission to access this centre.</p><Link href={closeHref} className="btn btn-quiet mt-4">Back to leads</Link></div>)

  const { lead: l } = d
  const closed = l.lifecycle === 'DEAD' || l.lifecycle === 'ENROLLED'
  const editable = !d.ro && !l.anonymised_at
  const shown = d.acts.filter((a) => tab === 'activities' || ['call_outcome', 'note', 'repeat_enquiry', 'lifecycle_change'].includes(a.type))
  const tabs = [['interactions', 'Interactions'], ['tasks', `Tasks (${d.tasks.filter((t) => t.status === 'open').length})`], ['activities', 'Activities']] as const
  return shell(<>
    <header className="sticky top-0 z-10 flex items-start gap-3 border-b border-line bg-surface px-4 py-3">
      <div className="min-w-0 flex-1">
        <h2 className="truncate text-lg font-semibold">{l.name ?? (l.anonymised_at ? 'Erased lead' : 'Unnamed parent')}</h2>
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
          <span className={`chip ${CHIP[l.lifecycle]}`}>{l.lifecycle}</span>
          {l.closed_reason && <span className="chip text-muted">{l.closed_reason}</span>}
          {l.is_customer && <span className="chip text-ok">Customer</span>}
          {l.times_re_engaged > 0 && <span className="chip text-muted">Re-engaged ×{l.times_re_engaged}</span>}
          {(l.tags as string[]).map((t) => <span key={t} className="chip text-muted">#{t}</span>)}
        </div>
      </div>
      <Link href={closeHref} scroll={false} className="btn btn-quiet" aria-label="Close lead">Close</Link>
    </header>
    {existing && <p role="status" className="border-b border-line bg-amber-50 px-4 py-2 text-sm text-warn">An existing lead was found for that number. Nothing new was created.</p>}

    <div className="grid flex-1 gap-4 p-4 lg:grid-cols-[18rem_1fr]">
      {/* LEFT RAIL (WS-5) */}
      <aside className="space-y-3 text-sm">
        <section className="panel space-y-2 p-3">
          {d.phones.map((p) => (
            <div key={p.phone_e164} className="flex items-center gap-2">
              <span className="flex-1 font-medium tabular-nums">{p.phone_e164}</span>
              {d.viewPhone && <><a className="btn btn-primary h-8 px-3" href={`tel:${p.phone_e164}`}>Call</a><a className="btn btn-quiet h-8 px-2" href={`https://wa.me/${p.phone_e164.slice(1)}`} target="_blank" rel="noreferrer">WA</a></>}
            </div>
          ))}
          {l.email && <a href={`mailto:${l.email}`} className="block truncate text-brand">{l.email}</a>}
          <p className="text-muted">{[l.city, l.state, l.country].filter(Boolean).join(', ') || 'Location unknown'} · {l.timezone}</p>
          <p className="text-muted">Consent: <span className="text-ink">{l.consent_status}</span></p>
        </section>
        <dl className="panel grid grid-cols-[6rem_1fr] gap-y-1.5 p-3">
          <dt className="text-muted">Owner</dt><dd>{l.owner_name ?? <span className="text-warn">Unassigned</span>}</dd>
          <dt className="text-muted">Centre</dt><dd>{l.centre_code ? `${l.centre_code} · ${l.centre_name}` : 'HQ pool'}</dd>
          <dt className="text-muted">Source</dt><dd>{[l.source_l1, l.source_l2, l.source_l3, l.source_l4].filter(Boolean).join(' › ') || <span className="text-muted">Hidden</span>}</dd>
          <dt className="text-muted">Attempts</dt><dd className="tabular-nums">{l.attempts}</dd>
          <dt className="text-muted">Next</dt><dd>{l.next_followup_at ? <LocalTime iso={l.next_followup_at.toISOString()} /> : '—'}</dd>
        </dl>
        <section className="panel p-3">
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">Students</h3>
          {d.students.length === 0 && <p className="text-muted">No students yet.</p>}
          <ul className="space-y-1">{d.students.map((s) => <li key={s.id}><span className="font-medium">{s.name}</span> <span className="text-muted">{s.grade ? `Grade ${s.grade}` : ''} {s.stream ?? ''} {s.school ? `· ${s.school}` : ''}</span></li>)}</ul>
          {editable && <details className="mt-2"><summary className="cursor-pointer text-brand">Add student</summary>
            <ActionForm action={studentAction} submit="Add student" className="mt-2 space-y-2">
              <input type="hidden" name="lead_id" value={id} />
              <input name="name" className="input" placeholder="Student name" aria-label="Student name" required />
              <div className="grid grid-cols-2 gap-2">
                <select name="grade" className="input" aria-label="Grade" required>{[8, 9, 10, 11, 12].map((g) => <option key={g} value={g}>Grade {g}</option>)}</select>
                <select name="stream" className="input" aria-label="Stream (11-12)"><option value="">No stream</option><option>PCMB</option><option>PCMC</option><option>Commerce</option></select>
              </div>
              <input name="school" className="input" placeholder="School" aria-label="School" /><input type="hidden" name="board" value="CBSE" />
            </ActionForm></details>}
        </section>
        <section className="panel p-3">
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">Lead journey</h3>
          <ol className="space-y-1 text-muted">
            <li>Created <LocalTime iso={l.created_at.toISOString()} />{l.origin_code ? ` at ${l.origin_code}` : ''}</li>
            {l.assigned_at && <li>Assigned <LocalTime iso={l.assigned_at.toISOString()} /></li>}
            {l.first_touch_at && <li>First call <LocalTime iso={l.first_touch_at.toISOString()} /></li>}
            {l.last_repeat_enquiry_at && <li>Repeat enquiry <LocalTime iso={l.last_repeat_enquiry_at.toISOString()} /></li>}
          </ol>
          {d.lists.length > 0 && <p className="mt-2">Lists: {d.lists.map((x) => x.name).join(', ')}</p>}
        </section>
        {editable && d.owners.length > 0 && <details className="panel p-3"><summary className="cursor-pointer font-medium">Assign</summary>
          <ActionForm action={bulkAction} submit="Assign" className="mt-2 space-y-2">
            <input type="hidden" name="op" value="assign" /><input type="hidden" name="ids" value={id} />
            <select name="owner" className="input" aria-label="New owner" defaultValue={l.owner_user_id ?? ''}>{d.owners.map((o) => <option key={o.id} value={o.id}>{o.display_name}</option>)}</select>
          </ActionForm></details>}
        {editable && d.centres.length > 0 && <details className="panel p-3"><summary className="cursor-pointer font-medium">Transfer to another centre</summary>
          <ActionForm action={bulkAction} submit="Transfer" danger className="mt-2 space-y-2">
            <input type="hidden" name="op" value="transfer" /><input type="hidden" name="ids" value={id} />
            <p className="text-xs text-muted">The current centre loses access. The origin centre is kept forever.</p>
            <select name="centre" className="input" aria-label="Target centre">{d.centres.map((c) => <option key={c.id} value={c.id}>{c.code}</option>)}</select>
            <input name="reason" className="input" placeholder="Reason (required)" aria-label="Reason" required />
          </ActionForm></details>}
        {editable && <details className="panel p-3"><summary className="cursor-pointer font-medium">Edit contact</summary>
          <ActionForm action={contactAction} submit="Save" className="mt-2 space-y-2">
            <input type="hidden" name="lead_id" value={id} />
            <input name="name" defaultValue={l.name ?? ''} className="input" placeholder="Parent name" aria-label="Parent name" />
            <input name="email" type="email" defaultValue={l.email ?? ''} className="input" placeholder="Email" aria-label="Email" />
            <div className="grid grid-cols-2 gap-2"><input name="city" defaultValue={l.city ?? ''} className="input" placeholder="City" aria-label="City" /><input name="state" defaultValue={l.state ?? ''} className="input" placeholder="State" aria-label="State" /></div>
            <input name="language" defaultValue={l.language ?? ''} className="input" placeholder="Preferred language" aria-label="Preferred language" />
          </ActionForm></details>}
        {editable && d.erase && <details className="panel p-3"><summary className="cursor-pointer text-danger">Erase lead</summary>
          <ActionForm action={eraseAction} submit="Erase permanently" danger className="mt-2 space-y-2">
            <input type="hidden" name="lead_id" value={id} />
            <p className="text-xs text-muted">Removes the parent&apos;s name, phone and email and the students&apos; names. Counts stay in reports. This cannot be undone.</p>
            <input name="reason" className="input" placeholder="Reason (required)" aria-label="Reason" required />
          </ActionForm></details>}
      </aside>

      {/* RIGHT: actions + timeline (WS-6, WS-7) */}
      <div className="min-w-0 space-y-3">
        {editable && (closed
          ? <ActionForm action={repeatEnquiryAction} submit="Record repeat enquiry" className="panel flex flex-wrap items-center gap-3 p-3"><input type="hidden" name="lead_id" value={id} /><p className="flex-1 text-sm text-muted">This lead is closed. If the parent has enquired again, reopen it with its history intact.</p></ActionForm>
          : <OutcomeForm leadId={id} timezone={l.timezone} dispositions={d.disps} action={callOutcomeAction} />)}
        {editable && <div className="grid gap-3 md:grid-cols-2">
          <ActionForm action={noteAction} submit="Add note" className="panel space-y-2 p-3">
            <input type="hidden" name="lead_id" value={id} /><textarea name="note" rows={2} className="input h-auto py-2" placeholder="Add a note" aria-label="Note" required />
          </ActionForm>
          <ActionForm action={taskAction} submit="Add task" className="panel space-y-2 p-3">
            <input type="hidden" name="lead_id" value={id} />
            <div className="grid grid-cols-2 gap-2">
              <select name="type" className="input" aria-label="Task type"><option value="followup">Follow-up</option><option value="call">Call</option><option value="whatsapp">WhatsApp</option><option value="send_demo">Send demo</option><option value="payment_followup">Payment follow-up</option><option value="custom">Custom</option></select>
              <input type="datetime-local" name="due" className="input" aria-label={`Due (${l.timezone})`} required />
            </div>
            <input name="title" className="input" placeholder={`Task title · due time is in ${l.timezone}`} aria-label="Task title" required />
          </ActionForm>
        </div>}

        <nav className="flex gap-1 border-b border-line" aria-label="Timeline">
          {tabs.map(([k, label]) => <Link key={k} href={`${baseHref}&tab=${k}`} scroll={false} aria-current={tab === k ? 'page' : undefined}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${tab === k ? 'border-brand font-medium text-ink' : 'border-transparent text-muted hover:text-ink'}`}>{label}</Link>)}
        </nav>
        {tab === 'tasks' ? (
          <ul className="space-y-2">
            {d.tasks.length === 0 && <li className="text-sm text-muted">No tasks.</li>}
            {d.tasks.map((t) => (
              <li key={t.id} className="panel flex items-center gap-3 p-3 text-sm">
                <div className="min-w-0 flex-1">
                  <p className={t.status === 'open' ? 'font-medium' : 'text-muted line-through'}>{t.title}</p>
                  <p className="text-xs text-muted"><LocalTime iso={t.due_at.toISOString()} /> · {t.owner ?? 'Unassigned'} · <span className={t.origin === 'user' ? 'text-ink' : ''}>{t.origin === 'user' ? '● user-set' : '○ system-set'}</span></p>
                </div>
                {t.status === 'open' && editable && <form action={completeTaskAction}><input type="hidden" name="task_id" value={t.id} /><button className="btn btn-quiet h-8">Done</button></form>}
              </li>
            ))}
          </ul>
        ) : (
          <ol className="space-y-2">
            {shown.length === 0 && <li className="text-sm text-muted">Nothing here yet{tab === 'interactions' ? '. Log the first call above.' : '.'}</li>}
            {shown.map((a) => (
              <li key={a.id} className="panel p-3 text-sm">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-medium">{a.type === 'call_outcome' ? a.payload.disposition : a.type === 'lifecycle_change' ? `${a.payload.from} → ${a.payload.to}` : LABEL[a.type] ?? a.type}</span>
                  {a.type === 'lifecycle_change' && a.payload.reason && <span className="text-muted">{a.payload.reason}</span>}
                  <span className="ml-auto text-xs text-muted">{a.actor ?? 'System'} · <LocalTime iso={a.created_at.toISOString()} /></span>
                </div>
                {(a.payload.note || a.payload.title || a.payload.tag || a.payload.reason && a.type !== 'lifecycle_change') &&
                  <p className="mt-1 whitespace-pre-wrap text-muted">{a.payload.note ?? a.payload.title ?? a.payload.tag ?? a.payload.reason}</p>}
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  </>)
}
