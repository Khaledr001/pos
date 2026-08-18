# Graph Report - DevsFleet POS  (2026-08-19)

## Corpus Check
- 250 files · ~192,506 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1200 nodes · 2597 edges · 108 communities (70 shown, 38 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 64 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `17602c8e`
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
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 26|Community 26]]
- [[_COMMUNITY_Community 27|Community 27]]
- [[_COMMUNITY_Community 28|Community 28]]
- [[_COMMUNITY_Community 29|Community 29]]
- [[_COMMUNITY_Community 30|Community 30]]
- [[_COMMUNITY_Community 31|Community 31]]
- [[_COMMUNITY_Community 32|Community 32]]
- [[_COMMUNITY_Community 33|Community 33]]
- [[_COMMUNITY_Community 34|Community 34]]
- [[_COMMUNITY_Community 35|Community 35]]
- [[_COMMUNITY_Community 36|Community 36]]
- [[_COMMUNITY_Community 37|Community 37]]
- [[_COMMUNITY_Community 38|Community 38]]
- [[_COMMUNITY_Community 39|Community 39]]
- [[_COMMUNITY_Community 40|Community 40]]
- [[_COMMUNITY_Community 41|Community 41]]
- [[_COMMUNITY_Community 42|Community 42]]
- [[_COMMUNITY_Community 43|Community 43]]
- [[_COMMUNITY_Community 44|Community 44]]
- [[_COMMUNITY_Community 45|Community 45]]
- [[_COMMUNITY_Community 46|Community 46]]
- [[_COMMUNITY_Community 47|Community 47]]
- [[_COMMUNITY_Community 48|Community 48]]
- [[_COMMUNITY_Community 49|Community 49]]
- [[_COMMUNITY_Community 50|Community 50]]
- [[_COMMUNITY_Community 51|Community 51]]
- [[_COMMUNITY_Community 52|Community 52]]
- [[_COMMUNITY_Community 53|Community 53]]
- [[_COMMUNITY_Community 54|Community 54]]
- [[_COMMUNITY_Community 55|Community 55]]
- [[_COMMUNITY_Community 56|Community 56]]
- [[_COMMUNITY_Community 57|Community 57]]
- [[_COMMUNITY_Community 58|Community 58]]
- [[_COMMUNITY_Community 59|Community 59]]
- [[_COMMUNITY_Community 60|Community 60]]
- [[_COMMUNITY_Community 61|Community 61]]
- [[_COMMUNITY_Community 62|Community 62]]
- [[_COMMUNITY_Community 64|Community 64]]
- [[_COMMUNITY_Community 65|Community 65]]
- [[_COMMUNITY_Community 66|Community 66]]
- [[_COMMUNITY_Community 67|Community 67]]

## God Nodes (most connected - your core abstractions)
1. `TenantDatabase` - 43 edges
2. `useAuth()` - 32 edges
3. `zodPipe()` - 28 edges
4. `getDatabase()` - 27 edges
5. `primaryId()` - 27 edges
6. `timestamps()` - 27 edges
7. `RequirePermissions()` - 25 edges
8. `tenantScope()` - 25 edges
9. `cn()` - 23 edges
10. `toMinor()` - 22 edges

## Surprising Connections (you probably didn't know these)
- `CustomersPage()` --calls--> `useAuth()`  [INFERRED]
  apps/admin/src/app/customers/page.tsx → apps/admin/src/lib/auth-context.tsx
- `InventoryPage()` --calls--> `useAuth()`  [INFERRED]
  apps/admin/src/app/inventory/page.tsx → apps/admin/src/lib/auth-context.tsx
- `SuppliersPage()` --calls--> `useAuth()`  [INFERRED]
  apps/admin/src/app/suppliers/page.tsx → apps/admin/src/lib/auth-context.tsx
- `UsersPage()` --calls--> `useAuth()`  [INFERRED]
  apps/admin/src/app/users/page.tsx → apps/admin/src/lib/auth-context.tsx
- `useIdleTimer()` --calls--> `useAuth()`  [INFERRED]
  apps/pos/src/lib/idle-timer.ts → apps/admin/src/lib/auth-context.tsx

## Communities (108 total, 38 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.05
Nodes (16): CatalogModule, assertBranchInScope(), requireBranchId(), TenantDatabase, Audited(), PlatformOnly(), Public(), RequirePermissions() (+8 more)

### Community 1 - "Community 1"
Cohesion: 0.05
Nodes (48): clearSettledDeltas(), enqueue(), findByBarcode(), findSale(), getOpenCashSession(), getState(), movementTotals(), nextSequence() (+40 more)

### Community 2 - "Community 2"
Cohesion: 0.05
Nodes (22): RootLayout(), loadBranches(), fetchBranches(), handleCreateBranch(), CustomersPage(), InventoryPage(), AppShell(), Header() (+14 more)

### Community 3 - "Community 3"
Cohesion: 0.06
Nodes (61): _(), ApiError, apiUrl(), applyChanges(), applyRecord(), applyTombstone(), authorized(), branchId() (+53 more)

