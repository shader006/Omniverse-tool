/**
 * ============================================================
 * CONTEXT / ADAPTER: AuthContext.jsx
 * ============================================================
 * Cung cấp React state cho tầng Presentation (UI).
 * Gọi trực tiếp xuống Service Layer (authService).
 * ============================================================
 */

import React, { createContext, useContext, useState, useEffect } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../lib/firebase';
import { authService } from '../services/auth.service';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);               // Firebase User object | null
  const [backendUser, setBackendUser] = useState(null); // NestJS DB User object | null
  const [session, setSession] = useState(null);         // NestJS UserSession | null
  const [loading, setLoading] = useState(true);         // Đang kiểm tra session ban đầu

  // Lắng nghe thay đổi auth state và đồng bộ sang Service Layer
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      if (firebaseUser) {
        const backendData = await authService.syncBackendSession(firebaseUser);
        if (backendData) {
          setBackendUser(backendData.user);
          setSession(backendData.session);
        }
      } else {
        setBackendUser(null);
        setSession(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const loginEmail = async (email, password) => {
    const res = await authService.loginWithEmail(email, password);
    if (res.backendData) {
      setBackendUser(res.backendData.user);
      setSession(res.backendData.session);
    }
    return res;
  };

  const register = async (email, password, displayName) => {
    const res = await authService.registerWithEmail(email, password, displayName);
    if (res.backendData) {
      setBackendUser(res.backendData.user);
      setSession(res.backendData.session);
    }
    return res;
  };

  const loginGoogle = async () => {
    const res = await authService.loginWithGoogle();
    if (res.backendData) {
      setBackendUser(res.backendData.user);
      setSession(res.backendData.session);
    }
    return res;
  };

  const loginGitHub = async () => {
    const res = await authService.loginWithGithub();
    if (res.backendData) {
      setBackendUser(res.backendData.user);
      setSession(res.backendData.session);
    }
    return res;
  };

  const logout = async () => {
    await authService.logout(session?.id);
    setUser(null);
    setBackendUser(null);
    setSession(null);
  };

  const switchLanguage = async (lang) => {
    if (backendUser?.id) {
      await authService.switchLanguage(backendUser.id, lang);
      setBackendUser((prev) => (prev ? { ...prev, currentLanguage: lang } : null));
    }
  };

  const getIdToken = (forceRefresh = false) => {
    if (!user) return Promise.resolve(null);
    return user.getIdToken(forceRefresh);
  };

  const value = {
    user,
    backendUser,
    session,
    loading,
    isLoggedIn: !!user,
    loginEmail,
    register,
    loginGoogle,
    loginGitHub,
    logout,
    switchLanguage,
    getIdToken,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export default AuthContext;
