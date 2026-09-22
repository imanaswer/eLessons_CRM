import { ActionForm } from '@/components/form.tsx'
import { tenant } from '@/lib/session.ts'
import { createUserAction, setUserActiveAction } from '../../actions.ts'

export default async function Users() {
  const { users, centres, districts, me } = await tenant(async (db, c) => ({
    me: c,
    centres: (await db.query<{ id: string; code: string }>('select id, code from centres where is_active order by code')).rows,
    districts: (await db.query<{ id: string; code: string }>('select id, code from districts where is_active order by code')).rows,
    users: (await db.query<{ id: string; username: string; display_name: string; role: string; scope: string; is_active: boolean; last_login_at: Date | null }>(
      `select u.id, u.username, u.display_name, u.role, u.is_active, u.last_login_at,
              coalesce(c.code, d.code, 'HQ') as scope
       from users u left join centres c on c.id = u.centre_id left join districts d on d.id = u.district_id
       order by scope, u.role, u.username limit 500`)).rows,
  }))
  const hq = me.role === 'SUPERADMIN' || me.role === 'HQ_ADMIN'
  const roles = hq ? ['COUNSELLOR', 'CENTRE_ADMIN', 'DISTRICT_MANAGER', 'HQ_COUNSELLOR', 'HQ_ADMIN'] : ['COUNSELLOR']
  return (
    <div className="space-y-5">
      <h1 className="text-[22px] font-semibold leading-tight">Users</h1>
      {!me.read_only && (
        <ActionForm action={createUserAction} submit="Create user" className="panel grid gap-3 p-4 sm:grid-cols-3 lg:grid-cols-6 lg:items-end">
          <div><label className="label" htmlFor="role">Role</label><select id="role" name="role" className="input">{roles.map((r) => <option key={r}>{r}</option>)}</select></div>
          {hq && <div><label className="label" htmlFor="centre_id">Centre (centre roles)</label>
            <select id="centre_id" name="centre_id" className="input"><option value="">—</option>{centres.map((c) => <option key={c.id} value={c.id}>{c.code}</option>)}</select></div>}
          {hq && <div><label className="label" htmlFor="district_id">District (managers)</label>
            <select id="district_id" name="district_id" className="input"><option value="">—</option>{districts.map((d) => <option key={d.id} value={d.id}>{d.code}</option>)}</select></div>}
          <div><label className="label" htmlFor="username">Username</label><input id="username" name="username" className="input" required autoCapitalize="none" /></div>
          <div><label className="label" htmlFor="display_name">Full name</label><input id="display_name" name="display_name" className="input" required /></div>
          <div><label className="label" htmlFor="password">Temporary password</label><input id="password" name="password" type="password" className="input" required minLength={10} autoComplete="new-password" /></div>
        </ActionForm>
      )}
      <section className="panel overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-line"><tr><th className="th">Scope</th><th className="th">User</th><th className="th">Role</th><th className="th">Last sign-in</th><th className="th">Status</th><th className="th" /></tr></thead>
          <tbody className="divide-y divide-line">
            {users.map((u) => (
              <tr key={u.id}>
                <td className="td font-medium">{u.scope}</td>
                <td className="td">{u.display_name} <span className="text-muted">@{u.username}</span></td>
                <td className="td"><span className="chip">{u.role}</span></td>
                <td className="td text-muted">{u.last_login_at ? u.last_login_at.toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : 'Never'}</td>
                <td className="td"><span className={`chip ${u.is_active ? 'text-ok' : 'text-muted'}`}>{u.is_active ? 'Active' : 'Disabled'}</span></td>
                <td className="td text-right">
                  {u.id !== me.user_id && !me.read_only && (
                    <form action={setUserActiveAction}>
                      <input type="hidden" name="user_id" value={u.id} /><input type="hidden" name="active" value={String(!u.is_active)} />
                      <button className={`btn ${u.is_active ? 'btn-danger' : 'btn-quiet'}`}>{u.is_active ? 'Disable' : 'Enable'}</button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  )
}
