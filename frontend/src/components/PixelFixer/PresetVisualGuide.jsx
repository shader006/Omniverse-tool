import React, { useState, useEffect } from 'react';

export const PRESETS_DATA = [
  {
    id: 'auto',
    icon: '⚡',
    titleKey: 'pixel_preset_auto',
    fallbackTitle: 'Mặc định (Auto)',
    enTitle: 'Default (Auto)',
    tag: 'Cân bằng / Đa dụng',
    tagEn: 'Balanced / General',
    beforeImg: '/assets/presets/preset-auto-before.png',
    afterImg: '/assets/presets/preset-auto.png',
    descVi: 'Khử mờ nhòe thông minh, loại bỏ nhiễu nén JPEG nhẹ và cân bằng dải màu tự nhiên (32 màu). Giữ trọn bố cục gốc.',
    descEn: 'Smart de-blurring, subtle JPEG artifact removal, and balanced natural colors (32 colors). Preserves original composition.',
    bestForVi: 'Hầu hết sprite nhân vật, quái vật, đạo cụ 2D tiêu chuẩn',
    bestForEn: 'Standard 2D character sprites, monsters, normal game items',
    specs: { engine: 'Fast Pack (2-Stage)', palette: 'Auto (32 màu)', topology: 'Lưới đều (Uniform)', scale: '1x Native' },
    sampleFile: '/assets/presets/preset-auto-before.png'
  },
  {
    id: 'crisp-sprite',
    icon: '⚔️',
    titleKey: 'pixel_preset_crisp',
    fallbackTitle: 'Sprite Sắc Nét',
    enTitle: 'Crisp Sprite',
    tag: 'Khử 100% Mờ Viền',
    tagEn: 'Zero Anti-Aliasing',
    beforeImg: '/assets/presets/preset-crisp-before.png',
    afterImg: '/assets/presets/preset-crisp.png',
    descVi: 'Loại bỏ hoàn toàn pixel mờ nhòe (anti-aliasing) quanh viền bằng thuật toán SOTA. Đường nét vũ khí và ranh giới nhân vật được cắt phẳng sắc lẹm, không dính màu nền.',
    descEn: 'Eliminates 100% of blurry anti-aliasing edge pixels via SOTA algorithm. Weapon edges and sprite borders cut razor-sharp.',
    bestForVi: 'Vũ khí kiếm đao, sprite di chuyển, animation hành động 2D',
    bestForEn: 'Swords, blades, character movement sprites, 2D action animation',
    specs: { engine: 'SOTA Advanced', palette: 'Auto', topology: 'Lưới đều (Uniform)', scale: '1x Native' },
    sampleFile: '/assets/presets/preset-crisp-before.png'
  },
  {
    id: 'transparent-icon',
    icon: '🛡️',
    titleKey: 'pixel_preset_transparent',
    fallbackTitle: 'Icon Viền Đen',
    enTitle: 'Dark Outline Icon',
    tag: 'Viền Đen Nổi Khối',
    tagEn: '1px Black Outline',
    beforeImg: '/assets/presets/preset-outline-before.png',
    afterImg: '/assets/presets/preset-outline.png',
    descVi: 'Lưới co giãn (Elastic Snap) tự động ép sát viền và tạo đường viền tối màu (1px outline) bao bọc quanh sprite, giúp icon tách bạch hoàn toàn khỏi mọi nền game.',
    descEn: 'Elastic Snap grid hugs borders tightly and crafts a solid dark outline (1px stroke), keeping icons distinct on any background.',
    bestForVi: 'Item inventory RPG, khiên giáp, bình máu, đồ rơi (loot), UI icon',
    bestForEn: 'RPG inventory items, shields, potions, loot items, UI icons',
    specs: { engine: 'SOTA Advanced', palette: 'Auto', topology: 'Co giãn (Elastic Snap)', scale: '1x Native' },
    sampleFile: '/assets/presets/preset-outline-before.png'
  },
  {
    id: 'retro-console',
    icon: '🕹️',
    titleKey: 'pixel_preset_retro',
    fallbackTitle: 'Cổ Điển PICO-8',
    enTitle: 'Classic PICO-8',
    tag: '16 Màu Nostalgic',
    tagEn: '16-Color Nostalgia',
    beforeImg: '/assets/presets/preset-retro-before.png',
    afterImg: '/assets/presets/preset-retro.png',
    descVi: 'Lượng tử hóa màu nghiêm ngặt theo bảng 16 màu huyền thoại của máy ảo PICO-8. Tái hiện trọn vẹn nét đẹp hoài niệm của game thùng Arcade và console thập niên 80-90.',
    descEn: 'Strictly quantizes colors to the legendary 16-color PICO-8 palette. Recreates authentic retro arcade and 8-bit console charm.',
    bestForVi: 'Game indie retro, máy ảo Pico-8, game 8-bit phong cách hoài cổ',
    bestForEn: 'Retro indie games, Pico-8 fantasy console, vintage 8-bit games',
    specs: { engine: 'Fast Pack', palette: 'PICO-8 (16 màu)', topology: 'Lưới đều (Uniform)', scale: '1x Native' },
    sampleFile: '/assets/presets/preset-retro-before.png'
  },
  {
    id: 'photo-pixel',
    icon: '📷',
    titleKey: 'pixel_preset_photo',
    fallbackTitle: 'Chuyển Ảnh Thường',
    enTitle: 'Photo to Pixel',
    tag: 'Hóa Pixel Nghệ Thuật',
    tagEn: 'Artistic Pixelation',
    beforeImg: '/assets/presets/preset-photo-before.png',
    afterImg: '/assets/presets/preset-photo.png',
    descVi: 'Chuyển hóa ảnh thực tế, ảnh phong cảnh hoặc tranh vẽ chi tiết phức tạp thành tác phẩm Pixel Art nghệ thuật bằng cách gom các mảng màu và tăng kích cỡ hạt pixel 2x.',
    descEn: 'Transforms real-life photos, landscapes, or complex artwork into aesthetic Pixel Art by clustering color regions and scaling pixel blocks 2x.',
    bestForVi: 'Ảnh chụp đời thực, phong cảnh thiên nhiên, avatar chân dung phong cách pixel',
    bestForEn: 'Real-world photos, landscapes, pixelated portrait avatars',
    specs: { engine: 'SOTA Advanced', palette: 'PICO-8 (16 màu)', topology: 'Lưới đều (Uniform)', scale: '2x Upscale' },
    sampleFile: '/assets/presets/preset-photo-before.png'
  },
  {
    id: 'fine-details',
    icon: '🔍',
    titleKey: 'pixel_preset_fine',
    fallbackTitle: 'Giữ Chi Tiết Nhỏ',
    enTitle: 'Preserve Small Details',
    tag: 'Độ Nhạy Đa Kênh',
    tagEn: 'Tri-Channel Saliency',
    beforeImg: '/assets/presets/preset-fine-before.png',
    afterImg: '/assets/presets/preset-fine.png',
    descVi: 'Mật độ lưới nhạy cảm đa kênh cực cao, bảo toàn từng điểm pixel li ti như ánh mắt, biểu cảm nhân vật, chữ số nhỏ hay hoa văn giáp mà không bị nuốt mất nét.',
    descEn: 'Ultra-sensitive tri-channel saliency grid safeguards fine micro-pixels such as eye glints, expressions, and tiny armor engravings.',
    bestForVi: 'Khuôn mặt nhân vật, biểu cảm chibi, huy hiệu và hoa văn trang phục li ti',
    bestForEn: 'Character faces, chibi expressions, small insignias & runes',
    specs: { engine: 'SOTA Advanced', palette: 'Auto', topology: 'Co giãn (Elastic Snap)', scale: '1x Native' },
    sampleFile: '/assets/presets/preset-fine-before.png'
  }
];

