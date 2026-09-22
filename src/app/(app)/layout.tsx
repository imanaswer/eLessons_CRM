import Link from 'next/link'
import { Avatar } from '@/components/ui.tsx'
import { I } from '@/components/icons.tsx'
import { Pwa } from '@/components/pwa.tsx'
import { CommandPalette, SideNav } from '@/components/shell.tsx'
import { perms, requireClaims, tenant } from '@/lib/session.ts'
import { impersonateAction, logoutAction } from './actions.ts'
import { NAV } from './nav.ts'

const ROLE_LABEL: Record<string, string> = { SUPERADMIN: 'Superadmin', HQ_ADMIN: 'HQ Admin', HQ_COUNSELLOR: 'HQ Counsellor', DISTRICT_MANAGER: 'District Manager', CENTRE_ADMIN: 'Centre Admin', COUNSELLOR: 'Counsellor' }

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const claims = await requireClaims()
  const { scope, nav, unread } = await tenant(async (db) => {
    const keys = [...new Set(NAV.map((n) => n.perm).filter((k): k is string => !!k))]
    const p = await perms(db, keys)
    const { rows: [s] } = await db.query<{ label: string }>(`select coalesce((select code || ' · ' || name from centres where id = app.centre_id()), (select code || ' · ' || name from districts where id = app.district_id()), (select name from orgs where id = app.org_id())) as label`)
    const { rows: [u] } = await db.query<{ n: number }>('select count(*)::int n from notifications where read_at is null')
    return { scope: s?.label ?? '', unread: u!.n, nav: NAV.filter((n) => (!n.perm || p[n.perm]) && (!n.roles || n.roles.includes(claims.role))) }
  })
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[15rem_1fr]">
      {claims.read_only && (
        <form action={impersonateAction} className="sticky top-0 z-30 flex items-center justify-center gap-3 bg-warn px-4 py-1.5 text-[13px] font-medium text-white lg:col-span-2">
          <I.alert className="h-4 w-4" /><span>Viewing as {claims.impersonating_centre_code} — read-only. Every action is audited.</span>
          <button className="rounded-md border border-white/50 px-2 py-0.5 text-[12px] transition-colors hover:bg-white/10">Exit</button>
        </form>
      )}
      <aside className="border-b border-line bg-rail lg:sticky lg:top-0 lg:flex lg:h-dvh lg:flex-col lg:border-b-0 lg:border-r">
        <div className="flex items-center gap-2.5 px-4 py-3.5 lg:px-5">
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-[8px] bg-brand text-[12px] font-bold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.2)]">eL</span>
          <div className="min-w-0 leading-tight"><Link href="/" className="block text-[14px] font-semibold tracking-[-0.01em]">eLessons CRM</Link><p className="truncate text-[11.5px] text-muted">{scope}</p></div>
        </div>
        <div className="lg:flex-1 lg:overflow-y-auto"><SideNav items={nav} /></div>
        <div className="hidden items-center gap-2.5 border-t border-line px-4 py-3 lg:flex">
          <Avatar name={claims.display_name} size="sm" />
          <Link href="/account" className="min-w-0 flex-1 leading-tight"><span className="block truncate text-[13px] font-medium">{claims.display_name}</span><span className="block text-[11.5px] text-muted">{ROLE_LABEL[claims.role]}</span></Link>
          <form action={logoutAction}><button className="btn btn-ghost h-8 w-8 px-0" aria-label="Sign out"><I.logout className="h-4 w-4" /></button></form>
        </div>
      </aside>
      <div className="min-w-0">
        <header className="sticky top-0 z-20 flex h-12 items-center gap-2 border-b border-line bg-surface/85 px-4 backdrop-blur lg:px-6">
          <CommandPalette items={nav} />
          <div className="ml-auto flex items-center gap-1.5">
            <Pwa />
            <Link href="/notifications" className="btn btn-ghost relative h-8 gap-1.5 px-2" aria-label={`${unread} unread notifications`}><I.bell className="h-4 w-4" /><span className="hidden sm:inline">Alerts</span>{unread > 0 && <span className="absolute -right-0.5 -top-0.5 min-w-[18px] rounded-full bg-brand px-1 text-center text-[10.5px] font-semibold leading-[18px] text-white">{unread}</span>}</Link>
            <form action={logoutAction} className="lg:hidden"><button className="btn btn-ghost h-8">Sign out</button></form>
          </div>
        </header>
        <main id="main" className="mx-auto max-w-[1400px] px-4 py-5 lg:px-6 lg:py-6">
          {claims.must_change_password && <p className="mb-4 flex items-center gap-2 rounded-[var(--radius-control)] bg-warn-soft px-3 py-2 text-[13px] text-warn"><I.alert className="h-4 w-4" />You are using a temporary password. <Link href="/account" className="font-medium underline">Change it now</Link>.</p>}
          {children}
        </main>
      </div>
    </div>
  )
}
