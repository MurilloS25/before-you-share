# Deployment (deferred: nothing is deployed)

This is a guide for later. No deployment, hosting account or service was created.

The app is plain static files in `dist/` (`npm run build`). Any static host works if it sends the security
headers on **every** response, including the worker script. A meta tag is not enough: the worker's own
response needs the header. The headers are defined once in `vite.config.ts` (`SECURITY_HEADERS`) and are
what `npm run preview` sends.

## Vercel Hobby (example, not executed)

`vercel.json` would contain:

```json
{
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "Content-Security-Policy", "value": "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' blob:; font-src 'self'; worker-src 'self'; connect-src 'none'; manifest-src 'none'; media-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" },
        { "key": "X-Content-Type-Options", "value": "nosniff" },
        { "key": "Referrer-Policy", "value": "no-referrer" },
        { "key": "Permissions-Policy", "value": "camera=(), microphone=(), geolocation=(), interest-cohort=()" },
        { "key": "Cross-Origin-Opener-Policy", "value": "same-origin" },
        { "key": "Cross-Origin-Resource-Policy", "value": "same-origin" }
      ]
    }
  ]
}
```

`tests/deployment-doc.test.ts` keeps this block identical to the headers the preview server sends.

Settings: framework preset "Other", build command `npm run build`, output directory `dist`, no
environment variables, no serverless functions, no analytics or Speed Insights integrations, no
preview-comment tools.

Before using any host, verify against its current documentation: that static hosting stays within its
free limits for the expected traffic, what happens when limits are reached (pausing versus charging), and
that the headers above are applied to `/assets/*` worker files. These points were **not** verified in
this work.

After deploying, repeat the privacy checks against the real URL: response headers on `/` and on the
worker script, no requests other than the site's own assets (Network panel), and `npm run test:e2e`
adapted to that origin.

Alternatives with header support: Cloudflare Pages (`_headers` file), Netlify (`_headers`). GitHub Pages
cannot set response headers, so it is not suitable.
