# Graph Report - CRM_eLessons  (2026-09-22)

## Corpus Check
- 124 files · ~89,894 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 535 nodes · 1454 edges · 26 communities (23 shown, 3 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 11 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `6de511e1`
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
- `secret()` --calls--> `decrypt()`  [EXTRACTED]
  worker/index.ts → src/lib/crypto.ts

## Import Cycles
- None detected.

## Communities (26 total, 3 thin omitted)

### Community 0 - "actions.ts"
Cohesion: 0.09
Nodes (36): centreSchema, changePasswordAction(), createCentreAction(), createDistrictAction(), createUserAction(), deactivateCentreAction(), districtSchema, impersonateAction() (+28 more)

### Community 1 - "README.md"
Cohesion: 0.22
Nodes (3): Integrations, Migration from Salesmax, Testing

### Community 2 - "scripts"
Cohesion: 0.05
Nodes (37): dependencies, libphonenumber-js, next, otpauth, pg, qrcode, react, react-dom (+29 more)

### Community 3 - "auth-core.ts"
Cohesion: 0.09
Nodes (48): DISTRICTS, seed(), seedLeads(), Claims, g, Role, withTenant(), applyMapping() (+40 more)

### Community 4 - "compilerOptions"
Cohesion: 0.09
Nodes (22): compilerOptions, allowImportingTsExtensions, allowJs, erasableSyntaxOnly, esModuleInterop, incremental, isolatedModules, jsx (+14 more)

### Community 5 - "session.ts"
Cohesion: 0.06
Nodes (93): Audit(), Automation(), TRIGGERS, Broadcasts(), Config(), DAYS, Dnc(), Health() (+85 more)

### Community 6 - "Security"
Cohesion: 0.07
Nodes (33): AppLayout(), ROLE_LABEL, LeadDrawer(), Leads(), LIFECYCLE_CHIP, Row, SaveViewBar(), saveViewAction() (+25 more)

### Community 7 - "migrate.ts"
Cohesion: 0.50
Nodes (3): db, done, test

### Community 9 - "errors.ts"
Cohesion: 0.08
Nodes (39): RFC-4180, FormState, Conflicts(), addLeadAction(), bulk, bulkAction(), callOutcomeAction(), checkPhoneAction() (+31 more)

### Community 14 - "crypto.ts"
Cohesion: 0.22
Nodes (23): POST(), GET(), POST(), ADAPTERS, POST(), POST(), GET(), POST() (+15 more)

### Community 15 - "meta.ts"
Cohesion: 0.18
Nodes (19): metaStartAction(), pickPageAction(), MetaCallback(), call(), DEFAULT_MAPPING, exchangeCode(), fetchLead(), fetchSpend() (+11 more)

### Community 16 - "totp.ts"
Cohesion: 0.22
Nodes (15): enableTotpAction(), Account(), TotpForm(), TwoFactor(), totpAction(), encrypt(), sha256(), authQuery() (+7 more)

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
Cohesion: 0.50
Nodes (4): eLessons CRM, Local setup, Troubleshooting, Webhook endpoints

## Knowledge Gaps
- **158 isolated node(s):** `config`, `name`, `private`, `type`, `node` (+153 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **3 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `tenant()` connect `session.ts` to `actions.ts`, `auth-core.ts`, `Security`, `errors.ts`, `crypto.ts`, `meta.ts`, `totp.ts`?**
  _High betweenness centrality (0.212) - this node is a cross-community bridge._
- **Why does `withTenant()` connect `auth-core.ts` to `actions.ts`, `session.ts`?**
  _High betweenness centrality (0.031) - this node is a cross-community bridge._
- **Why does `sha256()` connect `totp.ts` to `auth-core.ts`, `session.ts`, `crypto.ts`?**
  _High betweenness centrality (0.015) - this node is a cross-community bridge._
- **What connects `NOTE: This file should not be edited`, `config`, `name` to the rest of the system?**
  _159 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `actions.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.09158186864014801 - nodes in this community are weakly interconnected._
- **Should `scripts` be split into smaller, more focused modules?**
  _Cohesion score 0.05263157894736842 - nodes in this community are weakly interconnected._
- **Should `auth-core.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.09265536723163842 - nodes in this community are weakly interconnected._