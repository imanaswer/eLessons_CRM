import Link from 'next/link'
import { money, Page, Stat, STATE_TONE } from '@/components/ui.tsx'
import { pct } from '@/lib/reports.ts'
import { tenant } from '@/lib/session.ts'
// HQ command center (brief s34) and centre dashboard (s35) from one query set; every card links to the list behind it.
export default async function Dashboard() {
  const d = await tenant(async (db, c) => {
    const { rows: [k] } = await db.query(`select count(*)::int total, count(*) filter (where created_at >= date_trunc('day', now()))::int today,
      count(*) filter (where lifecycle in ('ENQUIRY','PROSPECT','INTERESTED'))::int active, count(*) filter (where lifecycle = 'ENQUIRY')::int new,
      count(*) filter (where lifecycle = 'PROSPECT')::int prospect, count(*) filter (where lifecycle = 'INTERESTED')::int interested, count(*) filter (where lifecycle = 'ENROLLED')::int enrolled,
      coalesce(sum(total_paid), 0)::float revenue, count(*) filter (where attempts = 0 and lifecycle = 'ENQUIRY')::int untouched,
      count(*) filter (where sla_15_breached_at is not null and attempts = 0 and lifecycle = 'ENQUIRY')::int b15, count(*) filter (where sla_24_breached_at is not null and attempts = 0 and lifecycle = 'ENQUIRY')::int b24,
      count(*) filter (where owner_user_id is null and lifecycle in ('ENQUIRY','PROSPECT','INTERESTED'))::int unassigned, count(*) filter (where next_followup_at < now() and lifecycle in ('ENQUIRY','PROSPECT','INTERESTED'))::int overdue,
      count(*) filter (where next_followup_at >= date_trunc('day', now()) and next_followup_at < date_trunc('day', now()) + interval '1 day')::int due_today,
      count(*) filter (where assigned_at >= date_trunc('day', now()))::int assigned_today, count(*) filter (where last_repeat_enquiry_at >= now() - interval '7 days')::int repeats,
      count(*) filter (where closed_at >= now() - interval '7 days')::int closed_week from lead_list where anonymised_at is null and merged_into_id is null`)
    const wide = !c.centre_id
    const perf = wide ? (await db.query<{ code: string; id: string; total: number; enrolled: number; untouched: number }>(`select c.code, c.id, count(v.id)::int total, count(*) filter (where v.lifecycle = 'ENROLLED')::int enrolled, count(*) filter (where v.attempts = 0 and v.lifecycle = 'ENQUIRY')::int untouched
      from centres c left join lead_list v on v.current_centre_id = c.id and v.created_at > now() - interval '30 days' where c.is_active group by 1, 2 order by enrolled desc, total desc limit 12`)).rows : []
    const users = (await db.query<{ name: string; id: string; open: number; overdue: number }>(`select u.display_name as name, u.id, count(v.id) filter (where v.lifecycle in ('ENQUIRY','PROSPECT','INTERESTED'))::int open, count(*) filter (where v.next_followup_at < now() and v.lifecycle in ('ENQUIRY','PROSPECT','INTERESTED'))::int overdue
      from users u left join lead_list v on v.owner_user_id = u.id where u.is_active and u.role in ('COUNSELLOR','CENTRE_ADMIN','HQ_COUNSELLOR') and ($1::uuid is null or u.centre_id = $1) group by 1, 2 order by open desc limit 12`, [c.centre_id])).rows
    const integ = (await db.query<{ state: string; n: number }>('select state, count(*)::int n from connection_list group by 1')).rows
    const meta = (await db.query<{ name: string; state: string; last_event_at: Date | null }>("select name, state, last_event_at from connection_list where kind = 'meta_page' order by last_event_at desc nulls last limit 5")).rows
    const { rows: [spend] } = await db.query(`select coalesce(sum(spend), 0)::float spend from campaign_spend where day >= now() - interval '30 days'`)
    const { rows: [m30] } = await db.query(`select count(*)::int leads, count(*) filter (where lifecycle in ('INTERESTED','ENROLLED') or became_opportunity_at is not null)::int interested, count(*) filter (where lifecycle = 'ENROLLED')::int enrolled, coalesce(sum(total_paid), 0)::float revenue from lead_list where campaign_id is not null and created_at > now() - interval '30 days'`)
    return { k, wide, perf, users, integ, meta, spend: spend.spend as number, m30, role: c.role }
  })
  const k = d.k, L = (q: string) => `/leads?${q}`
  const median = Math.max(1, Math.round(d.users.reduce((n, u) => n + u.open, 0) / Math.max(1, d.users.length)))
  return <Page title={d.wide ? 'Command center' : 'Dashboard'} sub={d.wide ? 'Organisation-wide. Click any number.' : 'Your centre. Click any number.'}>
    <dl className="grid grid-cols-2 divide-x divide-y divide-line overflow-hidden panel sm:grid-cols-4 lg:grid-cols-7 lg:divide-y-0">
      <Stat label="Total leads" value={k.total} href={L('view=all')} /><Stat label="Today" value={k.today} href={L(`view=all&from=${new Date().toISOString().slice(0, 10)}`)} /><Stat label="Active" value={k.active} href={L('view=active')} />
      <Stat label="New" value={k.new} href={L('view=enquiry')} /><Stat label="Interested" value={k.interested} href={L('view=interested')} /><Stat label="Enrolled" value={k.enrolled} href={L('view=all&lifecycle=ENROLLED')} /><Stat label="Revenue" value={money(k.revenue)} href={L('view=customer')} />
    </dl>
    <div className="grid gap-4 lg:grid-cols-3">
      <section className="panel"><h2 className="border-b border-line px-4 py-2 text-sm font-medium">SLA</h2><dl className="grid grid-cols-3 divide-x divide-line">
        <Stat label="Untouched" value={k.untouched} href={L('view=all&sla=untouched')} tone={k.untouched ? 'text-warn' : ''} /><Stat label="15-min breaches" value={k.b15} href={L('view=all&sla=15')} tone={k.b15 ? 'text-danger' : ''} /><Stat label="24-hour breaches" value={k.b24} href={L('view=all&sla=24')} tone={k.b24 ? 'text-danger' : ''} /></dl>
        {d.wide && k.b24 > 0 && <p className="px-4 pb-3 text-xs text-muted">Open the 24-hour list, select, and use the bulk action <b>Pull back to HQ</b> to reassign.</p>}</section>
      <section className="panel"><h2 className="border-b border-line px-4 py-2 text-sm font-medium">Work pipeline</h2><dl className="grid grid-cols-3 divide-x divide-y divide-line">
        <Stat label="Newly assigned" value={k.assigned_today} href={L('view=assigned_today')} /><Stat label="Repeat enquiries (7d)" value={k.repeats} href={L('view=all&rechurned=1')} /><Stat label="Follow-ups due" value={k.due_today} href={L('view=due')} />
        <Stat label="Overdue" value={k.overdue} href={L('view=overdue')} tone={k.overdue ? 'text-danger' : ''} /><Stat label="Unassigned" value={k.unassigned} href={L('view=unassigned')} tone={k.unassigned ? 'text-warn' : ''} /><Stat label="Closed (7d)" value={k.closed_week} href={L('view=worked')} /></dl></section>
      <section className="panel"><h2 className="border-b border-line px-4 py-2 text-sm font-medium">Marketing (30 days)</h2><dl className="grid grid-cols-2 divide-x divide-y divide-line">
        <Stat label="Spend" value={money(d.spend)} href="/reports?report=campaign" /><Stat label="Leads" value={d.m30.leads} href="/reports?report=campaign" /><Stat label="CPL" value={d.m30.leads ? money(d.spend / d.m30.leads) : '—'} href="/reports?report=campaign" /><Stat label="Cost / interested" value={d.m30.interested ? money(d.spend / d.m30.interested) : '—'} href="/reports?report=campaign" />
        <Stat label="Cost / enrolment" value={d.m30.enrolled ? money(d.spend / d.m30.enrolled) : '—'} href="/reports?report=campaign" /><Stat label="ROAS" value={d.spend ? (d.m30.revenue / d.spend).toFixed(2) + '×' : '—'} href="/reports?report=campaign" /></dl></section>
    </div>
    <div className="grid gap-4 lg:grid-cols-3">
      {d.wide && <section className="panel"><h2 className="border-b border-line px-4 py-2 text-sm font-medium">Centres (30 days)</h2><ul className="divide-y divide-line text-sm">{d.perf.map((p) => <li key={p.id} className="flex items-center gap-2 px-4 py-2"><Link href={L(`view=all&centre=${p.id}`)} className="font-medium hover:underline">{p.code}</Link><span className="text-muted">{p.total} leads · {pct(p.enrolled, p.total)} enrolled</span>{p.untouched > 0 && <Link href={L(`view=all&centre=${p.id}&sla=untouched`)} className="ml-auto text-xs text-warn hover:underline">{p.untouched} untouched</Link>}</li>)}</ul><Link href="/reports?report=leaderboard" className="block px-4 py-2 text-xs text-brand">Full leaderboard →</Link></section>}
      <section className="panel"><h2 className="border-b border-line px-4 py-2 text-sm font-medium">Workload (AS-6)</h2><ul className="divide-y divide-line text-sm">{d.users.map((u) => <li key={u.id} className="flex items-center gap-2 px-4 py-2"><Link href={L(`view=active&owner=${u.id}`)} className="font-medium hover:underline">{u.name}</Link><span className="text-muted">{u.open} open{u.overdue ? ` · ${u.overdue} overdue` : ''}</span>
        <span className={`chip ml-auto ${u.open > median * 1.5 ? 'text-danger' : u.open < median * 0.5 ? 'text-ok' : 'text-muted'}`}>{u.open > median * 1.5 ? 'Overloaded' : u.open < median * 0.5 ? 'Needs leads' : 'OK'}</span></li>)}{d.users.length === 0 && <li className="px-4 py-2 text-muted">No counsellors.</li>}</ul></section>
      <section className="panel"><h2 className="border-b border-line px-4 py-2 text-sm font-medium">Integrations</h2><ul className="divide-y divide-line text-sm">
        {d.integ.map((i) => <li key={i.state} className="flex items-center justify-between px-4 py-2"><Link href={`/integrations?state=${encodeURIComponent(i.state)}`} className={`hover:underline ${STATE_TONE[i.state] ?? ''}`}>{i.state}</Link><span className="tabular-nums">{i.n}</span></li>)}
        {d.integ.length === 0 && <li className="px-4 py-2 text-muted">{d.wide ? 'No connections yet.' : <>Meta not connected. <Link href="/integrations" className="text-brand underline">Connect your Facebook page</Link>.</>}</li>}
        {!d.wide && d.meta.map((m) => <li key={m.name} className="px-4 py-2 text-muted">{m.name}: <span className={STATE_TONE[m.state]}>{m.state}</span>{m.last_event_at && ` · last lead ${m.last_event_at.toISOString().slice(0, 10)}`}</li>)}</ul></section>
    </div>
  </Page>
}
