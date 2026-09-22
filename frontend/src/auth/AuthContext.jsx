import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { auth } from '../api/endpoints.js';
import { clearSession, getStoredUser, getToken, setSession, setUnauthorizedHandler } from '../api/client.js';

const AuthContext = createContext(null);

// Mirrors the authorization policies in Program.cs. The API is still the authority —
// every endpoint carries its own [Authorize(Policy = …)] — but the UI needs the same
// knowledge to avoid offering a button that can only ever return 403.
export const ROLES = { Admin: 'Admin', Artist: 'Artist', Analyst: 'Analyst', Customer: 'Customer' };

const POLICIES = {
  canManageModels: [ROLES.Admin, ROLES.Artist],
  canPublish: [ROLES.Admin, ROLES.Artist, ROLES.Analyst],
  canConfigure: [ROLES.Admin, ROLES.Analyst, ROLES.Customer],
};

export function AuthProvider({ children }) {
  // Seed from localStorage so a reload doesn't flash the login screen before /me
  // comes back. The token is re-validated immediately afterwards.
  const [user, setUser] = useState(() => (getToken() ? getStoredUser() : null));
  const [checking, setChecking] = useState(() => !!getToken());

  const signOut = useCallback(() => {
    clearSession();
    setUser(null);
  }, []);

  // A 401 from any call means the token is gone or expired; drop the session once,
  // centrally, rather than letting each page invent its own recovery.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      clearSession();
      setUser(null);
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  useEffect(() => {
    if (!getToken()) {
      setChecking(false);
      return;
    }
    let cancelled = false;
    auth
      .me()
      .then((me) => {
        if (!cancelled) setUser(me);
      })
      .catch((err) => {
        // Only a rejected token should sign the user out. If the API is simply
        // down, keep the cached session so they aren't bounced to login by a
        // backend restart.
        if (!cancelled && err?.status === 401) signOut();
      })
      .finally(() => {
        if (!cancelled) setChecking(false);
      });
    return () => {
      cancelled = true;
    };
  }, [signOut]);

  const signIn = useCallback(async (email, password) => {
    const res = await auth.login(email, password);
    setSession(res.accessToken, res.user);
    setUser(res.user);
    return res.user;
  }, []);

  const value = useMemo(() => {
    const roles = user?.roles ?? [];
    const has = (policy) => roles.some((r) => POLICIES[policy]?.includes(r));
    return {
      user,
      roles,
      checking,
      signIn,
      signOut,
      isAuthenticated: !!user,
      can: {
        manageModels: has('canManageModels'),
        publish: has('canPublish'),
        configure: has('canConfigure'),
        administer: roles.includes(ROLES.Admin),
      },
    };
  }, [user, checking, signIn, signOut]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>.');
  return ctx;
}
