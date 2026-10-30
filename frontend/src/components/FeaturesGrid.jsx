import React from 'react';
import { translations } from '../locales/translations';

const TOOL_CARDS = {
  vi: [
    {
      icon: '🎵',
      title: 'Tải YouTube / TikTok MP3 & MP4',
      desc: 'Dán link YouTube, TikTok, Facebook – chọn chất lượng MP3 (128kbps–320kbps) hoặc MP4 (720p–4K) và tải ngay. Engine yt-dlp + FFmpeg, không watermark.',
      keywords: ['tải youtube mp3', 'tải tiktok mp4', 'youtube downloader', 'tiktok downloader'],
      href: '#url',
      badge: 'MIỄN PHÍ',
      color: '#22c55e',
    },
    {
      icon: '📄',
      title: 'Chuyển Đổi PDF & Tài Liệu',
      desc: 'Chuyển đổi Word (DOCX), Excel (XLSX), PowerPoint (PPTX) sang PDF chuẩn in ấn bằng Gotenberg v8. Hoặc chuyển PDF ngược lại sang DOCX giữ nguyên layout.',
      keywords: ['chuyển word sang pdf', 'chuyển excel sang pdf', 'pdf converter', 'gotenberg'],
      href: '#file',
      badge: 'GOTENBERG V8',
      color: '#38bdf8',
    },
    {
      icon: '🎙️',
      title: 'Nhận Dạng Giọng Nói Whisper AI',
      desc: 'Upload file MP3/MP4/WAV – Whisper AI tự động chuyển âm thanh thành văn bản, xuất file .txt, .srt (phụ đề), .vtt, .json. Hỗ trợ 100+ ngôn ngữ.',
      keywords: ['nhận dạng giọng nói', 'speech to text', 'whisper ai', 'chuyển âm thanh thành văn bản'],
      href: '#transcribe',
      badge: 'OPENAI WHISPER',
      color: '#a78bfa',
    },
    {
      icon: '✂️',
      title: 'Xóa Phông Ảnh AI BiRefNet',
      desc: 'Tách nền ảnh tự động chất lượng studio với BiRefNet-Lite SOTA, tăng tốc Intel OpenVINO. Sắc nét đến từng sợi tóc, xuất PNG trong suốt chuẩn đồ họa.',
      keywords: ['xóa phông ảnh', 'remove background', 'tách nền ảnh ai', 'birefnet'],
      href: '#bg',
      badge: 'BIREFNET SOTA',
      color: '#f472b6',
    },
    {
      icon: '🎮',
      title: 'Pixel Art Fixer & Refiner',
      desc: 'Khử mờ JPEG, phát hiện lưới pixel, ép bảng màu PICO-8/NES/Game Boy, xuất Sprite 2x–4x sắc nét. Thuật toán định vị lưới pixel grid hoàn hảo cho Game Dev.',
      keywords: ['pixel art fixer', 'upscale pixel art', 'khôi phục pixel art', 'retro game sprite'],
      href: '#pixel',
      badge: 'ALGORITHM',
      color: '#fb923c',
    },
    {
      icon: '✨',
      title: 'Nâng Cấp Độ Phân Giải Ảnh (AI Upscale)',
      desc: 'Phóng to ảnh 2x / 4x cực nét với mạng nơ-ron SOTA RealPLKSR (Partial Large Kernel Conv). Tăng tốc WebGPU ngay trên máy hoặc AI Cloud.',
      keywords: ['upscale ảnh', 'phóng to ảnh ai', 'super resolution', 'realplksr'],
      href: '#upscale',
      badge: 'REALPLKSR SOTA',
      color: '#e11d48',
    },
  ],
  en: [
    {
      icon: '🎵',
      title: 'Download YouTube / TikTok MP3 & MP4',
      desc: 'Paste YouTube, TikTok, Facebook link – choose MP3 (128kbps–320kbps) or MP4 (720p–4K) quality and download instantly. Powered by yt-dlp + FFmpeg.',
      keywords: ['download youtube mp3', 'download tiktok mp4', 'youtube downloader', 'tiktok downloader'],
      href: '#url',
      badge: 'FREE',
      color: '#22c55e',
    },
    {
      icon: '📄',
      title: 'PDF & Document Converter',
      desc: 'Convert Word (DOCX), Excel (XLSX), PowerPoint (PPTX) to print-ready PDF with Gotenberg v8. Or convert PDF back to DOCX preserving original layout.',
      keywords: ['word to pdf', 'excel to pdf', 'pdf converter', 'gotenberg'],
      href: '#file',
      badge: 'GOTENBERG V8',
      color: '#38bdf8',
    },
    {
      icon: '🎙️',
      title: 'Whisper AI Speech Recognition',
      desc: 'Upload MP3/MP4/WAV – Whisper AI automatically transcribes audio to text, export .txt, .srt (subtitles), .vtt, .json. Supports 100+ languages.',
      keywords: ['speech to text', 'whisper ai', 'audio transcription', 'subtitle generator'],
      href: '#transcribe',
      badge: 'OPENAI WHISPER',
      color: '#a78bfa',
    },
    {
      icon: '✂️',
      title: 'AI Background Remover BiRefNet',
      desc: 'Auto remove image background with studio-grade BiRefNet-Lite SOTA powered by Intel OpenVINO. Hair-level precision, exports transparent PNG.',
      keywords: ['remove background', 'background remover ai', 'transparent png', 'birefnet'],
      href: '#bg',
      badge: 'BIREFNET SOTA',
      color: '#f472b6',
    },
    {
      icon: '🎮',
      title: 'Pixel Art Fixer & Refiner',
      desc: 'De-blur JPEG artifacts, detect pixel grid, quantize to PICO-8/NES/Game Boy palettes, export 2x–4x crisp Sprites. Deterministic pixel grid algorithm.',
      keywords: ['pixel art fixer', 'upscale pixel art', 'retro game sprite', 'pixel art algorithm'],
      href: '#pixel',
      badge: 'ALGORITHM',
      color: '#fb923c',
    },
    {
      icon: '✨',
      title: 'AI Picture Super-Resolution (Upscaler)',
      desc: 'Upscale pictures 2x / 4x crystal clear powered by SOTA RealPLKSR neural network (Partial Large Kernel Conv). Accelerated via local WebGPU or Cloud AI.',
      keywords: ['ai upscaler', 'image super resolution', 'upscale picture', 'realplksr'],
      href: '#upscale',
      badge: 'REALPLKSR SOTA',
      color: '#e11d48',
    },
  ],
};

