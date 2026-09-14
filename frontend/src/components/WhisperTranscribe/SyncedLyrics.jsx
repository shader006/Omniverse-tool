import React, { useState, useEffect, useRef } from 'react';
import { translations } from '../../locales/translations';

export default function SyncedLyrics({ segments, currentTime, onSeek, fullText, lang = 'vi' }) {
  const [copied, setCopied] = useState(false);
  const activeLineRef = useRef(null);
  const tr = translations[lang] || translations.vi;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(fullText || '');
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.warn('Copy error:', err);
    }
  };

  const formatTimestamp = (sec) => {
    if (sec == null || isNaN(sec)) return '00:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div id="lyrics-sync-view" className="spotify-lyrics-card">
      <div className="spotify-lyrics-header">
        <div className="spotify-header-title">
          <span className="spotify-title-text">{tr.whisper_lyrics_title}</span>
          <span className="spotify-hint-pill">{tr.whisper_lyrics_realtime}</span>
        </div>
        <button 
          type="button" 
          id="btn-copy-transcribe" 
          className="btn-copy-spotify" 
          title={tr.copy}
          onClick={handleCopy}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
          </svg>
          <span id="copy-btn-label">{copied ? tr.copied : tr.copy}</span>
        </button>
      </div>

      <div className="spotify-lyrics-body" id="transcribe-lyrics-container">
        {(!segments || segments.length === 0) ? (
          <div className="spotify-lyrics-line past" style={{ textAlign: 'center', padding: '30px 0' }}>
            {tr.whisper_lyrics_empty}
          </div>
        ) : (
          segments.map((seg, idx) => {
            const start = seg.start ?? 0;
            const end = seg.end ?? (start + 2);
            const isActive = currentTime >= start && currentTime <= end;
            const isPast = currentTime > end;

            let lineClass = 'spotify-lyrics-line';
            if (isActive) lineClass += ' active';
            else if (isPast) lineClass += ' past';

            return (
              <div
                key={idx}
                ref={isActive ? activeLineRef : null}
                className={lineClass}
                onClick={() => onSeek(start)}
                title={tr.whisper_lyrics_click_seek}
              >
                <span className="lyrics-time-pill">{formatTimestamp(start)}</span>
                <span className="lyrics-text">{seg.text}</span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
