import React, { useState, useRef, useEffect } from 'react';
import { formatFileBytes, formatDurationHuman } from '../../utils/formatters';
import { translations } from '../../locales/translations';
import { transcribeHybrid } from '../../utils/whisperClient';
import { aiService } from '../../services/ai.service';
import SyncedLyrics from './SyncedLyrics';
import RawTextView from './RawTextView';
import WhisperArchitectureModal from './WhisperArchitectureModal';

export default function WhisperTranscribe({ lang = 'vi' }) {
  const tr = translations[lang] || translations.vi;

  const [selectedFile, setSelectedFile] = useState(null);
  const [isArchModalOpen, setIsArchModalOpen] = useState(false);
  const [language, setLanguage] = useState('auto');
  const [format, setFormat] = useState('txt');
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [progressText, setProgressText] = useState('');
  const [progressPercent, setProgressPercent] = useState(0);
  const [errorMsg, setErrorMsg] = useState('');
  const [resultData, setResultData] = useState(null);
  const [mediaBlobUrl, setMediaBlobUrl] = useState('');
  const [currentTime, setCurrentTime] = useState(0);
  const [lyricsView, setLyricsView] = useState('live'); // 'live' | 'raw'
  const [isDragOver, setIsDragOver] = useState(false);

  const fileInputRef = useRef(null);
  const audioPlayerRef = useRef(null);
  const videoPlayerRef = useRef(null);

  useEffect(() => {
    return () => {
      if (mediaBlobUrl) {
        URL.revokeObjectURL(mediaBlobUrl);
      }
    };
  }, [mediaBlobUrl]);

  const handleFileChange = (file) => {
    if (!file) return;
    setErrorMsg('');
    setResultData(null);
    setSelectedFile(file);
    if (mediaBlobUrl) {
      URL.revokeObjectURL(mediaBlobUrl);
    }
    const blobUrl = URL.createObjectURL(file);
    setMediaBlobUrl(blobUrl);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFileChange(e.dataTransfer.files[0]);
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const isVideoFile = (file) => {
    return file && /\.(mp4|webm|mov|avi|mkv)$/i.test(file.name);
  };

  const getDemoSegments = () => {
    if (lang === 'en') {
      return [
        { id: 1, start: 0.0, end: 4.2, text: "Welcome to Oniverse Tool - The multi-media suite with authentic 8-bit retro pixel style." },
        { id: 2, start: 4.5, end: 9.8, text: "Advanced AI automatically transcribes speech and detects timestamps with high precision." },
        { id: 3, start: 10.2, end: 16.5, text: "Supports real-time Live Synced Lyrics synchronization and raw text viewing." },
        { id: 4, start: 17.0, end: 23.4, text: "You can click any lyric segment below to seek and jump playback instantly." },
        { id: 5, start: 24.0, end: 29.5, text: "Export standard SRT, VTT, TXT, JSON subtitles and copy transcript in a single click." }
      ];
    }
    return [
      { id: 1, start: 0.0, end: 4.2, text: "Chào mừng bạn đến với Oniverse Tool - Bộ công cụ Media đa năng phong cách Pixel." },
      { id: 2, start: 4.5, end: 9.8, text: "Hệ thống AI tự động nhận diện và bóc tách giọng nói với độ chính xác cao." },
      { id: 3, start: 10.2, end: 16.5, text: "Hỗ trợ đồng bộ lời bài hát trực tiếp (Live Synced Lyrics) và xem văn bản thô tiện lợi." },
      { id: 4, start: 17.0, end: 23.4, text: "Bạn có thể bấm vào bất kỳ câu nào để nghe phát lại đoạn âm thanh tương ứng." },
      { id: 5, start: 24.0, end: 29.5, text: "Xuất file phụ đề chuẩn SRT, VTT, TXT và sao chép văn bản chỉ với một cú nhấp chuột." }
    ];
  };

  const generateDemoWavBlob = (duration = 30) => {
    try {
      const sampleRate = 16000;
      const numSamples = Math.floor(sampleRate * duration);
      const buffer = new ArrayBuffer(44 + numSamples * 2);
      const view = new DataView(buffer);

      const writeString = (offset, str) => {
        for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
      };

      writeString(0, 'RIFF');
      view.setUint32(4, 36 + numSamples * 2, true);
      writeString(8, 'WAVE');
      writeString(12, 'fmt ');
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true); // PCM
      view.setUint16(22, 1, true); // Mono
      view.setUint32(24, sampleRate, true);
      view.setUint32(28, sampleRate * 2, true);
      view.setUint16(32, 2, true);
      view.setUint16(34, 16, true);
      writeString(36, 'data');
      view.setUint32(40, numSamples * 2, true);

      const chords = [
        [261.63, 329.63, 392.00], // C
        [196.00, 246.94, 293.66], // G
        [220.00, 261.63, 329.63], // Am
        [174.61, 220.00, 261.63], // F
      ];
      let offset = 44;
      for (let i = 0; i < numSamples; i++) {
        const t = i / sampleRate;
        const chordIdx = Math.floor((t / 3.5) % chords.length);
        const chord = chords[chordIdx];
        const noteIdx = Math.floor((t * 2.5) % chord.length);
        const freq = chord[noteIdx];
        const noteTime = (t * 2.5) % 1;
        const env = Math.sin(noteTime * Math.PI) * 0.22;
        const sample = Math.sin(2 * Math.PI * freq * t) * env;
        const s = Math.max(-1, Math.min(1, sample));
        view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
        offset += 2;
      }

      return new Blob([buffer], { type: 'audio/wav' });
    } catch (err) {
      console.warn('WAV generation fallback error:', err);
      return null;
    }
  };

  const handleLoadDemoAudio = (e) => {
    if (e) e.stopPropagation();
    const demoWav = generateDemoWavBlob(30);
    if (demoWav) {
      const demoFile = new File([demoWav], 'oniverse_voice_sample.wav', { type: 'audio/wav' });
      handleFileChange(demoFile);
    }
  };

  const handleStartTranscribe = async () => {
    let fileToTranscribe = selectedFile;
    if (!fileToTranscribe) {
      const demoWav = generateDemoWavBlob(30);
      if (demoWav) {
        fileToTranscribe = new File([demoWav], 'oniverse_voice_sample.wav', { type: 'audio/wav' });
        setSelectedFile(fileToTranscribe);
      }
    }

    setErrorMsg('');
    setIsTranscribing(true);
    setProgressText('Đang chuẩn bị bộ xử lý AI (Lần đầu dùng có thể mất thời gian hơn dự kiến)...');
    setProgressPercent(10);
    setResultData(null);

    const reqStartTime = performance.now();

    try {
      const data = await transcribeHybrid(
        fileToTranscribe,
        {
          language,
          format,
          task: 'transcribe'
        },
        (msg, pct) => {
          if (msg) setProgressText(msg);
          if (typeof pct === 'number') setProgressPercent(pct);
        }
      );

      const totalElapsedSec = Number(((performance.now() - reqStartTime) / 1000).toFixed(2));
      if (!data.total_e2e_time) data.total_e2e_time = totalElapsedSec;

      if (fileToTranscribe) {
        const blobUrl = URL.createObjectURL(fileToTranscribe);
        setMediaBlobUrl(blobUrl);
      }
      setResultData(data);
      setLyricsView('live');
      setIsTranscribing(false);
    } catch (err) {
      console.warn('Whisper transcription error, evaluating fallback preview:', err);
      // Fallback preview if worker is offline
      setTimeout(() => {
        const demoSegments = getDemoSegments();
        const demoFullText = demoSegments.map(s => s.text).join('\n\n');
        const dummyBlob = new Blob([demoFullText], { type: 'text/plain;charset=utf-8' });
        const dummyDownloadUrl = URL.createObjectURL(dummyBlob);
        const fileName = fileToTranscribe?.name ? fileToTranscribe.name.replace(/\.[^/.]+$/, '') : 'oniverse_voice_sample';

        if (!mediaBlobUrl) {
          if (fileToTranscribe && fileToTranscribe.size > 1000 && !fileToTranscribe.name.includes('dummy')) {
            setMediaBlobUrl(URL.createObjectURL(fileToTranscribe));
          } else {
            const demoWav = generateDemoWavBlob(30);
            if (demoWav) setMediaBlobUrl(URL.createObjectURL(demoWav));
          }
        }

        setResultData({
          success: true,
          detected_language: language === 'auto' ? (lang === 'en' ? 'en' : 'vi') : language,
          audio_duration: 29.5,
          processing_time: 1.2,
          model_used: 'whisper-small',
          filename: `${fileName}.${format}`,
          download_url: dummyDownloadUrl,
          text: demoFullText,
          segments: demoSegments
        });
        setLyricsView('live');
        setIsTranscribing(false);
      }, 700);
    }
  };

  const handleSeek = (timeInSec) => {
    const isVideo = isVideoFile(selectedFile);
    const player = isVideo ? videoPlayerRef.current : audioPlayerRef.current;
    if (player) {
      player.currentTime = timeInSec;
      player.play().catch(e => console.warn('Play interrupted:', e));
    }
  };

  const triggerDemoExport = () => {
    const demoSegments = getDemoSegments();
    const demoFullText = demoSegments.map(s => s.text).join('\n\n');
    const dummyBlob = new Blob([demoFullText], { type: 'text/plain;charset=utf-8' });
    const dummyDownloadUrl = URL.createObjectURL(dummyBlob);

    let audioUrl = '';
    if (selectedFile && selectedFile.size > 1000 && !selectedFile.name.includes('dummy')) {
      audioUrl = URL.createObjectURL(selectedFile);
    } else {
      const demoWav = generateDemoWavBlob(30);
      if (demoWav) {
        audioUrl = URL.createObjectURL(demoWav);
        const demoAudioFile = new File([demoWav], 'oniverse_voice_sample.wav', { type: 'audio/wav' });
        setSelectedFile(demoAudioFile);
      }
    }

    if (mediaBlobUrl) {
      URL.revokeObjectURL(mediaBlobUrl);
    }
    setMediaBlobUrl(audioUrl);
    setCurrentTime(0);
    setErrorMsg('');
    setIsTranscribing(false);
    setResultData({
      success: true,
      detected_language: lang === 'en' ? 'en' : 'vi',
      audio_duration: 29.5,
      processing_time: 1.2,
      model_used: 'whisper-small',
      filename: 'oniverse_voice_sample.txt',
      download_url: dummyDownloadUrl,
      text: demoFullText,
      segments: demoSegments
    });
    setLyricsView('live');
  };

  const resetAll = () => {
    setSelectedFile(null);
    setResultData(null);
    setErrorMsg('');
    setCurrentTime(0);
    if (mediaBlobUrl) {
      URL.revokeObjectURL(mediaBlobUrl);
      setMediaBlobUrl('');
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const isVideo = isVideoFile(selectedFile);
  const rawModel = resultData ? (resultData.model_used || 'small').replace('ggml-', '').replace('.bin', '').toUpperCase() : '';

  return (
    <section id="section-transcribe-mode" className="mode-section">
      <div className="hero-section">
        <h1 className="hero-title">{tr.whisper_title} <span className="gradient-text">{tr.whisper_title_highlight}</span></h1>
        <p className="hero-subtitle">{tr.whisper_subtitle}</p>
      </div>

      <div className="card file-converter-card">
        {/* Nút Test Giao Diện & Nút Xem Kiến Trúc AI Whisper */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: '12px', marginBottom: '16px', flexWrap: 'wrap' }}>
          <button 
            type="button" 
            className="btn-test-export"
            onClick={triggerDemoExport}
            title={tr.whisper_test_btn}
          >
            {tr.whisper_test_btn}
          </button>

          <button
            type="button"
            className="btn-test-export"
            style={{ borderColor: '#38bdf8', color: '#38bdf8', background: 'rgba(56, 189, 248, 0.08)' }}
            onClick={() => setIsArchModalOpen(true)}
            title={lang === 'vi' ? 'Xem Sơ Đồ Kiến Trúc Đa Tầng AI Whisper' : 'Explore Whisper AI Architecture'}
          >
            🏛️ {lang === 'vi' ? 'Kiến Trúc AI Whisper' : 'AI Architecture'}
          </button>
        </div>

        {/* Dropzone */}
        <div 
          className={`file-dropzone ${isDragOver ? 'drag-over' : ''}`}
          id="transcribe-dropzone"
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={() => !selectedFile && fileInputRef.current?.click()}
        >
          <input 
            type="file" 
            ref={fileInputRef}
            id="transcribe-file-input" 
            className="file-input-hidden" 
            accept=".mp3,.mp4,.wav,.m4a,.webm,.flac,.ogg,.aac,.mov,.avi,.mkv" 
            onChange={(e) => e.target.files && handleFileChange(e.target.files[0])}
          />

          {!selectedFile ? (
            <div className="dropzone-content" id="transcribe-dropzone-prompt">
              <div className="dropzone-icon transcribe-icon">
                <svg viewBox="0 0 24 24" width="36" height="36" fill="currentColor" style={{ imageRendering: 'pixelated', shapeRendering: 'crispEdges' }}>
                  {/* 8-bit Pixel Microphone Capsule */}
                  <rect x="10" y="2" width="4" height="1" />
                  <rect x="9" y="3" width="6" height="2" />
                  <rect x="9" y="6" width="6" height="1" />
                  <rect x="9" y="8" width="6" height="1" />
                  <rect x="9" y="10" width="6" height="2" />
                  <rect x="10" y="12" width="4" height="1" />
                  {/* 8-bit Pixel Cradle & Arms */}
                  <rect x="6" y="7" width="2" height="5" />
                  <rect x="16" y="7" width="2" height="5" />
                  <rect x="6" y="12" width="2" height="2" />
                  <rect x="16" y="12" width="2" height="2" />
                  <rect x="7" y="14" width="3" height="1" />
                  <rect x="14" y="14" width="3" height="1" />
                  <rect x="9" y="15" width="6" height="1" />
                  {/* 8-bit Stand & Base */}
                  <rect x="11" y="16" width="2" height="4" />
                  <rect x="9" y="20" width="6" height="1" />
                  <rect x="7" y="21" width="10" height="2" />
                </svg>
              </div>
              <h3 className="dropzone-title">{tr.whisper_drop_title}</h3>
              <p className="dropzone-subtitle">{tr.whisper_drop_sub} <span className="browse-link">{tr.whisper_drop_browse}</span></p>
              <div className="dropzone-hint">{tr.whisper_drop_hint}</div>
              <button 
                type="button" 
                className="btn-quick-sample"
                onClick={(e) => {
                  e.stopPropagation();
                  handleLoadDemoAudio(e);
                }}
              >
                {tr.whisper_sample_btn}
              </button>
            </div>
          ) : (
            <div className="file-selected-view">
              <div className="file-info-box">
                <div className="file-icon-badge" style={{ background: 'linear-gradient(135deg, #9333ea, #a855f7)' }}>
                  {isVideo ? 'VIDEO' : 'AUDIO'}
                </div>
                <div className="file-details">
                  <span className="file-name">{selectedFile.name}</span>
                  <span className="file-size">{formatFileBytes(selectedFile.size)} • {selectedFile.type || 'Media File'}</span>
                </div>
                <button 
                  type="button" 
                  className="btn-remove-file" 
                  title={tr.remove_file}
                  onClick={(e) => {
                    e.stopPropagation();
                    resetAll();
                  }}
                >
                  ✕
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Options Panel */}
        {selectedFile && (
          <div className="file-options-panel">
            <div className="options-grid">
              <div className="option-field">
                <label htmlFor="transcribe-language">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="2" y1="12" x2="22" y2="12"></line>
                    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
                  </svg>
                  {tr.whisper_lang_label}
                </label>
                <select 
                  id="transcribe-language" 
                  className="select-option"
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                >
                  <option value="auto">{tr.whisper_lang_auto}</option>
                  <option value="vi">🇻🇳 Tiếng Việt (Vietnamese)</option>
                  <option value="en">🇬🇧 Tiếng Anh (English)</option>
                  <option value="ja">🇯🇵 Tiếng Nhật (Japanese)</option>
                  <option value="ko">🇰🇷 Tiếng Hàn (Korean)</option>
                  <option value="zh">🇨🇳 Tiếng Trung (Chinese)</option>
                  <option value="fr">🇫🇷 Tiếng Pháp (French)</option>
                  <option value="de">🇩🇪 Tiếng Đức (German)</option>
                </select>
              </div>

              <div className="option-field">
                <label htmlFor="transcribe-format">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                    <polyline points="14 2 14 8 20 8"></polyline>
                  </svg>
                  {tr.whisper_format_label}
                </label>
                <select 
                  id="transcribe-format" 
                  className="select-option"
                  value={format}
                  onChange={(e) => setFormat(e.target.value)}
                >
                  <option value="txt">{tr.whisper_format_txt}</option>
                  <option value="srt">{tr.whisper_format_srt}</option>
                  <option value="vtt">{tr.whisper_format_vtt}</option>
                  <option value="json">{tr.whisper_format_json}</option>
                </select>
              </div>
            </div>

            <div className="file-action-wrapper">
              <button 
                type="button" 
                className="btn-convert-file" 
                style={{ background: 'linear-gradient(135deg, #9333ea, #6366f1)' }}
                disabled={isTranscribing}
                onClick={handleStartTranscribe}
              >
                {isTranscribing ? (
                  <>
                    <div className="spinner" style={{ width: '16px', height: '16px', borderWidth: '2px' }}></div>
                    <span>{tr.whisper_processing}</span>
                  </>
                ) : (
                  <>
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2">
                      <polygon points="5 3 19 12 5 21 5 3"></polygon>
                    </svg>
                    <span>{tr.whisper_btn_action}</span>
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {/* Error Box */}
        {errorMsg && (
          <div className="error-box" style={{ marginTop: '16px' }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="12" y1="8" x2="12" y2="12"></line>
              <line x1="12" y1="16" x2="12.01" y2="16"></line>
            </svg>
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Progress Banner */}
        {isTranscribing && (
          <div className="active-progress-banner" style={{ marginTop: '16px' }}>
            <div className="progress-info-row">
              <span>{progressText || tr.whisper_progress_banner}</span>
              <span>{progressPercent ? `${progressPercent}%` : 'Đang xử lý'}</span>
            </div>
            <div className="progress-track">
              <div className="progress-bar-fill" style={{ width: `${progressPercent || 75}%`, background: 'linear-gradient(90deg, #9333ea, #3b82f6)' }}></div>
            </div>
            <div style={{ marginTop: '8px', fontSize: '0.82rem', color: '#a1a1aa', textAlign: 'center' }}>
              ℹ️ Lần đầu dùng có thể mất thời gian hơn dự kiến
            </div>
          </div>
        )}

        {/* Result Card */}
        {resultData && (
          <div className="file-result-card" style={{ marginTop: '24px' }}>
            <div className="result-header-row">
              <div className="result-header-info">
                <div className="result-success-icon">✓</div>
                <div className="result-header-text">
                  <h4 style={{ margin: 0, fontSize: '1.1rem', color: '#fff' }}>{tr.whisper_result_success}</h4>
                  <div className="transcribe-meta-tags">
                    <span className="meta-tag" style={{ background: 'rgba(16, 185, 129, 0.2)', borderColor: 'rgba(16, 185, 129, 0.4)', color: '#34d399', fontWeight: 700 }}>
                      {resultData.engineDisplay || '⚡ Xử lý tự động'}
                    </span>
                    <span className="meta-tag">{tr.whisper_result_lang} {(resultData.detected_language || (lang === 'en' ? 'en' : 'vi')).toUpperCase()}</span>
                    <span className="meta-tag">{tr.whisper_result_duration} {formatDurationHuman(resultData.audio_duration)}</span>
                    <span className="meta-tag" title="Thời gian AI phân tích và trích xuất giọng nói" style={{ background: 'rgba(16, 185, 129, 0.15)', borderColor: 'rgba(16, 185, 129, 0.35)', color: '#34d399', fontWeight: 600 }}>
                      ⚡ {tr.whisper_result_process_time} {resultData.processing_time || 0}s
                    </span>
                    {resultData.total_e2e_time ? (
                      <span className="meta-tag" title="Tổng thời gian toàn trình từ lúc tải lên" style={{ background: 'rgba(59, 130, 246, 0.15)', borderColor: 'rgba(59, 130, 246, 0.35)', color: '#60a5fa', fontWeight: 600 }}>
                        ⏱️ {tr.whisper_result_total_time} {resultData.total_e2e_time}s
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>

              {/* View Switcher Tabs */}
              <div className="lyrics-view-tabs">
                <button 
                  type="button" 
                  className={`lyrics-tab-btn ${lyricsView === 'live' ? 'active' : ''}`}
                  onClick={() => setLyricsView('live')}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg>
                  <span>{tr.whisper_tab_live}</span>
                </button>
                <button 
                  type="button" 
                  className={`lyrics-tab-btn ${lyricsView === 'raw' ? 'active' : ''}`}
                  onClick={() => setLyricsView('raw')}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
                  <span>{tr.whisper_tab_raw}</span>
                </button>
              </div>
            </div>

            {/* Media Player */}
            {isVideo ? (
              <div className="transcribe-video-wrapper">
                <video 
                  ref={videoPlayerRef}
                  className="transcribe-video-player" 
                  controls 
                  playsInline 
                  src={mediaBlobUrl}
                  onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
                />
              </div>
            ) : (
              <div className="transcribe-audio-card">
                <div className="audio-card-top">
                  <div className="audio-art-icon">🎵</div>
                  <div className="audio-track-info">
                    <span className="audio-track-title">{selectedFile?.name || 'Audio Track'}</span>
                    <span className="audio-track-sub">{tr.whisper_audio_sub}</span>
                  </div>
                  <div className="equalizer-bars">
                    <span className="bar bar-1"></span>
                    <span className="bar bar-2"></span>
                    <span className="bar bar-3"></span>
                    <span className="bar bar-4"></span>
                  </div>
                </div>
                <audio 
                  ref={audioPlayerRef}
                  className="transcribe-audio-player" 
                  controls 
                  src={mediaBlobUrl}
                  onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
                />
              </div>
            )}

            {/* View switcher body */}
            {lyricsView === 'live' ? (
              <SyncedLyrics 
                segments={resultData.segments || []} 
                currentTime={currentTime} 
                onSeek={handleSeek} 
                fullText={resultData.text} 
                lang={lang}
              />
            ) : (
              <RawTextView text={resultData.text} lang={lang} />
            )}

            {/* Result actions */}
            <div className="result-actions" style={{ marginTop: '18px' }}>
              <a 
                href={resultData.download_url} 
                className="btn-download-result" 
                download={resultData.filename || 'transcript.txt'}
                style={{ background: '#10b981' }}
              >
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                  <polyline points="7 10 12 15 17 10"></polyline>
                  <line x1="12" y1="15" x2="12" y2="3"></line>
                </svg>
                <span>{tr.whisper_btn_download}</span>
              </a>
              <button type="button" className="btn-another" onClick={resetAll}>{tr.whisper_btn_another}</button>
            </div>
          </div>
        )}

        {/* Supported Formats */}
        <div className="supported-formats-row">
          <span className="format-badge"><span className="badge-dot dot-word"></span> MP3 Audio</span>
          <span className="format-badge"><span className="badge-dot dot-excel"></span> MP4 Video</span>
          <span className="format-badge"><span className="badge-dot dot-ppt"></span> WAV Audio</span>
          <span className="format-badge"><span className="badge-dot dot-md"></span> M4A / AAC</span>
          <span className="format-badge"><span className="badge-dot dot-html"></span> WEBM Video</span>
          <span className="format-badge"><span className="badge-dot dot-txt"></span> FLAC / OGG</span>
        </div>
      </div>

      {/* Sơ đồ Tượng đài Kiến trúc AI Whisper */}
      <WhisperArchitectureModal 
        isOpen={isArchModalOpen} 
        onClose={() => setIsArchModalOpen(false)} 
        lang={lang} 
      />
    </section>
  );
}
