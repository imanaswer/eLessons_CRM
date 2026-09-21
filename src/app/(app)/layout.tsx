import Link from 'next/link'
import { redirect } from 'next/navigation'
import { perms, requireClaims, tenant } from '@/lib/session.ts'
import { impersonateAction, logoutAction } from './actions.ts'

const ROLE_LABEL: Record<string, string> = {
  SUPERADMIN: 'Superadmin', HQ_ADMIN: 'HQ Admin', HQ_COUNSELLOR: 'HQ Counsellor',
  DISTRICT_MANAGER: 'District Manager', CENTRE_ADMIN: 'Centre Admin', COUNSELLOR: 'Counsellor',
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const claims = await requireClaims()
  const { scope, nav } = await tenant(async (db) => {
    const p = await perms(db, ['users.manage', 'centres.manage', 'audit.view', 'leads.export', 'conflicts.resolve', 'inbound.replay', 'dnc.manage'] as const)
    const users = p['users.manage'], centres = p['centres.manage'], audit = p['audit.view'], exp = p['leads.export'], conflicts = p['conflicts.resolve'], replay = p['inbound.replay'], dnc = p['dnc.manage']
    const { rows } = await db.query<{ label: string }>(
      `select coalesce((select code || ' · ' || name from centres where id = app.centre_id()),
                       (select code || ' · ' || name from districts where id = app.district_id()),
                       (select name from orgs where id = app.org_id())) as label`)
    return {
      scope: rows[0]?.label ?? '',
      nav: [
        { href: '/', label: 'Dashboard', show: true },
        { href: '/leads', label: 'Leads', show: true },
        { href: '/exports', label: 'Exports', show: exp },
        { href: '/admin/conflicts', label: 'Conflicts', show: conflicts },
        { href: '/admin/inbound', label: 'Inbound events', show: replay },
        { href: '/admin/dnc', label: 'Do Not Contact', show: dnc },
        { href: '/admin/districts', label: 'Districts', show: centres },
        { href: '/admin/centres', label: 'Centres', show: centres || claims.role === 'DISTRICT_MANAGER' },
        { href: '/admin/users', label: 'Users', show: users },
        { href: '/admin/audit', label: 'Audit log', show: audit },
      ].filter((n) => n.show),
    }
  })
  return (
    <div className="min-h-dvh">
      {claims.read_only && (
        <form action={impersonateAction} className="sticky top-0 z-20 flex items-center justify-center gap-3 bg-warn px-4 py-1.5 text-sm font-medium text-white">
          <span>Viewing as {claims.impersonating_centre_code} — read-only. Every action is audited.</span>
          <button className="rounded border border-white/60 px-2 py-0.5 text-xs hover:bg-white/10">Exit</button>
        </form>
      )}
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-2.5">
          <Link href="/" className="font-semibold tracking-tight">eLessons CRM</Link>
          <span className="chip hidden text-muted sm:inline-flex">{scope}</span>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <Link href="/account" className="hidden text-right leading-tight sm:block">
              <span className="block font-medium">{claims.display_name}</span>
              <span className="block text-xs text-muted">{ROLE_LABEL[claims.role]}</span>
            </Link>
            <form action={logoutAction}><button className="btn btn-quiet">Sign out</button></form>
          </div>
        </div>
        <nav aria-label="Primary" className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-3">
          {nav.map((n) => (
            <Link key={n.href} href={n.href} className="whitespace-nowrap border-b-2 border-transparent px-2.5 py-2 text-sm text-muted hover:border-line hover:text-ink">{n.label}</Link>
          ))}
        </nav>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">
        {claims.must_change_password && <MustChange />}
        {children}
      </main>
    </div>
  )
}

function MustChange() {
  return (
    <p className="mb-4 rounded-md border border-line bg-amber-50 px-3 py-2 text-sm text-warn">
      You are using a temporary password. <Link href="/account" className="font-medium underline">Change it now</Link>.
    </p>
  )
}
