import { ActionForm } from '@/components/form.tsx'
import { can, tenant } from '@/lib/session.ts'
import { createCentreAction, deactivateCentreAction, impersonateAction } from '../../actions.ts'
import { centreSettingsAction, couponAction } from '../../more-actions.ts'

const ZONES = ['Asia/Kolkata', 'Asia/Dubai', 'Asia/Riyadh', 'Asia/Qatar', 'Asia/Kuwait', 'Asia/Muscat', 'Asia/Bahrain']

export default async function Centres() {
  const { centres, districts, manage, impersonate } = await tenant(async (db) => ({
    manage: await can(db, 'centres.manage'),
    impersonate: await can(db, 'centres.impersonate'),
    districts: (await db.query<{ id: string; code: string }>('select id, code from districts where is_active order by code')).rows,
    centres: (await db.query<{ id: string; code: string; name: string; district: string; timezone: string; is_active: boolean; admin: string | null; users: number; counsellor_lead_visibility: string; intra_centre_assignment: string; accepts_inbound: boolean; coupon: string | null }>(
      `select c.id, c.code, c.name, d.code as district, c.timezone, c.is_active, c.counsellor_lead_visibility, c.intra_centre_assignment, c.accepts_inbound, r.coupon_code as coupon,
              (select u.display_name from users u where u.centre_id = c.id and u.role = 'CENTRE_ADMIN' and u.is_active) as admin,
              (select count(*) from users u where u.centre_id = c.id and u.is_active)::int as users
       from centres c join districts d on d.id = c.district_id left join referral_codes r on r.centre_id = c.id order by c.code`)).rows,
  }))
  return (
    <div className="space-y-5">
      <h1 className="text-[22px] font-semibold leading-tight">Centres</h1>
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
                  {manage && c.is_active && <details><summary className="cursor-pointer text-xs text-brand">Settings · referral</summary>
                    <form action={centreSettingsAction} className="mt-1 flex flex-wrap items-center gap-1 text-xs"><input type="hidden" name="centre_id" value={c.id} />
                      <select name="counsellor_lead_visibility" defaultValue={c.counsellor_lead_visibility} className="input h-7 w-auto text-xs" aria-label="Counsellor visibility"><option value="own">Counsellors see own leads</option><option value="all">Counsellors see all centre leads</option></select>
                      <select name="intra_centre_assignment" defaultValue={c.intra_centre_assignment} className="input h-7 w-auto text-xs" aria-label="Assignment"><option value="centre_admin">New leads to Centre Admin</option><option value="round_robin">Round-robin counsellors</option></select>
                      <label><input type="checkbox" name="accepts_inbound" defaultChecked={c.accepts_inbound} /> accepts inbound</label><button className="btn btn-quiet h-7">Save</button></form>
                    <form action={couponAction} className="mt-1 flex items-center gap-1 text-xs"><input type="hidden" name="centre_id" value={c.id} /><span className="text-muted">elessons.net/?ref={c.code}</span><input name="coupon" defaultValue={c.coupon ?? ''} className="input h-7 w-28 text-xs" placeholder="Coupon" aria-label="Coupon" /><button className="btn btn-quiet h-7">Set</button>
                      <a className="text-brand underline" href={`https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(`https://elessons.net/?ref=${c.code}`)}`} target="_blank" rel="noreferrer">QR</a></form></details>}
                  <div className="mt-1 flex flex-wrap justify-end gap-2">
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
