import { auth } from './firebase';

// Base URL của backend API
const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

/**
 * Wrapper cho fetch() — tự động đính kèm Firebase ID Token vào header Authorization.
 * Token được refresh tự động bởi Firebase SDK khi sắp hết hạn.
 *
 * @param {string} url - API endpoint (ví dụ: '/api/download')
 * @param {RequestInit} options - Fetch options (method, body, headers, ...)
 * @returns {Promise<Response>}
 *
 * @example
 * const res = await apiFetch('/api/download', {
 *   method: 'POST',
 *   body: formData,
 * });
 */
export async function apiFetch(url, options = {}) {
  const currentUser = auth.currentUser;

  // Lấy token (tự refresh nếu hết hạn)
  const token = currentUser ? await currentUser.getIdToken() : null;

  const headers = {
    ...(options.headers || {}),
  };

  // Đính kèm token nếu user đã đăng nhập
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  return fetch(`${API_BASE}${url}`, {
    ...options,
    headers,
  });
}

/**
 * apiFetch với JSON body tiện lợi
 */
export async function apiPost(url, data) {
  return apiFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

/**
 * apiFetch với FormData (upload file, không set Content-Type thủ công)
 */
export async function apiPostForm(url, formData) {
  return apiFetch(url, {
    method: 'POST',
    body: formData, // Browser tự set Content-Type: multipart/form-data
  });
}

export default apiFetch;
