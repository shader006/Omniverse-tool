import React, { useState } from 'react';
import './whisper-architecture-modal.css';

export const ARCHITECTURE_LAYERS = [
  {
    id: 'edge',
    level: 'LAYER 1 • CLIENT EDGE',
    name: 'WebGPU On-Device AI',
    tech: 'Transformers.js / ONNX Runtime Web',
    model: 'onnx-community/whisper-tiny',
    latency: '0ms Network (Cực Siêu Tốc)',
    badge: 'Privacy-First • Zero Cloud Cost',
    badgeColor: '#10b981',
    icon: '⚡',
    summaryVi: 'Chạy trực tiếp trên chip GPU của người dùng qua WebGPU. Âm thanh không rời khỏi trình duyệt, bảo mật 100%, không tốn tài nguyên server.',
    summaryEn: 'Runs on client hardware via WebGPU. Audio never leaves the browser, 100% private with zero server costs.',
    details: [
      'Tự động phân giải 16kHz mono audio qua Web AudioContext trong 0.05ms.',
      'Sử dụng mô hình quantized FP16/INT8 tải sẵn vào CacheStorage của trình duyệt.',
      'Tự động fallback sang Layer 2 nếu trình duyệt không hỗ trợ WebGPU hoặc dung lượng RAM thấp.'
    ]
  },
  {
    id: 'proxy',
    level: 'LAYER 2 • REVERSE PROXY',
    name: 'Pingora High-Performance Proxy',
    tech: 'Rust Pingora Engine (Cloudflare Framework)',
    model: 'Zero-Copy Stream Multiplexing',
    latency: '< 0.8ms Overhead',
    badge: 'Rust Memory Safety • DoS Defense',
    badgeColor: '#0ea5e9',
    icon: '🛡️',
    summaryVi: 'Cổng vào chịu tải cực lớn được lập trình bằng Rust, lọc header độc hại, bảo vệ chống Null Byte Injection và điều phối tải thông minh.',
    summaryEn: 'High-throughput Rust reverse proxy. Filters malicious payloads, guards against injection attacks, and orchestrates traffic.',
    details: [
      'Xử lý kết nối HTTP/1.1 & HTTP/2, chống treo socket khi client ngắt kết nối giữa chừng.',
      'Phát hiện và chặn đứng tấn công Path Traversal, Null Byte injection trước khi tới Gateway.',
      'Hỗ trợ Forward Proxy qua Cloudflare Tunnel cho domain công khai.'
    ]
  },
  {
    id: 'gateway',
    level: 'LAYER 3 • API GATEWAY & CACHE',
    name: 'Go Microservice Gateway',
    tech: 'Go 1.24 High-Concurrency + Pogocache',
    model: 'Dynamic Load Balancer & Failover Router',
    latency: '< 1.5ms Route Time',
    badge: 'In-Memory Cache • Auto-Failover',
    badgeColor: '#8b5cf6',
    icon: '⚙️',
    summaryVi: 'Cụm điều phối trung tâm bằng Go: tích hợp bộ đệm In-Memory PogoCache, chia sẻ tệp phân tán và tự động chuyển đổi dự phòng (Failover).',
    summaryEn: 'Central Go coordinator: in-memory PogoCache deduplication, shared distributed storage, and zero-downtime worker failover.',
    details: [
      'Ghi nhận distributed traces W3C traceparent (HiAi Observe OTLP Tracer).',
      'Tự động định tuyến sang Worker dự phòng (Primary: PAIL Server -> Fallback: Docker Swarm Task) khi gặp sự cố 500/502.',
      'Dọn dẹp tự động tệp tạm hết hạn theo vòng đời (Zero Disk Leaks).'
    ]
  },
  {
    id: 'worker',
    level: 'LAYER 4 • NATIVE AI ENGINE',
    name: 'Whisper.cpp GGML Microservice',
    tech: 'C++ GGML Engine / CUDA Acceleration',
    model: 'GGML Large-v3 / Base / Tiny (AVX2 + CUDA)',
    latency: '~1.2s / 30s Audio (GPU Turbo)',
    badge: 'CUDA Hardware Accelerated • Fallback AVX2',
    badgeColor: '#f59e0b',
    icon: '🎙️',
    summaryVi: 'Trái tim tính toán phụ trợ: chạy whisper-cli C++ tối ưu hoá tận dụng nhân Tensor CUDA hoặc tập lệnh đa luồng AVX2 trên CPU.',
    summaryEn: 'Heavyweight AI backend: whisper-cli native C++ leveraging NVIDIA CUDA Tensor cores with automatic AVX2 CPU fallback.',
    details: [
      'Bộ giải mã âm thanh FFmpeg tối ưu: bỏ video stream (-vn) và chuẩn hóa speechnorm nhẹ hơn 80% so với loudnorm.',
      'Phát hiện lỗi tiến trình thời gian thực, tự động khởi động lại tiến trình con bằng CPU khi CUDA VRAM hết.',
      'Xuất chuẩn đa định dạng có timestamp đồng bộ phụ đề: SRT, WebVTT, JSON phân đoạn và Raw Text.'
    ]
  }
];

