import { ActionForm } from '@/components/form.tsx'
import { money, Page, Table } from '@/components/ui.tsx'
import { perms, tenant } from '@/lib/session.ts'
import { catalogueItemAction, priceAction, toggleActiveAction } from '../more-actions.ts'
export default async function Catalogue() {
  const d = await tenant(async (db, c) => ({ ro: c.read_only, manage: (await perms(db, ['catalogue.manage'] as const))['catalogue.manage'],
    items: (await db.query<{ id: string; name: string; grade: number | null; plan: string; stream: string | null; subject: string | null; mentorship: boolean; is_active: boolean; prices: { id: string; currency: string; region: string; amount: string; is_active: boolean }[] }>(
      `select i.*, coalesce((select json_agg(json_build_object('id', p.id, 'currency', p.currency, 'region', p.region, 'amount', p.amount, 'is_active', p.is_active) order by p.currency) from prices p where p.item_id = i.id), '[]') as prices from catalogue_items i order by i.grade, i.plan, i.name`)).rows }))
  return <Page title="Catalogue" sub="Mirrors elessons.net: grade, plan, stream, subject, mentorship. Prices per currency and region; nothing is hardcoded.">
    {d.manage && !d.ro && <ActionForm action={catalogueItemAction} submit="Add item" className="panel grid gap-3 p-4 sm:grid-cols-3 lg:grid-cols-7 lg:items-end">
      <div className="lg:col-span-2"><label className="label" htmlFor="name">Name</label><input id="name" name="name" className="input" required /></div>
      <div><label className="label" htmlFor="grade">Grade</label><select id="grade" name="grade" className="input">{[8, 9, 10, 11, 12].map((g) => <option key={g}>{g}</option>)}</select></div>
      <div><label className="label" htmlFor="plan">Plan</label><select id="plan" name="plan" className="input"><option value="all_subjects">All subjects</option><option value="single_subject">Single subject</option></select></div>
      <div><label className="label" htmlFor="stream">Stream (11-12)</label><select id="stream" name="stream" className="input"><option value="">—</option><option>PCMB</option><option>PCMC</option><option>Commerce</option></select></div>
      <div><label className="label" htmlFor="subject">Subject (single)</label><input id="subject" name="subject" className="input" /></div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="mentorship" /> Mentorship add-on</label>
    </ActionForm>}
    <Table head={['Item', 'Grade', 'Plan', 'Prices', 'Status', '']} empty={d.items.length ? undefined : 'No catalogue items yet. PLACEHOLDER: add the real eLessons plans (NEEDED.md).'}>
      {d.items.map((i) => <tr key={i.id} className="align-top"><td className="td font-medium">{i.name}{i.mentorship && <span className="chip ml-1">+mentorship</span>}</td><td className="td">{i.grade}{i.stream ? ` · ${i.stream}` : ''}</td><td className="td">{i.plan === 'all_subjects' ? 'All subjects' : `Single · ${i.subject}`}</td>
        <td className="td"><ul className="space-y-0.5">{i.prices.map((p) => <li key={p.id} className={p.is_active ? '' : 'line-through text-muted'}>{money(p.amount, p.currency)}{p.region ? ` (${p.region})` : ''}</li>)}</ul>
          {d.manage && !d.ro && i.is_active && <ActionForm action={priceAction} submit="Set" className="mt-1 flex flex-wrap gap-1"><input type="hidden" name="item_id" value={i.id} /><select name="currency" className="input h-7 w-auto text-xs" aria-label="Currency">{['INR', 'AED', 'SAR', 'QAR', 'KWD', 'OMR', 'BHD'].map((c) => <option key={c}>{c}</option>)}</select><input name="region" className="input h-7 w-20 text-xs" placeholder="Region" aria-label="Region" /><input name="amount" type="number" step="0.01" className="input h-7 w-24 text-xs" placeholder="Amount" aria-label="Amount" required /></ActionForm>}</td>
        <td className="td"><span className={`chip ${i.is_active ? 'text-ok' : 'text-muted'}`}>{i.is_active ? 'Active' : 'Inactive'}</span></td>
        <td className="td text-right">{d.manage && !d.ro && <form action={toggleActiveAction}><input type="hidden" name="table" value="catalogue_items" /><input type="hidden" name="id" value={i.id} /><input type="hidden" name="active" value={String(!i.is_active)} /><button className="btn btn-quiet h-8">{i.is_active ? 'Deactivate' : 'Activate'}</button></form>}</td></tr>)}
    </Table>
  </Page>
}
