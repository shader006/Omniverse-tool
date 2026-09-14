import React, { useState } from 'react';
import { translations } from '../../locales/translations';

export default function RawTextView({ text, lang = 'vi' }) {
  const [copied, setCopied] = useState(false);
  const tr = translations[lang] || translations.vi;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text || '');
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.warn('Copy error:', err);
    }
  };

  return (
    <div id="lyrics-raw-view" className="transcribe-preview-box">
      <div className="preview-box-header">
        <span>{tr.whisper_raw_label}</span>
        <button type="button" className="btn-copy-text" title={tr.copy} onClick={handleCopy}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
          </svg>
          <span>{copied ? tr.copied : tr.copy}</span>
        </button>
      </div>
      <textarea 
        id="transcribe-result-text" 
        className="transcribe-textarea" 
        readOnly 
        rows="8" 
        placeholder={tr.whisper_raw_placeholder}
        value={text || ''}
      />
    </div>
  );
}
