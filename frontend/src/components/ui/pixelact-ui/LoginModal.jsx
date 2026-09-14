import React, { useState } from 'react';
import { Button } from './button';
import './login-card.css';

export default function LoginModal({ isOpen, onClose, lang = 'vi' }) {
  const [activeTab, setActiveTab] = useState('login'); // 'login' | 'register'
  const [account, setAccount] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPass, setConfirmPass] = useState('');
  const [isSuccess, setIsSuccess] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = (e) => {
    e.preventDefault();
    setIsSuccess(true);
    setTimeout(() => {
      setIsSuccess(false);
      onClose();
    }, 1200);
  };

  return (
    <div className="pixel-modal-overlay" onClick={onClose}>
      <div className="pixel-login-card-container" onClick={(e) => e.stopPropagation()}>
        {/* Header Bar */}
        <div className="pixel-card-header">
          <div className="pixel-card-header-left">
            <span className="pixel-card-skull-icon">👾</span>
            <div className="pixel-tab-group">
              <button 
                type="button" 
                className={`pixel-tab-btn ${activeTab === 'login' ? 'active' : ''}`}
                onClick={() => setActiveTab('login')}
              >
                LOG IN
              </button>
              <button 
                type="button" 
                className={`pixel-tab-btn ${activeTab === 'register' ? 'active' : ''}`}
                onClick={() => setActiveTab('register')}
              >
                REGISTER
              </button>
            </div>
          </div>
          <button className="pixel-card-close-btn" onClick={onClose} title={lang === 'vi' ? 'Đóng' : 'Close'}>✕</button>
        </div>

        {/* Modal Body */}
        <form className="pixel-card-body" onSubmit={handleSubmit}>
          <h3 className="pixel-card-headline">
            {activeTab === 'login' 
              ? 'SIGN IN TO SETUP ONE-CLICK ACCESS' 
              : 'CREATE ACCOUNT FOR UNLIMITED ACCESS'}
          </h3>

          {/* Light input box (Box 1 from Sprite-0001.png) */}
          <div className="pixel-form-field">
            <input 
              type="text" 
              className="pixel-input-box-light" 
              placeholder={activeTab === 'login' ? "USERNAME OR EMAIL" : "CHOOSE USERNAME"}
              value={account}
              onChange={(e) => setAccount(e.target.value)}
              required
              autoFocus
            />
          </div>

          {/* Dark outlined input box (Box 2 from Sprite-0001.png) */}
          <div className="pixel-form-field">
            <input 
              type="password" 
              className="pixel-input-box-dark" 
              placeholder="PASSWORD"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          {activeTab === 'register' && (
            <div className="pixel-form-field">
              <input 
                type="password" 
                className="pixel-input-box-dark" 
                placeholder="CONFIRM PASSWORD"
                value={confirmPass}
                onChange={(e) => setConfirmPass(e.target.value)}
                required
              />
            </div>
          )}

          {/* Action buttons */}
          <div className="pixel-card-actions">
            <Button variant="green" size="lg" className="w-full" type="submit">
              {isSuccess ? '✓ ACCESS GRANTED!' : (activeTab === 'login' ? 'ENTER OMNIVERSE' : 'CREATE ACCOUNT')}
            </Button>
            <button type="button" className="pixel-btn-skip" onClick={onClose}>
              SKIP FOR NOW
            </button>
          </div>

          {/* Footer legal text */}
          <p className="pixel-card-footer-note">
            By using you agree to our <a href="#terms">Terms of Service</a> and our <a href="#privacy">Privacy Policy</a>.
          </p>
        </form>
      </div>
    </div>
  );
}
