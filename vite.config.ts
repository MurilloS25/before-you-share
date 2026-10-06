import { defineConfig, type Plugin } from 'vite';

/**
 * Content Security Policy for the production build. It is also sent as an HTTP header by `vite preview`
 * and must be sent as a header by any host (see docs/DEPLOYMENT.md): a meta tag cannot protect the worker,
 * whose own response needs the header.
 */
export const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' blob:",
  "font-src 'self'",
  "worker-src 'self'",
  "connect-src 'none'",
  "manifest-src 'none'",
  "media-src 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

export const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy': `${CSP}; frame-ancestors 'none'`,
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

function cspMeta(): Plugin {
  return {
    name: 'csp-meta',
    apply: 'build',
    transformIndexHtml: () => [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP }, injectTo: 'head-prepend' }],
  };
}

export default defineConfig({
  base: './',
  plugins: [cspMeta()],
  build: {
    target: 'es2022',
    sourcemap: false,
    assetsInlineLimit: 0, // never inline assets as data: URLs; the CSP does not allow them
    modulePreload: { polyfill: false },
    chunkSizeWarningLimit: 600,
  },
  worker: { format: 'es' },
  server: { host: '127.0.0.1', port: 5173 },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true, headers: SECURITY_HEADERS },
});
