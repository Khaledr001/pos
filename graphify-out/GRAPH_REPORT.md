# Graph Report - DevsFleet POS  (2026-08-23)

## Corpus Check
- 322 files · ~296,397 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1647 nodes · 3511 edges · 144 communities (96 shown, 48 thin omitted)
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 137 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `76f025be`
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
- [[_COMMUNITY_Community 60|Community 60]]
- [[_COMMUNITY_Community 61|Community 61]]
- [[_COMMUNITY_Community 62|Community 62]]
- [[_COMMUNITY_Community 63|Community 63]]
- [[_COMMUNITY_Community 64|Community 64]]
- [[_COMMUNITY_Community 65|Community 65]]
- [[_COMMUNITY_Community 66|Community 66]]
- [[_COMMUNITY_Community 67|Community 67]]
- [[_COMMUNITY_Community 68|Community 68]]
- [[_COMMUNITY_Community 69|Community 69]]
- [[_COMMUNITY_Community 70|Community 70]]
- [[_COMMUNITY_Community 71|Community 71]]
- [[_COMMUNITY_Community 72|Community 72]]
- [[_COMMUNITY_Community 73|Community 73]]
- [[_COMMUNITY_Community 74|Community 74]]
- [[_COMMUNITY_Community 75|Community 75]]
- [[_COMMUNITY_Community 76|Community 76]]
- [[_COMMUNITY_Community 77|Community 77]]
- [[_COMMUNITY_Community 78|Community 78]]
- [[_COMMUNITY_Community 79|Community 79]]
- [[_COMMUNITY_Community 80|Community 80]]
- [[_COMMUNITY_Community 81|Community 81]]
- [[_COMMUNITY_Community 82|Community 82]]
- [[_COMMUNITY_Community 83|Community 83]]
- [[_COMMUNITY_Community 84|Community 84]]
- [[_COMMUNITY_Community 85|Community 85]]
- [[_COMMUNITY_Community 86|Community 86]]
- [[_COMMUNITY_Community 87|Community 87]]
- [[_COMMUNITY_Community 88|Community 88]]
- [[_COMMUNITY_Community 89|Community 89]]
- [[_COMMUNITY_Community 90|Community 90]]
- [[_COMMUNITY_Community 91|Community 91]]
- [[_COMMUNITY_Community 92|Community 92]]
- [[_COMMUNITY_Community 93|Community 93]]
- [[_COMMUNITY_Community 94|Community 94]]
- [[_COMMUNITY_Community 95|Community 95]]
- [[_COMMUNITY_Community 96|Community 96]]
- [[_COMMUNITY_Community 98|Community 98]]
- [[_COMMUNITY_Community 99|Community 99]]
- [[_COMMUNITY_Community 100|Community 100]]
- [[_COMMUNITY_Community 102|Community 102]]
- [[_COMMUNITY_Community 103|Community 103]]

## God Nodes (most connected - your core abstractions)
1. `TenantDatabase` - 54 edges
2. `assertBranchInScope()` - 53 edges
3. `useAuth()` - 46 edges
4. `getDatabase()` - 38 edges
5. `cn()` - 32 edges
6. `zodPipe()` - 32 edges
7. `RequirePermissions()` - 29 edges
8. `primaryId()` - 27 edges
9. `timestamps()` - 27 edges
10. `StockService` - 26 edges

## Surprising Connections (you probably didn't know these)
- `RequireAuth()` --calls--> `hasPermission()`  [INFERRED]
  apps/admin/src/lib/require-auth.tsx → packages/shared-types/src/permissions.ts
- `renderA4Invoice()` --calls--> `renderTaxDocument()`  [INFERRED]
  apps/pos/electron/hardware/a4-invoice.ts → packages/pdf-documents/src/tax-document.ts
- `applyRow()` --calls--> `searchKey()`  [INFERRED]
  tools/import/src/import-products.ts → packages/shared-utils/src/text.ts
- `DayClosePage()` --calls--> `useAuth()`  [INFERRED]
  apps/admin/src/app/day-close/page.tsx → apps/admin/src/lib/auth-context.tsx
- `DevicesPage()` --calls--> `useAuth()`  [INFERRED]
  apps/admin/src/app/devices/page.tsx → apps/admin/src/lib/auth-context.tsx

## Communities (144 total, 48 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.06
Nodes (24): seedTenant(), createDbClient(), ping(), withPlatformAdmin(), withTenant(), applyRow(), main(), parseArgs() (+16 more)

### Community 1 - "Community 1"
Cohesion: 0.08
Nodes (4): TenantDatabase, PlanLimitService, StorageModule, StorageService

### Community 2 - "Community 2"
Cohesion: 0.25
Nodes (29): abs(), add(), allocate(), allocateByWeight(), divideBy(), divideByQuantity(), divideRoundHalfUp(), equals() (+21 more)

### Community 3 - "Community 3"
Cohesion: 0.36
Nodes (10): activeFlag(), money(), percent(), primaryId(), quantity(), softDelete(), syncable(), timestamps() (+2 more)

### Community 4 - "Community 4"
Cohesion: 0.09
Nodes (5): CashRegisterService, assertBranchInScope(), DevicesService, InventoryService, SerialsService

