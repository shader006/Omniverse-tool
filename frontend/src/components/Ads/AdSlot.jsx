import React, { useEffect, useRef } from 'react';
import './ad-slot.css';

/**
 * AdSlot – Multi-Network Ad Component
 *
 * Hỗ trợ các mạng quảng cáo ÍT KHẮT KHE với download/media tools:
 *   - adsterra    ✅ Tốt nhất cho YouTube downloader sites (banner, native, pop)
 *   - monetag     ✅ PropellerAds mới, chấp nhận grey-niche, CPM tốt (VN ~$1-3)
 *   - hilltopads  ✅ Chuyên download sites, anti-adblock tốt
 *   - popads      ✅ Popunder, fill rate 100%, không cần duyệt
 *   - adsense     ❌ KHÔNG dùng cho YouTube downloader (sẽ bị ban account)
 *
 * Props:
 *   network    – 'adsterra' | 'monetag' | 'hilltopads' | 'popads' | 'placeholder'
 *   atKey      – Adsterra: key từ script src (THAY THẾ)
 *   atBanner   – Adsterra: banner invoke key (cho banner ads)
 *   mgZone     – Monetag: zone ID
 *   htZone     – HilltopAds: zone ID
 *   paKey      – PopAds: website key
 *   format     – 'banner' | 'native' | 'popunder' | 'interstitial' | 'push'
 *   width      – banner width (px), default 728
 *   height     – banner height (px), default 90
 *   label      – hiện label "Quảng cáo"
 *   className  – extra class
 *   style      – inline style
 */

// ─── CẤU HÌNH – THAY THẾ BẰNG ID THẬT ────────────────────────────
const AD_CONFIG = {
  // Adsterra – đăng ký tại publishers.adsterra.com
  // Chấp nhận: YouTube downloader, file converter, media tools
  // CPM VN: $0.5 – $2.5 | Thanh toán: $5 minimum, PayPal/USDT/Wire
  adsterra: {
    publisherKey: 'ADSTERRA_PUBLISHER_KEY',      // Từ Adsterra dashboard
    bannerKey:    'ADSTERRA_BANNER_KEY',          // Cho từng banner slot
  },

  // Monetag (PropellerAds) – đăng ký tại monetag.com
  // Chấp nhận: grey-niche, download tools, entertainment
  // CPM VN: $0.3 – $1.5 | Thanh toán: $5 minimum, PayPal/Payoneer
  monetag: {
    zoneId: 'MONETAG_ZONE_ID',                   // Từ Monetag dashboard
    siteId: 'MONETAG_SITE_ID',
  },

  // HilltopAds – đăng ký tại hilltopads.com
  // Chuyên: streaming, download, adult-adjacent niches
  // CPM VN: $0.2 – $1.0 | Thanh toán: $10 minimum
  hilltopads: {
    zoneId: 'HILLTOPADS_ZONE_ID',
  },

  // PopAds – đăng ký tại popads.net
  // Fill rate: 100%, không cần duyệt, chấp nhận mọi site
  // CPM VN: $0.1 – $0.5 | Thanh toán: $5 daily payout
  popads: {
    siteKey: 'POPADS_SITE_KEY',
  },
};

// Detect xem config có thật không
const isConfigured = (network) => {
  const c = AD_CONFIG[network];
  if (!c) return false;
  return !Object.values(c).some(v => typeof v === 'string' && v.includes('_KEY') || v.includes('_ID') || v.includes('_ZONE'));
};

/* ── Adsterra Banner ── */
function AdsterraSlot({ width = 728, height = 90 }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!ref.current || !isConfigured('adsterra')) return;
    // Adsterra inject script programmatically
    const s = document.createElement('script');
    s.type = 'text/javascript';
    s.async = true;
    s.src = `//www.highperformanceformat.com/${AD_CONFIG.adsterra.bannerKey}/invoke.js`;
    ref.current.appendChild(s);
    return () => { try { ref.current?.removeChild(s); } catch {} };
  }, []);
  return <div ref={ref} style={{ width, height }} />;
}

/* ── Monetag (PropellerAds) ── */
function MonetagSlot({ zoneId }) {
  const ref = useRef(null);
  const loaded = useRef(false);
  useEffect(() => {
    if (loaded.current || !ref.current) return;
    if (!isConfigured('monetag')) return;
    loaded.current = true;
    // Monetag banner script injection
    const s = document.createElement('script');
    s.async = true;
    s.setAttribute('data-cfasync', 'false');
    s.src = `//ophoacit.com/1?z=${zoneId || AD_CONFIG.monetag.zoneId}`;
    ref.current.appendChild(s);
  }, [zoneId]);
  return <div ref={ref} />;
}

