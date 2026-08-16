# Graph Report - DevsFleet POS  (2026-08-16)

## Corpus Check
- 116 files · ~79,599 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 445 nodes · 1074 edges · 68 communities (59 shown, 9 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 18 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `6cfaa2ce`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 14|Community 14]]
- [[_COMMUNITY_Community 15|Community 15]]
- [[_COMMUNITY_Community 16|Community 16]]
- [[_COMMUNITY_Community 17|Community 17]]
- [[_COMMUNITY_Community 18|Community 18]]
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 21|Community 21]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 23|Community 23]]

## God Nodes (most connected - your core abstractions)
1. `primaryId()` - 24 edges
2. `timestamps()` - 24 edges
3. `tenantScope()` - 22 edges
4. `toMinor()` - 21 edges
5. `useAuth()` - 19 edges
6. `money()` - 18 edges
7. `add()` - 18 edges
8. `divideRoundHalfUp()` - 18 edges
9. `TenantDatabase` - 17 edges
10. `toDecimalString()` - 16 edges

## Surprising Connections (you probably didn't know these)
- `testPrint()` --calls--> `hasBridge()`  [INFERRED]
  apps/pos/src/pages/Settings.tsx → apps/pos/src/lib/pos-data.ts
- `LoginPage()` --calls--> `useAuth()`  [INFERRED]
  apps/admin/src/app/login/page.tsx → apps/admin/src/lib/auth-context.tsx
- `Header()` --calls--> `useAuth()`  [INFERRED]
  apps/admin/src/components/layout/header.tsx → apps/admin/src/lib/auth-context.tsx
- `Sidebar()` --calls--> `useAuth()`  [INFERRED]
  apps/admin/src/components/layout/sidebar.tsx → apps/admin/src/lib/auth-context.tsx
- `calculateLine()` --calls--> `toMinor()`  [INFERRED]
  packages/shared-utils/src/totals.ts → packages/shared-utils/src/money.ts

## Communities (68 total, 9 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.25
Nodes (28): abs(), add(), allocate(), allocateByWeight(), divideBy(), divideRoundHalfUp(), equals(), formatMoney() (+20 more)

### Community 1 - "Community 1"
Cohesion: 0.11
Nodes (14): Dialog(), useBarcodeScanner(), useHotkeys(), amount(), money(), parseAmount(), quantity(), roundCash() (+6 more)

### Community 2 - "Community 2"
Cohesion: 0.09
Nodes (14): RootLayout(), loadBranches(), fetchBranches(), handleCreateBranch(), AppShell(), Header(), Sidebar(), apiFetch() (+6 more)

### Community 3 - "Community 3"
Cohesion: 0.1
Nodes (8): AuthController, AuthModule, AuthService, hashToken(), parseDuration(), JwtStrategy, zodPipe(), ZodValidationPipe

### Community 4 - "Community 4"
Cohesion: 0.39
Nodes (9): activeFlag(), money(), percent(), primaryId(), quantity(), softDelete(), syncable(), timestamps() (+1 more)

### Community 5 - "Community 5"
Cohesion: 0.15
Nodes (8): configuration(), validateEnv(), DatabaseModule, PermissionsGuard, HealthModule, RequestContextMiddleware, AppModule, bootstrap()

### Community 7 - "Community 7"
Cohesion: 0.28
Nodes (8): closeDatabase(), getDatabase(), migrate(), openDatabase(), createWindow(), registerHardwareHandlers(), registerSyncHandlers(), stopSyncEngine()

### Community 8 - "Community 8"
Cohesion: 0.18
Nodes (4): withContext(), TenantDatabase, HealthController, withTenant()

### Community 10 - "Community 10"
Cohesion: 0.23
Nodes (7): _(), h(), L(), migrate(), openDatabase(), p(), X()

### Community 11 - "Community 11"
Cohesion: 0.44
Nodes (8): AppError, Err(), isErr(), isOk(), mapResult(), Ok(), unwrap(), unwrapOr()

### Community 12 - "Community 12"
Cohesion: 0.3
Nodes (3): Audited(), Public(), RequirePermissions()

### Community 14 - "Community 14"
Cohesion: 0.22
Nodes (3): createDbClient(), ping(), withPlatformAdmin()

### Community 15 - "Community 15"
Cohesion: 0.56
Nodes (7): normalize(), normalizeBarcode(), normalizeMeasurement(), normalizePhone(), searchKey(), slugify(), truncate()

### Community 18 - "Community 18"
Cohesion: 0.57
Nodes (3): formatDocumentNumber(), parseDocumentNumber(), sequenceKey()

### Community 22 - "Community 22"
Cohesion: 0.6
Nodes (3): check(), expectRejected(), scopedRead()

## Knowledge Gaps
- **9 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `TenantDatabase` connect `Community 8` to `Community 3`, `Community 5`, `Community 6`, `Community 12`, `Community 14`?**
  _High betweenness centrality (0.022) - this node is a cross-community bridge._
- **Why does `AllExceptionsFilter` connect `Community 13` to `Community 5`?**
  _High betweenness centrality (0.010) - this node is a cross-community bridge._
- **Why does `BranchesService` connect `Community 6` to `Community 8`, `Community 12`?**
  _High betweenness centrality (0.009) - this node is a cross-community bridge._
- **Are the 2 inferred relationships involving `toMinor()` (e.g. with `calculateLine()` and `calculateDocument()`) actually correct?**
  _`toMinor()` has 2 INFERRED edges - model-reasoned connections that need verification._
- **Are the 3 inferred relationships involving `useAuth()` (e.g. with `LoginPage()` and `Header()`) actually correct?**
  _`useAuth()` has 3 INFERRED edges - model-reasoned connections that need verification._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.11 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.09 - nodes in this community are weakly interconnected._