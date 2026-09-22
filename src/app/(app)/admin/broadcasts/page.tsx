import { LocalTime } from '@/components/client.tsx'
import { ActionForm } from '@/components/form.tsx'
import { Page, Table } from '@/components/ui.tsx'
import { tenant } from '@/lib/session.ts'
import { broadcastAction, broadcastStatusAction } from '../../more-actions.ts'
// CV-5 broadcast wizard on one screen: list, name, objective, limit, mode, number, template, schedule.
export default async function Broadcasts() {
  const d = await tenant(async (db, c) => ({ ro: c.read_only,
    rows: (await db.query<{ id: string; name: string; status: string; list: string; template: string; mode: string; scheduled_at: Date; sent_count: number; delivered_count: number; read_count: number; replied_count: number; failed_count: number; skipped_count: number }>(
      'select b.*, l.name as list, t.name as template from broadcasts b join lists l on l.id = b.list_id join templates t on t.id = b.template_id order by b.created_at desc limit 100')).rows,
    lists: (await db.query<{ id: string; name: string; members: number }>('select l.id, l.name, (select count(*) from list_members m where m.list_id = l.id)::int members from lists l order by l.created_at desc limit 200')).rows,
    templates: (await db.query<{ id: string; name: string }>("select id, name from templates where status = 'approved' order by name")).rows,
    conns: (await db.query<{ id: string; name: string }>("select id, name from connection_list where kind = 'whatsapp' and status = 'connected' order by name")).rows }))
  return <Page title="Broadcasts" sub="Sends an approved template to a list. DNC and opt-outs are skipped for every recipient. 'Existing and new' keeps sending to leads that join the list later.">
    {!d.ro && <ActionForm action={broadcastAction} submit="Submit broadcast" className="panel grid gap-2 p-4 md:grid-cols-4">
      <input name="name" className="input" placeholder="Name" aria-label="Name" required /><input name="objective" className="input" placeholder="Objective" aria-label="Objective" />
      <select name="list_id" className="input" aria-label="List" required>{d.lists.map((l) => <option key={l.id} value={l.id}>{l.name} ({l.members})</option>)}</select>
      <select name="template_id" className="input" aria-label="Template" required>{d.templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}{d.templates.length === 0 && <option value="">No approved template</option>}</select>
      <select name="connection_id" className="input" aria-label="Sender number" required>{d.conns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}{d.conns.length === 0 && <option value="">No WhatsApp number connected</option>}</select>
      <input name="recipient_limit" type="number" min={1} className="input" placeholder="Recipient limit (optional)" aria-label="Recipient limit" />
      <select name="mode" className="input" aria-label="Mode"><option value="existing">Existing members</option><option value="existing_and_new">Existing and new (standing drip)</option><option value="new_only">New only</option></select>
      <input name="scheduled_at" type="datetime-local" className="input" aria-label="Schedule" /></ActionForm>}
    <Table head={['Broadcast', 'List → Template', 'Schedule', 'Status', '#Sent', '#Delivered', '#Read', '#Failed', '#Skipped', '']} empty={d.rows.length ? undefined : 'No broadcasts yet.'}>
      {d.rows.map((b) => <tr key={b.id}><td className="td font-medium">{b.name}<div className="text-xs text-muted">{b.mode.replaceAll('_', ' ')}</div></td><td className="td">{b.list} → {b.template}</td><td className="td"><LocalTime iso={b.scheduled_at.toISOString()} /></td><td className="td"><span className={`chip ${b.status === 'running' ? 'text-ok' : b.status === 'failed' ? 'text-danger' : 'text-muted'}`}>{b.status}</span></td>
        {[b.sent_count, b.delivered_count, b.read_count, b.failed_count, b.skipped_count].map((n, i) => <td key={i} className="td text-right tabular-nums">{n}</td>)}
        <td className="td text-right">{!d.ro && ['submitted', 'running', 'paused'].includes(b.status) && <form action={broadcastStatusAction}><input type="hidden" name="id" value={b.id} /><input type="hidden" name="status" value={b.status === 'paused' ? 'running' : 'paused'} /><button className="btn btn-quiet h-8">{b.status === 'paused' ? 'Resume' : 'Pause'}</button></form>}</td></tr>)}
    </Table>
  </Page>
}
