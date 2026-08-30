document.addEventListener('DOMContentLoaded', () => {
  // ==========================================
  // 1. MODE SWITCHER (URL to MP3/MP4 vs File Conver vs Extract Text)
  // ==========================================
  const modeUrlBtn = document.getElementById('mode-url-btn');
  const modeFileBtn = document.getElementById('mode-file-btn');
  const modeTranscribeBtn = document.getElementById('mode-transcribe-btn');
  const sectionUrlMode = document.getElementById('section-url-mode');
  const sectionFileMode = document.getElementById('section-file-mode');
  const sectionTranscribeMode = document.getElementById('section-transcribe-mode');

  function switchMode(mode) {
    const allBtns = [modeUrlBtn, modeFileBtn, modeTranscribeBtn];
    const allSecs = [sectionUrlMode, sectionFileMode, sectionTranscribeMode];

    allBtns.forEach(btn => {
      if (btn) {
        if (btn.getAttribute('data-mode') === mode) {
          btn.classList.add('active');
        } else {
          btn.classList.remove('active');
        }
      }
    });

    allSecs.forEach(sec => {
      if (sec) sec.classList.add('hidden');
    });

    if (mode === 'url' && sectionUrlMode) {
      sectionUrlMode.classList.remove('hidden');
    } else if (mode === 'file' && sectionFileMode) {
      sectionFileMode.classList.remove('hidden');
    } else if (mode === 'transcribe' && sectionTranscribeMode) {
      sectionTranscribeMode.classList.remove('hidden');
    }
  }

  // Event delegation trên container để click vào icon svg hay text đều hoạt động 100%
  const modeSwitcher = document.querySelector('.mode-switcher');
  if (modeSwitcher) {
    modeSwitcher.addEventListener('click', (e) => {
      const btn = e.target.closest('.mode-btn');
      if (btn) {
        e.preventDefault();
        const mode = btn.getAttribute('data-mode');
        if (mode) switchMode(mode);
      }
    });
  }

  // Backup direct listeners
  if (modeUrlBtn) modeUrlBtn.addEventListener('click', () => switchMode('url'));
  if (modeFileBtn) modeFileBtn.addEventListener('click', () => switchMode('file'));
  if (modeTranscribeBtn) modeTranscribeBtn.addEventListener('click', () => switchMode('transcribe'));

  // ==========================================
  // 2. URL TO MP3 / MP4 LOGIC
  // ==========================================
  const form = document.getElementById('convert-form');
  const urlInput = document.getElementById('url-input');
  const pasteBtn = document.getElementById('paste-btn');
  const convertBtn = document.getElementById('convert-btn');

  // Loading & Error elements
  const infoLoading = document.getElementById('info-loading');
  const errorBox = document.getElementById('error-box');
  const errorMessage = document.getElementById('error-message');

  // Result Card elements
  const mediaResultCard = document.getElementById('media-result-card');
  const mediaThumb = document.getElementById('media-thumb');
  const mediaDuration = document.getElementById('media-duration');
  const mediaTitle = document.getElementById('media-title');
  const formatTabBtns = document.querySelectorAll('.format-tabs .tab-btn');
  const qualityTableBody = document.getElementById('quality-table-body');

  // Progress Banner elements
  const activeProgressBanner = document.getElementById('active-progress-banner');
  const activeStatusText = document.getElementById('active-status-text');
  const activePercentText = document.getElementById('active-percent-text');
  const activeProgressBar = document.getElementById('active-progress-bar');

  let currentActiveTab = 'mp3';
  let currentTargetUrl = '';
  let activeEventSource = null;

  // Cấu hình danh sách chất lượng theo định dạng
  const formatRows = {
    mp3: [
      { quality: '320', title: '320 kbps', sub: 'lame (Cực cao)', format: 'mp3' },
      { quality: '256', title: '256 kbps', sub: 'lame (Rất tốt)', format: 'mp3' },
      { quality: '192', title: '192 kbps', sub: 'lame (Chuẩn)', format: 'mp3' },
      { quality: '128', title: '128 kbps', sub: 'lame (Tiết kiệm)', format: 'mp3' }
    ],
    mp4: [
      { quality: '1080', title: '1080p', sub: 'Full HD (1080p)', format: 'mp4' },
      { quality: '720', title: '720p', sub: 'HD (720p)', format: 'mp4' },
      { quality: '480', title: '480p', sub: 'SD (480p)', format: 'mp4' },
      { quality: '360', title: '360p', sub: 'Medium (360p)', format: 'mp4' }
    ]
  };

  // Render bảng chất lượng theo tab đang chọn
  function renderTable(format) {
    if (!qualityTableBody) return;
    qualityTableBody.innerHTML = '';
    const rows = formatRows[format] || formatRows.mp3;

    rows.forEach(row => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="col-quality">
          <div class="quality-title">${row.title}</div>
          <div class="quality-sub">${row.sub}</div>
        </td>
        <td class="col-format">${row.format}</td>
        <td class="col-action">
          <button type="button" class="btn-table-action" data-format="${row.format}" data-quality="${row.quality}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="7 10 12 15 17 10"></polyline>
              <line x1="12" y1="15" x2="12" y2="3"></line>
            </svg>
            <span>Download</span>
          </button>
        </td>
      `;
      qualityTableBody.appendChild(tr);
    });

    attachDownloadEvents();
  }

  // Chuyển Tab (MP3 / MP4)
  formatTabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      formatTabBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentActiveTab = btn.dataset.tab;
      renderTable(currentActiveTab);
    });
  });

  // Paste Button
  if (pasteBtn && urlInput) {
    pasteBtn.addEventListener('click', async () => {
      try {
        const text = await navigator.clipboard.readText();
        if (text) {
          urlInput.value = text.trim();
          urlInput.focus();
        }
      } catch (err) {
        urlInput.focus();
      }
    });
  }

  function showError(msg) {
    if (errorMessage) errorMessage.textContent = msg;
    if (errorBox) errorBox.classList.remove('hidden');
    if (infoLoading) infoLoading.classList.add('hidden');
    if (convertBtn) convertBtn.disabled = false;
  }

  function hideError() {
    if (errorBox) errorBox.classList.add('hidden');
  }

  // Handle Form Submit (Click "Convert" URL)
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      hideError();

      const url = urlInput ? urlInput.value.trim() : '';
      if (!url || (!url.startsWith('http://') && !url.startsWith('https://'))) {
        showError('Vui lòng nhập một đường link hợp lệ!');
        return;
      }

      currentTargetUrl = url;
      if (convertBtn) convertBtn.disabled = true;
      if (infoLoading) infoLoading.classList.remove('hidden');
      if (mediaResultCard) mediaResultCard.classList.add('hidden');
      if (activeProgressBanner) activeProgressBanner.classList.add('hidden');

      try {
        const res = await fetch('/api/info', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url })
        });

        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.detail || 'Không thể trích xuất thông tin video từ liên kết này.');
        }

        const info = data.data;
        if (mediaTitle) mediaTitle.textContent = info.title;
        if (mediaDuration) mediaDuration.textContent = info.duration_str;
        if (mediaThumb) mediaThumb.src = info.thumbnail || '';
        
        if (infoLoading) infoLoading.classList.add('hidden');
        if (mediaResultCard) mediaResultCard.classList.remove('hidden');
        if (convertBtn) convertBtn.disabled = false;

        renderTable(currentActiveTab);
        if (mediaResultCard) mediaResultCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

      } catch (err) {
        showError(err.message || 'Lỗi kết nối máy chủ.');
      }
    });
  }

  // Xử lý khi bấm nút Download ở một hàng cụ thể trong bảng
  function attachDownloadEvents() {
    if (!qualityTableBody) return;
    const actionBtns = qualityTableBody.querySelectorAll('.btn-table-action');
    actionBtns.forEach(btn => {
      btn.addEventListener('click', async () => {
        const format = btn.dataset.format;
        const quality = btn.dataset.quality;

        if (!currentTargetUrl) return;

        if (activeEventSource) activeEventSource.close();

        actionBtns.forEach(b => b.disabled = true);
        btn.classList.add('loading');
        btn.innerHTML = `
          <div class="spinner" style="width:14px;height:14px;border-width:2px;"></div>
          <span>Đang xử lý...</span>
        `;

        if (activeProgressBanner) activeProgressBanner.classList.remove('hidden');
        if (activeProgressBar) activeProgressBar.style.width = '5%';
        if (activePercentText) activePercentText.textContent = '5%';
        if (activeStatusText) activeStatusText.textContent = `Đang bắt đầu tải ${format.toUpperCase()} (${quality})...`;

        try {
          const res = await fetch('/api/download', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              url: currentTargetUrl,
              format: format,
              quality: quality
            })
          });

          const data = await res.json();
          if (!res.ok || !data.success) {
            throw new Error(data.detail || 'Không thể tạo tác vụ tải về.');
          }

          const jobId = data.job_id;
          listenJobProgress(jobId, btn);

        } catch (err) {
          showError(err.message || 'Lỗi khởi tạo tải file.');
          resetBtnState(btn);
          actionBtns.forEach(b => b.disabled = false);
        }
      });
    });
  }

  function listenJobProgress(jobId, triggerBtn) {
    activeEventSource = new EventSource(`/api/stream/${jobId}`);

    activeEventSource.addEventListener('progress', (e) => {
      try {
        const job = JSON.parse(e.data);
        handleProgressUpdate(job, triggerBtn);
      } catch (err) {
        console.error('Lỗi parse SSE:', err);
      }
    });

    activeEventSource.onerror = () => {
      activeEventSource.close();
      fallbackPoll(jobId, triggerBtn);
    };
  }

  function handleProgressUpdate(job, triggerBtn) {
    if (job.status === 'downloading') {
      const pct = job.percent || 0;
      if (activeProgressBar) activeProgressBar.style.width = `${pct}%`;
      if (activePercentText) activePercentText.textContent = `${pct}%`;
      if (activeStatusText) activeStatusText.textContent = `Đang tải: ${pct}% (${job.speed || '-'})`;
    } else if (job.status === 'converting') {
      if (activeProgressBar) activeProgressBar.style.width = '99%';
      if (activePercentText) activePercentText.textContent = '99%';
      if (activeStatusText) activeStatusText.textContent = 'Đang nén & chuyển đổi định dạng (FFmpeg)...';
    } else if (job.status === 'completed') {
      if (activeEventSource) activeEventSource.close();

      const cleanName = job.filename.split('_').slice(1).join('_') || job.filename;
      if (activeProgressBar) activeProgressBar.style.width = '100%';
      if (activePercentText) activePercentText.textContent = '100%';
      if (activeStatusText) {
        activeStatusText.innerHTML = `
          <div style="display:flex;align-items:center;justify-content:space-between;width:100%;gap:12px;flex-wrap:wrap;">
            <span>🎉 Convert thành công: <b>${cleanName}</b></span>
            <a href="${job.download_url}" download="${cleanName}" class="btn-table-action" style="background:#10b981;color:#fff;border:none;">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
              <span>Bấm Để Lưu File</span>
            </a>
          </div>
        `;
      }

      if (triggerBtn) {
        triggerBtn.classList.remove('loading');
        triggerBtn.innerHTML = `
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
          <span>Lưu File</span>
        `;
        triggerBtn.style.background = "#10b981";
        triggerBtn.style.color = "#fff";
      }

      document.querySelectorAll('.btn-table-action').forEach(b => b.disabled = false);

      try {
        const downloadAnchor = document.createElement('a');
        downloadAnchor.href = job.download_url;
        downloadAnchor.setAttribute('download', cleanName);
        document.body.appendChild(downloadAnchor);
        downloadAnchor.click();
        document.body.removeChild(downloadAnchor);
      } catch (e) {
        window.location.href = job.download_url;
      }

    } else if (job.status === 'error') {
      if (activeEventSource) activeEventSource.close();
      showError(job.error || 'Quá trình tải thất bại.');
      if (triggerBtn) resetBtnState(triggerBtn);
      document.querySelectorAll('.btn-table-action').forEach(b => b.disabled = false);
      if (activeProgressBanner) activeProgressBanner.classList.add('hidden');
    }
  }

  function resetBtnState(btn) {
    if (!btn) return;
    btn.classList.remove('loading');
    btn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
        <polyline points="7 10 12 15 17 10"></polyline>
        <line x1="12" y1="15" x2="12" y2="3"></line>
      </svg>
      <span>Download</span>
    `;
  }

  function fallbackPoll(jobId, triggerBtn) {
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/status/${jobId}`);
        if (!res.ok) throw new Error('Không tìm thấy job');
        const job = await res.json();
        handleProgressUpdate(job, triggerBtn);
        if (job.status === 'completed' || job.status === 'error') {
          clearInterval(interval);
        }
      } catch (err) {
        clearInterval(interval);
      }
    }, 1500);
  }

  // ==========================================
  // 3. FILE CONVER (GOTENBERG) LOGIC
  // ==========================================
  const fileDropzone = document.getElementById('file-dropzone');
  const fileInput = document.getElementById('file-input');
  const dropzonePrompt = document.getElementById('dropzone-prompt');
  const fileSelectedView = document.getElementById('file-selected-view');
  const fileIconBadge = document.getElementById('file-icon-badge');
  const selectedFileName = document.getElementById('selected-file-name');
  const selectedFileSize = document.getElementById('selected-file-size');
  const btnRemoveFile = document.getElementById('btn-remove-file');

  const fileOptionsPanel = document.getElementById('file-options-panel');
  const pageOrientationSelect = document.getElementById('page-orientation');
  const pdfaFormatSelect = document.getElementById('pdfa-format');
  const btnConvertFile = document.getElementById('btn-convert-file');

  const fileErrorBox = document.getElementById('file-error-box');
  const fileErrorMessage = document.getElementById('file-error-message');
  const fileProgressBanner = document.getElementById('file-progress-banner');
  const fileStatusText = document.getElementById('file-status-text');
  const filePercentText = document.getElementById('file-percent-text');
  const fileProgressBar = document.getElementById('file-progress-bar');

  const fileResultCard = document.getElementById('file-result-card');
  const resultPdfFilename = document.getElementById('result-pdf-filename');
  const resultPdfFilesize = document.getElementById('result-pdf-filesize');
  const btnDownloadPdf = document.getElementById('btn-download-pdf');
  const btnConvertAnother = document.getElementById('btn-convert-another');

  let selectedFileObj = null;

  function formatFileBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  function getBadgeColorAndText(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    switch (ext) {
      case 'docx': case 'doc':
        return { text: 'DOCX', bg: 'linear-gradient(135deg, #2563eb, #3b82f6)' };
      case 'xlsx': case 'xls': case 'csv': case 'ods':
        return { text: 'EXCEL', bg: 'linear-gradient(135deg, #059669, #10b981)' };
      case 'pptx': case 'ppt': case 'odp':
        return { text: 'PPTX', bg: 'linear-gradient(135deg, #ea580c, #f97316)' };
      case 'md': case 'markdown':
        return { text: 'MD', bg: 'linear-gradient(135deg, #7c3aed, #8b5cf6)' };
      case 'html': case 'htm':
        return { text: 'HTML', bg: 'linear-gradient(135deg, #0891b2, #06b6d4)' };
      case 'txt': case 'rtf': case 'odt':
        return { text: 'TEXT', bg: 'linear-gradient(135deg, #475569, #64748b)' };
      default:
        return { text: ext.toUpperCase() || 'FILE', bg: 'linear-gradient(135deg, #3b82f6, #6366f1)' };
    }
  }

  function handleFileSelect(file) {
    if (!file) return;

    if (file.size > 100 * 1024 * 1024) {
      showFileError('Dung lượng file vượt quá giới hạn 100MB!');
      return;
    }

    hideFileError();
    selectedFileObj = file;

    const badgeInfo = getBadgeColorAndText(file.name);
    if (fileIconBadge) {
      fileIconBadge.textContent = badgeInfo.text;
      fileIconBadge.style.background = badgeInfo.bg;
    }
    if (selectedFileName) selectedFileName.textContent = file.name;
    if (selectedFileSize) selectedFileSize.textContent = formatFileBytes(file.size);

    if (dropzonePrompt) dropzonePrompt.classList.add('hidden');
    if (fileSelectedView) fileSelectedView.classList.remove('hidden');
    if (fileOptionsPanel) fileOptionsPanel.classList.remove('hidden');
    if (fileResultCard) fileResultCard.classList.add('hidden');
    if (fileProgressBanner) fileProgressBanner.classList.add('hidden');
  }

  function resetFileSelection() {
    selectedFileObj = null;
    if (fileInput) fileInput.value = '';
    if (dropzonePrompt) dropzonePrompt.classList.remove('hidden');
    if (fileSelectedView) fileSelectedView.classList.add('hidden');
    if (fileOptionsPanel) fileOptionsPanel.classList.add('hidden');
    if (fileResultCard) fileResultCard.classList.add('hidden');
    if (fileProgressBanner) fileProgressBanner.classList.add('hidden');
    hideFileError();
  }

  function showFileError(msg) {
    if (fileErrorMessage) fileErrorMessage.textContent = msg;
    if (fileErrorBox) fileErrorBox.classList.remove('hidden');
    if (fileProgressBanner) fileProgressBanner.classList.add('hidden');
    if (btnConvertFile) {
      btnConvertFile.disabled = false;
      btnConvertFile.innerHTML = `
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>
        <span>Chuyển Đổi Sang PDF (Gotenberg)</span>
      `;
    }
  }

  function hideFileError() {
    if (fileErrorBox) fileErrorBox.classList.add('hidden');
  }

  // Dropzone Events
  if (fileInput) {
    fileInput.addEventListener('change', (e) => {
      if (e.target.files && e.target.files.length > 0) {
        handleFileSelect(e.target.files[0]);
      }
    });
  }

  if (fileDropzone) {
    ['dragenter', 'dragover'].forEach(eventName => {
      fileDropzone.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        fileDropzone.classList.add('drag-over');
      }, false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
      fileDropzone.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        fileDropzone.classList.remove('drag-over');
      }, false);
    });

    fileDropzone.addEventListener('drop', (e) => {
      const dt = e.dataTransfer;
      if (dt && dt.files && dt.files.length > 0) {
        handleFileSelect(dt.files[0]);
      }
    });
  }

  if (btnRemoveFile) {
    btnRemoveFile.addEventListener('click', (e) => {
      e.stopPropagation();
      resetFileSelection();
    });
  }

  if (btnConvertAnother) {
    btnConvertAnother.addEventListener('click', () => {
      resetFileSelection();
      if (fileDropzone) fileDropzone.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  }

  // Handle Convert File Button
  if (btnConvertFile) {
    btnConvertFile.addEventListener('click', async () => {
      if (!selectedFileObj) {
        showFileError('Vui lòng chọn hoặc kéo thả một file tài liệu!');
        return;
      }

      hideFileError();
      btnConvertFile.disabled = true;
      btnConvertFile.innerHTML = `
        <div class="spinner" style="width:16px;height:16px;border-width:2px;"></div>
        <span>Đang gửi sang Gotenberg Engine...</span>
      `;

      if (fileProgressBanner) fileProgressBanner.classList.remove('hidden');
      if (fileProgressBar) fileProgressBar.style.width = '30%';
      if (filePercentText) filePercentText.textContent = '30%';
      if (fileStatusText) fileStatusText.textContent = 'Đang tải file lên và kết nối LibreOffice / Chromium...';

      const formData = new FormData();
      formData.append('file', selectedFileObj);
      if (pageOrientationSelect) {
        formData.append('landscape', pageOrientationSelect.value === 'landscape' ? 'true' : 'false');
      }
      if (pdfaFormatSelect && pdfaFormatSelect.value) {
        formData.append('pdfa', pdfaFormatSelect.value);
      }

      try {
        setTimeout(() => {
          if (fileProgressBar) {
            fileProgressBar.style.width = '70%';
            filePercentText.textContent = '70%';
            fileStatusText.textContent = 'Gotenberg đang xử lý và xuất file PDF...';
          }
        }, 600);

        const res = await fetch('/api/convert/file', {
          method: 'POST',
          body: formData
        });

        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.detail || 'Quá trình chuyển đổi thất bại qua Gotenberg Engine.');
        }

        if (fileProgressBar) fileProgressBar.style.width = '100%';
        if (filePercentText) filePercentText.textContent = '100%';
        if (fileStatusText) fileStatusText.textContent = 'Chuyển đổi PDF thành công!';

        if (resultPdfFilename) resultPdfFilename.textContent = data.output_filename || 'document.pdf';
        if (resultPdfFilesize) resultPdfFilesize.textContent = data.size_str || formatFileBytes(data.size || 0);
        if (btnDownloadPdf) {
          btnDownloadPdf.href = data.download_url;
          btnDownloadPdf.setAttribute('download', data.output_filename || 'document.pdf');
        }

        if (fileResultCard) {
          fileResultCard.classList.remove('hidden');
          fileResultCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }

        try {
          const downloadAnchor = document.createElement('a');
          downloadAnchor.href = data.download_url;
          downloadAnchor.setAttribute('download', data.output_filename || 'document.pdf');
          document.body.appendChild(downloadAnchor);
          downloadAnchor.click();
          document.body.removeChild(downloadAnchor);
        } catch (e) {
          // Fallback
        }

        btnConvertFile.disabled = false;
        btnConvertFile.innerHTML = `
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>
          <span>Chuyển Đổi Lại</span>
        `;

      } catch (err) {
        showFileError(err.message || 'Lỗi kết nối tới máy chủ khi chuyển đổi file.');
      }
    });
  }

  // ==========================================
  // 4. EXTRACT TEXT (FASTER-WHISPER) LOGIC
  // ==========================================
  const transcribeDropzone = document.getElementById('transcribe-dropzone');
  const transcribeFileInput = document.getElementById('transcribe-file-input');
  const transcribePrompt = document.getElementById('transcribe-dropzone-prompt');
  const transcribeFileInfo = document.getElementById('transcribe-file-info');
  const transcribeFileName = document.getElementById('transcribe-file-name');
  const transcribeFileMeta = document.getElementById('transcribe-file-meta');
  const transcribeFileIcon = document.getElementById('transcribe-file-icon');
  const btnRemoveTranscribeFile = document.getElementById('btn-remove-transcribe-file');

  const transcribeOptionsPanel = document.getElementById('transcribe-options-panel');
  const transcribeLanguageSelect = document.getElementById('transcribe-language');
  const transcribeFormatSelect = document.getElementById('transcribe-format');
  const btnStartTranscribe = document.getElementById('btn-start-transcribe');

  const transcribeProgressCard = document.getElementById('transcribe-progress-banner') || document.getElementById('transcribe-progress-card');
  const transcribeProgressText = document.getElementById('transcribe-progress-text');
  const transcribeResultCard = document.getElementById('transcribe-result-card');
  const transcribeResultText = document.getElementById('transcribe-result-text');
  const btnCopyTranscribe = document.getElementById('btn-copy-transcribe');
  const btnCopyTranscribeRaw = document.getElementById('btn-copy-transcribe-raw');
  const copyBtnLabel = document.getElementById('copy-btn-label');
  const transcribeDownloadBtn = document.getElementById('transcribe-download-btn');
  const btnTranscribeAnother = document.getElementById('btn-transcribe-another');
  const tagLang = document.getElementById('tag-lang');
  const tagDuration = document.getElementById('tag-duration');
  const tagTime = document.getElementById('tag-time');
  const transcribeErrorBox = document.getElementById('transcribe-error-box');
  const transcribeErrorMessage = document.getElementById('transcribe-error-message');

  // Elements for Video/Audio Player & Synced Lyrics
  const transcribeMediaPlayer = document.getElementById('transcribe-media-player');
  const transcribeAudioVisual = document.getElementById('transcribe-audio-visual');
  const playerMediaTitle = document.getElementById('player-media-title');
  const audioEqualizer = document.getElementById('audio-equalizer');
  const transcribeLyricsContainer = document.getElementById('transcribe-lyrics-container');
  const tabLyricsLive = document.getElementById('tab-lyrics-live');
  const tabLyricsRaw = document.getElementById('tab-lyrics-raw');
  const lyricsSyncView = document.getElementById('lyrics-sync-view');
  const lyricsRawView = document.getElementById('lyrics-raw-view');

  let selectedTranscribeFile = null;
  let currentMediaBlobUrl = null;
  let activeLyricSegments = [];
  let isUserScrollingLyrics = false;
  let userScrollTimeout = null;

  function showTranscribeError(msg) {
    if (transcribeErrorMessage) transcribeErrorMessage.textContent = msg;
    if (transcribeErrorBox) {
      transcribeErrorBox.classList.remove('hidden');
      transcribeErrorBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  function hideTranscribeError() {
    if (transcribeErrorBox) transcribeErrorBox.classList.add('hidden');
  }

  function resetTranscribeSelection() {
    selectedTranscribeFile = null;
    if (currentMediaBlobUrl) {
      URL.revokeObjectURL(currentMediaBlobUrl);
      currentMediaBlobUrl = null;
    }
    if (transcribeMediaPlayer) {
      transcribeMediaPlayer.pause();
      transcribeMediaPlayer.src = '';
      transcribeMediaPlayer.load();
    }
    activeLyricSegments = [];
    hideTranscribeError();
    if (transcribeFileInput) transcribeFileInput.value = '';
    if (transcribePrompt) transcribePrompt.classList.remove('hidden');
    if (transcribeFileInfo) transcribeFileInfo.classList.add('hidden');
    if (transcribeOptionsPanel) transcribeOptionsPanel.classList.add('hidden');
    if (transcribeProgressCard) transcribeProgressCard.classList.add('hidden');
    if (transcribeResultCard) transcribeResultCard.classList.add('hidden');
    if (btnStartTranscribe) {
      btnStartTranscribe.disabled = false;
      btnStartTranscribe.innerHTML = `
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
        <span>Trích Xuất Văn Bản</span>
      `;
    }
  }

  function formatTimeCode(seconds) {
    if (isNaN(seconds) || seconds === null) return '00:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }

  // Switch between Live Synced Lyrics and Raw Text
  function switchLyricsView(view) {
    if (view === 'live') {
      if (tabLyricsLive) tabLyricsLive.classList.add('active');
      if (tabLyricsRaw) tabLyricsRaw.classList.remove('active');
      if (lyricsSyncView) lyricsSyncView.classList.remove('hidden');
      if (lyricsRawView) lyricsRawView.classList.add('hidden');
    } else {
      if (tabLyricsLive) tabLyricsLive.classList.remove('active');
      if (tabLyricsRaw) tabLyricsRaw.classList.add('active');
      if (lyricsSyncView) lyricsSyncView.classList.add('hidden');
      if (lyricsRawView) lyricsRawView.classList.remove('hidden');
    }
  }

  if (tabLyricsLive) tabLyricsLive.addEventListener('click', () => switchLyricsView('live'));
  if (tabLyricsRaw) tabLyricsRaw.addEventListener('click', () => switchLyricsView('raw'));

  // Detect user scroll on lyrics container to pause auto-scrolling temporarily
  if (transcribeLyricsContainer) {
    transcribeLyricsContainer.addEventListener('wheel', () => {
      isUserScrollingLyrics = true;
      clearTimeout(userScrollTimeout);
      userScrollTimeout = setTimeout(() => {
        isUserScrollingLyrics = false;
      }, 2500);
    }, { passive: true });
  }

  // Render Spotify-style synced lyrics
  function renderSyncedLyrics(segments, fullText) {
    if (!transcribeLyricsContainer) return;
    transcribeLyricsContainer.innerHTML = '';

    if (!segments || segments.length === 0) {
      if (fullText) {
        // Fallback: render paragraphs or sentences
        const parts = fullText.split(/(?<=[.?!])\s+/).filter(Boolean);
        parts.forEach((p, idx) => {
          const div = document.createElement('div');
          div.className = 'lyric-line';
          div.innerHTML = `
            <span class="lyric-time">#${idx + 1}</span>
            <span class="lyric-text">${p}</span>
          `;
          transcribeLyricsContainer.appendChild(div);
        });
      } else {
        transcribeLyricsContainer.innerHTML = `<div class="lyrics-empty-state">Không có dữ liệu mốc thời gian lời thoại.</div>`;
      }
      return;
    }

    activeLyricSegments = segments;

    segments.forEach((seg, idx) => {
      const lineDiv = document.createElement('div');
      lineDiv.className = 'lyric-line';
      lineDiv.dataset.index = idx;
      lineDiv.dataset.start = seg.start;
      lineDiv.dataset.end = seg.end;
      lineDiv.id = `lyric-seg-${idx}`;

      lineDiv.innerHTML = `
        <span class="lyric-time">${formatTimeCode(seg.start)}</span>
        <span class="lyric-text">${seg.text}</span>
      `;

      // Click to seek media player to this segment timestamp
      lineDiv.addEventListener('click', () => {
        if (transcribeMediaPlayer) {
          transcribeMediaPlayer.currentTime = Math.max(0, seg.start);
          transcribeMediaPlayer.play().catch(() => {});
          highlightActiveLyric(idx, true);
        }
      });

      transcribeLyricsContainer.appendChild(lineDiv);
    });
  }

  // Highlight the current lyric matching playback time
  function highlightActiveLyric(activeIndex, forceScroll = false) {
    if (!transcribeLyricsContainer) return;
    const lines = transcribeLyricsContainer.querySelectorAll('.lyric-line');
    
    lines.forEach((line, idx) => {
      if (idx === activeIndex) {
        line.classList.add('active-lyric');
        line.classList.remove('past-lyric');
        if (!isUserScrollingLyrics || forceScroll) {
          line.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      } else if (idx < activeIndex) {
        line.classList.remove('active-lyric');
        line.classList.add('past-lyric');
      } else {
        line.classList.remove('active-lyric', 'past-lyric');
      }
    });
  }

  // Hook MediaPlayer timeupdate for real-time lyrics syncing
  if (transcribeMediaPlayer) {
    transcribeMediaPlayer.addEventListener('timeupdate', () => {
      const currentTime = transcribeMediaPlayer.currentTime;
      if (!activeLyricSegments || activeLyricSegments.length === 0) return;

      // Find current active segment
      let foundIdx = -1;
      for (let i = 0; i < activeLyricSegments.length; i++) {
        const seg = activeLyricSegments[i];
        const nextSeg = activeLyricSegments[i + 1];
        const segEnd = nextSeg ? nextSeg.start : (seg.end || seg.start + 5.0);

        if (currentTime >= seg.start && currentTime < segEnd) {
          foundIdx = i;
          break;
        }
      }

      // If at end or beyond last segment
      if (foundIdx === -1 && activeLyricSegments.length > 0) {
        if (currentTime >= activeLyricSegments[activeLyricSegments.length - 1].start) {
          foundIdx = activeLyricSegments.length - 1;
        }
      }

      if (foundIdx !== -1) {
        highlightActiveLyric(foundIdx);
      }
    });

    // Equalizer animation handling for audio playing state
    transcribeMediaPlayer.addEventListener('play', () => {
      if (audioEqualizer) audioEqualizer.classList.add('playing');
    });
    transcribeMediaPlayer.addEventListener('pause', () => {
      if (audioEqualizer) audioEqualizer.classList.remove('playing');
    });
    transcribeMediaPlayer.addEventListener('ended', () => {
      if (audioEqualizer) audioEqualizer.classList.remove('playing');
    });
  }

  function handleTranscribeFileSelect(file) {
    if (!file) return;
    hideTranscribeError();
    selectedTranscribeFile = file;

    if (transcribeFileName) transcribeFileName.textContent = file.name;
    if (transcribeFileMeta) {
      const ext = file.name.split('.').pop().toUpperCase();
      transcribeFileMeta.textContent = `${formatFileBytes(file.size)} • ${ext} Media`;
    }
    const isVideo = /\.(mp4|webm|mov|avi|mkv)$/i.test(file.name);
    if (transcribeFileIcon) {
      transcribeFileIcon.textContent = isVideo ? '🎬' : '🎵';
    }

    if (transcribePrompt) transcribePrompt.classList.add('hidden');
    if (transcribeFileInfo) transcribeFileInfo.classList.remove('hidden');
    if (transcribeOptionsPanel) transcribeOptionsPanel.classList.remove('hidden');
    if (transcribeResultCard) transcribeResultCard.classList.add('hidden');
    if (transcribeProgressCard) transcribeProgressCard.classList.add('hidden');

    // Kiểm tra nhanh thời lượng file ở Client-side (HTML5 Media API)
    const mediaElem = document.createElement(isVideo ? 'video' : 'audio');
    const objectUrl = URL.createObjectURL(file);
    mediaElem.preload = 'metadata';
    mediaElem.onloadedmetadata = () => {
      URL.revokeObjectURL(objectUrl);
      const dur = mediaElem.duration;
      if (dur && dur > 600) { // 10 phút = 600 giây
        const m = Math.floor(dur / 60);
        const s = Math.floor(dur % 60);
        const timeStr = m > 0 ? `${m} phút ${s > 0 ? s + ' giây' : ''}` : `${dur.toFixed(0)} giây`;
        showTranscribeError(`⚠️ File "${file.name}" dài ${timeStr}, vượt quá giới hạn tối đa cho phép là 10 phút. Vui lòng chọn file ngắn hơn.`);
        if (btnStartTranscribe) btnStartTranscribe.disabled = true;
      } else {
        if (btnStartTranscribe) btnStartTranscribe.disabled = false;
      }
    };
    mediaElem.onerror = () => {
      URL.revokeObjectURL(objectUrl);
    };
    mediaElem.src = objectUrl;
  }

  if (transcribeFileInput) {
    transcribeFileInput.addEventListener('change', (e) => {
      if (e.target.files && e.target.files.length > 0) {
        handleTranscribeFileSelect(e.target.files[0]);
      }
    });
  }

  if (transcribeDropzone) {
    ['dragenter', 'dragover'].forEach(eventName => {
      transcribeDropzone.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        transcribeDropzone.classList.add('drag-over');
      });
    });

    ['dragleave', 'drop'].forEach(eventName => {
      transcribeDropzone.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        transcribeDropzone.classList.remove('drag-over');
      });
    });

    transcribeDropzone.addEventListener('drop', (e) => {
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        handleTranscribeFileSelect(e.dataTransfer.files[0]);
      }
    });
  }

  if (btnRemoveTranscribeFile) {
    btnRemoveTranscribeFile.addEventListener('click', (e) => {
      e.stopPropagation();
      resetTranscribeSelection();
    });
  }

  if (btnTranscribeAnother) {
    btnTranscribeAnother.addEventListener('click', () => {
      resetTranscribeSelection();
      if (transcribeDropzone) transcribeDropzone.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  }

  // Copy buttons
  function copyTextHelper(textToCopy, btnElement, labelElement) {
    if (!textToCopy) return;
    navigator.clipboard.writeText(textToCopy).then(() => {
      if (labelElement) labelElement.textContent = 'Đã chép!';
      setTimeout(() => {
        if (labelElement) labelElement.textContent = 'Sao chép';
      }, 2000);
    }).catch(() => {
      if (labelElement) labelElement.textContent = 'Đã chép!';
    });
  }

  if (btnCopyTranscribe) {
    btnCopyTranscribe.addEventListener('click', () => {
      const fullText = (activeLyricSegments && activeLyricSegments.length > 0)
        ? activeLyricSegments.map(s => s.text).join('\n')
        : (transcribeResultText ? transcribeResultText.value : '');
      copyTextHelper(fullText, btnCopyTranscribe, copyBtnLabel);
    });
  }

  if (btnCopyTranscribeRaw && transcribeResultText) {
    btnCopyTranscribeRaw.addEventListener('click', () => {
      copyTextHelper(transcribeResultText.value, btnCopyTranscribeRaw, null);
    });
  }

  if (btnStartTranscribe) {
    btnStartTranscribe.addEventListener('click', async () => {
      if (!selectedTranscribeFile) {
        showTranscribeError('Vui lòng chọn hoặc kéo thả file âm thanh / video trước!');
        return;
      }

      hideTranscribeError();
      btnStartTranscribe.disabled = true;
      btnStartTranscribe.innerHTML = `
        <div class="spinner" style="width:16px;height:16px;border-width:2px;"></div>
        <span>Đang nhận diện giọng nói...</span>
      `;

      if (transcribeProgressCard) transcribeProgressCard.classList.remove('hidden');
      if (transcribeResultCard) transcribeResultCard.classList.add('hidden');
      if (transcribeProgressCard) transcribeProgressCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

      const formData = new FormData();
      formData.append('file', selectedTranscribeFile);
      if (transcribeLanguageSelect) {
        formData.append('language', transcribeLanguageSelect.value);
      }
      if (transcribeFormatSelect) {
        formData.append('format', transcribeFormatSelect.value);
      }

      try {
        const res = await fetch('/api/transcribe', {
          method: 'POST',
          body: formData
        });

        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.detail || data.error || 'Quá trình trích xuất văn bản thất bại.');
        }

        if (transcribeProgressCard) transcribeProgressCard.classList.add('hidden');
        if (transcribeResultCard) transcribeResultCard.classList.remove('hidden');

        // Setup Media Player với file local Blob URL
        if (currentMediaBlobUrl) {
          URL.revokeObjectURL(currentMediaBlobUrl);
        }
        currentMediaBlobUrl = URL.createObjectURL(selectedTranscribeFile);
        
        const isVideo = /\.(mp4|webm|mov|avi|mkv)$/i.test(selectedTranscribeFile.name);
        if (transcribeMediaPlayer) {
          transcribeMediaPlayer.src = currentMediaBlobUrl;
          if (isVideo) {
            transcribeMediaPlayer.style.display = 'block';
            if (transcribeAudioVisual) transcribeAudioVisual.classList.add('hidden');
          } else {
            transcribeMediaPlayer.style.display = 'block';
            if (transcribeAudioVisual) transcribeAudioVisual.classList.remove('hidden');
            if (playerMediaTitle) playerMediaTitle.textContent = selectedTranscribeFile.name;
          }
        }

        // Render Live Synced Lyrics (Ảnh 2 Spotify Style)
        renderSyncedLyrics(data.segments || [], data.text || '');

        if (transcribeResultText) transcribeResultText.value = data.text || '';

        const formatDuration = (sec) => {
          if (!sec || isNaN(sec)) return '0s';
          const s = Math.round(sec);
          const m = Math.floor(s / 60);
          const remS = s % 60;
          return m > 0 ? `${m}m ${remS}s` : `${sec}s`;
        };

        if (tagLang) tagLang.textContent = `Ngôn ngữ: ${(data.detected_language || 'vi').toUpperCase()}`;
        if (tagDuration) tagDuration.textContent = `Thời lượng: ${formatDuration(data.audio_duration)}`;
        if (tagTime) tagTime.textContent = `Xử lý: ${data.processing_time || 0}s`;

        if (transcribeDownloadBtn) {
          transcribeDownloadBtn.href = data.download_url;
          transcribeDownloadBtn.setAttribute('download', data.filename || 'transcript.txt');
        }

        // Mặc định mở tab Live Synced Lyrics
        switchLyricsView('live');

        if (transcribeResultCard) transcribeResultCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

        btnStartTranscribe.disabled = false;
        btnStartTranscribe.innerHTML = `
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
          <span>Trích Xuất Lại</span>
        `;
      } catch (err) {
        if (transcribeProgressCard) transcribeProgressCard.classList.add('hidden');
        btnStartTranscribe.disabled = false;
        btnStartTranscribe.innerHTML = `
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
          <span>Thử Lại</span>
        `;
        showTranscribeError(err.message || 'Lỗi khi gửi yêu cầu trích xuất văn bản.');
      }
    });
  }
});
