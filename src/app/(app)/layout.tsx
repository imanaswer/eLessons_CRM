import Link from 'next/link'
import { perms, requireClaims, tenant } from '@/lib/session.ts'
import { impersonateAction, logoutAction } from './actions.ts'
import { NAV } from './nav.ts'
import { Pwa } from '@/components/pwa.tsx'

const ROLE_LABEL: Record<string, string> = { SUPERADMIN: 'Superadmin', HQ_ADMIN: 'HQ Admin', HQ_COUNSELLOR: 'HQ Counsellor', DISTRICT_MANAGER: 'District Manager', CENTRE_ADMIN: 'Centre Admin', COUNSELLOR: 'Counsellor' }

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const claims = await requireClaims()
  const { scope, nav, unread } = await tenant(async (db) => {
    const keys = [...new Set(NAV.map((n) => n.perm).filter((k): k is string => !!k))]
    const p = await perms(db, keys)
    const { rows: [s] } = await db.query<{ label: string }>(
      `select coalesce((select code || ' · ' || name from centres where id = app.centre_id()), (select code || ' · ' || name from districts where id = app.district_id()), (select name from orgs where id = app.org_id())) as label`)
    const { rows: [u] } = await db.query<{ n: number }>('select count(*)::int n from notifications where read_at is null')
    return { scope: s?.label ?? '', unread: u!.n, nav: NAV.filter((n) => (!n.perm || p[n.perm]) && (!n.roles || n.roles.includes(claims.role))) }
  })
  const groups = [['main', ''], ['secondary', ''], ['admin', 'Admin']] as const
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[14rem_1fr]">
      {claims.read_only && (
        <form action={impersonateAction} className="sticky top-0 z-30 flex items-center justify-center gap-3 bg-warn px-4 py-1.5 text-sm font-medium text-white lg:col-span-2">
          <span>Viewing as {claims.impersonating_centre_code} — read-only. Every action is audited.</span>
          <button className="rounded border border-white/60 px-2 py-0.5 text-xs hover:bg-white/10">Exit</button>
        </form>
      )}
      <aside className="border-b border-line bg-surface lg:sticky lg:top-0 lg:h-dvh lg:overflow-y-auto lg:border-b-0 lg:border-r">
        <div className="flex items-center gap-3 px-4 py-3">
          <Link href="/" className="font-semibold tracking-tight">eLessons CRM</Link>
          <span className="chip ml-auto truncate text-muted lg:hidden">{scope}</span>
        </div>
        <nav aria-label="Primary" className="flex gap-1 overflow-x-auto px-3 pb-2 lg:block lg:pb-4">
          {groups.map(([g, title]) => {
            const items = nav.filter((n) => n.group === g); if (!items.length) return null
            return <div key={g} className="contents lg:block lg:mt-3">
              {title && <p className="hidden px-2.5 pb-1 text-[11px] font-medium uppercase tracking-wider text-muted lg:block">{title}</p>}
              {items.map((n) => <Link key={n.href} href={n.href} className="block whitespace-nowrap rounded-md px-2.5 py-1.5 text-sm text-muted hover:bg-canvas hover:text-ink">{n.label}</Link>)}
            </div>
          })}
        </nav>
      </aside>
      <div className="min-w-0">
        <header className="flex items-center gap-3 border-b border-line bg-surface px-4 py-2 text-sm">
          <span className="chip hidden text-muted lg:inline-flex">{scope}</span>
          <div className="ml-auto flex items-center gap-3">
            <Pwa />
            <Link href="/notifications" className="btn btn-quiet relative h-8" aria-label={`${unread} unread notifications`}>Alerts{unread > 0 && <span className="ml-1 rounded-full bg-brand px-1.5 text-xs text-white">{unread}</span>}</Link>
            <Link href="/account" className="hidden text-right leading-tight sm:block"><span className="block font-medium">{claims.display_name}</span><span className="block text-xs text-muted">{ROLE_LABEL[claims.role]}</span></Link>
            <form action={logoutAction}><button className="btn btn-quiet h-8">Sign out</button></form>
          </div>
        </header>
        <main className="mx-auto max-w-7xl px-4 py-5">
          {claims.must_change_password && <p className="mb-4 rounded-md border border-line bg-amber-50 px-3 py-2 text-sm text-warn">You are using a temporary password. <Link href="/account" className="font-medium underline">Change it now</Link>.</p>}
          {children}
        </main>
      </div>
    </div>
  )
}
