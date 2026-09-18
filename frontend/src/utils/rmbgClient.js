/**
 * RMBG Client Module (Hybrid Client-First + Server Fallback)
 * Mô hình: onnx-community/BiRefNet_lite-ONNX (Đồng nhất 100% với Server)
 * Chạy trực tiếp trên trình duyệt bằng WebGPU / WebAssembly qua Transformers.js
 * Tự động Fallback sang Server API (/api/remove-bg) nếu trình duyệt không đủ tài nguyên.
 */

export const BIREFNET_MODEL_ID = 'onnx-community/BiRefNet_lite-ONNX';

let segmenterPipeline = null;
let isPipelineLoading = false;
let pipelinePromise = null;

export function isBrowserSupported() {
  try {
    if (typeof window === 'undefined' || !window.WebAssembly) return false;
    const canvas = document.createElement('canvas');
    return !!(canvas.getContext && canvas.getContext('2d'));
  } catch (e) {
    return false;
  }
}

export async function isWebGPUSupported() {
  try {
    return !!(navigator.gpu && (await navigator.gpu.requestAdapter()));
  } catch (e) {
    return false;
  }
}

export async function isModelCached() {
  try {
    if (typeof window === 'undefined' || !window.caches) return false;
    const cacheNames = await window.caches.keys();
    for (const name of cacheNames) {
      if (name.includes('transformers') || name.includes('onnx')) {
        const cache = await window.caches.open(name);
        const keys = await cache.keys();
        if (keys.some(k => k.url.includes('BiRefNet_lite') || k.url.includes('birefnet'))) {
          return true;
        }
      }
    }
    return false;
  } catch (e) {
    return false;
  }
}

export async function clearModelCache() {
  try {
    if (typeof window === 'undefined' || !window.caches) return false;
    const cacheNames = await window.caches.keys();
    for (const name of cacheNames) {
      if (name.includes('transformers') || name.includes('onnx')) {
        await window.caches.delete(name);
      }
    }
    segmenterPipeline = null;
    return true;
  } catch (e) {
    return false;
  }
}

export async function compressAndResizeImage(imageFile, options = {}) {
  const maxDimension = options.maxDimension || 2048;
  const quality = options.quality || 0.95;
  const originalSize = imageFile.size || 0;
  const isPng = (imageFile.type === 'image/png') || (imageFile.name && imageFile.name.toLowerCase().endsWith('.png'));

  let width, height;
  let sourceElement = null;

  if (typeof window.createImageBitmap === 'function') {
    try {
      sourceElement = await window.createImageBitmap(imageFile);
      width = sourceElement.width;
      height = sourceElement.height;
    } catch (bitmapErr) {
      sourceElement = null;
    }
  }

  if (!sourceElement) {
    sourceElement = await new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(imageFile);
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Không thể đọc dữ liệu ảnh để nén'));
      };
      img.src = url;
    });
    width = sourceElement.naturalWidth || sourceElement.width;
    height = sourceElement.naturalHeight || sourceElement.height;
  }

  let targetWidth = width;
  let targetHeight = height;
  const maxCurrentDim = Math.max(width, height);

  if (maxCurrentDim > maxDimension) {
    const scaleRatio = maxDimension / maxCurrentDim;
    targetWidth = Math.round(width * scaleRatio);
    targetHeight = Math.round(height * scaleRatio);
  }

  if (maxCurrentDim <= maxDimension && (isPng ? originalSize < 3 * 1024 * 1024 : originalSize < 1.5 * 1024 * 1024) && !options.forceCompress) {
    return {
      file: imageFile,
      blob: imageFile,
      originalSize,
      optimizedSize: originalSize,
      width,
      height,
      wasCompressed: false,
      ratioReducedPercent: 0
    };
  }

  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext('2d');

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(sourceElement, 0, 0, targetWidth, targetHeight);

  let mimeType = 'image/jpeg';
  if (isPng) {
    mimeType = 'image/png';
  } else {
    const canWebp = canvas.toDataURL('image/webp').indexOf('data:image/webp') === 0;
    mimeType = canWebp ? 'image/webp' : 'image/jpeg';
  }

  const compressedBlob = await new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Lỗi xuất Blob ảnh sau khi nén'));
    }, mimeType, quality);
  });

  const optimizedSize = compressedBlob.size;
  const ratioReducedPercent = originalSize > 0 
    ? Math.max(0, Math.round((1 - optimizedSize / originalSize) * 100))
    : 0;

  const ext = isPng ? '.png' : (mimeType === 'image/webp' ? '.webp' : '.jpg');
  const baseName = (imageFile.name ? imageFile.name.replace(/\.[^/.]+$/, "") : 'optimized') + ext;
  let optimizedFile;
  try {
    optimizedFile = new File([compressedBlob], baseName, {
      type: mimeType,
      lastModified: Date.now()
    });
  } catch (e) {
    optimizedFile = compressedBlob;
    optimizedFile.name = baseName;
  }

  return {
    file: optimizedFile,
    blob: compressedBlob,
    originalSize,
    optimizedSize,
    width: targetWidth,
    height: targetHeight,
    wasCompressed: true,
    ratioReducedPercent
  };
}

