/**
 * Whisper Client Module (Hybrid WebGPU Client-First + Server Fallback)
 * Mô hình WebGPU: onnx-community/whisper-tiny
 * Tự động Fallback sang Server API (/api/transcribe) nếu trình duyệt không hỗ trợ WebGPU
 * hoặc gặp lỗi bộ nhớ / định dạng audio.
 */

export const WHISPER_MODEL_ID = 'onnx-community/whisper-tiny';
export const LOCAL_WHISPER_MODEL_ID = 'whisper-tiny';

let transcriberPipeline = null;
let isPipelineLoading = false;
let pipelinePromise = null;

export function isBrowserAudioSupported() {
  try {
    return !!(window.AudioContext || window.webkitAudioContext);
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

export function isMobileDevice() {
  if (typeof navigator === 'undefined') return false;
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

export async function isModelCached() {
  try {
    if (typeof window === 'undefined' || !window.caches) return false;
    const cacheNames = await window.caches.keys();
    for (const name of cacheNames) {
      if (name.includes('transformers') || name.includes('onnx')) {
        const cache = await window.caches.open(name);
        const keys = await cache.keys();
        if (keys.some(k => k.url.includes('whisper'))) {
          return true;
        }
      }
    }
    return false;
  } catch (e) {
    return false;
  }
}

export async function decodeAudioToMono16k(audioFile) {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) throw new Error('AudioContext không được hỗ trợ trên trình duyệt.');

  const audioContext = new AudioCtx({ sampleRate: 16000 });
  try {
    const arrayBuffer = await audioFile.arrayBuffer();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

    let channelData;
    if (audioBuffer.numberOfChannels === 1) {
      channelData = audioBuffer.getChannelData(0);
    } else {
      const ch0 = audioBuffer.getChannelData(0);
      const ch1 = audioBuffer.getChannelData(1);
      channelData = new Float32Array(ch0.length);
      for (let i = 0; i < ch0.length; i++) {
        channelData[i] = (ch0[i] + ch1[i]) / 2;
      }
    }
    return {
      audioData: channelData,
      duration: Number(audioBuffer.duration.toFixed(2))
    };
  } finally {
    try {
      await audioContext.close();
    } catch (_) {}
  }
}

function formatTimestampSrt(seconds) {
  const pad = (num, size) => String(num).padStart(size, '0');
  const totalMs = Math.round(seconds * 1000);
  const hrs = Math.floor(totalMs / 3600000);
  const mins = Math.floor((totalMs % 3600000) / 60000);
  const secs = Math.floor((totalMs % 60000) / 1000);
  const ms = totalMs % 1000;
  return `${pad(hrs, 2)}:${pad(mins, 2)}:${pad(secs, 2)},${pad(ms, 3)}`;
}

function formatTimestampVtt(seconds) {
  const pad = (num, size) => String(num).padStart(size, '0');
  const totalMs = Math.round(seconds * 1000);
  const hrs = Math.floor(totalMs / 3600000);
  const mins = Math.floor((totalMs % 3600000) / 60000);
  const secs = Math.floor((totalMs % 60000) / 1000);
  const ms = totalMs % 1000;
  return `${pad(hrs, 2)}:${pad(mins, 2)}:${pad(secs, 2)}.${pad(ms, 3)}`;
}

export function buildSubtitleOutputs(segments, baseFilename = 'transcript') {
  const txtContent = segments.map(s => s.text).join('\n\n');
  const srtContent = segments.map((s, idx) => {
    const from = formatTimestampSrt(s.start);
    const to = formatTimestampSrt(s.end);
    return `${idx + 1}\n${from} --> ${to}\n${s.text}\n`;
  }).join('\n');
  const vttContent = `WEBVTT\n\n` + segments.map((s, idx) => {
    const from = formatTimestampVtt(s.start);
    const to = formatTimestampVtt(s.end);
    return `${idx + 1}\n${from} --> ${to}\n${s.text}\n`;
  }).join('\n');
  const jsonContent = JSON.stringify({ segments, text: txtContent }, null, 2);

  return {
    txt: txtContent,
    srt: srtContent,
    vtt: vttContent,
    json: jsonContent
  };
}

export async function loadWhisperClientEngine(onProgress = () => {}) {
  if (transcriberPipeline) return transcriberPipeline;
  if (isPipelineLoading) return pipelinePromise;

  isPipelineLoading = true;
  pipelinePromise = (async () => {
    onProgress('Đang tải thư viện AI Transformers.js (WebGPU)...', 5);

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
    if (!hasWebGPU) {
      throw new Error('Trình duyệt không hỗ trợ WebGPU, chuyển sang máy chủ.');
    }

    // 1. Kiểm tra xem Máy chủ nội bộ có sẵn mô hình Whisper hay không (/models/whisper-tiny)
    let useLocalServer = false;
    try {
      const probe = await fetch('/models/whisper-tiny/config.json', { method: 'HEAD' });
      if (probe.ok) {
        useLocalServer = true;
      }
    } catch (_) {}

    let targetModelId = WHISPER_MODEL_ID;
    if (useLocalServer) {
      console.log('⚡ [Whisper WebGPU] Phát hiện mô hình cục bộ trên Server! Tải siêu tốc từ /models/whisper-tiny...');
      env.remoteHost = window.location.origin;
      env.remotePathTemplate = 'models/{model}/';
      targetModelId = LOCAL_WHISPER_MODEL_ID;
    } else {
      console.log('🌐 [Whisper WebGPU] Server chưa có sẵn model, dự phòng tải từ Hugging Face...');
      env.remoteHost = 'https://huggingface.co';
      env.remotePathTemplate = '{model}/resolve/{revision}/';
      targetModelId = WHISPER_MODEL_ID;
    }

    const cached = await isModelCached();
    if (cached) {
      onProgress('⚡ Đã tìm thấy Whisper trong Cache trình duyệt! Đang nạp mô hình vào WebGPU...', 15);
    } else if (useLocalServer) {
      onProgress('⚡ Đang tải mô hình Whisper AI từ Máy chủ nội bộ (Tốc độ LAN siêu nhanh)...', 10);
    } else {
      onProgress('Đang kết nối HuggingFace tải mô hình Whisper AI ONNX...', 10);
    }

    const transcriber = await pipeline('automatic-speech-recognition', targetModelId, {
      device: 'webgpu',
      dtype: {
        encoder_model: 'q4',
        decoder_model_merged: 'q4'
      },
      progress_callback: (p) => {
        if (p.status === 'progress' && p.total) {
          const fileName = (p.file || '').split('/').pop() || 'model';
          const loadedMB = (p.loaded / 1024 / 1024).toFixed(1);
          const totalMB = (p.total / 1024 / 1024).toFixed(1);
          const filePct = Math.round((p.loaded / p.total) * 100);
          const overallPct = Math.min(80, Math.round(filePct * 0.65) + 15);
          onProgress(`Đang nạp ${fileName}: ${loadedMB}/${totalMB} MB (${filePct}%)`, overallPct);
        } else if (p.status === 'done' && p.file && p.file.includes('decoder')) {
          onProgress('Đã nạp xong file model! Đang biên dịch Shader WebGPU trên phần cứng của bạn...', 80);
        }
      }
    });

    onProgress('Mô hình Whisper AI đã sẵn sàng trên WebGPU!', 85);
    transcriberPipeline = transcriber;
    isPipelineLoading = false;
    return transcriber;
  })().catch(err => {
    isPipelineLoading = false;
    pipelinePromise = null;
    throw err;
  });

  return pipelinePromise;
}

export async function transcribeOnClient(audioFile, options = {}, onProgress = () => {}) {
  const startTime = performance.now();
  console.time('⏱️ [Whisper WebGPU] Tổng thời gian');

  onProgress('Đang phân tích và giải mã tín hiệu âm thanh (16kHz)...', 5);
  console.time('⏱️ [Whisper WebGPU] 1. Giải mã Audio');
  const { audioData, duration } = await decodeAudioToMono16k(audioFile);
  console.timeEnd('⏱️ [Whisper WebGPU] 1. Giải mã Audio');
  console.log(`[Whisper WebGPU] Đã giải mã audio: thời lượng ${duration}s, ${audioData.length} samples 16kHz`);

  onProgress('Đang khởi tạo bộ suy luận Whisper WebGPU...', 15);
  console.time('⏱️ [Whisper WebGPU] 2. Tải & Nạp Model');
  const transcriber = await loadWhisperClientEngine(onProgress);
  console.timeEnd('⏱️ [Whisper WebGPU] 2. Tải & Nạp Model');

  onProgress(`AI WebGPU đang nhận diện giọng nói (thời lượng audio: ${duration}s)...`, 85);
  console.time('⏱️ [Whisper WebGPU] 3. Suy luận AI WebGPU');

  const langCode = options.language && options.language !== 'auto' ? options.language : null;
  const taskName = options.task || 'transcribe';

  const output = await transcriber(audioData, {
    language: langCode,
    task: taskName,
    return_timestamps: true,
    chunk_length_s: 30,
    stride_length_s: 5
  });
  console.timeEnd('⏱️ [Whisper WebGPU] 3. Suy luận AI WebGPU');
  console.timeEnd('⏱️ [Whisper WebGPU] Tổng thời gian');

  onProgress('Đang trích xuất cấu trúc phụ đề...', 95);

  const rawChunks = Array.isArray(output.chunks) ? output.chunks : [];
  const segments = rawChunks.map((chunk, idx) => {
    const s = Array.isArray(chunk.timestamp) ? (chunk.timestamp[0] || 0) : 0;
    const e = Array.isArray(chunk.timestamp) ? (chunk.timestamp[1] || duration) : duration;
    return {
      id: idx + 1,
      start: Number(s.toFixed(2)),
      end: Number(e.toFixed(2)),
      timestamp_from: formatTimestampSrt(s),
      timestamp_to: formatTimestampSrt(e),
      text: (chunk.text || '').trim()
    };
  });

  const fullText = (output.text || '').trim() || segments.map(s => s.text).join('\n\n');
  const baseName = (audioFile.name || 'transcript').replace(/\.[^/.]+$/, '');
  const format = options.format || 'txt';
  const subtitleFiles = buildSubtitleOutputs(segments.length > 0 ? segments : [{ id: 1, start: 0, end: duration, text: fullText, timestamp_from: '00:00:00,000', timestamp_to: formatTimestampSrt(duration) }], baseName);

  let targetContent = subtitleFiles.txt;
  let mimeType = 'text/plain;charset=utf-8';
  if (format === 'srt') {
    targetContent = subtitleFiles.srt;
  } else if (format === 'vtt') {
    targetContent = subtitleFiles.vtt;
    mimeType = 'text/vtt;charset=utf-8';
  } else if (format === 'json') {
    targetContent = subtitleFiles.json;
    mimeType = 'application/json;charset=utf-8';
  }

  const outBlob = new Blob([targetContent], { type: mimeType });
  const downloadUrl = URL.createObjectURL(outBlob);
  const durationMs = Number(((performance.now() - startTime) / 1000).toFixed(2));

  return {
    success: true,
    engine: 'client-webgpu',
    engineDisplay: '⚡ Trình duyệt (Whisper WebGPU • 0 tải Server)',
    filename: `${baseName}.${format}`,
    download_url: downloadUrl,
    text: fullText,
    segments: segments.length > 0 ? segments : [{ id: 1, start: 0, end: duration, text: fullText, timestamp_from: '00:00:00,000', timestamp_to: formatTimestampSrt(duration) }],
    audio_duration: duration,
    processing_time: durationMs,
    detected_language: langCode || 'vi',
    model_used: 'Whisper-Tiny (WebGPU q4)',
    device: 'webgpu',
    backend: 'Client WebGPU'
  };
}

export async function transcribeOnServer(audioFile, options = {}, onProgress = () => {}) {
  const reqStartTime = performance.now();
  onProgress('Đang gửi âm thanh tới Máy chủ AI...', 10);

  const formData = new FormData();
  formData.append('file', audioFile);
  formData.append('language', options.language || 'auto');
  formData.append('format', options.format || 'txt');
  formData.append('task', options.task || 'transcribe');

  const res = await fetch('/api/transcribe', {
    method: 'POST',
    body: formData
  });

  const respText = await res.text();
  let data;
  try {
    data = JSON.parse(respText);
  } catch (parseErr) {
    if (respText.includes('<!DOCTYPE') || respText.includes('<html')) {
      throw new Error(`Máy chủ đang bận hoặc khởi động lại (HTTP ${res.status}). Vui lòng thử lại.`);
    }
    throw new Error('Phản hồi từ máy chủ không hợp lệ: ' + respText.slice(0, 80));
  }

  if (!res.ok || !data.success) {
    throw new Error(data.detail || data.error || 'Quá trình trích xuất giọng nói thất bại.');
  }

  const totalElapsedSec = Number(((performance.now() - reqStartTime) / 1000).toFixed(2));
  data.total_e2e_time = totalElapsedSec;

  const backendName = data.backend || (data.device === 'gpu' ? 'Máy chủ GPU Pail (RTX 3090)' : 'Máy chủ Dự phòng Shader (CPU i9)');
  data.engineDisplay = data.backend?.includes('3090')
    ? '🚀 Máy chủ GPU Pail (RTX 3090 CUDA)'
    : '💻 Máy chủ Dự phòng Shader (CPU i9)';

  return data;
}

/**
 * Luồng hợp nhất 3 tầng tự động:
 * Tầng 1: WebGPU trên trình duyệt (ưu tiên cao nhất)
 * Tầng 2: Máy chủ remote Pail (RTX 3090)
 * Tầng 3: Máy chủ local Shader (CPU i9)
 */
export async function transcribeHybrid(audioFile, options = {}, onProgress = () => {}) {
  const hasWebGPU = await isWebGPUSupported();
  const isMobile = isMobileDevice();

  // 1. Thử nghiệm WebGPU trên trình duyệt (ưu tiên số 1)
  if (hasWebGPU && !isMobile) {
    try {
      console.log('🚀 [Whisper] Đang khởi động suy luận Client WebGPU...');
      return await transcribeOnClient(audioFile, options, onProgress);
    } catch (webgpuErr) {
      console.warn('⚠️ [Whisper WebGPU Client] Lỗi/Không thể chạy WebGPU, chuyển tiếp sang Máy chủ:', webgpuErr);
      onProgress('⚡ WebGPU gặp lỗi, đang tự động chuyển tiếp sang Máy chủ (Pail ➡️ Shader)...', 25);
    }
  }

  // 2. Tự động gửi lên Server (Server có failover Pail RTX 3090 -> Shader CPU i9)
  return await transcribeOnServer(audioFile, options, onProgress);
}
