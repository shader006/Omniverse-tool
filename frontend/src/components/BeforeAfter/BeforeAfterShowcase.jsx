import React, { useState, useRef, useCallback } from 'react';
import './before-after.css';

/* ── Dữ liệu so sánh Before / After chỉ dành riêng cho 2 công cụ ảnh ── */
const SHOWCASE_DATA = {
  vi: {
    bg: {
      title: 'Trước & Sau Xóa Phông AI (BiRefNet SOTA)',
      subtitle: 'Tự động bóc tách chủ thể sắc nét, bảo toàn từng sợi tóc và viền chi tiết nhỏ',
      beforeSrc: '/assets/ba-bg-before.png',
      afterSrc: '/assets/ba-bg-after.png',
      beforeAlt: 'Ảnh gốc có phông nền',
      afterAlt: 'Ảnh sau khi tách nền trong suốt',
    },
    pixel: {
      title: 'Trước & Sau Khôi Phục Pixel Art (Fixed Grid)',
      subtitle: 'Khử mờ JPEG, căn chỉnh chuẩn lưới pixel grid và bảo toàn bảng màu gốc bằng thuật toán',
      beforeSrc: '/assets/ba-pixel-before.png',
      afterSrc: '/assets/ba-pixel-after.png',
      beforeAlt: 'Pixel art bị vỡ mờ và nén JPEG',
      afterAlt: 'Pixel art sau khi khôi phục sắc nét',
    },
  },
  en: {
    bg: {
      title: 'Before & After AI Background Removal',
      subtitle: 'Crisp subject isolation preserving every hair strand and fine details',
      beforeSrc: '/assets/ba-bg-before.png',
      afterSrc: '/assets/ba-bg-after.png',
      beforeAlt: 'Original image with background',
      afterAlt: 'Isolated cutout on transparent background',
    },
    pixel: {
      title: 'Before & After Pixel Art Restoration',
      subtitle: 'Remove JPEG blur, snap to crisp pixel grid, preserve authentic colors',
      beforeSrc: '/assets/ba-pixel-before.png',
      afterSrc: '/assets/ba-pixel-after.png',
      beforeAlt: 'Blurry & JPEG compressed sprite',
      afterAlt: 'Crisp restored authentic pixel art',
    },
  },
};

/* ── Component Slider so sánh ảnh 2 lớp mượt mà ── */
function ImageComparisonSlider({ item, lang = 'vi' }) {
  const [pos, setPos] = useState(50);
  const [dragging, setDragging] = useState(false);
  const containerRef = useRef(null);

  const updatePos = useCallback((clientX) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
    setPos(Math.round((x / rect.width) * 100));
  }, []);

  const onMouseMove = useCallback((e) => {
    if (!dragging) return;
    updatePos(e.clientX);
  }, [dragging, updatePos]);

  const onTouchMove = useCallback((e) => {
    updatePos(e.touches[0].clientX);
  }, [updatePos]);

  return (
    <div
      ref={containerRef}
      className="ba-img-slider-container"
      onMouseMove={onMouseMove}
      onMouseDown={() => setDragging(true)}
      onMouseUp={() => setDragging(false)}
      onMouseLeave={() => setDragging(false)}
      onTouchMove={onTouchMove}
      onTouchStart={() => setDragging(true)}
      onTouchEnd={() => setDragging(false)}
    >
      {/* Before Layer (Ảnh gốc phía dưới) */}
      <div className="ba-slider-layer ba-layer-before">
        <img src={item.beforeSrc} alt={item.beforeAlt} className="ba-slider-img" />
        <span className="ba-img-tag ba-tag-before">
          {lang === 'vi' ? 'TRƯỚC' : 'BEFORE'}
        </span>
      </div>

      {/* After Layer (Ảnh kết quả phía trên, cắt theo % slider) */}
      <div
        className="ba-slider-layer ba-layer-after"
        style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}
      >
        <img src={item.afterSrc} alt={item.afterAlt} className="ba-slider-img" />
        <span className="ba-img-tag ba-tag-after">
          {lang === 'vi' ? 'SAU' : 'AFTER'}
        </span>
      </div>

      {/* Thanh trượt điều khiển */}
      <input
        type="range"
        min="0"
        max="100"
        value={pos}
        className="ba-img-range"
        onChange={(e) => setPos(Number(e.target.value))}
        aria-label="Kéo để so sánh trước và sau"
      />

      {/* Đường phân chia & nút kéo */}
      <div className="ba-img-handle" style={{ left: `${pos}%` }}>
        <div className="ba-handle-line" />
        <div className="ba-handle-knob">
          <span>◀</span>
          <span>▶</span>
        </div>
      </div>
    </div>
  );
}

export default function BeforeAfterShowcase({ mode, lang = 'vi' }) {
  // Chỉ hiển thị cho công cụ ảnh (bg và pixel)
  if (mode !== 'bg' && mode !== 'pixel') return null;

  const data = (SHOWCASE_DATA[lang] || SHOWCASE_DATA.vi)[mode];
  if (!data) return null;

  return (
    <section className="ba-showcase-wrapper" id={`ba-showcase-${mode}`}>
      <div className="ba-header">
        <div className="ba-header-label">
          <span className="ba-pixel-dot" />
          {lang === 'vi' ? 'SO SÁNH TRỰC QUAN' : 'VISUAL COMPARISON'}
        </div>
        <h3 className="ba-title">{data.title}</h3>
        <p className="ba-subtitle">{data.subtitle}</p>
      </div>

      <div className="ba-slider-body">
        <ImageComparisonSlider item={data} lang={lang} />
      </div>

      <div className="ba-slider-footer">
        <span className="ba-slider-hint">
          {lang === 'vi'
            ? '⇄ Kéo thanh trượt để so sánh độ chi tiết Trước & Sau'
            : '⇄ Drag slider to inspect Before & After detail'}
        </span>
      </div>
    </section>
  );
}
