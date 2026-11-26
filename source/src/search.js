// S's web search, done from the browser with no server of its own.
// 1. Google Search through the user's own Gemini key (Gemini "grounding"), when their key allows it.
// 2. Otherwise free sources: Wikipedia search + a reader that opens any web page as text (r.jina.ai).
// Every result carries its source links so S can show them under the answer.

const GOOGLE_OFF_KEY = "s-ai:google-search-off-until";
const READER = "https://r.jina.ai/";

export const WEB_TOOLS = [
  {
    name: "web_search",
    description:
      "Search the web for current or factual information (news, recent events, prices, people, places, dates, facts you are not sure about). Returns short findings with numbered sources. Search again with different words if results are weak.",
    parameters: {
      type: "object",
      properties: { query: { type: "string", description: "What to search for, in English works best" } },
      required: ["query"],
    },
  },
  {
    name: "read_webpage",
    description: "Open a web page by its URL and read its text. Use it for links the user gives, or to read a source in more detail. Call it once per page.",
    parameters: {
      type: "object",
      properties: { url: { type: "string", description: "Full URL starting with http:// or https://" } },
      required: ["url"],
    },
  },
];

const googleOff = () => {
  try {
    return Date.now() < +(localStorage.getItem(GOOGLE_OFF_KEY) || 0);
  } catch {
    return false;
  }
};
const turnGoogleOff = () => {
  try {
    localStorage.setItem(GOOGLE_OFF_KEY, String(Date.now() + 6 * 3600 * 1000)); // try again after 6 hours
  } catch {}
};

const cut = (t, n) => (t.length > n ? t.slice(0, n) + "…" : t);

// Google Search via the user's Gemini key. Returns null if it isn't available on their key.
async function googleSearch(query, geminiKey, model, signal) {
  if (!geminiKey || googleOff()) return null;
  let res;
  try {
    res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json", "x-goog-api-key": geminiKey },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: `Search Google and report the key facts about: ${query}\nGive dates and numbers exactly as the sources say. Be concise.` }] }],
        tools: [{ googleSearch: {} }],
      }),
    });
  } catch {
    if (signal?.aborted) throw new DOMException("Stopped", "AbortError");
    return null;
  }
  if (!res.ok) {
    if ([400, 403, 429].includes(res.status)) turnGoogleOff();
    return null;
  }
  const body = await res.json().catch(() => null);
  const cand = body?.candidates?.[0];
  const text = (cand?.content?.parts || []).map((p) => p.text || "").join("").trim();
  const sources = (cand?.groundingMetadata?.groundingChunks || [])
    .map((c) => c.web)
    .filter((w) => w?.uri)
    .map((w) => ({ title: w.title || w.domain || w.uri, url: w.uri }));
  if (!text) return null;
  return { text, sources, engine: "Google Search" };
}

// Free fallback: Wikipedia (works from any browser, no key).
async function wikipediaSearch(query, signal) {
  const api = "https://en.wikipedia.org/w/api.php?format=json&origin=*&";
  const found = await fetch(api + new URLSearchParams({ action: "query", list: "search", srsearch: query, srlimit: "5" }), { signal }).then((r) => r.json());
  const hits = found?.query?.search || [];
  if (!hits.length) return { text: "No Wikipedia results.", sources: [], engine: "Wikipedia" };
  const titles = hits.slice(0, 3).map((h) => h.title);
  const ex = await fetch(api + new URLSearchParams({ action: "query", prop: "extracts", exintro: "1", explaintext: "1", exlimit: "3", titles: titles.join("|") }), { signal })
    .then((r) => r.json())
    .catch(() => null);
  const extracts = Object.values(ex?.query?.pages || {});
  const sources = hits.map((h) => ({ title: `${h.title} – Wikipedia`, url: `https://en.wikipedia.org/wiki/${encodeURIComponent(h.title.replace(/ /g, "_"))}` }));
  const lines = hits.map((h, i) => {
    const full = extracts.find((p) => p.title === h.title)?.extract;
    const snippet = (full ? cut(full, 1200) : h.snippet.replace(/<[^>]+>/g, "")).trim();
    return `[${i + 1}] ${h.title}: ${snippet}`;
  });
  return { text: lines.join("\n\n"), sources, engine: "Wikipedia" };
}

// Search: Google when the key allows it, else Wikipedia. Never throws (returns a message instead).
export async function webSearch(query, { geminiKey, model, signal } = {}) {
  query = String(query || "").trim();
  if (!query) return { text: "Error: empty search.", sources: [] };
  try {
    const g = await googleSearch(query, geminiKey, model, signal);
    if (g) return g;
  } catch (e) {
    if (signal?.aborted) throw e;
  }
  try {
    const w = await wikipediaSearch(query, signal);
    w.text = "(Searched Wikipedia; it may not have the very latest news.)\n\n" + w.text;
    return w;
  } catch (e) {
    if (signal?.aborted) throw e;
    return { text: "Error: web search isn't reachable right now (check the internet). Answer from your own knowledge and say it may be out of date.", sources: [] };
  }
}

// Read any page as plain text through a free reader service.
export async function readWebpage(url, signal) {
  url = String(url || "").trim();
  if (!/^https?:\/\//i.test(url)) return { text: "Error: give a full URL starting with https://", sources: [] };
  try {
    const res = await fetch(READER + url, { signal, headers: { Accept: "text/plain" } });
    if (!res.ok) throw new Error("HTTP " + res.status);
    let text = await res.text();
    const title = (text.match(/^Title:\s*(.+)$/m) || [])[1] || url;
    text = cut(text, 15000);
    return { text, sources: [{ title, url }] };
  } catch (e) {
    if (signal?.aborted) throw e;
    return { text: `Error: couldn't open ${url} (${e.message}). The site may block readers; try another source.`, sources: [{ title: url, url }] };
  }
}
