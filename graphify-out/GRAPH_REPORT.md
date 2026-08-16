# Graph Report - DevsFleet POS  (2026-08-16)

## Corpus Check
- 241 files · ~152,345 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 439 nodes · 1050 edges · 62 communities (57 shown, 5 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 1 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `57e6f87f`
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

## God Nodes (most connected - your core abstractions)
1. `primaryId()` - 24 edges
2. `timestamps()` - 24 edges
3. `tenantScope()` - 22 edges
4. `toMinor()` - 19 edges
5. `money()` - 18 edges
6. `TenantDatabase` - 17 edges
7. `add()` - 17 edges
8. `divideRoundHalfUp()` - 17 edges
9. `useAuth()` - 16 edges
10. `toDecimalString()` - 15 edges

## Surprising Connections (you probably didn't know these)
- `testPrint()` --calls--> `hasBridge()`  [INFERRED]
  apps/pos/src/pages/Settings.tsx → apps/pos/src/lib/pos-data.ts

## Communities (62 total, 5 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.05
Nodes (20): BranchesController, BranchesModule, BranchesService, withContext(), configuration(), validateEnv(), DatabaseModule, TenantDatabase (+12 more)

### Community 1 - "Community 1"
Cohesion: 0.24
Nodes (28): abs(), add(), allocate(), allocateByWeight(), divideBy(), divideRoundHalfUp(), equals(), formatMoney() (+20 more)

### Community 2 - "Community 2"
Cohesion: 0.11
Nodes (14): Dialog(), useBarcodeScanner(), useHotkeys(), amount(), money(), parseAmount(), quantity(), roundCash() (+6 more)

### Community 3 - "Community 3"
Cohesion: 0.09
Nodes (14): RootLayout(), loadBranches(), fetchBranches(), handleCreateBranch(), AppShell(), Header(), Sidebar(), apiFetch() (+6 more)

### Community 4 - "Community 4"
Cohesion: 0.1
Nodes (8): AuthController, AuthModule, AuthService, hashToken(), parseDuration(), JwtStrategy, zodPipe(), ZodValidationPipe

### Community 5 - "Community 5"
Cohesion: 0.39
Nodes (9): activeFlag(), money(), percent(), primaryId(), quantity(), softDelete(), syncable(), timestamps() (+1 more)

### Community 6 - "Community 6"
Cohesion: 0.28
Nodes (8): closeDatabase(), getDatabase(), migrate(), openDatabase(), createWindow(), registerHardwareHandlers(), registerSyncHandlers(), stopSyncEngine()

### Community 8 - "Community 8"
Cohesion: 0.44
Nodes (8): AppError, Err(), isErr(), isOk(), mapResult(), Ok(), unwrap(), unwrapOr()

### Community 9 - "Community 9"
Cohesion: 0.56
Nodes (7): normalize(), normalizeBarcode(), normalizeMeasurement(), normalizePhone(), searchKey(), slugify(), truncate()

### Community 11 - "Community 11"
Cohesion: 0.27
Nodes (4): createDbClient(), ping(), withPlatformAdmin(), withTenant()

### Community 12 - "Community 12"
Cohesion: 0.52
Nodes (5): _(), h(), L(), p(), X()

### Community 14 - "Community 14"
Cohesion: 0.57
Nodes (3): formatDocumentNumber(), parseDocumentNumber(), sequenceKey()

### Community 17 - "Community 17"
Cohesion: 0.6
Nodes (3): check(), expectRejected(), scopedRead()

## Knowledge Gaps
- **5 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `TenantDatabase` connect `Community 0` to `Community 4`?**
  _High betweenness centrality (0.011) - this node is a cross-community bridge._
- **Why does `AllExceptionsFilter` connect `Community 10` to `Community 0`?**
  _High betweenness centrality (0.009) - this node is a cross-community bridge._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.05 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.11 - nodes in this community are weakly interconnected._
- **Should `Community 3` be split into smaller, more focused modules?**
  _Cohesion score 0.09 - nodes in this community are weakly interconnected._
- **Should `Community 4` be split into smaller, more focused modules?**
  _Cohesion score 0.1 - nodes in this community are weakly interconnected._