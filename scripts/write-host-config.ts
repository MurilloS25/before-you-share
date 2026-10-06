import { writeFileSync } from 'node:fs';
import { SECURITY_HEADERS } from '../vite.config';

/** Generates host header configuration (Vercel, Cloudflare Pages, Netlify) from the single source of truth in vite.config.ts. */
export function vercelJson(): string {
  return (
    JSON.stringify(
      { headers: [{ source: '/(.*)', headers: Object.entries(SECURITY_HEADERS).map(([key, value]) => ({ key, value })) }] },
      null,
      2,
    ) + '\n'
  );
}

export function headersFile(): string {
  return `/*\n${Object.entries(SECURITY_HEADERS)
    .map(([k, v]) => `  ${k}: ${v}`)
    .join('\n')}\n`;
}

if (process.argv[1] && /write-host-config\.ts$/.test(process.argv[1].split('\\').join('/'))) {
  writeFileSync('vercel.json', vercelJson());
  writeFileSync('public/_headers', headersFile());
  console.log('wrote vercel.json and public/_headers');
}
