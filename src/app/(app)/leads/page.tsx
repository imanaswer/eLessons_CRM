import Link from 'next/link'
import { LocalTime, SelectAll } from '@/components/client.tsx'
import { Avatar, Empty, fmtPhone, Lifecycle } from '@/components/ui.tsx'
import { I } from '@/components/icons.tsx'
import { buildLeadQuery, leadFilterSchema, SMART_VIEWS, type SmartView } from '@/lib/leads-query.ts'
import { perms, tenant } from '@/lib/session.ts'
import { BulkBar } from './bulk.tsx'
import { SaveViewBar } from './saveview.tsx'
import { LeadDrawer } from './drawer.tsx'

const PAGE = 50
type Row = { id: string; name: string | null; primary_phone: string | null; lifecycle: string; closed_reason: string | null; city: string | null; source_l1: string | null; source_l2: string | null
  next_followup_at: Date | null; next_followup_origin: string | null; owner_name: string | null; centre_code: string | null; disposition: string | null; attempts: number; created_at: Date; cursor: string; tags: string[] }

export default async function Leads({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams
  const filters = leadFilterSchema.parse(sp)
  const data = await tenant(async (db, c) => {
    const q = buildLeadQuery(filters, PAGE + 1, c)
    const wide = c.centre_id === null
    const rows = await db.query<Row>(q.sql, q.params)
    const centres = wide ? await db.query<{ id: string; code: string }>('select id, code from centres where is_active order by code') : null
    const owners = await db.query<{ id: string; display_name: string; scope: string | null }>(
      `select u.id, u.display_name, c.code as scope from users u left join centres c on c.id = u.centre_id
       where u.is_active and ($1::uuid is null or u.centre_id = $1) order by c.code nulls first, u.display_name limit 300`, [filters.centre ?? c.centre_id])
    const lists = await db.query<{ id: string; name: string }>("select id, name from lists where kind = 'static' order by created_at desc limit 100")
    const labels = await db.query<{ name: string }>('select distinct source_l1 as name from lead_list where source_l1 is not null limit 50')
    const saved = (await db.query<{ id: string; name: string; filters: object; shared_centre_id: string | null }>('select id, name, filters, shared_centre_id from saved_views order by name limit 30')).rows
    const p = await perms(db, ['leads.assign', 'leads.transfer', 'leads.export', 'leads.bulk_select', 'leads.view_phone', 'leads.create', 'leads.import'] as const)
    return { saved, rows: rows.rows, centres: centres?.rows ?? [], owners: owners.rows, lists: lists.rows, sources: labels.rows, claims: c, wide,
      perms: { assign: p['leads.assign'], transfer: p['leads.transfer'] && c.role !== 'CENTRE_ADMIN', pullBack: p['leads.transfer'] && (c.role === 'HQ_ADMIN' || c.role === 'SUPERADMIN'), exp: p['leads.export'], bulkSelect: p['leads.bulk_select'], viewPhone: p['leads.view_phone'], create: p['leads.create'], imp: p['leads.import'] } }
  })
  const rows = data.rows.slice(0, PAGE), next = data.rows.length > PAGE ? rows.at(-1)!.cursor : null
  const qs = (over: Record<string, string | undefined>) => {
    const u = new URLSearchParams()
    for (const [k, v] of Object.entries({ ...sp, cursor: undefined, lead: undefined, existing: undefined, ...over })) if (v) u.set(k, v)
    return `/leads?${u}`
  }
  const ro = data.claims.read_only
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="mr-auto"><h1 className="text-[22px] font-semibold leading-tight">Leads</h1><p className="text-[13px] text-muted">{SMART_VIEWS[filters.view].label}{filters.q ? ` · “${filters.q}”` : ''}</p></div>
        {data.perms.imp && !ro && <Link href="/leads/import" className="btn btn-quiet">Import</Link>}
        {data.perms.create && !ro && <Link href="/leads/new" className="btn btn-primary"><I.plus className="h-4 w-4" />New lead</Link>}
      </div>
      {data.saved.length > 0 && <nav aria-label="Saved views" className="flex flex-wrap gap-1">{data.saved.map((v) => <Link key={v.id} href={`/leads?${new URLSearchParams(v.filters as Record<string, string>)}`} className="seg h-7 text-[12.5px]">★ {v.name}{v.shared_centre_id ? '' : <span className="ml-1 text-faint">private</span>}</Link>)}</nav>}
      <nav aria-label="Smart views" className="-mx-4 flex gap-0.5 overflow-x-auto px-4 lg:-mx-6 lg:px-6">
        {(Object.keys(SMART_VIEWS) as SmartView[]).filter((v) => v !== 'all').map((v) => <Link key={v} href={qs({ view: v })} aria-current={filters.view === v ? 'page' : undefined} className="seg">{SMART_VIEWS[v].label}</Link>)}
      </nav>
      <form className="panel grid grid-cols-2 gap-2 p-2.5 md:grid-cols-4 lg:grid-cols-7">
        <input type="hidden" name="view" value={filters.view} />
        <div className="relative col-span-2"><I.search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-faint" /><input name="q" defaultValue={filters.q ?? ''} className="input pl-8" placeholder={data.perms.viewPhone ? 'Search name or phone' : 'Search name'} aria-label="Search" /></div>
        {data.wide && <select name="centre" defaultValue={filters.centre ?? ''} className="input" aria-label="Centre"><option value="">All centres</option>{data.centres.map((c) => <option key={c.id} value={c.id}>{c.code}</option>)}</select>}
        <select name="owner" defaultValue={filters.owner ?? ''} className="input" aria-label="Owner"><option value="">Any owner</option>{data.owners.map((o) => <option key={o.id} value={o.id}>{o.display_name}{data.wide && o.scope ? ` (${o.scope})` : ''}</option>)}</select>
        <select name="source" defaultValue={filters.source ?? ''} className="input" aria-label="Source"><option value="">Any source</option>{data.sources.map((s) => <option key={s.name}>{s.name}</option>)}</select>
        <input type="date" name="from" defaultValue={filters.from ?? ''} className="input" aria-label="Created from" />
        <div className="flex gap-2"><button className="btn btn-quiet flex-1">Filter</button><Link href={`/leads?view=${filters.view}`} className="btn btn-ghost">Reset</Link></div>
      </form>
      <div className="hidden md:block"><SaveViewBar filters={filters} centreId={data.claims.centre_id} readOnly={ro} /></div>

      <BulkBar perms={data.perms} readOnly={ro} owners={data.owners} centres={data.centres} lists={data.lists} filters={JSON.stringify(filters)}>
        <div className="panel overflow-hidden">
          <div className="overflow-x-auto">
          <table className="w-full">
            <thead><tr>
              <th className="th w-8">{data.perms.bulkSelect && <SelectAll name="ids" />}</th>
              <th className="th">Parent</th><th className="th hidden md:table-cell">Stage</th><th className="th hidden lg:table-cell">Last outcome</th>
              <th className="th">Next follow-up</th><th className="th hidden md:table-cell">Owner</th>{data.wide && <th className="th hidden md:table-cell">Centre</th>}
              <th className="th hidden lg:table-cell">Source</th><th className="th hidden lg:table-cell">Created</th><th className="th" />
            </tr></thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => {
                const overdue = r.next_followup_at && r.next_followup_at < new Date()
                return (
                  <tr key={r.id} className={sp.lead === r.id ? '!bg-brand-soft/60' : ''}>
                    <td className="td"><input type="checkbox" name="ids" value={r.id} aria-label={`Select ${r.name ?? 'lead'}`} /></td>
                    <td className="td">
                      <div className="flex items-center gap-2.5"><Avatar name={r.name} />
                        <div className="min-w-0"><Link href={qs({ lead: r.id, cursor: sp.cursor })} scroll={false} className="block truncate font-medium text-ink hover:text-brand">{r.name ?? <span className="text-muted">Unnamed parent</span>}</Link>
                          <div className="num text-[12px] text-muted">{fmtPhone(r.primary_phone)}{r.city ? ` · ${r.city}` : ''}</div>
                          <div className="mt-1 md:hidden"><Lifecycle state={r.lifecycle} /></div></div></div>
                    </td>
                    <td className="td hidden md:table-cell"><Lifecycle state={r.lifecycle} /></td>
                    <td className="td hidden text-muted lg:table-cell">{r.closed_reason ?? r.disposition ?? (r.attempts ? '' : <span className="text-faint">Never picked</span>)}</td>
                    <td className={`td whitespace-nowrap ${overdue ? 'font-medium text-danger' : ''}`}>
                      {r.next_followup_at ? <span className="inline-flex items-center gap-1.5">{overdue && <I.clock className="h-3.5 w-3.5" />}<LocalTime iso={r.next_followup_at.toISOString()} /><span title={r.next_followup_origin === 'user' ? 'Set by a user' : 'Set by the system'} className={`h-1.5 w-1.5 rounded-full ${r.next_followup_origin === 'user' ? 'bg-ink' : 'border border-faint'}`} /></span> : <span className="text-faint">—</span>}
                    </td>
                    <td className="td hidden md:table-cell">{r.owner_name ?? <span className="chip text-warn">Unassigned</span>}</td>
                    {data.wide && <td className="td hidden md:table-cell"><span className="font-medium">{r.centre_code ?? <span className="text-muted">HQ pool</span>}</span></td>}
                    <td className="td hidden text-muted lg:table-cell">{[r.source_l1, r.source_l2].filter(Boolean).join(' › ')}</td>
                    <td className="td hidden whitespace-nowrap text-muted lg:table-cell"><LocalTime iso={r.created_at.toISOString()} dateOnly /></td>
                    <td className="td whitespace-nowrap text-right">
                      {data.perms.viewPhone && r.primary_phone && <span className="inline-flex gap-1">
                        <a href={`tel:${r.primary_phone}`} className="btn btn-quiet h-7 w-7 px-0" aria-label={`Call ${r.name ?? 'lead'}`}><I.phone className="h-3.5 w-3.5" /></a>
                        <a href={`https://wa.me/${r.primary_phone.slice(1)}`} target="_blank" rel="noreferrer" className="btn btn-quiet hidden h-7 w-7 px-0 sm:inline-flex" aria-label="WhatsApp"><I.whatsapp className="h-3.5 w-3.5" /></a></span>}
                    </td>
                  </tr>
                )
              })}
              {rows.length === 0 && <tr><td colSpan={10}><Empty title={`No leads in ${SMART_VIEWS[filters.view].label}${filters.q ? ` matching “${filters.q}”` : ''}`} hint={filters.view === 'active' && !filters.q ? 'New leads arrive from your Facebook page, the website, imports, or the New lead button.' : 'Try another view or clear the filters.'} icon="leads" action={data.perms.create && !ro ? <Link href="/leads/new" className="btn btn-primary h-8">New lead</Link> : undefined} /></td></tr>}
            </tbody>
          </table></div>
        </div>
      </BulkBar>
      <div className="flex items-center gap-3 text-[12.5px] text-muted">
        <span>{rows.length} shown</span>
        {sp.cursor && <Link href={qs({})} className="btn btn-quiet h-8">First page</Link>}
        {next && <Link href={qs({ cursor: next })} className="btn btn-quiet h-8">Next {PAGE}</Link>}
        <span className="ml-auto hidden items-center gap-3 sm:inline-flex"><span className="inline-flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-ink" />user-set</span><span className="inline-flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full border border-faint" />system-set</span></span>
      </div>
      {sp.lead && <LeadDrawer id={sp.lead} closeHref={qs({ cursor: sp.cursor })} tab={sp.tab ?? 'interactions'} baseHref={qs({ lead: sp.lead, cursor: sp.cursor })} existing={sp.existing === '1'} />}
    </div>
  )
}
