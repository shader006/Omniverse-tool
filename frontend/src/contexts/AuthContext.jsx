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
import { auth } from '../lib/firebase';

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
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);
      setLoading(false);
    });
    // Cleanup khi component unmount
    return () => unsubscribe();
  }, []);

  // ──────────────────────────────────────────────────────────
  // Email / Password
  // ──────────────────────────────────────────────────────────

  /** Đăng nhập bằng email + password */
  const loginEmail = (email, password) =>
    signInWithEmailAndPassword(auth, email, password);

  /** Đăng ký tài khoản mới bằng email + password */
  const register = async (email, password, displayName) => {
    const credential = await createUserWithEmailAndPassword(auth, email, password);
    // Cập nhật display name ngay sau khi tạo account
    if (displayName) {
      await updateProfile(credential.user, { displayName });
    }
    return credential;
  };

  // ──────────────────────────────────────────────────────────
  // OAuth Providers (dùng provider singleton đã tạo ở trên)
  // ──────────────────────────────────────────────────────────

  /** Đăng nhập bằng Google — dùng provider singleton */
  const loginGoogle = () => signInWithPopup(auth, googleProvider);

  /** Đăng nhập bằng GitHub — dùng provider singleton */
  const loginGitHub = () => signInWithPopup(auth, githubProvider);

  // ──────────────────────────────────────────────────────────
  // Utilities
  // ──────────────────────────────────────────────────────────

  /** Đăng xuất */
  const logout = () => signOut(auth);

  /**
   * Lấy ID Token hiện tại (tự động refresh nếu hết hạn).
   * Dùng để đính kèm vào header API calls.
   * @param {boolean} forceRefresh - Bắt buộc refresh ngay cả khi chưa hết hạn
   */
  const getIdToken = (forceRefresh = false) => {
    if (!user) return Promise.resolve(null);
    return user.getIdToken(forceRefresh);
  };

  const value = {
    user,           // Firebase User object (null nếu chưa đăng nhập)
    loading,        // Đang kiểm tra session?
    isLoggedIn: !!user,
    loginEmail,
    register,
    loginGoogle,
    loginGitHub,
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