export default function FeaturesGrid({ lang = 'vi', onSelectTool }) {
  const tr = translations[lang] || translations.vi;
  const cards = TOOL_CARDS[lang] || TOOL_CARDS.vi;

  return (
    <section
      className="features-section-seo"
      aria-label={lang === 'vi' ? 'Các công cụ AI của Omniverse' : 'Omniverse AI Tools'}
      itemScope
      itemType="https://schema.org/ItemList"
    >
      {/* Heading phụ để Google index keyword */}
      <h2 className="features-heading-seo">
        {lang === 'vi'
          ? '5 Công Cụ AI Miễn Phí – Đa Phương Tiện Trực Tuyến'
          : '5 Free AI Tools – Online Multimedia Suite'}
      </h2>
      <p className="features-subheading-seo">
        {lang === 'vi'
          ? 'Không cần cài đặt, không giới hạn, xử lý trực tiếp trên trình duyệt hoặc server AI.'
          : 'No installation, unlimited usage, processes directly in browser or AI server.'}
      </p>

      <div className="features-cards-grid" role="list">
        {cards.map((card, i) => (
          <article
            key={i}
            className="feature-card-seo"
            role="listitem"
            itemScope
            itemType="https://schema.org/ListItem"
            style={{ '--card-accent': card.color }}
          >
            <meta itemProp="position" content={String(i + 1)} />
            <div className="feature-card-inner">
              <div className="feature-card-top">
                <span className="feature-card-emoji" aria-hidden="true">{card.icon}</span>
                <span className="feature-card-badge" style={{ color: card.color, borderColor: card.color }}>
                  {card.badge}
                </span>
              </div>
              <h3 className="feature-card-title" itemProp="name">
                <a
                  href={card.href}
                  className="feature-card-link"
                  onClick={(e) => {
                    e.preventDefault();
                    if (onSelectTool) {
                      const mode = card.href.replace('#', '');
                      onSelectTool(mode);
                    } else {
                      window.location.hash = card.href;
                    }
                  }}
                  itemProp="url"
                >
                  {card.title}
                </a>
              </h3>
              <p className="feature-card-desc" itemProp="description">{card.desc}</p>
              {/* Hidden keywords for semantic crawling */}
              <ul className="feature-card-keywords" aria-hidden="true">
                {card.keywords.map((kw, ki) => (
                  <li key={ki}><span>{kw}</span></li>
                ))}
              </ul>
              <a
                href={card.href}
                className="feature-card-cta"
                style={{ background: card.color }}
                onClick={(e) => {
                  e.preventDefault();
                  if (onSelectTool) {
                    const mode = card.href.replace('#', '');
                    onSelectTool(mode);
                  } else {
                    window.location.hash = card.href;
                  }
                }}
              >
                {lang === 'vi' ? 'Dùng ngay →' : 'Use now →'}
              </a>
            </div>
          </article>
        ))}
      </div>

      {/* Stats bar – social proof cho Google E-E-A-T */}
      <div className="features-stats-bar" aria-label={lang === 'vi' ? 'Thống kê' : 'Stats'}>
        <div className="stat-item">
          <span className="stat-number">5</span>
          <span className="stat-label">{lang === 'vi' ? 'Công cụ AI' : 'AI Tools'}</span>
        </div>
        <div className="stat-divider" aria-hidden="true">|</div>
        <div className="stat-item">
          <span className="stat-number">100%</span>
          <span className="stat-label">{lang === 'vi' ? 'Miễn phí' : 'Free'}</span>
        </div>
        <div className="stat-divider" aria-hidden="true">|</div>
        <div className="stat-item">
          <span className="stat-number">320kbps</span>
          <span className="stat-label">{lang === 'vi' ? 'Chất lượng MP3' : 'MP3 Quality'}</span>
        </div>
        <div className="stat-divider" aria-hidden="true">|</div>
        <div className="stat-item">
          <span className="stat-number">100+</span>
          <span className="stat-label">{lang === 'vi' ? 'Ngôn ngữ Whisper' : 'Whisper Languages'}</span>
        </div>
      </div>
    </section>
  );
}
