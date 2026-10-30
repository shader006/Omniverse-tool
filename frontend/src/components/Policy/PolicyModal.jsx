import React, { useState, useEffect, useCallback } from 'react';
import './policy-modal.css';

/* ─── Nội dung chính sách đầy đủ ─── */
const POLICIES = {
  terms: {
    vi: {
      title: 'ĐIỀU KHOẢN SỬ DỤNG',
      subtitle: 'Terms of Service • Hiệu lực: 01/10/2026',
      icon: '📋',
      sections: [
        {
          heading: '1. Chấp Nhận Điều Khoản',
          body: 'Bằng cách truy cập và sử dụng Omniverse (omniversetool.online), bạn xác nhận rằng bạn đã đọc, hiểu và đồng ý bị ràng buộc bởi các Điều khoản Sử dụng này. Nếu bạn không đồng ý, vui lòng ngừng sử dụng dịch vụ ngay lập tức.',
        },
        {
          heading: '2. Mô Tả Dịch Vụ',
          body: 'Omniverse cung cấp bộ công cụ đa phương tiện trực tuyến bao gồm: chuyển đổi URL sang MP3/MP4, chuyển đổi tài liệu văn phòng (PDF/Word/Excel/PowerPoint), nhận dạng giọng nói Whisper AI, xóa phông ảnh AI (BiRefNet), và khôi phục Pixel Art AI.',
        },
        {
          heading: '3. Trách Nhiệm Người Dùng ⚠️',
          highlight: true,
          body: 'Bạn HOÀN TOÀN CHỊU TRÁCH NHIỆM về nội dung mà bạn xử lý thông qua các công cụ của Omniverse. Cụ thể:\n\n• BẢN QUYỀN: Bạn chỉ được phép tải xuống, chuyển đổi hoặc xử lý nội dung mà bạn sở hữu quyền hoặc đã được cấp phép hợp pháp. Việc tải xuống nội dung có bản quyền mà không được phép là hành vi vi phạm pháp luật.\n\n• MỤC ĐÍCH CÁ NHÂN: Các công cụ chuyển đổi URL chỉ được sử dụng cho mục đích cá nhân và phi thương mại.\n\n• NỘI DUNG HỢP PHÁP: Bạn không được xử lý các nội dung vi phạm pháp luật.\n\n• TUỔI TỐI THIỂU: Bạn phải đủ 13 tuổi để sử dụng dịch vụ.',
        },
        {
          heading: '4. Tuyên Bố Miễn Trừ Trách Nhiệm 🛡️',
          highlight: true,
          body: 'Omniverse KHÔNG chịu trách nhiệm về:\n\n• Hành vi của người dùng khi sử dụng các công cụ được cung cấp\n• Bất kỳ vi phạm bản quyền nào do người dùng thực hiện\n• Nội dung mà người dùng tải lên, xử lý hoặc tải xuống\n• Thiệt hại trực tiếp hoặc gián tiếp phát sinh từ việc sử dụng dịch vụ\n• Sự gián đoạn dịch vụ do các yếu tố kỹ thuật ngoài tầm kiểm soát\n• Mất mát dữ liệu trong quá trình xử lý\n\nDịch vụ được cung cấp "NGUYÊN TRẠNG" (as-is) mà không có bất kỳ bảo đảm nào.',
        },
        {
          heading: '5. Giới Hạn Sử Dụng',
          body: 'Bạn không được:\n• Sử dụng dịch vụ để phát tán phần mềm độc hại hoặc tấn công hệ thống\n• Cào dữ liệu (scrape) hoặc tự động hóa yêu cầu với số lượng lớn\n• Bán lại hoặc phân phối thương mại kết quả từ dịch vụ\n• Vượt qua các biện pháp bảo mật của hệ thống',
        },
        {
          heading: '6. Thay Đổi & Luật Điều Chỉnh',
          body: 'Omniverse có quyền thay đổi, tạm ngừng hoặc chấm dứt bất kỳ tính năng nào vào bất kỳ lúc nào. Các điều khoản này được điều chỉnh bởi pháp luật Việt Nam.',
        },
      ],
    },
    en: {
      title: 'TERMS OF SERVICE',
      subtitle: 'Effective: October 01, 2026',
      icon: '📋',
      sections: [
        {
          heading: '1. Acceptance of Terms',
          body: 'By accessing and using Omniverse (omniversetool.online), you confirm that you have read, understood and agree to be bound by these Terms of Service. If you do not agree, please stop using the service immediately.',
        },
        {
          heading: '2. Service Description',
          body: 'Omniverse provides an online multimedia toolkit including: URL to MP3/MP4 conversion, office document conversion (PDF/Word/Excel/PowerPoint), Whisper AI speech recognition, AI background removal (BiRefNet), and Pixel Art AI restoration.',
        },
        {
          heading: '3. User Responsibility ⚠️',
          highlight: true,
          body: 'You are SOLELY RESPONSIBLE for any content you process through Omniverse tools. Specifically:\n\n• COPYRIGHT: You may only download, convert or process content you own or have been legally licensed to use. Downloading copyrighted content without permission is illegal in many countries.\n\n• PERSONAL USE: URL conversion tools are for personal and non-commercial use only.\n\n• LEGAL CONTENT: You may not process any content that violates applicable law.\n\n• MINIMUM AGE: You must be at least 13 years old to use the service.',
        },
        {
          heading: '4. Disclaimer of Liability 🛡️',
          highlight: true,
          body: 'Omniverse is NOT responsible for:\n\n• User conduct when using the provided tools\n• Any copyright infringement committed by users\n• Content that users upload, process or download\n• Direct or indirect damages arising from use of the service\n• Service interruptions due to technical factors beyond our control\n• Data loss during processing\n\nThe service is provided "AS-IS" without any warranty, express or implied.',
        },
        {
          heading: '5. Prohibited Uses',
          body: 'You may not:\n• Use the service to distribute malware or attack systems\n• Scrape data or automate requests in large volumes\n• Resell or commercially distribute results from the service\n• Bypass security measures of the system',
        },
        {
          heading: '6. Changes & Governing Law',
          body: 'Omniverse reserves the right to modify, suspend or terminate any feature at any time. These terms are governed by the laws of Vietnam.',
        },
      ],
    },
  },
  privacy: {
    vi: {
      title: 'CHÍNH SÁCH BẢO MẬT',
      subtitle: 'Privacy Policy • Hiệu lực: 01/10/2026',
      icon: '🔒',
      sections: [
        {
          heading: '1. Dữ Liệu Chúng Tôi Thu Thập',
          body: 'KHI BẠN TẠO TÀI KHOẢN:\n• Địa chỉ email\n• Tên hiển thị (Display Name) tự chọn\n• Ảnh đại diện (chỉ khi đăng nhập qua Google/GitHub – từ tài khoản của bạn)\n\nKHI BẠN SỬ DỤNG DỊCH VỤ:\n• File bạn tải lên được xử lý TẠM THỜI trong bộ nhớ server và XÓA NGAY sau khi hoàn thành\n• URL bạn dán vào để chuyển đổi\n• Dữ liệu sử dụng ẩn danh (loại công cụ, thời gian xử lý)\n\nDỮ LIỆU KỸ THUẬT TỰ ĐỘNG:\n• Địa chỉ IP, loại trình duyệt, hệ điều hành, thời gian truy cập',
        },
        {
          heading: '2. Cách Chúng Tôi Sử Dụng Dữ Liệu',
          body: '• Cung cấp và duy trì dịch vụ\n• Xác thực danh tính người dùng\n• Cải thiện trải nghiệm và hiệu suất dịch vụ\n• Gửi thông báo quan trọng về dịch vụ (nếu bạn đồng ý)\n• Phân tích ẩn danh để phát triển tính năng mới',
        },
        {
          heading: '3. Chia Sẻ Dữ Liệu',
          body: 'Chúng tôi KHÔNG bán dữ liệu cá nhân của bạn. Dữ liệu có thể được chia sẻ với:\n• Firebase (Google): Dịch vụ xác thực tài khoản\n• Nhà cung cấp hosting: Để vận hành máy chủ\n• Cơ quan pháp luật: Khi được yêu cầu hợp pháp theo pháp luật Việt Nam',
        },
        {
          heading: '4. Cookie & Quảng Cáo',
          body: '• Chúng tôi sử dụng cookie cần thiết để duy trì phiên đăng nhập\n• Mạng quảng cáo bên thứ ba (Adsterra, v.v.) có thể sử dụng cookie theo dõi riêng của họ. Bạn có thể từ chối bằng cách sử dụng trình chặn quảng cáo\n• Chúng tôi không kiểm soát cookie của các mạng quảng cáo',
        },
        {
          heading: '5. Bảo Mật Dữ Liệu',
          body: '• Kết nối HTTPS được mã hóa\n• Mật khẩu được hash bởi Firebase Authentication – chúng tôi không bao giờ lưu mật khẩu dạng thô\n• File xử lý bị xóa ngay sau khi hoàn thành',
        },
        {
          heading: '6. Quyền Của Bạn',
          body: 'Bạn có quyền:\n• TRUY CẬP: Yêu cầu xem dữ liệu chúng tôi lưu về bạn\n• XÓA: Yêu cầu xóa tài khoản và toàn bộ dữ liệu liên quan\n• CHỈNH SỬA: Cập nhật thông tin cá nhân trong cài đặt tài khoản\n\nLiên hệ: contact@omniversetool.online',
        },
        {
          heading: '7. Trẻ Em & Thay Đổi Chính Sách',
          body: 'Dịch vụ không dành cho trẻ em dưới 13 tuổi. Nếu phát hiện tài khoản của trẻ em dưới 13 tuổi, chúng tôi sẽ xóa ngay lập tức.\n\nChúng tôi có thể cập nhật chính sách này. Thông báo sẽ được đăng trên trang web ít nhất 7 ngày trước khi có hiệu lực.',
        },
      ],
    },
    en: {
      title: 'PRIVACY POLICY',
      subtitle: 'Effective: October 01, 2026',
      icon: '🔒',
      sections: [
        {
          heading: '1. Data We Collect',
          body: 'WHEN YOU CREATE AN ACCOUNT:\n• Email address\n• Display Name (optional)\n• Profile photo (only when signing in via Google/GitHub)\n\nWHEN YOU USE THE SERVICE:\n• Files you upload are processed TEMPORARILY in server memory and DELETED IMMEDIATELY after completion\n• URLs you paste for conversion\n• Anonymous usage data (tool type, processing time)\n\nAUTOMATIC TECHNICAL DATA:\n• IP address, browser type, OS, access time',
        },
        {
          heading: '2. How We Use Your Data',
          body: '• Provide and maintain the service\n• Authenticate user identity\n• Improve experience and service performance\n• Send important service notifications (if you consent)\n• Anonymous analytics to develop new features',
        },
        {
          heading: '3. Data Sharing',
          body: 'We do NOT sell your personal data. Data may be shared with:\n• Firebase (Google): Account authentication service\n• Hosting providers: To operate servers\n• Law enforcement: When legally required under Vietnamese law',
        },
        {
          heading: '4. Cookies & Advertising',
          body: '• We use necessary cookies to maintain login sessions\n• Third-party ad networks (Adsterra, etc.) may use their own tracking cookies. You can opt out by using an ad blocker\n• We do not control ad network cookies',
        },
        {
          heading: '5. Data Security',
          body: '• HTTPS encrypted connections\n• Passwords are hashed by Firebase Authentication – we never store raw passwords\n• Processing files are deleted immediately after completion',
        },
        {
          heading: '6. Your Rights',
          body: 'You have the right to:\n• ACCESS: Request to view data we store about you\n• DELETE: Request account and all associated data deletion\n• EDIT: Update personal information in account settings\n\nContact: contact@omniversetool.online',
        },
        {
          heading: '7. Children & Policy Changes',
          body: 'The service is not intended for children under 13. If we detect accounts belonging to children under 13, we will delete them immediately.\n\nWe may update this policy. Notice will be posted on the website at least 7 days before taking effect.',
        },
      ],
    },
  },
  fairuse: {
    vi: {
      title: 'CHÍNH SÁCH SỬ DỤNG CÔNG BẰNG',
      subtitle: 'Fair Use Policy • Hiệu lực: 01/10/2026',
      icon: '⚖️',
      sections: [
        {
          heading: '1. Giới Hạn Kỹ Thuật',
          body: 'Để đảm bảo dịch vụ hoạt động ổn định cho tất cả người dùng:\n• File upload tối đa: 100MB\n• Thời lượng audio/video tối đa: 3 giờ (URL Downloader), 10 phút (Whisper AI)\n• Tốc độ yêu cầu: không được gửi quá 30 yêu cầu/phút',
        },
        {
          heading: '2. Mục Đích Hợp Lệ',
          body: 'Các công cụ tải xuống URL được thiết kế cho các trường hợp hợp pháp:\n• Tải nội dung bạn tự tạo (video/audio của chính bạn)\n• Tải nội dung Creative Commons hoặc Public Domain\n• Tải nội dung đã được chủ sở hữu cấp phép tải xuống\n• Lưu trữ cá nhân nội dung hợp pháp theo quy định pháp luật địa phương',
        },
        {
          heading: '3. Xử Lý Vi Phạm',
          body: 'Omniverse có quyền:\n• Tạm khóa hoặc xóa tài khoản vi phạm điều khoản\n• Báo cáo hành vi vi phạm pháp luật nghiêm trọng cho cơ quan chức năng\n• Từ chối phục vụ các yêu cầu rõ ràng vi phạm bản quyền',
        },
      ],
    },
    en: {
      title: 'FAIR USE POLICY',
      subtitle: 'Effective: October 01, 2026',
      icon: '⚖️',
      sections: [
        {
          heading: '1. Technical Limits',
          body: 'To ensure stable service for all users:\n• Maximum file upload: 100MB\n• Maximum audio/video duration: 3 hours (URL Downloader), 10 minutes (Whisper AI)\n• Request rate: no more than 30 requests/minute',
        },
        {
          heading: '2. Legitimate Purposes',
          body: 'URL download tools are designed for lawful use cases:\n• Downloading content you created yourself\n• Downloading Creative Commons or Public Domain content\n• Downloading content licensed for download by its owner\n• Personal archiving of legally permitted content under local law',
        },
        {
          heading: '3. Violation Handling',
          body: 'Omniverse reserves the right to:\n• Temporarily suspend or delete accounts violating terms\n• Report serious illegal activity to relevant authorities\n• Refuse requests that clearly infringe copyright',
        },
      ],
    },
  },
};

