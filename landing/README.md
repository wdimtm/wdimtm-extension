# WDIMTM landing page

Static marketing site for [WDIMTM](https://github.com/jerryleooo/wdimtm) — production root for [wdimtm.com](https://wdimtm.com).

## Local

From repo root:

```bash
npm run landing
# → http://127.0.0.1:4174/
```

## i18n

English + 简体中文 (matches extension locales `en` / `zh_CN`).

- Auto: `?lang=en|zh` → `localStorage` → browser language
- Toggle: header **EN / 中文**
- Strings live in [`i18n.js`](./i18n.js); mark copy with `data-i18n` / `data-i18n-html` / `data-i18n-aria`

## Deploy

Served as a Cloudflare Worker with static assets (`wrangler.jsonc`).

```bash
# from repo root
npx wrangler deploy --config landing/wrangler.jsonc
```

- Production: https://wdimtm.com (also `www.wdimtm.com`)
- Preview: https://wdimtm.whilgeek.workers.dev

No build step required. Public assets only — `wrangler.jsonc` / this README are excluded via `.assetsignore`.
