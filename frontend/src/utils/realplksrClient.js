/**
 * RealPLKSR ONNX WebGPU Client Module
 * Chạy mô hình neural RealPLKSR chính thức (SOTA 2024 Partial Large Kernel)
 * trực tiếp trên card đồ họa (GPU) của người dùng thông qua WebGPU & ONNX Runtime Web.
 */

import * as ort from 'onnxruntime-web/webgpu';

// Cấu hình WASM fallback/glue path tới thư mục local public
ort.env.wasm.wasmPaths = '/ort-wasm/';
ort.env.wasm.numThreads = 1;
ort.env.wasm.proxy = false;

const MODEL_PATHS = {
  2: '/models/realplksr/model_x2.onnx',
  4: '/models/realplksr/model_x4.onnx',
};

const sessionCache = {};
const loadingPromises = {};

/**
 * Kiểm tra xem trình duyệt và phần cứng có hỗ trợ WebGPU hay không
 */
export async function isWebGPUSupported() {
  try {
    if (!navigator.gpu) return false;
    const adapter = await navigator.gpu.requestAdapter();
    return !!adapter;
  } catch (e) {
    return false;
  }
}

/**
 * Tải mô hình với báo cáo tiến trình (Progress Callback) và lưu vào Cache Storage
 */
async function fetchModelWithProgress(url, onProgress) {
  const cacheName = 'omniverse-ai-models-v1';
  let cache = null;
  try {
    if (window.caches) {
      cache = await window.caches.open(cacheName);
      const cachedResp = await cache.match(url);
      if (cachedResp) {
        if (onProgress) onProgress('Đang nạp mô hình RealPLKSR từ bộ nhớ đệm (Cache Storage)...', 50);
        return await cachedResp.arrayBuffer();
      }
    }
  } catch (_) {}

  if (onProgress) onProgress('Đang kết nối tới kho mô hình AI RealPLKSR...', 5);
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`Không thể tải mô hình RealPLKSR (${resp.status} ${resp.statusText})`);
  }

  const contentLength = resp.headers.get('Content-Length');
  const totalBytes = contentLength ? parseInt(contentLength, 10) : 29.6 * 1024 * 1024;
  let loadedBytes = 0;

  const reader = resp.body.getReader();
  const chunks = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loadedBytes += value.length;
    if (onProgress && totalBytes) {
      const pct = Math.min(90, Math.round((loadedBytes / totalBytes) * 85) + 5);
      const mbLoaded = (loadedBytes / (1024 * 1024)).toFixed(1);
      const mbTotal = (totalBytes / (1024 * 1024)).toFixed(1);
      onProgress(`Đang nạp trọng số RealPLKSR vào WebGPU VRAM (${mbLoaded}/${mbTotal} MB - ${pct}%)...`, pct);
    }
  }

  const allChunks = new Uint8Array(loadedBytes);
  let position = 0;
  for (const chunk of chunks) {
    allChunks.set(chunk, position);
    position += chunk.length;
  }

  // Lưu vào Cache Storage cho các lần truy cập sau
  if (cache) {
    try {
      const responseToCache = new Response(allChunks.buffer, {
        headers: { 'Content-Type': 'application/octet-stream' }
      });
      await cache.put(url, responseToCache);
    } catch (_) {}
  }

  return allChunks.buffer;
}

/**
 * Khởi tạo InferenceSession ONNX Runtime với WebGPU execution provider
 */
export async function getRealPLKSRSession(scale = 4, onProgress = null) {
  if (sessionCache[scale]) return sessionCache[scale];
  if (loadingPromises[scale]) return loadingPromises[scale];

  loadingPromises[scale] = (async () => {
    const modelUrl = MODEL_PATHS[scale] || MODEL_PATHS[4];
    const modelBuffer = await fetchModelWithProgress(modelUrl, onProgress);

    if (onProgress) onProgress('Đang biên dịch WebGPU Compute Shaders (WGSL)...', 92);

    const session = await ort.InferenceSession.create(modelBuffer, {
      executionProviders: [
        {
          name: 'webgpu',
          deviceType: 'gpu',
          powerPreference: 'high-performance',
        },
        'wasm',
      ],
      graphOptimizationLevel: 'all',
    });

    if (onProgress) onProgress('Khởi tạo mô hình RealPLKSR WebGPU thành công!', 100);
    sessionCache[scale] = session;
    delete loadingPromises[scale];
    return session;
  })();

  return loadingPromises[scale];
}

/**
 * Chuyển đổi ImageData thành Tensor NCHW [1, 3, H, W] chuẩn hóa [0.0, 1.0] (Tối ưu SIMD/Bitwise)
 */
function imageDataToNCHWTensor(imgData, width, height) {
  const data32 = new Uint32Array(imgData.data.buffer);
  const channelSize = width * height;
  const floatData = new Float32Array(3 * channelSize);
  const offsetG = channelSize;
  const offsetB = channelSize * 2;
  const inv255 = 1.0 / 255.0;

  for (let p = 0; p < channelSize; p++) {
    const pixel = data32[p];
    floatData[p] = (pixel & 0xFF) * inv255;
    floatData[offsetG + p] = ((pixel >> 8) & 0xFF) * inv255;
    floatData[offsetB + p] = ((pixel >> 16) & 0xFF) * inv255;
  }

  return new ort.Tensor('float32', floatData, [1, 3, height, width]);
}

