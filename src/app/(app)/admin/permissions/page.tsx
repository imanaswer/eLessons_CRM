import { Page } from '@/components/ui.tsx'
import { tenant } from '@/lib/session.ts'
import { permissionToggleAction } from '../../more-actions.ts'
const ROLES = ['HQ_ADMIN', 'HQ_COUNSELLOR', 'DISTRICT_MANAGER', 'CENTRE_ADMIN', 'COUNSELLOR'] as const
// TEN-7: the matrix, grouped as in the PRD. Superadmin only (policy on role_permissions).
export default async function Permissions() {
  const d = await tenant(async (db, c) => ({ ro: c.read_only || c.role !== 'SUPERADMIN',
    perms: (await db.query<{ key: string; grp: string; description: string }>('select * from permissions order by grp, key')).rows,
    matrix: new Set((await db.query<{ role: string; permission_key: string }>('select role, permission_key from role_permissions where allowed')).rows.map((r) => r.role + ':' + r.permission_key)) }))
  const groups = [...new Set(d.perms.map((p) => p.grp))]
  return <Page title="Roles & permissions" sub="Superadmin can do everything and is not listed. Changes apply immediately and are audited.">
    <section className="panel overflow-x-auto"><table className="w-full text-sm"><thead className="border-b border-line"><tr><th className="th">Permission</th>{ROLES.map((r) => <th key={r} className="th text-center">{r.replaceAll('_', ' ')}</th>)}</tr></thead>
      <tbody>{groups.map((g) => <>{<tr key={g} className="bg-canvas"><td colSpan={ROLES.length + 1} className="px-3 py-1.5 text-xs font-medium uppercase tracking-wide text-muted">{g.replaceAll('_', ' ')}</td></tr>}
        {d.perms.filter((p) => p.grp === g).map((p) => <tr key={p.key} className="border-t border-line"><td className="td"><span className="font-medium">{p.key}</span><div className="text-xs text-muted">{p.description}</div></td>
          {ROLES.map((r) => { const on = d.matrix.has(r + ':' + p.key); return <td key={r} className="td text-center">{d.ro ? (on ? '✓' : '—') : <form action={permissionToggleAction}><input type="hidden" name="role" value={r} /><input type="hidden" name="key" value={p.key} /><input type="hidden" name="allowed" value={String(!on)} /><button className={`h-7 w-10 rounded border ${on ? 'border-ok bg-green-50 text-ok' : 'border-line text-muted'}`} aria-label={`${r} ${p.key} ${on ? 'allowed' : 'denied'}`}>{on ? '✓' : '—'}</button></form>}</td> })}</tr>)}</>)}</tbody></table></section>
  </Page>
}
