import React from 'react';

export default function ModeSwitcher({ currentMode, onSelectMode, lang = 'vi' }) {
  const modes = [
    {
      id: 'url',
      label: lang === 'vi' ? 'URL sang MP3 / MP4' : 'URL to MP3 / MP4',
      icon: (
        <svg viewBox="0 0 16 16" width="18" height="18" fill="currentColor" shapeRendering="crispEdges">
          {/* Pixel Cassette Tape */}
          <path d="M1 3h14v10H1V3zm2 2v6h10V5H3zm1 2h2v2H4V7zm6 0h2v2h-2V7zm-3 1h2v1H7V8z" />
        </svg>
      )
    },
    {
      id: 'file',
      label: lang === 'vi' ? 'Chuyển đổi File (PDF)' : 'File Converter (PDF)',
      icon: (
        <svg viewBox="0 0 16 16" width="18" height="18" fill="currentColor" shapeRendering="crispEdges">
          {/* Pixel Floppy Disk */}
          <path d="M2 1h9l3 3v11H2V1zm2 2v4h7V3H4zm1 1h2v2H5V4zm-1 6v4h8v-4H4zm2 1h4v2H6v-2z" />
        </svg>
      )
    },
    {
      id: 'transcribe',
      label: lang === 'vi' ? 'Tách giọng nói (Whisper)' : 'Extract Text (Whisper)',
      icon: (
        <svg viewBox="0 0 16 16" width="18" height="18" fill="currentColor" shapeRendering="crispEdges">
          {/* Pixel Retro Studio Mic */}
          <path d="M6 1h4v7H6V1zM4 5h1v4h6V5h1v4a4 4 0 0 1-3 3.87V14h3v1H4v-1h3v-1.13A4 4 0 0 1 4 9V5z" />
        </svg>
      )
    },
    {
      id: 'bg',
      label: lang === 'vi' ? 'Xóa phông ảnh (AI)' : 'Remove BG (AI)',
      icon: (
        <svg viewBox="0 0 16 16" width="18" height="18" fill="currentColor" shapeRendering="crispEdges">
          {/* Pixel Magic Wand */}
          <path d="M12 1h2v2h-2V1zm-3 2h2v2H9V3zm5 3h2v2h-2V6zM2 14l8-8 2 2-8 8H2v-2zm7-7l1 1-6 6H3v-1l6-6z" />
        </svg>
      )
    },
    {
      id: 'pixel',
      label: lang === 'vi' ? 'Pixel Art Fixer (AI)' : 'Pixel Art Fixer (AI)',
      icon: (
        <svg viewBox="0 0 16 16" width="18" height="18" fill="currentColor" shapeRendering="crispEdges">
          {/* Authentic Pixel Grid Art Matrix */}
          <path d="M1 1h14v14H1V1zm2 2v4h4V3H3zm6 0v4h4V3H9zm-6 6v4h4V9H3zm6 0v4h4V9H9z" />
        </svg>
      )
    },
    {
      id: 'upscale',
      label: lang === 'vi' ? 'Upscale Ảnh (AI)' : 'Upscale Picture (AI)',
      icon: (
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2">
          <polyline points="15 3 21 3 21 9"></polyline>
          <polyline points="9 21 3 21 3 15"></polyline>
          <line x1="21" y1="3" x2="14" y2="10"></line>
          <line x1="3" y1="21" x2="10" y2="14"></line>
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
