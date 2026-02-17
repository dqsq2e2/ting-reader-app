export const getCoverUrl = (url?: string, libraryId?: string, bookId?: string) => {
  const storedActiveUrl = localStorage.getItem('active_url');
  const storedServerUrl = localStorage.getItem('server_url');
  const API_BASE_URL = storedActiveUrl || storedServerUrl || import.meta.env.VITE_API_BASE_URL || (import.meta.env.PROD ? '' : 'http://localhost:3000');
  const token = localStorage.getItem('auth_token');
  const hasElectron = typeof (window as { electronAPI?: unknown }).electronAPI !== 'undefined';
  
  if (!url) return '/placeholder-cover.png';
  if (url.startsWith('http')) {
    if (hasElectron && bookId) {
       return `ting://cover/${bookId}?remote=${encodeURIComponent(url)}`;
    }
    return url;
  }
  if (!libraryId) return url;
  
  let coverUrl = `${API_BASE_URL}/api/proxy/cover?path=${encodeURIComponent(url)}&libraryId=${libraryId}`;
  
  if (url === 'embedded://first-chapter' && bookId) {
    coverUrl += `&bookId=${bookId}`;
  }
  
  if (token) {
    coverUrl += `&token=${token}`;
  }

  if (hasElectron && bookId) {
      return `ting://cover/${bookId}?remote=${encodeURIComponent(coverUrl)}`;
  }

  return coverUrl;
};
