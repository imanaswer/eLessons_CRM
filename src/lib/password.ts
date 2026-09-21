// scrypt from node:crypto — no dependency. Format: scrypt$N$r$p$salt$hash (params stored so they can be raised later).
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'

const N = 32768, r = 8, p = 1, KEYLEN = 64

function derive(password: string, salt: Buffer, n: number, rr: number, pp: number): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password.normalize('NFKC'), salt, KEYLEN, { N: n, r: rr, p: pp, maxmem: 128 * n * rr * 2 }, (e, k) => (e ? reject(e) : resolve(k))))
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const key = await derive(password, salt, N, r, p)
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64')}$${key.toString('base64')}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, n, rr, pp, salt, hash] = stored.split('$')
  if (alg !== 'scrypt' || !n || !rr || !pp || !salt || !hash) return false
  const key = await derive(password, Buffer.from(salt, 'base64'), +n, +rr, +pp)
  const expected = Buffer.from(hash, 'base64')
  return key.length === expected.length && timingSafeEqual(key, expected)
}

// PRD s14 "password policy". Length over composition rules (NIST 800-63B).
export function passwordProblem(password: string): string | null {
  if (password.length < 10) return 'Password must be at least 10 characters.'
  if (password.length > 200) return 'Password is too long.'
  return null
}
