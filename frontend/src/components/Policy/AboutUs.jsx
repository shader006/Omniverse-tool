import React, { useState } from 'react';
import PolicyModal from './PolicyModal';
import '../Policy/policy-modal.css';

const TABS = [
  { id: 'terms',   label: 'ĐIỀU KHOẢN',  labelEn: 'TERMS',   icon: '📋' },
  { id: 'privacy', label: 'BẢO MẬT',     labelEn: 'PRIVACY', icon: '🔒' },
  { id: 'fairuse', label: 'FAIR USE',     labelEn: 'FAIR USE',icon: '⚖️' },
];

const TOOL_LIST = [
  { icon: '🎵', name: 'URL → MP3/MP4',    desc: 'Tải nhạc & video từ YouTube, TikTok, Facebook' },
  { icon: '📄', name: 'File Converter',   desc: 'Chuyển Word/Excel/PPT sang PDF bằng Gotenberg v8' },
  { icon: '🎙️', name: 'Whisper AI',       desc: 'Nhận dạng giọng nói, xuất SRT/VTT/TXT/JSON' },
  { icon: '✂️', name: 'Remove BG',        desc: 'Xóa phông ảnh AI BiRefNet, xuất PNG trong suốt' },
  { icon: '🎮', name: 'Pixel Art Fixer',  desc: 'Khôi phục và tinh chỉnh pixel art bằng AI SOTA' },
];

export default function AboutUs({ lang = 'vi', onNavigateTools }) {
  const [activeTab, setActiveTab] = useState('terms');
  const [policyOpen, setPolicyOpen] = useState(false);
  const [policyType, setPolicyType] = useState('terms');

  const openPolicy = (type) => {
    setPolicyType(type);
    setPolicyOpen(true);
  };

  return (
    <div className="about-page">
      {/* Hero */}
      <section className="about-hero">
        <div className="about-hero-badge">ABOUT US</div>
        <h1 className="about-hero-title">
          <span style={{ color: '#22c55e' }}>OMNI</span>VERSE
        </h1>
        <p className="about-hero-desc">
          {lang === 'vi'
            ? 'Bộ công cụ đa phương tiện AI miễn phí – nhanh, riêng tư, không cần cài đặt'
            : 'Free AI multimedia toolkit – fast, private, no installation required'}
        </p>
      </section>

      <div className="about-content container">

        {/* Tools Grid */}
        <section className="about-section">
          <div className="about-section-label">
            {lang === 'vi' ? '▶ CÔNG CỤ' : '▶ TOOLS'}
          </div>
          <div className="about-tools-grid">
            {TOOL_LIST.map((t, i) => (
              <div key={i} className="about-tool-card">
                <span className="about-tool-icon">{t.icon}</span>
                <div>
                  <div className="about-tool-name">{t.name}</div>
                  <div className="about-tool-desc">{t.desc}</div>
                </div>
              </div>
            ))}
          </div>
          {onNavigateTools && (
            <button className="about-cta-btn" onClick={() => onNavigateTools()}>
              {lang === 'vi' ? 'Thử ngay →' : 'Try now →'}
            </button>
          )}
        </section>

        {/* Tech Stack */}
        <section className="about-section">
          <div className="about-section-label">
            {lang === 'vi' ? '▶ CÔNG NGHỆ' : '▶ TECH STACK'}
          </div>
          <div className="about-tech-list">
            {[
              ['⚛️', 'React 18 + Vite', 'Frontend SPA'],
              ['🐍', 'Python FastAPI', 'Backend API'],
              ['🤖', 'BiRefNet-Lite', 'AI Background Removal'],
              ['🎤', 'OpenAI Whisper', 'Speech Recognition'],
              ['📄', 'Gotenberg v8', 'Document Conversion'],
              ['🎞️', 'FFmpeg', 'Media Processing'],
              ['🔥', 'Firebase', 'Auth & Realtime DB'],
            ].map(([icon, name, role], i) => (
              <div key={i} className="about-tech-item">
                <span>{icon}</span>
                <strong>{name}</strong>
                <span className="about-tech-role">{role}</span>
              </div>
            ))}
          </div>
        </section>

        {/* Legal Policies */}
        <section className="about-section">
          <div className="about-section-label">
            {lang === 'vi' ? '▶ CHÍNH SÁCH & ĐIỀU KHOẢN' : '▶ LEGAL & POLICIES'}
          </div>

          {/* Tab bar */}
          <div className="policy-tabs">
            {TABS.map(tab => (
              <button
                key={tab.id}
                className={`policy-tab-btn${activeTab === tab.id ? ' active' : ''}`}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.icon} {lang === 'vi' ? tab.label : tab.labelEn}
              </button>
            ))}
          </div>

          {/* Policy preview cards */}
          {TABS.map(tab => activeTab === tab.id && (
            <div key={tab.id} className="about-policy-card">
              <div className="about-policy-card-icon">{tab.icon}</div>
              <div className="about-policy-card-content">
                <div className="about-policy-card-title">
                  {lang === 'vi'
                    ? { terms: 'Điều Khoản Sử Dụng', privacy: 'Chính Sách Bảo Mật', fairuse: 'Chính Sách Sử Dụng Công Bằng' }[tab.id]
                    : { terms: 'Terms of Service', privacy: 'Privacy Policy', fairuse: 'Fair Use Policy' }[tab.id]
                  }
                </div>
                <div className="about-policy-card-desc">
                  {lang === 'vi'
                    ? {
                      terms:   'Quy định về quyền và nghĩa vụ của người dùng, miễn trừ trách nhiệm bản quyền.',
                      privacy: 'Cách chúng tôi thu thập, sử dụng và bảo vệ dữ liệu cá nhân của bạn.',
                      fairuse: 'Giới hạn kỹ thuật và các mục đích sử dụng hợp pháp được chấp nhận.',
                    }[tab.id]
                    : {
                      terms:   'Rules on user rights and obligations, copyright disclaimer.',
                      privacy: 'How we collect, use and protect your personal data.',
                      fairuse: 'Technical limits and accepted legal use cases.',
                    }[tab.id]
                  }
                </div>
                <button className="about-policy-read-btn" onClick={() => openPolicy(tab.id)}>
                  {lang === 'vi' ? 'Đọc toàn bộ →' : 'Read full →'}
                </button>
              </div>
            </div>
          ))}
        </section>

        {/* Contact */}
        <section className="about-section about-contact">
          <div className="about-section-label">▶ CONTACT</div>
          <div className="about-contact-list">
            <div>📧 contact@omniversetool.online</div>
            <div>🌐 omniversetool.online</div>
            <div>📅 {lang === 'vi' ? 'Hiệu lực từ 01/10/2026' : 'Effective from 01/10/2026'}</div>
          </div>
        </section>

      </div>

      {/* Policy Modal */}
      <PolicyModal
        type={policyType}
        lang={lang}
        isOpen={policyOpen}
        onClose={() => setPolicyOpen(false)}
      />
    </div>
  );
}
