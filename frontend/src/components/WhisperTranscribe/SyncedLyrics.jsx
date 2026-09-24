import React, { useState, useEffect, useRef, useCallback } from 'react';
import { translations } from '../../locales/translations';

export default function SyncedLyrics({ segments, currentTime, onSeek, fullText, lang = 'vi' }) {
  const [copied, setCopied] = useState(false);
  const [isUserScrolling, setIsUserScrolling] = useState(false);
  const activeLineRef = useRef(null);
  const containerRef = useRef(null);
  const isUserScrollingRef = useRef(false);
  const isProgrammaticScrollRef = useRef(false);
  const programmaticTimerRef = useRef(null);
  const scrollTimeoutRef = useRef(null);
  const prevActiveIdxRef = useRef(-1);
  const tr = translations[lang] || translations.vi;

  // Determine current active lyric segment index
  const activeIdx = segments ? segments.findIndex((seg, idx) => {
    const start = seg.start ?? 0;
    const nextSeg = segments[idx + 1];
    const end = nextSeg ? nextSeg.start : (seg.end ?? (start + 3));
    return currentTime >= start && currentTime < end;
  }) : -1;

  // Register user scroll/interaction (mouse wheel, dragging scrollbar, touch, click)
  const handleUserInteraction = useCallback(() => {
    isUserScrollingRef.current = true;
    setIsUserScrolling(true);
    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current);
    }
    // Re-enable auto-scroll after 4s of user inactivity
    scrollTimeoutRef.current = setTimeout(() => {
      isUserScrollingRef.current = false;
      setIsUserScrolling(false);
    }, 4000);
  }, []);

  // Track user manual scrolling in the container (handles mousewheel, touch, and scrollbar drag)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    // Detect scroll events: if not triggered by programmatic scrollTo, it's user action (e.g. scrollbar dragging)
    const handleScroll = () => {
      if (isProgrammaticScrollRef.current) return;
      handleUserInteraction();
    };

    el.addEventListener('wheel', handleUserInteraction, { passive: true });
    el.addEventListener('touchstart', handleUserInteraction, { passive: true });
    el.addEventListener('touchmove', handleUserInteraction, { passive: true });
    el.addEventListener('mousedown', handleUserInteraction, { passive: true });
    el.addEventListener('pointerdown', handleUserInteraction, { passive: true });
    el.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      el.removeEventListener('wheel', handleUserInteraction);
      el.removeEventListener('touchstart', handleUserInteraction);
      el.removeEventListener('touchmove', handleUserInteraction);
      el.removeEventListener('mousedown', handleUserInteraction);
      el.removeEventListener('pointerdown', handleUserInteraction);
      el.removeEventListener('scroll', handleScroll);
      if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
      if (programmaticTimerRef.current) clearTimeout(programmaticTimerRef.current);
    };
  }, [handleUserInteraction]);

  // CRITICAL: Scroll ONLY inside the lyrics container. NEVER use scrollIntoView() which jerks the whole browser window!
  const scrollToActive = useCallback((behavior = 'smooth') => {
    const container = containerRef.current;
    const target = activeLineRef.current;
    if (!container || !target) return;

    const containerRect = container.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();

    // Calculate vertical offset relative to container viewport
    const relativeTop = targetRect.top - containerRect.top;
    const targetScrollTop = container.scrollTop + relativeTop - (container.clientHeight / 2) + (targetRect.height / 2);

    // Guard flag to prevent container 'scroll' listener from mistaking auto-scroll for user drag
    isProgrammaticScrollRef.current = true;
    container.scrollTo({
      top: Math.max(0, targetScrollTop),
      behavior
    });

    if (programmaticTimerRef.current) {
      clearTimeout(programmaticTimerRef.current);
    }
    programmaticTimerRef.current = setTimeout(() => {
      isProgrammaticScrollRef.current = false;
    }, 600);
  }, []);

  // ONLY auto-scroll when active segment changes to a NEW line, and user is not actively scrolling
  useEffect(() => {
    if (activeIdx !== -1 && activeIdx !== prevActiveIdxRef.current) {
      prevActiveIdxRef.current = activeIdx;
      if (!isUserScrollingRef.current) {
        scrollToActive('smooth');
      }
    }
  }, [activeIdx, scrollToActive]);

  const handleManualReturnToCurrent = () => {
    isUserScrollingRef.current = false;
    setIsUserScrolling(false);
    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current);
    }
    scrollToActive('smooth');
  };

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

  // Auto scroll smoothly to keep active subtitle segment centered
  useEffect(() => {
    if (activeLineRef.current) {
      activeLineRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
        inline: 'nearest'
      });
    }
  }, [currentTime]);

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

      <div 
        ref={containerRef}
        className="spotify-lyrics-body" 
        id="transcribe-lyrics-container"
      >
        {(!segments || segments.length === 0) ? (
          <div className="spotify-lyric-item past-lyric" style={{ textAlign: 'center', padding: '30px 0', justifyContent: 'center' }}>
            {tr.whisper_lyrics_empty}
          </div>
        ) : (
          segments.map((seg, idx) => {
            const start = seg.start ?? 0;
            const nextSeg = segments[idx + 1];
            const end = nextSeg ? nextSeg.start : (seg.end ?? (start + 3));
            const isActive = idx === activeIdx;
            const isPast = currentTime >= end;

            let lineClass = 'spotify-lyric-item spotify-lyrics-line';
            if (isActive) lineClass += ' active-lyric active';
            else if (isPast) lineClass += ' past-lyric past';

            return (
              <div
                key={idx}
                ref={isActive ? activeLineRef : null}
                className={lineClass}
                onClick={() => {
                  if (onSeek) onSeek(start);
                  isUserScrollingRef.current = false;
                  setIsUserScrolling(false);
                  if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
                }}
                title={tr.whisper_lyrics_click_seek}
              >
                <span className="spotify-lyric-time lyrics-time-pill">
                  {isActive && <span className="lyric-play-icon">▶</span>}
                  {formatTimestamp(start)}
                </span>
                <span className="spotify-lyric-text lyrics-text">{seg.text}</span>
              </div>
            );
          })
        )}
      </div>

      {isUserScrolling && activeIdx !== -1 && (
        <button
          type="button"
          className="lyrics-sync-back-btn"
          onClick={handleManualReturnToCurrent}
          title={tr.whisper_lyrics_back_to_current}
        >
          <span style={{ fontSize: '0.85rem' }}>📍</span>
          <span>{tr.whisper_lyrics_back_to_current}</span>
        </button>
      )}
    </div>
  );
}