export default function WhisperArchitectureModal({ isOpen, onClose, lang = 'vi' }) {
  const [activeLayerId, setActiveLayerId] = useState('edge');

  if (!isOpen) return null;

  const activeLayer = ARCHITECTURE_LAYERS.find(l => l.id === activeLayerId) || ARCHITECTURE_LAYERS[0];

  return (
    <div className="whisper-arch-overlay" onClick={onClose}>
      <div className="whisper-arch-modal" onClick={e => e.stopPropagation()}>
        {/* Modal Top Header */}
        <div className="whisper-arch-top">
          <div className="whisper-arch-title-box">
            <span className="whisper-arch-badge">🏛️ SOTA HYBRID PIPELINE</span>
            <h3 className="whisper-arch-title">
              {lang === 'vi' ? 'Kiến Trúc Đa Tầng AI Whisper' : 'Whisper Multi-Layer Architecture'}
            </h3>
          </div>
          <button type="button" className="btn-close-arch" onClick={onClose}>✕</button>
        </div>

        {/* Interactive Architecture Map / Diagram */}
        <div className="arch-flow-pipeline">
          {ARCHITECTURE_LAYERS.map((layer, idx) => (
            <React.Fragment key={layer.id}>
              <div
                className={`arch-node-card ${activeLayerId === layer.id ? 'active' : ''}`}
                onClick={() => setActiveLayerId(layer.id)}
                style={{ borderColor: activeLayerId === layer.id ? layer.badgeColor : undefined }}
              >
                <div className="node-icon-box" style={{ background: `${layer.badgeColor}20`, color: layer.badgeColor }}>
                  {layer.icon}
                </div>
                <div className="node-info">
                  <span className="node-level">{layer.level.split('•')[0]}</span>
                  <span className="node-name">{layer.name}</span>
                </div>
                {activeLayerId === layer.id && (
                  <div className="node-active-indicator" style={{ background: layer.badgeColor }}></div>
                )}
              </div>
              {idx < ARCHITECTURE_LAYERS.length - 1 && (
                <div className="arch-connector-arrow">
                  <span>➔</span>
                </div>
              )}
            </React.Fragment>
          ))}
        </div>

        {/* Selected Layer Deep Dive Card */}
        <div className="arch-detail-panel" style={{ borderLeftColor: activeLayer.badgeColor }}>
          <div className="detail-panel-header">
            <div>
              <span className="detail-tag" style={{ background: `${activeLayer.badgeColor}20`, color: activeLayer.badgeColor }}>
                {activeLayer.badge}
              </span>
              <h4 className="detail-name">{activeLayer.name}</h4>
              <span className="detail-tech">{activeLayer.tech}</span>
            </div>
            <div className="detail-latency-pill">
              <span className="latency-label">Độ Trễ:</span>
              <span className="latency-val" style={{ color: activeLayer.badgeColor }}>{activeLayer.latency}</span>
            </div>
          </div>

          <p className="detail-summary">
            {lang === 'vi' ? activeLayer.summaryVi : activeLayer.summaryEn}
          </p>

          <div className="detail-features-box">
            <span className="features-title">⚙️ Đặc điểm kỹ thuật & Tối ưu hoá:</span>
            <ul className="features-list">
              {activeLayer.details.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          </div>
        </div>

        {/* Bottom Footer Info */}
        <div className="whisper-arch-footer">
          <div className="arch-footer-status">
            <span className="status-pulse-dot"></span>
            <span>Trạng thái hệ thống: Tự động cân bằng tải & Chuyển đổi dự phòng (Auto-Failover 100% Sẵn Sàng)</span>
          </div>
          <button type="button" className="btn-arch-done" onClick={onClose}>
            {lang === 'vi' ? 'Đã Hiểu' : 'Got it'}
          </button>
        </div>
      </div>
    </div>
  );
}