### Community 5 - "Community 5"
Cohesion: 0.1
Nodes (3): branchScope(), PriceResolverService, SalesService

### Community 6 - "Community 6"
Cohesion: 0.07
Nodes (32): acknowledgeWarning(), applyRecord(), applyTombstone(), clearSettledDeltas(), closeCashSession(), commitReturn(), createCustomer(), customerInfo() (+24 more)

### Community 7 - "Community 7"
Cohesion: 0.08
Nodes (14): commitSale(), enqueue(), findByBarcode(), findSale(), getOpenCashSession(), movementTotals(), nextSequence(), openCashSession() (+6 more)

### Community 8 - "Community 8"
Cohesion: 0.09
Nodes (18): buildReceipt(), createThermalPrinter(), ensureColumns(), findSale(), formatDate(), getPrinterDevicePath(), invoicesDir(), isPrinterReachable() (+10 more)

### Community 9 - "Community 9"
Cohesion: 0.29
Nodes (3): Audited(), RequirePermissions(), zodPipe()

### Community 10 - "Community 10"
Cohesion: 0.06
Nodes (3): PaintController, PaintService, PurchasesController

### Community 11 - "Community 11"
Cohesion: 0.09
Nodes (6): cn(), DayClosePage(), money(), DevicesPage(), cn(), Badge()

### Community 12 - "Community 12"
Cohesion: 0.11
Nodes (6): ensureColumns(), migrate(), openDatabase(), seedInitialCatalog(), baseReturnDraft(), returnDraft()

### Community 13 - "Community 13"
Cohesion: 0.1
Nodes (6): requireBranchId(), DayCloseService, today(), ExpensesService, normaliseCategory(), today()

### Community 14 - "Community 14"
Cohesion: 0.09
Nodes (4): assertMayGrantAbac(), assertMayGrantPermissions(), RolesService, UsersService

### Community 15 - "Community 15"
Cohesion: 0.15
Nodes (6): Dialog(), amount(), money(), parseAmount(), quantity(), roundCash()

### Community 16 - "Community 16"
Cohesion: 0.11
Nodes (7): HeldCartsService, hasPermission(), isAtLimit(), limitFor(), limitMessage(), resolvePlan(), trialStatus()

### Community 17 - "Community 17"
Cohesion: 0.12
Nodes (8): BranchesModule, configuration(), validateEnv(), DatabaseModule, PermissionsGuard, RequestContextMiddleware, AppModule, bootstrap()

### Community 18 - "Community 18"
Cohesion: 0.16
Nodes (13): getState(), setState(), renderA4Invoice(), invoicesDir(), saveAndOpenA4(), createThermalPrinter(), getPrinterDevicePath(), isPrinterReachable() (+5 more)

### Community 19 - "Community 19"
Cohesion: 0.14
Nodes (9): loadBranches(), CustomersPage(), InventoryPage(), Header(), Sidebar(), useAuth(), RequireAuth(), SuppliersPage() (+1 more)

### Community 21 - "Community 21"
Cohesion: 0.12
Nodes (7): ReportsController, ReportsModule, isoToday(), marginPercent(), ReportsService, shiftDays(), window()

### Community 22 - "Community 22"
Cohesion: 0.15
Nodes (22): apiUrl(), applyChanges(), authorized(), authorizedRequest(), branchId(), businessInfo(), deviceId(), ensureAccessToken() (+14 more)

### Community 23 - "Community 23"
Cohesion: 0.14
Nodes (4): BranchesService, withContext(), Public(), JwtAuthGuard

### Community 24 - "Community 24"
Cohesion: 0.15
Nodes (10): apply(), commit(), handleCreateCustomer(), resetForm(), pickTierPrice(), scaledFloor(), scaledListPrice(), scaledTierPrice() (+2 more)

### Community 25 - "Community 25"
Cohesion: 0.2
Nodes (10): CatalogModule, PlatformGuard, InventoryModule, PaintModule, ProductsModule, PurchasesModule, SerialsModule, StockTakeModule (+2 more)

### Community 28 - "Community 28"
Cohesion: 0.22
Nodes (15): ApiError, apiUrl(), authorized(), authorizedRequest(), branchId(), deviceId(), ensureAccessToken(), forgetTokens() (+7 more)

### Community 30 - "Community 30"
Cohesion: 0.15
Nodes (4): useIdleTimer(), hasBridge(), handleReceive(), loadTransfers()

### Community 31 - "Community 31"
Cohesion: 0.19
Nodes (5): AuthService, hashToken(), lockoutRemaining(), parseDuration(), randomBytes()

### Community 32 - "Community 32"
Cohesion: 0.14
Nodes (10): clearPosApiSession(), acknowledgeItem(), discardItem(), handleSignOut(), refreshAttention(), retryItem(), testPrint(), toggleTheme() (+2 more)

### Community 33 - "Community 33"
Cohesion: 0.19
Nodes (8): apiDownload(), apiFetch(), clearSession(), getBaseUrl(), login(), refreshAccessToken(), saveBlob(), AuthProvider()

