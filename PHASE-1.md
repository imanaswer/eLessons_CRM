# Phase 1 checklist: lead tracking core

Ticked only when database + backend + authorization + UI + validation + errors + tests + audit exist (brief s54).

## Database
- [ ] `inbound_events` with idempotency key, retry, dead-letter, replay (IN-1, brief s8)
- [ ] `parent_identities` → centre `leads` → `students`; `lead_phones` (brief s6, LT-2)
- [ ] `leads` not writable or readable directly by `authenticated`; gate function is the only writer (PRD s13)
- [ ] `activities` append-only + projection updated in the same transaction + rebuild (AL-1..3)
- [ ] `dispositions` as config with the 14 seeds (TE-1)
- [ ] `tasks` with user/system origin (WS-10, TE-3)
- [ ] `dnc`, `consents`, `conflicts`, `lists`, `list_members`, `transfers`, `import_batches`, `export_jobs`
## Backend
- [ ] Gate: dedupe in centre, DNC, cross-centre conflict, source + consent stamp, owner assignment, activity (LT-3..8, AS-1)
- [ ] Disposition engine drives lifecycle; no manual lifecycle edits (TE-1, TE-4)
- [ ] Assign, bulk assign; transfer, bulk transfer with custody chain; `origin_centre_id` immutable (AS-7, TR-1..3)
- [ ] Worker: process pending events with backoff, dead-letter; run exports under the requester's RLS
- [ ] CSV/XLSX import with mapping, per-outcome report, batch becomes a list (LT-6, LS-3)
- [ ] Async export, audited, phone masking independent of export permission (RP-9, RP-10)
- [ ] Privacy toggles enforced in SQL: mask phone, hide source, hide prior activity (TEN-8)
## UI
- [ ] Phone-first add-lead form (LT-1)
- [ ] Lead list: Active / Worked, search, filters, keyset pagination, bulk actions (WS-1, WS-15)
- [ ] Lead drawer: left rail + timeline + action menu (WS-5..7), call outcome in ≤3 taps (WS-9)
- [ ] HQ: conflict queue, failed inbound events with replay, DNC registry, imports, exports
## Tests
- [ ] PRD s50 critical test on real leads: GET, UPDATE, DELETE, EXPORT, SEARCH, FILTER, direct call — all fail for Centre B; HQ succeeds
- [ ] Ingestion, dedupe, DNC, consent, conflicts, idempotency, retry, replay, lifecycle, dispositions, follow-ups, transfers, exports, audit
