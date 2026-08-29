document.addEventListener('DOMContentLoaded', () => {
  // ==========================================
  // 1. MODE SWITCHER (URL to MP3/MP4 vs File Conver)
  // ==========================================
  const modeUrlBtn = document.getElementById('mode-url-btn');
  const modeFileBtn = document.getElementById('mode-file-btn');
  const sectionUrlMode = document.getElementById('section-url-mode');
  const sectionFileMode = document.getElementById('section-file-mode');

  function switchMode(mode) {
    if (mode === 'url') {
      modeUrlBtn.classList.add('active');
      modeFileBtn.classList.remove('active');
      sectionUrlMode.classList.remove('hidden');
      sectionFileMode.classList.add('hidden');
    } else {
      modeFileBtn.classList.add('active');
      modeUrlBtn.classList.remove('active');
      sectionFileMode.classList.remove('hidden');
      sectionUrlMode.classList.add('hidden');
    }
  }

  if (modeUrlBtn && modeFileBtn) {
    modeUrlBtn.addEventListener('click', () => switchMode('url'));
    modeFileBtn.addEventListener('click', () => switchMode('file'));
  }

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
});
