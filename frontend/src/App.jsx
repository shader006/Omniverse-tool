import React, { useState, useEffect } from 'react';
import PixelHero from './components/PixelHero/PixelHero';
import ToolsNavbar from './components/ToolsNavbar/ToolsNavbar';
import ModeSwitcher from './components/ModeSwitcher';
import UrlDownloader from './components/UrlDownloader/UrlDownloader';
import FileConverter from './components/FileConverter/FileConverter';
import WhisperTranscribe from './components/WhisperTranscribe/WhisperTranscribe';
import RemoveBackground from './components/RemoveBackground/RemoveBackground';
import PixelFixer from './components/PixelFixer/PixelFixer';
import Footer from './components/Footer';
import LoginModal from './components/ui/pixelact-ui/LoginModal';
import PixelMascot from './components/PixelMascot/PixelMascot';
export default function App() {
  const getInitialRoute = () => {
    const hash = typeof window !== 'undefined' ? window.location.hash.replace('#', '').toLowerCase() : '';
    if (['url', 'file', 'transcribe', 'bg', 'pixel'].includes(hash)) {
      return { page: 'tools', mode: hash };
    }
    if (['tools', 'tools-workspace'].includes(hash)) {
      return { page: 'tools', mode: 'url' };
    }
    return { page: 'home', mode: 'url' };
  };

  const initialRoute = getInitialRoute();
  const [currentPage, setCurrentPage] = useState(initialRoute.page);
  const [currentMode, setCurrentMode] = useState(initialRoute.mode);
  const [isLoginOpen, setIsLoginOpen] = useState(false);
  const [lang, setLang] = useState('vi'); // 'vi' | 'en'

  const toggleLang = () => {
    setLang((prev) => (prev === 'vi' ? 'en' : 'vi'));
  };

  useEffect(() => {
    const handleRoute = () => {
      const hash = window.location.hash.replace('#', '').toLowerCase();
      if (['url', 'file', 'transcribe', 'bg', 'pixel', 'tools', 'tools-workspace'].includes(hash)) {
        setCurrentPage('tools');
        if (['url', 'file', 'transcribe', 'bg', 'pixel'].includes(hash)) {
          setCurrentMode(hash);
        }
      } else {
        setCurrentPage('home');
      }
    };

    handleRoute();
    window.addEventListener('hashchange', handleRoute);
    return () => window.removeEventListener('hashchange', handleRoute);
  }, []);

  const navigateToTools = (mode) => {
    setCurrentPage('tools');
    if (mode && ['url', 'file', 'transcribe', 'bg', 'pixel'].includes(mode)) {
      setCurrentMode(mode);
      window.location.hash = `#${mode}`;
    } else {
      window.location.hash = '#tools';
    }
    window.scrollTo({ top: 0, behavior: 'instant' });
  };

  const navigateToHome = () => {
    setCurrentPage('home');
    window.location.hash = '#home';
    window.scrollTo({ top: 0, behavior: 'instant' });
  };

  const handleSelectMode = (mode) => {
    setCurrentMode(mode);
    window.location.hash = `#${mode}`;
  };

  return (
    <div className="app-root">
      {currentPage === 'home' ? (
        /* TRANG CHỦ: PIXEL HERO RIÊNG BIỆT (KHÔNG CÒN GỘP CHUNG VỚI TOOLS) */
        <PixelHero 
          onExploreTools={() => navigateToTools()}
          onSelectTool={(toolId) => navigateToTools(toolId)}
          onOpenLogin={() => setIsLoginOpen(true)}
          lang={lang}
          onToggleLang={toggleLang}
        />
      ) : (
        /* TRANG TOOLS: TRANG RIÊNG BIỆT CÓ THANH NAV TIỆN LỢI */
        <div id="tools-page" className="workspace-section" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
          <ToolsNavbar 
            onGoHome={navigateToHome} 
            onOpenLogin={() => setIsLoginOpen(true)} 
            lang={lang}
            onToggleLang={toggleLang}
          />

          <main className="container" style={{ flex: 1, paddingTop: '10px' }}>
            <ModeSwitcher currentMode={currentMode} onSelectMode={handleSelectMode} lang={lang} />

            {currentMode === 'url' && <UrlDownloader lang={lang} />}
            {currentMode === 'file' && <FileConverter lang={lang} />}
            {currentMode === 'transcribe' && <WhisperTranscribe lang={lang} />}
            {currentMode === 'bg' && <RemoveBackground lang={lang} />}
            {currentMode === 'pixel' && <PixelFixer lang={lang} />}
          </main>

          <Footer lang={lang} />
        </div>
      )}

      {/* Modal đăng nhập dùng chung ở cả 2 view */}
      <LoginModal isOpen={isLoginOpen} onClose={() => setIsLoginOpen(false)} lang={lang} />

      {/* Mascot Cáo Pixel tương tác thông minh */}
      <PixelMascot lang={lang} />
    </div>
  );
}
