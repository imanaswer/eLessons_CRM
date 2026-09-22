# Graph Report - CRM_eLessons  (2026-09-22)

## Corpus Check
- 129 files · ~92,569 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 564 nodes · 1518 edges · 29 communities (27 shown, 2 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 11 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `34f6327c`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- actions.ts
- README.md
- scripts
- auth-core.ts
- compilerOptions
- session.ts
- Security
- migrate.ts
- layout.tsx
- errors.ts
- next.config.ts
- next-env.d.ts
- error.tsx
- crypto.ts
- meta.ts
- totp.ts
- Security
- Architecture
- NEEDED.md — what G-TEC must supply before this goes live
- Database
- Roadmap and P0 traceability
- Deployment
- Phase 1: lead tracking core — completion record (2026-09-21)
- eLessons CRM
- Design system

## God Nodes (most connected - your core abstractions)
1. `tenant()` - 145 edges
2. `fields()` - 33 edges
3. `run()` - 24 edges
4. `ActionForm()` - 22 edges
5. `Page()` - 21 edges
6. `userMessage()` - 20 edges
7. `compilerOptions` - 19 edges
8. `LocalTime()` - 17 edges
9. `Table()` - 16 edges
10. `decrypt()` - 12 edges

## Surprising Connections (you probably didn't know these)
- `createConnectionAction()` --indirect_call--> `secret()`  [INFERRED]
  src/app/(app)/more-actions.ts → worker/index.ts
- `seed()` --calls--> `hashPassword()`  [EXTRACTED]
  scripts/seed.ts → src/lib/password.ts
- `as()` --calls--> `login()`  [EXTRACTED]
  tests/helpers.ts → src/lib/auth-core.ts
- `as()` --calls--> `claimsForToken()`  [EXTRACTED]
  tests/helpers.ts → src/lib/auth-core.ts
- `processDeliveries()` --calls--> `hmacHex()`  [EXTRACTED]
  worker/index.ts → src/lib/crypto.ts

## Import Cycles
- None detected.

## Communities (29 total, 2 thin omitted)

### Community 0 - "actions.ts"
Cohesion: 0.09
Nodes (38): centreSchema, changePasswordAction(), createCentreAction(), createDistrictAction(), createUserAction(), deactivateCentreAction(), districtSchema, impersonateAction() (+30 more)

### Community 1 - "README.md"
Cohesion: 0.22
Nodes (3): Integrations, Migration from Salesmax, Testing

### Community 2 - "scripts"
Cohesion: 0.05
Nodes (37): dependencies, libphonenumber-js, next, otpauth, pg, qrcode, react, react-dom (+29 more)

### Community 3 - "auth-core.ts"
Cohesion: 0.09
Nodes (50): DISTRICTS, seed(), seedLeads(), decrypt(), Claims, g, Role, withTenant() (+42 more)

### Community 4 - "compilerOptions"
Cohesion: 0.09
Nodes (22): compilerOptions, allowImportingTsExtensions, allowJs, erasableSyntaxOnly, esModuleInterop, incremental, isolatedModules, jsx (+14 more)

### Community 5 - "session.ts"
Cohesion: 0.06
Nodes (93): Audit(), Automation(), TRIGGERS, Broadcasts(), Config(), DAYS, Conflicts(), Dnc() (+85 more)

### Community 6 - "Security"
Cohesion: 0.09
Nodes (30): AppLayout(), LeadDrawer(), Leads(), Row, SaveViewBar(), saveViewAction(), SelectAll(), fmtPhone() (+22 more)

### Community 7 - "migrate.ts"
Cohesion: 0.50
Nodes (3): db, done, test

### Community 8 - "layout.tsx"
Cohesion: 0.33
Nodes (4): geist, metadata, mono, viewport

### Community 9 - "errors.ts"
Cohesion: 0.08
Nodes (43): RFC-4180, FormState, addLeadAction(), bulk, bulkAction(), callOutcomeAction(), checkPhoneAction(), completeTaskAction() (+35 more)

### Community 12 - "error.tsx"
Cohesion: 0.20
Nodes (9): ROLE_LABEL, NAV, savePushAction(), I, Pwa(), CommandPalette(), Item, SideNav() (+1 more)

### Community 14 - "crypto.ts"
Cohesion: 0.27
Nodes (19): POST(), GET(), POST(), ADAPTERS, POST(), POST(), GET(), POST() (+11 more)

### Community 15 - "meta.ts"
Cohesion: 0.17
Nodes (20): metaStartAction(), pickPageAction(), MetaCallback(), encrypt(), call(), DEFAULT_MAPPING, exchangeCode(), fetchLead() (+12 more)

### Community 16 - "totp.ts"
Cohesion: 0.23
Nodes (13): enableTotpAction(), Account(), TotpForm(), TwoFactor(), totpAction(), sha256(), getClaims, requireClaims() (+5 more)

### Community 17 - "Security"
Cohesion: 0.22
Nodes (9): Audit, Authentication, Authorization, Leads (Phase 1), Not yet implemented — must not be claimed, Phases 3-6, Security, Tenant isolation (+1 more)

### Community 18 - "Architecture"
Cohesion: 0.25
Nodes (7): Ambiguities resolved (safest option, configurable, not invented business rules), Architecture, Assessment of the starting point, Decisions and why, Lead core (Phase 1), Planned, not built, Shape

### Community 19 - "NEEDED.md — what G-TEC must supply before this goes live"
Cohesion: 0.25
Nodes (8): 1. Credentials and environment (`.env`, see `.env.example`), 2. Meta / WhatsApp approvals (start now — outside engineering control, gates Phases 3 and 5), 3. Website, LMS and checkout (PRD open questions), 4. Business decisions (each is a setting; placeholders are in place), 5. Salesmax migration (Phase 2 tooling is built; needs the data), 6. Legal and operations (launch requirements per PRD §14), 7. Not built (P2 items; would need their own phase), NEEDED.md — what G-TEC must supply before this goes live

### Community 20 - "Database"
Cohesion: 0.33
Nodes (5): Applied (Phase 0), Database, Queues in Postgres (all `FOR UPDATE SKIP LOCKED`), Rules for every future tenant table, Scale notes (measured, see PHASE-1.md)

### Community 21 - "Roadmap and P0 traceability"
Cohesion: 0.33
Nodes (5): Blocked on G-TEC (PRD open questions), Current implementation (2026-09-22), P0 requirements: status, Plan, Roadmap and P0 traceability

### Community 22 - "Deployment"
Cohesion: 0.40
Nodes (4): Backups, Deployment, Environment for Phases 3-6, Observability

### Community 23 - "Phase 1: lead tracking core — completion record (2026-09-21)"
Cohesion: 0.40
Nodes (4): Database and backend, Measured at 950k leads (local Postgres, warm), Phase 1: lead tracking core — completion record (2026-09-21), UI

### Community 24 - "eLessons CRM"
Cohesion: 0.40
Nodes (5): eLessons CRM, Local setup, Test accounts (development seed only), Troubleshooting, Webhook endpoints

### Community 26 - "Design system"
Cohesion: 0.25
Nodes (7): Color, Controls, Design system, Motion, Patterns, Surfaces and elevation, Type

## Knowledge Gaps
- **169 isolated node(s):** `config`, `name`, `private`, `type`, `node` (+164 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **2 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `tenant()` connect `session.ts` to `actions.ts`, `auth-core.ts`, `Security`, `errors.ts`, `error.tsx`, `meta.ts`, `totp.ts`?**
  _High betweenness centrality (0.197) - this node is a cross-community bridge._
- **Why does `withTenant()` connect `auth-core.ts` to `actions.ts`, `session.ts`?**
  _High betweenness centrality (0.028) - this node is a cross-community bridge._
- **Why does `sha256()` connect `totp.ts` to `auth-core.ts`, `session.ts`, `crypto.ts`?**
  _High betweenness centrality (0.015) - this node is a cross-community bridge._
- **What connects `NOTE: This file should not be edited`, `config`, `name` to the rest of the system?**
  _170 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `actions.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.08843537414965986 - nodes in this community are weakly interconnected._
- **Should `scripts` be split into smaller, more focused modules?**
  _Cohesion score 0.05263157894736842 - nodes in this community are weakly interconnected._
- **Should `auth-core.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.0898995240613432 - nodes in this community are weakly interconnected._