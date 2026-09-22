import { bodyHash, metaChallenge, metaVerified, ok, readRaw, store } from '@/lib/webhooks.ts'
export const GET = (req: Request) => metaChallenge(req)
// Lead Ads leadgen webhook. One event row per leadgen_id; the worker fetches the lead with the page's token.
export async function POST(req: Request) {
  const raw = await readRaw(req); if (raw === null) return ok({ error: 'too large' }, 413)
  if (!metaVerified(raw, req)) return ok({ error: 'bad signature' }, 401)
  let body: { entry?: { changes?: { field?: string; value?: { leadgen_id?: string; page_id?: string; form_id?: string; created_time?: number } }[] }[] }
  try { body = JSON.parse(raw) } catch { return ok({ error: 'bad json' }, 400) }
  let n = 0
  for (const e of body.entry ?? []) for (const c of e.changes ?? []) {
    if (c.field !== 'leadgen' || !c.value?.leadgen_id || !c.value.page_id) continue
    await store('meta_page', c.value.page_id, null, 'meta', `meta:leadgen:${c.value.leadgen_id}`, c.value, c.value.leadgen_id); n++
  }
  if (!n) await store('meta_page', body.entry?.[0]?.changes?.[0]?.value?.page_id ?? 'unknown', null, 'meta', `meta:raw:${bodyHash(raw)}`, body).catch(() => null)
  return ok({ received: n })
}