/**
 * Chuyển đổi Tensor NCHW [1, 3, H, W] về ImageData RGBA [0, 255] (Tối ưu 32-bit packing)
 */
function nchwTensorToImageData(tensor, width, height) {
  const floatData = tensor.data;
  const channelSize = width * height;
  const imgData = new ImageData(width, height);
  const rgba32 = new Uint32Array(imgData.data.buffer);
  const offsetG = channelSize;
  const offsetB = channelSize * 2;

  for (let p = 0; p < channelSize; p++) {
    const rf = floatData[p] * 255.0;
    const gf = floatData[offsetG + p] * 255.0;
    const bf = floatData[offsetB + p] * 255.0;

    const r = rf < 0 ? 0 : rf > 255 ? 255 : (rf | 0);
    const g = gf < 0 ? 0 : gf > 255 ? 255 : (gf | 0);
    const b = bf < 0 ? 0 : bf > 255 ? 255 : (bf | 0);

    // Ghi 1 DWORD 32-bit trực tiếp: 0xAABBGGRR (Little-endian)
    rgba32[p] = (0xFF000000) | (b << 16) | (g << 8) | r;
  }

  return imgData;
}

/**
 * Xử lý siêu phân giải ảnh bằng mô hình RealPLKSR ONNX qua WebGPU
 * Hỗ trợ tự động chia Tile nếu ảnh lớn hơn kích thước đầu vào của model.
 */
export async function runWebGPURealPLKSR(imageElement, scale = 4, onProgress = null) {
  const session = await getRealPLKSRSession(scale, onProgress);

  const origW = imageElement.naturalWidth || imageElement.width;
  const origH = imageElement.naturalHeight || imageElement.height;

  // Kích thước tile chuẩn của model:
  // x2: 512x512 -> 1024x1024
  // x4: 256x256 -> 1024x1024
  const tileSize = scale === 2 ? 512 : 256;
  const outTileSize = 1024;

  const targetW = origW * scale;
  const targetH = origH * scale;

  const outCanvas = document.createElement('canvas');
  outCanvas.width = targetW;
  outCanvas.height = targetH;
  const outCtx = outCanvas.getContext('2d');

  // Tạo canvas tạm để cắt từng tile
  const tileCanvas = document.createElement('canvas');
  tileCanvas.width = tileSize;
  tileCanvas.height = tileSize;
  const tileCtx = tileCanvas.getContext('2d');

  const numTilesX = Math.ceil(origW / tileSize);
  const numTilesY = Math.ceil(origH / tileSize);
  const totalTiles = numTilesX * numTilesY;
  let processedTiles = 0;

  for (let ty = 0; ty < numTilesY; ty++) {
    for (let tx = 0; tx < numTilesX; tx++) {
      const sx = tx * tileSize;
      const sy = ty * tileSize;
      const sw = Math.min(tileSize, origW - sx);
      const sh = Math.min(tileSize, origH - sy);

      // Vẽ vào tileCanvas (nếu ở rìa thiếu kích thước thì fill đen/pad)
      tileCtx.clearRect(0, 0, tileSize, tileSize);
      tileCtx.drawImage(imageElement, sx, sy, sw, sh, 0, 0, sw, sh);

      const inImgData = tileCtx.getImageData(0, 0, tileSize, tileSize);
      const inputTensor = imageDataToNCHWTensor(inImgData, tileSize, tileSize);

      const feeds = { input: inputTensor };
      const results = await session.run(feeds);
      const outTensor = results.output;

      const outTileImgData = nchwTensorToImageData(outTensor, outTileSize, outTileSize);

      // Tạo canvas tạm chứa kết quả tile phóng to
      const outTileCanvas = document.createElement('canvas');
      outTileCanvas.width = outTileSize;
      outTileCanvas.height = outTileSize;
      outTileCanvas.getContext('2d').putImageData(outTileImgData, 0, 0);

      // Cắt đúng vùng hợp lệ (loại bỏ phần padding nếu ở mép)
      const validOutW = sw * scale;
      const validOutH = sh * scale;
      outCtx.drawImage(outTileCanvas, 0, 0, validOutW, validOutH, sx * scale, sy * scale, validOutW, validOutH);

      processedTiles++;
      if (onProgress) {
        const pct = Math.min(98, Math.round((processedTiles / totalTiles) * 100));
        onProgress(`⚡ RealPLKSR WebGPU: Đang suy luận tile ${processedTiles}/${totalTiles} (${pct}%)...`, pct);
      }
    }
  }

  const blob = await new Promise((resolve) => outCanvas.toBlob(resolve, 'image/png'));
  const upscaledUrl = URL.createObjectURL(blob);

  return {
    upscaledUrl,
    width: targetW,
    height: targetH,
    modelName: `RealPLKSR (2024 SOTA ONNX WebGPU)`,
  };
}
