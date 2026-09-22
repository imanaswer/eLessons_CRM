import Link from 'next/link'
import { ActionForm } from '@/components/form.tsx'
import { Page, Table } from '@/components/ui.tsx'
import { tenant } from '@/lib/session.ts'
import { createListAction, listFlagsAction } from '../more-actions.ts'
export default async function Lists() {
  const d = await tenant(async (db, c) => ({ me: c, rows: (await db.query<{ id: string; name: string; description: string | null; kind: string; origin: string; owner: string | null; owner_id: string | null; scope: string; members: number; allow_duplicate: boolean; disallow_auto_rechurn: boolean; refreshed_at: Date | null }>(
    `select l.id, l.name, l.description, l.kind, l.origin, u.display_name as owner, l.owner_user_id as owner_id, coalesce(c.code, d.code, 'Org') as scope, (select count(*) from list_members m where m.list_id = l.id)::int as members, l.allow_duplicate, l.disallow_auto_rechurn, l.refreshed_at
     from lists l left join users u on u.id = l.owner_user_id left join centres c on c.id = l.centre_id left join districts d on d.id = l.district_id order by l.created_at desc limit 300`)).rows }))
  return <Page title="Lists" sub="Static lists hold fixed members. Dynamic lists are a saved filter, refreshed every 10 minutes by the worker. Uploads, Meta pages and forms create lists automatically.">
    {!d.me.read_only && <ActionForm action={createListAction} submit="Create list" className="panel grid gap-3 p-4 lg:grid-cols-6 lg:items-end">
      <div className="lg:col-span-2"><label className="label" htmlFor="name">Name</label><input id="name" name="name" className="input" required /></div>
      <div><label className="label" htmlFor="kind">Type</label><select id="kind" name="kind" className="input"><option value="static">Static</option><option value="dynamic">Dynamic (query)</option></select></div>
      <div><label className="label" htmlFor="scope">Scope</label><select id="scope" name="scope" className="input">{d.me.centre_id ? <option value="centre">Centre</option> : <>{d.me.district_id ? null : <option value="org">Organisation</option>}<option value="district">District</option></>}</select></div>
      <div className="lg:col-span-2"><label className="label" htmlFor="filters">Dynamic filters (JSON, e.g. {'{'}&quot;view&quot;:&quot;overdue&quot;,&quot;source&quot;:&quot;Meta&quot;{'}'})</label><input id="filters" name="filters" className="input font-mono text-xs" /></div>
      <div className="lg:col-span-6"><label className="label" htmlFor="description">Description</label><input id="description" name="description" className="input" /></div>
    </ActionForm>}
    <Table head={['List', 'Type', 'Scope', 'Owner', '#Members', 'Flags']} empty={d.rows.length ? undefined : 'No lists yet.'}>
      {d.rows.map((l) => <tr key={l.id} className="align-top"><td className="td"><Link href={`/leads?view=all&list=${l.id}`} className="font-medium hover:underline">{l.name}</Link>{l.description && <p className="text-xs text-muted">{l.description}</p>}</td><td className="td">{l.kind}{l.origin !== 'manual' && ` · ${l.origin}`}{l.kind === 'dynamic' && l.refreshed_at && <p className="text-xs text-muted">refreshed {l.refreshed_at.toISOString().slice(11, 16)} UTC</p>}</td><td className="td">{l.scope}</td><td className="td">{l.owner}</td><td className="td text-right tabular-nums">{l.members}</td>
        <td className="td">{l.owner_id === d.me.user_id && !d.me.read_only ? <form action={listFlagsAction} className="flex flex-wrap gap-2 text-xs"><input type="hidden" name="id" value={l.id} /><label><input type="checkbox" name="allow_duplicate" defaultChecked={l.allow_duplicate} /> allow duplicate</label><label><input type="checkbox" name="disallow_auto_rechurn" defaultChecked={l.disallow_auto_rechurn} /> disallow auto rechurn</label><button className="btn btn-quiet h-7">Save</button></form>
          : <span className="text-xs text-muted">{[l.allow_duplicate && 'allow duplicate', l.disallow_auto_rechurn && 'no auto rechurn'].filter(Boolean).join(', ') || '—'}</span>}</td></tr>)}
    </Table>
  </Page>
}
