/**
 * ============================================================
 * SERVICE LAYER: converter.service.js
 * ============================================================
 * Nghiệp vụ xử lý chuyển đổi tài liệu (PDF, Word, Office).
 * ============================================================
 */

import { converterApi } from '../api/converter.api';

export const converterService = {
  /**
   * Chuyển đổi tài liệu
   */
  async convertDocument({ file, targetFormat }) {
    if (!file) {
      throw new Error('Vui lòng chọn file cần chuyển đổi.');
    }

    const formData = new FormData();
    formData.append('file', file);
    formData.append('target_format', targetFormat);

    const res = await converterApi.convertFile(formData);
    const data = await res.json();

    if (!res.ok || !data.success) {
      throw new Error(data.detail || 'Quá trình chuyển đổi tài liệu thất bại.');
    }

    return data;
  },
};
