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

  const state = {
    sourceImage: null,
    sourceCanvas: null,
    processedCanvas: null,
    originalWidth: 0,
    originalHeight: 0,
    detectedGridSize: 1,
    gridCandidates: [],
    gridMode: 'auto', // 'auto' | 'manual'
    manualStep: null,
    manualCols: null,
    manualRows: null,
    currentGridSize: 'auto',
    antiAliasing: 'sharp',
    paletteKey: 'original',
    paletteMode: 'auto', // 'auto' | 'manual'
    manualColors: 16,
    detectedPaletteK: 16,
    cachedKColors: 0,
    dithering: 'none',
    transparencyMode: 'keep',
    bgScope: 'boundary', // 'boundary' (BFS Flood fill from edges) | 'all' (All matching)
    customBgColor: [255, 255, 255],
    tolerance: 18,
    outlineStyle: 'none',
    outlineColor: '#000000',
    autoTrim: false,
    forcedSize: 'auto',
    customForcedWidth: 64,
    customForcedHeight: 64,
    isRatioLocked: true,
    customGridSize: 4,
    activePreset: 'auto',
    isEyedropperActive: false,
    ensembleGrid: null,
    manualOffsetX: null,
    manualOffsetY: null,
    cachedOffsetX: null,
    cachedOffsetY: null,
    sourceFile: null,
    gridTopology: 'uniform',
    cachedTopology: 'uniform',
    reconstructAlgo: 'original', // 'original' (Two-Stage K-Means) | 'sota' (OKLab) | 'topological' (SLIC + Skeleton)
    cachedAlgo: 'original',
    cachedSpriteCanvas: null,
    cachedCols: 0,
    cachedRows: 0,
    processCounter: 0,
  };

  // =========================================================================
  // 2. DOM ELEMENTS & WASM STATE
  // =========================================================================
  let wasmModule = null;
  let dropzone, fileInput, dropPrompt, fileInfoPreview, fileThumb, fileName, fileMeta, btnRemoveFile;
  let optionsPanel, progressCard, progressBar, progressText, resultCard, errorBox, errorMsg;
  let btnGridAuto, btnGridManual, pixelGridAutoInfo, pixelAutoGridLabel, btnCopyToManual, pixelManualGridContainer;
  let gridStepInput, gridColsInput, gridRowsInput, gridOffsetXInput, gridOffsetYInput, gridCandidatesContainer;
  let selectAntiAliasing, selectPalette, selectDithering;
  let btnPaletteAuto, btnPaletteManual, pixelAutoPaletteLabel, pixelManualPaletteContainer, pixelManualPaletteInput;
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
    dropPrompt = document.getElementById('pixel-dropzone-prompt') || document.getElementById('pixel-drop-prompt');
    fileInfoPreview = document.getElementById('pixel-file-info') || document.getElementById('pixel-file-info-preview');
    fileThumb = document.getElementById('pixel-source-thumb') || document.getElementById('pixel-file-thumb');
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

    btnGridAuto = document.getElementById('btn-grid-auto');
    btnGridManual = document.getElementById('btn-grid-manual');
    pixelGridAutoInfo = document.getElementById('pixel-grid-auto-info');
    pixelAutoGridLabel = document.getElementById('pixel-auto-grid-label');
    btnCopyToManual = document.getElementById('btn-copy-to-manual');
    pixelManualGridContainer = document.getElementById('pixel-manual-grid-container');
    gridStepInput = document.getElementById('pixel-grid-step-input');
    gridColsInput = document.getElementById('pixel-grid-cols-input');
    gridRowsInput = document.getElementById('pixel-grid-rows-input');
    gridOffsetXInput = document.getElementById('pixel-grid-offset-x-input');
    gridOffsetYInput = document.getElementById('pixel-grid-offset-y-input');
    gridCandidatesContainer = document.getElementById('pixel-grid-candidates-container');

    selectAntiAliasing = document.getElementById('pixel-aa-select');
    selectPalette = document.getElementById('pixel-palette-select');
    btnPaletteAuto = document.getElementById('btn-palette-mode-auto');
    btnPaletteManual = document.getElementById('btn-palette-mode-manual');
    pixelAutoPaletteLabel = document.getElementById('pixel-auto-palette-label');
    pixelManualPaletteContainer = document.getElementById('pixel-manual-palette-box') || document.getElementById('pixel-manual-palette-container');
    pixelManualPaletteInput = document.getElementById('pixel-manual-palette-input');
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
   * Phân tích ứng viên ô lưới bằng thuật toán JS dự phòng
   */
  function analyzeGridCandidates(imageData) {
    const { width, height, data } = imageData;
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

  /**
   * Kích hoạt nhận diện lưới nâng cao bằng Backend Rust Engine (Rayon Multi-threaded)
   */
  async function triggerBackendGridDetect(fileOrCanvas) {
    const statusEl = document.getElementById('wasm-engine-status');
    if (statusEl) {
      statusEl.textContent = 'Rust: Đang tính... ⚡';
      statusEl.style.color = '#38bdf8';
    }

    try {
      let blob = fileOrCanvas instanceof Blob ? fileOrCanvas : null;
      if (!blob && fileOrCanvas && fileOrCanvas.toBlob) {
        blob = await new Promise(resolve => fileOrCanvas.toBlob(resolve, 'image/png'));
      }
      if (!blob) throw new Error('Không có dữ liệu ảnh');

      const fd = new FormData();
      fd.append('file', blob, 'image.png');

      const res = await fetch('/api/pixel/detect?mode=full', {
        method: 'POST',
        body: fd,
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      if (data && data.success) {
        console.log('🦀 [Backend Rust Pixel Art Fixer (Rayon Core)]:', data);
        state.ensembleGrid = data;
        state.detectedGridSize = Math.max(1, Math.round((data.step_x + data.step_y) / 2));
        if (Array.isArray(data.candidates) && data.candidates.length > 0) {
          state.gridCandidates = data.candidates;
        }

        if (statusEl) {
          const badge = data.consensus || 'full';
          statusEl.textContent = `Rust: ${badge} ⚡`;
          statusEl.style.color = '#34d399';
          statusEl.style.background = 'rgba(16, 185, 129, 0.15)';
          statusEl.style.border = '1px solid rgba(16, 185, 129, 0.3)';
          statusEl.title = `Rust Core (${badge}): ${data.step_x.toFixed(2)}x${data.step_y.toFixed(2)}px (${data.cols}x${data.rows}), offset: (${data.offset_x.toFixed(2)}, ${data.offset_y.toFixed(2)}) - Tin cậy: ${data.confidence}% (${(data.secs * 1000).toFixed(1)}ms)`;
        }

        if (pixelAutoGridLabel) {
          pixelAutoGridLabel.textContent = `${data.step_x.toFixed(2)}x${data.step_y.toFixed(2)} px (${data.cols}x${data.rows})`;
        }
        if (gridStepInput && !gridStepInput.value) {
          gridStepInput.value = data.step_x.toFixed(2);
          if (gridColsInput) gridColsInput.value = data.cols;
          if (gridRowsInput) gridRowsInput.value = data.rows;
        }

        renderGridCandidates(state.gridCandidates);
        runPixelRefineProcess();
        return;
      }
    } catch (err) {
      console.warn('Backend Rust detect error, using client fallback:', err);
      if (statusEl) {
        statusEl.textContent = 'Client Fallback ⚠️';
        statusEl.style.color = '#fbbf24';
        statusEl.style.background = 'rgba(245, 158, 11, 0.15)';
        statusEl.style.border = '1px solid rgba(245, 158, 11, 0.3)';
        statusEl.title = `Backend Rust không phản hồi (${err.message}). Đang dùng thuật toán client fallback.`;
      }
    }
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
   * Tính toán số lượng màu tự động (adaptive_k) chuẩn Pixel Art Fixer
   */
  function computeAdaptiveK(bytes, width, height) {
    const cnt = new Uint32Array(4096);
    let total = 0;
    for (let i = 0; i < width * height; i++) {
      if (bytes[i * 4 + 3] > 0) {
        const k = (((bytes[i * 4] >> 4) & 0xF) << 8)
                | (((bytes[i * 4 + 1] >> 4) & 0xF) << 4)
                | ((bytes[i * 4 + 2] >> 4) & 0xF);
        cnt[k]++;
        total++;
      }
    }
    if (total === 0) return 16;
    let kCount = 0;
    const thresh = total * 0.003;
    for (let i = 0; i < 4096; i++) {
      if (cnt[i] >= thresh) kCount++;
    }
    return Math.max(16, Math.min(48, kCount));
  }

  /**
   * Giới hạn số lượng màu (Thuật toán Median Cut chuẩn bảo toàn màu sắc)
   */
  function quantizeColors(bytes, width, height, maxCount) {
    if (maxCount <= 0 || maxCount >= 256) return;

    // 1. Thu thập danh sách màu độc nhất kèm tần suất xuất hiện
    const colorMap = {};
    for (let i = 0; i < width * height; i++) {
      const idx = i * 4;
      if (bytes[idx + 3] === 0) continue;
      const key = `${bytes[idx]}_${bytes[idx + 1]}_${bytes[idx + 2]}`;
      colorMap[key] = (colorMap[key] || 0) + 1;
    }

    const uniqueKeys = Object.keys(colorMap);
    if (uniqueKeys.length <= maxCount) return;

    // Tạo mảng các pixel RGB
    const pixels = uniqueKeys.map(k => k.split('_').map(Number));
    let boxes = [pixels];

    // 2. Chia nhỏ các hộp màu theo trục có độ phân tán lớn nhất (Median Cut)
    while (boxes.length < maxCount) {
      let bestIdx = -1;
      let maxRange = -1;
      let splitAxis = 0;

      for (let b = 0; b < boxes.length; b++) {
        const box = boxes[b];
        if (box.length <= 1) continue;

        let minR = 255, maxR = 0;
        let minG = 255, maxG = 0;
        let minB = 255, maxB = 0;

        for (let i = 0; i < box.length; i++) {
          const p = box[i];
          if (p[0] < minR) minR = p[0]; if (p[0] > maxR) maxR = p[0];
          if (p[1] < minG) minG = p[1]; if (p[1] > maxG) maxG = p[1];
          if (p[2] < minB) minB = p[2]; if (p[2] > maxB) maxB = p[2];
        }

        const rRange = maxR - minR;
        const gRange = maxG - minG;
        const bRange = maxB - minB;
        const range = Math.max(rRange, gRange, bRange);

        if (range > maxRange) {
          maxRange = range;
          bestIdx = b;
          splitAxis = (rRange >= gRange && rRange >= bRange) ? 0 : (gRange >= bRange ? 1 : 2);
        }
      }

      if (bestIdx === -1 || maxRange <= 0) break;

      const targetBox = boxes[bestIdx];
      targetBox.sort((a, b) => a[splitAxis] - b[splitAxis]);
      const mid = Math.floor(targetBox.length / 2);
      const box1 = targetBox.slice(0, mid);
      const box2 = targetBox.slice(mid);

      boxes.splice(bestIdx, 1, box1, box2);
    }

    // 3. Tính centroid đại diện cho từng cụm màu có xét tần suất
    const palette = boxes.map(box => {
      let r = 0, g = 0, b = 0, total = 0;
      for (let i = 0; i < box.length; i++) {
        const p = box[i];
        const weight = colorMap[`${p[0]}_${p[1]}_${p[2]}`] || 1;
        r += p[0] * weight;
        g += p[1] * weight;
        b += p[2] * weight;
        total += weight;
      }
      total = Math.max(1, total);
      return [Math.round(r / total), Math.round(g / total), Math.round(b / total)];
    });

    // 4. Gán lại màu gần nhất
    for (let i = 0; i < width * height; i++) {
      const idx = i * 4;
      if (bytes[idx + 3] === 0) continue;
      const c = findClosestColor(bytes[idx], bytes[idx + 1], bytes[idx + 2], palette);
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

  /**
   * Gọi Backend Rust Engine (/api/pixel/fix) để tái tạo Sprite gốc chuẩn thuật toán Pixel Art Fixer
   * (Áp dụng Snapped Cuts + Modal Color Extraction + Dark Stroke + Wu Optimal Palette)
   */
  async function fetchBackendReconstruct(sourceCanvas, cols, rows, stepX, stepY, autoPalette, offsetX, offsetY) {
    try {
      const blob = await new Promise((resolve) => {
        sourceCanvas.toBlob((b) => resolve(b), 'image/png');
      });
      if (!blob) return null;

      const fd = new FormData();
      fd.append('file', blob, 'source.png');
      if (cols) fd.append('cols', cols);
      if (rows) fd.append('rows', rows);
      if (stepX) fd.append('step_x', stepX);
      if (stepY) fd.append('step_y', stepY);
      if (offsetX !== null && offsetX !== undefined) fd.append('offset_x', offsetX);
      if (offsetY !== null && offsetY !== undefined) fd.append('offset_y', offsetY);
      const isElastic = state.gridTopology === 'elastic';
      const elasticParam = isElastic ? '&elastic=true' : '';
      fd.append('mode', 'advanced');
      fd.append('algo', 'original');
      if (autoPalette) fd.append('auto_palette', 'true');
      if (isElastic) fd.append('elastic', 'true');

      const effectiveK = state.paletteMode === 'manual' ? (parseInt(state.manualColors, 10) || 16) : 0;
      if (effectiveK > 0) {
        fd.append('k_colors', effectiveK);
      }
      const kColorsParam = effectiveK > 0 ? `&k_colors=${effectiveK}` : '';

      const res = await fetch(`/api/pixel/fix?algo=original${elasticParam}${kColorsParam}`, {
        method: 'POST',
        body: fd,
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      // Đọc thông tin nhận diện ô lưới và thuật toán từ Headers của worker-pixelfixer
      const headerCols = parseInt(res.headers.get('x-grid-cols'), 10);
      const headerRows = parseInt(res.headers.get('x-grid-rows'), 10);
      const headerStepX = parseFloat(res.headers.get('x-grid-stepx'));
      const headerStepY = parseFloat(res.headers.get('x-grid-stepy'));
      const headerOffsetX = parseFloat(res.headers.get('x-grid-offsetx'));
      const headerOffsetY = parseFloat(res.headers.get('x-grid-offsety'));
      const headerConsensus = res.headers.get('x-grid-consensus') || 'fast';
      const headerTopology = res.headers.get('x-grid-topology') || state.gridTopology;
      const headerAlgo = res.headers.get('x-reconstruct-algo') || state.reconstructAlgo || 'original';
      const headerDownloadUrl = res.headers.get('x-download-url');
      const headerFilename = res.headers.get('x-filename');
      const headerInputFilename = res.headers.get('x-input-filename');
      const headerCache = res.headers.get('x-cache');
      const headerCandidatesStr = res.headers.get('x-grid-candidates');
      let headerCandidates = null;
      if (headerCandidatesStr) {
        try { headerCandidates = JSON.parse(headerCandidatesStr); } catch (e) {}
      }

      const pngBlob = await res.blob();
      const img = new Image();
      const url = URL.createObjectURL(pngBlob);

      await new Promise((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = (e) => reject(e);
        img.src = url;
      });

      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth || headerCols || cols || 1;
      canvas.height = img.naturalHeight || headerRows || rows || 1;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);

      return {
        canvas,
        cols: canvas.width,
        rows: canvas.height,
        stepX: headerStepX || stepX,
        stepY: headerStepY || stepY,
        offsetX: !isNaN(headerOffsetX) ? headerOffsetX : (offsetX || 0),
        offsetY: !isNaN(headerOffsetY) ? headerOffsetY : (offsetY || 0),
        consensus: headerConsensus,
        topology: headerTopology,
        algo: headerAlgo,
        candidates: headerCandidates,
        downloadUrl: headerDownloadUrl,
        filename: headerFilename,
        inputFilename: headerInputFilename,
        cache: headerCache,
      };
    } catch (err) {
      console.warn('⚠️ [Backend Rust Fix Fallback]:', err);
      return null;
    }
  }

  async function runPixelRefineProcess() {
    if (!state.sourceCanvas) return;

    const localProcessId = ++state.processCounter;
    showProgress('Đang xử lý làm sạch và tinh chỉnh sprite pixel (Rust Core ⚡)...');

    try {
      const srcW = state.originalWidth;
      const srcH = state.originalHeight;

      // 1. Xác định Kích thước và Tọa độ Ô Lưới (Grid Cell & Native Geometry)
      let cols = null, rows = null, stepX = null, stepY = null, offsetX = null, offsetY = null;
      let cellSizeLabel = '';

      if (state.gridMode === 'auto') {
        if (state.ensembleGrid) {
          stepX = state.ensembleGrid.step_x;
          stepY = state.ensembleGrid.step_y;
          cols = Math.max(1, state.ensembleGrid.cols);
          rows = Math.max(1, state.ensembleGrid.rows);
          offsetX = state.ensembleGrid.offset_x ?? null;
          offsetY = state.ensembleGrid.offset_y ?? null;
          cellSizeLabel = `${stepX.toFixed(2)}x${stepY.toFixed(2)}`;
        }
        // Nếu chưa có ensembleGrid, giữ cols/rows null để worker tự detect
      } else {
        // Chế độ Manual: Lấy từ state.manual* hoặc kế thừa liền mạch từ state.ensembleGrid
        cols = state.manualCols || state.ensembleGrid?.cols || null;
        rows = state.manualRows || state.ensembleGrid?.rows || null;
        stepX = state.manualStep || state.ensembleGrid?.step_x || null;
        stepY = (state.ensembleGrid && cols === state.ensembleGrid.cols && rows === state.ensembleGrid.rows)
          ? state.ensembleGrid.step_y
          : (rows && srcH ? (srcH / rows) : stepX);
        offsetX = state.manualOffsetX !== null && state.manualOffsetX !== undefined
          ? state.manualOffsetX
          : (state.ensembleGrid?.offset_x ?? null);
        offsetY = state.manualOffsetY !== null && state.manualOffsetY !== undefined
          ? state.manualOffsetY
          : (state.ensembleGrid?.offset_y ?? null);

        if (!cols && !rows && !stepX) {
          // Fallback an toàn nếu hoàn toàn chưa có thông số nào
          stepX = 4.0;
          stepY = 4.0;
          cols = Math.max(1, Math.round(srcW / 4.0));
          rows = Math.max(1, Math.round(srcH / 4.0));
        } else if (!cols || !rows) {
          cols = cols || Math.max(1, Math.round(srcW / (stepX || 4.0)));
          rows = rows || Math.max(1, Math.round(srcH / (stepY || stepX || 4.0)));
        }
        cellSizeLabel = `${(stepX || 4.0).toFixed(2)}x${(stepY || 4.0).toFixed(2)}`;
      }

      // 2. TÁI TẠO SPRITE: Ưu tiên Backend Rust Engine (/api/pixel/fix)
      let spriteCanvas = null;
      let usedRustReconstruct = false;

      const effectiveK = state.paletteMode === 'manual' ? (parseInt(state.manualColors, 10) || 16) : 0;

      // Kiểm tra cache nếu kích thước lưới cols x rows, topology, antiAliasing và offset không đổi
      if (cols && rows && state.cachedSpriteCanvas && state.cachedCols === cols && state.cachedRows === rows && state.cachedTopology === state.gridTopology && state.cachedAntiAliasing === state.antiAliasing && state.cachedOffsetX === offsetX && state.cachedOffsetY === offsetY) {
        spriteCanvas = document.createElement('canvas');
        spriteCanvas.width = cols;
        spriteCanvas.height = rows;
        const cCtx = spriteCanvas.getContext('2d', { willReadFrequently: true });
        cCtx.drawImage(state.cachedSpriteCanvas, 0, 0);
        usedRustReconstruct = true;
      } else {
        const autoPal = state.antiAliasing === 'ultra';
        const backendResult = await fetchBackendReconstruct(state.sourceCanvas, cols, rows, stepX, stepY, autoPal, offsetX, offsetY);

        // Bỏ qua nếu có request mới hơn đang chạy
        if (localProcessId !== state.processCounter) {
          console.log('[PixelRefiner] Đã huỷ kết quả cũ do có thao tác mới.');
          return;
        }

        if (backendResult && backendResult.canvas) {
          spriteCanvas = backendResult.canvas;
          cols = backendResult.cols;
          rows = backendResult.rows;
          if (backendResult.stepX) stepX = backendResult.stepX;
          if (backendResult.stepY) stepY = backendResult.stepY;
          if (backendResult.offsetX !== undefined) offsetX = backendResult.offsetX;
          if (backendResult.offsetY !== undefined) offsetY = backendResult.offsetY;
          cellSizeLabel = `${stepX.toFixed(1)}x${stepY.toFixed(1)}`;
          usedRustReconstruct = true;

          // Cập nhật thông tin nhận diện ô lưới tự động từ Backend
          if (state.gridMode === 'auto') {
            state.ensembleGrid = {
              cols,
              rows,
              step_x: stepX,
              step_y: stepY,
              offset_x: offsetX,
              offset_y: offsetY,
              consensus: backendResult.consensus,
            };
          }

          state.detectedGridSize = Math.max(1, Math.round((stepX + stepY) / 2));
          if (backendResult.candidates && backendResult.candidates.length > 0) {
            state.gridCandidates = backendResult.candidates;
            renderGridCandidates(state.gridCandidates);
          }
          if (pixelAutoGridLabel) {
            pixelAutoGridLabel.textContent = `${stepX.toFixed(2)}x${stepY.toFixed(2)} px (${cols}x${rows}) [off: ${offsetX.toFixed(2)}, ${offsetY.toFixed(2)}]`;
          }
          if (gridStepInput && !gridStepInput.value) {
            gridStepInput.value = stepX.toFixed(2);
            if (gridColsInput) gridColsInput.value = cols;
            if (gridRowsInput) gridRowsInput.value = rows;
            if (gridOffsetXInput && !gridOffsetXInput.value) gridOffsetXInput.value = offsetX.toFixed(2);
            if (gridOffsetYInput && !gridOffsetYInput.value) gridOffsetYInput.value = offsetY.toFixed(2);
          }

          // Cập nhật metadata tải file chất lượng cao từ backend
          state.backendDownloadUrl = backendResult.downloadUrl;
          state.backendFilename = backendResult.filename;

          // Cập nhật thẻ trạng thái nhận diện ô lưới trên UI
          if (pixelGridAutoInfo) {
            const consensus = backendResult.consensus || 'fast';
            const cacheHit = backendResult.cache === 'HIT' ? ' ⚡(Cache)' : '';
            const badge = `${consensus}${cacheHit}`;
            const statusEl = document.getElementById('pixel-auto-detect-badge');
            if (statusEl) {
              statusEl.textContent = `Rust: ${badge}`;
              statusEl.title = `Rust Native: ${stepX.toFixed(2)}x${stepY.toFixed(2)} (${cols}x${rows}), offset: (${offsetX.toFixed(2)}, ${offsetY.toFixed(2)}), topology: ${backendResult.topology}`;
            }
          }

          state.cachedSpriteCanvas = spriteCanvas;
          state.cachedCols = cols;
          state.cachedRows = rows;
          state.cachedTopology = state.gridTopology;
          state.cachedKColors = effectiveK;
          state.cachedAntiAliasing = state.antiAliasing;
          console.log(`🦀 [Rust Native Reconstruct]: Tái tạo thành công ${cols}x${rows} (step: ${stepX.toFixed(2)}x${stepY.toFixed(2)}, topology: ${state.gridTopology}).`);
        } else {
          // Fallback Client nếu Backend ngắt kết nối
          console.warn('⚠️ [Client Fallback Reconstruct]: Đang lấy mẫu màu bằng Canvas 2D.');

          if (state.gridMode === 'auto' && (!cols || !rows)) {
            const srcCtx = state.sourceCanvas.getContext('2d', { willReadFrequently: true });
            const srcImgData = srcCtx.getImageData(0, 0, srcW, srcH);
            const candidates = analyzeGridCandidates(srcImgData);
            state.gridCandidates = candidates;
            renderGridCandidates(candidates);

            const bestSize = (candidates && candidates.length > 0) ? candidates[0].size : 4;
            state.detectedGridSize = bestSize;
            stepX = bestSize;
            stepY = bestSize;
            cols = Math.max(1, Math.round(srcW / stepX));
            rows = Math.max(1, Math.round(srcH / stepY));
            cellSizeLabel = `${stepX.toFixed(2)}x${stepY.toFixed(2)}`;
            if (pixelAutoGridLabel) {
              pixelAutoGridLabel.textContent = `${stepX.toFixed(2)}x${stepY.toFixed(2)} px (${cols}x${rows})`;
            }
          } else {
            cols = cols || Math.max(1, Math.round(srcW / (state.detectedGridSize || 4)));
            rows = rows || Math.max(1, Math.round(srcH / (state.detectedGridSize || 4)));
            stepX = stepX || (srcW / cols);
            stepY = stepY || (srcH / rows);
            cellSizeLabel = `${stepX.toFixed(2)}x${stepY.toFixed(2)}`;
          }

          const srcCtx = state.sourceCanvas.getContext('2d', { willReadFrequently: true });
          const srcImgData = srcCtx.getImageData(0, 0, srcW, srcH);
          const srcBytes = srcImgData.data;

          spriteCanvas = document.createElement('canvas');
          spriteCanvas.width = cols;
          spriteCanvas.height = rows;
          const fallbackCtx = spriteCanvas.getContext('2d', { willReadFrequently: true });
          const fallbackImgData = fallbackCtx.createImageData(cols, rows);
          const fallbackBytes = fallbackImgData.data;

          for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
              const cellColor = sampleCellColor(
                srcBytes, srcW, srcH,
                offsetX + c * stepX, offsetY + r * stepY, stepX, stepY,
                state.antiAliasing
              );
              const idx = (r * cols + c) * 4;
              fallbackBytes[idx] = cellColor[0];
              fallbackBytes[idx + 1] = cellColor[1];
              fallbackBytes[idx + 2] = cellColor[2];
              fallbackBytes[idx + 3] = cellColor[3];
            }
          }
          fallbackCtx.putImageData(fallbackImgData, 0, 0);
        }
      }

      // 3. KIỂM TRA BỘ LỌC BỔ TRỢ (CHỈ CHẠY KHI NGƯỜI DÙNG BẬT)
      // Khi effectiveK > 0: Người dùng yêu cầu giới hạn số màu palette (4, 8, 16, 32, 64 hoặc Custom)
      const hasPostProcessing = (
        state.transparencyMode !== 'keep' ||
        effectiveK > 0 ||
        (state.paletteKey !== 'original' && RETRO_PALETTES[state.paletteKey]?.colors) ||
        state.outlineStyle !== 'none'
      );

      if (hasPostProcessing) {
        const spriteCtx = spriteCanvas.getContext('2d', { willReadFrequently: true });
        const spriteImgData = spriteCtx.getImageData(0, 0, cols, rows);
        const spriteBytes = spriteImgData.data;

        // A. Xóa nền thông minh với Boundary BFS
        if (state.transparencyMode !== 'keep') {
          let targetBg = state.customBgColor;
          if (state.transparencyMode === 'auto') {
            targetBg = estimateBorderColor(spriteBytes, cols, rows);
          }

          const tolDist = (state.tolerance / 100) * 441.67;

          if (state.bgScope === 'boundary') {
            removeBackgroundBFS(spriteBytes, cols, rows, targetBg, tolDist);
          } else {
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

        // B. Giới hạn số lượng màu (Quantize bằng Median Cut)
        if (effectiveK > 0) {
          quantizeColors(spriteBytes, cols, rows, effectiveK);
        }

        // C. Ép bảng màu Retro & Dithering
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

        // D. Viền Outline
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
      }

      // 4. Auto Trim (Chỉ chạy khi người dùng chủ động tích chọn)
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

        if (!cellSizeLabel || cellSizeLabel === 'auto') {
          const cStepX = (srcW / (cols || 1)).toFixed(1);
          const cStepY = (srcH / (rows || 1)).toFixed(1);
          cellSizeLabel = `${cStepX}x${cStepY}`;
        }

        displayRefinedResult(finalCanvas, spriteCanvas, cols, rows, cellSizeLabel);
        hideProgress();

      } catch (err) {
        console.error('[PixelRefiner Error]', err);
        hideProgress();
        showError('Đã xảy ra lỗi trong quá trình xử lý pixel: ' + err.message);
      }
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

    const activeSize = state.gridMode === 'auto' ? state.detectedGridSize : (state.manualStep || 1);

    candidates.forEach((cand, idx) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      const isCandActive = Math.abs(cand.size - activeSize) < 0.05;
      btn.className = `pixel-cand-btn ${isCandActive ? 'active' : ''}`;
      btn.innerHTML = `<span>${cand.size}x${cand.size}px</span> <small>${cand.confidence}%</small>`;
      btn.title = `Chọn kích thước lưới ${cand.size}px (Độ tin cậy: ${cand.confidence}%)`;

      btn.addEventListener('click', () => {
        gridCandidatesContainer.querySelectorAll('.pixel-cand-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        // Chuyển sang chế độ Manual
        state.gridMode = 'manual';
        state.manualStep = cand.size;
        if (btnGridAuto) btnGridAuto.classList.remove('active');
        if (btnGridManual) btnGridManual.classList.add('active');
        if (pixelGridAutoInfo) pixelGridAutoInfo.classList.add('hidden');
        if (pixelManualGridContainer) pixelManualGridContainer.classList.remove('hidden');

        if (gridStepInput) gridStepInput.value = cand.size;
        if (state.originalWidth && state.originalHeight) {
          const cols = Math.max(1, Math.round(state.originalWidth / cand.size));
          const rows = Math.max(1, Math.round(state.originalHeight / cand.size));
          state.manualCols = cols;
          state.manualRows = rows;
          if (gridColsInput) gridColsInput.value = cols;
          if (gridRowsInput) gridRowsInput.value = rows;
        }

        state.cachedSpriteCanvas = null;
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

    if (comparisonContainer) {
      comparisonContainer.classList.remove('is-processing');
    }

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

    const cacheLabel = state.backendCacheHit ? ' • ⚡ Cache Hit' : '';
    let algoLabel = ' • 🏛️ Thuật toán Gốc (Pixel Art Fixer)';
    if (state.reconstructAlgo === 'topological') {
      algoLabel = ' • 🧬 Topological Engine (SLIC + Skeleton)';
    } else if (state.reconstructAlgo === 'sota') {
      algoLabel = ' • ✨ SOTA Engine';
    }
    resultStatsText.textContent = `Ảnh gốc: ${state.originalWidth}x${state.originalHeight}px • Lưới pixel: ~${cellSize}px (${origCols}x${origRows}) • ${sizeDetail} • Nén: ${Math.round((1 - (spriteW*spriteH)/(state.originalWidth*state.originalHeight))*100)}%${algoLabel}${cacheLabel}`;

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
    if (comparisonContainer) {
      comparisonContainer.classList.add('is-processing');
    }
    const overlayText = document.getElementById('pixel-overlay-text');
    if (overlayText) {
      overlayText.textContent = msg || 'Đang tái tạo pixel art (Rust Core ⚡)...';
    }
    if (resultStatsText) {
      resultStatsText.textContent = '⚡ ' + (msg || 'Đang tinh chỉnh pixel...');
    }
    if (errorBox) errorBox.classList.add('hidden');
  }

  function hideProgress() {
    if (progressCard) progressCard.classList.add('hidden');
    if (comparisonContainer) {
      comparisonContainer.classList.remove('is-processing');
    }
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
        state.transparencyMode = 'keep';
        state.bgScope = 'boundary';
        state.outlineStyle = 'none';
        state.autoTrim = false;
        state.maxColors = 'all';
        break;
    }

    // Sync UI elements to state
    if (selectAntiAliasing) selectAntiAliasing.value = state.antiAliasing;
    if (selectPalette) selectPalette.value = state.paletteKey;
    if (btnPaletteAuto) {
      btnPaletteAuto.classList.toggle('active', state.paletteMode === 'auto');
    }
    if (btnPaletteManual) {
      btnPaletteManual.classList.toggle('active', state.paletteMode === 'manual');
    }
    if (pixelManualPaletteContainer) {
      pixelManualPaletteContainer.classList.toggle('active', state.paletteMode === 'manual');
    }
    if (pixelManualPaletteInput) {
      pixelManualPaletteInput.value = state.manualColors;
    }
    if (selectDithering) selectDithering.value = state.dithering;
    if (selectBgMode) selectBgMode.value = state.transparencyMode;
    if (selectBgScope) selectBgScope.value = state.bgScope;
    if (selectOutline) selectOutline.value = state.outlineStyle;
    if (checkboxAutoTrim) checkboxAutoTrim.checked = state.autoTrim;
    if (state.gridMode === 'manual') {
      if (btnGridManual) btnGridManual.classList.add('active');
      if (btnGridAuto) btnGridAuto.classList.remove('active');
      if (pixelGridAutoInfo) pixelGridAutoInfo.classList.add('hidden');
      if (pixelManualGridContainer) pixelManualGridContainer.classList.remove('hidden');
      if (gridStepInput && state.manualStep) gridStepInput.value = state.manualStep;
    } else {
      if (btnGridAuto) btnGridAuto.classList.add('active');
      if (btnGridManual) btnGridManual.classList.remove('active');
      if (pixelGridAutoInfo) pixelGridAutoInfo.classList.remove('hidden');
      if (pixelManualGridContainer) pixelManualGridContainer.classList.add('hidden');
    }
    if (selectForcedSize) selectForcedSize.value = state.forcedSize;

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
    const isImage = file && (
      (file.type && file.type.startsWith('image/')) ||
      /\.(png|jpe?g|webp|bmp|gif|avif)$/i.test(file.name || '')
    );
    if (!isImage) {
      showError('Vui lòng chọn một file ảnh hợp lệ (PNG, JPG, WEBP, BMP).');
      return;
    }

    if (errorBox) errorBox.classList.add('hidden');
    state.sourceFile = file;
    state.cachedSpriteCanvas = null;
    state.cachedCols = 0;
    state.cachedRows = 0;
    state.ensembleGrid = null;
    state.manualOffsetX = null;
    state.manualOffsetY = null;
    state.cachedOffsetX = null;
    state.cachedOffsetY = null;
    if (gridOffsetXInput) gridOffsetXInput.value = '';
    if (gridOffsetYInput) gridOffsetYInput.value = '';
    state.processCounter++;

    // Xóa triệt để kết quả ảnh cũ để tránh lỗi đè ảnh cũ lên ảnh mới
    if (compareAfterCanvas) {
      const afterCtx = compareAfterCanvas.getContext('2d');
      afterCtx.clearRect(0, 0, compareAfterCanvas.width, compareAfterCanvas.height);
      compareAfterCanvas.width = 1;
      compareAfterCanvas.height = 1;
    }

    const tagAfter = document.getElementById('pixel-tag-after');
    if (tagAfter) {
      tagAfter.textContent = '⚡ ĐANG TÁI TẠO PIXEL ART...';
      tagAfter.style.background = 'rgba(59, 130, 246, 0.9)';
    }

    if (comparisonContainer) {
      comparisonContainer.classList.add('is-processing');
    }

    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      state.sourceImage = img;
      state.originalWidth = img.naturalWidth || img.width;
      state.originalHeight = img.naturalHeight || img.height;

      const canvas = document.createElement('canvas');
      canvas.width = state.originalWidth;
      canvas.height = state.originalHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      state.sourceCanvas = canvas;
      try {
        const srcData = ctx.getImageData(0, 0, state.originalWidth, state.originalHeight).data;
        state.detectedPaletteK = computeAdaptiveK(srcData, state.originalWidth, state.originalHeight);
        if (pixelAutoPaletteLabel) {
          pixelAutoPaletteLabel.textContent = `${state.detectedPaletteK} màu`;
        }
      } catch (e) {
        console.warn('Cannot compute adaptive K:', e);
      }

      state.currentGridSize = 'auto';
      state.forcedSize = 'auto';
      syncOutputSizeUI();

      if (fileName) fileName.textContent = file.name || 'pixel_art.png';
      if (fileMeta) {
        const sizeMB = file.size ? (file.size / (1024 * 1024)).toFixed(2) : '0.00';
        let ext = 'PNG';
        if (file.type && file.type.includes('/')) {
          ext = file.type.split('/')[1].toUpperCase();
        } else if (file.name && file.name.includes('.')) {
          ext = file.name.split('.').pop().toUpperCase();
        }
        fileMeta.textContent = `${ext} • ${sizeMB} MB • ${state.originalWidth}x${state.originalHeight}px`;
      }
      if (fileThumb) fileThumb.src = objectUrl;
      if (compareBeforeImg) compareBeforeImg.src = objectUrl;

      if (pixelAutoGridLabel) {
        pixelAutoGridLabel.textContent = 'Đang tự động nhận diện...';
      }

      if (state.isRatioLocked && state.originalWidth > 0 && state.originalHeight > 0) {
        state.customForcedHeight = Math.max(1, Math.round(state.customForcedWidth * (state.originalHeight / state.originalWidth)));
        if (customHeightInput) customHeightInput.value = state.customForcedHeight;
      }

      if (dropzone) dropzone.classList.add('hidden');
      if (studioWorkspace) studioWorkspace.classList.remove('hidden');
      if (optionsPanel) optionsPanel.classList.remove('hidden');
      if (resultCard) resultCard.classList.remove('hidden');

      // Tinh chỉnh ngay bằng Rust Core ⚡ trong 1 request duy nhất (tránh độ trễ gọi kép)
      runPixelRefineProcess();
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      hideProgress();
      showError('Không thể mở hoặc giải mã file ảnh này. Vui lòng thử lại với định dạng khác (PNG, JPG, WEBP, BMP).');
    };
    img.src = objectUrl;
  }

  function resetFileSelection() {
    state.sourceImage = null;
    state.sourceCanvas = null;
    state.processedCanvas = null;
    state.sourceFile = null;
    state.cachedSpriteCanvas = null;
    state.cachedCols = 0;
    state.cachedRows = 0;
    state.ensembleGrid = null;
    state.manualOffsetX = null;
    state.manualOffsetY = null;
    state.cachedOffsetX = null;
    state.cachedOffsetY = null;
    if (gridOffsetXInput) gridOffsetXInput.value = '';
    if (gridOffsetYInput) gridOffsetYInput.value = '';
    state.processCounter++;

    if (compareAfterCanvas) {
      const ctx = compareAfterCanvas.getContext('2d');
      ctx.clearRect(0, 0, compareAfterCanvas.width, compareAfterCanvas.height);
      compareAfterCanvas.width = 1;
      compareAfterCanvas.height = 1;
    }
    if (comparisonContainer) {
      comparisonContainer.classList.remove('is-processing');
    }

    if (fileInput) fileInput.value = '';
    if (dropzone) dropzone.classList.remove('hidden');
    if (studioWorkspace) studioWorkspace.classList.add('hidden');
    if (dropPrompt) dropPrompt.classList.remove('hidden');
    if (errorBox) errorBox.classList.add('hidden');
    if (gridCandidatesContainer) gridCandidatesContainer.classList.add('hidden');
    if (pixelManualGridContainer) pixelManualGridContainer.classList.add('hidden');
    if (btnGridAuto) btnGridAuto.classList.add('active');
    if (btnGridManual) btnGridManual.classList.remove('active');
    state.gridMode = 'auto';
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
      if (e.target === fileInput || e.target.closest('#btn-remove-pixel-file')) return;
      fileInput.click();
    });

    fileInput.addEventListener('change', (e) => {
      if (e.target.files && e.target.files[0]) {
        handleFileSelected(e.target.files[0]);
      }
      fileInput.value = '';
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

    let refineDebounceTimer = null;
    const triggerAutoRefine = (delay = 70) => {
      if (!state.sourceCanvas) return;
      if (refineDebounceTimer) clearTimeout(refineDebounceTimer);
      if (delay <= 0) {
        runPixelRefineProcess();
      } else {
        refineDebounceTimer = setTimeout(() => {
          runPixelRefineProcess();
        }, delay);
      }
    };

    // Chuyển đổi chế độ Lưới Tự Động vs Điền Thủ Công (Hỗ trợ số thập phân)
    if (btnGridAuto) {
      btnGridAuto.addEventListener('click', () => {
        if (state.gridMode === 'auto') return;
        state.gridMode = 'auto';
        btnGridAuto.classList.add('active');
        if (btnGridManual) btnGridManual.classList.remove('active');
        if (pixelGridAutoInfo) pixelGridAutoInfo.classList.remove('hidden');
        if (pixelManualGridContainer) pixelManualGridContainer.classList.add('hidden');
        // Kích hoạt lại chế độ auto, giữ nguyên cache nếu thông số không đổi
        triggerAutoRefine(0);
      });
    }

    if (btnGridManual) {
      btnGridManual.addEventListener('click', () => {
        if (state.gridMode === 'manual') return;
        state.gridMode = 'manual';
        btnGridManual.classList.add('active');
        if (btnGridAuto) btnGridAuto.classList.remove('active');
        if (pixelGridAutoInfo) pixelGridAutoInfo.classList.add('hidden');
        if (pixelManualGridContainer) pixelManualGridContainer.classList.remove('hidden');

        // Đồng bộ toàn bộ thông số tự động sang các ô input thủ công
        if (state.ensembleGrid) {
          state.manualStep = state.ensembleGrid.step_x;
          state.manualCols = state.ensembleGrid.cols;
          state.manualRows = state.ensembleGrid.rows;
          state.manualOffsetX = state.ensembleGrid.offset_x || 0;
          state.manualOffsetY = state.ensembleGrid.offset_y || 0;
          if (gridStepInput) gridStepInput.value = state.ensembleGrid.step_x.toFixed(2);
          if (gridColsInput) gridColsInput.value = state.ensembleGrid.cols;
          if (gridRowsInput) gridRowsInput.value = state.ensembleGrid.rows;
          if (gridOffsetXInput) gridOffsetXInput.value = (state.ensembleGrid.offset_x || 0).toFixed(2);
          if (gridOffsetYInput) gridOffsetYInput.value = (state.ensembleGrid.offset_y || 0).toFixed(2);
        }
        // Giữ nguyên cache ảnh hiện tại - không làm thay đổi hay nhấp nháy ảnh khi vừa click
        triggerAutoRefine(0);
      });
    }

    if (btnCopyToManual) {
      btnCopyToManual.addEventListener('click', () => {
        if (btnGridManual) btnGridManual.click();
        if (gridStepInput) gridStepInput.focus();
      });
    }

    // Nhập Cỡ Ô (Step) số thập phân
    if (gridStepInput) {
      gridStepInput.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        if (!isNaN(val) && val > 0.05) {
          state.manualStep = val;
          if (state.originalWidth && state.originalHeight) {
            const cols = Math.max(1, Math.round(state.originalWidth / val));
            const rows = Math.max(1, Math.round(state.originalHeight / val));
            state.manualCols = cols;
            state.manualRows = rows;
            if (gridColsInput) gridColsInput.value = cols;
            if (gridRowsInput) gridRowsInput.value = rows;
          }
          state.cachedSpriteCanvas = null;
          triggerAutoRefine(300);
        }
      });
    }

    // Nhập Lệch Pha (Offset X, Y) số thập phân
    if (gridOffsetXInput) {
      gridOffsetXInput.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        state.manualOffsetX = !isNaN(val) ? val : 0;
        state.cachedSpriteCanvas = null;
        triggerAutoRefine(300);
      });
    }
    if (gridOffsetYInput) {
      gridOffsetYInput.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        state.manualOffsetY = !isNaN(val) ? val : 0;
        state.cachedSpriteCanvas = null;
        triggerAutoRefine(300);
      });
    }

    // Nhập Số Cột và Số Hàng
    const handleColsRowsChange = () => {
      const c = parseInt(gridColsInput?.value, 10);
      const r = parseInt(gridRowsInput?.value, 10);
      if (c && c > 0 && r && r > 0) {
        state.manualCols = c;
        state.manualRows = r;
        if (state.originalWidth) {
          const step = parseFloat((state.originalWidth / c).toFixed(2));
          state.manualStep = step;
          if (gridStepInput) gridStepInput.value = step;
        }
        state.cachedSpriteCanvas = null;
        triggerAutoRefine(300);
      }
    };
    if (gridColsInput) gridColsInput.addEventListener('input', handleColsRowsChange);
    if (gridRowsInput) gridRowsInput.addEventListener('input', handleColsRowsChange);

    // Grid Topology Buttons (Uniform vs Elastic)
    document.querySelectorAll('.pixel-topology-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const topo = btn.getAttribute('data-topology') || 'uniform';
        if (state.gridTopology === topo) return;
        state.gridTopology = topo;
        document.querySelectorAll('.pixel-topology-btn').forEach((b) => {
          b.classList.toggle('active', b.getAttribute('data-topology') === topo);
        });
        state.cachedSpriteCanvas = null;
        triggerAutoRefine(0);
      });
    });

    if (selectAntiAliasing) {
      selectAntiAliasing.addEventListener('change', (e) => {
        state.antiAliasing = e.target.value;
        state.cachedSpriteCanvas = null;
        triggerAutoRefine(0);
      });
    }

    if (selectPalette) {
      selectPalette.addEventListener('change', (e) => {
        state.paletteKey = e.target.value;
        triggerAutoRefine();
      });
    }

    if (btnPaletteAuto) {
      btnPaletteAuto.addEventListener('click', () => {
        if (state.paletteMode === 'auto') return;
        state.paletteMode = 'auto';
        btnPaletteAuto.classList.add('active');
        if (btnPaletteManual) btnPaletteManual.classList.remove('active');
        if (pixelManualPaletteContainer) pixelManualPaletteContainer.classList.remove('active');
        triggerAutoRefine(0);
      });
    }

    if (btnPaletteManual) {
      btnPaletteManual.addEventListener('click', () => {
        if (state.paletteMode === 'manual') return;
        state.paletteMode = 'manual';
        btnPaletteManual.classList.add('active');
        if (btnPaletteAuto) btnPaletteAuto.classList.remove('active');
        if (pixelManualPaletteContainer) pixelManualPaletteContainer.classList.add('active');
        if (pixelManualPaletteInput) pixelManualPaletteInput.focus();
        triggerAutoRefine(0);
      });
    }

    if (pixelManualPaletteContainer) {
      pixelManualPaletteContainer.addEventListener('click', () => {
        if (pixelManualPaletteInput) pixelManualPaletteInput.focus();
      });
    }

    if (pixelManualPaletteInput) {
      const activateManual = () => {
        if (state.paletteMode !== 'manual') {
          state.paletteMode = 'manual';
          if (btnPaletteAuto) btnPaletteAuto.classList.remove('active');
          if (btnPaletteManual) btnPaletteManual.classList.add('active');
          if (pixelManualPaletteContainer) pixelManualPaletteContainer.classList.add('active');
        }
      };

      pixelManualPaletteInput.addEventListener('focus', () => {
        activateManual();
      });

      pixelManualPaletteInput.addEventListener('input', (e) => {
        activateManual();
        const val = parseInt(e.target.value, 10);
        if (!isNaN(val) && val >= 2) {
          state.manualColors = Math.min(256, Math.max(2, val));
          triggerAutoRefine(150);
        }
      });

      pixelManualPaletteInput.addEventListener('change', (e) => {
        activateManual();
        let val = parseInt(e.target.value, 10);
        if (isNaN(val) || val < 2) val = 2;
        if (val > 256) val = 256;
        e.target.value = val;
        state.manualColors = val;
        triggerAutoRefine(0);
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
      quickUpload.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          if (fileInput) fileInput.click();
        }
      });
      quickUpload.addEventListener('dragover', (e) => {
        e.preventDefault();
        quickUpload.classList.add('dragover');
      });
      ['dragleave', 'dragend'].forEach(ev => {
        quickUpload.addEventListener(ev, () => quickUpload.classList.remove('dragover'));
      });
      quickUpload.addEventListener('drop', (e) => {
        e.preventDefault();
        quickUpload.classList.remove('dragover');
        if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) {
          handleFileSelected(e.dataTransfer.files[0]);
        }
      });
    }

    const btnLoadSample = document.getElementById('btn-load-pixel-sample');
    if (btnLoadSample) {
      btnLoadSample.addEventListener('click', () => {
        loadSamplePixelSprite();
      });
    }

    // Kéo thả ảnh trực tiếp vào toàn bộ khung Studio (ngay cả khi đã mở ảnh)
    const studioCard = document.querySelector('.pixel-studio-card');
    if (studioCard) {
      studioCard.addEventListener('dragover', (e) => {
        e.preventDefault();
      });
      studioCard.addEventListener('drop', (e) => {
        if (e.target.closest('#pixel-dropzone') || e.target.closest('#pixel-quick-upload-trigger')) return;
        e.preventDefault();
        if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) {
          handleFileSelected(e.dataTransfer.files[0]);
        }
      });
    }
  }

  /**
   * Kiểm tra kết nối với Backend Rust Microservice (worker-pixelfixer)
   */
  async function checkBackendEngine() {
    const statusEl = document.getElementById('wasm-engine-status');
    try {
      const resp = await fetch('/api/pixel/health').catch(() => null);
      if (resp && resp.ok) {
        if (statusEl) {
          statusEl.textContent = 'Backend Rust ⚡';
          statusEl.style.color = '#34d399';
          statusEl.style.background = 'rgba(16, 185, 129, 0.15)';
          statusEl.style.border = '1px solid rgba(16, 185, 129, 0.3)';
          statusEl.title = 'Pixel Art Fixer Rust Backend (Rayon đa luồng) sẵn sàng phục vụ';
        }
      } else {
        if (statusEl) {
          statusEl.textContent = 'Client Engine (WASM/JS)';
          statusEl.style.color = '#38bdf8';
          statusEl.style.background = 'rgba(56, 189, 248, 0.15)';
          statusEl.style.border = '1px solid rgba(56, 189, 248, 0.3)';
          statusEl.title = 'Trình duyệt đang tự động xử lý trực tiếp trên máy client';
        }
      }
    } catch (_) {
      if (statusEl) {
        statusEl.textContent = 'Client Engine (WASM/JS)';
      }
    }
  }

  const initPixelRefiner = async () => {
    initDOMElements();
    setupEventListeners();
    await checkBackendEngine();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPixelRefiner);
  } else {
    initPixelRefiner();
  }

})();
