function normalizeApiBase(raw) {
  if (!raw) return '';

  let base = raw.trim();

  // Accept shorthand values like ":3001" or "localhost:3001"
  if (base.startsWith(':')) {
    base = `http://localhost${base}`;
  }

  if (!base.startsWith('http://') && !base.startsWith('https://')) {
    base = `http://${base}`;
  }

  // Ensure no trailing slash (so paths concatenate predictably)
  return base.replace(/\/+$|\/$/g, '');
}

export function getApiBase() {
  // Allow overriding via Vite environment variable (useful for deployment/testing)
  const raw = import.meta.env.VITE_API_BASE;
  const normalized = raw ? normalizeApiBase(raw) : '';

  // Debugging support: log API base decisions (only in dev)
  if (typeof window !== 'undefined' && window.location.hostname === 'localhost') {
    console.debug('[API] VITE_API_BASE raw:', raw, 'normalized:', normalized);
  }

  if (normalized) {
    return normalized;
  }

  if (typeof window === 'undefined') return '';

  const host = window.location.hostname;
  // In dev, we run frontend on 5173/5174 and backend on 3001
  if (host === 'localhost' || host === '127.0.0.1' || host === '') {
    return 'http://localhost:3001';
  }

  // Default: assume proxy is configured (e.g., Vite proxy or production edge)
  return '';
}
