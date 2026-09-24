/**
 * ============================================================
 * DATA ACCESS LAYER: media.api.js
 * ============================================================
 * Giao tiếp với Go Media Gateway (/api/info, /api/download, /api/status).
 * ============================================================
 */

import { apiPost, apiGet } from './apiClient';

export const mediaApi = {
  /**
   * POST /api/info
   * Lấy thông tin video/audio từ URL (YouTube, TikTok, Facebook...).
   */
  async getInfo(url) {
    return apiPost('/api/info', { url });
  },

  /**
   * POST /api/download
   * Khởi tạo tác vụ tải video/audio.
   */
  async startDownload({ url, format, quality }) {
    return apiPost('/api/download', { url, format, quality });
  },

  /**
   * GET /api/status/:jobId
   * Kiểm tra tiến độ tác vụ tải.
   */
  async getStatus(jobId) {
    return apiGet(`/api/status/${jobId}`);
  },
};
