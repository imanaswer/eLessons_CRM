import Link from 'next/link'
import { LocalTime } from '@/components/client.tsx'
import { Avatar, Page } from '@/components/ui.tsx'
import { tenant } from '@/lib/session.ts'
import { Thread } from './thread.tsx'
const TABS = { unread: 'Unread', time_left: 'Time Left', expired: 'Expired', starred: 'Starred', awaiting: 'Awaiting', last_by_lead: 'Last By Lead', failed: 'Failed', resolved: 'Resolved', all: 'All' } as const
// CV-1/CV-2: Lead Inbox (mine) and Team Inbox (everything I can see), session-window tabs.
export default async function Conversations({ searchParams }: { searchParams: Promise<{ tab?: string; inbox?: string; id?: string }> }) {
  const sp = await searchParams; const tab = (sp.tab && sp.tab in TABS ? sp.tab : 'all') as keyof typeof TABS; const inbox = sp.inbox === 'team' ? 'team' : 'mine'
  const where = { unread: 'c.unread > 0', time_left: 'c.session_expires_at > now()', expired: 'c.session_expires_at <= now()', starred: 'c.starred', awaiting: "c.status = 'awaiting'", last_by_lead: "c.last_by = 'lead'",
    failed: "exists (select from messages m where m.conversation_id = c.id and m.status = 'failed')", resolved: "c.status = 'resolved'", all: 'true' }[tab]
  const rows = await tenant(async (db) => (await db.query<{ id: string; lead: string | null; wa_id: string; unread: number; last_message_at: Date | null; session_expires_at: Date | null; status: string; starred: boolean; preview: string | null; owner: string | null }>(
    `select c.id, v.name as lead, c.wa_id, c.unread, c.last_message_at, c.session_expires_at, c.status, c.starred, u.display_name as owner,
            (select left(body, 80) from messages m where m.conversation_id = c.id order by m.id desc limit 1) as preview
     from conversations c left join lead_list v on v.id = c.lead_id left join users u on u.id = c.owner_user_id
     where ${where} and ($1 = 'team' or c.owner_user_id = app.uid()) order by c.last_message_at desc nulls last limit 200`, [inbox])).rows)
  return <Page title="Conversations" action={<div className="flex gap-1">{[['mine', 'Lead Inbox'], ['team', 'Team Inbox']].map(([k, l]) => <Link key={k} href={`?inbox=${k}&tab=${tab}`} aria-current={inbox === k ? 'page' : undefined} className="seg">{l}</Link>)}</div>}>
    <nav className="-mx-4 flex gap-0.5 overflow-x-auto px-4 lg:-mx-6 lg:px-6">{Object.entries(TABS).map(([k, l]) => <Link key={k} href={`?inbox=${inbox}&tab=${k}`} aria-current={tab === k ? 'page' : undefined} className="seg">{l}</Link>)}</nav>
    <div className="grid gap-4 lg:grid-cols-[22rem_1fr]">
      <ul className="panel divide-y divide-line">{rows.map((c) => { const left = c.session_expires_at ? Math.max(0, Math.round((+c.session_expires_at - Date.now()) / 3600e3)) : null
        return <li key={c.id}><Link href={`?inbox=${inbox}&tab=${tab}&id=${c.id}`} className={`block p-3 text-sm hover:bg-canvas ${sp.id === c.id ? 'bg-blue-50' : ''}`}>
          <div className="flex items-center gap-2"><Avatar name={c.lead ?? c.wa_id} size="sm" /><span className="truncate font-medium">{c.starred ? '★ ' : ''}{c.lead ?? c.wa_id}</span>{c.unread > 0 && <span className="rounded-full bg-brand px-1.5 text-xs text-white">{c.unread}</span>}<span className="ml-auto text-xs text-muted">{c.last_message_at && <LocalTime iso={c.last_message_at.toISOString()} />}</span></div>
          <p className="truncate text-muted">{c.preview ?? '—'}</p><p className="text-xs text-muted">{left === null ? 'no session' : left > 0 ? `${left} h left` : 'expired'} · {c.status}{c.owner ? ` · ${c.owner}` : ''}</p></Link></li> })}
        {rows.length === 0 && <li className="px-3 py-10 text-center text-[13px] text-muted">No conversations in this tab.</li>}</ul>
      {sp.id ? <Thread id={sp.id} /> : <div className="panel grid place-items-center p-8 text-[13px] text-muted">Pick a conversation to read it here.</div>}
    </div>
  </Page>
}
