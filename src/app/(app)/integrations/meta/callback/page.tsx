import { cookies, headers } from 'next/headers'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { encrypt } from '@/lib/crypto.ts'
import { exchangeCode, listPages, MetaError } from '@/lib/meta.ts'
import { tenant } from '@/lib/session.ts'
import { pickPageAction } from './actions.ts'
// OAuth callback: exchange code -> long-lived user token -> list pages. The user picks ONE page; its page token is stored encrypted.
// Not verified against live Meta (NEEDED.md).
export default async function MetaCallback({ searchParams }: { searchParams: Promise<{ code?: string; state?: string; error_description?: string }> }) {
  const sp = await searchParams
  const raw = (await cookies()).get('meta_oauth')?.value
  const saved = raw ? (JSON.parse(raw) as { state: string; connId: string }) : null
  if (!saved || !sp.state || sp.state !== saved.state) redirect('/integrations')
  if (sp.error_description || !sp.code) return <Fail msg={sp.error_description ?? 'Facebook did not return an authorisation code.'} />
  const h = await headers(); const redirectUri = `${process.env.APP_URL ?? `${h.get('x-forwarded-proto') ?? 'http'}://${h.get('host')}`}/integrations/meta/callback`
  try {
    const tok = await exchangeCode(fetch, sp.code, redirectUri)
    const pages = await listPages(fetch, tok.access_token)
    // page tokens are held server-side in the pending connection's config (encrypted) until one is chosen
    await tenant((db) => db.query('select app.update_connection($1, $2)', [saved.connId, JSON.stringify({ config: { pages: pages.map((p) => ({ id: p.id, name: p.name, business: p.business?.id ?? null, token_enc: encrypt(p.access_token) })), user_token_expires_in: tok.expires_in ?? null } })]))
    if (!pages.length) return <Fail msg="This Facebook account manages no pages. Sign in with an account that is an admin of the centre's page." />
    return <main className="mx-auto max-w-lg space-y-4 p-6"><h1 className="text-xl font-semibold">Choose the page for this centre</h1>
      <form action={pickPageAction} className="panel divide-y divide-line"><input type="hidden" name="connection_id" value={saved.connId} />{pages.map((p) => <label key={p.id} className="flex cursor-pointer items-center gap-3 p-3 text-sm"><input type="radio" name="page_id" value={p.id} required /><span className="font-medium">{p.name}</span><span className="text-muted">{p.id}</span></label>)}
        <div className="p-3"><button className="btn btn-primary">Connect this page</button></div></form>
      <p className="text-xs text-muted">Next: forms sync and the leadgen webhook subscription happen automatically.</p></main>
  } catch (e) { return <Fail msg={e instanceof MetaError ? e.message : 'Could not talk to Facebook. Try again.'} /> }
}
function Fail({ msg }: { msg: string }) { return <main className="mx-auto max-w-lg p-6"><div className="panel p-6"><h1 className="font-semibold">Connection failed</h1><p className="mt-1 text-sm text-danger">{msg}</p><Link href="/integrations" className="btn btn-quiet mt-4">Back to integrations</Link></div></main> }
