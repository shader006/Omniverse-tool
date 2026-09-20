import React, { useState } from 'react';
import { Button } from '@/components/ui/pixelact-ui/button';
import LoginModal from '@/components/ui/pixelact-ui/LoginModal';
import { useAuth } from '../../hooks/useAuth';
import './pixel-hero.css';

export default function PixelHero({ onExploreTools, onSelectTool, onOpenLogin, lang = 'vi', onToggleLang }) {
  const [isLoginOpen, setIsLoginOpen] = useState(false);
  const { user, isLoggedIn } = useAuth();

  const handleOpenTools = (e) => {
    if (e) e.preventDefault();
    if (onExploreTools) {
      onExploreTools();
    } else {
      const el = document.getElementById('tools-workspace');
      if (el) el.scrollIntoView({ behavior: 'smooth' });
    }
  };

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleStartNow = () => {
    if (onOpenLogin) {
      onOpenLogin();
    } else {
      setIsLoginOpen(true);
    }
  };

  return (
    <section className="pixel-hero-wrapper">
      <div className="pixel-stars-layer"></div>

      {/* ==================== 1. TOP NAVBAR ==================== */}
      <header className="pixel-navbar">
        <a href="#" className="pixel-logo-container" onClick={scrollToTop}>
          <img src="/assets/logo.png" alt="ONIVERSE Logo" className="pixel-logo-img" />
        </a>

        <div className="pixel-navbar-right">
          <ul className="pixel-nav-links">
            <li>
              <a href="#home" className="pixel-nav-link active" onClick={scrollToTop}>
                {lang === 'vi' ? 'Trang chủ' : 'Home'}
              </a>
            </li>
            <li>
              <a href="#about" className="pixel-nav-link" onClick={handleStartNow}>
                {lang === 'vi' ? 'Về chúng tôi' : 'About us'}
              </a>
            </li>
            <li>
              <a href="#tools" className="pixel-nav-link" onClick={handleOpenTools}>
                {lang === 'vi' ? 'Công cụ AI' : 'AI Tools'}
              </a>
            </li>
          </ul>

          {/* Nút chuyển đổi ngôn ngữ ở góc trên bên phải */}
          <button 
            type="button" 
            className="pixel-hero-lang-btn" 
            onClick={onToggleLang}
            title={lang === 'vi' ? 'Switch to English' : 'Chuyển sang Tiếng Việt'}
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="2" y1="12" x2="22" y2="12"></line>
              <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
            </svg>
            <span className="pixel-hero-lang-tag">{(lang || 'vi').toUpperCase()}</span>
          </button>

          {/* ── Sát bên phải: User Avatar Badge (khi đã login) hoặc Login ── */}
          {isLoggedIn ? (
            <span className="pixel-nav-link pixel-hero-user-badge" title={user?.email || user?.displayName}>
              {user?.photoURL ? (
                <img src={user.photoURL} alt="" className="pixel-hero-user-mini-avatar" referrerPolicy="no-referrer" />
              ) : (
                <span className="pixel-hero-user-mini-avatar pixel-hero-user-mini-avatar--initial">
                  {(user?.displayName || user?.email || 'U').charAt(0).toUpperCase()}
                </span>
              )}
              <span className="pixel-hero-user-hi">{user?.displayName || user?.email?.split('@')[0] || 'User'}</span>
            </span>
          ) : (
            <button 
              type="button" 
              className="pixel-nav-link" 
              style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}
              onClick={handleStartNow}
            >
              {lang === 'vi' ? 'Đăng nhập' : 'Sign In'}
            </button>
          )}
        </div>
      </header>

      {/* ==================== 2. RIGHT FLOATING CONTROLS ==================== */}

      <div className="pixel-floating-right">
        <a href="https://x.com" target="_blank" rel="noreferrer" className="pixel-social-icon" title="X (Twitter)">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
          </svg>
        </a>
        <a href="https://t.me" target="_blank" rel="noreferrer" className="pixel-social-icon" title="Telegram">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 00-.05-.18c-.06-.05-.14-.03-.21-.02-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.36-.01-1.04-.2-1.55-.37-.63-.2-1.12-.31-1.08-.66.02-.18.27-.36.74-.55 2.92-1.27 4.86-2.11 5.83-2.52 2.77-1.16 3.35-1.37 3.73-1.37.08 0 .27.02.39.12.1.08.13.19.14.27-.01.06.01.24 0 .38z"/>
          </svg>
        </a>
        <a href="https://discord.com" target="_blank" rel="noreferrer" className="pixel-social-icon" title="Discord">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
            <path d="M20.317 4.37a19.791 19.791 0 00-4.885-1.515.074.074 0 00-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 00-5.487 0 12.64 12.64 0 00-.617-1.25.077.077 0 00-.079-.037A19.736 19.736 0 003.677 4.37a.07.07 0 00-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 00.031.057 19.9 19.9 0 005.993 3.03.078.078 0 00.084-.028c.462-.63.874-1.295 1.226-1.994.021-.041.001-.09-.041-.106a13.107 13.107 0 01-1.872-.892.077.077 0 01-.008-.128 10.2 10.2 0 00.372-.292.074.074 0 01.077-.01c3.929 1.793 8.18 1.793 12.061 0a.074.074 0 01.078.01c.12.098.246.198.373.292a.077.077 0 01-.006.127 12.299 12.299 0 01-1.873.894.077.077 0 00-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 00.084.028 19.839 19.839 0 006.002-3.03.077.077 0 00.032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 00-.031-.028zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/>
          </svg>
        </a>
      </div>

      {/* ==================== 3. HERO CENTER CONTENT (VỚI START NOW Ở DƯỚI LOGO) ==================== */}
      <div className="pixel-hero-center">
        {/* Logo 3D Pixel xanh lá từ asset */}
        <div className="pixel-hero-logo-box">
          <img src="/assets/logo.png" alt="OMNIVERSE" className="pixel-center-hero-logo" />
        </div>

        <p className="pixel-main-subtitle">
          MULTI MEDIA TOOLS
        </p>

        {/* Nút START NOW dưới phần Logo ở giữa màn hình */}
        <div className="pixel-start-now-wrapper">
          <Button 
            variant="green" 
            size="lg" 
            className="pixel-btn-start-now"
            onClick={handleStartNow}
          >
            START NOW ❯
          </Button>

          <Button 
            variant="secondary" 
            size="lg" 
            className="pixel-btn-explore"
            onClick={handleOpenTools}
          >
            EXPLORE TOOLS
          </Button>
        </div>
      </div>

      {/* Bottom spacer for balance */}
      <div className="pixel-hero-bottom-spacer"></div>

      {/* ==================== 4. CARD ĐĂNG NHẬP / ĐĂNG KÍ (ASSET SPRITE-0001.PNG) ==================== */}
      <LoginModal isOpen={isLoginOpen} onClose={() => setIsLoginOpen(false)} lang={lang} />
    </section>
  );
}
