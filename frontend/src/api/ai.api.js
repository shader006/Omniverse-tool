/**
 * ============================================================
 * DATA ACCESS LAYER: ai.api.js
 * ============================================================
 * Giao tiếp với các AI Workers: Whisper, BiRefNet, PixelFixer.
 * ============================================================
 */

import { apiPostForm, apiFetch } from './apiClient';

export const aiApi = {
  /**
   * POST /api/transcribe
   * Gửi file audio/video lên worker Whisper để nhận diện giọng nói.
   */
  async transcribeAudio(formData) {
    return apiPostForm('/api/transcribe', formData);
  },

  /**
   * POST /api/remove-bg
   * Gửi ảnh lên worker BiRefNet để tách nền AI.
   */
  async removeBackground(formData) {
    return apiPostForm('/api/remove-bg', formData);
  },

  /**
   * POST /api/pixel/fix?queryParams
   * Gửi ảnh lên worker PixelFixer để phục chế pixel grid.
   */
  async fixPixel(queryParams, formData, signal) {
    return apiFetch(`/api/pixel/fix?${queryParams}`, {
      method: 'POST',
      body: formData,
      signal,
    });
  },
};
