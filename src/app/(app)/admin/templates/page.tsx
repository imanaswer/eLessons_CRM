import { ActionForm } from '@/components/form.tsx'
import { Page, Table } from '@/components/ui.tsx'
import { tenant } from '@/lib/session.ts'
import { templateAction } from '../../more-actions.ts'
// CV-4. Template approval happens in Meta Business Manager; the status and external id are recorded here (NEEDED.md: automated sync).
export default async function Templates() {
  const d = await tenant(async (db, c) => ({ ro: c.read_only, rows: (await db.query<{ id: string; name: string; language: string; category: string; body: string; status: string; external_id: string | null }>('select * from templates order by name')).rows,
    conns: (await db.query<{ id: string; name: string }>("select id, name from connection_list where kind = 'whatsapp' order by name")).rows }))
  return <Page title="WhatsApp templates" sub="Body variables as {{1}}, {{2}}. Only approved templates can be sent outside the 24-hour window or in broadcasts.">
    {!d.ro && <ActionForm action={templateAction} submit="Save template" className="panel space-y-2 p-4"><div className="grid gap-2 md:grid-cols-5"><input name="name" className="input" placeholder="name_in_snake_case" aria-label="Name" required /><input name="language" defaultValue="en" className="input" aria-label="Language" /><select name="category" className="input" aria-label="Category"><option>MARKETING</option><option>UTILITY</option><option>AUTHENTICATION</option></select>
      <select name="status" className="input" aria-label="Status"><option value="draft">Draft</option><option value="submitted">Submitted to Meta</option><option value="approved">Approved by Meta</option><option value="rejected">Rejected</option><option value="paused">Paused</option></select><input name="external_id" className="input" placeholder="Meta template id" aria-label="Meta template id" /></div>
      <select name="connection_id" className="input" aria-label="Number"><option value="">Any number</option>{d.conns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
      <textarea name="body" rows={3} className="input h-auto py-2" placeholder="Hello {{1}}, welcome to eLessons. Your counsellor at {{2}} will call you shortly." aria-label="Body" required /></ActionForm>}
    <Table head={['Name', 'Language', 'Category', 'Body', 'Status']} empty={d.rows.length ? undefined : 'No templates yet.'}>
      {d.rows.map((t) => <tr key={t.id} className="align-top"><td className="td font-medium">{t.name}</td><td className="td">{t.language}</td><td className="td">{t.category}</td><td className="td max-w-md whitespace-pre-wrap text-muted">{t.body}</td><td className="td"><span className={`chip ${t.status === 'approved' ? 'text-ok' : t.status === 'rejected' ? 'text-danger' : 'text-muted'}`}>{t.status}</span></td></tr>)}
    </Table>
  </Page>
}