export async function loadBiRefNetClientEngine(onProgress) {
  if (segmenterPipeline) return segmenterPipeline;
  if (isPipelineLoading) return pipelinePromise;

  isPipelineLoading = true;
  pipelinePromise = (async () => {
    onProgress('Đang tải thư viện AI Transformers.js WebGPU/WASM...', 10);

    let transformers;
    try {
      transformers = await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.3.0');
    } catch (e) {
      transformers = await import('https://esm.sh/@huggingface/transformers@3.3.0');
    }

    const { pipeline, env } = transformers;
    env.allowLocalModels = false;
    env.useBrowserCache = true;

    if (env.backends && env.backends.onnx && env.backends.onnx.wasm) {
      env.backends.onnx.wasm.proxy = false;
    }

    const hasWebGPU = await isWebGPUSupported();
    const device = hasWebGPU ? 'webgpu' : 'wasm';
    const deviceLabel = hasWebGPU ? 'WebGPU (Card đồ họa)' : 'WebAssembly (CPU)';

    const alreadyCached = await isModelCached();
    if (alreadyCached) {
      onProgress(`⚡ Đã tìm thấy BiRefNet-Lite trong Cache trình duyệt! Đang khởi tạo tức thì trên ${deviceLabel}...`, 25);
    } else {
      onProgress(`Đang tải mô hình BiRefNet-Lite ONNX lần đầu về Cache (${deviceLabel})...`, 25);
    }

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

export function applyBackgroundColorToBlob(imageBlob, bgColor) {
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

export async function processOnClient(imageFile, options = {}, onProgress = () => {}) {
  if (!isBrowserSupported()) {
    throw new Error('Trình duyệt của bạn không hỗ trợ WebAssembly/WebGPU để chạy BiRefNet-Lite tại máy.');
  }

  const startTime = performance.now();
  const segmenter = await loadBiRefNetClientEngine(onProgress);

  onProgress('BiRefNet-Lite đang phân tích cấu trúc viền tóc & chi tiết...', 88);

  const imageUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(imageFile);
  });

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
    const res = await fetch(output);
    transparentBlob = await res.blob();
  }

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

export function isMobileDevice() {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
    (typeof navigator !== 'undefined' && navigator.userAgent) || ''
  );
}

export async function processOnServer(imageFile, options = {}, onProgress = () => {}) {
  onProgress('Đang gửi ảnh tới Máy chủ AI BiRefNet-Lite...', 30);
  const startTime = performance.now();

  const formData = new FormData();
  formData.append('file', imageFile);
  formData.append('model', options.model || 'birefnet-lite');
  formData.append('bg_color', options.bgColor || 'transparent');
  formData.append('alpha_matting', options.alphaMatting ? 'true' : 'false');

  onProgress('Máy chủ đang phân tích mô hình BiRefNet-Lite OpenVINO SOTA...', 50);

  let response;
  try {
    response = await fetch('/api/remove-bg', {
      method: 'POST',
      body: formData
    });
  } catch (netErr) {
    throw new Error(`Không thể kết nối tới máy chủ (${netErr.message || 'Mất kết nối'}). Vui lòng kiểm tra lại mạng.`);
  }

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

  let transparentBlob = null;
  if (data.download_url) {
    try {
      const blobResp = await fetch(data.download_url);
      if (blobResp.ok) {
        transparentBlob = await blobResp.blob();
      }
    } catch (e) {
      console.warn('Không thể fetch transparentBlob từ download_url:', e);
    }
  }
  if (!transparentBlob && data.preview_base64 && data.preview_base64.startsWith('data:')) {
    try {
      const b64Res = await fetch(data.preview_base64);
      transparentBlob = await b64Res.blob();
    } catch (e) {
      console.warn('Không thể tạo blob từ preview_base64:', e);
    }
  }

  return {
    success: true,
    engine: 'server',
    engineDisplay: 'Máy chủ (OpenVINO BiRefNet-Lite)',
    filename: data.filename || 'removed_bg.png',
    downloadUrl: data.download_url,
    previewBase64: data.preview_base64 || data.download_url,
    transparentBlob: transparentBlob,
    processingTimeMs: data.processing_time_ms || durationMs,
    resultSizeBytes: data.result_size_bytes || 0,
    metadata: data.metadata || {
      engine: 'Server Python OpenVINO',
      model_display: 'Server BiRefNet-Lite',
      execution_device: 'Server CPU/GPU'
    }
  };
}

export async function removeBackgroundHybrid(imageFile, options = {}, onProgress = () => {}) {
  const targetEngine = options.engine || 'client';
  let fileToProcess = imageFile;
  let compressionMeta = null;
  const isMobile = isMobileDevice();

  if (options.autoCompress !== false) {
    try {
      onProgress('Đang phân tích & tối ưu hóa kích thước ảnh...', 5);
      const compResult = await compressAndResizeImage(imageFile, {
        maxDimension: options.maxDimension || 2048,
        quality: options.quality || 0.92
      });
      if (compResult.wasCompressed) {
        fileToProcess = compResult.file;
        compressionMeta = compResult;
        const origMB = (compResult.originalSize / 1024 / 1024).toFixed(1);
        const optMB = (compResult.optimizedSize / 1024 / 1024).toFixed(2);
        onProgress(`Đã tối ưu hóa ảnh: ${origMB}MB -> ${optMB}MB (Giảm ${compResult.ratioReducedPercent}%)`, 10);
      }
    } catch (compErr) {
      console.warn('[RMBG] Bỏ qua bước nén ảnh do lỗi:', compErr);
    }
  }

  if (targetEngine === 'server') {
    const serverResult = await processOnServer(fileToProcess, options, onProgress);
    if (compressionMeta) serverResult.compressionMeta = compressionMeta;
    return serverResult;
  }

  try {
    const clientResult = await processOnClient(fileToProcess, options, onProgress);
    if (compressionMeta) clientResult.compressionMeta = compressionMeta;
    return clientResult;
  } catch (clientErr) {
    console.warn('⚠️ [RMBG Client] Không thể tải/chạy trên trình duyệt, chuyển sang Server Fallback:', clientErr);

    const noticeText = isMobile
      ? 'Thiết bị di động không hỗ trợ tải mô hình 224MB, đã tự động chuyển sang Máy chủ BiRefNet-Lite.'
      : `Trình duyệt gặp sự cố (${clientErr.message || 'Mạng/RAM'}), đã tự động chuyển sang Máy chủ BiRefNet-Lite.`;

    onProgress(noticeText, 30);
    await new Promise(r => setTimeout(r, 200));

    const serverResult = await processOnServer(fileToProcess, options, onProgress);
    serverResult.fallbackNotice = noticeText;
    if (compressionMeta) serverResult.compressionMeta = compressionMeta;
    return serverResult;
  }
}

export async function changeExistingBackgroundColor(transparentBlobOrDataUrl, newBgColor) {
  if (!transparentBlobOrDataUrl) return null;
  let blob = transparentBlobOrDataUrl;
  if (typeof transparentBlobOrDataUrl === 'string') {
    const res = await fetch(transparentBlobOrDataUrl);
    blob = await res.blob();
  }
  return await applyBackgroundColorToBlob(blob, newBgColor);
}
