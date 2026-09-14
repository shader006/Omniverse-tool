import React from 'react';

export default function Navbar() {
  return (
    <header className="navbar">
      <div className="logo">
        <div className="logo-icon">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="5 3 19 12 5 21 5 3"></polygon>
          </svg>
        </div>
        <span className="logo-text">Media<span>Flow</span></span>
      </div>
      <div className="nav-badge">v3.1 Turbo + Gotenberg (React)</div>
    </header>
  );
}
