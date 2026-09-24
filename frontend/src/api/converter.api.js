/**
 * ============================================================
 * DATA ACCESS LAYER: converter.api.js
 * ============================================================
 * Giao tiếp với Gotenberg & Converter Service (/api/convert/file).
 * ============================================================
 */

import { apiPostForm } from './apiClient';

export const converterApi = {
  /**
   * POST /api/convert/file
   * Gửi file tài liệu lên server để chuyển đổi (PDF, DOCX, v.v.).
   */
  async convertFile(formData) {
    return apiPostForm('/api/convert/file', formData);
  },
};
