# Optional backend: keep the Gemini key on your own server

Project S works with **no server**: each user pastes their own key and it stays in their browser. That is simple and free, but a key in a browser is never fully safe (anyone using the device, or a harmful extension, can read it).

If you want the key **off the phone**, run the small server in [`backend/worker.js`](../backend/worker.js) on Cloudflare Workers (free plan). S then talks to your server, and your server talks to Google with the key.

```
Phone (S)  ──►  your Worker (holds GEMINI_KEY, checks origin / model / size / rate)  ──►  Google Gemini
```

## What it does

| Protection | How |
|---|---|
| Key never reaches the browser | Stored as a Cloudflare **secret** `GEMINI_KEY`, added on the server side only |
| Only your app can call it | `ALLOWED_ORIGINS` list (e.g. `https://17shivanshusharma.github.io`). Add `null` to allow S.html opened from a file |
| Only chosen models | Model allowlist (`MODELS`, default: the free Gemini models S uses) |
| No huge uploads | `MAX_BODY` (default 20 MB) |
| Rate limit | `PER_MINUTE` per IP (default 20) |

## Honest limits

- The rate limit is counted per Worker instance in memory, so it's a soft limit. For a strict one, use Cloudflare's Rate Limiting binding or KV.
- The origin check stops other websites, not someone who writes their own script and fakes the header. Anyone who can use your public app can use your quota through it. Keep Google's own quota limits on the key.
- Only **Gemini** goes through this server. OpenRouter and Claude keys still stay in the browser if you use them.
- There is no login and no cloud sync. Chats still live only in each user's browser.

## Setup (Hinglish, about 10 minutes)

1. [dash.cloudflare.com](https://dash.cloudflare.com) pe free account banao.
2. **Workers & Pages → Create → Create Worker** → naam do (jaise `s-proxy`) → **Deploy**.
3. **Edit code** → saara code hata ke `backend/worker.js` paste karo → **Deploy**.
4. Worker ki **Settings → Variables and Secrets**:
   - `GEMINI_KEY` → type **Secret** → apni key (aistudio.google.com/apikey se).
   - `ALLOWED_ORIGINS` → `https://17shivanshusharma.github.io` (file se S.html kholte ho to `,null` bhi jodo).
   - Optional: `PER_MINUTE` (jaise `20`), `MODELS`, `MAX_BODY`.
5. URL copy karo, jaise `https://s-proxy.tumhara-naam.workers.dev`.
6. S → ⚙ Settings → 🤖 AI → **Apna server** mein URL paste karo, Gemini key ka box khaali chhod do → Save → 🔌 Test key.

S only accepts `https://….workers.dev` addresses here, because its Content Security Policy only allows those (plus the official AI servers).

## Tests

`node backend/test-worker.mjs` runs the Worker against a fake Google server: forwarding, key added on the server and not returned, CORS, blocked origins, `Origin: null`, model allowlist, size limit, rate limit with `Retry-After`, preflight, missing secret. 14/14 passed on 27 Nov 2026. It has **not** been deployed to a real Cloudflare account from here.
