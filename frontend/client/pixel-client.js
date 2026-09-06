/**
 * Pixel Refiner Studio - Native Client-side Engine (Enhanced Edition)
 * Converts images & AI pixel art into production-ready crisp game sprites.
 * Features:
 *  - Multi-candidate Grid Detection (Grid Candidates with Confidence %)
 *  - Purpose Presets (Crisp Sprite, Transparent Icon, Retro Console, Photo to Pixel, Fine Details)
 *  - Boundary-Connected Flood Fill (BFS border fill protecting internal white eyes / clothing)
 *  - Expanded Retro Palettes: Game Boy, PICO-8, NES, SNES, PC-9801, MSX1, Cyberpunk, Monochrome
 *  - Color Quantization / Max Colors Limiter
 *  - Dithering (Floyd-Steinberg, Bayer Matrix 4x4)
 *  - Sprite Outline (4-way cross / 8-way box with custom colors)
 *  - Forced Dimensions Resize (16x16, 32x32, 64x64, etc.)
 *  - Auto Trim & Multi-scale Exports (1x, 2x, 4x, 8x, 16x)
 */

(function () {
  'use strict';

  // =========================================================================
  // 1. RETRO PALETTES DEFINITIONS
  // =========================================================================
  const RETRO_PALETTES = {
    original: { name: 'Giữ màu gốc (True Color)', colors: null },
    gameboy: {
      name: 'Game Boy Classic (4 màu)',
      colors: [
        [155, 188, 15],  // #9bbc0f
        [139, 172, 15],  // #8bac0f
        [48, 98, 48],    // #306230
        [15, 56, 15],    // #0f380f
      ]
    },
    pico8: {
      name: 'PICO-8 Fantasy (16 màu)',
      colors: [
        [0, 0, 0], [29, 43, 83], [126, 37, 83], [0, 135, 81],
        [171, 82, 54], [95, 87, 79], [194, 195, 199], [255, 241, 232],
        [255, 0, 77], [255, 163, 0], [255, 236, 39], [0, 228, 54],
        [41, 173, 255], [131, 118, 156], [255, 119, 168], [255, 204, 170]
      ]
    },
    nes: {
      name: 'NES / Famicom 8-Bit (54 màu)',
      colors: [
        [124,124,124], [0,0,252], [0,0,188], [68,40,188], [148,0,132], [168,0,32],
        [168,16,0], [136,20,0], [80,48,0], [0,120,0], [0,104,0], [0,88,0],
        [0,64,88], [0,0,0], [188,188,188], [0,120,248], [0,88,248], [104,68,252],
        [216,0,204], [228,0,88], [248,56,0], [228,92,16], [172,124,0], [0,184,0],
        [0,168,0], [0,168,68], [0,136,136], [248,248,248], [60,188,252], [104,136,252],
        [152,120,248], [248,120,248], [248,88,152], [248,120,88], [252,160,68], [248,184,0],
        [184,248,24], [88,216,84], [88,248,152], [0,232,216], [120,120,120], [252,252,252],
        [164,228,252], [184,184,248], [216,184,248], [248,184,248], [248,164,192], [240,208,176],
        [252,224,168], [248,216,120], [216,248,120], [184,248,184], [184,248,216], [0,252,252]
      ]
    },
    snes: {
      name: 'SNES 16-Bit Curated (32 màu)',
      colors: [
        [16,16,16], [48,48,48], [96,96,96], [152,152,152], [208,208,208], [255,255,255],
        [120,32,16], [184,64,32], [232,112,56], [248,184,104], [96,56,16], [160,96,32],
        [216,152,64], [248,216,120], [32,80,32], [56,136,48], [104,192,72], [176,232,128],
        [16,48,96], [32,96,160], [64,152,224], [128,208,248], [80,24,96], [136,48,144],
        [192,88,192], [240,152,224], [144,16,48], [208,40,72], [248,96,112], [248,160,168],
        [240,200,32], [72,160,152]
      ]
    },
    pc98: {
      name: 'NEC PC-9801 (16 màu Nhật Bản)',
      colors: [
        [0, 0, 0], [0, 0, 255], [255, 0, 0], [255, 0, 255],
        [0, 255, 0], [0, 255, 255], [255, 255, 0], [255, 255, 255],
        [0, 0, 119], [0, 0, 170], [119, 0, 0], [170, 0, 0],
        [0, 119, 0], [0, 170, 0], [119, 119, 119], [170, 170, 170]
      ]
    },
    msx: {
      name: 'MSX1 Classic (15 màu)',
      colors: [
        [0, 0, 0], [62, 184, 73], [116, 208, 125], [89, 85, 224],
        [128, 118, 241], [185, 94, 81], [101, 219, 239], [219, 101, 89],
        [255, 137, 125], [204, 195, 94], [222, 208, 135], [58, 162, 65],
        [183, 102, 181], [204, 204, 204], [255, 255, 255]
      ]
    },
    cyberpunk: {
      name: 'Cyberpunk Neon (8 màu)',
      colors: [
        [13, 2, 33], [15, 8, 75], [38, 64, 139], [166, 0, 103],
        [204, 0, 102], [255, 56, 100], [45, 226, 230], [246, 1, 157]
      ]
    },
    monochrome: {
      name: 'Monochrome 1-Bit (Đen / Trắng)',
      colors: [
        [0, 0, 0],
        [255, 255, 255]
      ]
    }
  };

  // Bayer Matrix 4x4
  const BAYER_4X4 = [
    [ 0,  8,  2, 10],
    [12,  4, 14,  6],
    [ 3, 11,  1,  9],
    [15,  7, 13,  5]
  ];

  // State
  const state = {
    sourceImage: null,
    sourceCanvas: null,
    processedCanvas: null,
    originalWidth: 0,
    originalHeight: 0,
    detectedGridSize: 1,
    gridCandidates: [],
    currentGridSize: 'auto',
    antiAliasing: 'sharp',
    paletteKey: 'original',
    maxColors: 'all',
    dithering: 'none',
    transparencyMode: 'auto',
    bgScope: 'boundary', // 'boundary' (BFS Flood fill from edges) | 'all' (All matching)
    customBgColor: [255, 255, 255],
    tolerance: 18,
    outlineStyle: 'none',
    outlineColor: '#000000',
    autoTrim: true,
    forcedSize: 'auto',
    customForcedWidth: 64,
    customForcedHeight: 64,
    isRatioLocked: true,
    customGridSize: 4,
    activePreset: 'auto',
    isEyedropperActive: false,
    ensembleGrid: null,
  };

  // =========================================================================
  // 2. DOM ELEMENTS & WASM STATE
  // =========================================================================
  let wasmModule = null;
  let dropzone, fileInput, dropPrompt, fileInfoPreview, fileThumb, fileName, fileMeta, btnRemoveFile;
  let optionsPanel, progressCard, progressBar, progressText, resultCard, errorBox, errorMsg;
  let selectGridSize, gridCandidatesContainer, customGridWrapper, customGridInput, selectAntiAliasing, selectPalette, selectMaxColors, selectDithering;
  let selectBgMode, selectBgScope, toleranceSlider, toleranceVal, customColorWrapper, customColorInput;
  let selectOutline, outlineColorInput, selectForcedSize, customSizeWrapper, customWidthInput, customHeightInput, btnLockRatio, lockIcon;
  let quickOutputInput, outputChips, studioWorkspace;
  let checkboxAutoTrim, btnStartProcess, btnProcessAnother;
  let comparisonContainer, compareBeforeImg, compareAfterCanvas, comparisonSlider, comparisonHandle;
  let resultStatsText, btnDownloadNative, btnDownload2x, btnDownload4x, btnDownload8x, btnDownload16x, btnCopyClipboard;
  let btnEyedropper, presetButtons;

  function initDOMElements() {
    studioWorkspace = document.getElementById('pixel-studio-workspace');
    dropzone = document.getElementById('pixel-dropzone');
    fileInput = document.getElementById('pixel-file-input');
    dropPrompt = document.getElementById('pixel-dropzone-prompt');
    fileInfoPreview = document.getElementById('pixel-file-info');
    fileThumb = document.getElementById('pixel-source-thumb');
    fileName = document.getElementById('pixel-file-name');
    fileMeta = document.getElementById('pixel-file-meta');
    btnRemoveFile = document.getElementById('btn-remove-pixel-file');

    optionsPanel = document.getElementById('pixel-options-panel');
    progressCard = document.getElementById('pixel-progress-card');
    progressBar = document.getElementById('pixel-progress-bar');
    progressText = document.getElementById('pixel-progress-text');
    resultCard = document.getElementById('pixel-result-card');
    errorBox = document.getElementById('pixel-error-box');
    errorMsg = document.getElementById('pixel-error-message');

    selectGridSize = document.getElementById('pixel-grid-select');
    gridCandidatesContainer = document.getElementById('pixel-grid-candidates-container');
    customGridWrapper = document.getElementById('pixel-custom-grid-wrapper');
    customGridInput = document.getElementById('pixel-custom-grid-input');

    selectAntiAliasing = document.getElementById('pixel-aa-select');
    selectPalette = document.getElementById('pixel-palette-select');
    selectMaxColors = document.getElementById('pixel-max-colors-select');
    selectDithering = document.getElementById('pixel-dither-select');
    selectBgMode = document.getElementById('pixel-bg-mode-select');
    selectBgScope = document.getElementById('pixel-bg-scope-select');
    toleranceSlider = document.getElementById('pixel-tolerance-slider');
    toleranceVal = document.getElementById('pixel-tolerance-val');
    customColorWrapper = document.getElementById('pixel-custom-color-wrapper');
    customColorInput = document.getElementById('pixel-custom-color-input');
    btnEyedropper = document.getElementById('btn-pixel-eyedropper');

    selectOutline = document.getElementById('pixel-outline-select');
    outlineColorInput = document.getElementById('pixel-outline-color-input');
    selectForcedSize = document.getElementById('pixel-forced-size-select');
    customSizeWrapper = document.getElementById('pixel-custom-size-wrapper');
    customWidthInput = document.getElementById('pixel-custom-width-input');
    customHeightInput = document.getElementById('pixel-custom-height-input');
    btnLockRatio = document.getElementById('btn-pixel-lock-ratio');
    lockIcon = document.getElementById('pixel-lock-icon');
    quickOutputInput = document.getElementById('pixel-output-quick-input');
    outputChips = document.querySelectorAll('.pixel-size-chip');

    checkboxAutoTrim = document.getElementById('pixel-auto-trim');
    btnStartProcess = document.getElementById('btn-start-pixel-process');
    btnProcessAnother = document.getElementById('btn-pixel-process-another');

    comparisonContainer = document.getElementById('pixel-comparison-container');
    compareBeforeImg = document.getElementById('pixel-compare-before-img');
    compareAfterCanvas = document.getElementById('pixel-compare-after-canvas');
    comparisonSlider = document.getElementById('pixel-comparison-slider');
    comparisonHandle = document.getElementById('pixel-comparison-handle');

    resultStatsText = document.getElementById('pixel-result-stats');
    btnDownloadNative = document.getElementById('pixel-download-native-btn');
    btnDownload2x = document.getElementById('pixel-download-2x-btn');
    btnDownload4x = document.getElementById('pixel-download-4x-btn');
    btnDownload8x = document.getElementById('pixel-download-8x-btn');
    btnDownload16x = document.getElementById('pixel-download-16x-btn');
    btnCopyClipboard = document.getElementById('pixel-copy-btn');

    presetButtons = document.querySelectorAll('.pixel-preset-btn');
  }

  // =========================================================================
  // 3. ENHANCED IMAGE PROCESSING ALGORITHMS
  // =========================================================================

  /**
   * Tính toán các ứng viên lưới (Grid Candidates) kèm tỷ lệ % tin cậy
   * Tự động ưu tiên WASM Engine siêu tốc nếu có, fallback sang JS thuần
   */
  function analyzeGridCandidates(imageData) {
    const { width, height, data } = imageData;
    const statusEl = document.getElementById('wasm-engine-status');

    if (wasmModule) {
      try {
        const bytes = (data instanceof Uint8Array && !(data instanceof Uint8ClampedArray))
          ? data
          : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);

        // Hướng A: Ensemble Consensus đa detector chuẩn Pixel Art Fixer Core
        if (wasmModule.detect_grid_ensemble) {
          const ensembleRes = wasmModule.detect_grid_ensemble(bytes, width, height);
          if (ensembleRes) {
            console.log(`🦀 [WASM Ensemble Consensus (Direction A)]:`, ensembleRes);
            state.ensembleGrid = ensembleRes;
            if (statusEl) {
              const badge = ensembleRes.consensus || 'ensemble';
              statusEl.textContent = `WASM: ${badge} ⚡`;
              statusEl.style.color = '#34d399';
              statusEl.style.background = 'rgba(16, 185, 129, 0.15)';
              statusEl.style.border = '1px solid rgba(16, 185, 129, 0.3)';
              statusEl.title = `WASM Consensus (${badge}): ${ensembleRes.step_x.toFixed(2)}x${ensembleRes.step_y.toFixed(2)}px (${ensembleRes.cols}x${ensembleRes.rows}), offset: (${ensembleRes.offset_x.toFixed(2)}, ${ensembleRes.offset_y.toFixed(2)}) - Tin cậy: ${ensembleRes.confidence}%`;
            }
            if (Array.isArray(ensembleRes.candidates) && ensembleRes.candidates.length > 0) {
              return ensembleRes.candidates;
            }
          }
        }

        // Fallback detect_grid_candidates
        if (wasmModule.detect_grid_candidates) {
          const wasmRes = wasmModule.detect_grid_candidates(bytes, width, height);
          if (Array.isArray(wasmRes) && wasmRes.length > 0) {
            console.log(`🦀 [WASM Grid Detection - Candidates]:`, wasmRes);
            if (statusEl) {
              statusEl.textContent = `WASM (${wasmRes[0].size}px) ⚡`;
              statusEl.style.color = '#34d399';
              statusEl.style.background = 'rgba(16, 185, 129, 0.15)';
              statusEl.style.border = '1px solid rgba(16, 185, 129, 0.3)';
              statusEl.title = `WASM ACF nhận diện chính xác cỡ ô: ${wasmRes[0].size}px (Tin cậy: ${wasmRes[0].confidence}%)`;
            }
            return wasmRes;
          }
        }
      } catch (err) {
        console.warn('WASM detection error, falling back to JS:', err);
      }
    }

    if (statusEl) {
      statusEl.textContent = 'JS Fallback ⚠️';
      statusEl.style.color = '#fbbf24';
      statusEl.style.background = 'rgba(245, 158, 11, 0.15)';
      statusEl.style.border = '1px solid rgba(245, 158, 11, 0.3)';
      statusEl.title = 'Đang chạy thuật toán JS dự phòng';
    }

    const sampleRows = Math.min(height, 80);
    const sampleCols = Math.min(width, 80);
    const rowStep = Math.max(1, Math.floor(height / sampleRows));
    const colStep = Math.max(1, Math.floor(width / sampleCols));

    const runLengths = {};

    for (let y = 0; y < height; y += rowStep) {
      let currentLength = 1;
      for (let x = 1; x < width; x++) {
        const idxPrev = (y * width + (x - 1)) * 4;
        const idxCurr = (y * width + x) * 4;

        const aPrev = data[idxPrev + 3];
        const aCurr = data[idxCurr + 3];

        if (aPrev < 32 && aCurr < 32) {
          currentLength = 1;
          continue;
        }

        let diff = 0;
        if ((aPrev < 32) !== (aCurr < 32)) {
          diff = 255;
        } else {
          diff = Math.abs(data[idxCurr] - data[idxPrev]) +
                 Math.abs(data[idxCurr + 1] - data[idxPrev + 1]) +
                 Math.abs(data[idxCurr + 2] - data[idxPrev + 2]);
        }

        if (diff < 36) {
          currentLength++;
        } else {
          if (currentLength >= 2 && currentLength <= 32) {
            runLengths[currentLength] = (runLengths[currentLength] || 0) + 1;
          }
          currentLength = 1;
        }
      }
      if (currentLength >= 2 && currentLength <= 32) {
        runLengths[currentLength] = (runLengths[currentLength] || 0) + 1;
      }
    }

    for (let x = 0; x < width; x += colStep) {
      let currentLength = 1;
      for (let y = 1; y < height; y++) {
        const idxPrev = ((y - 1) * width + x) * 4;
        const idxCurr = (y * width + x) * 4;

        const aPrev = data[idxPrev + 3];
        const aCurr = data[idxCurr + 3];

        if (aPrev < 32 && aCurr < 32) {
          currentLength = 1;
          continue;
        }

        let diff = 0;
        if ((aPrev < 32) !== (aCurr < 32)) {
          diff = 255;
        } else {
          diff = Math.abs(data[idxCurr] - data[idxPrev]) +
                 Math.abs(data[idxCurr + 1] - data[idxPrev + 1]) +
                 Math.abs(data[idxCurr + 2] - data[idxPrev + 2]);
        }

        if (diff < 36) {
          currentLength++;
        } else {
          if (currentLength >= 2 && currentLength <= 32) {
            runLengths[currentLength] = (runLengths[currentLength] || 0) + 1;
          }
          currentLength = 1;
        }
      }
      if (currentLength >= 2 && currentLength <= 32) {
        runLengths[currentLength] = (runLengths[currentLength] || 0) + 1;
      }
    }

    const sorted = Object.entries(runLengths)
      .map(([k, count]) => ({ size: parseInt(k, 10), count }))
      .sort((a, b) => b.count - a.count);

    if (sorted.length === 0) {
      return [
        { size: 4, confidence: 60 },
        { size: 2, confidence: 45 },
        { size: 8, confidence: 30 },
        { size: 1, confidence: 25 }
      ];
    }

    const maxCount = sorted[0].count;
    const candidates = [];
    const seen = new Set();

    for (const item of sorted) {
      if (seen.has(item.size)) continue;
      const conf = Math.min(99, Math.round((item.count / maxCount) * 95));
      if (conf >= 25) {
        candidates.push({ size: item.size, confidence: conf });
        seen.add(item.size);
      }
      if (candidates.length >= 4) break;
    }

    if (!candidates.find(c => c.size === 1)) {
      candidates.push({ size: 1, confidence: 20 });
    }

    return candidates;
  }

  function colorDistance(r1, g1, b1, r2, g2, b2) {
    const dr = r1 - r2;
    const dg = g1 - g2;
    const db = b1 - b2;
    return Math.sqrt(dr * dr + dg * dg + db * db);
  }

  function findClosestColor(r, g, b, paletteColors) {
    let minDistance = Infinity;
    let closest = paletteColors[0];
    for (let i = 0; i < paletteColors.length; i++) {
      const p = paletteColors[i];
      const dist = colorDistance(r, g, b, p[0], p[1], p[2]);
      if (dist < minDistance) {
        minDistance = dist;
        closest = p;
      }
    }
    return closest;
  }

  function sampleCellColor(sourceData, srcW, srcH, cellX, cellY, cellW, cellH, aaMode) {
    const startX = Math.floor(cellX);
    const startY = Math.floor(cellY);
    const endX = Math.min(srcW, Math.floor(cellX + cellW));
    const endY = Math.min(srcH, Math.floor(cellY + cellH));

    if (aaMode === 'off' || (endX - startX <= 1 && endY - startY <= 1)) {
      const cx = Math.min(srcW - 1, Math.floor(cellX + cellW / 2));
      const cy = Math.min(srcH - 1, Math.floor(cellY + cellH / 2));
      const idx = (cy * srcW + cx) * 4;
      return [sourceData[idx], sourceData[idx + 1], sourceData[idx + 2], sourceData[idx + 3]];
    }

    const buckets = {};
    let totalR = 0, totalG = 0, totalB = 0, totalA = 0, count = 0;

    for (let y = startY; y < endY; y++) {
      for (let x = startX; x < endX; x++) {
        const idx = (y * srcW + x) * 4;
        const a = sourceData[idx + 3];
        if (a === 0) continue;

        const r = sourceData[idx];
        const g = sourceData[idx + 1];
        const b = sourceData[idx + 2];

        totalR += r; totalG += g; totalB += b; totalA += a;
        count++;

        const qr = (r >> 4) << 4;
        const qg = (g >> 4) << 4;
        const qb = (b >> 4) << 4;
        const key = `${qr}_${qg}_${qb}`;
        if (!buckets[key]) {
          buckets[key] = { count: 1, r, g, b, a };
        } else {
          buckets[key].count++;
        }
      }
    }

    if (count === 0) return [0, 0, 0, 0];

    let bestBucket = null;
    let maxVotes = 0;
    for (const key in buckets) {
      if (buckets[key].count > maxVotes) {
        maxVotes = buckets[key].count;
        bestBucket = buckets[key];
      }
    }

    if (aaMode === 'ultra' && bestBucket && maxVotes >= count * 0.35) {
      return [bestBucket.r, bestBucket.g, bestBucket.b, 255];
    } else if (aaMode === 'sharp' && bestBucket) {
      return [bestBucket.r, bestBucket.g, bestBucket.b, Math.round(totalA / count)];
    } else {
      return [
        Math.round(totalR / count),
        Math.round(totalG / count),
        Math.round(totalB / count),
        Math.round(totalA / count)
      ];
    }
  }

  function estimateBorderColor(data, width, height) {
    let r = 0, g = 0, b = 0, count = 0;
    const step = Math.max(1, Math.floor(Math.min(width, height) / 40));

    for (let x = 0; x < width; x += step) {
      const idxTop = (0 * width + x) * 4;
      const idxBot = ((height - 1) * width + x) * 4;
      if (data[idxTop + 3] > 10) { r += data[idxTop]; g += data[idxTop + 1]; b += data[idxTop + 2]; count++; }
      if (data[idxBot + 3] > 10) { r += data[idxBot]; g += data[idxBot + 1]; b += data[idxBot + 2]; count++; }
    }
    for (let y = 0; y < height; y += step) {
      const idxLeft = (y * width + 0) * 4;
      const idxRight = (y * width + (width - 1)) * 4;
      if (data[idxLeft + 3] > 10) { r += data[idxLeft]; g += data[idxLeft + 1]; b += data[idxLeft + 2]; count++; }
      if (data[idxRight + 3] > 10) { r += data[idxRight]; g += data[idxRight + 1]; b += data[idxRight + 2]; count++; }
    }

    if (count === 0) return [255, 255, 255];
    return [Math.round(r / count), Math.round(g / count), Math.round(b / count)];
  }

  /**
   * Thuật toán Boundary-Connected BFS Flood Fill:
   * Chỉ xóa nền tràn từ 4 mép ngoài vào trong. Bảo vệ 100% mắt trắng, áo trắng, vùng kín bên trong.
   */
  function removeBackgroundBFS(bytes, width, height, targetBg, tolDist) {
    const visited = new Uint8Array(width * height);
    const queue = [];

    const isMatch = (x, y) => {
      const idx = (y * width + x) * 4;
      if (bytes[idx + 3] === 0) return true;
      const dist = colorDistance(bytes[idx], bytes[idx + 1], bytes[idx + 2], targetBg[0], targetBg[1], targetBg[2]);
      return dist <= tolDist;
    };

    // Nạp toàn bộ 4 cạnh ngoài viền vào Queue
    for (let x = 0; x < width; x++) {
      if (isMatch(x, 0)) { queue.push(x, 0); visited[0 * width + x] = 1; }
      if (isMatch(x, height - 1)) { queue.push(x, height - 1); visited[(height - 1) * width + x] = 1; }
    }
    for (let y = 0; y < height; y++) {
      if (isMatch(0, y)) { queue.push(0, y); visited[y * width + 0] = 1; }
      if (isMatch(width - 1, y)) { queue.push(width - 1, y); visited[y * width + (width - 1)] = 1; }
    }

    let head = 0;
    while (head < queue.length) {
      const cx = queue[head++];
      const cy = queue[head++];

      // Xóa pixel này
      bytes[(cy * width + cx) * 4 + 3] = 0;

      // 4 lân cận
      const neighbors = [
        [cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]
      ];

      for (let i = 0; i < 4; i++) {
        const nx = neighbors[i][0];
        const ny = neighbors[i][1];
        if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
          const nIdx = ny * width + nx;
          if (visited[nIdx] === 0 && isMatch(nx, ny)) {
            visited[nIdx] = 1;
            queue.push(nx, ny);
          }
        }
      }
    }
  }

  /**
   * Giới hạn số lượng màu (K-Means quantization đơn giản)
   */
  function quantizeColors(bytes, width, height, maxCount) {
    if (maxCount <= 0 || maxCount >= 256) return;

    // Lấy danh sách mẫu màu hiện có
    const colorMap = {};
    for (let i = 0; i < width * height; i++) {
      const idx = i * 4;
      if (bytes[idx + 3] === 0) continue;
      const key = `${bytes[idx]}_${bytes[idx + 1]}_${bytes[idx + 2]}`;
      colorMap[key] = (colorMap[key] || 0) + 1;
    }

    const unique = Object.keys(colorMap);
    if (unique.length <= maxCount) return;

    // Chọn top N màu phổ biến nhất làm palette đại diện
    const sorted = unique
      .map(k => {
        const p = k.split('_').map(Number);
        return { color: p, count: colorMap[k] };
      })
      .sort((a, b) => b.count - a.count)
      .slice(0, maxCount)
      .map(x => x.color);

    // Gán lại màu gần nhất
    for (let i = 0; i < width * height; i++) {
      const idx = i * 4;
      if (bytes[idx + 3] === 0) continue;
      const c = findClosestColor(bytes[idx], bytes[idx + 1], bytes[idx + 2], sorted);
      bytes[idx] = c[0];
      bytes[idx + 1] = c[1];
      bytes[idx + 2] = c[2];
    }
  }

  function autoTrimCanvas(canvas) {
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    const imgData = ctx.getImageData(0, 0, w, h);
    const data = imgData.data;

    let minX = w, minY = h, maxX = -1, maxY = -1;

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const a = data[(y * w + x) * 4 + 3];
        if (a > 0) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }

    if (maxX === -1) return canvas;

    const trimW = maxX - minX + 1;
    const trimH = maxY - minY + 1;
    const trimmed = document.createElement('canvas');
    trimmed.width = trimW;
    trimmed.height = trimH;
    const trimCtx = trimmed.getContext('2d');
    trimCtx.imageSmoothingEnabled = false;
    trimCtx.drawImage(canvas, minX, minY, trimW, trimH, 0, 0, trimW, trimH);
    return trimmed;
  }

  function resizeExact(canvas, targetW, targetH) {
    const out = document.createElement('canvas');
    out.width = targetW;
    out.height = targetH;
    const ctx = out.getContext('2d');
    ctx.imageSmoothingEnabled = false;

    // Giữ tỷ lệ và canh giữa
    const scale = Math.min(targetW / canvas.width, targetH / canvas.height);
    const sw = Math.round(canvas.width * scale);
    const sh = Math.round(canvas.height * scale);
    const dx = Math.round((targetW - sw) / 2);
    const dy = Math.round((targetH - sh) / 2);

    ctx.drawImage(canvas, dx, dy, sw, sh);
    return out;
  }

  function hexToRgb(hex) {
    let c = hex.replace('#', '');
    if (c.length === 3) c = c.split('').map(x => x + x).join('');
    const num = parseInt(c, 16);
    return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
  }

  // =========================================================================
  // 4. MAIN PROCESS PIPELINE
  // =========================================================================

  function runPixelRefineProcess() {
    if (!state.sourceCanvas) return;

    showProgress('Đang xử lý làm sạch và tinh chỉnh sprite pixel...');

    setTimeout(() => {
      try {
        const srcW = state.originalWidth;
        const srcH = state.originalHeight;
        const srcCtx = state.sourceCanvas.getContext('2d', { willReadFrequently: true });
        const srcImgData = srcCtx.getImageData(0, 0, srcW, srcH);
        const srcBytes = srcImgData.data;

        // 1. Xác định Kích thước và Tọa độ Ô Lưới (Grid Cell & Native Geometry)
        let cols, rows, stepX, stepY, offsetX = 0, offsetY = 0;
        let cellSizeLabel = '1';
        let usedWasmReconstruct = false;

        const spriteCanvas = document.createElement('canvas');
        let spriteCtx, spriteImgData, spriteBytes;

        if (state.currentGridSize === 'auto' && state.ensembleGrid) {
          stepX = state.ensembleGrid.step_x;
          stepY = state.ensembleGrid.step_y;
          cols = Math.max(1, state.ensembleGrid.cols);
          rows = Math.max(1, state.ensembleGrid.rows);
          offsetX = state.ensembleGrid.offset_x || 0;
          offsetY = state.ensembleGrid.offset_y || 0;
          cellSizeLabel = `${stepX.toFixed(1)}x${stepY.toFixed(1)}`;

          spriteCanvas.width = cols;
          spriteCanvas.height = rows;
          spriteCtx = spriteCanvas.getContext('2d', { willReadFrequently: true });
          spriteImgData = spriteCtx.createImageData(cols, rows);
          spriteBytes = spriteImgData.data;

          // Hướng A: Tái tạo Native Pixel Art bằng WASM Reconstruction Engine
          if (wasmModule && wasmModule.reconstruct_native_sprite) {
            try {
              const reconRes = wasmModule.reconstruct_native_sprite(
                srcBytes, srcW, srcH, stepX, stepY, cols, rows, false
              );
              if (reconRes && reconRes.width === cols && reconRes.height === rows && reconRes.rgba) {
                spriteBytes.set(reconRes.rgba);
                usedWasmReconstruct = true;
                console.log(`✨ [WASM Native Reconstruction (Direction A)] Tái tạo hoàn hảo ${cols}x${rows} sprite pixel!`);
              }
            } catch (err) {
              console.warn('WASM reconstruct_native_sprite error, fallback to client sampling:', err);
            }
          }
        }

        if (!usedWasmReconstruct) {
          let cellSize = 1;
          if (state.currentGridSize === 'auto') {
            cellSize = state.detectedGridSize || 1;
          } else if (state.currentGridSize === 'custom') {
            cellSize = Math.max(1, parseInt(state.customGridSize, 10) || 4);
          } else {
            cellSize = Math.max(1, parseInt(state.currentGridSize, 10) || 1);
          }
          cellSizeLabel = `${cellSize}`;

          cols = Math.max(1, Math.round(srcW / cellSize));
          rows = Math.max(1, Math.round(srcH / cellSize));
          stepX = srcW / cols;
          stepY = srcH / rows;

          spriteCanvas.width = cols;
          spriteCanvas.height = rows;
          spriteCtx = spriteCanvas.getContext('2d', { willReadFrequently: true });
          spriteImgData = spriteCtx.createImageData(cols, rows);
          spriteBytes = spriteImgData.data;

          // Lấy mẫu ô pixel từ ảnh gốc xuống kích thước cols x rows theo ô lưới đã dò
          for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
              const cellColor = sampleCellColor(
                srcBytes, srcW, srcH,
                offsetX + c * stepX, offsetY + r * stepY, stepX, stepY,
                state.antiAliasing
              );
              const idx = (r * cols + c) * 4;
              spriteBytes[idx] = cellColor[0];
              spriteBytes[idx + 1] = cellColor[1];
              spriteBytes[idx + 2] = cellColor[2];
              spriteBytes[idx + 3] = cellColor[3];
            }
          }
        }

        // 2. Xóa nền thông minh với Boundary BFS
        if (state.transparencyMode !== 'keep') {
          let targetBg = state.customBgColor;
          if (state.transparencyMode === 'auto') {
            targetBg = estimateBorderColor(spriteBytes, cols, rows);
          }

          const tolDist = (state.tolerance / 100) * 441.67;

          if (state.bgScope === 'boundary') {
            // BFS tràn từ viền mép ngoài vào trong (Bảo vệ mắt & quần áo trắng)
            removeBackgroundBFS(spriteBytes, cols, rows, targetBg, tolDist);
          } else {
            // All: Xóa mọi pixel khớp màu
            for (let i = 0; i < cols * rows; i++) {
              const idx = i * 4;
              if (spriteBytes[idx + 3] === 0) continue;
              const dist = colorDistance(
                spriteBytes[idx], spriteBytes[idx + 1], spriteBytes[idx + 2],
                targetBg[0], targetBg[1], targetBg[2]
              );
              if (dist <= tolDist) {
                spriteBytes[idx + 3] = 0;
              }
            }
          }
        }

        // 4. Giới hạn số lượng màu (Max Colors) nếu có
        if (state.maxColors !== 'all') {
          const maxC = parseInt(state.maxColors, 10);
          if (maxC > 0) {
            quantizeColors(spriteBytes, cols, rows, maxC);
          }
        }

        // 5. Ép bảng màu Retro & Dithering
        const palette = RETRO_PALETTES[state.paletteKey];
        if (palette && palette.colors) {
          const palColors = palette.colors;

          if (state.dithering === 'floyd') {
            const errR = new Float32Array(cols * rows);
            const errG = new Float32Array(cols * rows);
            const errB = new Float32Array(cols * rows);

            for (let y = 0; y < rows; y++) {
              for (let x = 0; x < cols; x++) {
                const idx = (y * cols + x) * 4;
                const pIdx = y * cols + x;
                if (spriteBytes[idx + 3] === 0) continue;

                const curR = Math.max(0, Math.min(255, spriteBytes[idx] + errR[pIdx]));
                const curG = Math.max(0, Math.min(255, spriteBytes[idx + 1] + errG[pIdx]));
                const curB = Math.max(0, Math.min(255, spriteBytes[idx + 2] + errB[pIdx]));

                const closest = findClosestColor(curR, curG, curB, palColors);
                spriteBytes[idx] = closest[0];
                spriteBytes[idx + 1] = closest[1];
                spriteBytes[idx + 2] = closest[2];

                const diffR = curR - closest[0];
                const diffG = curG - closest[1];
                const diffB = curB - closest[2];

                if (x + 1 < cols) {
                  errR[pIdx + 1] += diffR * (7 / 16);
                  errG[pIdx + 1] += diffG * (7 / 16);
                  errB[pIdx + 1] += diffB * (7 / 16);
                }
                if (x - 1 >= 0 && y + 1 < rows) {
                  errR[pIdx + cols - 1] += diffR * (3 / 16);
                  errG[pIdx + cols - 1] += diffG * (3 / 16);
                  errB[pIdx + cols - 1] += diffB * (3 / 16);
                }
                if (y + 1 < rows) {
                  errR[pIdx + cols] += diffR * (5 / 16);
                  errG[pIdx + cols] += diffG * (5 / 16);
                  errB[pIdx + cols] += diffB * (5 / 16);
                }
                if (x + 1 < cols && y + 1 < rows) {
                  errR[pIdx + cols + 1] += diffR * (1 / 16);
                  errG[pIdx + cols + 1] += diffG * (1 / 16);
                  errB[pIdx + cols + 1] += diffB * (1 / 16);
                }
              }
            }
          } else if (state.dithering === 'bayer') {
            for (let y = 0; y < rows; y++) {
              for (let x = 0; x < cols; x++) {
                const idx = (y * cols + x) * 4;
                if (spriteBytes[idx + 3] === 0) continue;

                const threshold = (BAYER_4X4[y % 4][x % 4] / 16 - 0.5) * 32;
                const r = Math.max(0, Math.min(255, spriteBytes[idx] + threshold));
                const g = Math.max(0, Math.min(255, spriteBytes[idx + 1] + threshold));
                const b = Math.max(0, Math.min(255, spriteBytes[idx + 2] + threshold));

                const closest = findClosestColor(r, g, b, palColors);
                spriteBytes[idx] = closest[0];
                spriteBytes[idx + 1] = closest[1];
                spriteBytes[idx + 2] = closest[2];
              }
            }
          } else {
            for (let i = 0; i < cols * rows; i++) {
              const idx = i * 4;
              if (spriteBytes[idx + 3] === 0) continue;
              const closest = findClosestColor(spriteBytes[idx], spriteBytes[idx + 1], spriteBytes[idx + 2], palColors);
              spriteBytes[idx] = closest[0];
              spriteBytes[idx + 1] = closest[1];
              spriteBytes[idx + 2] = closest[2];
            }
          }
        }

        // 6. Viền Outline
        if (state.outlineStyle !== 'none') {
          const outlineRGB = hexToRgb(state.outlineColor);
          const mask = new Uint8Array(cols * rows);
          for (let i = 0; i < cols * rows; i++) {
            if (spriteBytes[i * 4 + 3] > 0) mask[i] = 1;
          }

          const hasOutline = new Uint8Array(cols * rows);
          const is8Way = state.outlineStyle === '8way';

          for (let y = 0; y < rows; y++) {
            for (let x = 0; x < cols; x++) {
              const idx = y * cols + x;
              if (mask[idx] === 1) continue;

              let neighborSolid = false;
              if (x > 0 && mask[idx - 1] === 1) neighborSolid = true;
              if (x < cols - 1 && mask[idx + 1] === 1) neighborSolid = true;
              if (y > 0 && mask[idx - cols] === 1) neighborSolid = true;
              if (y < rows - 1 && mask[idx + cols] === 1) neighborSolid = true;

              if (is8Way && !neighborSolid) {
                if (x > 0 && y > 0 && mask[idx - cols - 1] === 1) neighborSolid = true;
                if (x < cols - 1 && y > 0 && mask[idx - cols + 1] === 1) neighborSolid = true;
                if (x > 0 && y < rows - 1 && mask[idx + cols - 1] === 1) neighborSolid = true;
                if (x < cols - 1 && y < rows - 1 && mask[idx + cols + 1] === 1) neighborSolid = true;
              }

              if (neighborSolid) hasOutline[idx] = 1;
            }
          }

          for (let i = 0; i < cols * rows; i++) {
            if (hasOutline[i] === 1) {
              const idx = i * 4;
              spriteBytes[idx] = outlineRGB[0];
              spriteBytes[idx + 1] = outlineRGB[1];
              spriteBytes[idx + 2] = outlineRGB[2];
              spriteBytes[idx + 3] = 255;
            }
          }
        }

        spriteCtx.putImageData(spriteImgData, 0, 0);

        // 7. Auto Trim
        let finalCanvas = spriteCanvas;
        if (state.autoTrim) {
          const trimmed = autoTrimCanvas(spriteCanvas);
          if (trimmed) finalCanvas = trimmed;
        }

        // 8. Kích thước Output cuối cùng (Quy trình chuẩn: Grid xong đến Output)
        // Sprite đã được bóc tách và làm sạch theo chuẩn ô lưới ở các bước trên.
        // Giờ đây phóng to ra kích thước Output mong muốn (2x, 4x, 8x hoặc cố định 128x128...):
        if (state.forcedSize !== 'auto') {
          let dimW, dimH;
          if (state.forcedSize === '2x' || state.forcedSize === '4x' || state.forcedSize === '8x') {
            const scale = parseInt(state.forcedSize, 10) || 1;
            dimW = finalCanvas.width * scale;
            dimH = finalCanvas.height * scale;
          } else if (state.forcedSize === 'custom') {
            dimW = state.customForcedWidth;
            dimH = state.customForcedHeight;
          } else {
            const parts = state.forcedSize.split('x');
            dimW = parseInt(parts[0], 10) || finalCanvas.width;
            dimH = parts[1] ? parseInt(parts[1], 10) : dimW;
          }
          if (dimW > 0 && dimH > 0 && (dimW !== finalCanvas.width || dimH !== finalCanvas.height)) {
            finalCanvas = resizeExact(finalCanvas, dimW, dimH);
          }
        }

        state.processedCanvas = finalCanvas;

        displayRefinedResult(finalCanvas, spriteCanvas, cols, rows, cellSizeLabel);
        hideProgress();

      } catch (err) {
        console.error('[PixelRefiner Error]', err);
        hideProgress();
        showError('Đã xảy ra lỗi trong quá trình xử lý pixel: ' + err.message);
      }
    }, 30);
  }

  // =========================================================================
  // 5. UI DISPLAY & CANDIDATES RENDER
  // =========================================================================

  function renderGridCandidates(candidates) {
    if (!gridCandidatesContainer) return;
    gridCandidatesContainer.innerHTML = '';

    if (!candidates || candidates.length === 0) {
      gridCandidatesContainer.classList.add('hidden');
      return;
    }

    gridCandidatesContainer.classList.remove('hidden');

    const titleSpan = document.createElement('span');
    titleSpan.className = 'pixel-candidates-title';
    titleSpan.textContent = 'Gợi ý lưới:';
    gridCandidatesContainer.appendChild(titleSpan);

    const activeSize = state.currentGridSize === 'auto' ? state.detectedGridSize : parseInt(state.currentGridSize, 10);

    candidates.forEach((cand, idx) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `pixel-cand-btn ${cand.size === activeSize ? 'active' : ''}`;
      btn.innerHTML = `<span>${cand.size}x${cand.size}px</span> <small>${cand.confidence}%</small>`;
      btn.title = `Chọn kích thước lưới ${cand.size}px (Độ tin cậy: ${cand.confidence}%)`;

      btn.addEventListener('click', () => {
        gridCandidatesContainer.querySelectorAll('.pixel-cand-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        state.currentGridSize = String(cand.size);
        if (selectGridSize) selectGridSize.value = String(cand.size);
        runPixelRefineProcess();
      });

      gridCandidatesContainer.appendChild(btn);
    });
  }

  let isPixelGridActive = false;

  function renderPixelGridOverlay(cols, rows) {
    const gridCanvas = document.getElementById('pixel-grid-overlay-canvas');
    if (!gridCanvas) return;
    if (!isPixelGridActive || cols > 128 || rows > 128) {
      gridCanvas.style.display = 'none';
      return;
    }
    gridCanvas.style.display = 'block';

    const rect = compareAfterCanvas.getBoundingClientRect();
    const w = rect.width > 0 ? rect.width : 500;
    const h = rect.height > 0 ? rect.height : 500;
    gridCanvas.width = Math.round(w);
    gridCanvas.height = Math.round(h);

    const gctx = gridCanvas.getContext('2d');
    gctx.clearRect(0, 0, gridCanvas.width, gridCanvas.height);
    gctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
    gctx.lineWidth = 1;

    const cellW = w / cols;
    const cellH = h / rows;
    gctx.beginPath();
    for (let c = 1; c < cols; c++) {
      const x = Math.round(c * cellW) + 0.5;
      gctx.moveTo(x, 0);
      gctx.lineTo(x, h);
    }
    for (let r = 1; r < rows; r++) {
      const y = Math.round(r * cellH) + 0.5;
      gctx.moveTo(0, y);
      gctx.lineTo(w, y);
    }
    gctx.stroke();
  }

  function displayRefinedResult(processedCanvas, spriteCanvas, origCols, origRows, cellSize) {
    if (!resultCard) return;

    // Hiển thị trực tiếp processedCanvas để phản ánh 100% kích thước pixel mà người dùng chọn (ví dụ 32x32)!
    compareAfterCanvas.width = processedCanvas.width;
    compareAfterCanvas.height = processedCanvas.height;
    const afterCtx = compareAfterCanvas.getContext('2d');
    afterCtx.imageSmoothingEnabled = false;
    afterCtx.clearRect(0, 0, processedCanvas.width, processedCanvas.height);
    afterCtx.drawImage(processedCanvas, 0, 0);

    // Cập nhật tag hiển thị kích thước trực quan trên ảnh sau tinh chỉnh
    const tagAfter = document.getElementById('pixel-tag-after');
    if (tagAfter) {
      tagAfter.textContent = `OUTPUT: ${processedCanvas.width}x${processedCanvas.height} (Lưới: ~${cellSize}px)`;
      tagAfter.style.background = 'rgba(16, 185, 129, 0.9)';
    }

    // Vẽ lưới ô pixel nếu được bật
    renderPixelGridOverlay(processedCanvas.width, processedCanvas.height);

    const spriteW = processedCanvas.width;
    const spriteH = processedCanvas.height;
    let sizeDetail = `Output: ${spriteW}x${spriteH}px`;
    if (state.forcedSize === 'auto') {
      sizeDetail += ` (1x Chuẩn lưới ${origCols}x${origRows})`;
    } else {
      sizeDetail += ` (Từ lưới ${origCols}x${origRows} ➔ Phóng ${spriteW}x${spriteH})`;
    }

    resultStatsText.textContent = `Ảnh gốc: ${state.originalWidth}x${state.originalHeight}px • Lưới pixel: ~${cellSize}px (${origCols}x${origRows}) • ${sizeDetail} • Nén: ${Math.round((1 - (spriteW*spriteH)/(state.originalWidth*state.originalHeight))*100)}%`;

    updateDownloadLinks(processedCanvas);
    initComparisonSlider();

    resultCard.classList.remove('hidden');
  }

  function updateDownloadLinks(canvas) {
    const filenameBase = (fileName ? fileName.textContent : 'sprite').replace(/\.[^/.]+$/, '');
    btnDownloadNative.onclick = () => downloadCanvasAsPNG(canvas, `${filenameBase}_native_1x.png`, 1);
    if (btnDownload2x) btnDownload2x.onclick = () => downloadCanvasAsPNG(canvas, `${filenameBase}_crisp_2x.png`, 2);
    btnDownload4x.onclick = () => downloadCanvasAsPNG(canvas, `${filenameBase}_crisp_4x.png`, 4);
    btnDownload8x.onclick = () => downloadCanvasAsPNG(canvas, `${filenameBase}_crisp_8x.png`, 8);
    if (btnDownload16x) btnDownload16x.onclick = () => downloadCanvasAsPNG(canvas, `${filenameBase}_hd_16x.png`, 16);

    if (btnCopyClipboard) {
      btnCopyClipboard.onclick = async () => {
        try {
          canvas.toBlob(async (blob) => {
            if (!blob) return;
            await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
            const originalText = btnCopyClipboard.innerHTML;
            btnCopyClipboard.innerHTML = `
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#10b981" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>
              <span>Đã copy!</span>
            `;
            setTimeout(() => { btnCopyClipboard.innerHTML = originalText; }, 2000);
          });
        } catch (e) {
          alert('Không thể sao chép vào Clipboard: ' + e.message);
        }
      };
    }
  }

  function downloadCanvasAsPNG(sourceCanvas, filename, scale) {
    let outCanvas = sourceCanvas;
    if (scale > 1) {
      outCanvas = document.createElement('canvas');
      outCanvas.width = sourceCanvas.width * scale;
      outCanvas.height = sourceCanvas.height * scale;
      const ctx = outCanvas.getContext('2d');
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(sourceCanvas, 0, 0, outCanvas.width, outCanvas.height);
    }

    const a = document.createElement('a');
    a.download = filename;
    a.href = outCanvas.toDataURL('image/png');
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  function initComparisonSlider() {
    if (!comparisonContainer || !comparisonSlider) return;

    const afterWrapper = document.getElementById('pixel-compare-after-wrapper');
    const updateSlider = () => {
      const val = comparisonSlider.value;
      if (afterWrapper) {
        afterWrapper.style.clipPath = `polygon(0 0, ${val}% 0, ${val}% 100%, 0 100%)`;
        afterWrapper.style.webkitClipPath = `polygon(0 0, ${val}% 0, ${val}% 100%, 0 100%)`;
      }
      if (comparisonHandle) comparisonHandle.style.left = val + '%';
    };

    comparisonSlider.oninput = updateSlider;
    updateSlider();
  }

  function showProgress(msg) {
    if (resultStatsText) {
      resultStatsText.textContent = '⚡ ' + (msg || 'Đang tinh chỉnh pixel...');
    }
    if (errorBox) errorBox.classList.add('hidden');
  }

  function hideProgress() {
    // Không hiện/ẩn progressCard dạng khối để triệt tiêu hoàn toàn hiện tượng giật nảy màn hình (Zero Layout Shift)
    if (progressCard) progressCard.classList.add('hidden');
  }

  function showError(msg) {
    if (errorBox) {
      if (errorMsg) errorMsg.textContent = msg;
      errorBox.classList.remove('hidden');
    }
  }

  function syncOutputSizeUI() {
    if (outputChips) {
      outputChips.forEach(chip => {
        const chipSize = chip.getAttribute('data-size');
        if (state.forcedSize === chipSize) {
          chip.classList.add('active');
        } else if (chipSize === `${state.customForcedWidth}x${state.customForcedHeight}` && state.forcedSize !== 'auto') {
          chip.classList.add('active');
        } else {
          chip.classList.remove('active');
        }
      });
    }

    if (customWidthInput) customWidthInput.value = state.customForcedWidth;
    if (customHeightInput) customHeightInput.value = state.customForcedHeight;

    if (quickOutputInput) {
      if (state.forcedSize === 'auto') {
        quickOutputInput.value = '';
      } else if (state.forcedSize === 'custom') {
        quickOutputInput.value = `${state.customForcedWidth}x${state.customForcedHeight}`;
      } else {
        quickOutputInput.value = state.forcedSize;
      }
    }

    if (selectForcedSize) {
      selectForcedSize.value = state.forcedSize;
    }
  }

  // =========================================================================
  // 6. PURPOSE PRESETS CONTROLLER
  // =========================================================================

  function applyPreset(presetKey) {
    state.activePreset = presetKey;

    presetButtons.forEach(btn => {
      if (btn.getAttribute('data-preset') === presetKey) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });

    switch (presetKey) {
      case 'crisp-sprite':
        state.antiAliasing = 'ultra';
        state.paletteKey = 'original';
        state.dithering = 'none';
        state.transparencyMode = 'auto';
        state.bgScope = 'boundary';
        state.outlineStyle = 'none';
        state.autoTrim = true;
        state.maxColors = 'all';
        break;

      case 'transparent-icon':
        state.antiAliasing = 'sharp';
        state.paletteKey = 'original';
        state.dithering = 'none';
        state.transparencyMode = 'auto';
        state.bgScope = 'boundary';
        state.outlineStyle = '4way';
        state.outlineColor = '#000000';
        state.autoTrim = true;
        state.maxColors = 'all';
        break;

      case 'retro-console':
        state.antiAliasing = 'sharp';
        state.paletteKey = 'pico8';
        state.dithering = 'bayer';
        state.transparencyMode = 'auto';
        state.bgScope = 'boundary';
        state.outlineStyle = 'none';
        state.autoTrim = true;
        state.maxColors = 'all';
        break;

      case 'photo-pixel':
        state.currentGridSize = '6';
        state.antiAliasing = 'mild';
        state.paletteKey = 'nes';
        state.dithering = 'floyd';
        state.transparencyMode = 'keep';
        state.outlineStyle = 'none';
        state.autoTrim = false;
        state.maxColors = '32';
        break;

      case 'fine-details':
        state.currentGridSize = '1';
        state.antiAliasing = 'mild';
        state.paletteKey = 'original';
        state.dithering = 'none';
        state.transparencyMode = 'auto';
        state.bgScope = 'boundary';
        state.outlineStyle = 'none';
        state.autoTrim = true;
        state.maxColors = 'all';
        break;

      case 'auto':
      default:
        state.currentGridSize = 'auto';
        state.antiAliasing = 'sharp';
        state.paletteKey = 'original';
        state.dithering = 'none';
        state.transparencyMode = 'auto';
        state.bgScope = 'boundary';
        state.outlineStyle = 'none';
        state.autoTrim = true;
        state.maxColors = 'all';
        break;
    }

    // Sync UI elements to state
    if (selectAntiAliasing) selectAntiAliasing.value = state.antiAliasing;
    if (selectPalette) selectPalette.value = state.paletteKey;
    if (selectDithering) selectDithering.value = state.dithering;
    if (selectBgMode) selectBgMode.value = state.transparencyMode;
    if (selectBgScope) selectBgScope.value = state.bgScope;
    if (selectOutline) selectOutline.value = state.outlineStyle;
    if (checkboxAutoTrim) checkboxAutoTrim.checked = state.autoTrim;
    if (selectMaxColors) selectMaxColors.value = state.maxColors;
    if (selectGridSize) selectGridSize.value = state.currentGridSize;
    if (selectForcedSize) selectForcedSize.value = state.forcedSize;

    if (customGridWrapper) {
      if (state.currentGridSize === 'custom') {
        customGridWrapper.classList.remove('hidden');
      } else {
        customGridWrapper.classList.add('hidden');
      }
    }

    if (customSizeWrapper) {
      if (state.forcedSize === 'custom') {
        customSizeWrapper.classList.remove('hidden');
      } else {
        customSizeWrapper.classList.add('hidden');
      }
    }

    if (outlineColorInput) {
      if (state.outlineStyle !== 'none') {
        outlineColorInput.classList.remove('hidden');
      } else {
        outlineColorInput.classList.add('hidden');
      }
    }

    if (customColorWrapper) {
      if (state.transparencyMode === 'custom') {
        customColorWrapper.classList.remove('hidden');
      } else {
        customColorWrapper.classList.add('hidden');
      }
    }

    syncOutputSizeUI();

    if (state.sourceCanvas) {
      runPixelRefineProcess();
    }
  }

  // =========================================================================
  // 7. EVENT LISTENERS & SETUP
  // =========================================================================

  function handleFileSelected(file) {
    if (!file || !file.type.startsWith('image/')) {
      showError('Vui lòng chọn một file ảnh hợp lệ (PNG, JPG, WEBP, BMP).');
      return;
    }

    if (errorBox) errorBox.classList.add('hidden');
    const reader = new FileReader();

    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        state.sourceImage = img;
        state.originalWidth = img.naturalWidth || img.width;
        state.originalHeight = img.naturalHeight || img.height;

        const canvas = document.createElement('canvas');
        canvas.width = state.originalWidth;
        canvas.height = state.originalHeight;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0);
        state.sourceCanvas = canvas;

        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        state.gridCandidates = analyzeGridCandidates(imgData);
        state.detectedGridSize = state.gridCandidates[0].size || 1;
        state.currentGridSize = 'auto';

        if (fileName) fileName.textContent = file.name;
        if (fileMeta) {
          const sizeMB = (file.size / (1024 * 1024)).toFixed(2);
          fileMeta.textContent = `${file.type.split('/')[1].toUpperCase()} • ${sizeMB} MB • ${state.originalWidth}x${state.originalHeight}px (Lưới đoán: ~${state.detectedGridSize}px)`;
        }
        if (fileThumb) fileThumb.src = e.target.result;
        if (compareBeforeImg) compareBeforeImg.src = e.target.result;

        if (selectGridSize) {
          const autoOpt = selectGridSize.querySelector('option[value="auto"]');
          if (autoOpt) autoOpt.textContent = `⚡ Tự động nhận diện (Đoán: ${state.detectedGridSize}x${state.detectedGridSize}px)`;
          selectGridSize.value = 'auto';
        }

        if (state.isRatioLocked && state.originalWidth > 0 && state.originalHeight > 0) {
          state.customForcedHeight = Math.max(1, Math.round(state.customForcedWidth * (state.originalHeight / state.originalWidth)));
          if (customHeightInput) customHeightInput.value = state.customForcedHeight;
        }

        renderGridCandidates(state.gridCandidates);

        if (dropzone) dropzone.classList.add('hidden');
        if (studioWorkspace) studioWorkspace.classList.remove('hidden');
        if (optionsPanel) optionsPanel.classList.remove('hidden');
        if (resultCard) resultCard.classList.remove('hidden');

        runPixelRefineProcess();
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  function resetFileSelection() {
    state.sourceImage = null;
    state.sourceCanvas = null;
    state.processedCanvas = null;

    if (fileInput) fileInput.value = '';
    if (dropzone) dropzone.classList.remove('hidden');
    if (studioWorkspace) studioWorkspace.classList.add('hidden');
    if (dropPrompt) dropPrompt.classList.remove('hidden');
    if (errorBox) errorBox.classList.add('hidden');
    if (gridCandidatesContainer) gridCandidatesContainer.classList.add('hidden');
    if (customGridWrapper) customGridWrapper.classList.add('hidden');
  }

  function loadSamplePixelSprite() {
    const cvs = document.createElement('canvas');
    cvs.width = 64;
    cvs.height = 64;
    const ctx = cvs.getContext('2d');
    ctx.clearRect(0, 0, 64, 64);
    ctx.imageSmoothingEnabled = false;

    const scale = 4;
    const colors = {
      1: '#1e293b', // dark border
      2: '#38bdf8', // blade light blue
      3: '#0284c7', // blade dark blue
      4: '#fbbf24', // gold hilt
      5: '#b45309', // bronze handle
      6: '#ef4444', // ruby gem
      7: '#ffffff'  // shine
    };

    const sprite = [
      "................",
      ".............11.",
      "............1721",
      "...........17221",
      "..........17221.",
      ".........17221..",
      "........17221...",
      ".......17221....",
      "......17221.....",
      ".....14221......",
      "...114441.......",
      "..164441........",
      ".155411.........",
      "1551............",
      ".11.............",
      "................"
    ];

    for (let r = 0; r < 16; r++) {
      for (let c = 0; c < 16; c++) {
        const ch = sprite[r][c];
        if (ch !== '.' && colors[ch]) {
          ctx.fillStyle = colors[ch];
          ctx.fillRect(c * scale, r * scale, scale, scale);
        }
      }
    }

    cvs.toBlob(blob => {
      if (blob) {
        const sampleFile = new File([blob], "retro_sword_sample.png", { type: "image/png" });
        handleFileSelected(sampleFile);
      }
    }, 'image/png');
  }



  function setupEventListeners() {
    if (!dropzone || !fileInput) return;

    // Presets Click
    presetButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const preset = btn.getAttribute('data-preset');
        applyPreset(preset);
      });
    });

    // Drag & Drop
    dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropzone.classList.add('dragover');
    });

    ['dragleave', 'dragend'].forEach(ev => {
      dropzone.addEventListener(ev, () => dropzone.classList.remove('dragover'));
    });

    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
      if (e.dataTransfer.files && e.dataTransfer.files[0]) {
        handleFileSelected(e.dataTransfer.files[0]);
      }
    });

    dropzone.addEventListener('click', (e) => {
      if (e.target.closest('#btn-remove-pixel-file') || e.target.closest('#btn-load-pixel-sample')) return;
      fileInput.click();
    });

    const btnLoadSample = document.getElementById('btn-load-pixel-sample');
    if (btnLoadSample) {
      btnLoadSample.addEventListener('click', (e) => {
        e.stopPropagation();
        loadSamplePixelSprite();
      });
    }

    fileInput.addEventListener('change', (e) => {
      if (e.target.files && e.target.files[0]) {
        handleFileSelected(e.target.files[0]);
      }
    });

    if (btnRemoveFile) {
      btnRemoveFile.addEventListener('click', (e) => {
        e.stopPropagation();
        resetFileSelection();
      });
    }

    if (btnProcessAnother) {
      btnProcessAnother.addEventListener('click', () => {
        resetFileSelection();
        window.scrollTo({ top: dropzone.offsetTop - 80, behavior: 'smooth' });
      });
    }

    window.addEventListener('paste', (e) => {
      const pixelSection = document.getElementById('section-pixel-mode');
      if (!pixelSection || pixelSection.classList.contains('hidden')) return;

      const items = (e.clipboardData || window.clipboardData).items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') !== -1) {
          const file = items[i].getAsFile();
          if (file) handleFileSelected(file);
          break;
        }
      }
    });

    const triggerAutoRefine = () => {
      if (state.sourceCanvas) runPixelRefineProcess();
    };

    if (selectGridSize) {
      selectGridSize.addEventListener('change', (e) => {
        state.currentGridSize = e.target.value;
        if (customGridWrapper) {
          if (state.currentGridSize === 'custom') {
            customGridWrapper.classList.remove('hidden');
          } else {
            customGridWrapper.classList.add('hidden');
          }
        }
        triggerAutoRefine();
      });
    }

    if (customGridInput) {
      customGridInput.addEventListener('input', (e) => {
        const val = parseInt(e.target.value, 10);
        if (val && val > 0) {
          state.customGridSize = val;
          state.forcedSize = 'auto';
          if (selectForcedSize) selectForcedSize.value = 'auto';
          syncOutputSizeUI();
          triggerAutoRefine();
        }
      });
    }

    if (selectAntiAliasing) {
      selectAntiAliasing.addEventListener('change', (e) => {
        state.antiAliasing = e.target.value;
        triggerAutoRefine();
      });
    }

    if (selectPalette) {
      selectPalette.addEventListener('change', (e) => {
        state.paletteKey = e.target.value;
        triggerAutoRefine();
      });
    }

    if (selectMaxColors) {
      selectMaxColors.addEventListener('change', (e) => {
        state.maxColors = e.target.value;
        triggerAutoRefine();
      });
    }

    if (selectDithering) {
      selectDithering.addEventListener('change', (e) => {
        state.dithering = e.target.value;
        triggerAutoRefine();
      });
    }

    if (selectBgMode) {
      selectBgMode.addEventListener('change', (e) => {
        state.transparencyMode = e.target.value;
        if (customColorWrapper) {
          if (state.transparencyMode === 'custom') {
            customColorWrapper.classList.remove('hidden');
          } else {
            customColorWrapper.classList.add('hidden');
          }
        }
        triggerAutoRefine();
      });
    }

    if (selectBgScope) {
      selectBgScope.addEventListener('change', (e) => {
        state.bgScope = e.target.value;
        triggerAutoRefine();
      });
    }

    if (toleranceSlider) {
      toleranceSlider.addEventListener('input', (e) => {
        state.tolerance = parseInt(e.target.value, 10);
        if (toleranceVal) toleranceVal.textContent = state.tolerance + '%';
        triggerAutoRefine();
      });
    }

    if (customColorInput) {
      customColorInput.addEventListener('change', (e) => {
        state.customBgColor = hexToRgb(e.target.value);
        triggerAutoRefine();
      });
    }

    if (selectOutline) {
      selectOutline.addEventListener('change', (e) => {
        state.outlineStyle = e.target.value;
        if (outlineColorInput) {
          if (state.outlineStyle !== 'none') {
            outlineColorInput.classList.remove('hidden');
          } else {
            outlineColorInput.classList.add('hidden');
          }
        }
        triggerAutoRefine();
      });
    }

    if (outlineColorInput) {
      outlineColorInput.addEventListener('change', (e) => {
        state.outlineColor = e.target.value;
        triggerAutoRefine();
      });
    }

    // Output Size Chips
    if (outputChips) {
      outputChips.forEach(chip => {
        chip.addEventListener('click', () => {
          const sizeVal = chip.getAttribute('data-size');
          if (sizeVal === 'auto') {
            state.forcedSize = 'auto';
          } else {
            const parts = sizeVal.split('x');
            const w = parseInt(parts[0], 10);
            const h = parts[1] ? parseInt(parts[1], 10) : w;
            state.customForcedWidth = w;
            state.customForcedHeight = h;
            state.forcedSize = sizeVal;
          }
          syncOutputSizeUI();
          triggerAutoRefine();
        });
      });
    }

    // Direct Quick Output Text Input (e.g., 32x32 or 128x128)
    if (quickOutputInput) {
      const handleQuickInput = (val) => {
        const clean = val.trim();
        if (!clean || clean.toLowerCase() === 'auto') {
          state.forcedSize = 'auto';
          syncOutputSizeUI();
          triggerAutoRefine();
          return;
        }
        const match = clean.match(/^(\d+)\s*(?:[xX*,\s]\s*(\d+))?$/);
        if (match) {
          const w = parseInt(match[1], 10);
          let h = match[2] ? parseInt(match[2], 10) : null;
          if (!h) {
            if (state.isRatioLocked && state.originalWidth > 0 && state.originalHeight > 0) {
              h = Math.max(1, Math.round(w * (state.originalHeight / state.originalWidth)));
            } else {
              h = w;
            }
          }
          if (w > 0 && h > 0) {
            state.customForcedWidth = w;
            state.customForcedHeight = h;
            state.forcedSize = `${w}x${h}`;
            syncOutputSizeUI();
            triggerAutoRefine();
          }
        }
      };

      quickOutputInput.addEventListener('input', (e) => {
        handleQuickInput(e.target.value);
      });
    }

    if (selectForcedSize) {
      selectForcedSize.addEventListener('change', (e) => {
        state.forcedSize = e.target.value;
        if (state.forcedSize !== 'auto' && state.forcedSize !== 'custom') {
          const parts = state.forcedSize.split('x');
          state.customForcedWidth = parseInt(parts[0], 10) || state.customForcedWidth;
          state.customForcedHeight = (parts[1] ? parseInt(parts[1], 10) : state.customForcedWidth);
        }
        syncOutputSizeUI();
        triggerAutoRefine();
      });
    }

    if (btnLockRatio) {
      btnLockRatio.addEventListener('click', () => {
        state.isRatioLocked = !state.isRatioLocked;
        if (state.isRatioLocked) {
          btnLockRatio.classList.add('active');
          if (lockIcon) lockIcon.textContent = '🔗 Khóa tỷ lệ';
        } else {
          btnLockRatio.classList.remove('active');
          if (lockIcon) lockIcon.textContent = '🔓 Tự do';
        }
      });
    }

    if (customWidthInput) {
      customWidthInput.addEventListener('input', (e) => {
        const w = parseInt(e.target.value, 10);
        if (w && w > 0) {
          state.customForcedWidth = w;
          if (state.isRatioLocked && state.originalWidth > 0 && state.originalHeight > 0) {
            const aspect = state.originalHeight / state.originalWidth;
            const newH = Math.max(1, Math.round(w * aspect));
            state.customForcedHeight = newH;
          }
          state.forcedSize = `${state.customForcedWidth}x${state.customForcedHeight}`;
          syncOutputSizeUI();
          triggerAutoRefine();
        }
      });
    }

    if (customHeightInput) {
      customHeightInput.addEventListener('input', (e) => {
        const h = parseInt(e.target.value, 10);
        if (h && h > 0) {
          state.customForcedHeight = h;
          if (state.isRatioLocked && state.originalWidth > 0 && state.originalHeight > 0) {
            const aspect = state.originalWidth / state.originalHeight;
            const newW = Math.max(1, Math.round(h * aspect));
            state.customForcedWidth = newW;
          }
          state.forcedSize = `${state.customForcedWidth}x${state.customForcedHeight}`;
          syncOutputSizeUI();
          triggerAutoRefine();
        }
      });
    }

    if (checkboxAutoTrim) {
      checkboxAutoTrim.addEventListener('change', (e) => {
        state.autoTrim = e.target.checked;
        triggerAutoRefine();
      });
    }

    if (btnStartProcess) {
      btnStartProcess.addEventListener('click', () => {
        runPixelRefineProcess();
      });
    }

    if (btnEyedropper) {
      btnEyedropper.addEventListener('click', async () => {
        if (window.EyeDropper) {
          try {
            const eyeDropper = new window.EyeDropper();
            const result = await eyeDropper.open();
            if (result && result.sRGBHex) {
              state.customBgColor = hexToRgb(result.sRGBHex);
              state.transparencyMode = 'custom';
              if (selectBgMode) selectBgMode.value = 'custom';
              if (customColorInput) customColorInput.value = result.sRGBHex;
              if (customColorWrapper) customColorWrapper.classList.remove('hidden');
              triggerAutoRefine();
            }
          } catch (e) {
            console.log('Eyedropper cancelled');
          }
        } else {
          alert('Trình duyệt của bạn chưa hỗ trợ Eyedropper API. Bạn có thể chọn màu tùy ý qua bảng chọn màu bên cạnh.');
        }
      });
    }

    const btnToggleLayout = document.getElementById('btn-toggle-layout');
    if (btnToggleLayout) {
      btnToggleLayout.addEventListener('click', () => {
        if (studioWorkspace) {
          studioWorkspace.classList.toggle('layout-setting-left');
          const isSettingLeft = studioWorkspace.classList.contains('layout-setting-left');
          btnToggleLayout.innerHTML = isSettingLeft ? '⇄ <span>Setting bên Trái</span>' : '⇄ <span>Visualize bên Trái</span>';
        }
      });
    }

    const btnToggleGrid = document.getElementById('btn-toggle-pixel-grid');
    if (btnToggleGrid) {
      btnToggleGrid.addEventListener('click', () => {
        isPixelGridActive = !isPixelGridActive;
        btnToggleGrid.classList.toggle('active', isPixelGridActive);
        btnToggleGrid.innerHTML = isPixelGridActive ? '⊞ <span>Tắt Lưới</span>' : '⊞ <span>Bật Lưới</span>';
        if (state.processedCanvas) {
          renderPixelGridOverlay(state.processedCanvas.width, state.processedCanvas.height);
        }
      });
    }

    const quickUpload = document.getElementById('pixel-quick-upload-trigger');
    if (quickUpload) {
      quickUpload.addEventListener('click', () => {
        if (fileInput) fileInput.click();
      });
    }
  }

  /**
   * Khởi tạo và nạp động module WebAssembly
   */
  async function initPixelWasm() {
    const statusEl = document.getElementById('wasm-engine-status');
    try {
      const v = '3.7.0';
      // 1. Tải trước file nhị phân .wasm dưới dạng ArrayBuffer để tránh hoàn toàn lỗi instantiateStreaming / MIME-Type trên các trình duyệt
      let wasmBytes = null;
      try {
        const wasmRes = await fetch(`/static/wasm/pixel_wasm_bg.wasm?v=${v}`);
        if (wasmRes.ok) {
          wasmBytes = await wasmRes.arrayBuffer();
        }
      } catch (fetchErr) {
        console.warn('Không thể fetch wasm qua /static/wasm, thử ./wasm:', fetchErr);
        try {
          const wasmRes2 = await fetch(`./wasm/pixel_wasm_bg.wasm?v=${v}`);
          if (wasmRes2.ok) {
            wasmBytes = await wasmRes2.arrayBuffer();
          }
        } catch (_) {}
      }

      let wasmImport;
      try {
        wasmImport = await import(`/static/wasm/pixel_wasm.js?v=${v}`);
      } catch (_) {
        wasmImport = await import(`./wasm/pixel_wasm.js?v=${v}`);
      }

      if (wasmImport && wasmImport.default) {
        if (wasmBytes) {
          await wasmImport.default({ module_or_path: wasmBytes });
        } else {
          await wasmImport.default();
        }
        wasmModule = wasmImport;
        console.log('🦀 [WASM Engine] Omniverse Pixel WASM Module loaded successfully!');
        if (statusEl) {
          statusEl.textContent = 'WASM Ready ⚡';
          statusEl.style.color = '#34d399';
          statusEl.style.background = 'rgba(16, 185, 129, 0.15)';
          statusEl.style.border = '1px solid rgba(16, 185, 129, 0.3)';
          statusEl.title = 'WebAssembly ACF engine đang kích hoạt cho nhận diện lưới siêu tốc';
        }
        if (state.sourceCanvas) {
          const ctx = state.sourceCanvas.getContext('2d', { willReadFrequently: true });
          const imgData = ctx.getImageData(0, 0, state.originalWidth, state.originalHeight);
          const wasmCands = analyzeGridCandidates(imgData);
          if (wasmCands && wasmCands.length > 0) {
            state.gridCandidates = wasmCands;
            state.detectedGridSize = wasmCands[0].size || 1;
            renderGridCandidates(wasmCands);
            if (selectGridSize && state.currentGridSize === 'auto') {
              const autoOpt = selectGridSize.querySelector('option[value="auto"]');
              if (autoOpt) autoOpt.textContent = `⚡ Tự động nhận diện (Đoán: ${state.detectedGridSize}x${state.detectedGridSize}px)`;
            }
          }
          runPixelRefineProcess();
        }
      }
    } catch (err) {
      console.warn('⚠️ [WASM Engine] Không thể nạp WebAssembly, chuyển sang chế độ JS thuần:', err);
      if (statusEl) {
        statusEl.textContent = 'JS Fallback ⚠️';
        statusEl.style.color = '#fbbf24';
        statusEl.style.background = 'rgba(245, 158, 11, 0.15)';
        statusEl.style.border = '1px solid rgba(245, 158, 11, 0.3)';
        statusEl.title = `Lỗi nạp WASM: ${err.message || err}`;
      }
    }
  }

  document.addEventListener('DOMContentLoaded', async () => {
    initDOMElements();
    setupEventListeners();
    await initPixelWasm();
    // Tự động nạp sprite mẫu để Visualizer (trái) và Settings (phải) hiển thị sống động ngay khi mở tab
    if (!state.sourceCanvas) {
      loadSamplePixelSprite();
    }
  });

})();
