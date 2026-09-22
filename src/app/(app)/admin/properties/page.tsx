import { ActionForm } from '@/components/form.tsx'
import { Page, Table } from '@/components/ui.tsx'
import { tenant } from '@/lib/session.ts'
import { propertyAction, toggleActiveAction } from '../../more-actions.ts'
export default async function Properties() {
  const d = await tenant(async (db, c) => ({ ro: c.read_only, rows: (await db.query<{ id: string; entity: string; key: string; label: string; type: string; options: string[]; parent_key: string | null; is_active: boolean }>('select * from property_definitions order by entity, sort, key')).rows }))
  return <Page title="Custom properties" sub="LT-9: text, number, date, option, multi-option, phone. Cascading: give a child property a parent key (Country → State → City).">
    {!d.ro && <ActionForm action={propertyAction} submit="Add property" className="panel grid gap-2 p-4 md:grid-cols-6"><select name="entity" className="input" aria-label="Entity">{['lead', 'student', 'deal', 'user', 'payment'].map((e) => <option key={e}>{e}</option>)}</select><input name="key" className="input" placeholder="key_name" aria-label="Key" required /><input name="label" className="input" placeholder="Label" aria-label="Label" required />
      <select name="type" className="input" aria-label="Type">{['text', 'number', 'date', 'option', 'multi_option', 'phone'].map((t) => <option key={t}>{t}</option>)}</select><input name="options" className="input" placeholder="Options, comma-separated" aria-label="Options" /><input name="parent_key" className="input" placeholder="Parent key (cascade)" aria-label="Parent key" /></ActionForm>}
    <Table head={['Entity', 'Key', 'Label', 'Type', 'Options', 'Status', '']} empty={d.rows.length ? undefined : 'No custom properties.'}>
      {d.rows.map((p) => <tr key={p.id}><td className="td">{p.entity}</td><td className="td font-mono text-xs">{p.key}{p.parent_key && <span className="text-muted"> ← {p.parent_key}</span>}</td><td className="td">{p.label}</td><td className="td">{p.type}</td><td className="td text-muted">{p.options.join(', ')}</td><td className="td"><span className={`chip ${p.is_active ? 'text-ok' : 'text-muted'}`}>{p.is_active ? 'Active' : 'Off'}</span></td>
        <td className="td text-right">{!d.ro && <form action={toggleActiveAction}><input type="hidden" name="table" value="property_definitions" /><input type="hidden" name="id" value={p.id} /><input type="hidden" name="active" value={String(!p.is_active)} /><button className="btn btn-quiet h-8">{p.is_active ? 'Disable' : 'Enable'}</button></form>}</td></tr>)}</Table>
  </Page>
}
