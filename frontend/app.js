document.addEventListener('DOMContentLoaded', () => {
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
  const formatTabBtns = document.querySelectorAll('.tab-btn');
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

    // Gắn sự kiện click cho các nút Download trong bảng
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

  function showError(msg) {
    errorMessage.textContent = msg;
    errorBox.classList.remove('hidden');
    infoLoading.classList.add('hidden');
    convertBtn.disabled = false;
  }

  function hideError() {
    errorBox.classList.add('hidden');
  }

  // Handle Form Submit (Click "Convert")
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideError();

    const url = urlInput.value.trim();
    if (!url || (!url.startsWith('http://') && !url.startsWith('https://'))) {
      showError('Vui lòng nhập một đường link hợp lệ!');
      return;
    }

    currentTargetUrl = url;
    convertBtn.disabled = true;
    infoLoading.classList.remove('hidden');
    mediaResultCard.classList.add('hidden');
    activeProgressBanner.classList.add('hidden');

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
      mediaTitle.textContent = info.title;
      mediaDuration.textContent = info.duration_str;
      mediaThumb.src = info.thumbnail || '';
      
      infoLoading.classList.add('hidden');
      mediaResultCard.classList.remove('hidden');
      convertBtn.disabled = false;

      // Render bảng định dạng mặc định (MP3)
      renderTable(currentActiveTab);

      // Cuộn nhẹ xuống phần kết quả
      mediaResultCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    } catch (err) {
      showError(err.message || 'Lỗi kết nối máy chủ.');
    }
  });

  // Xử lý khi bấm nút Download ở một hàng cụ thể
  function attachDownloadEvents() {
    const actionBtns = qualityTableBody.querySelectorAll('.btn-table-action');
    actionBtns.forEach(btn => {
      btn.addEventListener('click', async () => {
        const format = btn.dataset.format;
        const quality = btn.dataset.quality;

        if (!currentTargetUrl) return;

        // Reset progress banner
        if (activeEventSource) activeEventSource.close();

        // Cập nhật trạng thái nút bấm
        actionBtns.forEach(b => b.disabled = true);
        btn.classList.add('loading');
        btn.innerHTML = `
          <div class="spinner" style="width:14px;height:14px;border-width:2px;"></div>
          <span>Đang xử lý...</span>
        `;

        // Hiện banner tiến độ
        activeProgressBanner.classList.remove('hidden');
        activeProgressBar.style.width = '5%';
        activePercentText.textContent = '5%';
        activeStatusText.textContent = `Đang bắt đầu tải ${format.toUpperCase()} (${quality})...`;

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

  // Lắng nghe tiến độ tải thời gian thực
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
      activeProgressBar.style.width = `${pct}%`;
      activePercentText.textContent = `${pct}%`;
      activeStatusText.textContent = `Đang tải: ${pct}% (${job.speed || '-'})`;
    } else if (job.status === 'converting') {
      activeProgressBar.style.width = '99%';
      activePercentText.textContent = '99%';
      activeStatusText.textContent = 'Đang nén & chuyển đổi định dạng (FFmpeg)...';
    } else if (job.status === 'completed') {
      if (activeEventSource) activeEventSource.close();

      const cleanName = job.filename.split('_').slice(1).join('_') || job.filename;
      activeProgressBar.style.width = '100%';
      activePercentText.textContent = '100%';
      activeStatusText.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;width:100%;gap:12px;flex-wrap:wrap;">
          <span>🎉 Convert thành công: <b>${cleanName}</b></span>
          <a href="${job.download_url}" download="${cleanName}" class="btn-table-action" style="background:#10b981;color:#fff;border:none;">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
            <span>Bấm Để Lưu File</span>
          </a>
        </div>
      `;

      // Cập nhật nút trong hàng thành nút tải trực tiếp
      triggerBtn.classList.remove('loading');
      triggerBtn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
        <span>Lưu File</span>
      `;
      triggerBtn.style.background = "#10b981";
      triggerBtn.style.color = "#fff";

      document.querySelectorAll('.btn-table-action').forEach(b => b.disabled = false);

      // Kích hoạt điều hướng tải file trực tiếp về trình duyệt
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
      resetBtnState(triggerBtn);
      document.querySelectorAll('.btn-table-action').forEach(b => b.disabled = false);
      activeProgressBanner.classList.add('hidden');
    }
  }

  function resetBtnState(btn) {
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

  // Fallback Polling
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
});
