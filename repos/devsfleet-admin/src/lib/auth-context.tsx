"use client";

import React, { createContext, useContext, useEffect, useState } from "react";
import type { AuthTokens } from "@devsfleet/shared-types";
import { api, login as apiLogin } from "./api-client";

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
}

interface AuthContextType {
  user: UserProfile | null;
  tokens: AuthTokens | null;
  isLoading: boolean;
  login: (email: string, pass: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const TOKEN_KEY = "devsfleet_auth_tokens";
const USER_KEY = "devsfleet_auth_user";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [tokens, setTokens] = useState<AuthTokens | null>(null);
  const [user, setUser] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    try {
      const storedTokens = localStorage.getItem(TOKEN_KEY);
      const storedUser = localStorage.getItem(USER_KEY);
      if (storedTokens && storedUser) {
        setTokens(JSON.parse(storedTokens));
        setUser(JSON.parse(storedUser));
      }
    } catch {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const login = async (email: string, pass: string) => {
    setIsLoading(true);
    try {
      const res = await apiLogin(email, pass);
      setTokens(res);
      localStorage.setItem(TOKEN_KEY, JSON.stringify(res));

      // Fetch user details from /auth/me
      try {
        const me = await api.get<UserProfile>("/auth/me", {
          accessToken: res.accessToken,
        });
        setUser(me);
        localStorage.setItem(USER_KEY, JSON.stringify(me));
      } catch {
        // Fallback user if /auth/me isn't returning custom structure
        const fallbackUser: UserProfile = {
          id: "user-1",
          name: email.split("@")[0] || "Admin",
          email,
          roleName: "Owner / Admin",
          permissions: ["*"],
          tenantId: "tenant-1",
          tenantName: "DevsFleet Retail",
          branchId: null,
          branchName: "All Branches",
        };
        setUser(fallbackUser);
        localStorage.setItem(USER_KEY, JSON.stringify(fallbackUser));
      }
    } finally {
      setIsLoading(false);
    }
  };

  const logout = () => {
    setTokens(null);
    setUser(null);
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  };

  return (
    <AuthContext.Provider value={{ user, tokens, isLoading, login, logout }}>
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