/* ─── PolicyModal Component ─── */
export default function PolicyModal({ type, lang = 'vi', isOpen, onClose }) {
  const [readPercent, setReadPercent] = useState(0);
  const bodyRef = React.useRef(null);

  const data = POLICIES[type]?.[lang] || POLICIES[type]?.vi;

  // Track scroll progress
  const handleScroll = useCallback(() => {
    if (!bodyRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = bodyRef.current;
    const pct = Math.round((scrollTop / (scrollHeight - clientHeight)) * 100);
    setReadPercent(Math.min(100, pct || 0));
  }, []);

  useEffect(() => {
    setReadPercent(0);
  }, [type, isOpen]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  if (!isOpen || !data) return null;

  return (
    <div
      className="policy-overlay"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-label={data.title}
    >
      <div className="policy-modal">
        {/* Header */}
        <div className="policy-modal-header">
          <div className="policy-header-left">
            <span className="policy-header-icon">{data.icon}</span>
            <div>
              <div className="policy-header-title">{data.title}</div>
              <div className="policy-header-sub">{data.subtitle}</div>
            </div>
          </div>
          <button className="policy-close-btn" onClick={onClose} aria-label="Đóng">✕</button>
        </div>

        {/* Read progress bar */}
        <div className="policy-progress-bar" role="progressbar" aria-valuenow={readPercent} aria-valuemin={0} aria-valuemax={100}>
          <div className="policy-progress-fill" style={{ width: `${readPercent}%` }} />
          <span className="policy-progress-label">{readPercent}%</span>
        </div>

        {/* Body */}
        <div className="policy-modal-body" ref={bodyRef} onScroll={handleScroll}>
          {data.sections.map((sec, i) => (
            <div key={i} className={`policy-section${sec.highlight ? ' policy-section--highlight' : ''}`}>
              <h3 className="policy-section-heading">{sec.heading}</h3>
              <p className="policy-section-body">{sec.body}</p>
            </div>
          ))}

          {/* Footer info */}
          <div className="policy-doc-footer">
            <span>© 2026 Omniverse • omniversetool.online</span>
            <span>contact@omniversetool.online</span>
          </div>
        </div>

        {/* Bottom action */}
        <div className="policy-modal-footer">
          <span className="policy-read-note">
            {readPercent < 100
              ? (lang === 'vi' ? '↓ Cuộn xuống để đọc toàn bộ' : '↓ Scroll to read all')
              : (lang === 'vi' ? '✓ Bạn đã đọc toàn bộ!' : '✓ You have read everything!')}
          </span>
          <button className="policy-close-action" onClick={onClose}>
            {lang === 'vi' ? 'Đã hiểu' : 'Got it'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Hook tiện lợi để mở policy từ bất cứ đâu ─── */
export { POLICIES };
