/**
 * ============================================================
 * SERVICE LAYER: ai.service.js
 * ============================================================
 * Nghiệp vụ xử lý các tính năng AI (Whisper, BiRefNet, PixelFixer).
 * ============================================================
 */

import { aiApi } from '../api/ai.api';

export const aiService = {
  /**
   * Trích xuất văn bản từ âm thanh (Whisper)
   */
  async transcribeAudio({ file, language, format }) {
    if (!file) {
      throw new Error('Vui lòng chọn file âm thanh hoặc video.');
    }

    const formData = new FormData();
    formData.append('file', file);
    formData.append('language', language);
    formData.append('format', format);

    const res = await aiApi.transcribeAudio(formData);
    const respText = await res.text();

    let data;
    try {
      data = JSON.parse(respText);
    } catch {
      throw new Error('Phản hồi từ máy chủ không hợp lệ: ' + respText.slice(0, 80));
    }

    if (!res.ok || !data.success) {
      throw new Error(data.detail || data.error || 'Quá trình trích xuất văn bản thất bại.');
    }

    return data;
  },

  /**
   * Tách nền ảnh bằng AI (BiRefNet)
   */
  async removeBackground(file) {
    if (!file) {
      throw new Error('Vui lòng chọn file hình ảnh.');
    }

    const formData = new FormData();
    formData.append('file', file);

    const res = await aiApi.removeBackground(formData);
    if (!res.ok) {
      throw new Error('Lỗi tách nền ảnh từ server.');
    }
    return res.blob();
  },

  /**
   * Phục chế lưới pixel art (PixelFixer)
   */
  async fixPixelGrid({ file, queryParams, signal }) {
    if (!file) {
      throw new Error('Vui lòng chọn ảnh pixel.');
    }

    const formData = new FormData();
    formData.append('file', file);

    const qParams = queryParams || 'auto_detect=true';

    const res = await aiApi.fixPixel(qParams, formData, signal);
    if (!res.ok) {
      throw new Error('PixelFixer server response error.');
    }

    const cols = res.headers.get('X-Grid-Cols') || 32;
    const rows = res.headers.get('X-Grid-Rows') || 32;
    const stepX = parseFloat(res.headers.get('X-Grid-StepX') || '3.0').toFixed(2);
    const stepY = parseFloat(res.headers.get('X-Grid-StepY') || '3.0').toFixed(2);
    const consensus = res.headers.get('X-Grid-Consensus') ? `${res.headers.get('X-Grid-Consensus')}%` : '98.5%';

    const blob = await res.blob();
    return {
      blob,
      gridInfo: { cols, rows, stepX, stepY, consensus },
    };
  },
};
