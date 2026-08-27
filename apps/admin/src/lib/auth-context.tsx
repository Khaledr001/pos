"use client";

import React, { createContext, useContext, useEffect, useState } from "react";
import type { AuthTokens } from "@devsfleet/shared-types";
import {
  api,
  clearSession,
  login as apiLogin,
  setSessionExpiredCallback,
  setTokensUpdatedCallback,
  getTokenExpiresAt,
  PROACTIVE_REFRESH_LEAD,
  refreshAccessToken,
} from "./api-client";

export interface UserProfile {
  id: string;
  name: string;
  email: string;
  roleName: string;
  permissions: string[];
  tenantId: string;
  tenantName: string;
  branchId: string | null;
  branchName: string | null;
  isPlatformAdmin?: boolean;
}

interface ImpersonationBackup {
  tokens: AuthTokens & { expiresAt?: number };
  user: UserProfile;
}

interface AuthContextType {
  user: UserProfile | null;
  tokens: AuthTokens | null;
  isLoading: boolean;
  isImpersonating: boolean;
  login: (email: string, pass: string, tenantSlug?: string) => Promise<void>;
  logout: () => void;
  impersonateTenant: (tenantId: string) => Promise<void>;
  exitImpersonation: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const TOKEN_KEY = "devsfleet_auth_tokens";
const USER_KEY = "devsfleet_auth_user";
const SUPERADMIN_BACKUP_KEY = "devsfleet_superadmin_backup";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [tokens, setTokens] = useState<AuthTokens | null>(null);
  const [user, setUser] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isImpersonating, setIsImpersonating] = useState(false);

  useEffect(() => {
    try {
      const storedTokens = localStorage.getItem(TOKEN_KEY);
      const storedUser = localStorage.getItem(USER_KEY);
      const storedBackup = localStorage.getItem(SUPERADMIN_BACKUP_KEY);
      if (storedTokens && storedUser) {
        setTokens(JSON.parse(storedTokens));
        setUser(JSON.parse(storedUser));
        setIsImpersonating(Boolean(storedBackup));
      }
    } catch {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
      localStorage.removeItem(SUPERADMIN_BACKUP_KEY);
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * Wire up the session callbacks once on mount.
   */
  useEffect(() => {
    setSessionExpiredCallback(() => {
      setUser(null);
      setTokens(null);
      setIsImpersonating(false);
    });
    setTokensUpdatedCallback((newTokens) => {
      setTokens(newTokens);
    });
  }, []);

  /**
   * Proactive token refresh timer.
   */
  useEffect(() => {
    if (!tokens?.refreshToken || !user) return;

    const checkAndRefreshToken = async () => {
      const expiresAt = getTokenExpiresAt();
      if (!expiresAt) return;

      const remainingMs = expiresAt - Date.now();
      if (remainingMs <= PROACTIVE_REFRESH_LEAD) {
        const fresh = await refreshAccessToken();
        if (!fresh && remainingMs <= 0) {
          logout();
        }
      }
    };

    checkAndRefreshToken();
    const interval = setInterval(checkAndRefreshToken, 30_000);

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        checkAndRefreshToken();
      }
    };
    window.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("focus", onVisibilityChange);

    return () => {
      clearInterval(interval);
      window.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("focus", onVisibilityChange);
    };
  }, [tokens?.refreshToken, user]);

  const login = async (email: string, pass: string, tenantSlug?: string) => {
    setIsLoading(true);
    try {
      const res = await apiLogin(email, pass, tenantSlug);
      const tokenPair = {
        accessToken: res.accessToken,
        refreshToken: res.refreshToken,
        expiresIn: res.expiresIn,
      };
      setTokens(tokenPair);

      const withExpiry = {
        ...tokenPair,
        expiresAt: Date.now() + (res.expiresIn ?? 900) * 1000,
      };
      localStorage.setItem(TOKEN_KEY, JSON.stringify(withExpiry));

      if (res.user) {
        const profile: UserProfile = {
          id: res.user.id,
          name: res.user.name || email.split("@")[0] || "User",
          email: res.user.email || email,
          roleName: res.user.roleName || "User",
          permissions: (res.user.permissions as string[]) || [],
          tenantId: res.user.tenantId,
          tenantName: res.user.tenantName,
          branchId: res.user.branchId,
          branchName: res.user.branchName,
          isPlatformAdmin: res.user.isPlatformAdmin,
        };
        setUser(profile);
        localStorage.setItem(USER_KEY, JSON.stringify(profile));
      }
      setIsImpersonating(false);
      localStorage.removeItem(SUPERADMIN_BACKUP_KEY);
    } finally {
      setIsLoading(false);
    }
  };

  const impersonateTenant = async (tenantId: string) => {
    if (!tokens || !user) return;
    setIsLoading(true);

    try {
      const storedTokens = localStorage.getItem(TOKEN_KEY);
      const storedUser = localStorage.getItem(USER_KEY);
      if (storedTokens && storedUser) {
        // Save current super admin session
        const backup: ImpersonationBackup = {
          tokens: JSON.parse(storedTokens),
          user: JSON.parse(storedUser),
        };
        localStorage.setItem(SUPERADMIN_BACKUP_KEY, JSON.stringify(backup));
      }

      const res = await api.post<{
        accessToken: string;
        refreshToken: string;
        expiresIn: number;
        user: {
          id: string;
          name: string;
          email: string;
          roleName: string;
          permissions: string[];
          tenantId: string;
          tenantName: string;
          branchId: string | null;
          branchName: string | null;
          isPlatformAdmin?: boolean;
        };
      }>(`/admin/tenants/${tenantId}/impersonate`, {});

      const tokenPair = {
        accessToken: res.accessToken,
        refreshToken: res.refreshToken,
        expiresIn: res.expiresIn,
      };
      const withExpiry = {
        ...tokenPair,
        expiresAt: Date.now() + (res.expiresIn ?? 900) * 1000,
      };
      localStorage.setItem(TOKEN_KEY, JSON.stringify(withExpiry));
      setTokens(tokenPair);

      const targetProfile: UserProfile = {
        id: res.user.id,
        name: res.user.name,
        email: res.user.email,
        roleName: res.user.roleName,
        permissions: res.user.permissions || [],
        tenantId: res.user.tenantId,
        tenantName: res.user.tenantName,
        branchId: res.user.branchId,
        branchName: res.user.branchName,
        isPlatformAdmin: false,
      };
      setUser(targetProfile);
      localStorage.setItem(USER_KEY, JSON.stringify(targetProfile));
      setIsImpersonating(true);

      window.location.href = "/";
    } catch (err) {
      // Revert if failed
      localStorage.removeItem(SUPERADMIN_BACKUP_KEY);
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  const exitImpersonation = () => {
    try {
      const backupRaw = localStorage.getItem(SUPERADMIN_BACKUP_KEY);
      if (backupRaw) {
        const backup: ImpersonationBackup = JSON.parse(backupRaw);
        localStorage.setItem(TOKEN_KEY, JSON.stringify(backup.tokens));
        localStorage.setItem(USER_KEY, JSON.stringify(backup.user));
        localStorage.removeItem(SUPERADMIN_BACKUP_KEY);
        setTokens(backup.tokens);
        setUser(backup.user);
        setIsImpersonating(false);
        window.location.href = "/platform/tenants";
        return;
      }
    } catch (err) {
      console.error("Error exiting impersonation:", err);
    }
    logout();
  };

  const logout = async () => {
    const currentTokens = tokens;
    if (currentTokens?.refreshToken) {
      try {
        await api.post("/auth/logout", { refreshToken: currentTokens.refreshToken });
      } catch (err) {
        console.warn("Could not notify backend of logout:", err);
      }
    }
    setTokens(null);
    setUser(null);
    setIsImpersonating(false);
    localStorage.removeItem(SUPERADMIN_BACKUP_KEY);
    clearSession();

    if (typeof window !== "undefined") window.location.href = "/login";
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        tokens,
        isLoading,
        isImpersonating,
        login,
        logout,
        impersonateTenant,
        exitImpersonation,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
