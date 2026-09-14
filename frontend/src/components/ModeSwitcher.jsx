import React from 'react';

export default function ModeSwitcher({ currentMode, onSelectMode, lang = 'vi' }) {
  const modes = [
    {
      id: 'url',
      label: lang === 'vi' ? 'URL sang MP3 / MP4' : 'URL to MP3 / MP4',
      icon: (
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2">
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
        </svg>
      )
    },
    {
      id: 'file',
      label: lang === 'vi' ? 'Chuyển đổi File (PDF)' : 'File Converter (PDF)',
      icon: (
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
          <polyline points="14 2 14 8 20 8"></polyline>
          <line x1="16" y1="13" x2="8" y2="13"></line>
          <line x1="16" y1="17" x2="8" y2="17"></line>
          <polyline points="10 9 9 9 8 9"></polyline>
        </svg>
      )
    },
    {
      id: 'transcribe',
      label: lang === 'vi' ? 'Tách giọng nói (Whisper)' : 'Extract Text (Whisper)',
      icon: (
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2">
          <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
          <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
          <line x1="12" y1="19" x2="12" y2="23"></line>
          <line x1="8" y1="23" x2="16" y2="23"></line>
        </svg>
      )
    },
    {
      id: 'bg',
      label: lang === 'vi' ? 'Xóa phông ảnh (AI)' : 'Remove BG (AI)',
      icon: (
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2">
          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"></path>
        </svg>
      )
    }
  ];

  return (
    <div className="mode-switcher-wrapper">
      <div className="mode-switcher">
        {modes.map((mode) => (
          <button
            key={mode.id}
            type="button"
            className={`mode-btn ${currentMode === mode.id ? 'active' : ''}`}
            data-mode={mode.id}
            onClick={() => onSelectMode(mode.id)}
          >
            {mode.icon}
            <span>{mode.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
