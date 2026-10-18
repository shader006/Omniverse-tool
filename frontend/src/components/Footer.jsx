import React from 'react';
import { translations } from '../locales/translations';

export default function Footer({ lang = 'vi', onOpenPolicy, onOpenAbout }) {
  const tr = translations[lang] || translations.vi;
  const year = new Date().getFullYear();

  return (
    <footer className="footer">
      <div className="footer-inner">
        {/* Brand */}
        <div className="footer-brand">
          <span className="footer-logo-text">
            <span style={{ color: '#22c55e' }}>OMNI</span>VERSE
          </span>
          <span className="footer-tagline">
            {lang === 'vi' ? 'Công cụ AI miễn phí' : 'Free AI Toolkit'}
          </span>
        </div>

        {/* Legal links */}
        <div className="footer-legal">
          <button className="footer-link" onClick={() => onOpenPolicy?.('terms')}>
            {lang === 'vi' ? 'Điều Khoản' : 'Terms'}
          </button>
          <span className="footer-dot">·</span>
          <button className="footer-link" onClick={() => onOpenPolicy?.('privacy')}>
            {lang === 'vi' ? 'Bảo Mật' : 'Privacy'}
          </button>
          <span className="footer-dot">·</span>
          <button className="footer-link" onClick={() => onOpenPolicy?.('fairuse')}>
            Fair Use
          </button>
          <span className="footer-dot">·</span>
          <button className="footer-link" onClick={() => onOpenAbout?.()}>
            About Us
          </button>
          <span className="footer-dot">·</span>
          <a 
            href="https://www.facebook.com/profile.php?id=61595131252251" 
            target="_blank" 
            rel="noreferrer" 
            className="footer-link"
          >
            Facebook
          </a>
        </div>

        {/* Copyright */}
        <div className="footer-copy">
          © {year} Omniverse · {lang === 'vi'
            ? 'Tất cả quyền được bảo lưu'
            : 'All rights reserved'}
        </div>
      </div>
    </footer>
  );
}
