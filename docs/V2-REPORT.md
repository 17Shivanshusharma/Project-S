# Project S V2: upgrade report

Date: 27 November 2026 · Created by Shivanshu Sharma

## How the app is built (checked before upgrading)

- One static page (`index.html`), built from `source/` with esbuild, hosted on GitHub Pages. There is no server.
- AI providers: Google Gemini (REST, streaming, tool calls), OpenRouter (free models, no tools), Anthropic Claude (official SDK, tools + web search). Each user enters their own key.
- Storage: chats, Library and files in IndexedDB; settings, memory and keys in localStorage.
- Maths: SymPy running in the browser with Pyodide (Web Worker).
- Web search: Google Search through the user's Gemini key when Google allows it, otherwise Wikipedia + a page reader (r.jina.ai). Claude uses its own web search.

The upgrade kept all of this and built on it. Nothing working was removed.

## Completed in V2

| Area | What was added |
|---|---|
| Modes | Normal, Fast, Reasoning, Coding, Study (levels), Maths, Research (fixed report format, search always on), Writing (styles + language) |
| Chat | Regenerate, edit an earlier question, Retry after errors, Save answer, scroll-to-latest button, empty-answer error, typing dots |
| Sidebar | Date groups, pin, rename, delete (with confirm), search, mode shortcuts, About, hide on desktop |
| Code | Syntax colours (highlight.js, 11 languages), language label, Copy |
| Maths | `plot_graph` tool: SymPy samples the function, the app draws an SVG graph |
| Documents | Word (.docx) reading with no library; long files split into parts and the parts that match the question are sent; Study notes button |
| Voice | Voice chat mode (listen → answer → speak → listen), mic status pill, voice picker, speed, Pause / Resume / Stop |
| Library | Files, Saved answers, Notes; search, rename/edit, delete, export as Markdown; included in backups |
| Memory | On/off, view, edit, delete, add by hand |
| Personalization | Reply language, answer style, study level, writing style |
| Settings | Sections with quick links, Test key, Remove key, storage usage |
| About | Version, features, providers, privacy, "Created by Shivanshu Sharma" |
| Bug fix | The mode menu on laptops was hidden behind the chat area; fixed |

## Tested (automated, in a real Chromium browser)

The AI providers were replaced by test servers that return fixed answers, because no real API key is available in the build environment. SymPy ran for real (the actual Pyodide + SymPy files, served locally).

Passed (31 of 31 V2 checks, plus all older tests):
key test (good and bad key), personalization reaching the AI, regenerate, edit + resend, retry after a server error, code colours, Maths mode, a SymPy graph, Word file text, long-file chunking, Research mode, mode shortcuts, voice chat (with a fake mic and speaker), pin + date groups, rename, chat search, saved answer in Library, new note with maths, note export, memory add + edit, storage info, About page, history after reload, desktop sidebar hide/show, no sideways scrolling on phone and tablet, no page errors. Older tests: subject themes, model fallback, OpenRouter, SymPy with Gemini and Claude, web search sources, backup without keys.

## Not tested here

- Real Gemini / OpenRouter / Claude answers (needs a real key).
- Real Google Search, Wikipedia and page-reader responses (network blocked in the build environment).
- Real microphone and real voices (the test used fake ones). Voice typing depends on the browser: Chrome on Android works best; iPhone Safari supports it on recent iOS.
- Safari / iPhone (no WebKit browser in the build environment).

## Needs an API key

Every AI answer. Gemini is free (daily limits). OpenRouter has free models. Claude is paid. Google Search through Gemini usually needs a key with billing; without it S uses Wikipedia.

## Needs a backend (not built)

Login, syncing chats between devices, one shared key that users can't see, rate limiting and abuse protection. GitHub Pages only hosts static files. A realistic next step is a small serverless backend (for example Cloudflare Workers, Firebase or Supabase, all with free plans) owned by the project.

## Remaining security notes

- Keys live in the user's browser storage. They are not sent to us, but anyone with access to the device or a harmful extension could read them. Users should restrict their Gemini key to the Generative Language API and delete leaked keys.
- The page uses a Content Security Policy that only allows the providers, jsDelivr (maths engine), Wikipedia and r.jina.ai. It still allows inline scripts, because the whole app is one file.
- Pages read with the web reader go through r.jina.ai, a third-party service.

## Deployment

1. `cd source && npm install && npm run build` (writes `out/S.html`).
2. Copy `out/S.html` to `index.html` in the repository root.
3. Push to `main`. GitHub Pages publishes https://17shivanshusharma.github.io/Project-S/ in about a minute.
