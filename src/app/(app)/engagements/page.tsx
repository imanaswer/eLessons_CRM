import Link from 'next/link'
import { LocalTime } from '@/components/client.tsx'
import { Page, Table } from '@/components/ui.tsx'
import { tenant } from '@/lib/session.ts'
const LENSES = { communications: ['call_outcome', 'whatsapp_in', 'whatsapp_out', 'email_out', 'note'], tasks: ['task_created', 'task_completed'], deals: ['deal_created', 'deal_stage_change'], payments: ['payment'],
  people: ['lead_created', 'lead_assigned', 'lead_transferred_in', 'lead_transferred_out', 'student_added', 'contact_edited', 'merged'], system: ['automation', 'site_event', 'lifecycle_change', 'repeat_enquiry', 'migrated', 'tag_added'] } as const
// WS-13: cross-lead activity with lenses and an hourly heatmap. Scoped by where the work happened (activity_scope).
export default async function Engagements({ searchParams }: { searchParams: Promise<{ lens?: string; days?: string }> }) {
  const sp = await searchParams; const lens = (sp.lens && sp.lens in LENSES ? sp.lens : 'communications') as keyof typeof LENSES; const days = Math.min(Math.max(Number(sp.days) || 7, 1), 90)
  const d = await tenant(async (db) => ({
    rows: (await db.query<{ id: string; type: string; disposition: string | null; created_at: Date; lead_id: string; lead: string | null; actor: string | null; centre: string | null }>(
      `select a.id, a.type, a.disposition, a.created_at, a.lead_id, v.name as lead, u.display_name as actor, c.code as centre from activity_scope a left join lead_list v on v.id = a.lead_id left join users u on u.id = a.actor_user_id left join centres c on c.id = a.centre_id
       where a.type = any($1) and a.created_at > now() - make_interval(days => $2) order by a.id desc limit 200`, [[...LENSES[lens]], days])).rows,
    heat: (await db.query<{ dow: number; hr: number; n: number }>(`select extract(isodow from a.created_at at time zone 'Asia/Kolkata')::int dow, extract(hour from a.created_at at time zone 'Asia/Kolkata')::int as hr, count(*)::int n from activity_scope a where a.type = any($1) and a.created_at > now() - make_interval(days => $2) group by 1, 2`, [[...LENSES[lens]], days])).rows }))
  const max = Math.max(1, ...d.heat.map((h) => h.n))
  return <Page title="Engagements" sub={`Last ${days} days · times shown in IST`} action={<div className="flex flex-wrap gap-1">{Object.keys(LENSES).map((k) => <Link key={k} href={`?lens=${k}&days=${days}`} aria-current={lens === k ? 'page' : undefined} className="seg">{k}</Link>)}<Link href={`?lens=${lens}&days=${days === 7 ? 30 : 7}`} className="btn btn-quiet h-8">{days === 7 ? '30 days' : '7 days'}</Link></div>}>
    <section className="panel overflow-x-auto p-3"><p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">Activity by hour</p>
      <table className="text-[10px]"><thead><tr><th /> {Array.from({ length: 24 }, (_, h) => <th key={h} className="w-5 font-normal text-muted">{h}</th>)}</tr></thead>
        <tbody>{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((dn, i) => <tr key={dn}><td className="pr-1 text-muted">{dn}</td>{Array.from({ length: 24 }, (_, h) => { const n = d.heat.find((x) => x.dow === i + 1 && x.hr === h)?.n ?? 0
          return <td key={h} title={`${dn} ${h}:00 · ${n}`} className="h-4 w-5 border border-surface" style={{ background: n ? `rgba(31,79,216,${0.15 + 0.85 * (n / max)})` : '#f7f8fa' }} /> })}</tr>)}</tbody></table></section>
    <Table head={['When', 'Lead', 'What', 'By', 'Centre']} empty={d.rows.length ? undefined : 'No activity in this lens.'}>
      {d.rows.map((a) => <tr key={a.id}><td className="td whitespace-nowrap"><LocalTime iso={a.created_at.toISOString()} /></td><td className="td"><Link href={`/leads?view=all&lead=${a.lead_id}`} className="font-medium hover:underline">{a.lead ?? 'Unnamed'}</Link></td><td className="td">{a.disposition ?? a.type.replaceAll('_', ' ')}</td><td className="td">{a.actor ?? 'System'}</td><td className="td">{a.centre ?? 'HQ'}</td></tr>)}
    </Table>
  </Page>
}
