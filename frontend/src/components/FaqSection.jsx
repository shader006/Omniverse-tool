import React from 'react';
import { translations } from '../locales/translations';

export default function FaqSection({ lang = 'vi' }) {
  const tr = translations[lang] || translations.vi;

  return (
    <section className="seo-section" id="faq-section">
      <h2 className="seo-title">{tr.faq_title}</h2>
      <div className="faq-grid">
        <article className="faq-card">
          <h3><span>📌</span> {tr.faq_q1}</h3>
          <p>{tr.faq_a1}</p>
        </article>
        <article className="faq-card">
          <h3><span>📄</span> {tr.faq_q2}</h3>
          <p>{tr.faq_a2}</p>
        </article>
        <article className="faq-card">
          <h3><span>🎙️</span> {tr.faq_q3}</h3>
          <p>{tr.faq_a3}</p>
        </article>
        <article className="faq-card">
          <h3><span>✨</span> {tr.faq_q4}</h3>
          <p>{tr.faq_a4}</p>
        </article>
      </div>
    </section>
  );
}
