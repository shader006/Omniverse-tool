/**
 * ============================================================
 * DATA ACCESS LAYER: apiClient.js (POWERED BY AXIOS)
 * ============================================================
 * Tầng truy xuất dữ liệu mạng chuẩn bằng Axios.
 * Tự động cấu hình Base URL, gắn Bearer Token và tiền/hậu kỳ request.
 * ============================================================
 */

import axios from 'axios';
import { auth } from '../lib/firebase';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

// Khởi tạo instance axios dùng chung cho toàn bộ app
export const httpClient = axios.create({
  baseURL: API_BASE,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Interceptor tự động gắn Bearer Token Firebase nếu người dùng đã đăng nhập
httpClient.interceptors.request.use(async (config) => {
  const currentUser = auth?.currentUser;
  if (currentUser) {
    try {
      const token = await currentUser.getIdToken();
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
    } catch (e) {
      console.warn('[Axios] Error fetching token:', e);
    }
  }
  return config;
});

/**
 * Adapter apiFetch tương thích ngược với các service cũ nhưng xử lý bằng Axios
 */
export async function apiFetch(url, options = {}) {
  const method = (options.method || 'GET').toLowerCase();
  const headers = options.headers || {};
  let data = undefined;

  if (options.body) {
    try {
      data = typeof options.body === 'string' ? JSON.parse(options.body) : options.body;
    } catch {
      data = options.body;
    }
  }

  try {
    const res = await httpClient({
      url,
      method,
      headers,
      data,
    });

    return {
      ok: res.status >= 200 && res.status < 300,
      status: res.status,
      statusText: res.statusText,
      json: async () => res.data,
      text: async () => (typeof res.data === 'string' ? res.data : JSON.stringify(res.data)),
      data: res.data,
      headers: res.headers,
    };
  } catch (err) {
    if (err.response) {
      return {
        ok: false,
        status: err.response.status,
        statusText: err.response.statusText,
        json: async () => err.response.data,
        text: async () => JSON.stringify(err.response.data),
        data: err.response.data,
      };
    }
    throw err;
  }
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
    body: JSON.stringify(data),
    ...options,
  });
}

export async function apiPatch(url, data, options = {}) {
  return apiFetch(url, {
    method: 'PATCH',
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
  try {
    const res = await httpClient.post(url, formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
        ...(options.headers || {}),
      },
      ...options,
    });
    return {
      ok: res.status >= 200 && res.status < 300,
      status: res.status,
      json: async () => res.data,
      data: res.data,
    };
  } catch (err) {
    if (err.response) {
      return {
        ok: false,
        status: err.response.status,
        json: async () => err.response.data,
        data: err.response.data,
      };
    }
    throw err;
  }
}

export default httpClient;