### Community 4 - "Community 4"
Cohesion: 0.25
Nodes (29): abs(), add(), allocate(), allocateByWeight(), divideBy(), divideByQuantity(), divideRoundHalfUp(), equals() (+21 more)

### Community 5 - "Community 5"
Cohesion: 0.09
Nodes (14): ProductsService, seedTenant(), createDbClient(), ping(), withPlatformAdmin(), withTenant(), normalize(), normalizeBarcode() (+6 more)

### Community 6 - "Community 6"
Cohesion: 0.36
Nodes (10): activeFlag(), money(), percent(), primaryId(), quantity(), softDelete(), syncable(), timestamps() (+2 more)

### Community 7 - "Community 7"
Cohesion: 0.07
Nodes (3): DayCloseController, PaintController, PaintService

### Community 8 - "Community 8"
Cohesion: 0.16
Nodes (6): Dialog(), amount(), money(), parseAmount(), quantity(), roundCash()

### Community 9 - "Community 9"
Cohesion: 0.13
Nodes (3): BranchesController, BranchesService, withContext()

### Community 10 - "Community 10"
Cohesion: 0.14
Nodes (6): clearApiTokens(), adminLoginForRegistration(), fetchBranchesForRegistration(), registerDeviceOnServer(), handleLogin(), handleRegister()

### Community 11 - "Community 11"
Cohesion: 0.14
Nodes (6): isAtLimit(), limitFor(), limitMessage(), resolvePlan(), trialStatus(), TenantsController

### Community 12 - "Community 12"
Cohesion: 0.13
Nodes (3): SuppliersController, SuppliersModule, SuppliersService

### Community 13 - "Community 13"
Cohesion: 0.24
Nodes (10): DayCloseModule, InventoryModule, PaintModule, ProductsModule, PurchasesModule, SerialsModule, StockTakeModule, TenantsModule (+2 more)

### Community 14 - "Community 14"
Cohesion: 0.15
Nodes (4): BranchesModule, JwtAuthGuard, PermissionsGuard, RequestContextMiddleware

### Community 15 - "Community 15"
Cohesion: 0.12
Nodes (4): ExpensesController, ExpensesModule, ExpensesService, normaliseCategory()

### Community 18 - "Community 18"
Cohesion: 0.2
Nodes (7): doRefresh(), getAccessToken(), getRefreshToken(), readTokens(), request(), saveTokens(), storeApiTokens()

### Community 19 - "Community 19"
Cohesion: 0.26
Nodes (3): AuthService, hashToken(), parseDuration()

### Community 20 - "Community 20"
Cohesion: 0.14
Nodes (3): DevicesController, DevicesModule, DevicesService

### Community 21 - "Community 21"
Cohesion: 0.21
Nodes (5): isoToday(), marginPercent(), ReportsService, shiftDays(), window()

### Community 23 - "Community 23"
Cohesion: 0.18
Nodes (7): clearPosApiSession(), hasBridge(), handleSignOut(), testPrint(), toggleTheme(), App(), applyTheme()

### Community 24 - "Community 24"
Cohesion: 0.18
Nodes (5): configuration(), validateEnv(), DatabaseModule, AppModule, bootstrap()

### Community 25 - "Community 25"
Cohesion: 0.23
Nodes (5): useIdleTimer(), useBarcodeScanner(), useHotkeys(), push(), submit()

### Community 26 - "Community 26"
Cohesion: 0.44
Nodes (8): AppError, Err(), isErr(), isOk(), mapResult(), Ok(), unwrap(), unwrapOr()

### Community 30 - "Community 30"
Cohesion: 0.24
Nodes (4): handleCreateCustomer(), resetForm(), useCartTotals(), useFloorViolations()

### Community 32 - "Community 32"
Cohesion: 0.33
Nodes (5): CashRegisterModule, CustomersModule, QuotationsModule, SalesModule, SyncModule

### Community 37 - "Community 37"
Cohesion: 0.4
Nodes (3): formatDocumentNumber(), parseDocumentNumber(), sequenceKey()

### Community 47 - "Community 47"
Cohesion: 0.32
Nodes (3): AuthModule, JwtStrategy, PlatformModule

### Community 64 - "Community 64"
Cohesion: 0.6
Nodes (3): check(), expectRejected(), scopedRead()

## Knowledge Gaps
- **38 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `TenantDatabase` connect `Community 0` to `Community 5`, `Community 9`, `Community 12`, `Community 19`, `Community 21`, `Community 24`?**
  _High betweenness centrality (0.039) - this node is a cross-community bridge._
- **Why does `zodPipe()` connect `Community 0` to `Community 65`, `Community 19`, `Community 12`, `Community 9`?**
  _High betweenness centrality (0.035) - this node is a cross-community bridge._
- **Why does `RequirePermissions()` connect `Community 0` to `Community 9`, `Community 12`?**
  _High betweenness centrality (0.022) - this node is a cross-community bridge._
- **Are the 8 inferred relationships involving `useAuth()` (e.g. with `CustomersPage()` and `InventoryPage()`) actually correct?**
  _`useAuth()` has 8 INFERRED edges - model-reasoned connections that need verification._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.05 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.05 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.05 - nodes in this community are weakly interconnected._