/**
 * ============================================================
 * DATA ACCESS LAYER: auth.api.js
 * ============================================================
 * Chuyên giao tiếp với NestJS Auth & User API (/api/v1/auth, /api/v1/users).
 * ============================================================
 */

import { apiGet, apiPost, apiPatch } from './apiClient';

export const authApi = {
  /**
   * POST /api/v1/auth/login
   * Gửi Firebase ID token sang NestJS backend để tạo/cập nhật user & session.
   */
  async login(idToken, userAgent) {
    const res = await apiPost('/api/v1/auth/login', {
      idToken,
      userAgent: userAgent || (typeof navigator !== 'undefined' ? navigator.userAgent : 'browser'),
    });
    return res;
  },

  /**
   * POST /api/v1/auth/logout/:sessionId
   * Thu hồi phiên đăng nhập hiện tại trên backend.
   */
  async logout(sessionId) {
    return apiPost(`/api/v1/auth/logout/${sessionId}`);
  },

  /**
   * GET /api/v1/auth/me
   * Lấy thông tin người dùng và session hiện tại.
   */
  async getMe() {
    return apiGet('/api/v1/auth/me');
  },

  /**
   * GET /api/v1/auth/session/:sessionId/verify
   * Kiểm tra tính hợp lệ của phiên.
   */
  async verifySession(sessionId) {
    return apiGet(`/api/v1/auth/session/${sessionId}/verify`);
  },

  /**
   * PATCH /api/v1/users/:userId/language
   * Đổi ngôn ngữ người dùng trên cơ sở dữ liệu.
   */
  async switchLanguage(userId, lang) {
    return apiPatch(`/api/v1/users/${userId}/language`, { lang });
  },
};
