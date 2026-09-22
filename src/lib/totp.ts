// TEN-9: TOTP for Superadmin / HQ Admin (any role can opt in). Secret stored encrypted; verified per session.
import { Secret, TOTP } from 'otpauth'
import { toDataURL } from 'qrcode'
import { authQuery } from './db.ts'
import { decrypt, encrypt, sha256 } from './crypto.ts'

const totp = (secret: string, label: string) => new TOTP({ issuer: 'eLessons CRM', label, algorithm: 'SHA1', digits: 6, period: 30, secret: Secret.fromBase32(secret) })

export async function beginSetup(userId: string, label: string) {
  const secret = new Secret({ size: 20 }).base32
  await authQuery('select app.auth_set_totp($1, $2, false)', [userId, encrypt(secret)])
  return { secret, qr: await toDataURL(totp(secret, label).toString()) }
}
export async function verify(userId: string, code: string, label: string): Promise<boolean> {
  const [row] = await authQuery<{ secret_enc: string | null }>('select secret_enc from app.auth_totp_secret($1)', [userId])
  if (!row?.secret_enc) return false
  return totp(decrypt(row.secret_enc), label).validate({ token: code.replace(/\s/g, ''), window: 1 }) !== null
}
export const confirmSetup = async (userId: string, code: string, label: string) => {
  if (!(await verify(userId, code, label))) return false
  const [row] = await authQuery<{ secret_enc: string }>('select secret_enc from app.auth_totp_secret($1)', [userId])
  await authQuery('select app.auth_set_totp($1, $2, true)', [userId, row!.secret_enc])
  return true
}
export const markSessionVerified = (token: string) => authQuery('select app.auth_mark_totp($1)', [sha256(token)])
