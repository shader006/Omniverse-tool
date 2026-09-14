import React from 'react';
import { translations } from '../locales/translations';

export default function FeaturesGrid({ lang = 'vi' }) {
  const tr = translations[lang] || translations.vi;

  return (
    <section className="features-grid">
      <div className="feature-card">
        <div className="feature-icon">⚡</div>
        <h3>{tr.features_title1}</h3>
        <p>{tr.features_desc1}</p>
      </div>
      <div className="feature-card">
        <div className="feature-icon">📄</div>
        <h3>{tr.features_title2}</h3>
        <p>{tr.features_desc2}</p>
      </div>
      <div className="feature-card">
        <div className="feature-icon">🎵</div>
        <h3>{tr.features_title3}</h3>
        <p>{tr.features_desc3}</p>
      </div>
    </section>
  );
}
