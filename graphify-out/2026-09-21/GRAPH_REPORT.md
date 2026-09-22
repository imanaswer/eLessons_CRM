# Graph Report - CRM_eLessons  (2026-09-21)

## Corpus Check
- 41 files · ~12,544 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 185 nodes · 294 edges · 14 communities (11 shown, 3 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 1 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `494ba28b`
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

## God Nodes (most connected - your core abstractions)
1. `tenant()` - 22 edges
2. `compilerOptions` - 19 edges
3. `scripts` - 9 edges
4. `hashPassword()` - 9 edges
5. `login()` - 8 edges
6. `run()` - 7 edges
7. `can()` - 7 edges
8. `impersonateAction()` - 6 edges
9. `createUserAction()` - 6 edges
10. `changePasswordAction()` - 6 edges

## Surprising Connections (you probably didn't know these)
- `seed()` --calls--> `hashPassword()`  [EXTRACTED]
  scripts/seed.ts → src/lib/password.ts
- `Audit()` --calls--> `tenant()`  [EXTRACTED]
  src/app/(app)/admin/audit/page.tsx → src/lib/session.ts
- `Dashboard()` --calls--> `tenant()`  [EXTRACTED]
  src/app/(app)/page.tsx → src/lib/session.ts
- `LoginPage()` --indirect_call--> `loginAction()`  [INFERRED]
  src/app/login/page.tsx → src/app/login/actions.ts
- `as()` --calls--> `login()`  [EXTRACTED]
  tests/isolation.test.ts → src/lib/auth-core.ts

## Import Cycles
- None detected.

## Communities (14 total, 3 thin omitted)

### Community 0 - "actions.ts"
Cohesion: 0.14
Nodes (26): centreSchema, changePasswordAction(), createCentreAction(), createDistrictAction(), createUserAction(), deactivateCentreAction(), districtSchema, FormState (+18 more)

### Community 1 - "README.md"
Cohesion: 0.06
Nodes (25): Ambiguities resolved (safest option, configurable, not invented business rules), Architecture, Assessment of the starting point, Decisions and why, Planned, not built (design fixed now so later phases don't fight it), Shape, Applied (Phase 0), Database (+17 more)

### Community 2 - "scripts"
Cohesion: 0.07
Nodes (29): dependencies, next, pg, react, react-dom, server-only, zod, devDependencies (+21 more)

### Community 3 - "auth-core.ts"
Cohesion: 0.17
Nodes (19): DISTRICTS, seed(), claimsForToken(), dummyHash, login(), LoginResult, logout(), setImpersonation() (+11 more)

### Community 4 - "compilerOptions"
Cohesion: 0.09
Nodes (22): compilerOptions, allowImportingTsExtensions, allowJs, erasableSyntaxOnly, esModuleInterop, incremental, isolatedModules, jsx (+14 more)

### Community 5 - "session.ts"
Cohesion: 0.26
Nodes (7): Audit(), Dashboard(), loginAction(), schema, LoginPage(), clientIp(), setSessionCookie()

### Community 6 - "Security"
Cohesion: 0.33
Nodes (6): Audit, Authentication, Authorization, Not yet implemented — must not be claimed, Security, Tenant isolation

### Community 7 - "migrate.ts"
Cohesion: 0.50
Nodes (3): db, done, test

### Community 9 - "errors.ts"
Cohesion: 0.67
Nodes (3): errorCode(), MESSAGES, userMessage()

## Knowledge Gaps
- **89 isolated node(s):** `config`, `name`, `private`, `type`, `node` (+84 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **3 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `tenant()` connect `actions.ts` to `auth-core.ts`, `session.ts`?**
  _High betweenness centrality (0.026) - this node is a cross-community bridge._
- **What connects `NOTE: This file should not be edited`, `config`, `name` to the rest of the system?**
  _90 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `actions.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.13781512605042018 - nodes in this community are weakly interconnected._
- **Should `README.md` be split into smaller, more focused modules?**
  _Cohesion score 0.058823529411764705 - nodes in this community are weakly interconnected._
- **Should `scripts` be split into smaller, more focused modules?**
  _Cohesion score 0.06666666666666667 - nodes in this community are weakly interconnected._
- **Should `compilerOptions` be split into smaller, more focused modules?**
  _Cohesion score 0.08695652173913043 - nodes in this community are weakly interconnected._