import React, { useState, useEffect } from 'react';
import { useAuth } from '../../hooks/useAuth';
import './settings-modal.css';

export default function SettingsModal({ isOpen, onClose, lang = 'vi', onSelectLang, theme = 'dark', onSelectTheme }) {
  const { user, backendUser, updateDisplayName } = useAuth();

  const currentDisplayName = user?.displayName || user?.email?.split('@')[0] || (lang === 'vi' ? 'Khách' : 'Guest');
  const [newName, setNewName] = useState(currentDisplayName);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState({ type: '', message: '' });

  // Cập nhật giá trị input khi mở modal hoặc khi tên đổi
  useEffect(() => {
    if (isOpen) {
      setNewName(currentDisplayName);
      setStatus({ type: '', message: '' });
    }
  }, [isOpen, currentDisplayName]);

  // Đóng bằng phím Escape
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isOpen) onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
    if (e) e.preventDefault();
    const trimmed = newName.trim();

    if (!trimmed) {
      setStatus({
        type: 'error',
        message: lang === 'vi' ? 'Vui lòng nhập tên tài khoản hợp lệ.' : 'Please enter a valid account name.',
      });
      return;
    }

    if (trimmed.length < 2 || trimmed.length > 50) {
      setStatus({
        type: 'error',
        message: lang === 'vi' ? 'Tên phải có độ dài từ 2 đến 50 ký tự.' : 'Name length must be between 2 and 50 characters.',
      });
      return;
    }

    setLoading(true);
    setStatus({ type: '', message: '' });

    try {
      await updateDisplayName(trimmed);
      setStatus({
        type: 'success',
        message: lang === 'vi' 
          ? `Đã đổi tên tài khoản thành "${trimmed}" thành công!` 
          : `Account name successfully updated to "${trimmed}"!`,
      });
    } catch (err) {
      setStatus({
        type: 'error',
        message: err.message || (lang === 'vi' ? 'Lỗi khi cập nhật tên.' : 'Failed to update name.'),
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="pixel-settings-overlay" onClick={onClose}>
      <div className="pixel-settings-card" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="pixel-settings-header">
          <div className="pixel-settings-title-group">
            <span className="pixel-settings-gear-icon">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3"></circle>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
              </svg>
            </span>
            <h3 className="pixel-settings-title">
              {lang === 'vi' ? 'CÀI ĐẶT' : 'SETTINGS'}
            </h3>
          </div>
          <button type="button" className="pixel-settings-close-btn" onClick={onClose} title="Đóng">
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="pixel-settings-body">
          {/* Thông tin hồ sơ người dùng */}
          <div className="pixel-user-profile-banner">
            <div className="pixel-avatar-box">
              {user?.photoURL ? (
                <img src={user.photoURL} alt="" className="pixel-avatar-img" referrerPolicy="no-referrer" />
              ) : (
                <span className="pixel-avatar-initial">{currentDisplayName.charAt(0).toUpperCase()}</span>
              )}
              <span className="pixel-avatar-dot" />
            </div>
            <div className="pixel-profile-info">
              <div className="pixel-profile-name-row">
                <span className="pixel-profile-name">{currentDisplayName}</span>
                <span className="pixel-profile-badge">
                  {user ? (backendUser?.id ? 'ONLINE' : 'ACTIVE') : 'GUEST'}
                </span>
              </div>
              <p className="pixel-profile-email">
                {user?.email || (lang === 'vi' ? 'Chưa đăng nhập' : 'Not signed in')}
                {backendUser?.id ? ` • ID: ${backendUser.id.substring(0, 8)}...` : ''}
              </p>
            </div>
          </div>

          {/* Form đổi tên tài khoản */}
          <form className="pixel-settings-section" onSubmit={handleSubmit}>
            <h4 className="pixel-section-heading">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
              </svg>
              {lang === 'vi' ? 'Đổi Tên Tài Khoản' : 'Change Display Name'}
            </h4>

            <div className="pixel-form-group">
              <label className="pixel-input-label">
                <span>{lang === 'vi' ? 'Tên hiển thị mới' : 'New display name'}:</span>
                <span style={{ fontSize: '0.7rem', color: '#64748b' }}>{newName.length}/50</span>
              </label>
              <input
                type="text"
                className="pixel-input-field"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder={lang === 'vi' ? 'Nhập tên mới của bạn...' : 'Enter your new name...'}
                maxLength={50}
                disabled={loading}
                autoFocus
              />
            </div>

            {/* Thông báo kết quả */}
            {status.message && (
              <div className={`pixel-alert pixel-alert--${status.type}`} style={{ marginTop: '12px' }}>
                {status.type === 'success' ? '✅ ' : '⚠️ '}
                {status.message}
              </div>
            )}

            {/* Nút submit */}
            <button
              type="submit"
              className="pixel-submit-btn"
              disabled={loading || newName.trim() === currentDisplayName}
            >
              {loading ? (
                <span>⏳ {lang === 'vi' ? 'ĐANG CẬP NHẬT...' : 'SAVING...'}</span>
              ) : (
                <span>💾 {lang === 'vi' ? 'LƯU THAY ĐỔI' : 'SAVE CHANGES'}</span>
              )}
            </button>
          </form>

          {/* Section: Ngôn ngữ hiển thị */}
          <div className="pixel-settings-section" style={{ marginTop: '16px' }}>
            <h4 className="pixel-section-heading">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="2" y1="12" x2="22" y2="12"></line>
                <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
              </svg>
              {lang === 'vi' ? 'Ngôn Ngữ' : 'Language'}
            </h4>

            <div className="pixel-lang-options-grid">
              <button
                type="button"
                className={`pixel-lang-choice-btn ${lang === 'vi' ? 'active' : ''}`}
                onClick={() => onSelectLang && onSelectLang('vi')}
              >
                <span className="pixel-lang-choice-flag">🇻🇳</span>
                <div className="pixel-lang-choice-text">
                  <span className="pixel-lang-choice-title">Tiếng Việt</span>
                  <span className="pixel-lang-choice-sub">{lang === 'vi' ? 'Mặc định' : 'Default'}</span>
                </div>
                {lang === 'vi' && <span className="pixel-lang-check">✔</span>}
              </button>

              <button
                type="button"
                className={`pixel-lang-choice-btn ${lang === 'en' ? 'active' : ''}`}
                onClick={() => onSelectLang && onSelectLang('en')}
              >
                <span className="pixel-lang-choice-flag">🇬🇧</span>
                <div className="pixel-lang-choice-text">
                  <span className="pixel-lang-choice-title">English</span>
                  <span className="pixel-lang-choice-sub">{lang === 'vi' ? 'Quốc tế' : 'International'}</span>
                </div>
                {lang === 'en' && <span className="pixel-lang-check">✔</span>}
              </button>
            </div>
          </div>

          {/* Section: Giao diện Sáng / Tối */}
          <div className="pixel-settings-section" style={{ marginTop: '16px' }}>
            <h4 className="pixel-section-heading">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="5"></circle>
                <line x1="12" y1="1" x2="12" y2="3"></line>
                <line x1="12" y1="21" x2="12" y2="23"></line>
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
                <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
                <line x1="1" y1="12" x2="3" y2="12"></line>
                <line x1="21" y1="12" x2="23" y2="12"></line>
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
                <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
              </svg>
              {lang === 'vi' ? 'Giao Diện' : 'Theme'}
            </h4>

            <div className="pixel-lang-options-grid">
              <button
                type="button"
                className={`pixel-lang-choice-btn ${theme === 'dark' ? 'active' : ''}`}
                onClick={() => onSelectTheme && onSelectTheme('dark')}
              >
                <span className="pixel-lang-choice-flag">🌙</span>
                <div className="pixel-lang-choice-text">
                  <span className="pixel-lang-choice-title">{lang === 'vi' ? 'Chế độ Tối' : 'Dark Mode'}</span>
                  <span className="pixel-lang-choice-sub">{lang === 'vi' ? 'Mặc định' : 'Default'}</span>
                </div>
                {theme === 'dark' && <span className="pixel-lang-check">✔</span>}
              </button>

              <button
                type="button"
                className={`pixel-lang-choice-btn ${theme === 'light' ? 'active' : ''}`}
                onClick={() => onSelectTheme && onSelectTheme('light')}
              >
                <span className="pixel-lang-choice-flag">☀️</span>
                <div className="pixel-lang-choice-text">
                  <span className="pixel-lang-choice-title">{lang === 'vi' ? 'Chế độ Sáng' : 'Light Mode'}</span>
                  <span className="pixel-lang-choice-sub">{lang === 'vi' ? 'Tươi sáng' : 'Clean Light'}</span>
                </div>
                {theme === 'light' && <span className="pixel-lang-check">✔</span>}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
