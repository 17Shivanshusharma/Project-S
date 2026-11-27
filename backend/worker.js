// Project S: optional Gemini proxy for Cloudflare Workers (free plan).
//
// Why: in the normal app, each user's Gemini key is stored in their own browser. With this
// Worker, the key lives on YOUR server (as a secret) and never reaches the phone.
//
// Setup (Hinglish steps in docs/BACKEND.md):
//   1. Cloudflare dashboard → Workers → Create → paste this file → Deploy.
//   2. Settings → Variables → add a SECRET named GEMINI_KEY (your key from aistudio.google.com).
//   3. Add a variable ALLOWED_ORIGINS, e.g. "https://17shivanshusharma.github.io".
//      To use S.html opened from a file on your phone, also add "null" (file:// pages send Origin: null).
//   4. In S: Settings → AI → "Apna server" → paste https://<name>.<you>.workers.dev
//
// What it protects: the key (never sent to the browser), which models can be used, request size,
// and how many requests one IP can make per minute.
// Limits of this simple version (be honest about them):
//   - The rate limit is counted per Worker instance in memory. Cloudflare can run several
//     instances, so it's a soft limit. For a strict limit use Cloudflare's Rate Limiting binding or KV.
//   - Anyone who can load an allowed page can use your quota through it (that's how a public app works).
//     Origin checks stop other websites, not scripts that fake the Origin header.

const DEFAULT_MODELS = ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-3.6-flash", "gemini-3.8-flash"];
const DEFAULT_MAX_BODY = 20_000_000; // bytes (photos/PDFs are sent as base64)
const DEFAULT_PER_MINUTE = 20;
const hits = new Map(); // ip -> [timestamps]

function list(v, fallback) {
  const out = String(v || "").split(",").map((x) => x.trim()).filter(Boolean);
  return out.length ? out : fallback;
}

function cors(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function json(status, body, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { ...headers, "Content-Type": "application/json" } });
}

function limited(ip, perMinute, now = Date.now()) {
  const list = (hits.get(ip) || []).filter((t) => now - t < 60_000);
  if (list.length >= perMinute) {
    hits.set(ip, list);
    return Math.ceil((60_000 - (now - list[0])) / 1000);
  }
  list.push(now);
  hits.set(ip, list);
  if (hits.size > 5000) hits.clear(); // keep memory small
  return 0;
}

export default {
  async fetch(request, env, ctx, upstream = fetch) {
    const origin = request.headers.get("Origin") || "";
    const allowed = list(env.ALLOWED_ORIGINS, []);
    if (!allowed.includes(origin)) return json(403, { error: { message: "This origin is not allowed to use this server." } });
    const h = cors(origin);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: h });
    if (!env.GEMINI_KEY) return json(500, { error: { message: "Server has no GEMINI_KEY secret." } }, h);

    const url = new URL(request.url);
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    const wait = limited(ip, Number(env.PER_MINUTE) || DEFAULT_PER_MINUTE);
    if (wait) return json(429, { error: { message: `Too many requests. Try again in ${wait} seconds.` } }, { ...h, "Retry-After": String(wait) });

    // GET /v1beta/models: lets the app's "Test" button check the server is up.
    if (request.method === "GET" && url.pathname === "/v1beta/models") {
      return json(200, { models: list(env.MODELS, DEFAULT_MODELS).map((m) => ({ name: "models/" + m })) }, h);
    }

    const m = url.pathname.match(/^\/v1beta\/models\/([\w.-]+):(streamGenerateContent|generateContent)$/);
    if (request.method !== "POST" || !m) return json(404, { error: { message: "Not found." } }, h);
    const [, model, method] = m;
    if (!list(env.MODELS, DEFAULT_MODELS).includes(model)) return json(400, { error: { message: `Model ${model} is not allowed on this server.` } }, h);

    const max = Number(env.MAX_BODY) || DEFAULT_MAX_BODY;
    if (Number(request.headers.get("Content-Length") || 0) > max) return json(413, { error: { message: "Request too large." } }, h);
    const body = await request.arrayBuffer();
    if (body.byteLength > max) return json(413, { error: { message: "Request too large." } }, h);

    const target = `https://generativelanguage.googleapis.com/v1beta/models/${model}:${method}${method === "streamGenerateContent" ? "?alt=sse" : ""}`;
    const res = await upstream(target, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_KEY },
      body,
    });
    // Stream Google's answer straight back. The key is never in the response.
    const out = new Headers(h);
    out.set("Content-Type", res.headers.get("Content-Type") || "application/json");
    return new Response(res.body, { status: res.status, headers: out });
  },
};

export const _test = { hits, limited };
