import { ActionForm } from '@/components/form.tsx'
import { can, tenant } from '@/lib/session.ts'
import { createDistrictAction } from '../../actions.ts'

export default async function Districts() {
  const { rows, manage } = await tenant(async (db) => ({
    manage: await can(db, 'centres.manage'),
    rows: (await db.query<{ id: string; code: string; name: string; is_active: boolean; centres: number }>(
      `select d.id, d.code, d.name, d.is_active, (select count(*) from centres c where c.district_id = d.id)::int as centres
       from districts d order by d.code`)).rows,
  }))
  return (
    <div className="space-y-5">
      <h1 className="text-[22px] font-semibold leading-tight">Districts</h1>
      {manage && (
        <ActionForm action={createDistrictAction} submit="Create district" className="panel grid gap-3 p-4 sm:grid-cols-[8rem_1fr_auto] sm:items-end">
          <div><label className="label" htmlFor="code">Code</label><input id="code" name="code" className="input uppercase" placeholder="EKM" required /></div>
          <div><label className="label" htmlFor="name">Name</label><input id="name" name="name" className="input" required /></div>
        </ActionForm>
      )}
      <section className="panel overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-line"><tr><th className="th">Code</th><th className="th">Name</th><th className="th text-right">Centres</th><th className="th">Status</th></tr></thead>
          <tbody className="divide-y divide-line">
            {rows.map((d) => (
              <tr key={d.id}><td className="td font-medium">{d.code}</td><td className="td">{d.name}</td><td className="td text-right tabular-nums">{d.centres}</td>
                <td className="td"><span className={`chip ${d.is_active ? 'text-ok' : 'text-muted'}`}>{d.is_active ? 'Active' : 'Inactive'}</span></td></tr>
            ))}
            {rows.length === 0 && <tr><td className="td text-muted" colSpan={4}>No districts yet.</td></tr>}
          </tbody>
        </table>
      </section>
    </div>
  )
}
