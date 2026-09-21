// Structured internal codes -> messages a user can act on (PRD s49). Never leak SQL or stack traces.
const MESSAGES: Record<string, string> = {
  PERMISSION_DENIED: "You don't have permission to do that.",
  CENTRE_NOT_FOUND: "You don't have permission to access this centre.",
  DISTRICT_NOT_FOUND: "That district doesn't exist or is inactive.",
  REASON_REQUIRED: 'A reason is required.',
  READ_ONLY: 'You are viewing as a centre. This view is read-only.',
  DUPLICATE: 'That code or username is already in use.',
  ONE_CENTRE_ADMIN: 'This centre already has an active Centre Admin. Disable them first.',
  INVALID: 'Some fields are invalid. Check and try again.',
  UNKNOWN: 'Something went wrong. Nothing was saved. Try again.',
}

export function errorCode(e: unknown): keyof typeof MESSAGES {
  const err = e as { code?: string; message?: string; constraint?: string }
  if (err.constraint === 'users_one_centre_admin') return 'ONE_CENTRE_ADMIN'
  if (err.code === '23505') return 'DUPLICATE'
  if (err.code === '23514' || err.code === '22P02') return 'INVALID'
  if (err.code === '42501') return 'PERMISSION_DENIED'
  if (err.message && err.message in MESSAGES) return err.message
  return 'UNKNOWN'
}

export function userMessage(e: unknown): string {
  const code = errorCode(e)
  if (code === 'UNKNOWN') console.error(JSON.stringify({ level: 'error', msg: 'unhandled', error: String(e) }))
  return MESSAGES[code]!
}
