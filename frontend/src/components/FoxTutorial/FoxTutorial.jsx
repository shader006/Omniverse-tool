import React, { useState, useEffect, useRef, useCallback } from 'react';
import './fox-tutorial.css';

/* ── Nội dung hướng dẫn cho từng tool ── */
const TUTORIALS = {
  vi: {
    url: [
      { text: 'Chào! Tôi là FOX, trợ lý của Omniverse! 🦊', emoji: '👋' },
      { text: 'Dán link YouTube, TikTok hoặc Facebook vào ô bên dưới nhé!', emoji: '📋', highlight: 'url-input' },
      { text: 'Nhấn nút CONVERT để phân tích video và lấy danh sách chất lượng.', emoji: '⚡', highlight: 'btn-convert' },
      { text: 'Chọn MP3 (nhạc) hoặc MP4 (video) theo nhu cầu của bạn!', emoji: '🎵' },
      { text: 'Nhấn Download để tải về. Tốc độ siêu nhanh 320kbps! 🚀', emoji: '⬇️' },
    ],
    file: [
      { text: 'Tôi là FOX! Hướng dẫn chuyển đổi file nhé! 🦊', emoji: '📄' },
      { text: 'Kéo & thả file Word, Excel, PowerPoint vào vùng upload.', emoji: '📁', highlight: 'file-drop-zone' },
      { text: 'Chọn định dạng đầu ra: PDF (in ấn) hoặc Word (.docx).', emoji: '🔄' },
      { text: 'Nhấn "Chuyển Đổi Ngay" – Gotenberg v8 xử lý siêu tốc!', emoji: '⚡' },
      { text: 'Tải về file đã convert. Giữ nguyên font chữ và layout! ✅', emoji: '✅' },
    ],
    transcribe: [
      { text: 'FOX đây! Whisper AI sẽ nghe giúp bạn viết thành chữ! 🦊', emoji: '🎙️' },
      { text: 'Upload file MP3, MP4, WAV, FLAC – tối đa 10 phút/file.', emoji: '📂', highlight: 'whisper-drop-zone' },
      { text: 'Chọn ngôn ngữ âm thanh (hoặc để Auto nhận diện tự động).', emoji: '🌐' },
      { text: 'Chọn định dạng xuất: TXT, SRT phụ đề, VTT, JSON.', emoji: '📝' },
      { text: 'Nhấn Trích Xuất – kết quả hiện ra với Live Synced Lyrics! 🎶', emoji: '✨' },
    ],
    bg: [
      { text: 'Chào! Tôi sẽ dạy bạn xóa phông siêu đẹp! 🦊', emoji: '✂️' },
      { text: 'Upload ảnh PNG/JPG – hoặc dán ảnh bằng Ctrl+V!', emoji: '📸', highlight: 'bg-drop-zone' },
      { text: 'Chọn AI xử lý tại Trình Duyệt (nhanh, riêng tư) hoặc Server.', emoji: '🤖' },
      { text: 'Chọn màu nền thay thế: trong suốt, trắng, đen, hoặc tùy chỉnh.', emoji: '🎨' },
      { text: 'Nhấn "Tách Nền Ngay" – BiRefNet AI sắc nét đến từng sợi tóc! 💇', emoji: '🔥' },
    ],
    pixel: [
      { text: 'FOX ở đây! Hãy cùng khôi phục Pixel Art nhé! 🦊', emoji: '🎮' },
      { text: 'Upload ảnh Pixel Art bị mờ/JPEG – hoặc thử ảnh mẫu!', emoji: '🖼️', highlight: 'pixel-drop-zone' },
      { text: 'Chọn Engine: Fast Pack (nhanh) hoặc SOTA Advanced (chuẩn nhất).', emoji: '⚙️' },
      { text: 'Chọn bảng màu: PICO-8, Game Boy, NES – hoặc giữ màu gốc.', emoji: '🎨' },
      { text: 'Nhấn Khôi Phục – Sprite xuất ra sắc nét như lúc mới vẽ! ✨', emoji: '⚡' },
    ],
    upscale: [
      { text: 'FOX đây! Nâng cấp ảnh lên 2x / 4x cực nét bằng AI RealPLKSR nhé! 🦊', emoji: '✨' },
      { text: 'Kéo thả hoặc upload bức ảnh mờ, vỡ hạt cần upscale vào khung.', emoji: '🖼️', highlight: 'upscale-drop-zone' },
      { text: 'Chọn mức phóng to: 2x hoặc 4x chuẩn nét căng.', emoji: '🔍' },
      { text: 'Hệ thống tự động dùng WebGPU siêu tốc trên máy bạn hoặc Cloud AI.', emoji: '⚡' },
      { text: 'Nhấn "Upscale Ảnh Ngay" – xem trước so sánh phím Space và tải về ảnh 4K! 🚀', emoji: '🎉' },
    ],
  },
  en: {
    url: [
      { text: "Hi! I'm FOX, Omniverse's assistant! 🦊", emoji: '👋' },
      { text: 'Paste your YouTube, TikTok or Facebook link in the box below!', emoji: '📋', highlight: 'url-input' },
      { text: 'Hit CONVERT to analyze the video and get quality options.', emoji: '⚡' },
      { text: 'Choose MP3 (audio) or MP4 (video) based on your needs!', emoji: '🎵' },
      { text: 'Click Download to save. Blazing fast 320kbps speed! 🚀', emoji: '⬇️' },
    ],
    file: [
      { text: "I'm FOX! Let me guide you through file conversion! 🦊", emoji: '📄' },
      { text: 'Drag & drop your Word, Excel, PowerPoint file into the upload area.', emoji: '📁' },
      { text: 'Select output format: PDF (print-ready) or Word (.docx).', emoji: '🔄' },
      { text: 'Click "Convert Now" – Gotenberg v8 processes at lightning speed!', emoji: '⚡' },
      { text: 'Download the converted file. Fonts and layout preserved! ✅', emoji: '✅' },
    ],
    transcribe: [
      { text: "FOX here! Whisper AI will listen and write it all down for you! 🦊", emoji: '🎙️' },
      { text: 'Upload MP3, MP4, WAV, FLAC files – up to 10 minutes each.', emoji: '📂' },
      { text: 'Select audio language (or leave on Auto for automatic detection).', emoji: '🌐' },
      { text: 'Choose output format: TXT, SRT subtitles, VTT, JSON.', emoji: '📝' },
      { text: 'Hit Extract – results appear with Live Synced Lyrics! 🎶', emoji: '✨' },
    ],
    bg: [
      { text: "Hi! I'll teach you studio-grade background removal! 🦊", emoji: '✂️' },
      { text: 'Upload PNG/JPG image – or paste directly with Ctrl+V!', emoji: '📸' },
      { text: 'Choose AI: In-Browser (fast, private) or Server processing.', emoji: '🤖' },
      { text: 'Choose replacement background: transparent, white, black, or custom.', emoji: '🎨' },
      { text: 'Click "Remove BG Now" – BiRefNet AI is precise to every strand of hair! 💇', emoji: '🔥' },
    ],
    pixel: [
      { text: "FOX is here! Let's restore that Pixel Art together! 🦊", emoji: '🎮' },
      { text: 'Upload a blurry/JPEG Pixel Art image – or try the sample!', emoji: '🖼️' },
      { text: 'Choose Engine: Fast Pack (quick) or SOTA Advanced (best quality).', emoji: '⚙️' },
      { text: 'Choose palette: PICO-8, Game Boy, NES – or keep original colors.', emoji: '🎨' },
      { text: 'Hit Restore – your Sprite comes out crisp as the day it was drawn! ✨', emoji: '⚡' },
    ],
    upscale: [
      { text: "FOX here! Upscale your pictures to 2x / 4x with RealPLKSR AI! 🦊", emoji: '✨' },
      { text: 'Drag & drop or upload the blurry/low-res photo to upscale.', emoji: '🖼️', highlight: 'upscale-drop-zone' },
      { text: 'Select upscale factor: 2x or 4x crystal clear resolution.', emoji: '🔍' },
      { text: 'Automatically leverages client WebGPU acceleration or Cloud AI.', emoji: '⚡' },
      { text: 'Click "Upscale Picture Now" – hold Space to preview and download in 4K! 🚀', emoji: '🎉' },
    ],
  },
};