/**
 * Interactive Preview Card shown directly below the presets bar
 */
export function PresetVisualCard({ activePreset, onSelectPreset, onLoadSample, onOpenModal, lang, tr }) {
  const [viewMode, setViewMode] = useState('after'); // 'after' | 'before' | 'split'
  const isEn = lang === 'en';

  const currentPreset = PRESETS_DATA.find(p => p.id === activePreset) || PRESETS_DATA[0];

  return (
    <div className="preset-visual-card">
      <div className="preset-card-header">
        <div className="preset-card-title-group">
          <span className="preset-card-badge">
            <span className="preset-icon">{currentPreset.icon}</span>
            {isEn ? currentPreset.tagEn : currentPreset.tag}
          </span>
          <h3 className="preset-current-title">
            {tr[currentPreset.titleKey] || currentPreset.fallbackTitle}
          </h3>
        </div>

        <div className="preset-card-actions">
          <button
            type="button"
            className="preset-guide-modal-btn"
            onClick={onOpenModal}
            title={tr.pixel_preset_view_all_modal || 'Xem cả 6 tùy chỉnh'}
          >
            {tr.pixel_presets_guide_btn || '👁️ Xem ví dụ 6 tùy chỉnh'}
          </button>
        </div>
      </div>

      <div className="preset-card-body">
        {/* Visual Sprite Preview Container */}
        <div className="preset-preview-visual-box">
          <div className="preset-preview-display">
            <div className="preset-preview-stage">
              {viewMode === 'before' ? (
                <div className="preset-img-wrapper before-state">
                  <img 
                    src={currentPreset.beforeImg} 
                    alt="Before Sample" 
                    className="preset-preview-img"
                  />
                  <span className="preset-state-tag before-tag">{tr.pixel_slider_before || 'ẢNH GỐC / MỜ'}</span>
                </div>
              ) : viewMode === 'split' ? (
                <div className="preset-img-split-wrapper">
                  <div className="split-half split-left">
                    <img src={currentPreset.beforeImg} alt="Before" className="preset-preview-img" />
                    <span className="preset-state-tag before-tag">GỐC</span>
                  </div>
                  <div className="split-divider"></div>
                  <div className="split-half split-right">
                    <img src={currentPreset.afterImg} alt="After" className="preset-preview-img" />
                    <span className="preset-state-tag after-tag">KẾT QUẢ</span>
                  </div>
                </div>
              ) : (
                <div className="preset-img-wrapper after-state">
                  <img 
                    src={currentPreset.afterImg} 
                    alt="After Sample" 
                    className="preset-preview-img"
                  />
                  <span className="preset-state-tag after-tag">{tr.pixel_slider_after || 'PIXEL ART ĐÃ SỬA'}</span>
                </div>
              )}
            </div>

            {/* Quick Toggle Controls */}
            <div className="preset-preview-toggles">
              <button 
                type="button" 
                className={`preset-toggle-btn ${viewMode === 'after' ? 'active' : ''}`}
                onClick={() => setViewMode('after')}
              >
                ✨ {isEn ? 'Result' : 'Kết quả'}
              </button>
              <button 
                type="button" 
                className={`preset-toggle-btn ${viewMode === 'before' ? 'active' : ''}`}
                onClick={() => setViewMode('before')}
              >
                🔍 {isEn ? 'Original' : 'Ảnh gốc'}
              </button>
              <button 
                type="button" 
                className={`preset-toggle-btn ${viewMode === 'split' ? 'active' : ''}`}
                onClick={() => setViewMode('split')}
              >
                ⚡ {isEn ? 'Side-by-side' : 'So sánh đôi'}
              </button>
            </div>
          </div>
        </div>

        {/* Detailed Explanation & Specs */}
        <div className="preset-info-container">
          <p className="preset-desc-text">
            {isEn ? currentPreset.descEn : currentPreset.descVi}
          </p>

          <div className="preset-recommendation-box">
            <span className="recommend-label">
              🎯 {tr.pixel_preset_recommended_for || 'Khuyên dùng cho:'}
            </span>
            <span className="recommend-value">
              {isEn ? currentPreset.bestForEn : currentPreset.bestForVi}
            </span>
          </div>

          <div className="preset-specs-pills">
            <span className="specs-pill">⚙️ <strong>Engine:</strong> {currentPreset.specs.engine}</span>
            <span className="specs-pill">🎨 <strong>Palette:</strong> {currentPreset.specs.palette}</span>
            <span className="specs-pill">📐 <strong>Lưới:</strong> {currentPreset.specs.topology}</span>
            <span className="specs-pill">🔍 <strong>Scale:</strong> {currentPreset.specs.scale}</span>
          </div>

          <div className="preset-action-bar">
            <button
              type="button"
              className="preset-load-sample-btn"
              onClick={() => onLoadSample(currentPreset)}
            >
              {tr.pixel_preset_try_sample || '🧪 Thử ngay với mẫu này'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Full Modal showing all 6 Presets side-by-side in an authentic retro grid
 */
export function PresetComparisonModal({ isOpen, onClose, activePreset, onSelectPreset, onLoadSample, lang, tr }) {
  const isEn = lang === 'en';

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="preset-modal-backdrop" onClick={onClose}>
      <div className="preset-modal-container" onClick={(e) => e.stopPropagation()}>
        {/* Modal Header */}
        <div className="preset-modal-header">
          <div className="modal-title-wrap">
            <h2 className="preset-modal-title">
              🎮 {tr.pixel_presets_guide_title || 'Thư Viện Ví Dụ Trực Quan Cho Từng Tùy Chỉnh'}
            </h2>
            <p className="preset-modal-subtitle">
              {tr.pixel_presets_guide_desc || 'So sánh trực quan sự khác biệt giữa các mục đích xử lý để chọn cấu hình hoàn hảo nhất cho game của bạn.'}
            </p>
          </div>
          <button type="button" className="preset-modal-close-btn" onClick={onClose}>
            ✕
          </button>
        </div>

        {/* 6 Presets Grid */}
        <div className="preset-grid-cards">
          {PRESETS_DATA.map((p) => {
            const isActive = activePreset === p.id;
            return (
              <div 
                key={p.id} 
                className={`preset-grid-item ${isActive ? 'active-card' : ''}`}
                onClick={() => onSelectPreset(p.id)}
              >
                <div className="preset-grid-item-top">
                  <div className="preset-grid-item-badge">
                    <span>{p.icon}</span>
                    <span>{isEn ? p.tagEn : p.tag}</span>
                  </div>
                  {isActive && <span className="active-indicator">★ ĐANG CHỌN</span>}
                </div>

                <h4 className="preset-grid-item-title">
                  {tr[p.titleKey] || p.fallbackTitle}
                </h4>

                {/* Side-by-side Before / After Box */}
                <div className="preset-grid-compare-box">
                  <div className="grid-compare-side before-side">
                    <img src={p.beforeImg} alt="Before" className="grid-compare-img" />
                    <span className="grid-state-label">GỐC</span>
                  </div>
                  <div className="grid-compare-arrow">➔</div>
                  <div className="grid-compare-side after-side">
                    <img src={p.afterImg} alt="After" className="grid-compare-img" />
                    <span className="grid-state-label">PIXEL ART</span>
                  </div>
                </div>

                <p className="preset-grid-desc">
                  {isEn ? p.descEn : p.descVi}
                </p>

                <div className="preset-grid-recommend">
                  <strong>🎯 {isEn ? 'Best for:' : 'Hợp nhất:'}</strong> {isEn ? p.bestForEn : p.bestForVi}
                </div>

                <div className="preset-grid-specs">
                  <span>{p.specs.engine}</span>
                  <span>{p.specs.palette}</span>
                  <span>{p.specs.topology}</span>
                </div>

                <div className="preset-grid-footer">
                  <button
                    type="button"
                    className={`preset-grid-select-btn ${isActive ? 'btn-active' : ''}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectPreset(p.id);
                      onClose();
                    }}
                  >
                    {isActive 
                      ? (isEn ? '✓ Selected' : '✓ Đang áp dụng') 
                      : (tr.pixel_preset_apply_this || '👉 Chọn mục đích này')}
                  </button>
                  <button
                    type="button"
                    className="preset-grid-try-btn"
                    title={isEn ? 'Load this sample sprite into Studio' : 'Nạp ảnh mẫu này vào Studio'}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectPreset(p.id);
                      onLoadSample(p);
                      onClose();
                    }}
                  >
                    🧪
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
