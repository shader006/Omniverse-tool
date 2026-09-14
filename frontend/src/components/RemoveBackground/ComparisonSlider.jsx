import React, { useState } from 'react';
import { translations } from '../../locales/translations';

export default function ComparisonSlider({ beforeSrc, afterSrc, beforeAlt = "Original", afterAlt = "Cutout", lang = 'vi' }) {
  const [sliderPos, setSliderPos] = useState(50);
  const tr = translations[lang] || translations.vi;

  return (
    <div className="comparison-container" id="bg-comparison-container">
      {/* Before Image (Bottom layer) */}
      <div className="comparison-before">
        <img src={beforeSrc} alt={beforeAlt} loading="lazy" />
        <span className="comparison-tag tag-before">{tr.bg_slider_original}</span>
      </div>

      {/* After Image (Clipped top layer) */}
      <div 
        className="comparison-after" 
        id="bg-compare-after-wrapper"
        style={{ width: `${sliderPos}%` }}
      >
        <img src={afterSrc} alt={afterAlt} loading="lazy" />
        <span className="comparison-tag tag-after">{tr.bg_slider_removed}</span>
      </div>

      {/* Slider input */}
      <input 
        type="range" 
        min="0" 
        max="100" 
        value={sliderPos}
        className="comparison-slider" 
        id="bg-comparison-slider" 
        aria-label="So sánh Trước và Sau"
        onChange={(e) => setSliderPos(Number(e.target.value))}
      />

      {/* Comparison Handle */}
      <div 
        className="comparison-handle" 
        id="bg-comparison-handle"
        style={{ left: `${sliderPos}%` }}
      >
        <div className="handle-line"></div>
        <div className="handle-button">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5">
            <polyline points="15 18 9 12 15 6"></polyline>
          </svg>
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5">
            <polyline points="9 18 15 12 9 6"></polyline>
          </svg>
        </div>
      </div>
    </div>
  );
}
