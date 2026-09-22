import Link from 'next/link'
import { LocalTime } from '@/components/client.tsx'
import { Page } from '@/components/ui.tsx'
import { tenant } from '@/lib/session.ts'
import { completeTaskAction } from '../more-actions.ts'
type T = { id: string; type: string; title: string; due_at: Date; origin: string; lead_id: string; lead: string | null; phone: string | null; owner: string | null; bucket: string }
// WS-11: Due Today / Follow-up Today / Upcoming / Overdue; system-set and user-set visually distinct.
export default async function Todos({ searchParams }: { searchParams: Promise<{ who?: string }> }) {
  const who = (await searchParams).who === 'all' ? 'all' : 'me'
  const { rows, ro } = await tenant(async (db, c) => ({ ro: c.read_only, rows: (await db.query<T>(
    `select t.id, t.type, t.title, t.due_at, t.origin, t.lead_id, v.name as lead, v.primary_phone as phone, u.display_name as owner,
            case when t.due_at < date_trunc('day', now()) then 'overdue' when t.due_at < date_trunc('day', now()) + interval '1 day' then case when t.type = 'followup' then 'followup_today' else 'today' end else 'upcoming' end as bucket
     from tasks t join lead_list v on v.id = t.lead_id left join users u on u.id = t.owner_user_id
     where t.status = 'open' and ($1 = 'all' or t.owner_user_id = app.uid()) and t.due_at < now() + interval '14 days' order by t.due_at limit 500`, [who])).rows }))
  const cols = [['today', 'Due Today'], ['followup_today', 'Follow-up Today'], ['upcoming', 'Upcoming'], ['overdue', 'Overdue']] as const
  return <Page title="To-dos" sub="● user-set · ○ system-set" action={<div className="flex gap-1">{[['me', 'Mine'], ['all', 'Everyone I can see']].map(([k, l]) => <Link key={k} href={`?who=${k}`} className={`rounded-full border px-3 py-1 text-sm ${who === k ? 'border-ink bg-ink text-white' : 'border-line bg-surface text-muted'}`}>{l}</Link>)}</div>}>
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">{cols.map(([k, label]) => { const items = rows.filter((r) => r.bucket === k)
      return <section key={k} className="panel"><h2 className={`border-b border-line px-3 py-2 text-sm font-medium ${k === 'overdue' ? 'text-danger' : ''}`}>{label} <span className="text-muted">{items.length}</span></h2>
        <ul className="divide-y divide-line">{items.map((t) => <li key={t.id} className="p-3 text-sm">
          <Link href={`/leads?view=all&lead=${t.lead_id}`} className="font-medium hover:underline">{t.lead ?? 'Unnamed'}</Link>
          <p className="text-muted">{t.origin === 'user' ? '●' : '○'} {t.title}</p>
          <div className="mt-1 flex items-center gap-2 text-xs text-muted"><LocalTime iso={t.due_at.toISOString()} />{who === 'all' && <span>· {t.owner}</span>}
            <span className="ml-auto flex gap-1">{t.phone && <a href={`tel:${t.phone}`} className="btn btn-quiet h-7 px-2">Call</a>}{!ro && <form action={completeTaskAction}><input type="hidden" name="task_id" value={t.id} /><button className="btn btn-quiet h-7 px-2">Done</button></form>}</span></div></li>)}
          {items.length === 0 && <li className="p-3 text-sm text-muted">Nothing here.</li>}</ul></section> })}</div>
  </Page>
}