### Community 34 - "Community 34"
Cohesion: 0.14
Nodes (4): AuthController, AuthModule, JwtStrategy, PlatformModule

### Community 36 - "Community 36"
Cohesion: 0.15
Nodes (6): renderQuotationPdf(), renderInvoicePdf(), formatDate(), formatTime(), renderTaxDocument(), safeZone()

### Community 37 - "Community 37"
Cohesion: 0.23
Nodes (7): CashRegisterModule, OrdersModule, PricingModule, QuotationsModule, SalesModule, SyncController, SyncModule

### Community 39 - "Community 39"
Cohesion: 0.14
Nodes (3): PricingService, sameAmount(), today()

### Community 40 - "Community 40"
Cohesion: 0.12
Nodes (3): SuppliersController, SuppliersModule, SuppliersService

### Community 41 - "Community 41"
Cohesion: 0.14
Nodes (13): base64_decode(), compare(), _crypt(), decodeBase64(), _ekskey(), _encipher(), genSalt(), hash() (+5 more)

### Community 42 - "Community 42"
Cohesion: 0.18
Nodes (12): clearSettledDeltas(), outboxCounts(), pendingOutbox(), settleOutboxItem(), isAuthenticated(), applyChanges(), emit(), getWindow() (+4 more)

### Community 43 - "Community 43"
Cohesion: 0.28
Nodes (13): clearApiTokens(), doRefresh(), getAccessToken(), getRefreshToken(), readTokens(), request(), saveTokens(), storeApiTokens() (+5 more)

### Community 45 - "Community 45"
Cohesion: 0.22
Nodes (3): AuditController, AuditModule, AuditService

### Community 49 - "Community 49"
Cohesion: 0.44
Nodes (8): AppError, Err(), isErr(), isOk(), mapResult(), Ok(), unwrap(), unwrapOr()

### Community 53 - "Community 53"
Cohesion: 0.2
Nodes (12): base64_encode(), clearThrottle(), compareSync(), encodeBase64(), genSaltSync(), hashSync(), readThrottle(), recordWrongAttempt() (+4 more)

### Community 54 - "Community 54"
Cohesion: 0.29
Nodes (7): closeDatabase(), getDatabase(), createWindow(), registerHardwareHandlers(), registerDataHandlers(), registerSyncHandlers(), stopSyncEngine()

### Community 57 - "Community 57"
Cohesion: 0.36
Nodes (3): formatDocumentNumber(), parseDocumentNumber(), sequenceKey()

### Community 58 - "Community 58"
Cohesion: 0.22
Nodes (5): RootLayout(), AppShell(), Providers(), ThemeProvider(), useTheme()

### Community 64 - "Community 64"
Cohesion: 0.38
Nodes (6): clearThrottle(), readThrottle(), recordWrongAttempt(), throttleRemaining(), verifyPinLocally(), writeThrottle()

### Community 78 - "Community 78"
Cohesion: 0.25
Nodes (8): add(), commitSale(), divideRoundHalfUp(), movementTotals(), numberToDecimalString(), roundTo(), toDecimalString(), toMinor()

### Community 83 - "Community 83"
Cohesion: 0.38
Nodes (4): useBarcodeScanner(), useHotkeys(), push(), submit()

### Community 87 - "Community 87"
Cohesion: 0.33
Nodes (6): emit(), getWindow(), outboxCounts(), pendingOutbox(), pushOutbox(), settleOutboxItem()

### Community 88 - "Community 88"
Cohesion: 0.4
Nodes (5): _(), h(), L(), p(), X()

### Community 89 - "Community 89"
Cohesion: 0.4
Nodes (3): getApiBaseUrlOverride(), setApiBaseUrlOverride(), handleSave()

### Community 94 - "Community 94"
Cohesion: 0.6
Nodes (3): check(), expectRejected(), scopedRead()

### Community 98 - "Community 98"
Cohesion: 0.5
Nodes (3): handleSubmit(), LoginPage(), nextPath()

## Knowledge Gaps
- **48 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `hasPermission()` connect `Community 16` to `Community 19`, `Community 31`?**
  _High betweenness centrality (0.273) - this node is a cross-community bridge._
- **Why does `RequireAuth()` connect `Community 19` to `Community 16`?**
  _High betweenness centrality (0.263) - this node is a cross-community bridge._
- **Why does `useAuth()` connect `Community 19` to `Community 96`, `Community 97`, `Community 98`, `Community 33`, `Community 58`, `Community 11`, `Community 79`, `Community 89`, `Community 90`, `Community 59`, `Community 30`, `Community 95`?**
  _High betweenness centrality (0.260) - this node is a cross-community bridge._
- **Are the 35 inferred relationships involving `assertBranchInScope()` (e.g. with `.list()` and `.current()`) actually correct?**
  _`assertBranchInScope()` has 35 INFERRED edges - model-reasoned connections that need verification._
- **Are the 12 inferred relationships involving `useAuth()` (e.g. with `CustomersPage()` and `DayClosePage()`) actually correct?**
  _`useAuth()` has 12 INFERRED edges - model-reasoned connections that need verification._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.06 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.08 - nodes in this community are weakly interconnected._