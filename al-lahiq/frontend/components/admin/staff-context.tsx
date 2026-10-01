"use client";

import type { Staff } from "@al-lahiq/api-client";
import { createContext, useContext, type ReactNode } from "react";
import { can, type Area } from "./roles";

const StaffContext = createContext<Staff | null>(null);

export function StaffProvider({ staff, children }: { staff: Staff; children: ReactNode }) {
  return <StaffContext.Provider value={staff}>{children}</StaffContext.Provider>;
}

/** The logged-in staff member (the panel layout guarantees one). */
export function useStaff(): Staff {
  const s = useContext(StaffContext);
  if (!s) throw new Error("useStaff() used outside the admin panel");
  return s;
}

export function useCan(area: Area) {
  return can(useStaff().role, area);
}
