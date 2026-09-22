# Phase 1: lead tracking core — completion record (2026-09-21)

`[x]` = database + backend + authorization + UI + validation + errors + tests + audit all exist. `[~]` = works, with a stated gap. `[ ]` = not built.

## Database and backend
- [x] `inbound_events`: raw payload first, unique idempotency key, retry with exponential backoff, dead-letter, HQ replay, crashed-worker reclaim (IN-1)
- [x] `parent_identities` → centre `leads` → `students`, `lead_phones`; E.164 with India + Gulf (LT-2)
- [x] `leads` has **no grants at all** for app roles; `app.ingest_lead` is the only writer; reads via `lead_list`
- [x] Gate: DNC, strict in-centre dedupe (race-safe), HQ-only cross-centre conflicts with configurable policy, source + consent stamp, owner assignment (LT-3..8, AS-1)
- [x] `activities` append-only; projection updated in the same transaction; rebuild proven equal (AL-1..3)
- [x] Dispositions as data (14 seeds) driving lifecycle; cadence follow-ups; user-set overrides system-set; attempts exhausted (TE-1..4, TE-7, TE-8)
- [x] Assign / bulk assign; transfer / bulk transfer; custody chain; `origin_centre_id` immutable by trigger (AS-7, TR-1..3)
- [x] Privacy toggles enforced in SQL: mask phone, hide source, hide prior activity, hide other-centre activity, counsellor own/all (TEN-8)
- [x] Bulk import CSV/XLSX: raw rows held → mapping → gate → Success/Duplicate/DNC/Invalid report; batch becomes a list; re-submit is a no-op (LT-6, LS-3)
- [x] Async export run under the requester's RLS, masked unless `exports.unmasked_phone`, requested/completed/downloaded audited (RP-9, RP-10)
- [x] Erasure by anonymisation, audited (PRD s14)
- [~] TE-5 follow-up times are entered and stored in the **lead's** timezone; clamping system-set follow-ups to calling hours is Phase 2
- [~] `creates_deal` is stored on dispositions but does nothing until deals exist (Phase 4)
## UI
- [x] Phone-first add-lead form with double-submit protection (LT-1); existing number opens the existing lead (LT-3)
- [x] Lead list: 11 smart views incl. Active/Worked, search, centre/owner/source/date filters, keyset pagination, row call/WhatsApp, bulk assign/transfer/tag/list/export (WS-1, WS-2, WS-8, WS-15)
- [x] Lead drawer: left rail, timeline tabs (Interactions, Tasks, Activities), call outcome = outcome tap + Save (WS-5..7, WS-9), notes, typed tasks, students, assign, transfer, repeat enquiry, erase
- [x] HQ: conflict queue with resolution, inbound events with retry, DNC registry, imports, exports
- [~] WS-1 configurable columns and per-column filters; WS-3 saved views → Phase 2
- [~] Drawer tabs Opportunities / Conversation / Documents, voice notes, documents, payment link → need deals (4), WhatsApp (5), object storage
- [ ] Dispositions editing screen (table, policies and audit exist; Superadmin edits by SQL for now)
- [ ] WS-14 service worker + push notifications (manifest only)
- [ ] **No screen has been looked at in a browser.** Verified over HTTP: pages render per role, every server action was exercised by posting the rendered forms. Layout at 360 px is unverified.
## Measured at 950k leads (local Postgres, warm)
| | target | measured |
|---|---|---|
| 50-row list, centre / district / HQ | < 1 s | 3 ms / 2 ms / 2 ms |
| HQ Interested + source filter | < 1 s | 130 ms (521 ms cold) |
| Name search centre / HQ, phone search | < 1 s | 16 ms / 17 ms / 2 ms |
| Drawer data | < 500 ms | 15 ms |
| Call outcome save | < 300 ms | 19 ms |
Found and fixed during this measurement: the first design took 4.8 s (centre) and 40 s (HQ). See migration 0013.
