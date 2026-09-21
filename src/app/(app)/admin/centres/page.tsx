import { ActionForm } from '@/components/form.tsx'
import { can, tenant } from '@/lib/session.ts'
import { createCentreAction, deactivateCentreAction, impersonateAction } from '../../actions.ts'

const ZONES = ['Asia/Kolkata', 'Asia/Dubai', 'Asia/Riyadh', 'Asia/Qatar', 'Asia/Kuwait', 'Asia/Muscat', 'Asia/Bahrain']

export default async function Centres() {
  const { centres, districts, manage, impersonate } = await tenant(async (db) => ({
    manage: await can(db, 'centres.manage'),
    impersonate: await can(db, 'centres.impersonate'),
    districts: (await db.query<{ id: string; code: string }>('select id, code from districts where is_active order by code')).rows,
    centres: (await db.query<{ id: string; code: string; name: string; district: string; timezone: string; is_active: boolean; admin: string | null; users: number }>(
      `select c.id, c.code, c.name, d.code as district, c.timezone, c.is_active,
              (select u.display_name from users u where u.centre_id = c.id and u.role = 'CENTRE_ADMIN' and u.is_active) as admin,
              (select count(*) from users u where u.centre_id = c.id and u.is_active)::int as users
       from centres c join districts d on d.id = c.district_id order by c.code`)).rows,
  }))
  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold">Centres</h1>
      {manage && (
        <ActionForm action={createCentreAction} submit="Create centre" className="panel grid gap-3 p-4 sm:grid-cols-[8rem_9rem_1fr_11rem_auto] sm:items-end">
          <div><label className="label" htmlFor="district_id">District</label>
            <select id="district_id" name="district_id" className="input" required>{districts.map((d) => <option key={d.id} value={d.id}>{d.code}</option>)}</select></div>
          <div><label className="label" htmlFor="code">Centre code</label><input id="code" name="code" className="input uppercase" placeholder="EKM-08" required /></div>
          <div><label className="label" htmlFor="name">Name</label><input id="name" name="name" className="input" required /></div>
          <div><label className="label" htmlFor="timezone">Timezone</label>
            <select id="timezone" name="timezone" className="input">{ZONES.map((z) => <option key={z}>{z}</option>)}</select></div>
        </ActionForm>
      )}
      <section className="panel overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-line"><tr><th className="th">Centre</th><th className="th">District</th><th className="th">Centre Admin</th><th className="th text-right">Users</th><th className="th">Status</th><th className="th" /></tr></thead>
          <tbody className="divide-y divide-line">
            {centres.map((c) => (
              <tr key={c.id} className="align-top">
                <td className="td"><span className="font-medium">{c.code}</span> <span className="text-muted">{c.name}</span></td>
                <td className="td">{c.district}</td>
                <td className="td">{c.admin ?? <span className="text-warn">None</span>}</td>
                <td className="td text-right tabular-nums">{c.users}</td>
                <td className="td"><span className={`chip ${c.is_active ? 'text-ok' : 'text-muted'}`}>{c.is_active ? 'Active' : 'Deactivated'}</span></td>
                <td className="td">
                  <div className="flex flex-wrap justify-end gap-2">
                    {impersonate && c.is_active && (
                      <form action={impersonateAction}><input type="hidden" name="centre_id" value={c.id} /><button className="btn btn-quiet">View as</button></form>
                    )}
                    {manage && c.is_active && (
                      <details className="relative">
                        <summary className="btn btn-danger cursor-pointer list-none">Deactivate</summary>
                        <ActionForm action={deactivateCentreAction} submit="Confirm deactivation" danger className="panel absolute right-0 z-10 mt-1 w-72 space-y-2 p-3 shadow-lg">
                          <input type="hidden" name="centre_id" value={c.id} />
                          <p className="text-xs text-muted">Stops inbound leads and signs out all {c.users} users. No data is deleted.</p>
                          <input name="reason" className="input" placeholder="Reason (required)" required aria-label="Reason" />
                        </ActionForm>
                      </details>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  )
}
