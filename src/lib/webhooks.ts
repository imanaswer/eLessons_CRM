// Webhook handlers do one thing: verify, store raw via app.receive_external_event, answer 200 (PRD s13). Processing is the worker's.
import { createHash } from 'node:crypto'
import { pool } from './db.ts'
import { sha256, verifyMetaSignature } from './crypto.ts'

export const RAW_LIMIT = 1024 * 1024
export async function readRaw(req: Request): Promise<string | null> {
  const raw = await req.text()
  return raw.length > RAW_LIMIT ? null : raw
}
export const bodyHash = (raw: string) => createHash('sha256').update(raw).digest('hex')

export async function store(kind: string, externalId: string | null, apiKeyHash: string | null, channel: string, idempotencyKey: string, payload: unknown, eventExternalId: string | null = null) {
  const { rows: [r] } = await pool.query('select app.receive_external_event($1,$2,$3,$4,$5,$6,$7) as id', [kind, externalId, apiKeyHash, channel, idempotencyKey, JSON.stringify(payload), eventExternalId])
  return r?.id as string | null
}
export const ok = (body: unknown = { ok: true }, status = 200) => Response.json(body, { status })
export const metaVerified = (raw: string, req: Request) => verifyMetaSignature(raw, req.headers.get('x-hub-signature-256'), process.env.META_APP_SECRET ?? '')
export const bearerHash = (req: Request) => { const m = /^Bearer\s+(\S+)$/.exec(req.headers.get('authorization') ?? ''); return m ? sha256(m[1]!) : null }
// Meta subscription handshake (GET)
export function metaChallenge(req: Request) {
  const u = new URL(req.url)
  return u.searchParams.get('hub.mode') === 'subscribe' && u.searchParams.get('hub.verify_token') === process.env.META_VERIFY_TOKEN && process.env.META_VERIFY_TOKEN
    ? new Response(u.searchParams.get('hub.challenge') ?? '', { status: 200 }) : new Response('Forbidden', { status: 403 })
}
