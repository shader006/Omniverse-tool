/**
 * ============================================================
 * CONTEXT / ADAPTER: AuthContext.jsx
 * ============================================================
 * Cung cấp React state cho tầng Presentation (UI).
 * Tích hợp Firebase Auth + Service Layer (authService).
 * Hỗ trợ chế độ Demo 1-click & kiểm tra cấu hình an toàn.
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
          } catch (e) {
            console.warn('[AuthContext] syncBackendSession error:', e);
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

  /** Đăng nhập mô phỏng (dành cho chế độ Test / Local khi chưa có Firebase Key) */
  const loginDemo = (name = 'Demo Gamer', email = 'gamer@omniverse.local') => {
    setUser({
      displayName: name,
      email: email,
      photoURL: null,
      getIdToken: () => Promise.resolve('mock-dev-token')
    });
  };

  const logout = async () => {
    try {
      await authService.logout(session?.id);
    } catch (e) {
      console.warn('[AuthContext] logout error:', e);
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
    if (typeof user.getIdToken === 'function') {
      return user.getIdToken(forceRefresh);
    }
    return Promise.resolve('mock-dev-token');
  };

  /** Đổi tên tài khoản (hỗ trợ đồng bộ Firebase, NestJS Backend và Demo/Local Mode) */
  const updateDisplayName = async (newName) => {
    const trimmed = (newName || '').trim();
    if (!trimmed) {
      throw new Error('Tên tài khoản không được để trống.');
    }

    // 1. Cập nhật qua authService (Firebase Auth + NestJS API)
    try {
      const res = await authService.updateAccountName(trimmed, backendUser?.id);
      if (res?.backendUser) {
        setBackendUser(res.backendUser);
      }
    } catch (err) {
      console.warn('[AuthContext] updateAccountName warning:', err);
    }

    // 2. Cập nhật React state ngay lập tức (không cần reload trang)
    setUser((prev) => {
      if (!prev) {
        return {
          displayName: trimmed,
          email: 'gamer@omniverse.local',
          photoURL: null,
          getIdToken: () => Promise.resolve('mock-dev-token')
        };
      }
      return {
        ...prev,
        displayName: trimmed
      };
    });

    // 3. Lưu localStorage để giữ tên sau khi F5 refresh
    localStorage.setItem('omniverse_display_name', trimmed);

    return { success: true, displayName: trimmed };
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
    updateDisplayName,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

export default AuthContext;
