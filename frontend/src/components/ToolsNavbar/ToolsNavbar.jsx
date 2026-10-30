import React, { useState, useRef, useEffect } from 'react';
import { useAuth } from '../../hooks/useAuth';
import './tools-navbar.css';

export default function ToolsNavbar({ onGoHome, onGoAbout, onGoTools, onOpenLogin, lang = 'vi', currentPage = 'tools', onOpenSettings }) {
  const { user, isLoggedIn, logout } = useAuth();
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  const menuRef = useRef(null);
  const mobileNavRef = useRef(null);

  // Đóng menu khi click ra ngoài
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setShowUserMenu(false);
      }
      if (mobileNavRef.current && !mobileNavRef.current.contains(e.target)) {
        setIsMobileNavOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleLogout = async () => {
    setShowUserMenu(false);
    try {
      await logout();
    } catch (err) {
      console.error('Logout error:', err);
    }
  };

  // Lấy tên hiển thị: displayName -> email prefix -> 'User'
  const displayName = user?.displayName || user?.email?.split('@')[0] || 'User';
  // Lấy avatar: photoURL -> fallback chữ cái đầu
  const avatarUrl = user?.photoURL || null;
  const avatarInitial = displayName.charAt(0).toUpperCase();

  return (
    <header className="pixel-tools-navbar">
      <div className="pixel-tools-nav-inner">
        {/* Left: Nav Links (Hiện trên Desktop, ẩn trên Mobile) */}
        <div className="pixel-tools-nav-left">
          <ul className="pixel-tools-nav-links">
            <li>
              <button 
                type="button" 
                className={`pixel-nav-link-item${currentPage === 'home' ? ' active' : ''}`} 
                onClick={onGoHome}
              >
                {lang === 'vi' ? 'Trang chủ' : 'Home'}
              </button>
            </li>
            <li>
              <button 
                type="button" 
                className={`pixel-nav-link-item${currentPage === 'about' ? ' active' : ''}`} 
                onClick={onGoAbout}
              >
                {lang === 'vi' ? 'Về chúng tôi' : 'About us'}
              </button>
            </li>
            <li>
              <button
                type="button"
                className={`pixel-nav-link-item${currentPage === 'tools' ? ' active' : ''}`}
                onClick={onGoTools}
              >
                {lang === 'vi' ? 'Công cụ AI' : 'AI Tools'}
              </button>
            </li>
          </ul>
        </div>

        {/* Right: Social Links, Avatar & Hamburger Menu */}
        <div className="pixel-tools-nav-right">
          <a href="https://x.com" target="_blank" rel="noreferrer" className="pixel-social-icon-sm pixel-social-desktop" title="X (Twitter)">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
            </svg>
          </a>

          <a href="https://www.facebook.com/profile.php?id=61595131252251" target="_blank" rel="noreferrer" className="pixel-social-icon-sm pixel-social-desktop" title="Facebook">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
              <path d="M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073C0 18.1 4.388 23.094 10.125 24v-8.437H7.078v-3.49h3.047V9.41c0-3.025 1.792-4.697 4.533-4.697 1.312 0 2.686.236 2.686.236v2.97h-1.513c-1.491 0-1.956.93-1.956 1.874v2.25h3.328l-.532 3.49h-2.796V24C19.612 23.094 24 18.1 24 12.073z"/>
            </svg>
          </a>

          <a href="https://t.me" target="_blank" rel="noreferrer" className="pixel-social-icon-sm pixel-social-desktop" title="Telegram">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 00-.05-.18c-.06-.05-.14-.03-.21-.02-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.36-.01-1.04-.2-1.55-.37-.63-.2-1.12-.31-1.08-.66.02-.18.27-.36.74-.55 2.92-1.27 4.86-2.11 5.83-2.52 2.77-1.16 3.35-1.37 3.73-1.37.08 0 .27.02.39.12.1.08.13.19.14.27-.01.06.01.24 0 .38z"/>
            </svg>
          </a>

          <a href="https://discord.com" target="_blank" rel="noreferrer" className="pixel-social-icon-sm pixel-social-desktop" title="Discord">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
              <path d="M20.317 4.37a19.791 19.791 0 00-4.885-1.515.074.074 0 00-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 00-5.487 0 12.64 12.64 0 00-.617-1.25.077.077 0 00-.079-.037A19.736 19.736 0 003.677 4.37a.07.07 0 00-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 00.031.057 19.9 19.9 0 005.993 3.03.078.078 0 00.084-.028c.462-.63.874-1.295 1.226-1.994.021-.041.001-.09-.041-.106a13.107 13.107 0 01-1.872-.892.077.077 0 01-.008-.128 10.2 10.2 0 00.372-.292.074.074 0 01.077-.01c3.929 1.793 8.18 1.793 12.061 0a.074.074 0 01.078.01c.12.098.246.198.373.292a.077.077 0 01-.006.127 12.299 12.299 0 01-1.873.894.077.077 0 00-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 00.084.028 19.839 19.839 0 006.002-3.03.077.077 0 00.032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 00-.031-.028zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/>
            </svg>
          </a>

          {/* ── Nút 3 gạch (Hamburger Menu Button) bên phải trên Mobile ── */}
          <div className="pixel-hamburger-wrapper" ref={mobileNavRef}>
            <button
              type="button"
              className={`pixel-hamburger-btn ${isMobileNavOpen ? 'active' : ''}`}
              onClick={() => setIsMobileNavOpen((prev) => !prev)}
              aria-label="Toggle Menu"
              title="Menu"
            >
              <span className="pixel-hamburger-bar"></span>
              <span className="pixel-hamburger-bar"></span>
              <span className="pixel-hamburger-bar"></span>
            </button>

            {/* Menu mở rộng khi bấm 3 gạch */}
            {isMobileNavOpen && (
              <div className="pixel-mobile-nav-dropdown">
                <ul className="pixel-mobile-nav-list">
                  <li>
                    <button
                      type="button"
                      className="pixel-mobile-nav-item"
                      onClick={() => {
                        setIsMobileNavOpen(false);
                        onGoHome();
                      }}
                    >
                      <span className="pixel-nav-icon">🏠</span>
                      <span>{lang === 'vi' ? 'Trang chủ' : 'Home'}</span>
                    </button>
                  </li>
                  <li>
                    <button
                      type="button"
                      className="pixel-mobile-nav-item"
                      onClick={() => {
                        setIsMobileNavOpen(false);
                        onGoAbout();
                      }}
                    >
                      <span className="pixel-nav-icon">ℹ️</span>
                      <span>{lang === 'vi' ? 'Về chúng tôi' : 'About us'}</span>
                    </button>
                  </li>
                  <li>
                    <button
                      type="button"
                      className="pixel-mobile-nav-item"
                      onClick={() => {
                        setIsMobileNavOpen(false);
                        onGoTools();
                      }}
                    >
                      <span className="pixel-nav-icon">⚡</span>
                      <span>{lang === 'vi' ? 'Công cụ AI' : 'AI Tools'}</span>
                    </button>
                  </li>


                  <li className="pixel-mobile-nav-divider"></li>

                  <li>
                    <button
                      type="button"
                      className="pixel-mobile-nav-item"
                      onClick={() => {
                        setIsMobileNavOpen(false);
                        if (onOpenSettings) onOpenSettings();
                      }}
                    >
                      <span className="pixel-nav-icon">⚙️</span>
                      <span>{lang === 'vi' ? 'Cài đặt' : 'Settings'}</span>
                    </button>
                  </li>

                  {isLoggedIn ? (
                    <li>
                      <button
                        type="button"
                        className="pixel-mobile-nav-item pixel-mobile-nav-item--logout"
                        onClick={() => {
                          setIsMobileNavOpen(false);
                          handleLogout();
                        }}
                      >
                        <span className="pixel-nav-icon">🚪</span>
                        <span>{lang === 'vi' ? 'Đăng xuất' : 'Sign Out'}</span>
                      </button>
                    </li>
                  ) : (
                    <li>
                      <button
                        type="button"
                        className="pixel-mobile-nav-item pixel-mobile-nav-item--login"
                        onClick={() => {
                          setIsMobileNavOpen(false);
                          if (onOpenLogin) onOpenLogin();
                        }}
                      >
                        <span className="pixel-nav-icon">🔑</span>
                        <span>{lang === 'vi' ? 'Đăng nhập' : 'Sign In'}</span>
                      </button>
                    </li>
                  )}
                </ul>
              </div>
            )}
          </div>

          {/* ── User Avatar Chip SÁT BÊN PHẢI NGOÀI CÙNG (khi đã login) hoặc Nút Đăng nhập (chưa login) ── */}
          {isLoggedIn ? (
            <div className="pixel-user-chip-wrapper" ref={menuRef}>
              <button
                type="button"
                className="pixel-user-chip"
                onClick={() => setShowUserMenu((prev) => !prev)}
                title={user?.email || displayName}
                aria-label="User Profile"
              >
                {avatarUrl ? (
                  <img
                    src={avatarUrl}
                    alt=""
                    className="pixel-user-avatar"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <span className="pixel-user-avatar pixel-user-avatar--initial">
                    {avatarInitial}
                  </span>
                )}
              </button>

              {/* ── Dropdown Menu ── */}
              {showUserMenu && (
                <div className="pixel-user-dropdown">
                  <div className="pixel-user-dropdown-header">
                    <span className="pixel-user-dropdown-email">{user?.email}</span>
                    <span className="pixel-user-dropdown-provider">
                      {user?.providerData?.[0]?.providerId === 'google.com'
                        ? '🔵 Google'
                        : user?.providerData?.[0]?.providerId === 'github.com'
                          ? '⚫ GitHub'
                          : '📧 Email'}
                    </span>
                  </div>
                  <div className="pixel-user-dropdown-divider" />
                  <button
                    type="button"
                    className="pixel-user-dropdown-item"
                    onClick={() => {
                      setShowUserMenu(false);
                      if (onOpenSettings) onOpenSettings();
                    }}
                  >
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="3"></circle>
                      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
                    </svg>
                    {lang === 'vi' ? 'Cài đặt' : 'Settings'}
                  </button>
                  <button
                    type="button"
                    className="pixel-user-dropdown-item pixel-user-dropdown-item--logout"
                    onClick={handleLogout}
                  >
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/>
                      <polyline points="16 17 21 12 16 7"/>
                      <line x1="21" y1="12" x2="9" y2="12"/>
                    </svg>
                    {lang === 'vi' ? 'Đăng xuất' : 'Sign Out'}
                  </button>
                </div>
              )}
            </div>
          ) : (
            <button 
              type="button" 
              className="pixel-nav-link-item pixel-tools-nav-login" 
              onClick={onOpenLogin}
            >
              {lang === 'vi' ? 'Đăng nhập' : 'Sign In'}
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
