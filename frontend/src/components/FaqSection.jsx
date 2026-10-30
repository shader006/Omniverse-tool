import React, { useState } from 'react';
import { translations } from '../locales/translations';

const EXTRA_FAQS = {
  vi: [
    {
      q: 'Omniverse có miễn phí hoàn toàn không?',
      a: 'Có. Tất cả công cụ trên Omniverse đều miễn phí, không cần cài đặt, không giới hạn số lần sử dụng. Chỉ cần trình duyệt web là đủ.',
      icon: '🆓',
    },
    {
      q: 'Omniverse có tải được video TikTok không watermark không?',
      a: 'Có. Omniverse hỗ trợ tải video TikTok, Facebook Reels, YouTube Shorts sang MP4 và MP3 với nhiều mức chất lượng, hoàn toàn không watermark.',
      icon: '🎬',
    },
  ],
  en: [
    {
      q: 'Is Omniverse completely free?',
      a: 'Yes. All tools on Omniverse are completely free, no installation needed, unlimited usage. Just a web browser is enough.',
      icon: '🆓',
    },
    {
      q: 'Can Omniverse download TikTok videos without watermark?',
      a: 'Yes. Omniverse supports downloading TikTok, Facebook Reels, YouTube Shorts to MP4 and MP3 in multiple quality levels, completely watermark-free.',
      icon: '🎬',
    },
  ],
};

function FaqAccordionItem({ icon, question, answer, isOpen, onToggle, index }) {
  return (
    <article className="faq-accordion-item" itemScope itemType="https://schema.org/Question">
      <button
        className={`faq-accordion-btn${isOpen ? ' open' : ''}`}
        onClick={onToggle}
        aria-expanded={isOpen}
        aria-controls={`faq-answer-${index}`}
        id={`faq-question-${index}`}
      >
        <span className="faq-accordion-icon">{icon}</span>
        <h3 className="faq-accordion-q" itemProp="name">{question}</h3>
        <span className={`faq-accordion-chevron${isOpen ? ' rotated' : ''}`}>▼</span>
      </button>
      <div
        id={`faq-answer-${index}`}
        role="region"
        aria-labelledby={`faq-question-${index}`}
        className={`faq-accordion-body${isOpen ? ' expanded' : ''}`}
        itemScope
        itemType="https://schema.org/Answer"
      >
        <p itemProp="text">{answer}</p>
      </div>
    </article>
  );
}

export default function FaqSection({ lang = 'vi' }) {
  const tr = translations[lang] || translations.vi;
  const extraFaqs = EXTRA_FAQS[lang] || EXTRA_FAQS.vi;

  const allFaqs = [
    { icon: '📌', q: tr.faq_q1, a: tr.faq_a1 },
    { icon: '📄', q: tr.faq_q2, a: tr.faq_a2 },
    { icon: '🎙️', q: tr.faq_q3, a: tr.faq_a3 },
    { icon: '✨', q: tr.faq_q4, a: tr.faq_a4 },
    ...extraFaqs.map((f) => ({ icon: f.icon, q: f.q, a: f.a })),
  ];

  const [openIndex, setOpenIndex] = useState(0);

  const toggle = (i) => setOpenIndex(openIndex === i ? null : i);

  return (
    <section
      className="seo-section faq-section-enhanced"
      id="faq-section"
      aria-label={lang === 'vi' ? 'Câu hỏi thường gặp' : 'Frequently Asked Questions'}
      itemScope
      itemType="https://schema.org/FAQPage"
    >
      <h2 className="seo-title faq-title-pixel">{tr.faq_title}</h2>
      <p className="faq-subtitle-pixel">
        {lang === 'vi'
          ? 'Tìm hiểu cách sử dụng từng công cụ và mẹo tối ưu hiệu quả nhất.'
          : 'Learn how to use each tool and get the most out of Omniverse.'}
      </p>
      <div className="faq-accordion" role="list">
        {allFaqs.map((faq, i) => (
          <FaqAccordionItem
            key={i}
            index={i}
            icon={faq.icon}
            question={faq.q}
            answer={faq.a}
            isOpen={openIndex === i}
            onToggle={() => toggle(i)}
          />
        ))}
      </div>
    </section>
  );
}