/* ── 8 hướng nhìn của đầu cáo ── */
const DIRECTIONS = [
  'up-left',
  'up',
  'up-right',
  'left',
  'center',
  'right',
  'down-left',
  'down',
  'down-right',
];

const CLOCKWISE = [
  'right',
  'down-right',
  'down',
  'down-left',
  'left',
  'up-left',
  'up',
  'up-right',
];

const REACTION_MAP = {
  blink: 0,
  heart: 1,
  sparkle: 2,
  surprised: 3,
  wink: 4,
  bashful: 5,
  sleepy: 6,
  dizzy: 7,
  delighted: 8,
};

const SECTOR = (Math.PI * 2) / CLOCKWISE.length;
const HYSTERESIS = 0.12;
const DEAD_ZONE = 60;

function cellPosition(index) {
  return `${(index % 3) * 50}% ${Math.floor(index / 3) * 50}%`;
}

function wrapAngle(angle) {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

const SQUASH = [
  { transform: 'scale(1, 1)', easing: 'ease-in' },
  { transform: 'scale(1.15, 0.82)', offset: 0.2, easing: 'ease-out' },
  { transform: 'scale(0.92, 1.12)', offset: 0.5, easing: 'ease-in-out' },
  { transform: 'scale(1.04, 0.96)', offset: 0.75, easing: 'ease-in-out' },
  { transform: 'scale(1, 1)' },
];

export default function FoxTutorial({ mode, lang = 'vi', onClose }) {
  const steps = (TUTORIALS[lang] || TUTORIALS.vi)[mode] || [];
  const [step, setStep] = useState(0);
  const [displayed, setDisplayed] = useState('');
  const [typing, setTyping] = useState(true);
  const [blink, setBlink] = useState(false);

  // Trạng thái bubble hướng dẫn (mở/đóng)
  const [bubbleOpen, setBubbleOpen] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [reaction, setReaction] = useState(null);
  const [direction, setDirection] = useState('center');

  const foxRef = useRef(null);
  const squashRef = useRef(null);
  const boopTimerRef = useRef(null);

  // Kiểm tra xem đã dismiss tutorial của mode này chưa
  useEffect(() => {
    const key = `fox-tutorial-dismissed-${mode}`;
    const isDismissed = localStorage.getItem(key);
    if (!isDismissed) {
      const timer = setTimeout(() => {
        setBubbleOpen(true);
      }, 700);
      return () => clearTimeout(timer);
    } else {
      setBubbleOpen(false);
    }
  }, [mode]);

  // Hiệu ứng gõ chữ
  useEffect(() => {
    if (!bubbleOpen) return;
    const text = steps[step]?.text || '';
    setDisplayed('');
    setTyping(true);
    let i = 0;
    const interval = setInterval(() => {
      i++;
      setDisplayed(text.slice(0, i));
      if (i >= text.length) {
        clearInterval(interval);
        setTyping(false);
      }
    }, 28);
    return () => clearInterval(interval);
  }, [step, bubbleOpen, steps]);

  // Chớp mắt tự nhiên
  useEffect(() => {
    const interval = setInterval(() => {
      setBlink(true);
      setTimeout(() => setBlink(false), 160);
    }, 3200);
    return () => clearInterval(interval);
  }, []);

  // POINTER TRACKING (Nhìn theo con trỏ chuột khi ở trạng thái idle / đã bỏ qua)
  useEffect(() => {
    if (bubbleOpen) return;
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;

    let sector = -1;
    let pointer = null;

    const aim = () => {
      const el = foxRef.current;
      if (!el || !pointer) return;

      const box = el.getBoundingClientRect();
      const dx = pointer.x - (box.left + box.width / 2);
      const dy = pointer.y - (box.top + box.height / 2);

      if (Math.hypot(dx, dy) < DEAD_ZONE) {
        sector = -1;
        setDirection('center');
        return;
      }

      const angle = Math.atan2(dy, dx);
      if (sector !== -1 && Math.abs(wrapAngle(angle - sector * SECTOR)) < SECTOR / 2 + HYSTERESIS) {
        return;
      }

      sector = (Math.round(angle / SECTOR) + CLOCKWISE.length) % CLOCKWISE.length;
      setDirection(CLOCKWISE[sector]);
    };

    const onPointerMove = (e) => {
      pointer = { x: e.clientX, y: e.clientY };
      aim();
    };

    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('scroll', aim, { passive: true });

    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('scroll', aim);
    };
  }, [bubbleOpen]);

  // Click vào con cáo
  const handleFoxClick = () => {
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      squashRef.current?.animate(SQUASH, { duration: 380, easing: 'linear' });
    }

    if (!bubbleOpen) {
      // Mở lại hướng dẫn từ bước 0
      setStep(0);
      setBubbleOpen(true);
      setReaction('delighted');
      setTimeout(() => setReaction(null), 900);
    } else {
      // Boop lấp lánh khi đang mở
      setReaction('sparkle');
      if (boopTimerRef.current) clearTimeout(boopTimerRef.current);
      boopTimerRef.current = setTimeout(() => setReaction(null), 800);
    }
  };

  // Bấm bỏ qua hoặc kết thúc: Đóng bubble, cáo chuyển sang nhìn theo chuột
  const handleDismiss = useCallback(() => {
    setBubbleOpen(false);
    localStorage.setItem(`fox-tutorial-dismissed-${mode}`, '1');
    if (onClose) onClose();
  }, [mode, onClose]);

  const handleNext = useCallback(() => {
    if (typing) {
      setDisplayed(steps[step]?.text || '');
      setTyping(false);
      return;
    }
    if (step < steps.length - 1) {
      setStep(s => s + 1);
    } else {
      handleDismiss();
    }
  }, [step, steps, typing, handleDismiss]);

  const currentStep = steps[step] || {};
  const isLastStep = step === steps.length - 1;

  // Lớp biểu cảm
  const isTutorialTalking = bubbleOpen && !reaction;
  const moodReaction = step === 0 ? 'delighted' : isLastStep ? 'sparkle' : 'wink';
  const activeReactionKey = reaction || (isTutorialTalking ? (blink ? 'blink' : moodReaction) : null);

  const dirIndex = DIRECTIONS.indexOf(direction);
  const reactIndex = activeReactionKey ? (REACTION_MAP[activeReactionKey] ?? 8) : 8;
  const showReactionLayer = Boolean(activeReactionKey);

  return (
    <aside className="fox-tutorial-wrapper" aria-label="Interactive Fox Assistant">
      {/* ── CÁO MASCOT TƯƠNG TÁC GÓC TRÁI ── */}
      <div className="fox-mascot-container" ref={foxRef}>
        {/* Tooltip khi rê chuột lúc bubble đang đóng */}
        {!bubbleOpen && (
          <div className={`fox-idle-tooltip${isHovered ? ' visible' : ''}`}>
            <span>{lang === 'vi' ? 'Xem hướng dẫn 🦊' : 'Show tutorial 🦊'}</span>
            <div className="fox-idle-tooltip-tail" />
          </div>
        )}

        <button
          type="button"
          className="fox-btn"
          onClick={handleFoxClick}
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
          title={bubbleOpen ? (lang === 'vi' ? 'Chạm vào tui! 🦊' : 'Boop me! 🦊') : (lang === 'vi' ? 'Xem hướng dẫn 🦊' : 'Show tutorial 🦊')}
          aria-label="Fox Assistant"
        >
          <span ref={squashRef} className="fox-squash">
            {/* Layer 1: Đầu xoay 8 hướng nhìn theo con trỏ chuột */}
            <span
              className="fox-sprite-layer"
              style={{
                backgroundImage: "url('/mascots/fox-pixel-directions.webp')",
                backgroundPosition: cellPosition(dirIndex),
                opacity: showReactionLayer ? 0 : 1,
              }}
            />

            {/* Layer 2: Biểu cảm boop & phản ứng theo bài hướng dẫn */}
            <span
              className="fox-sprite-layer"
              style={{
                backgroundImage: "url('/mascots/fox-pixel-reactions.webp')",
                backgroundPosition: cellPosition(reactIndex),
                opacity: showReactionLayer ? 1 : 0,
              }}
            />
          </span>
        </button>

        {/* Retro Pixel Ground Shadow */}
        <div className="fox-ground-shadow" />
      </div>

      {/* ── SPEECH BUBBLE HƯỚNG DẪN DẠNG GAME ── */}
      <div className={`fox-bubble${bubbleOpen ? ' open' : ' closed'}`} role="dialog" aria-label="Tutorial Dialog">
        <div className="fox-bubble-tail" />

        {/* Step indicator */}
        <div className="fox-step-dots">
          {steps.map((_, i) => (
            <span key={i} className={`fox-dot${i === step ? ' active' : i < step ? ' done' : ''}`} />
          ))}
        </div>

        {/* Message */}
        <p className="fox-message">
          <span className="fox-emoji">{currentStep.emoji}</span>
          {displayed}
          {typing && <span className="fox-cursor">▌</span>}
        </p>

        {/* Actions */}
        <div className="fox-actions">
          <button className="fox-btn-skip" onClick={handleDismiss}>
            {lang === 'vi' ? 'Bỏ qua' : 'Skip'}
          </button>
          <button className="fox-btn-next" onClick={handleNext}>
            {typing
              ? (lang === 'vi' ? 'Nhanh hơn ▶' : 'Skip ▶')
              : isLastStep
                ? (lang === 'vi' ? 'Hiểu rồi! 🎉' : 'Got it! 🎉')
                : (lang === 'vi' ? 'Tiếp theo →' : 'Next →')
            }
          </button>
        </div>
      </div>
    </aside>
  );
}
