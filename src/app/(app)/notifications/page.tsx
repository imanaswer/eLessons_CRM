import Link from 'next/link'
import { LocalTime } from '@/components/client.tsx'
import { Page } from '@/components/ui.tsx'
import { tenant } from '@/lib/session.ts'
import { markReadAction } from '../more-actions.ts'
export default async function Notifications() {
  const rows = await tenant(async (db) => (await db.query<{ id: string; kind: string; title: string; body: string | null; lead_id: string | null; created_at: Date; read_at: Date | null }>('select * from notifications order by id desc limit 100')).rows)
  return <Page title="Alerts" sub="SLA breaches, new leads, repeat enquiries, payments and automation notices for you." action={<form action={markReadAction}><input type="hidden" name="id" value="all" /><button className="btn btn-quiet">Mark all read</button></form>}>
    <ul className="space-y-2">{rows.map((n) => <li key={n.id} className={`panel flex items-start gap-3 p-3 text-sm ${n.read_at ? 'opacity-60' : ''}`}>
      <div className="min-w-0 flex-1"><p className="font-medium">{n.title}</p>{n.body && <p className="text-muted">{n.body}</p>}<p className="text-xs text-muted"><LocalTime iso={n.created_at.toISOString()} /> · {n.kind}</p></div>
      {n.lead_id && <Link href={`/leads?view=all&lead=${n.lead_id}`} className="btn btn-quiet h-8">Open lead</Link>}
      {!n.read_at && <form action={markReadAction}><input type="hidden" name="id" value={n.id} /><button className="btn btn-quiet h-8">Read</button></form>}</li>)}
      {rows.length === 0 && <li className="text-[13px] text-muted">Nothing yet.</li>}</ul>
  </Page>
}
