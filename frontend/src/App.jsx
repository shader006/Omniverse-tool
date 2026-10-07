import React, { useState, useEffect } from 'react';
import PixelHero from './components/PixelHero/PixelHero';
import ToolsNavbar from './components/ToolsNavbar/ToolsNavbar';
import ModeSwitcher from './components/ModeSwitcher';
import UrlDownloader from './components/UrlDownloader/UrlDownloader';
import FileConverter from './components/FileConverter/FileConverter';
import WhisperTranscribe from './components/WhisperTranscribe/WhisperTranscribe';
import RemoveBackground from './components/RemoveBackground/RemoveBackground';
import PixelFixer from './components/PixelFixer/PixelFixer';
import PictureUpscaler from './components/PictureUpscaler/PictureUpscaler';
import Footer from './components/Footer';
import FaqSection from './components/FaqSection';
import FeaturesGrid from './components/FeaturesGrid';
import FoxTutorial from './components/FoxTutorial/FoxTutorial';
import BeforeAfterShowcase from './components/BeforeAfter/BeforeAfterShowcase';
import AdSlot from './components/Ads/AdSlot';
import PolicyModal from './components/Policy/PolicyModal';
import AboutUs from './components/Policy/AboutUs';
import LoginModal from './components/ui/pixelact-ui/LoginModal';
import PixelMascot from './components/PixelMascot/PixelMascot';
import { AuthProvider } from './contexts/AuthContext';

