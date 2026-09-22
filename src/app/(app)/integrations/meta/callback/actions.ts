'use server'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { decrypt } from '@/lib/crypto.ts'
import { listForms, subscribePage } from '@/lib/meta.ts'
import { tenant } from '@/lib/session.ts'
export async function pickPageAction(form: FormData) {
  const p = z.object({ connection_id: z.uuid(), page_id: z.string().max(40) }).parse(Object.fromEntries(form))
  await tenant(async (db) => {
    const { rows: [c] } = await db.query<{ config: { pages?: { id: string; name: string; business: string | null; token_enc: string }[]; user_token_expires_in: number | null } }>('select config from connection_list where id = $1', [p.connection_id])
    const page = c?.config.pages?.find((x) => x.id === p.page_id)
    if (!page) throw new Error('PERMISSION_DENIED')
    // page tokens from a long-lived user token do not expire; MT-4 still tracks the user token's horizon
    const expires = c!.config.user_token_expires_in ? new Date(Date.now() + c!.config.user_token_expires_in * 1000) : null
    await db.query('select app.connect_meta_page($1,$2,$3,$4,$5,$6)', [p.connection_id, page.id, page.name, page.token_enc, expires, page.business])
    try {
      const token = decrypt(page.token_enc)
      await subscribePage(fetch, page.id, token)
      await db.query('select app.save_forms($1, $2)', [p.connection_id, JSON.stringify(await listForms(fetch, page.id, token))])
      await db.query('select app.connection_result($1, null)', [p.connection_id])
    } catch (e) { await db.query('select app.connection_result($1, $2)', [p.connection_id, String(e)]) }
  })
  ;(await cookies()).delete('meta_oauth')
  redirect('/integrations')
}
