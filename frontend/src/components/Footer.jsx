import React from 'react';
import { translations } from '../locales/translations';

export default function Footer({ lang = 'vi' }) {
  const tr = translations[lang] || translations.vi;

  return (
    <footer className="footer">
      <p>{tr.footer_text}</p>
    </footer>
  );
}
