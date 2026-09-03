/**
 * RMBG Client Module (Hybrid Client-First + Server Fallback)
 * Mô hình: onnx-community/BiRefNet_lite-ONNX (Đồng nhất 100% với Server)
 * Chạy trực tiếp trên trình duyệt bằng WebGPU / WebAssembly qua Transformers.js
 * Tự động Fallback sang Server API (/api/remove-bg) nếu trình duyệt không đủ tài nguyên.
 */

(function(window) {
  'use strict';

  // Định danh mô hình đồng nhất chính xác với Server (app/rmbg/remover.py:76)
  const BIREFNET_MODEL_ID = 'onnx-community/BiRefNet_lite-ONNX';

  let segmenterPipeline = null;
  let isPipelineLoading = false;
  let pipelinePromise = null;

  /**
   * Kiểm tra khả năng hỗ trợ WebAssembly và Canvas trên trình duyệt
   */
  function isBrowserSupported() {
    try {
      if (typeof window === 'undefined' || !window.WebAssembly) return false;
      const canvas = document.createElement('canvas');
      return !!(canvas.getContext && canvas.getContext('2d'));
    } catch (e) {
      return false;
    }
  }

  /**
   * Kiểm tra trình duyệt có hỗ trợ WebGPU hay không để tăng tốc tối đa
   */
  async function isWebGPUSupported() {
    try {
      return !!(navigator.gpu && (await navigator.gpu.requestAdapter()));
    } catch (e) {
      return false;
    }
  }

  /**
   * Tải động thư viện @huggingface/transformers và khởi tạo mô hình BiRefNet-Lite ONNX
   */
  async function loadBiRefNetClientEngine(onProgress) {
    if (segmenterPipeline) return segmenterPipeline;
    if (isPipelineLoading) return pipelinePromise;

    isPipelineLoading = true;
    pipelinePromise = (async () => {
      onProgress('Đang tải thư viện AI Transformers.js WebGPU/WASM...', 10);

      // Nạp Transformers.js v3 từ CDN
      let transformers;
      try {
        transformers = await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.3.0');
      } catch (e) {
        transformers = await import('https://esm.sh/@huggingface/transformers@3.3.0');
      }

      const { pipeline, env } = transformers;
      env.allowLocalModels = false;
      if (env.backends && env.backends.onnx && env.backends.onnx.wasm) {
        env.backends.onnx.wasm.proxy = false;
      }

      const hasWebGPU = await isWebGPUSupported();
      const device = hasWebGPU ? 'webgpu' : 'wasm';
      const deviceLabel = hasWebGPU ? 'WebGPU (Card đồ họa)' : 'WebAssembly (CPU)';

      onProgress(`Đang tải mô hình BiRefNet-Lite ONNX trên ${deviceLabel}...`, 25);

      // Khởi tạo pipeline Image Segmentation với BiRefNet-Lite
      segmenterPipeline = await pipeline('image-segmentation', BIREFNET_MODEL_ID, {
        device: device,
        dtype: hasWebGPU ? 'fp16' : 'fp32',
        progress_callback: (progressInfo) => {
          if (progressInfo && progressInfo.status === 'progress' && progressInfo.total) {
            const pct = Math.min(85, Math.round(25 + (progressInfo.loaded / progressInfo.total) * 55));
            const file = progressInfo.file || 'model.onnx';
            onProgress(`Đang nạp mô hình BiRefNet-Lite (${file}): ${pct}%`, pct);
          }
        }
      });

      onProgress('Mô hình BiRefNet-Lite trên Client đã sẵn sàng!', 85);
      return segmenterPipeline;
    })();

    try {
      return await pipelinePromise;
    } finally {
      isPipelineLoading = false;
    }
  }

  /**
   * Vẽ ảnh đã tách nền lên Canvas với màu nền mong muốn (nếu có)
   */
  function applyBackgroundColorToBlob(imageBlob, bgColor) {
    return new Promise((resolve, reject) => {
      if (!bgColor || bgColor === 'transparent') {
        const url = URL.createObjectURL(imageBlob);
        const reader = new FileReader();
        reader.onload = () => {
          resolve({
            blob: imageBlob,
            dataUrl: reader.result,
            downloadUrl: url,
            width: null,
            height: null
          });
        };
        reader.onerror = reject;
        reader.readAsDataURL(imageBlob);
        return;
      }

      const img = new Image();
      const objectUrl = URL.createObjectURL(imageBlob);

      img.onload = () => {
        URL.revokeObjectURL(objectUrl);
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth || img.width;
        canvas.height = img.naturalHeight || img.height;
        const ctx = canvas.getContext('2d');

        ctx.fillStyle = bgColor;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);

        canvas.toBlob((finalBlob) => {
          if (!finalBlob) {
            reject(new Error('Lỗi chuyển đổi Canvas sang Blob ảnh'));
            return;
          }
          const finalDataUrl = canvas.toDataURL('image/png');
          const finalDownloadUrl = URL.createObjectURL(finalBlob);

          resolve({
            blob: finalBlob,
            dataUrl: finalDataUrl,
            downloadUrl: finalDownloadUrl,
            width: canvas.width,
            height: canvas.height
          });
        }, 'image/png');
      };

      img.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error('Lỗi đọc ảnh kết quả để đổi màu nền'));
      };

      img.src = objectUrl;
    });
  }

  /**
   * Chuyển đổi output của Transformers.js (RawImage) sang Blob PNG
   */
  async function rawImageToBlob(rawImg) {
    if (rawImg && rawImg.toBlob) {
      return await rawImg.toBlob('image/png');
    }
    const canvas = document.createElement('canvas');
    canvas.width = rawImg.width;
    canvas.height = rawImg.height;
    const ctx = canvas.getContext('2d');
    const imgData = ctx.createImageData(rawImg.width, rawImg.height);
    imgData.data.set(rawImg.data);
    ctx.putImageData(imgData, 0, 0);

    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Không thể tạo blob từ Canvas'));
      }, 'image/png');
    });
  }

  /**
   * Xử lý tách nền bằng BiRefNet-Lite trực tiếp trên Trình duyệt
   */
  async function processOnClient(imageFile, options = {}, onProgress = () => {}) {
    if (!isBrowserSupported()) {
      throw new Error('Trình duyệt của bạn không hỗ trợ WebAssembly/WebGPU để chạy BiRefNet-Lite tại máy.');
    }

    const startTime = performance.now();
    const segmenter = await loadBiRefNetClientEngine(onProgress);

    onProgress('BiRefNet-Lite đang phân tích cấu trúc viền tóc & chi tiết...', 88);

    // Chuyển File sang Data URL để segmenter xử lý
    const imageUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(imageFile);
    });

    // Thực thi suy luận BiRefNet-Lite trên WebGPU/WASM
    const output = await segmenter(imageUrl);

    onProgress('Đang xử lý kết quả tách nền và ghép màu Canvas...', 96);

    let transparentBlob;
    if (output && output.toBlob) {
      transparentBlob = await output.toBlob('image/png');
    } else if (Array.isArray(output) && output[0] && output[0].mask) {
      transparentBlob = await rawImageToBlob(output[0].mask);
    } else if (output && output.data) {
      transparentBlob = await rawImageToBlob(output);
    } else {
      // Fallback nếu output là dạng url/canvas
      const res = await fetch(output);
      transparentBlob = await res.blob();
    }

    // Đổ màu nền theo lựa chọn của người dùng (nếu có)
    const bgColor = options.bgColor || 'transparent';
    const finalResult = await applyBackgroundColorToBlob(transparentBlob, bgColor);

    const durationMs = Math.round(performance.now() - startTime);
    const baseName = (imageFile.name || 'image').replace(/\.[^/.]+$/, '');
    const outFilename = `${baseName}_birefnet_client.png`;

    return {
      success: true,
      engine: 'client-wasm',
      engineDisplay: 'Trình duyệt (BiRefNet-Lite ONNX WebGPU/WASM)',
      filename: outFilename,
      blob: finalResult.blob,
      downloadUrl: finalResult.downloadUrl,
      previewBase64: finalResult.dataUrl,
      transparentBlob: transparentBlob,
      processingTimeMs: durationMs,
      resultSizeBytes: finalResult.blob.size,
      width: finalResult.width,
      height: finalResult.height,
      metadata: {
        engine: 'Client BiRefNet-Lite (Transformers.js)',
        model_display: 'BiRefNet-Lite (Đồng nhất Model Server)',
        execution_device: 'Client Device (Zero Server Load)',
        timing_ms: { total: durationMs }
      }
    };
  }

  /**
   * Gọi API Server Fallback (/api/remove-bg)
   */
  async function processOnServer(imageFile, options = {}, onProgress = () => {}) {
    const startTime = performance.now();
    onProgress('Đang gửi ảnh lên Máy chủ AI BiRefNet-Lite xử lý...', 20);

    const formData = new FormData();
    formData.append('file', imageFile);
    formData.append('model', options.model || 'birefnet-lite');
    formData.append('bg_color', options.bgColor || 'transparent');
    formData.append('alpha_matting', options.alphaMatting ? 'true' : 'false');

    onProgress('Máy chủ đang phân tích mô hình BiRefNet-Lite OpenVINO SOTA...', 50);

    const response = await fetch('/api/remove-bg', {
      method: 'POST',
      body: formData
    });

    onProgress('Đang nhận kết quả từ Máy chủ...', 90);

    const respText = await response.text();
    let data;
    try {
      data = JSON.parse(respText);
    } catch (parseErr) {
      throw new Error('Máy chủ phản hồi định dạng không hợp lệ.');
    }

    if (!response.ok || !data.success) {
      throw new Error(data.detail || data.error || 'Máy chủ xử lý tách nền thất bại.');
    }

    const durationMs = Math.round(performance.now() - startTime);

    return {
      success: true,
      engine: 'server',
      engineDisplay: 'Máy chủ (OpenVINO BiRefNet-Lite)',
      filename: data.filename || 'removed_bg.png',
      downloadUrl: data.download_url,
      previewBase64: data.preview_base64 || data.download_url,
      transparentBlob: null,
      processingTimeMs: data.processing_time_ms || durationMs,
      resultSizeBytes: data.result_size_bytes || 0,
      metadata: data.metadata || {
        engine: 'Server Python OpenVINO',
        model_display: 'Server BiRefNet-Lite',
        execution_device: 'Server CPU/GPU'
      }
    };
  }

  /**
   * Hàm điều phối Hybrid:
   * 1. Nếu engine = 'server': Gọi thẳng server
   * 2. Nếu engine = 'client' hoặc 'auto': Chạy BiRefNet-Lite Client trước; Nếu lỗi -> Tự động Fallback sang server
   */
  async function removeBackgroundHybrid(imageFile, options = {}, onProgress = () => {}) {
    const targetEngine = options.engine || 'client';

    if (targetEngine === 'server') {
      return await processOnServer(imageFile, options, onProgress);
    }

    try {
      return await processOnClient(imageFile, options, onProgress);
    } catch (clientErr) {
      console.warn('⚠️ [RMBG Client] Lỗi khi chạy BiRefNet-Lite trên trình duyệt, đang chuyển sang Server Fallback:', clientErr);

      onProgress(`Trình duyệt gặp lỗi (${clientErr.message || 'WASM'}). Đang tự động chuyển sang Máy chủ BiRefNet-Lite...`, 20);

      await new Promise(r => setTimeout(r, 300));

      const serverResult = await processOnServer(imageFile, options, onProgress);
      serverResult.fallbackNotice = `Đã tự động chuyển sang máy chủ xử lý do: ${clientErr.message || 'Thiết bị không đủ tài nguyên'}`;
      return serverResult;
    }
  }

  /**
   * Đổi màu nền cực nhanh trên Canvas cho ảnh đã tách nền trước đó (5ms)
   */
  async function changeExistingBackgroundColor(transparentBlobOrDataUrl, newBgColor) {
    if (!transparentBlobOrDataUrl) return null;
    let blob = transparentBlobOrDataUrl;
    if (typeof transparentBlobOrDataUrl === 'string') {
      const res = await fetch(transparentBlobOrDataUrl);
      blob = await res.blob();
    }
    return await applyBackgroundColorToBlob(blob, newBgColor);
  }

  // Export module ra global
  window.RmbgClient = {
    BIREFNET_MODEL_ID,
    isBrowserSupported,
    isWebGPUSupported,
    processOnClient,
    processOnServer,
    removeBackgroundHybrid,
    changeExistingBackgroundColor,
    applyBackgroundColorToBlob
  };

})(window);
