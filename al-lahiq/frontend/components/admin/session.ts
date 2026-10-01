import "server-only";
import { ApiError, type Staff } from "@al-lahiq/api-client";
import { cookies } from "next/headers";
import { visitorApi } from "@/lib/api-server";

const TTL_MS = 60_000;
const cache = new Map<string, { staff: Staff; at: number }>();

/**
 * The logged-in staff member, or null. The API rate-limits /auth/* per IP and
 * every server-side call comes from this server's IP, so the answer is
 * cached per access token for a minute. The API still checks every request.
 * Returns "busy" when the API is rate-limiting us.
 */
export async function getStaffSession(): Promise<Staff | null | "busy"> {
  const jar = await cookies();
  const token = jar.get("al_sat")?.value;
  if (!token) return null;

  const hit = cache.get(token);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.staff;

  try {
    const staff = await (await visitorApi()).get<Staff>("/auth/staff/me", { cache: "no-store" });
    if (cache.size > 500) cache.clear();
    cache.set(token, { staff, at: Date.now() });
    return staff;
  } catch (err) {
    if (err instanceof ApiError && (err.status === 401 || err.status === 403)) return null;
    if (err instanceof ApiError && err.status === 429) return hit?.staff ?? "busy";
    throw err;
  }
}
