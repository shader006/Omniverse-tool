import React, { useState, useEffect } from 'react';

export default function Header() {
  const [theme, setTheme] = useState(() => {
    return localStorage.getItem('theme') || 'dark';
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.setAttribute('data-theme-choice', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme(prev => (prev === 'dark' ? 'light' : 'dark'));
  };

  return (
    <nav aria-label="Main" className="theme-layout-navbar navbar navbar--fixed-top navbar--dark">
      <div className="navbar__inner">
        <div className="theme-layout-navbar-left navbar__items">
          <button aria-label="Toggle navigation bar" aria-expanded="false" className="navbar__toggle clean-btn" type="button">
            <svg width="30" height="30" viewBox="0 0 30 30" aria-hidden="true">
              <path stroke="currentColor" strokeLinecap="round" strokeMiterlimit="10" strokeWidth="2" d="M4 7h22M4 15h22M4 23h22"/>
            </svg>
          </button>
          <a className="navbar__brand" href="/">
            <div className="navbar__logo">
              <img src="/img/header_logo.svg" alt="Omniverse Logo" className="themedComponent_siVc themedComponent--light_hHel" />
              <img src="/img/header_logo.svg" alt="Omniverse Logo" className="themedComponent_siVc themedComponent--dark_yETr" />
            </div>
            <b className="navbar__title text--truncate">Omniverse</b>
          </a>
        </div>
        <div className="theme-layout-navbar-right navbar__items navbar__items--right">
          <div className="navbar__item dropdown dropdown--hoverable dropdown--right">
            <a href="#" aria-haspopup="true" aria-expanded="false" role="button" className="navbar__link">Docs</a>
            <ul className="dropdown__menu">
              <li><a className="dropdown__link" href="#quickstart">Quickstart</a></li>
              <li><a className="dropdown__link" href="#architecture">Architecture</a></li>
              <li><a className="dropdown__link" href="#microservices">Microservices</a></li>
              <li><a className="dropdown__link" href="#team">Team & Research</a></li>
            </ul>
          </div>
          <a className="navbar__item navbar__link" href="#features">Features</a>
          <a className="navbar__item navbar__link" href="#gotenberg">Gotenberg</a>
          <a className="navbar__item navbar__link" href="#whisper">Whisper AI</a>
          <a className="navbar__item navbar__link" href="#downloader">Media Downloader</a>
          <a className="navbar__item navbar__link" href="#benchmarks">Benchmarks</a>
          <a href="https://github.com/shader006/Omniverse-tool" target="_blank" rel="noopener noreferrer" className="navbar__item navbar__link navbar-github-link" aria-label="GitHub repository"></a>
          
          <div className="toggle_ki11 colorModeToggle_Hewu">
            <button 
              className="clean-btn toggleButton_MMFG darkNavbarColorModeToggle_m8pZ" 
              type="button" 
              onClick={toggleTheme}
              title={`Switch between dark and light mode (currently ${theme} mode)`}
              aria-label={`Switch between dark and light mode (currently ${theme} mode)`}
            >
              <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" className="toggleIcon_k9hJ lightToggleIcon_lgto">
                <path fill="currentColor" d="M12,9c1.65,0,3,1.35,3,3s-1.35,3-3,3s-3-1.35-3-3S10.35,9,12,9 M12,7c-2.76,0-5,2.24-5,5s2.24,5,5,5s5-2.24,5-5 S14.76,7,12,7L12,7z M2,13l2,0c0.55,0,1-0.45,1-1s-0.45-1-1-1l-2,0c-0.55,0-1,0.45-1,1S1.45,13,2,13z M20,13l2,0c0.55,0,1-0.45,1-1 s-0.45-1-1-1l-2,0c-0.55,0-1,0.45-1,1S19.45,13,20,13z M11,2v2c0,0.55,0.45,1,1,1s1-0.45,1-1V2c0-0.55-0.45-1-1-1S11,1.45,11,2z M11,20v2c0,0.55,0.45,1,1,1s1-0.45,1-1v-2c0-0.55-0.45-1-1-1C11.45,19,11,19.45,11,20z M5.99,4.58c-0.39-0.39-1.03-0.39-1.41,0 c-0.39,0.39-0.39,1.03,0,1.41l1.06,1.06c0.39,0.39,1.03,0.39,1.41,0s0.39-1.03,0-1.41L5.99,4.58z M18.36,16.95 c-0.39-0.39-1.03-0.39-1.41,0c-0.39,0.39-0.39,1.03,0,1.41l1.06,1.06c0.39,0.39,1.03,0.39,1.41,0c0.39-0.39,0.39-1.03,0-1.41 L18.36,16.95z M19.42,5.99c0.39-0.39,0.39-1.03,0-1.41c-0.39-0.39-1.03-0.39-1.41,0l-1.06,1.06c-0.39,0.39-0.39,1.03,0,1.41 s1.03,0.39,1.41,0L19.42,5.99z M7.05,18.36c0.39-0.39,0.39-1.03,0-1.41c-0.39-0.39-1.03-0.39-1.41,0l-1.06,1.06 c-0.39,0.39-0.39,1.03,0,1.41s1.03,0.39,1.41,0L7.05,18.36z"/>
              </svg>
              <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" className="toggleIcon_k9hJ darkToggleIcon_U96C">
                <path fill="currentColor" d="M9.37,5.51C9.19,6.15,9.1,6.82,9.1,7.5c0,4.08,3.32,7.4,7.4,7.4c0.68,0,1.35-0.09,1.99-0.27C17.45,17.19,14.93,19,12,19 c-3.86,0-7-3.14-7-7C5,9.07,6.81,6.55,9.37,5.51z M12,3c-4.97,0-9,4.03-9,9s4.03,9,9,9s9-4.03,9-9c0-0.46-0.04-0.92-0.1-1.36 c-0.98,1.37-2.58,2.26-4.4,2.26c-2.98,0-5.4-2.42-5.4-5.4c0-1.81,0.89-3.42,2.26-4.4C12.92,3.04,12.46,3,12,3L12,3z"/>
              </svg>
            </button>
          </div>

          <div className="navbarSearchContainer_bzqh">
            <button type="button" className="DocSearch DocSearch-Button" aria-label="Search (Ctrl+K)">
              <span className="DocSearch-Button-Container">
                <svg width="20" height="20" className="DocSearch-Search-Icon" viewBox="0 0 24 24" aria-hidden="true">
                  <circle cx="11" cy="11" r="8" stroke="currentColor" fill="none" strokeWidth="1.4" />
                  <path d="m21 21-4.3-4.3" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span className="DocSearch-Button-Placeholder">Search</span>
              </span>
              <span className="DocSearch-Button-Keys"></span>
            </button>
          </div>
        </div>
      </div>
      <div role="presentation" className="navbar-sidebar__backdrop"></div>
    </nav>
  );
}