export default function App() {
  const getInitialRoute = () => {
    const hash = typeof window !== 'undefined' ? window.location.hash.replace('#', '').toLowerCase() : '';
    if (hash === 'about') {
      return { page: 'about', mode: 'url' };
    }
    if (['url', 'file', 'transcribe', 'bg', 'pixel', 'upscale'].includes(hash)) {
      return { page: 'tools', mode: hash };
    }
    if (['tools', 'tools-workspace'].includes(hash)) {
      return { page: 'tools', mode: 'url' };
    }
    return { page: 'home', mode: 'url' };
  };

  const initialRoute = getInitialRoute();
  const [currentPage, setCurrentPage] = useState(initialRoute.page); // 'home' | 'tools' | 'about'
  const [currentMode, setCurrentMode] = useState(initialRoute.mode);
  const [isLoginOpen, setIsLoginOpen] = useState(false);
  const [lang, setLang] = useState('vi'); // 'vi' | 'en'

  // Global policy modal state (Footer / LoginModal / anywhere)
  const [policyOpen, setPolicyOpen] = useState(false);
  const [policyType, setPolicyType] = useState('terms');

  const openPolicy = (type) => {
    setPolicyType(type);
    setPolicyOpen(true);
  };

  const toggleLang = () => {
    setLang((prev) => (prev === 'vi' ? 'en' : 'vi'));
  };

  useEffect(() => {
    const handleRoute = () => {
      const hash = window.location.hash.replace('#', '').toLowerCase();
      if (hash === 'about') {
        setCurrentPage('about');
      } else if (['url', 'file', 'transcribe', 'bg', 'pixel', 'upscale', 'tools', 'tools-workspace'].includes(hash)) {
        setCurrentPage('tools');
        if (['url', 'file', 'transcribe', 'bg', 'pixel', 'upscale'].includes(hash)) {
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
    if (mode && ['url', 'file', 'transcribe', 'bg', 'pixel', 'upscale'].includes(mode)) {
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

  const navigateToAbout = () => {
    setCurrentPage('about');
    window.location.hash = '#about';
    window.scrollTo({ top: 0, behavior: 'instant' });
  };

  const handleSelectMode = (mode) => {
    setCurrentMode(mode);
    window.location.hash = `#${mode}`;
  };

  return (
    <AuthProvider>
      <div className="app-root">
        {currentPage === 'about' ? (
          /* TRANG ABOUT US */
          <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
            <ToolsNavbar
              onGoHome={navigateToHome}
              onGoAbout={navigateToAbout}
              onGoTools={() => navigateToTools()}
              onOpenLogin={() => setIsLoginOpen(true)}
              lang={lang}
              onToggleLang={toggleLang}
              currentPage="about"
            />
            <AboutUs
              lang={lang}
              onNavigateTools={() => navigateToTools()}
            />
            <Footer
              lang={lang}
              onOpenPolicy={openPolicy}
              onOpenAbout={navigateToAbout}
            />
          </div>
        ) : currentPage === 'home' ? (
          /* TRANG CHỦ: PIXEL HERO + SEO SECTIONS */
          <div>
            <PixelHero 
              onExploreTools={() => navigateToTools()}
              onSelectTool={(toolId) => navigateToTools(toolId)}
              onGoAbout={navigateToAbout}
              onOpenLogin={() => setIsLoginOpen(true)}
              lang={lang}
              onToggleLang={toggleLang}
            />
            {/* SEO Content Sections bên dưới Hero – index bởi Google */}
            <div
              id="seo-content-home"
              className="workspace-section"
              style={{ padding: '0 0 48px' }}
            >
              <div className="container" style={{ paddingTop: '40px' }}>
                {/* Features grid với các tool cards có Schema markup */}
                <FeaturesGrid
                  lang={lang}
                  onSelectTool={(toolId) => navigateToTools(toolId)}
                />

                {/* 💰 AD #1 – Banner ngang giữa Features và FAQ (Adsterra – 728x90) */}
                <AdSlot
                  network="adsterra"
                  format="banner"
                  width={728}
                  height={90}
                  style={{ margin: '24px 0' }}
                />

                {/* FAQ Accordion với FAQPage Schema */}
                <FaqSection lang={lang} />
              </div>
              <Footer
                lang={lang}
                onOpenPolicy={openPolicy}
                onOpenAbout={navigateToAbout}
              />
            </div>
          </div>
        ) : (
          /* TRANG TOOLS: TRANG RIÊNG BIỆT CÓ THANH NAV TIỆN LỢI */
          <div id="tools-page" className="workspace-section" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
            <ToolsNavbar 
              onGoHome={navigateToHome} 
              onGoAbout={navigateToAbout}
              onGoTools={() => navigateToTools()}
              onOpenLogin={() => setIsLoginOpen(true)} 
              lang={lang}
              onToggleLang={toggleLang}
              currentPage="tools"
            />

            <main className="container" style={{ flex: 1, paddingTop: '10px' }}>
              <ModeSwitcher currentMode={currentMode} onSelectMode={handleSelectMode} lang={lang} />

              {/* 💰 AD #2 – Native sau ModeSwitcher (Adsterra – 300x250) */}
              <AdSlot
                network="adsterra"
                format="native"
                width={300}
                height={250}
                className="ad-between-tools"
              />

              {/* Before/After showcase phía trên tool content – chỉ áp dụng cho công cụ ảnh */}
              {['bg', 'pixel', 'upscale'].includes(currentMode) && (
                <BeforeAfterShowcase mode={currentMode} lang={lang} />
              )}

              {currentMode === 'url' && <UrlDownloader lang={lang} />}
              {currentMode === 'file' && <FileConverter lang={lang} />}
              {currentMode === 'transcribe' && <WhisperTranscribe lang={lang} />}
              {currentMode === 'bg' && <RemoveBackground lang={lang} />}
              {currentMode === 'pixel' && <PixelFixer lang={lang} />}
              {currentMode === 'upscale' && <PictureUpscaler lang={lang} />}

              {/* 💰 AD #3 – Rectangle sau tool (Adsterra – 336x280, CTR cao nhất) */}
              <AdSlot
                network="adsterra"
                format="rectangle"
                width={336}
                height={280}
                className="ad-after-tool"
              />
            </main>

            <Footer
              lang={lang}
              onOpenPolicy={openPolicy}
              onOpenAbout={navigateToAbout}
            />
          </div>
        )}

        {/* Hướng Dẫn Từng Bước Chú Cáo Pixel (Chỉ hiện khi ở trang Tools) */}
        {currentPage === 'tools' && (
          <FoxTutorial
            key={currentMode}
            mode={currentMode}
            lang={lang}
          />
        )}

        {/* Global Policy Modal – có thể mở từ Footer, LoginModal, hoặc bất kỳ đâu */}
        <PolicyModal
          type={policyType}
          lang={lang}
          isOpen={policyOpen}
          onClose={() => setPolicyOpen(false)}
        />

        {/* Modal đăng nhập dùng chung ở cả 2 view */}
        <LoginModal isOpen={isLoginOpen} onClose={() => setIsLoginOpen(false)} lang={lang} />

        {/* Mascot Cáo Pixel tương tác thông minh */}
        <PixelMascot lang={lang} />
      </div>
    </AuthProvider>
  );
}
