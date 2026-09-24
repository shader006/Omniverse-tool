/**
 * ============================================================
 * DATA ACCESS LAYER: apiClient.js
 * ============================================================
 * Tầng truy xuất dữ liệu mạng (Network / HTTP Client).
 * Tự động gắn token Firebase và xử lý tiền/hậu kỳ request.
 * ============================================================
 */

import { auth } from '../lib/firebase';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

export async function apiFetch(url, options = {}) {
  const currentUser = auth.currentUser;
  const token = currentUser ? await currentUser.getIdToken() : null;

  const headers = {
    ...(options.headers || {}),
  };

  if (token && !headers['Authorization']) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  return fetch(`${API_BASE}${url}`, {
    ...options,
    headers,
  });
}

export async function apiGet(url, options = {}) {
  return apiFetch(url, {
    method: 'GET',
    ...options,
  });
}

export async function apiPost(url, data, options = {}) {
  return apiFetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    body: JSON.stringify(data),
    ...options,
  });
}

export async function apiPatch(url, data, options = {}) {
  return apiFetch(url, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    body: JSON.stringify(data),
    ...options,
  });
}

export async function apiDelete(url, options = {}) {
  return apiFetch(url, {
    method: 'DELETE',
    ...options,
  });
}

export async function apiPostForm(url, formData, options = {}) {
  return apiFetch(url, {
    method: 'POST',
    body: formData,
    ...options,
  });
}

export default apiFetch;
