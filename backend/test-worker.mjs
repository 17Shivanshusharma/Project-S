// Tests for backend/worker.js with a fake Google server (run: node backend/test-worker.mjs)
import worker, { _test } from "./worker.js";

const env = { GEMINI_KEY: "AIzaTEST_SECRET_KEY", ALLOWED_ORIGINS: "https://17shivanshusharma.github.io,null", PER_MINUTE: "3" };
const seen = [];
const fakeGoogle = async (url, init) => {
  seen.push({ url, key: init.headers["x-goog-api-key"], size: init.body.byteLength });
  return new Response('data: {"candidates":[{"content":{"parts":[{"text":"hi"}]}}]}\n\n', { status: 200, headers: { "Content-Type": "text/event-stream" } });
};
const req = (path, { method = "POST", origin = "https://17shivanshusharma.github.io", body = "{}", ip = "1.1.1.1", headers = {} } = {}) =>
  new Request("https://s.example.workers.dev" + path, { method, headers: { Origin: origin, "CF-Connecting-IP": ip, ...headers }, body: method === "POST" ? body : undefined });
const call = (r, e = env) => worker.fetch(r, e, {}, fakeGoogle);
const results = [];
const check = (name, ok, extra = "") => results.push(`${ok ? "PASS" : "FAIL"} ${name}${extra ? " (" + extra + ")" : ""}`);

let r = await call(req("/v1beta/models/gemini-3.5-flash-lite:streamGenerateContent?alt=sse"));
const text = await r.text();
check("stream request is forwarded", r.status === 200 && text.includes('"hi"'));
check("key is added on the server", seen[0]?.key === env.GEMINI_KEY && seen[0].url.endsWith(":streamGenerateContent?alt=sse"));
check("key is not in the response", !text.includes(env.GEMINI_KEY) && ![...r.headers.values()].some((v) => v.includes(env.GEMINI_KEY)));
check("CORS header for allowed origin", r.headers.get("Access-Control-Allow-Origin") === "https://17shivanshusharma.github.io");

r = await call(req("/v1beta/models/gemini-3.5-flash-lite:generateContent", { origin: "https://evil.example" }));
check("other websites are blocked", r.status === 403);
r = await call(req("/v1beta/models/gemini-3.5-flash-lite:generateContent", { origin: "null", ip: "2.2.2.2" }));
check("file:// (Origin null) works when allowed", r.status === 200);
r = await call(req("/v1beta/models/gemini-9-ultra:generateContent", { ip: "3.3.3.3" }));
check("unknown model is refused", r.status === 400);
r = await call(req("/v1beta/models/gemini-3.5-flash-lite:generateContent", { ip: "4.4.4.4", body: "x".repeat(2000) }), { ...env, MAX_BODY: "1000" });
check("too-large body is refused", r.status === 413);
r = await call(req("/v1beta/models", { method: "GET", ip: "5.5.5.5" }));
check("GET models works for the Test button", r.status === 200 && (await r.json()).models.length > 0);
r = await call(req("/v1beta/models", { method: "OPTIONS", ip: "6.6.6.6" }));
check("CORS preflight", r.status === 204 && r.headers.get("Access-Control-Allow-Methods").includes("POST"));
r = await call(req("/other", { ip: "7.7.7.7" }));
check("other paths 404", r.status === 404);
r = await call(req("/v1beta/models", { method: "GET", ip: "5.5.5.5" }), { ...env, GEMINI_KEY: "" });
check("missing secret gives a clear error", r.status === 500);

_test.hits.clear();
const codes = [];
for (let i = 0; i < 5; i++) codes.push((await call(req("/v1beta/models/gemini-3.5-flash-lite:generateContent", { ip: "9.9.9.9" }))).status);
check("rate limit per IP (3/min)", codes.join(",") === "200,200,200,429,429", codes.join(","));
r = await call(req("/v1beta/models/gemini-3.5-flash-lite:generateContent", { ip: "9.9.9.9" }));
check("Retry-After header on 429", r.status === 429 && +r.headers.get("Retry-After") > 0);

console.log(results.join("\n"));
console.log(`${results.filter((x) => x.startsWith("PASS")).length}/${results.length} passed`);
