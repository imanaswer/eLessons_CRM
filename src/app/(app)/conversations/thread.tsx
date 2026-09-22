import Link from 'next/link'
import { LocalTime } from '@/components/client.tsx'
import { ActionForm } from '@/components/form.tsx'
import { tenant } from '@/lib/session.ts'
import { conversationAction, sendMessageAction } from '../more-actions.ts'
export async function Thread({ id }: { id: string }) {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null
  const d = await tenant(async (db, c) => {
    const { rows: [conv] } = await db.query('select c.*, v.name as lead, v.primary_phone from conversations c left join lead_list v on v.id = c.lead_id where c.id = $1', [id])
    if (!conv) return null
    const msgs = (await db.query<{ id: string; direction: string; kind: string; body: string | null; template_name: string | null; status: string; created_at: Date; sender: string | null; error: string | null }>('select m.id, m.direction, m.kind, m.body, m.template_name, m.status, m.created_at, m.error, u.display_name as sender from messages m left join users u on u.id = m.sent_by where m.conversation_id = $1 order by m.id desc limit 200', [id])).rows.reverse()
    const templates = (await db.query<{ id: string; name: string; body: string }>("select id, name, body from templates where status = 'approved' order by name")).rows
    const owners = (await db.query<{ id: string; display_name: string }>('select id, display_name from users where is_active and centre_id is not distinct from $1 order by display_name', [conv.centre_id])).rows
    if (conv.unread > 0 && !c.read_only) await db.query('update conversations set unread = 0 where id = $1', [id])
    return { conv, msgs, templates, owners, ro: c.read_only }
  })
  if (!d) return <div className="panel p-6 text-sm text-muted">Conversation not available.</div>
  const live = d.conv.session_expires_at && new Date(d.conv.session_expires_at) > new Date()
  return <section className="panel flex min-h-[60vh] flex-col">
    <header className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2 text-sm">
      <Link href={`/leads?view=all&lead=${d.conv.lead_id}`} className="font-medium hover:underline">{d.conv.lead ?? d.conv.wa_id}</Link><span className="text-muted">{d.conv.primary_phone}</span>
      {!d.ro && <form action={conversationAction} className="ml-auto flex gap-1"><input type="hidden" name="id" value={id} />
        <select name="owner" defaultValue={d.conv.owner_user_id ?? ''} className="input h-8 w-auto" aria-label="Owner"><option value="">Unassigned</option>{d.owners.map((o) => <option key={o.id} value={o.id}>{o.display_name}</option>)}</select>
        <select name="status" defaultValue={d.conv.status} className="input h-8 w-auto" aria-label="Status"><option value="open">Open</option><option value="awaiting">Awaiting</option><option value="resolved">Resolved</option></select>
        <button name="starred" value={String(!d.conv.starred)} className="btn btn-quiet h-8">{d.conv.starred ? 'Unstar' : 'Star'}</button><button className="btn btn-quiet h-8">Save</button></form>}
    </header>
    <ol className="flex-1 space-y-2 overflow-y-auto p-3">{d.msgs.map((m) => <li key={m.id} className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${m.direction === 'out' ? 'ml-auto bg-blue-50' : 'bg-canvas'}`}>
      {m.template_name && <p className="text-xs text-muted">template · {m.template_name}</p>}<p className="whitespace-pre-wrap">{m.body ?? `[${m.kind}]`}</p>
      <p className="mt-1 text-right text-[11px] text-muted">{m.sender ?? (m.direction === 'in' ? 'Parent' : 'System')} · <LocalTime iso={m.created_at.toISOString()} /> · <span className={m.status === 'failed' ? 'text-danger' : ''}>{m.status}</span>{m.error && ` — ${m.error}`}</p></li>)}
      {d.msgs.length === 0 && <li className="text-sm text-muted">No messages yet.</li>}</ol>
    {!d.ro && <ActionForm action={sendMessageAction} submit="Send" className="space-y-2 border-t border-line p-3">
      <input type="hidden" name="lead_id" value={d.conv.lead_id} /><input type="hidden" name="connection_id" value={d.conv.connection_id} />
      {live ? <textarea name="body" rows={2} className="input h-auto py-2" placeholder="Reply (session open)" aria-label="Message" /> : <p className="text-xs text-warn">The 24-hour window is closed: only an approved template can be sent.</p>}
      <div className="flex gap-2"><select name="template_id" className="input w-auto" aria-label="Template"><option value="">{live ? 'No template' : 'Pick a template'}</option>{d.templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
        <input name="vars" className="input" placeholder="Template variables, separated by |" aria-label="Template variables" /></div>
    </ActionForm>}
  </section>
}
