/**
 * ============================================================
 * SERVICE LAYER: auth.service.js
 * ============================================================
 * Xử lý logic nghiệp vụ đăng nhập, đăng ký, đồng bộ phiên.
 * Tầng trên của Firebase Auth và authApi.
 * ============================================================
 */

import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  GoogleAuthProvider,
  GithubAuthProvider,
  updateProfile,
} from 'firebase/auth';
import { auth } from '../lib/firebase';
import { authApi } from '../api/auth.api';

// Pre-create singleton OAuth providers
const googleProvider = new GoogleAuthProvider();
googleProvider.addScope('email');
googleProvider.addScope('profile');
googleProvider.setCustomParameters({ prompt: 'select_account' });

const githubProvider = new GithubAuthProvider();
githubProvider.addScope('user:email');

export const authService = {
  /**
   * Đồng bộ Firebase ID Token sang Backend NestJS.
   */
  async syncBackendSession(firebaseUser) {
    if (!firebaseUser) return null;

    try {
      const idToken = await firebaseUser.getIdToken();
      const res = await authApi.login(idToken);
      if (res.ok) {
        const data = await res.json();
        if (data.session?.id) {
          localStorage.setItem('oniverse_session_id', data.session.id);
        }
        return data; // { user, session, message }
      }
    } catch (err) {
      console.warn('[AuthService] Không thể kết nối tới Backend NestJS:', err);
    }
    return null;
  },

  /**
   * Đăng nhập bằng Email & Mật khẩu
   */
  async loginWithEmail(email, password) {
    const cred = await signInWithEmailAndPassword(auth, email, password);
    const backendData = await this.syncBackendSession(cred.user);
    return { firebaseUser: cred.user, backendData };
  },

  /**
   * Đăng ký tài khoản mới bằng Email & Mật khẩu
   */
  async registerWithEmail(email, password, displayName) {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    if (displayName) {
      await updateProfile(cred.user, { displayName });
    }
    const backendData = await this.syncBackendSession(cred.user);
    return { firebaseUser: cred.user, backendData };
  },

  /**
   * Đăng nhập với Google
   */
  async loginWithGoogle() {
    const cred = await signInWithPopup(auth, googleProvider);
    const backendData = await this.syncBackendSession(cred.user);
    return { firebaseUser: cred.user, backendData };
  },

  /**
   * Đăng nhập với GitHub
   */
  async loginWithGithub() {
    const cred = await signInWithPopup(auth, githubProvider);
    const backendData = await this.syncBackendSession(cred.user);
    return { firebaseUser: cred.user, backendData };
  },

  /**
   * Đăng xuất: Thu hồi phiên trên NestJS backend rồi thoát Firebase
   */
  async logout(sessionId) {
    const sid = sessionId || localStorage.getItem('oniverse_session_id');
    if (sid) {
      try {
        await authApi.logout(sid);
      } catch (err) {
        console.warn('[AuthService] Lỗi thu hồi session backend:', err);
      }
      localStorage.removeItem('oniverse_session_id');
    }
    await signOut(auth);
  },

  /**
   * Đổi ngôn ngữ người dùng
   */
  async switchLanguage(userId, lang) {
    if (!userId) return null;
    try {
      const res = await authApi.switchLanguage(userId, lang);
      if (res.ok) return await res.json();
    } catch (err) {
      console.warn('[AuthService] Lỗi đổi ngôn ngữ trên backend:', err);
    }
    return null;
  },
};
