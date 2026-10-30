import React, { useState, useEffect } from 'react';
import Logo from './components/Logo';
import Devices from './components/Devices';
import FloorBackground from './components/FloorBackground';
import GridBackground from './components/GridBackground';
import FoxFact from './components/FoxFact';

export default function App() {
  const [theme, setTheme] = useState('dark');
  const [activeTab, setActiveTab] = useState('url'); // 'url' | 'pdf' | 'whisper' | 'rmbg' | 'upscale'
  
  // Interactive Simulator States
  const [urlInput, setUrlInput] = useState('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  const [format, setFormat] = useState('mp4');
  const [quality, setQuality] = useState('1080p');
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [simResult, setSimResult] = useState(null);

  // PDF simulator state
  const [pdfDocType, setPdfDocType] = useState('docx');
  const [isLandscape, setIsLandscape] = useState(false);

  // Whisper simulator state
  const [whisperModel, setWhisperModel] = useState('large-v3');
  const [audioLang, setAudioLang] = useState('auto');

  // Sync theme with html attribute
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme(prev => (prev === 'dark' ? 'light' : 'dark'));
  };

  // Run simulation
  const handleRunTask = () => {
    setIsProcessing(true);
    setProgress(0);
    setSimResult(null);

    const interval = setInterval(() => {
      setProgress(prev => {
        if (prev >= 100) {
          clearInterval(interval);
          setIsProcessing(false);
          if (activeTab === 'url') {
            setSimResult({
              type: 'url',
              title: 'Never Gonna Give You Up - Rick Astley (Official Music Video)',
              channel: 'Rick Astley Official',
              duration: '03:32',
              size: format === 'mp4' ? '48.2 MB' : '8.4 MB',
              fileUrl: '#download-ready'
            });
          } else if (activeTab === 'pdf') {
            setSimResult({
              type: 'pdf',
              title: `Bao_Cao_De_Tai_Nhom_1.${pdfDocType}.pdf`,
              pages: 18,
              standard: 'PDF/A-1b ISO 19005-1',
              size: '2.4 MB'
            });
          } else if (activeTab === 'whisper') {
            setSimResult({
              type: 'whisper',
              detectedLang: 'Vietnamese (vi) - 99.4% confidence',
              segments: [
                { start: '00:00.000', end: '00:02.400', text: 'Chào mừng các bạn đến với hệ thống Omniverse AI.' },
                { start: '00:02.500', end: '00:05.100', text: 'Mô hình Whisper AI bóc tách phụ đề thời gian thực cực kỳ chính xác.' },
                { start: '00:05.200', end: '00:08.300', text: 'Hỗ trợ xuất định dạng SRT, VTT và phân đoạn mốc thời gian chi tiết.' }
              ]
            });
          } else if (activeTab === 'rmbg') {
            setSimResult({
              type: 'rmbg',
              model: 'RMBG-1.4 / BiRefNet High-Resolution',
              resolution: '2048 x 1536 px',
              status: 'Tách nền thành công với kênh Alpha 32-bit'
            });
          } else if (activeTab === 'upscale') {
            setSimResult({
              type: 'upscale',
              model: 'RealPLKSR / Real-ESRGAN 4x',
              upscaleFactor: '400%',
              dimensions: '1920x1080 ➔ 7680x4320 (4K/8K AI Detail)',
              status: 'Khôi phục độ nét siêu phân giải hoàn tất'
            });
          }
          return 100;
        }
        return prev + 25;
      });
    }, 280);
  };

  return (
    <div className="rn-page-wrapper">
      {/* ==================== NAVBAR ==================== */}
      <header className="rn-navbar">
        <div className="rn-nav-left">
          <a href="#home" className="rn-brand">
            <div className="rn-brand-logo">
              <Logo />
            </div>
            <span>Omniverse</span>
          </a>
          <nav>
            <ul className="rn-nav-links">
              <li><a href="#workbench" className="rn-nav-link active">Công cụ Live</a></li>
              <li><a href="#features" className="rn-nav-link">Tính năng AI</a></li>
              <li><a href="#architecture" className="rn-nav-link">Kiến trúc Đối tượng</a></li>
              <li><a href="#ecosystem" className="rn-nav-link">Hạ tầng Microservice</a></li>
              <li><a href="#team" className="rn-nav-link">Nhóm Đề Tài</a></li>
            </ul>
          </nav>
        </div>

        <div className="rn-nav-right">
          <div className="rn-search-box" onClick={() => alert('Omniverse AI Search: Tìm kiếm các tài liệu, công cụ và đặc tả API.')}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8"></circle>
              <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
            </svg>
            <span>Tìm kiếm tài liệu...</span>
            <span className="rn-search-kbd">Ctrl K</span>
          </div>

          <button 
            className="rn-theme-toggle" 
            onClick={toggleTheme} 
            title={`Chuyển sang chế độ ${theme === 'dark' ? 'sáng' : 'tối'}`}
          >
            {theme === 'dark' ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
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
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
              </svg>
            )}
          </button>

          <a 
            href="https://github.com/shader006/Omniverse-tool" 
            target="_blank" 
            rel="noopener noreferrer" 
            className="rn-github-btn"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/>
            </svg>
            <span>Star 1.2k</span>
          </a>
        </div>
      </header>

      {/* ==================== HERO SECTION (REACT NATIVE ISOMETRIC 3D) ==================== */}
      <section id="home" className="rn-hero-container">
        <div className="rn-hero-bg-layer">
          <div className="rn-hero-grid">
            <GridBackground />
          </div>
          <div className="rn-hero-devices">
            <Devices />
          </div>
          <div className="rn-hero-floor">
            <FloorBackground />
          </div>
        </div>

        <div className="rn-hero-content">
          <div className="rn-hero-badge">
            <span style={{ fontSize: '14px' }}>⚡</span>
            <span>NHÓM 1 · ONIVERSE - MULTI MEDIA & AI TOOLS v2.0</span>
          </div>

          <h1 className="rn-hero-title">
            <span>Omniverse</span> Multi Media
          </h1>

          <h2 className="rn-hero-subtitle">
            Learn once, process anything.
          </h2>

          <p className="rn-hero-desc">
            Nền tảng trực tuyến All-in-One xử lý đa phương tiện và trí tuệ nhân tạo thế hệ mới.
            Tải media tốc độ cao từ mạng xã hội, chuyển đổi PDF Gotenberg v8 chuẩn văn phòng,
            bóc tách phụ đề giọng nói Whisper AI và xóa phông hình ảnh thông minh.
          </p>

          <div className="rn-hero-buttons">
            <a href="#workbench" className="rn-btn-primary">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polygon points="5 3 19 12 5 21 5 3"></polygon>
              </svg>
              <span>Trải Nghiệm Live Playground</span>
            </a>
            <a href="#architecture" className="rn-btn-secondary">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                <polyline points="14 2 14 8 20 8"></polyline>
                <line x1="16" y1="13" x2="8" y2="13"></line>
                <line x1="16" y1="17" x2="8" y2="17"></line>
              </svg>
              <span>Đặc Tả Đối Tượng & Kiến Trúc</span>
            </a>
          </div>
        </div>
      </section>

      {/* ==================== INTERACTIVE WORKBENCH (PLATFORMS STYLE) ==================== */}
      <section id="workbench" className="rn-section rn-section-border-top">
        <div className="rn-section-header">
          <div className="rn-section-tag">Interactive Playground</div>
          <h2 className="rn-section-title">
            Trải nghiệm các tác vụ xử lý trực tiếp trên giao diện
          </h2>
          <p className="rn-section-desc">
            Kiến trúc hướng đối tượng của Omniverse gói gọn mọi quy trình chuyển đổi phức tạp
            thành các API tinh gọn và giao diện tương tác phản hồi tức thời.
          </p>
        </div>

        <div className="rn-workbench-container">
          <div className="rn-workbench-grid">
            {/* Left: Code Editor */}
            <div className="rn-code-window">
              <div className="rn-code-header">
                <div className="rn-code-dots">
                  <div className="rn-dot rn-dot-red"></div>
                  <div className="rn-dot rn-dot-yellow"></div>
                  <div className="rn-dot rn-dot-green"></div>
                </div>
                <div className="rn-code-title">
                  {activeTab === 'url' && 'download_job.go'}
                  {activeTab === 'pdf' && 'convert_doc_task.ts'}
                  {activeTab === 'whisper' && 'whisper_inference.py'}
                  {activeTab === 'rmbg' && 'rmbg_client.js'}
                  {activeTab === 'upscale' && 'super_resolution.py'}
                </div>
                <span style={{ fontSize: '12px', color: 'var(--home-secondary-text)' }}>UTF-8</span>
              </div>

              <div className="rn-code-body">
                {activeTab === 'url' && (
                  <pre>
                    <code>
<span style={{ color: 'var(--home-code-purple)' }}>package</span> main<br/><br/>
<span style={{ color: 'var(--home-code-purple)' }}>type</span> <span style={{ color: 'var(--home-code-yellow)' }}>DownloadTask</span> <span style={{ color: 'var(--home-code-purple)' }}>struct</span> &#123;<br/>
&nbsp;&nbsp;JobId&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<span style={{ color: 'var(--home-code-blue)' }}>string</span>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`json:"job_id"`<br/>
&nbsp;&nbsp;SourceUrl&nbsp;&nbsp;&nbsp;&nbsp;<span style={{ color: 'var(--home-code-blue)' }}>string</span>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`json:"source_url"`<br/>
&nbsp;&nbsp;Format&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<span style={{ color: 'var(--home-code-blue)' }}>string</span>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`json:"format"`<br/>
&nbsp;&nbsp;QualityPreset&nbsp;<span style={{ color: 'var(--home-code-blue)' }}>string</span>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`json:"quality"`<br/>
&#125;<br/><br/>
<span style={{ color: 'var(--home-code-purple)' }}>func</span> (<span style={{ color: 'var(--home-code-red)' }}>t</span> *<span style={{ color: 'var(--home-code-yellow)' }}>DownloadTask</span>) <span style={{ color: 'var(--home-code-blue)' }}>Execute</span>() <span style={{ color: 'var(--home-code-blue)' }}>error</span> &#123;<br/>
&nbsp;&nbsp;<span style={{ color: 'var(--home-secondary-text)' }}>// Phân giải stream yt-dlp và muxing ffmpeg</span><br/>
&nbsp;&nbsp;meta := t.<span style={{ color: 'var(--home-code-blue)' }}>FetchMetadata</span>()<br/>
&nbsp;&nbsp;<span style={{ color: 'var(--home-code-purple)' }}>return</span> t.<span style={{ color: 'var(--home-code-blue)' }}>Transcode</span>(meta, t.QualityPreset)<br/>
&#125;
                    </code>
                  </pre>
                )}

                {activeTab === 'pdf' && (
                  <pre>
                    <code>
<span style={{ color: 'var(--home-code-purple)' }}>import</span> &#123; GotenbergEngine &#125; <span style={{ color: 'var(--home-code-purple)' }}>from</span> <span style={{ color: 'var(--home-code-green)' }}>'@omniverse/gotenberg'</span>;<br/><br/>
<span style={{ color: 'var(--home-code-purple)' }}>export class</span> <span style={{ color: 'var(--home-code-yellow)' }}>ConvertDocTask</span> <span style={{ color: 'var(--home-code-purple)' }}>extends</span> <span style={{ color: 'var(--home-code-yellow)' }}>MediaJob</span> &#123;<br/>
&nbsp;&nbsp;<span style={{ color: 'var(--home-code-purple)' }}>async</span> <span style={{ color: 'var(--home-code-blue)' }}>execute</span>(file: <span style={{ color: 'var(--home-code-yellow)' }}>File</span>): <span style={{ color: 'var(--home-code-yellow)' }}>Promise</span>&lt;<span style={{ color: 'var(--home-code-yellow)' }}>Blob</span>&gt; &#123;<br/>
&nbsp;&nbsp;&nbsp;&nbsp;<span style={{ color: 'var(--home-code-purple)' }}>const</span> engine = <span style={{ color: 'var(--home-code-purple)' }}>new</span> <span style={{ color: 'var(--home-code-yellow)' }}>GotenbergEngine</span>();<br/>
&nbsp;&nbsp;&nbsp;&nbsp;<span style={{ color: 'var(--home-code-purple)' }}>return await</span> engine.<span style={{ color: 'var(--home-code-blue)' }}>libreOfficeToPdf</span>(&#123;<br/>
&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;files: [file],<br/>
&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;pdfaStandard: <span style={{ color: 'var(--home-code-green)' }}>'PDF/A-1b'</span>,<br/>
&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;landscape: <span style={{ color: 'var(--home-code-red)' }}>{isLandscape ? 'true' : 'false'}</span><br/>
&nbsp;&nbsp;&nbsp;&nbsp;&#125;);<br/>
&nbsp;&nbsp;&#125;<br/>
&#125;
                    </code>
                  </pre>
                )}

                {activeTab === 'whisper' && (
                  <pre>
                    <code>
<span style={{ color: 'var(--home-code-purple)' }}>import</span> whisper<br/>
<span style={{ color: 'var(--home-code-purple)' }}>from</span> dataclasses <span style={{ color: 'var(--home-code-purple)' }}>import</span> dataclass<br/><br/>
<span style={{ color: 'var(--home-code-yellow)' }}>@dataclass</span><br/>
<span style={{ color: 'var(--home-code-purple)' }}>class</span> <span style={{ color: 'var(--home-code-yellow)' }}>TranscribeTask</span>:<br/>
&nbsp;&nbsp;&nbsp;&nbsp;model_name: <span style={{ color: 'var(--home-code-blue)' }}>str</span> = <span style={{ color: 'var(--home-code-green)' }}>"{whisperModel}"</span><br/>
&nbsp;&nbsp;&nbsp;&nbsp;audio_path: <span style={{ color: 'var(--home-code-blue)' }}>str</span> = <span style={{ color: 'var(--home-code-green)' }}>"stream_mono_16khz.wav"</span><br/><br/>
&nbsp;&nbsp;&nbsp;&nbsp;<span style={{ color: 'var(--home-code-purple)' }}>def</span> <span style={{ color: 'var(--home-code-blue)' }}>run_inference</span>(self):<br/>
&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;model = whisper.load_model(self.model_name)<br/>
&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;result = model.transcribe(self.audio_path)<br/>
&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<span style={{ color: 'var(--home-code-purple)' }}>return</span> result[<span style={{ color: 'var(--home-code-green)' }}>"segments"</span>]
                    </code>
                  </pre>
                )}

                {activeTab === 'rmbg' && (
                  <pre>
                    <code>
<span style={{ color: 'var(--home-secondary-text)' }}>// Xóa phông nền BiRefNet / RMBG-1.4</span><br/>
<span style={{ color: 'var(--home-code-purple)' }}>export async function</span> <span style={{ color: 'var(--home-code-blue)' }}>removeBackground</span>(imgElement) &#123;<br/>
&nbsp;&nbsp;<span style={{ color: 'var(--home-code-purple)' }}>const</span> session = <span style={{ color: 'var(--home-code-purple)' }}>await</span> ort.InferenceSession.<span style={{ color: 'var(--home-code-blue)' }}>create</span>(<br/>
&nbsp;&nbsp;&nbsp;&nbsp;<span style={{ color: 'var(--home-code-green)' }}>'/models/rmbg-1.4.onnx'</span><br/>
&nbsp;&nbsp;);<br/>
&nbsp;&nbsp;<span style={{ color: 'var(--home-code-purple)' }}>const</span> mask = <span style={{ color: 'var(--home-code-purple)' }}>await</span> session.<span style={{ color: 'var(--home-code-blue)' }}>run</span>(&#123; input: tensor &#125;);<br/>
&nbsp;&nbsp;<span style={{ color: 'var(--home-code-purple)' }}>return</span> applyAlphaMatte(imgElement, mask);<br/>
&#125;
                    </code>
                  </pre>
                )}

                {activeTab === 'upscale' && (
                  <pre>
                    <code>
<span style={{ color: 'var(--home-secondary-text)' }}>// Phục chế ảnh & Siêu phân giải RealPLKSR</span><br/>
<span style={{ color: 'var(--home-code-purple)' }}>class</span> <span style={{ color: 'var(--home-code-yellow)' }}>PixelUpscaler</span>:<br/>
&nbsp;&nbsp;&nbsp;&nbsp;<span style={{ color: 'var(--home-code-purple)' }}>def</span> <span style={{ color: 'var(--home-code-blue)' }}>enhance</span>(self, image_tensor, scale=4):<br/>
&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;with torch.no_grad():<br/>
&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;sr = self.model(image_tensor)<br/>
&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<span style={{ color: 'var(--home-code-purple)' }}>return</span> clamp_to_rgb(sr)
                    </code>
                  </pre>
                )}
              </div>
            </div>

            {/* Right: Interactive Simulator */}
            <div className="rn-sim-window">
              <div className="rn-sim-header">
                <button 
                  className={`rn-tool-tab ${activeTab === 'url' ? 'active' : ''}`}
                  onClick={() => { setActiveTab('url'); setSimResult(null); }}
                >
                  <span>🔗</span> Tải Media
                </button>
                <button 
                  className={`rn-tool-tab ${activeTab === 'pdf' ? 'active' : ''}`}
                  onClick={() => { setActiveTab('pdf'); setSimResult(null); }}
                >
                  <span>📄</span> Gotenberg PDF
                </button>
                <button 
                  className={`rn-tool-tab ${activeTab === 'whisper' ? 'active' : ''}`}
                  onClick={() => { setActiveTab('whisper'); setSimResult(null); }}
                >
                  <span>🎙️</span> Whisper AI
                </button>
                <button 
                  className={`rn-tool-tab ${activeTab === 'rmbg' ? 'active' : ''}`}
                  onClick={() => { setActiveTab('rmbg'); setSimResult(null); }}
                >
                  <span>✂️</span> Xóa Nền AI
                </button>
                <button 
                  className={`rn-tool-tab ${activeTab === 'upscale' ? 'active' : ''}`}
                  onClick={() => { setActiveTab('upscale'); setSimResult(null); }}
                >
                  <span>✨</span> Pixel Upscale
                </button>
              </div>

              <div className="rn-sim-body">
                {activeTab === 'url' && (
                  <>
                    <div className="rn-input-group">
                      <label className="rn-input-label">URL Video / Âm thanh gốc (YouTube, TikTok, Facebook...)</label>
                      <input 
                        type="text" 
                        className="rn-text-input" 
                        value={urlInput}
                        onChange={(e) => setUrlInput(e.target.value)}
                        placeholder="https://..."
                      />
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                      <div className="rn-input-group">
                        <label className="rn-input-label">Định dạng</label>
                        <select className="rn-select" value={format} onChange={(e) => setFormat(e.target.value)}>
                          <option value="mp4">Video (MP4)</option>
                          <option value="mp3">Âm thanh (MP3)</option>
                        </select>
                      </div>
                      <div className="rn-input-group">
                        <label className="rn-input-label">Chất lượng mong muốn</label>
                        <select className="rn-select" value={quality} onChange={(e) => setQuality(e.target.value)}>
                          {format === 'mp4' ? (
                            <>
                              <option value="1080p">1080p Full HD (60fps)</option>
                              <option value="720p">720p HD</option>
                              <option value="480p">480p Tiết kiệm dung lượng</option>
                            </>
                          ) : (
                            <>
                              <option value="320k">320 kbps (High Fidelity)</option>
                              <option value="192k">192 kbps (Standard)</option>
                              <option value="128k">128 kbps</option>
                            </>
                          )}
                        </select>
                      </div>
                    </div>
                  </>
                )}

                {activeTab === 'pdf' && (
                  <>
                    <div className="rn-input-group">
                      <label className="rn-input-label">Loại tài liệu văn phòng đầu vào</label>
                      <select className="rn-select" value={pdfDocType} onChange={(e) => setPdfDocType(e.target.value)}>
                        <option value="docx">Microsoft Word (.docx)</option>
                        <option value="xlsx">Microsoft Excel (.xlsx)</option>
                        <option value="pptx">Microsoft PowerPoint (.pptx)</option>
                        <option value="md">Markdown (.md)</option>
                        <option value="txt">Văn bản thuần (.txt)</option>
                      </select>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <input 
                        type="checkbox" 
                        id="landscape-check"
                        checked={isLandscape} 
                        onChange={(e) => setIsLandscape(e.target.checked)} 
                      />
                      <label htmlFor="landscape-check" style={{ fontSize: '14px', cursor: 'pointer' }}>
                        Khổ trang nằm ngang (Landscape orientation)
                      </label>
                    </div>
                  </>
                )}

                {activeTab === 'whisper' && (
                  <>
                    <div className="rn-input-group">
                      <label className="rn-input-label">Mô hình Whisper AI</label>
                      <select className="rn-select" value={whisperModel} onChange={(e) => setWhisperModel(e.target.value)}>
                        <option value="large-v3">Whisper Large v3 (Độ chính xác cao nhất · Tiếng Việt & Đa ngữ)</option>
                        <option value="small">Whisper Small (Cân bằng tốc độ / RAM)</option>
                        <option value="base">Whisper Base (Siêu tốc)</option>
                      </select>
                    </div>
                    <div className="rn-input-group">
                      <label className="rn-input-label">Ngôn ngữ nhận diện</label>
                      <select className="rn-select" value={audioLang} onChange={(e) => setAudioLang(e.target.value)}>
                        <option value="auto">Tự động nhận diện (Auto-detect Language)</option>
                        <option value="vi">Tiếng Việt (Vietnamese)</option>
                        <option value="en">Tiếng Anh (English)</option>
                      </select>
                    </div>
                  </>
                )}

                {activeTab === 'rmbg' && (
                  <div style={{ textAlign: 'center', padding: '16px 0' }}>
                    <div style={{ fontSize: '40px', marginBottom: '8px' }}>🖼️ ➔ ✂️</div>
                    <div style={{ fontSize: '15px', fontWeight: 600 }}>Tách nền thông minh BiRefNet & RMBG-1.4</div>
                    <div style={{ fontSize: '13px', color: 'var(--home-secondary-text)', marginTop: '4px' }}>
                      Tự động phân tách tóc, viền vật thể phức tạp và tạo kênh Alpha trong suốt.
                    </div>
                  </div>
                )}

                {activeTab === 'upscale' && (
                  <div style={{ textAlign: 'center', padding: '16px 0' }}>
                    <div style={{ fontSize: '40px', marginBottom: '8px' }}>🔍 ➔ 💎</div>
                    <div style={{ fontSize: '15px', fontWeight: 600 }}>Khôi phục ảnh mờ & Tăng độ phân giải 4x</div>
                    <div style={{ fontSize: '13px', color: 'var(--home-secondary-text)', marginTop: '4px' }}>
                      Mô hình RealPLKSR phục chế chi tiết pixel bị nén, khử nhiễu ảnh cũ.
                    </div>
                  </div>
                )}

                <button 
                  className="rn-action-btn"
                  onClick={handleRunTask}
                  disabled={isProcessing}
                  style={{ opacity: isProcessing ? 0.7 : 1 }}
                >
                  {isProcessing ? (
                    <>
                      <span className="rn-brand-logo" style={{ width: '18px', height: '18px' }}><Logo /></span>
                      <span>Đang xử lý tác vụ ({progress}%)...</span>
                    </>
                  ) : (
                    <>
                      <span>Khởi tạo tác vụ ngay</span>
                      <span>➔</span>
                    </>
                  )}
                </button>

                {/* Progress bar */}
                {isProcessing && (
                  <div style={{ width: '100%', height: '6px', background: 'var(--home-border)', borderRadius: '99rem', overflow: 'hidden' }}>
                    <div style={{ width: `${progress}%`, height: '100%', background: 'var(--home-button-primary)', transition: 'width 0.25s ease' }}></div>
                  </div>
                )}

                {/* Result Simulation */}
                {simResult && (
                  <div className="rn-result-box">
                    {simResult.type === 'url' && (
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                          <span style={{ color: 'var(--home-code-green)', fontWeight: 700, fontSize: '13px' }}>✓ XỬ LÝ THÀNH CÔNG</span>
                          <span style={{ fontSize: '12px', color: 'var(--home-secondary-text)' }}>Dung lượng: {simResult.size}</span>
                        </div>
                        <div style={{ fontWeight: 600, fontSize: '14px', marginBottom: '4px' }}>{simResult.title}</div>
                        <div style={{ fontSize: '12px', color: 'var(--home-secondary-text)', marginBottom: '10px' }}>
                          Kênh: {simResult.channel} · Thời lượng: {simResult.duration}
                        </div>
                        <a 
                          href="#" 
                          onClick={(e) => { e.preventDefault(); alert('Demo: File kết quả đã sẵn sàng để tải xuống!'); }}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '6px',
                            background: 'var(--home-button-primary)',
                            color: '#fff',
                            padding: '6px 14px',
                            borderRadius: '6px',
                            fontSize: '13px',
                            fontWeight: 600,
                            textDecoration: 'none'
                          }}
                        >
                          Tải xuống tệp {format.toUpperCase()}
                        </a>
                      </div>
                    )}

                    {simResult.type === 'pdf' && (
                      <div>
                        <div style={{ color: 'var(--home-code-green)', fontWeight: 700, fontSize: '13px', marginBottom: '4px' }}>
                          ✓ GOTENBERG ENGINE V8 HOÀN TẤT
                        </div>
                        <div style={{ fontWeight: 600, fontSize: '14px' }}>{simResult.title}</div>
                        <div style={{ fontSize: '12.5px', color: 'var(--home-secondary-text)', marginTop: '4px' }}>
                          Số trang: {simResult.pages} · Chuẩn: {simResult.standard} · Dung lượng: {simResult.size}
                        </div>
                      </div>
                    )}

                    {simResult.type === 'whisper' && (
                      <div>
                        <div style={{ color: 'var(--home-code-green)', fontWeight: 700, fontSize: '13px', marginBottom: '6px' }}>
                          ✓ NHẬN DIỆN THÀNH CÔNG: {simResult.detectedLang}
                        </div>
                        <div style={{ maxHeight: '110px', overflowY: 'auto', fontSize: '12.5px', lineHeight: '1.6' }}>
                          {simResult.segments.map((seg, i) => (
                            <div key={i} style={{ marginBottom: '4px' }}>
                              <span style={{ color: 'var(--home-button-primary)', fontFamily: 'var(--ifm-font-family-monospace)', marginRight: '6px' }}>
                                [{seg.start} ➔ {seg.end}]
                              </span>
                              <span>{seg.text}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {simResult.type === 'rmbg' && (
                      <div>
                        <div style={{ color: 'var(--home-code-green)', fontWeight: 700, fontSize: '13px', marginBottom: '4px' }}>
                          ✓ BIREFNET MASK GENERATED
                        </div>
                        <div style={{ fontSize: '13px', color: 'var(--home-text)' }}>{simResult.status}</div>
                        <div style={{ fontSize: '12px', color: 'var(--home-secondary-text)', marginTop: '2px' }}>
                          Độ phân giải: {simResult.resolution} · Tăng tốc suy luận GPU TensorRT
                        </div>
                      </div>
                    )}

                    {simResult.type === 'upscale' && (
                      <div>
                        <div style={{ color: 'var(--home-code-green)', fontWeight: 700, fontSize: '13px', marginBottom: '4px' }}>
                          ✓ REAL-ESRGAN ENHANCEMENT DONE
                        </div>
                        <div style={{ fontSize: '13px', color: 'var(--home-text)' }}>{simResult.dimensions}</div>
                        <div style={{ fontSize: '12px', color: 'var(--home-secondary-text)', marginTop: '2px' }}>
                          Hệ số phóng đại: {simResult.upscaleFactor} · Giữ nguyên độ sắc nét chi tiết
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Fox Fact Mascot */}
        <div className="rn-fox-container">
          <div className="rn-fox-icon">
            <FoxFact className="rn-fox-svg" />
          </div>
          <div className="rn-fox-text">
            <strong>Kiến trúc hướng đối tượng & Microservices phân tán:</strong> Lớp cơ sở trừu tượng <code>MediaJob</code> chuẩn hóa vòng đời tác vụ từ trạng thái hàng đợi (queued), tiến trình thực thi (processing), báo cáo tiến độ thời gian thực (updateProgress) cho đến hoàn tất xuất bản tệp tin.
          </div>
        </div>
      </section>

      {/* ==================== ARCHITECTURE DISSECTION (NATIVE STYLE) ==================== */}
      <section id="architecture" className="rn-section rn-section-border-top">
        <div className="rn-section-header">
          <div className="rn-section-tag">Object Analysis & Architecture</div>
          <h2 className="rn-section-title">
            Phân tích các đối tượng cốt lõi trong hệ thống
          </h2>
          <p className="rn-section-desc">
            Thiết kế phân tầng Layered Architecture kết hợp bộ điều phối Microservices,
            đảm bảo tính độc lập và khả năng mở rộng linh hoạt theo tải GPU/CPU.
          </p>
        </div>

        <div className="rn-arch-box">
          <img 
            src={theme === 'dark' ? '/img/homepage/dissection-dark.png' : '/img/homepage/dissection.png'} 
            alt="Omniverse Architecture Breakdown"
            className="rn-arch-img"
          />

          <div className="rn-arch-specs">
            <div className="rn-spec-item">
              <div className="rn-spec-num">User</div>
              <div className="rn-spec-label">Quản lí phiên & Ngôn ngữ</div>
              <div className="rn-spec-desc">Mã phiên UUID, đa ngữ vi/en, điều phối khởi tạo tác vụ qua Web SPA.</div>
            </div>
            <div className="rn-spec-item">
              <div className="rn-spec-num">MediaJob</div>
              <div className="rn-spec-label">Lớp trừu tượng cơ sở</div>
              <div className="rn-spec-desc">Định nghĩa jobId, progressPercent, execute() và luồng phát sự kiện tiến độ.</div>
            </div>
            <div className="rn-spec-item">
              <div className="rn-spec-num">Tasks</div>
              <div className="rn-spec-label">Kế thừa chuyên biệt</div>
              <div className="rn-spec-desc">DownloadTask (Media), ConvertDocTask (PDF), TranscribeTask (Whisper).</div>
            </div>
            <div className="rn-spec-item">
              <div className="rn-spec-num">Segments</div>
              <div className="rn-spec-label">Bóc tách phụ đề chi tiết</div>
              <div className="rn-spec-desc">SubtitleSegment lưu start/end timestamps, độ tin cậy và định dạng SRT/VTT.</div>
            </div>
          </div>
        </div>
      </section>

      {/* ==================== FRAMEWORK / ECOSYSTEM CARDS ==================== */}
      <section id="ecosystem" className="rn-section rn-section-border-top">
        <div className="rn-section-header">
          <div className="rn-section-tag">Microservice Ecosystem</div>
          <h2 className="rn-section-title">
            Hạ tầng xử lý mạnh mẽ, sẵn sàng mở rộng quy mô
          </h2>
          <p className="rn-section-desc">
            Omniverse tích hợp các công nghệ mã nguồn mở hàng đầu thế giới được tối ưu hóa bằng Docker Swarm và Pingora Gateway.
          </p>
        </div>

        <div className="rn-cards-grid">
          {/* Card 1 */}
          <div className="rn-card">
            <div className="rn-card-media">
              <img 
                src={theme === 'dark' ? '/img/homepage/file-based-routing-dark.png' : '/img/homepage/file-based-routing.png'} 
                alt="Gotenberg Engine" 
                className="rn-card-img"
              />
            </div>
            <div className="rn-card-content">
              <div className="rn-card-badge">Gotenberg v8 Engine</div>
              <h3 className="rn-card-title">Chuyển đổi PDF Chuẩn Văn Phòng</h3>
              <p className="rn-card-desc">
                Sử dụng LibreOffice headless và Chromium engine để render chuẩn xác từng bảng tính Excel, slide thuyết trình PowerPoint và văn bản Word sang PDF/A.
              </p>
              <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--home-button-primary)' }}>
                Sub-second Response ➔
              </span>
            </div>
          </div>

          {/* Card 2 */}
          <div className="rn-card">
            <div className="rn-card-media">
              <img 
                src={theme === 'dark' ? '/img/homepage/libraries-dark.png' : '/img/homepage/libraries.png'} 
                alt="Whisper AI & RMBG" 
                className="rn-card-img"
              />
            </div>
            <div className="rn-card-content">
              <div className="rn-card-badge">TensorRT & PyTorch</div>
              <h3 className="rn-card-title">OpenAI Whisper & RMBG-1.4</h3>
              <p className="rn-card-desc">
                Tăng tốc suy luận GPU bằng TensorRT FP16, giảm 70% thời gian xử lý phụ đề và bóc tách phông nền ảnh độ phân giải cao mà không suy giảm chi tiết.
              </p>
              <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--home-button-primary)' }}>
                GPU Accelerated ➔
              </span>
            </div>
          </div>

          {/* Card 3 */}
          <div className="rn-card">
            <div className="rn-card-media">
              <img 
                src={theme === 'dark' ? '/img/homepage/tools-dark.png' : '/img/homepage/tools.png'} 
                alt="Pingora Gateway & Redis Queue" 
                className="rn-card-img"
              />
            </div>
            <div className="rn-card-content">
              <div className="rn-card-badge">Pingora & Redis Streams</div>
              <h3 className="rn-card-title">Hàng Đợi & Cân Bằng Tải</h3>
              <p className="rn-card-desc">
                Cổng định tuyến Pingora hiệu năng cao bằng Rust cùng cơ chế hàng đợi Redis Task Broker chống nghẽn nghẽn, đảm bảo không mất tác vụ khi tải cao.
              </p>
              <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--home-button-primary)' }}>
                Zero Data Loss ➔
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* ==================== TEAM SECTION ==================== */}
      <section id="team" className="rn-section rn-section-border-top">
        <div className="rn-section-header">
          <div className="rn-section-tag">Project Team</div>
          <h2 className="rn-section-title">
            Đề tài Nghiên cứu & Phát triển · Nhóm 1
          </h2>
          <p className="rn-section-desc">
            Xây Dựng Ứng Dụng Quản Lí Đa Phương Tiện ONIVERSE - MULTI MEDIA & AI TOOLS
          </p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '24px', maxWidth: '800px', margin: '0 auto' }}>
          <div style={{ background: 'var(--home-background)', border: '1px solid var(--home-border)', borderRadius: '14px', padding: '24px', textAlign: 'center', boxShadow: 'var(--card-shadow)' }}>
            <div style={{ width: '64px', height: '64px', borderRadius: '50%', background: 'linear-gradient(135deg, #087ea4, #58c4dc)', margin: '0 auto 16px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '24px', color: '#fff', fontWeight: 700 }}>
              TL
            </div>
            <h4 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '6px' }}>Tống Nguyễn Bảo Long</h4>
            <div style={{ fontSize: '14px', color: 'var(--home-button-primary)', fontWeight: 600, marginBottom: '8px' }}>MSSV: 23010111</div>
            <p style={{ fontSize: '13px', color: 'var(--home-secondary-text)' }}>Phát triển Kiến trúc Microservices, Pingora Gateway, Go Backend & Worker Yt-dlp.</p>
          </div>

          <div style={{ background: 'var(--home-background)', border: '1px solid var(--home-border)', borderRadius: '14px', padding: '24px', textAlign: 'center', boxShadow: 'var(--card-shadow)' }}>
            <div style={{ width: '64px', height: '64px', borderRadius: '50%', background: 'linear-gradient(135deg, #58c4dc, #27c93f)', margin: '0 auto 16px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '24px', color: '#fff', fontWeight: 700 }}>
              ND
            </div>
            <h4 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '6px' }}>Trần Bùi Nguyên Dương</h4>
            <div style={{ fontSize: '14px', color: 'var(--home-button-primary)', fontWeight: 600, marginBottom: '8px' }}>MSSV: 23010570</div>
            <p style={{ fontSize: '13px', color: 'var(--home-secondary-text)' }}>Phát triển Web SPA Frontend, Tích hợp Whisper AI, Gotenberg & Xóa phông RMBG.</p>
          </div>
        </div>
      </section>

      {/* ==================== CALL TO ACTION ==================== */}
      <section className="rn-cta-wrap">
        <div className="rn-cta-pattern"></div>
        <div className="rn-cta-box">
          <h2 className="rn-cta-title">
            Sẵn sàng trải nghiệm Omniverse?
          </h2>
          <p className="rn-cta-desc">
            Khám phá trọn bộ công cụ xử lý âm thanh, video, văn bản và hình ảnh thông minh ngay hôm nay.
          </p>
          <div className="rn-hero-buttons">
            <a href="#workbench" className="rn-btn-primary">
              Bắt đầu với Live Workbench ➔
            </a>
            <a href="https://github.com/shader006/Omniverse-tool" target="_blank" rel="noopener noreferrer" className="rn-btn-secondary">
              Xem Repository trên GitHub
            </a>
          </div>
        </div>
      </section>

      {/* ==================== FOOTER ==================== */}
      <footer className="rn-footer">
        <div className="rn-footer-inner">
          <div className="rn-footer-grid">
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
                <div style={{ width: '28px', height: '28px' }}><Logo /></div>
                <span style={{ fontWeight: 800, fontSize: '18px' }}>Omniverse</span>
              </div>
              <p style={{ fontSize: '14px', color: 'var(--home-secondary-text)', maxWidth: '300px', lineHeight: '1.6' }}>
                Hệ sinh thái xử lý đa phương tiện và trí tuệ nhân tạo toàn diện theo kiến trúc Microservices phân tán.
              </p>
            </div>

            <div>
              <div className="rn-footer-col-title">Công cụ AI</div>
              <ul className="rn-footer-links">
                <li><a href="#workbench" className="rn-footer-link" onClick={() => setActiveTab('url')}>Tải Media Mạng Xã Hội</a></li>
                <li><a href="#workbench" className="rn-footer-link" onClick={() => setActiveTab('pdf')}>Chuyển đổi Gotenberg PDF</a></li>
                <li><a href="#workbench" className="rn-footer-link" onClick={() => setActiveTab('whisper')}>Bóc tách phụ đề Whisper</a></li>
                <li><a href="#workbench" className="rn-footer-link" onClick={() => setActiveTab('rmbg')}>Xóa phông nền RMBG-1.4</a></li>
                <li><a href="#workbench" className="rn-footer-link" onClick={() => setActiveTab('upscale')}>PixelFixer & Upscaler</a></li>
              </ul>
            </div>

            <div>
              <div className="rn-footer-col-title">Tài liệu & Kiến trúc</div>
              <ul className="rn-footer-links">
                <li><a href="#architecture" className="rn-footer-link">Lớp trừu tượng MediaJob</a></li>
                <li><a href="#architecture" className="rn-footer-link">Phân tích DownloadTask</a></li>
                <li><a href="#architecture" className="rn-footer-link">Đặc tả TranscribeTask</a></li>
                <li><a href="#ecosystem" className="rn-footer-link">Cấu hình Pingora Proxy</a></li>
                <li><a href="#ecosystem" className="rn-footer-link">Docker Swarm Autoscaler</a></li>
              </ul>
            </div>

            <div>
              <div className="rn-footer-col-title">Cộng đồng & Nhóm</div>
              <ul className="rn-footer-links">
                <li><a href="https://github.com/shader006/Omniverse-tool" className="rn-footer-link">GitHub Repository</a></li>
                <li><a href="#team" className="rn-footer-link">Tống Nguyễn Bảo Long</a></li>
                <li><a href="#team" className="rn-footer-link">Trần Bùi Nguyên Dương</a></li>
                <li><a href="#home" className="rn-footer-link">Báo cáo Đồ án</a></li>
              </ul>
            </div>
          </div>

          <div className="rn-footer-bottom">
            <div>
              © 2026 Omniverse Team (Nhóm 1). Giao diện thiết kế theo phong cách React Native UI System.
            </div>
            <div style={{ display: 'flex', gap: '16px' }}>
              <span>React 18</span>
              <span>•</span>
              <span>Vite</span>
              <span>•</span>
              <span>Gotenberg v8</span>
              <span>•</span>
              <span>Whisper AI</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
