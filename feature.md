# DevsFleet POS System - Step-by-Step Implementation Guide

This document breaks down the DevsFleet POS features into a logical, step-by-step execution plan designed for an AI assistant (LLM) to implement progressively. 

**Core Architecture Rule**: The API is the source of truth. The POS is an offline-first transaction interface. The Admin is for management. All three share one domain model.

---

## Phase 1: Foundation & Offline-First Architecture (The most critical phase)
**Goal**: Establish the base infrastructure, focusing heavily on offline-first capabilities for the POS.

### Step 1.1: Shared Domain Models & DB Schema (API)
* **Projects**: API
* **Tasks**: 
  * Design core Prisma/TypeORM schemas for: Tenant, Branch, User, Device, Product, Customer, Order, Transaction, SyncEvent.
  * Ensure every entity has fields required for offline sync: `id` (UUID), `tenantId`, `branchId`, `localId`, `deviceId`, `createdAt`, `updatedAt`, `deletedAt`, `syncStatus`, `version`.
* **Acceptance Criteria**: Schema is created and migrations run successfully. 

### Step 2.2: Local Database Setup (POS)
* **Projects**: POS
* **Tasks**:
  * Setup SQLite (e.g., using Tauri's SQL plugin or OPFS/IndexedDB if purely web).
  * Replicate the core API schema in the local SQLite database.
* **Acceptance Criteria**: POS can perform CRUD operations locally on SQLite without network.

### Step 1.3: Synchronization Engine Core
* **Projects**: API, POS
* **Tasks**:
  * **API**: Build sync endpoints (pull/push/ack) handling timestamps and conflict resolution (server wins or timestamp-based).
  * **POS**: Build background sync worker to periodically pull changes from API and push pending local changes. Include idempotency keys.
* **Acceptance Criteria**: Creating a product on API syncs to POS SQLite. Creating a dummy sale on POS syncs to API when online.

---

## Phase 2: Authentication & Branch/Device Management
**Goal**: Secure the system and handle the multi-branch/multi-device topology.

### Step 2.1: API Authentication & Roles
* **Projects**: API, Admin
* **Tasks**: 
  * Implement JWT authentication.
  * Define Roles (Admin, Manager, Cashier) and Branch assignments.
  * Build endpoints to register and manage POS Terminals (Devices).
* **Acceptance Criteria**: Admin can create a cashier and assign them to Branch A and Terminal 1.

### Step 2.2: POS Login & Session
* **Projects**: POS
* **Tasks**:
  * Build POS Login screen (Username/Password + PIN).
  * Store credentials/tokens securely for offline login.
  * Implement Terminal Registration flow (linking local device to API).
  * Build auto-logout and screen lock features.
* **Acceptance Criteria**: Cashier can log in online, and subsequently log in using PIN even if internet is disconnected.

---

## Phase 3: Product Catalog & Pricing Engine
**Goal**: Handle the complex hardware catalog, unit conversions, and central pricing.

### Step 3.1: Core Product & Variant Schema
* **Projects**: API, Admin
* **Tasks**:
  * Implement Products, Categories, Brands.
  * Implement Variants (Size, Color, Material) and Barcodes (including aliases).
  * Implement Units of Measurement (UoM) and conversion rates (e.g., 1 Box = 10 Pieces).
* **Acceptance Criteria**: Admin can create a PVC Pipe with multiple sizes, each having specific barcodes and UoM conversions.

### Step 3.2: Central Pricing Engine
* **Projects**: API, Admin
* **Tasks**:
  * Build pricing tiers (Retail, Wholesale, Dealer, Min Price).
  * Build promotional/quantity-based pricing rules.
* **Acceptance Criteria**: Product price adjusts based on the selected tier or quantity.

### Step 3.3: POS Product Search & UI
* **Projects**: POS
* **Tasks**:
  * Build local product search optimized for speed (<100ms) over SQLite.
  * Support fuzzy search, partial SKU, and barcode scanning (USB/Bluetooth/Camera).
  * Sync pricing rules to POS so prices calculate accurately offline.
* **Acceptance Criteria**: Cashier can scan a barcode or type "elbow 1" to instantly find products while offline.

---

## Phase 4: Core Cart & Customers
**Goal**: Build the fundamental POS cart and link to customers.

### Step 4.1: Customer Management
* **Projects**: API, Admin, POS
* **Tasks**:
  * Build Customer model with fields for credit limit, price level, VAT info.
  * POS: Allow selecting "Walk-in" or searching/creating a registered customer offline.
* **Acceptance Criteria**: Cashier can quickly attach a customer to a cart or proceed as walk-in.

### Step 4.2: POS Cart Implementation
* **Projects**: POS
* **Tasks**:
  * Build cart UI: Add/remove items, change quantities (including decimals/fractions).
  * Implement UoM selection in cart (e.g., selling 1 Box instead of 10 Pieces).
  * Apply item-level and cart-level discounts (respecting max discount rules).
* **Acceptance Criteria**: Cashier can add 1.5 meters of pipe, apply a 5% discount, and total updates instantly.

### Step 4.3: Hold/Resume Cart
* **Projects**: POS
* **Tasks**:
  * Implement local saving of cart state to "Hold" an order.
  * Build UI to view and resume held orders.
* **Acceptance Criteria**: Cashier can hold Customer A's order, ring up Customer B, and then resume Customer A.

---

## Phase 5: Sales, Payments & Receipts
**Goal**: Finalize transactions, handle cash, and print receipts.

### Step 5.1: Payment & Checkout Flow
* **Projects**: POS, API
* **Tasks**:
  * Build multi-payment UI (Cash, Card, Split payments).
  * Handle UAE Tax (VAT) calculations based on business/customer settings.
  * Generate strict sequential Invoice/Receipt numbers locally (with device prefix).
* **Acceptance Criteria**: Cashier can split a 1000 AED bill into 300 Cash and 700 Card.

### Step 5.2: Syncing Sales & Inventory Deduction
* **Projects**: POS, API
* **Tasks**:
  * POS: Save sale to local SQLite. Deduct local inventory snapshot immediately. Add to Sync Queue.
  * API: Receive sync event, validate, deduct central database stock, and commit.
* **Acceptance Criteria**: Completed sale syncs to API when online; API inventory reflects the sale.

### Step 5.3: Receipt Printing
* **Projects**: POS
* **Tasks**:
  * Integrate thermal printing (58mm/80mm) via Web Serial/USB or Network.
  * Design standard receipt layout including TRN, VAT breakdown, and items.
* **Acceptance Criteria**: Completing a sale automatically prints a formatted receipt.

---

## Phase 6: Cash Register & Shift Management
**Goal**: Secure and track physical cash in the drawer.

### Step 6.1: Shift Management
* **Projects**: POS, API
* **Tasks**:
  * Build Open/Close Shift workflow requiring opening cash count.
  * Record all cash transactions (Sales, Refunds, Cash In/Out).
  * Build end-of-shift reconciliation (Expected vs. Actual variance).
* **Acceptance Criteria**: Cashier cannot sell until shift is opened; manager can view variance at shift close.

---

## Phase 7: Returns, Quotations & Orders
**Goal**: Handle complex hardware workflows like quotes and exchanges.

### Step 7.1: Returns & Exchanges
* **Projects**: POS, API
* **Tasks**:
  * Implement return-by-receipt lookup (searches local DB, falls back to API if online).
  * Build exchange logic (calculating difference if new item is more/less expensive).
  * Update inventory (Restock vs. Damaged).
* **Acceptance Criteria**: Customer returns a 100 AED item and buys a 130 AED item; POS charges 30 AED.

### Step 7.2: Quotations & Sales Orders
* **Projects**: POS, API
* **Tasks**:
  * Allow saving a cart as a Quotation (Draft -> Sent -> Accepted).
  * Allow converting a Quotation to a Sales Order (reserve stock), then to an Invoice.
* **Acceptance Criteria**: Cashier generates a PDF quote, and later converts it to a completed sale.

### Step 7.3: Credit Sales (B2B)
* **Projects**: POS, API
* **Tasks**:
  * Check customer's available credit limit during checkout.
  * Require manager override if limit exceeded.
  * Build payment collection screen for outstanding invoices.
* **Acceptance Criteria**: Wholesale customer can buy on credit up to their 20k AED limit.

---

## Phase 8: Advanced Inventory & Operations
**Goal**: Multi-branch visibility and complex hardware tracking.

### Step 8.1: Multi-Branch Visibility & Transfers
* **Projects**: POS, Admin, API
* **Tasks**:
  * POS: UI to check stock levels across other branches (API call).
  * POS/Admin: Create and receive Stock Transfer requests between branches.
* **Acceptance Criteria**: Dubai cashier can see Sharjah has 150 units of a requested item.

### Step 8.2: Purchase Receiving (POS)
* **Projects**: POS, API
* **Tasks**:
  * Build UI for POS terminals in warehouses to lookup Purchase Orders.
  * Scan barcodes to receive goods against the PO.
* **Acceptance Criteria**: Warehouse staff scans 50 boxes arriving from a supplier to update stock.

### Step 8.3: Bundles & Serial Tracking
* **Projects**: Admin, POS, API
* **Tasks**:
  * Implement Product Bundles (sell 1 kit, deduct components).
  * Add Serial/Batch tracking for specific items (prompt for serial on sale).
* **Acceptance Criteria**: Selling a power tool prompts cashier to scan its unique serial number.

---

## Phase 9: External Integrations
**Goal**: WhatsApp AI and Payment Terminals.

### Step 9.1: WhatsApp Integration
* **Projects**: API, POS
* **Tasks**:
  * API: Integrate WhatsApp Business API.
  * POS: Add buttons to send Quotes/Invoices directly to customer's WhatsApp.
* **Acceptance Criteria**: Cashier clicks "Send to WhatsApp," and customer receives PDF quote instantly.

### Step 9.2: Payment Terminal & Hardware Integration
* **Projects**: POS
* **Tasks**:
  * Integrate UAE specific card terminals (if API provided).
  * Integrate Customer Facing Display (CFD) and Barcode Label Printers.
* **Acceptance Criteria**: POS pushes amount directly to the credit card machine.

---

## Phase 10: AI, Reports & Audit
**Goal**: Final polish, tracking, and AI assistance.

### Step 10.1: Audit Log & Notifications
* **Projects**: API, POS
* **Tasks**:
  * Ensure every sensitive action (price override, delete cart) writes to Audit Log.
  * Build Notification system (low stock warnings, sync failures).
* **Acceptance Criteria**: Manager can view exactly who overrode a price, when, and on which device.

### Step 10.2: Reporting
* **Projects**: Admin, POS
* **Tasks**:
  * POS: Build basic shift/daily sales reports.
  * Admin: Build comprehensive analytics, tax reports, and top products.
* **Acceptance Criteria**: Cashier can print an end-of-day X-report.

### Step 10.3: AI Assistant in POS
* **Projects**: POS, API
* **Tasks**:
  * Add natural language search for products ("something for leaking pipe").
  * Surface AI-driven upsell recommendations on the cart screen.
* **Acceptance Criteria**: Cashier asks AI for alternative to out-of-stock valve, and gets correct recommendations.
