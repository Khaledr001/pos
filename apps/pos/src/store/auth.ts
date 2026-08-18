import { hasPermission, type Permission, type PermissionGrant } from "@devsfleet/shared-types";
import { create } from "zustand";

/**
 * Terminal session.
 *
 * Two things are deliberately separate:
 *
 *   the TERMINAL is bound to a branch and a device, once, at installation.
 *   the CASHIER signs in and out over that binding, many times a shift.
 *
 * Conflating them is how a terminal ends up selling against the wrong branch's
 * stock after a shift change.
 *
 * Persisted to localStorage so a crash or an accidental app restart does not
 * force a re-login mid-queue. The access token is short-lived and the refresh
 * token is revocable server-side, which is what makes that acceptable on a
 * machine sitting in a shop.
 */

export interface Cashier {
  id: string;
  name: string;
  roleName: string;
  permissions: PermissionGrant[];
}

export interface TerminalBinding {
  deviceId: string;
  deviceName: string;
  branchId: string;
  branchName: string;
  tenantName: string;
}

interface AuthState {
  cashier: Cashier | null;
  terminal: TerminalBinding | null;
  signedInAt: string | null;

  signIn: (cashier: Cashier) => void;
  signOut: () => void;
  bindTerminal: (terminal: TerminalBinding) => void;
  can: (permission: Permission) => boolean;
}

const STORAGE_KEY = "devsfleet.pos.session";

interface StoredSession {
  cashier: Cashier | null;
  terminal: TerminalBinding | null;
  signedInAt: string | null;
}

function readStored(): StoredSession {
  const empty: StoredSession = { cashier: null, terminal: null, signedInAt: null };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...empty, ...(JSON.parse(raw) as StoredSession) } : empty;
  } catch {
    // Corrupt storage must not stop a till from opening.
    localStorage.removeItem(STORAGE_KEY);
    return empty;
  }
}

function persist(session: StoredSession): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch {
    // A full or disabled storage is not a reason to refuse a sale.
  }
}

const stored = readStored();

export const useAuth = create<AuthState>((set, get) => ({
  cashier: stored.cashier,
  terminal: stored.terminal ?? null,
  signedInAt: stored.signedInAt,

  signIn(cashier) {
    const signedInAt = new Date().toISOString();
    set({ cashier, signedInAt });
    persist({ cashier, terminal: get().terminal, signedInAt });
  },

  signOut() {
    set({ cashier: null, signedInAt: null });
    persist({ cashier: null, terminal: get().terminal, signedInAt: null });
  },

  bindTerminal(terminal) {
    set({ terminal });
    persist({ cashier: get().cashier, terminal, signedInAt: get().signedInAt });
  },

  /**
   * Every gated action asks this, never the role name. A tenant may rename
   * "manager" or invent a fifth role, and none of that should reach the UI.
   */
  can(permission) {
    return hasPermission(get().cashier?.permissions, permission);
  },
}));
