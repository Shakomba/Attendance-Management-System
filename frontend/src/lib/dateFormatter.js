export function formatDate(date, lang, useDefaultEn = false) {
  if (!date) return '';
  
  if (lang === 'ckb') {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Baghdad', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
    const d = parts.find(p => p.type === 'day').value;
    const m = parts.find(p => p.type === 'month').value;
    const y = parts.find(p => p.type === 'year').value;
    return `${d}/${m}/${y}`;
  }
  if (useDefaultEn) {
    return date.toLocaleDateString('en-US', { timeZone: 'Asia/Baghdad' });
  }
  return date.toLocaleDateString(undefined, { timeZone: 'Asia/Baghdad', weekday: 'short', month: 'short', day: 'numeric' });
}

export function formatTime(date, lang, useFull = false) {
  if (!date) return '';
  
  if (lang === 'ckb') {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Baghdad', hourCycle: 'h23', hour: 'numeric', minute: '2-digit', second: '2-digit' }).formatToParts(date);
    let hours = parseInt(parts.find(p => p.type === 'hour').value, 10);
    let minutes = parts.find(p => p.type === 'minute').value;
    let seconds = parts.find(p => p.type === 'second')?.value || '00';
    
    let ampm = hours >= 12 ? 'د.ن' : 'پ.ن';
    hours = hours % 12;
    hours = hours ? hours : 12; 
    let hStr = hours.toString().padStart(2, '0');
    
    if (useFull) {
        return `${hStr}:${minutes}:${seconds} ${ampm}`;
    }
    return `${hStr}:${minutes} ${ampm}`;
  }
  
  if (useFull) {
      return date.toLocaleTimeString(undefined, { timeZone: 'Asia/Baghdad' });
  }
  return date.toLocaleTimeString(undefined, { timeZone: 'Asia/Baghdad', hour: '2-digit', minute: '2-digit' });
}

export function formatDuration(ms, lang) {
  if (ms == null) return '';
  const tSecs = Math.floor(ms / 1000);
  const h = Math.floor(tSecs / 3600);
  const m = Math.floor((tSecs % 3600) / 60);
  const s = tSecs % 60;
  
  if (lang === 'ckb') {
    if (h > 0) {
      if (m > 0) return `${h}ک ${m}خ`;
      return `${h}ک`;
    }
    if (m > 0) return `${m}خ`;
    return `${s}چ`;
  }
  
  if (h > 0) {
    if (m > 0) return `${h}h ${m}m`;
    return `${h}h`;
  }
  if (m > 0) return `${m}m`;
  return `${s}s`;
}
