/**
 * ============================================================
 * CONTEXT / ADAPTER: AuthContext.jsx
 * ============================================================
 * Cung cấp React state cho tầng Presentation (UI).
 * Kết nối Firebase Auth và Backend NestJS Session.
 * Hỗ trợ chế độ offline / Demo mode khi chưa cấu hình Firebase.
 * ============================================================
 */

import React, { createContext, useContext, useState, useEffect } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, isFirebaseConfigured } from '../lib/firebase';
import { authService } from '../services/auth.service';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);               // Firebase User object | null
  const [backendUser, setBackendUser] = useState(null); // NestJS DB User object | null
  const [session, setSession] = useState(null);         // NestJS UserSession | null
  const [loading, setLoading] = useState(true);         // Đang kiểm tra session ban đầu

  // Lắng nghe thay đổi auth state và đồng bộ sang Service Layer
  useEffect(() => {
    if (!auth) {
      setUser(null);
      setBackendUser(null);
      setSession(null);
      setLoading(false);
      return;
    }

    try {
      const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
        setUser(firebaseUser);
        if (firebaseUser) {
          try {
            const backendData = await authService.syncBackendSession(firebaseUser);
            if (backendData) {
              setBackendUser(backendData.user);
              setSession(backendData.session);
            }
          } catch (syncErr) {
            console.warn('[AuthContext] syncBackendSession warning:', syncErr);
          }
        } else {
          setBackendUser(null);
          setSession(null);
        }
        setLoading(false);
      });

      return () => unsubscribe();
    } catch (err) {
      console.warn('[AuthContext] onAuthStateChanged warning:', err);
      setLoading(false);
    }
  }, []);

  const loginEmail = async (email, password) => {
    if (!auth) throw new Error('Firebase Auth chưa được kích hoạt hoặc chưa cấu hình API Key.');
    const res = await authService.loginWithEmail(email, password);
    if (res?.backendData) {
      setBackendUser(res.backendData.user);
      setSession(res.backendData.session);
    }
    return res;
  };

  const register = async (email, password, displayName) => {
    if (!auth) throw new Error('Firebase Auth chưa được kích hoạt hoặc chưa cấu hình API Key.');
    const res = await authService.registerWithEmail(email, password, displayName);
    if (res?.backendData) {
      setBackendUser(res.backendData.user);
      setSession(res.backendData.session);
    }
    return res;
  };

  const loginGoogle = async () => {
    if (!auth) throw new Error('Firebase Auth chưa được kích hoạt hoặc chưa cấu hình API Key.');
    const res = await authService.loginWithGoogle();
    if (res?.backendData) {
      setBackendUser(res.backendData.user);
      setSession(res.backendData.session);
    }
    return res;
  };

  const loginGitHub = async () => {
    if (!auth) throw new Error('Firebase Auth chưa được kích hoạt hoặc chưa cấu hình API Key.');
    const res = await authService.loginWithGithub();
    if (res?.backendData) {
      setBackendUser(res.backendData.user);
      setSession(res.backendData.session);
    }
    return res;
  };

  const logout = async () => {
    if (session?.id) {
      try {
        await authService.logout(session.id);
      } catch (err) {
        console.warn('[AuthContext] logout error:', err);
      }
    } else if (auth) {
      try {
        await authService.logout();
      } catch (err) {
        console.warn('[AuthContext] logout error:', err);
      }
    }
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

  /** Đăng nhập mô phỏng (dành cho chế độ Test / Local khi chưa có Firebase Key) */
  const loginDemo = (name = 'Demo Gamer', email = 'gamer@omniverse.local') => {
    setUser({
      displayName: name,
      email: email,
      photoURL: null,
      getIdToken: () => Promise.resolve('mock-dev-token')
    });
    setBackendUser({
      id: 'demo-user-id',
      email: email,
      name: name,
      role: 'member'
    });
  };

  const value = {
    user,
    backendUser,
    session,
    loading,
    isLoggedIn: !!user,
    isFirebaseConfigured,
    loginEmail,
    register,
    loginGoogle,
    loginGitHub,
    loginDemo,
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
