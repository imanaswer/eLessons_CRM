# Testing

`pnpm test` resets `elessons_test`, applies all migrations, seeds, and runs `tests/**/*.test.ts` with `node:test`. Run it on every deploy (PRD s14).

The suite connects as `elessons_app`, not the owner, and its first test asserts that. It covers: Centre B vs Centre A (get, search, filter, list, update, delete, insert, user management, privilege escalation, secrets, other centres' audit rows, no-claims), positive access for Centre Admin / District Manager / HQ, centre-code login, lockout, logout, instant revocation on user disable and centre deactivation, read-only impersonation with audited start/end, and audit immutability.

Mutation check performed once by hand: replacing `app.can_see` with `select true` makes 7 tests fail.

Not covered yet: browser-level UI tests, server-action input fuzzing, load tests. Every later phase adds its tables to the isolation suite (lead export/search/direct-API cases from PRD s50 land with `leads` in Phase 1).
