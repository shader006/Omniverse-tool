import React, { useState } from 'react';
import { Button } from './button';
import { useAuth } from '../../../hooks/useAuth';
import './login-card.css';

// ─── Firebase error codes → thông báo thân thiện ─────────────────────────────
const FIREBASE_ERRORS = {
  'auth/user-not-found':        'Không tìm thấy tài khoản này.',
  'auth/wrong-password':        'Mật khẩu không đúng. Vui lòng thử lại.',
  'auth/invalid-credential':    'Email hoặc mật khẩu không đúng.',
  'auth/email-already-in-use':  'Email này đã được đăng ký. Hãy đăng nhập.',
  'auth/weak-password':         'Mật khẩu phải có ít nhất 6 ký tự.',
  'auth/invalid-email':         'Địa chỉ email không hợp lệ.',
  'auth/too-many-requests':     'Quá nhiều lần thử. Vui lòng thử lại sau ít phút.',
  'auth/popup-closed-by-user':  'Đã hủy đăng nhập.',
  'auth/account-exists-with-different-credential':
                                'Email này đã được liên kết với phương thức đăng nhập khác.',
  'auth/network-request-failed':'Lỗi kết nối mạng. Kiểm tra internet và thử lại.',
};

function parseFirebaseError(err) {
  if (!err) return 'Đã xảy ra lỗi. Vui lòng thử lại.';
  if (err.code && FIREBASE_ERRORS[err.code]) return FIREBASE_ERRORS[err.code];
  return err.message || 'Đã xảy ra lỗi không xác định.';
}

// ─── SVG Icons ───────────────────────────────────────────────────────────────

const GoogleIcon = () => (
  <svg className="pixel-btn-oauth-icon" viewBox="0 0 24 24" fill="none">
    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
  </svg>
);

const GitHubIcon = () => (
  <svg className="pixel-btn-oauth-icon" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/>
  </svg>
);

// ─── Component chính ──────────────────────────────────────────────────────────

