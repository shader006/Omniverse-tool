export function formatFileBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

export function formatDuration(sec) {
  if (!sec || isNaN(sec)) return '00:00';
  const s = Math.round(sec);
  const m = Math.floor(s / 60);
  const remS = s % 60;
  return `${m.toString().padStart(2, '0')}:${remS.toString().padStart(2, '0')}`;
}

export function formatDurationHuman(sec) {
  if (!sec || isNaN(sec)) return '0s';
  const s = Math.round(sec);
  const m = Math.floor(s / 60);
  const remS = s % 60;
  return m > 0 ? `${m}m ${remS}s` : `${sec}s`;
}