/* ── HilltopAds ── */
function HilltopSlot({ zoneId }) {
  const ref = useRef(null);
  const loaded = useRef(false);
  useEffect(() => {
    if (loaded.current || !ref.current || !isConfigured('hilltopads')) return;
    loaded.current = true;
    const s = document.createElement('script');
    s.async = true;
    s.src = `//vaugroar.com/act/files/tag.min.js?z=${zoneId || AD_CONFIG.hilltopads.zoneId}`;
    ref.current.appendChild(s);
  }, [zoneId]);
  return <div ref={ref} />;
}

/* ── PopAds Popunder ── */
function PopAdsSlot() {
  const loaded = useRef(false);
  useEffect(() => {
    if (loaded.current || !isConfigured('popads')) return;
    loaded.current = true;
    // PopAds global pop script
    const s = document.createElement('script');
    s.type = 'text/javascript';
    window._pop = window._pop || [];
    window._pop.push(['siteId', AD_CONFIG.popads.siteKey]);
    s.src = 'https://www.popads.net/js/adblock.js';
    s.async = true;
    document.head.appendChild(s);
  }, []);
  return null; // Popunder không có DOM element
}

/* ── Placeholder (dev / chưa config) ── */
function Placeholder({ network, format, width, height }) {
  const networkInfo = {
    adsterra:   { color: '#0ea5e9', label: 'Adsterra',   note: 'publishers.adsterra.com' },
    monetag:    { color: '#8b5cf6', label: 'Monetag',    note: 'monetag.com' },
    hilltopads: { color: '#f59e0b', label: 'HilltopAds', note: 'hilltopads.com' },
    popads:     { color: '#10b981', label: 'PopAds',     note: 'popads.net' },
    placeholder:{ color: '#475569', label: 'Ad Slot',    note: 'Chưa cấu hình' },
  };
  const info = networkInfo[network] || networkInfo.placeholder;
  return (
    <div
      className={`ad-placeholder ad-placeholder--${format}`}
      style={{ minHeight: height || 90, '--ad-accent': info.color }}
    >
      <div className="ad-placeholder-inner">
        <span className="ad-placeholder-net-badge" style={{ borderColor: info.color, color: info.color }}>
          {info.label}
        </span>
        <span className="ad-placeholder-icon">📢</span>
        <span className="ad-placeholder-text">{format?.toUpperCase()} • {width || 'auto'}×{height || 'auto'}</span>
        <a
          href={`https://${info.note}`}
          target="_blank"
          rel="noreferrer"
          className="ad-placeholder-link"
          style={{ color: info.color }}
        >
          ↗ {info.note}
        </a>
        <span className="ad-placeholder-note">Thay ID trong AdSlot.jsx → AD_CONFIG</span>
      </div>
    </div>
  );
}

/* ── MAIN COMPONENT ── */
export default function AdSlot({
  network = 'adsterra',
  atKey,
  atBanner,
  mgZone,
  htZone,
  paKey,
  format = 'banner',
  width = 728,
  height = 90,
  label = true,
  className = '',
  style = {},
}) {
  const configured = isConfigured(network);

  const renderAd = () => {
    if (!configured) {
      return <Placeholder network={network} format={format} width={width} height={height} />;
    }
    switch (network) {
      case 'adsterra':
        return <AdsterraSlot width={width} height={height} />;
      case 'monetag':
        return <MonetagSlot zoneId={mgZone} />;
      case 'hilltopads':
        return <HilltopSlot zoneId={htZone} />;
      case 'popads':
        return <PopAdsSlot />;
      default:
        return <Placeholder network="placeholder" format={format} width={width} height={height} />;
    }
  };

  // Popunder không cần wrapper UI
  if (network === 'popads' && configured) return <PopAdsSlot />;

  return (
    <div
      className={`ad-slot-wrapper ${className}`}
      style={{ ...style }}
      aria-label="Quảng cáo"
      role="complementary"
    >
      {label && (
        <div className="ad-slot-label">
          <span>QUẢNG CÁO</span>
        </div>
      )}
      <div className="ad-slot-inner">
        {renderAd()}
      </div>
    </div>
  );
}
