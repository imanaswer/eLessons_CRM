import Link from 'next/link'
import { LocalTime } from '@/components/client.tsx'
import { ActionForm } from '@/components/form.tsx'
import { Avatar, Empty, money, Page, Table } from '@/components/ui.tsx'
import { tenant } from '@/lib/session.ts'
import { moveDealAction } from '../more-actions.ts'
type D = { id: string; name: string; amount: string; currency: string; stage: string; stage_id: string; stage_sort: number; status: string; last_moved_at: Date; expected_close: Date | null; lead_id: string; lead: string | null; student: string | null; owner: string | null; centre: string | null; lost_reason: string | null; kind: string }
// DL-4: Kanban with per-column totals, and a table view. Same scope rules as leads (deal_list).
export default async function Opportunities({ searchParams }: { searchParams: Promise<{ view?: string; status?: string }> }) {
  const sp = await searchParams; const view = sp.view === 'table' ? 'table' : 'kanban'; const status = sp.status === 'closed' ? 'closed' : 'open'
  const d = await tenant(async (db, c) => ({ ro: c.read_only,
    stages: (await db.query<{ id: string; name: string; is_won: boolean; is_lost: boolean }>('select id, name, is_won, is_lost from deal_stages where is_active order by sort')).rows,
    deals: (await db.query<D>(`select d.id, d.name, d.amount, d.currency, d.stage, d.stage_id, d.stage_sort, d.status, d.last_moved_at, d.expected_close, d.lead_id, d.kind, d.lost_reason, v.name as lead, s.name as student, u.display_name as owner, c.code as centre
      from deal_list d left join lead_list v on v.id = d.lead_id left join students s on s.id = d.student_id left join users u on u.id = d.owner_user_id left join centres c on c.id = d.centre_id
      where ($1 = 'open') = (d.status = 'open') order by d.last_moved_at desc limit 500`, [status])).rows }))
  const tabs = <div className="flex gap-1">{[['kanban', 'Kanban'], ['table', 'Table']].map(([k, l]) => <Link key={k} href={`?view=${k}&status=${status}`} aria-current={view === k ? 'page' : undefined} className="seg">{l}</Link>)}
    <Link href={`?view=${view}&status=${status === 'open' ? 'closed' : 'open'}`} className="btn btn-quiet h-8">{status === 'open' ? 'Show closed' : 'Show open'}</Link></div>
  const Move = ({ deal }: { deal: D }) => d.ro || deal.status !== 'open' ? null : (
    <ActionForm action={moveDealAction} submit="Move" quiet className="mt-2.5 flex flex-wrap gap-1 border-t border-line pt-2.5 text-xs">
      <input type="hidden" name="deal_id" value={deal.id} />
      <select name="stage_id" className="input h-7 flex-1 text-[12px]" defaultValue={deal.stage_id} aria-label="Stage">{d.stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
      <input name="lost_reason" className="input h-7 w-full text-[12px]" placeholder="Reason, if lost" aria-label="Lost reason" />
    </ActionForm>)
  return <Page title="Opportunities" sub="A deal belongs to one student. Won closes the lead as Enrolled; Lost needs a reason." action={tabs}>
    {view === 'kanban' ? <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-3 lg:-mx-6 lg:px-6">{d.stages.filter((s) => status === 'open' ? !s.is_won && !s.is_lost : s.is_won || s.is_lost).map((s) => { const col = d.deals.filter((x) => x.stage_id === s.id); const total = col.reduce((n, x) => n + Number(x.amount), 0)
      return <section key={s.id} className="flex w-[19rem] shrink-0 flex-col rounded-[var(--radius-panel)] bg-rail p-2" style={{ boxShadow: '0 0 0 1px var(--color-line)' }}>
        <h2 className="flex items-baseline gap-2 px-2 py-1.5 text-[13px] font-semibold">{s.name}<span className="num text-[12px] font-normal text-muted">{col.length}</span><span className="num ml-auto text-[12px] font-medium text-ink-2">{money(total, col[0]?.currency)}</span></h2>
        <ul className="space-y-2">{col.map((x) => <li key={x.id} className="rounded-[10px] bg-surface p-3 text-[13px] transition-shadow hover:shadow-menu" style={{ boxShadow: '0 0 0 1px var(--color-line), 0 1px 2px rgba(20,22,28,0.04)' }}>
          <div className="flex items-start gap-2.5"><Avatar name={x.lead ?? x.name} size="sm" /><div className="min-w-0 flex-1"><Link href={`/leads?view=all&lead=${x.lead_id}&tab=opportunities`} className="block truncate font-medium hover:text-brand">{x.lead ?? x.name}</Link><p className="truncate text-[12px] text-muted">{x.student ?? 'No student'}{x.kind === 'renewal' ? ' · renewal' : ''}</p></div><span className="num shrink-0 font-semibold">{money(x.amount, x.currency)}</span></div>
          <p className="mt-2 text-[11.5px] text-faint">{x.owner}{x.centre ? ` · ${x.centre}` : ''} · <LocalTime iso={x.last_moved_at.toISOString()} dateOnly /></p>{x.lost_reason && <p className="mt-1 text-[12px] text-danger">{x.lost_reason}</p>}<Move deal={x} /></li>)}
          {col.length === 0 && <li className="rounded-[10px] border border-dashed border-line-strong px-3 py-6 text-center text-[12px] text-faint">No deals</li>}</ul></section> })}</div>
    : <Table head={['Lead', 'Student', 'Stage', '#Amount', 'Owner', 'Centre', 'Expected close', 'Moved']} empty={d.deals.length ? undefined : 'No deals yet'} emptyHint="A deal is created automatically when a call outcome is positive, or from the Opportunities tab on a lead.">
        {d.deals.map((x) => <tr key={x.id}><td className="td"><Link href={`/leads?view=all&lead=${x.lead_id}&tab=opportunities`} className="font-medium hover:underline">{x.lead ?? x.name}</Link></td><td className="td">{x.student}</td><td className="td"><span className="chip">{x.stage}</span>{x.lost_reason && <span className="ml-1 text-xs text-danger">{x.lost_reason}</span>}</td>
          <td className="td text-right tabular-nums">{money(x.amount, x.currency)}</td><td className="td">{x.owner}</td><td className="td">{x.centre}</td><td className="td">{x.expected_close ? x.expected_close.toISOString().slice(0, 10) : '—'}</td><td className="td"><LocalTime iso={x.last_moved_at.toISOString()} dateOnly /></td></tr>)}
      </Table>}
  </Page>
}
