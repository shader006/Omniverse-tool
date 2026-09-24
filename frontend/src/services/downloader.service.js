/**
 * ============================================================
 * SERVICE LAYER: downloader.service.js
 * ============================================================
 * Nghiệp vụ xử lý tải media từ liên kết URL.
 * ============================================================
 */

import { mediaApi } from '../api/media.api';

export const downloaderService = {
  /**
   * Trích xuất thông tin video từ liên kết
   */
  async extractVideoInfo(url) {
    const trimmed = (url || '').trim();
    if (!trimmed) {
      throw new Error('Vui lòng nhập đường dẫn video hợp lệ.');
    }

    const res = await mediaApi.getInfo(trimmed);
    const data = await res.json();

    if (!res.ok || !data.success) {
      throw new Error(data.detail || 'Không thể trích xuất thông tin video từ liên kết này.');
    }

    return data.data;
  },

  /**
   * Bắt đầu tác vụ tải media
   */
  async requestDownload({ url, format, quality }) {
    if (!url) {
      throw new Error('Thiếu đường dẫn video.');
    }

    const res = await mediaApi.startDownload({ url, format, quality });
    const data = await res.json();

    if (!res.ok || !data.success) {
      throw new Error(data.detail || 'Khởi tạo tác vụ tải thất bại.');
    }

    return data;
  },

  /**
   * Kiểm tra trạng thái tác vụ tải
   */
  async pollJobStatus(jobId) {
    if (!jobId) return null;
    const res = await mediaApi.getStatus(jobId);
    return res.json();
  },
};
