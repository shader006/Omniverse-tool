import React, { useEffect, useRef, useState, useCallback } from 'react';
import './pixel-mascot.css';

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

const REACTIONS = [
  'blink',
  'heart',
  'sparkle',
  'surprised',
  'wink',
  'bashful',
  'sleepy',
  'dizzy',
  'delighted',
];

// Clockwise matching Math.atan2 with y pointing down
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

const SECTOR = (Math.PI * 2) / CLOCKWISE.length;
const HYSTERESIS = 0.12;
const DEAD_ZONE = 60;

const PAYOFFS = ['heart', 'sparkle', 'delighted'];
const BOOP_PAYOFF = 130;
const BOOP_END = 600;
const SQUASH_MS = 420;
const DIZZY_AFTER = 4;
const DIZZY_WINDOW = 1600;
const DIZZY_END = 1200;

const SQUASH = [
  { transform: 'scale(1, 1)', easing: 'ease-in' },
  { transform: 'scale(1.12, 0.84)', offset: 0.18, easing: 'ease-out' },
  { transform: 'scale(0.94, 1.09)', offset: 0.45, easing: 'ease-in-out' },
  { transform: 'scale(1.03, 0.97)', offset: 0.72, easing: 'ease-in-out' },
  { transform: 'scale(1, 1)' },
];

function cellPosition(index) {
  return `${(index % 3) * 50}% ${Math.floor(index / 3) * 50}%`;
}

function wrapAngle(angle) {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

export default function PixelMascot({
  directions = '/mascots/fox-pixel-directions.webp',
  reactions = '/mascots/fox-pixel-reactions.webp',
  size = 110,
  lang = 'vi',
}) {
  const buttonRef = useRef(null);
  const squashRef = useRef(null);
  const timersRef = useRef([]);
  const boopsRef = useRef({ count: 0, at: 0 });

  const [direction, setDirection] = useState('center');
  const [reaction, setReaction] = useState(null);
  const [bubbleText, setBubbleText] = useState('');
  const [isBubbleVisible, setIsBubbleVisible] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  // Auto show greeting once after 1.5s
  useEffect(() => {
    const greetingTimer = setTimeout(() => {
      setBubbleText(lang === 'vi' ? 'Chạm vào tui đi! 🦊' : 'Boop me! 🦊');
      setIsBubbleVisible(true);
      const hideTimer = setTimeout(() => {
        setIsBubbleVisible(false);
      }, 4000);
      timersRef.current.push(hideTimer);
    }, 1500);

    return () => clearTimeout(greetingTimer);
  }, [lang]);

  // Pointer tracking logic
  useEffect(() => {
    if (isMinimized) return;
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;

    let sector = -1;
    let pointer = null;

    const aim = () => {
      const button = buttonRef.current;
      if (!button || !pointer) return;

      const box = button.getBoundingClientRect();
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
  }, [isMinimized]);

  // Clean up timers on unmount
  useEffect(() => {
    return () => {
      timersRef.current.forEach(window.clearTimeout);
    };
  }, []);

  const boop = useCallback(() => {
    timersRef.current.forEach(window.clearTimeout);
    timersRef.current = [];

    const later = (ms, next, bubble = '') => {
      const t = window.setTimeout(() => {
        setReaction(next);
        if (bubble) {
          setBubbleText(bubble);
          setIsBubbleVisible(true);
        } else if (!next) {
          setIsBubbleVisible(false);
        }
      }, ms);
      timersRef.current.push(t);
    };

    const now = Date.now();
    const boops = boopsRef.current;
    boops.count = now - boops.at < DIZZY_WINDOW ? boops.count + 1 : 1;
    boops.at = now;

    if (boops.count >= DIZZY_AFTER) {
      boops.count = 0;
      setReaction('dizzy');
      setBubbleText(lang === 'vi' ? 'Chóng mặt quá! 😵‍💫' : 'So dizzy! 😵‍💫');
      setIsBubbleVisible(true);
      later(DIZZY_END, null);
    } else {
      setReaction('blink');
      const payoff = PAYOFFS[(boops.count - 1) % PAYOFFS.length];
      const phrasesVi = ['Yay! ❤️', 'Lấp lánh ✨', 'Tuyệt vời! 🐾'];
      const phrasesEn = ['Yay! ❤️', 'Sparkle! ✨', 'Awesome! 🐾'];
      const text = (lang === 'vi' ? phrasesVi : phrasesEn)[(boops.count - 1) % 3];

      later(BOOP_PAYOFF, payoff, text);
      later(BOOP_END, null);
    }

    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      squashRef.current?.animate(SQUASH, { duration: SQUASH_MS, easing: 'linear' });
    }
  }, [lang]);

  const handleMouseEnter = () => {
    setIsHovered(true);
    if (!reaction && !isBubbleVisible) {
      setBubbleText(lang === 'vi' ? 'Chạm tui đi! 🐾' : 'Click me! 🐾');
      setIsBubbleVisible(true);
    }
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
    if (!reaction) {
      setIsBubbleVisible(false);
    }
  };

  const dirIndex = DIRECTIONS.indexOf(direction);
  const reactIndex = REACTIONS.indexOf(reaction ?? 'blink');

  if (isMinimized) {
    return (
      <div className="pixel-mascot-minimized-wrapper" onClick={() => setIsMinimized(false)}>
        <button
          type="button"
          className="pixel-mascot-restore-btn"
          title={lang === 'vi' ? 'Đánh thức cáo pixel' : 'Wake up pixel fox'}
        >
          <span className="pixel-mascot-mini-icon">🦊</span>
          <span className="pixel-mascot-mini-label">Fox</span>
        </button>
      </div>
    );
  }

  return (
    <aside className="pixel-mascot-container" aria-label="Interactive Pixel Mascot">
      {/* Balloon Speech Bubble */}
      <div
        className={`pixel-mascot-bubble ${isBubbleVisible || isHovered ? 'visible' : ''}`}
        aria-live="polite"
      >
        <span className="pixel-mascot-bubble-text">{bubbleText || (lang === 'vi' ? 'Chào bạn! 🦊' : 'Hello! 🦊')}</span>
        <div className="pixel-mascot-bubble-tail"></div>
      </div>

      {/* Mascot Control Header (Minimize) */}
      <button
        type="button"
        className="pixel-mascot-minimize-btn"
        onClick={(e) => {
          e.stopPropagation();
          setIsMinimized(true);
        }}
        title={lang === 'vi' ? 'Thu gọn' : 'Minimize'}
        aria-label="Minimize pet"
      >
        −
      </button>

      {/* Main Mascot Button */}
      <button
        ref={buttonRef}
        type="button"
        onClick={boop}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        aria-label={lang === 'vi' ? 'Chạm vào cáo pixel' : 'Boop the pixel fox'}
        className="pixel-mascot-btn"
        style={{ width: size, height: size }}
      >
        <span ref={squashRef} className="pixel-mascot-squash">
          {/* Head Directions Layer */}
          <span
            className="pixel-mascot-sprite-layer"
            style={{
              backgroundImage: `url(${directions})`,
              backgroundPosition: cellPosition(dirIndex),
              opacity: reaction ? 0 : 1,
            }}
          />

          {/* Reactions Layer */}
          <span
            className="pixel-mascot-sprite-layer"
            style={{
              backgroundImage: `url(${reactions})`,
              backgroundPosition: cellPosition(reactIndex),
              opacity: reaction ? 1 : 0,
            }}
          />
        </span>
      </button>

      {/* Retro Pixel Ground Shadow */}
      <div className="pixel-mascot-shadow"></div>
    </aside>
  );
}
