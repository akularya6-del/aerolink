export const API_BASE_URL = typeof window !== 'undefined' && window.location.port !== '3002' 
  ? '/api' // When served statically from Express, the API is at /api
  : 'http://127.0.0.1:3001/api'; // When running via Next.js dev server

export const fetcher = (url: string) => fetch(url).then(res => res.json());
