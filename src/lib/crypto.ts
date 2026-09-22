// Secrets at rest (PRD s13 "encrypted columns with a managed key") and webhook signature checks.
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

function key(): Buffer {
  const k = Buffer.from(process.env.ENCRYPTION_KEY ?? '', 'base64')
  if (k.length !== 32) throw new Error('ENCRYPTION_KEY must be 32 random bytes, base64 encoded (openssl rand -base64 32). See NEEDED.md')
  return k
}
// v1.<iv>.<tag>.<ciphertext>  — AES-256-GCM, versioned so the key can be rotated later
export function encrypt(plain: string): string {
  const iv = randomBytes(12), c = createCipheriv('aes-256-gcm', key(), iv)
  const body = Buffer.concat([c.update(plain, 'utf8'), c.final()])
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), body.toString('base64')].join('.')
}
export function decrypt(blob: string): string {
  const [v, iv, tag, body] = blob.split('.')
  if (v !== 'v1' || !iv || !tag || !body) throw new Error('unreadable secret')
  const d = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'))
  d.setAuthTag(Buffer.from(tag, 'base64'))
  return Buffer.concat([d.update(Buffer.from(body, 'base64')), d.final()]).toString('utf8')
}
export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')
export const hmacHex = (secret: string, body: string | Buffer) => createHmac('sha256', secret).update(body).digest('hex')
export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}
// Meta / WhatsApp: X-Hub-Signature-256: sha256=<hex hmac of the RAW body with the app secret>
export const verifyMetaSignature = (raw: string, header: string | null, appSecret: string) =>
  !!header && !!appSecret && safeEqual(header, 'sha256=' + hmacHex(appSecret, raw))
export const newApiKey = () => 'elk_' + randomBytes(24).toString('base64url')
