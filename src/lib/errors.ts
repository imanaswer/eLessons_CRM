// Structured internal codes -> messages a user can act on (PRD s49). Never leak SQL or stack traces.
const MESSAGES: Record<string, string> = {
  PERMISSION_DENIED: "You don't have permission to do that.",
  CENTRE_NOT_FOUND: "You don't have permission to access this centre.",
  DISTRICT_NOT_FOUND: "That district doesn't exist or is inactive.",
  REASON_REQUIRED: 'A reason is required.',
  READ_ONLY: 'You are viewing as a centre. This view is read-only.',
  DUPLICATE: 'That code or username is already in use.',
  ONE_CENTRE_ADMIN: 'This centre already has an active Centre Admin. Disable them first.',
  LEAD_NOT_FOUND: "That lead doesn't exist or you don't have access to it.",
  LEAD_CLOSED: 'This lead is closed. Record a repeat enquiry to reopen it.',
  LEAD_ERASED: 'This lead was erased and can no longer be changed.',
  NOTE_REQUIRED: 'A note is required for this outcome.',
  FOLLOWUP_REQUIRED: 'Pick a date and time for the call back.',
  FOLLOWUP_IN_PAST: 'The follow-up time must be in the future.',
  OWNER_NOT_IN_CENTRE: "That user can't own this lead: they are not an active user of the lead's centre.",
  EXPORT_DENIED: "You don't have permission to export leads.",
  DISPOSITION_NOT_FOUND: 'That outcome is no longer available. Refresh and try again.',
  EVENT_NOT_FOUND: 'Something went wrong. Nothing was saved. Try again.',
  INVALID_PHONE: "That doesn't look like a valid phone number. Include the country code for numbers outside your country.",
  DNC: 'This number is on the Do Not Contact list. It was not saved.',
  INVALID: 'Some fields are invalid. Check and try again.',
  UNKNOWN: 'Something went wrong. Nothing was saved. Try again.',
}

export function errorCode(e: unknown): keyof typeof MESSAGES {
  const err = e as { code?: string; message?: string; constraint?: string }
  if (err.constraint === 'users_one_centre_admin') return 'ONE_CENTRE_ADMIN'
  const named = err.message?.split(':')[0]           // our own codes win over generic SQLSTATE mapping
  if (named && named in MESSAGES) return named
  if (err.code === '23505') return 'DUPLICATE'
  if (err.code === '23514' || err.code === '22P02') return 'INVALID'
  if (err.code === '42501') return 'PERMISSION_DENIED'
  return 'UNKNOWN'
}

export function userMessage(e: unknown): string {
  const code = errorCode(e)
  if (code === 'UNKNOWN') console.error(JSON.stringify({ level: 'error', msg: 'unhandled', error: String(e) }))
  return MESSAGES[code]!
}
