/**
 * Find POS PIN collisions — the cause of "More than one person at this branch
 * uses that PIN. Ask a manager to change it."
 *
 * The server (auth.service.ts resolvePinHolder) treats a user as a candidate
 * at a branch when their branch_id matches OR is NULL (tenant-wide staff, like
 * the owner, are candidates at EVERY branch). If two candidates answer to the
 * same PIN it refuses to guess, rather than attribute a shift to the wrong
 * person. This reproduces that check.
 *
 *   DATABASE_URL=... node tools/find-pin-collisions.mjs [extra PINs...]
 *
 * Defaults to the seeded PINs (4321 admin, 2580 manager, 1234 cashier). Pass
 * others to test them: `node tools/find-pin-collisions.mjs 1111 9999`
 */
import bcrypt from "bcryptjs";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("Set DATABASE_URL (see apps/api/.env)");
  process.exit(1);
}

const pins = process.argv.slice(2).length ? process.argv.slice(2) : ["4321", "2580", "1234"];
const sql = postgres(url, { onnotice: () => {} });

const users = await sql`
  SELECT u.id, u.name, u.email, u.branch_id, u.tenant_id, u.pin_hash,
         r.name AS role, b.name AS branch_name, t.name AS tenant_name
  FROM users u
  JOIN roles r ON r.id = u.role_id
  JOIN tenants t ON t.id = u.tenant_id
  LEFT JOIN branches b ON b.id = u.branch_id
  WHERE u.is_active = true AND u.deleted_at IS NULL AND u.pin_hash IS NOT NULL
`;

console.log(`Checking ${pins.length} PIN(s) against ${users.length} active PIN-holding user(s).\n`);

let collisions = 0;
// Group by tenant: RLS scopes the server's lookup to one tenant, so users in
// different tenants can share a PIN safely.
for (const tenantId of [...new Set(users.map((u) => u.tenant_id))]) {
  const inTenant = users.filter((u) => u.tenant_id === tenantId);
  const branches = [...new Set(inTenant.map((u) => u.branch_id).filter(Boolean))];

  for (const pin of pins) {
    const holders = [];
    for (const u of inTenant) {
      if (await bcrypt.compare(pin, u.pin_hash)) holders.push(u);
    }
    if (!holders.length) continue;

    for (const branchId of branches) {
      // Exactly the server's candidate rule.
      const reachable = holders.filter((u) => u.branch_id === null || u.branch_id === branchId);
      if (reachable.length > 1) {
        collisions++;
        const branchName = inTenant.find((u) => u.branch_id === branchId)?.branch_name ?? branchId;
        console.log(`COLLISION  tenant "${holders[0].tenant_name}"  branch "${branchName}"  PIN ${pin}`);
        for (const u of reachable) {
          const scope = u.branch_id === null ? "tenant-wide" : "this branch";
          console.log(`   - ${u.name} <${u.email}>  role=${u.role}  (${scope})`);
        }
        console.log("   -> change one of these PINs: Admin panel > Staff & Users\n");
      }
    }
  }
}

console.log(collisions ? `${collisions} collision(s) found.` : "No collisions for the PIN(s) checked.");
await sql.end();