export default function LoginModal({ isOpen, onClose, lang = 'vi' }) {
  const { loginEmail, loginGoogle, loginGitHub, loginDemo, register, isFirebaseConfigured } = useAuth();

  const [activeTab, setActiveTab]     = useState('login');
  const [email, setEmail]             = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword]       = useState('');
  const [confirmPass, setConfirmPass] = useState('');
  const [error, setError]             = useState('');
  const [loading, setLoading]         = useState(false);
  const [oauthLoading, setOauthLoading] = useState(null); // 'google' | 'github' | null
  const [isSuccess, setIsSuccess]     = useState(false);

  if (!isOpen) return null;

  // ── Reset form khi chuyển tab ──────────────────────────────
  const switchTab = (tab) => {
    setActiveTab(tab);
    setError('');
    setEmail('');
    setPassword('');
    setConfirmPass('');
    setDisplayName('');
  };

  // ── Hiển thị thành công rồi đóng modal ────────────────────
  const handleSuccess = () => {
    setIsSuccess(true);
    setTimeout(() => {
      setIsSuccess(false);
      onClose();
    }, 600);
  };

  // ── Submit Email/Password ──────────────────────────────────
  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    // Validate trước khi gửi
    if (activeTab === 'register') {
      if (password !== confirmPass) {
        setError('Mật khẩu xác nhận không khớp.');
        return;
      }
      if (password.length < 6) {
        setError('Mật khẩu phải có ít nhất 6 ký tự.');
        return;
      }
    }

    setLoading(true);
    try {
      if (activeTab === 'login') {
        await loginEmail(email, password);
      } else {
        await register(email, password, displayName);
      }
      handleSuccess();
    } catch (err) {
      setError(parseFirebaseError(err));
    } finally {
      setLoading(false);
    }
  };

  // ── OAuth: Google ──────────────────────────────────────────
  const handleGoogle = async () => {
    setError('');
    if (!isFirebaseConfigured) {
      setError('Firebase chưa được cấu hình API Key trong file .env (VITE_FIREBASE_API_KEY). Bạn có thể bấm nút "Đăng nhập Test" bên dưới để dùng thử!');
      return;
    }
    setOauthLoading('google');
    try {
      await loginGoogle();
      handleSuccess();
    } catch (err) {
      if (err.code !== 'auth/popup-closed-by-user') {
        setError(parseFirebaseError(err));
      }
    } finally {
      setOauthLoading(null);
    }
  };

  // ── OAuth: GitHub ──────────────────────────────────────────
  const handleGitHub = async () => {
    setError('');
    if (!isFirebaseConfigured) {
      setError('Firebase chưa được cấu hình API Key trong file .env (VITE_FIREBASE_API_KEY). Bạn có thể bấm nút "Đăng nhập Test" bên dưới để dùng thử!');
      return;
    }
    setOauthLoading('github');
    try {
      await loginGitHub();
      handleSuccess();
    } catch (err) {
      if (err.code !== 'auth/popup-closed-by-user') {
        setError(parseFirebaseError(err));
      }
    } finally {
      setOauthLoading(null);
    }
  };

  return (
    <div className="pixel-modal-overlay" onClick={onClose}>
      <div className="pixel-login-card-container" onClick={(e) => e.stopPropagation()}>

        {/* ── Header Bar ── */}
        <div className="pixel-card-header">
          <div className="pixel-card-header-left">
            <span className="pixel-card-skull-icon">👾</span>
            <div className="pixel-tab-group">
              <button
                type="button"
                className={`pixel-tab-btn ${activeTab === 'login' ? 'active' : ''}`}
                onClick={() => switchTab('login')}
                disabled={loading}
              >
                LOG IN
              </button>
              <button
                type="button"
                className={`pixel-tab-btn ${activeTab === 'register' ? 'active' : ''}`}
                onClick={() => switchTab('register')}
                disabled={loading}
              >
                REGISTER
              </button>
            </div>
          </div>
          <button
            className="pixel-card-close-btn"
            onClick={onClose}
            disabled={loading}
            title={lang === 'vi' ? 'Đóng' : 'Close'}
          >
            ✕
          </button>
        </div>

        {/* ── Modal Body ── */}
        <form className="pixel-card-body" onSubmit={handleSubmit} noValidate>
          <h3 className="pixel-card-headline">
            {activeTab === 'login'
              ? 'SIGN IN TO SETUP ONE-CLICK ACCESS'
              : 'CREATE ACCOUNT FOR UNLIMITED ACCESS'}
          </h3>

          {!isFirebaseConfigured && (
            <div style={{
              background: '#1a1f2c',
              border: '2px solid #eab308',
              padding: '12px 14px',
              marginBottom: '16px',
              fontFamily: "'Press Start 2P', monospace",
              textAlign: 'left'
            }}>
              <div style={{ color: '#facc15', fontSize: '0.62rem', lineHeight: '1.6', marginBottom: '8px' }}>
                ⚠️ CHƯA CẤU HÌNH FIREBASE API KEY TRONG FILE .env
              </div>
              <div style={{ color: '#94a3b8', fontSize: '0.52rem', lineHeight: '1.5', marginBottom: '10px' }}>
                Để đăng nhập Google thật, hãy thêm VITE_FIREBASE_API_KEY vào .env. Hiện tại bạn có thể đăng nhập thử nghiệm ngay bên dưới:
              </div>
              <button
                type="button"
                onClick={() => {
                  loginDemo();
                  handleSuccess();
                }}
                style={{
                  background: '#22c55e',
                  color: '#052e16',
                  border: '2px solid #15803d',
                  padding: '8px 12px',
                  fontFamily: "'Press Start 2P', monospace",
                  fontSize: '0.62rem',
                  cursor: 'pointer',
                  boxShadow: '2px 2px 0 #000',
                  fontWeight: 'bold',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px'
                }}
              >
                🎮 ĐĂNG NHẬP TEST (DEMO USER)
              </button>
            </div>
          )}
          {/* OAuth Buttons */}
          <div className="pixel-oauth-group">
            <button
              type="button"
              className={`pixel-btn-oauth pixel-btn-oauth--google${oauthLoading === 'google' ? ' pixel-btn-oauth--loading' : ''}`}
              onClick={handleGoogle}
              disabled={loading || oauthLoading !== null}
            >
              {oauthLoading === 'google' ? (
                <span className="pixel-oauth-spinner" />
              ) : (
                <GoogleIcon />
              )}
              {oauthLoading === 'google' ? 'CONNECTING...' : 'Continue with Google'}
            </button>
            <button
              type="button"
              className={`pixel-btn-oauth pixel-btn-oauth--github${oauthLoading === 'github' ? ' pixel-btn-oauth--loading' : ''}`}
              onClick={handleGitHub}
              disabled={loading || oauthLoading !== null}
            >
              {oauthLoading === 'github' ? (
                <span className="pixel-oauth-spinner" />
              ) : (
                <GitHubIcon />
              )}
              {oauthLoading === 'github' ? 'CONNECTING...' : 'Continue with GitHub'}
            </button>
          </div>

          {/* Divider */}
          <div className="pixel-divider">
            <span className="pixel-divider-line" />
            <span className="pixel-divider-text">OR</span>
            <span className="pixel-divider-line" />
          </div>

          {/* Display Name (chỉ khi register) */}
          {activeTab === 'register' && (
            <div className="pixel-form-field">
              <input
                type="text"
                className="pixel-input-box-light"
                placeholder="DISPLAY NAME"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                disabled={loading}
                autoFocus
              />
            </div>
          )}

          {/* Email */}
          <div className="pixel-form-field">
            <input
              type="email"
              className="pixel-input-box-light"
              placeholder="EMAIL ADDRESS"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus={activeTab === 'login'}
              disabled={loading}
              autoComplete="email"
            />
          </div>

          {/* Password */}
          <div className="pixel-form-field">
            <input
              type="password"
              className="pixel-input-box-dark"
              placeholder="PASSWORD"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              disabled={loading}
              autoComplete={activeTab === 'login' ? 'current-password' : 'new-password'}
            />
          </div>

          {/* Confirm Password (chỉ khi register) */}
          {activeTab === 'register' && (
            <div className="pixel-form-field">
              <input
                type="password"
                className="pixel-input-box-dark"
                placeholder="CONFIRM PASSWORD"
                value={confirmPass}
                onChange={(e) => setConfirmPass(e.target.value)}
                required
                disabled={loading}
                autoComplete="new-password"
              />
            </div>
          )}

          {/* Error Banner */}
          {error && (
            <div className="pixel-error-banner" role="alert">
              ⚠ {error}
            </div>
          )}

          {/* Action Buttons */}
          <div className="pixel-card-actions">
            <Button
              variant="green"
              size="lg"
              className={`w-full${loading ? ' pixel-btn-loading' : ''}`}
              type="submit"
              disabled={loading}
            >
              {isSuccess
                ? '✓ ACCESS GRANTED!'
                : loading
                  ? 'PROCESSING...'
                  : activeTab === 'login'
                    ? 'ENTER OMNIVERSE'
                    : 'CREATE ACCOUNT'}
            </Button>
            <button
              type="button"
              className="pixel-btn-skip"
              onClick={onClose}
              disabled={loading}
            >
              SKIP FOR NOW
            </button>
          </div>

          {/* Footer */}
          <p className="pixel-card-footer-note">
            By using you agree to our <a href="#terms">Terms of Service</a> and our <a href="#privacy">Privacy Policy</a>.
          </p>
        </form>
      </div>
    </div>
  );
}
