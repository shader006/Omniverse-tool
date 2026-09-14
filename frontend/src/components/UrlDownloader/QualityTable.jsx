import React from 'react';
import { translations } from '../../locales/translations';

export default function QualityTable({ activeTab, onDownload, downloadingKey, completedKey, downloadUrl, lang = 'vi' }) {
  const tr = translations[lang] || translations.vi;

  const formatRows = {
    mp3: [
      { quality: '320', title: '320 kbps', sub: tr.url_sub_extreme, format: 'mp3' },
      { quality: '256', title: '256 kbps', sub: tr.url_sub_very_good, format: 'mp3' },
      { quality: '192', title: '192 kbps', sub: tr.url_sub_standard, format: 'mp3' },
      { quality: '128', title: '128 kbps', sub: tr.url_sub_economy, format: 'mp3' }
    ],
    mp4: [
      { quality: '1080', title: '1080p', sub: 'Full HD (1080p)', format: 'mp4' },
      { quality: '720', title: '720p', sub: 'HD (720p)', format: 'mp4' },
      { quality: '480', title: '480p', sub: 'SD (480p)', format: 'mp4' },
      { quality: '360', title: '360p', sub: 'Medium (360p)', format: 'mp4' }
    ]
  };

  const rows = formatRows[activeTab] || formatRows.mp3;

  return (
    <div className="table-responsive">
      <table className="quality-table">
        <thead>
          <tr>
            <th className="col-quality">{tr.url_table_quality}</th>
            <th className="col-format">{tr.url_table_format}</th>
            <th className="col-action">{tr.url_table_action}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const key = `${row.format}-${row.quality}`;
            const isDownloading = downloadingKey === key;
            const isCompleted = completedKey === key;
            const anyDownloading = Boolean(downloadingKey);

            return (
              <tr key={key}>
                <td className="col-quality">
                  <div className="quality-title">{row.title}</div>
                  <div className="quality-sub">{row.sub}</div>
                </td>
                <td className="col-format">{row.format}</td>
                <td className="col-action">
                  {isCompleted && downloadUrl ? (
                    <a
                      href={downloadUrl}
                      download
                      className="btn-table-action"
                      style={{ background: '#10b981', color: '#fff', textDecoration: 'none' }}
                    >
                      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                        <polyline points="7 10 12 15 17 10"></polyline>
                        <line x1="12" y1="15" x2="12" y2="3"></line>
                      </svg>
                      <span>{tr.url_table_save_btn}</span>
                    </a>
                  ) : (
                    <button
                      type="button"
                      className={`btn-table-action ${isDownloading ? 'loading' : ''}`}
                      disabled={anyDownloading}
                      onClick={() => onDownload(row.format, row.quality)}
                    >
                      {isDownloading ? (
                        <>
                          <div className="spinner" style={{ width: '14px', height: '14px', borderWidth: '2px' }}></div>
                          <span>{tr.url_table_processing}</span>
                        </>
                      ) : (
                        <>
                          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                            <polyline points="7 10 12 15 17 10"></polyline>
                            <line x1="12" y1="15" x2="12" y2="3"></line>
                          </svg>
                          <span>{tr.url_table_download_btn}</span>
                        </>
                      )}
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
