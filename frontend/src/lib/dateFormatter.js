export function formatDate(date, lang, useDefaultEn = false) {
  if (!date) return '';
  if (lang === 'ckb') {
    const d = date.getDate().toString().padStart(2, '0');
    const m = (date.getMonth() + 1).toString().padStart(2, '0');
    const y = date.getFullYear();
    return `${d}/${m}/${y}`;
  }
  if (useDefaultEn) {
    return date.toLocaleDateString();
  }
  return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

export function formatTime(date, lang, useFull = false) {
  if (!date) return '';
  
  if (lang === 'ckb') {
    let hours = date.getHours();
    let minutes = date.getMinutes().toString().padStart(2, '0');
    let seconds = date.getSeconds().toString().padStart(2, '0');
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
      return date.toLocaleTimeString();
  }
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
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
