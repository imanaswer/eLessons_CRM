import Link from 'next/link'
import { tenant } from '@/lib/session.ts'

// Phase 0 dashboard: what this login can see. Lead metrics replace this in Phase 2.
export default async function Dashboard() {
  const { counts, centres, role } = await tenant(async (db, c) => {
    const counts = await db.query<{ districts: number; centres: number; users: number }>(
      `select (select count(*) from districts where is_active)::int as districts,
              (select count(*) from centres where is_active)::int as centres,
              (select count(*) from users where is_active)::int as users`)
    const centres = await db.query<{ id: string; code: string; name: string; district: string; users: number; is_active: boolean }>(
      `select c.id, c.code, c.name, d.code as district, c.is_active,
              (select count(*) from users u where u.centre_id = c.id and u.is_active)::int as users
       from centres c join districts d on d.id = c.district_id order by c.code limit 200`)
    return { counts: counts.rows[0]!, centres: centres.rows, role: c.role }
  })
  const stats = [['Districts', counts.districts, '/admin/districts'], ['Centres', counts.centres, '/admin/centres'], ['Active users', counts.users, '/admin/users']] as const
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Dashboard</h1>
        <p className="text-sm text-muted">Everything below is limited by the database to what your login may see.</p>
      </div>
      <dl className="grid grid-cols-3 divide-x divide-line overflow-hidden panel">
        {stats.map(([label, n, href]) => (
          <Link key={label} href={href} className="px-4 py-3 hover:bg-canvas">
            <dt className="text-xs text-muted">{label}</dt><dd className="text-2xl font-semibold tabular-nums">{n}</dd>
          </Link>
        ))}
      </dl>
      <section className="panel overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-line"><tr><th className="th">Centre</th><th className="th">District</th><th className="th text-right">Users</th><th className="th">Status</th></tr></thead>
          <tbody className="divide-y divide-line">
            {centres.map((c) => (
              <tr key={c.id}><td className="td"><span className="font-medium">{c.code}</span> <span className="text-muted">{c.name}</span></td>
                <td className="td">{c.district}</td><td className="td text-right tabular-nums">{c.users}</td>
                <td className="td"><span className={`chip ${c.is_active ? 'text-ok' : 'text-muted'}`}>{c.is_active ? 'Active' : 'Deactivated'}</span></td></tr>
            ))}
          </tbody>
        </table>
      </section>
      {role === 'COUNSELLOR' && <p className="text-sm text-muted">Lead work screens arrive in Phase 1.</p>}
    </div>
  )
}
