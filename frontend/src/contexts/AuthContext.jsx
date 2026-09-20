import React, { createContext, useContext, useState, useEffect } from 'react';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  GoogleAuthProvider,
  GithubAuthProvider,
  updateProfile,
} from 'firebase/auth';
import { auth, isFirebaseConfigured } from '../lib/firebase';

// ============================================================
// Auth Context
// ============================================================

const AuthContext = createContext(null);

// ── Pre-create OAuth providers 1 lần duy nhất (tránh khởi tạo lại mỗi lần click) ──
const googleProvider = new GoogleAuthProvider();
googleProvider.addScope('email');
googleProvider.addScope('profile');
// setCustomParameters giúp popup hiện nhanh hơn, không bắt chọn lại tài khoản
googleProvider.setCustomParameters({ prompt: 'select_account' });

const githubProvider = new GithubAuthProvider();
githubProvider.addScope('user:email');

// Provider bọc toàn bộ App — cung cấp user state + methods
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);       // Firebase User object | null
  const [loading, setLoading] = useState(true); // true trong khi kiểm tra session đầu tiên

  // Lắng nghe thay đổi auth state (đăng nhập / đăng xuất / token refresh)
  useEffect(() => {
    if (!auth) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
        setUser(firebaseUser);
        setLoading(false);
      });
      return () => unsubscribe();
    } catch (err) {
      console.warn('[AuthContext] onAuthStateChanged warning:', err);
      setLoading(false);
    }
  }, []);

  // ──────────────────────────────────────────────────────────
  // Email / Password
  // ──────────────────────────────────────────────────────────

  /** Đăng nhập bằng email + password */
  const loginEmail = (email, password) => {
    if (!auth) throw new Error('Firebase Auth chưa được kích hoạt hoặc chưa cấu hình API Key.');
    return signInWithEmailAndPassword(auth, email, password);
  };

  /** Đăng ký tài khoản mới bằng email + password */
  const register = async (email, password, displayName) => {
    if (!auth) throw new Error('Firebase Auth chưa được kích hoạt hoặc chưa cấu hình API Key.');
    const credential = await createUserWithEmailAndPassword(auth, email, password);
    if (displayName) {
      await updateProfile(credential.user, { displayName });
    }
    return credential;
  };

  // ──────────────────────────────────────────────────────────
  // OAuth Providers (dùng provider singleton đã tạo ở trên)
  // ──────────────────────────────────────────────────────────

  /** Đăng nhập bằng Google — dùng provider singleton */
  const loginGoogle = () => {
    if (!auth) throw new Error('Firebase Auth chưa được kích hoạt hoặc chưa cấu hình API Key.');
    return signInWithPopup(auth, googleProvider);
  };

  /** Đăng nhập bằng GitHub — dùng provider singleton */
  const loginGitHub = () => {
    if (!auth) throw new Error('Firebase Auth chưa được kích hoạt hoặc chưa cấu hình API Key.');
    return signInWithPopup(auth, githubProvider);
  };

  // ──────────────────────────────────────────────────────────
  // Utilities
  // ──────────────────────────────────────────────────────────

  /** Đăng xuất */
  const logout = () => {
    if (!auth) return Promise.resolve();
    return signOut(auth);
  };

  /**
   * Lấy ID Token hiện tại (tự động refresh nếu hết hạn).
   * Dùng để đính kèm vào header API calls.
   * @param {boolean} forceRefresh - Bắt buộc refresh ngay cả khi chưa hết hạn
   */
  const getIdToken = (forceRefresh = false) => {
    if (!auth || !user) return Promise.resolve(null);
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
  };

  const value = {
    user,           // Firebase User object (null nếu chưa đăng nhập)
    loading,        // Đang kiểm tra session?
    isLoggedIn: !!user,
    isFirebaseConfigured,
    loginEmail,
    register,
    loginGoogle,
    loginGitHub,
    loginDemo,
    logout,
    getIdToken,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export default AuthContext;

