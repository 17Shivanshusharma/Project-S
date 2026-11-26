// S: a single-file personal AI assistant.
// Brains: Google Gemini (free), OpenRouter (free backup) or Claude (paid).
import Anthropic from "@anthropic-ai/sdk";
import { marked } from "marked";
import DOMPurify from "dompurify";
import katex from "katex";
import { startStarfield } from "./space.js";
import { playIntro } from "./intro.js";
import { runSympy, sympyLoaded, SYMPY_TOOL } from "./sympy.js";

const NAME = "S";
const $ = (sel) => document.querySelector(sel);

// =====================================================================
// Settings (small, kept in localStorage)
// =====================================================================
const prefs = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem("s-ai:" + key);
      return v == null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem("s-ai:" + key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  },
  del(key) {
    try {
      localStorage.removeItem("s-ai:" + key);
    } catch {}
  },
};

const DEFAULT_SETTINGS = {
  provider: "gemini", // "gemini" (free), "openrouter" (free backup) or "claude"
  geminiKey: "",
  geminiModel: "gemini-3.5-flash-lite",
  openrouterKey: "",
  claudeKey: "",
  model: "claude-opus-5-5",
  effort: "medium",
  webSearch: true,
  voiceLang: "en-IN",
  personality: "",
  sympy: true,
};
const saved = prefs.get("settings", {});
if (saved.apiKey && !saved.claudeKey) saved.claudeKey = saved.apiKey; // from the first version
delete saved.apiKey;
if (!saved.v2) {
  if (saved.geminiModel === "gemini-3.8-flash") saved.geminiModel = "gemini-3.5-flash-lite";
  saved.v2 = true;
}
let settings = { ...DEFAULT_SETTINGS, ...saved };
const activeKey = () =>
  ({ gemini: settings.geminiKey, openrouter: settings.openrouterKey, claude: settings.claudeKey })[settings.provider];
const activeModel = () =>
  ({ gemini: settings.geminiModel, openrouter: "OpenRouter free models", claude: settings.model })[settings.provider];
// Web search costs extra on Gemini, so S only searches when Claude is the brain.
const searchOn = () => settings.provider === "claude" && settings.webSearch;
// The SymPy maths engine is a tool the AI calls. OpenRouter's free models don't all support tools.
const sympyOn = () => settings.sympy && settings.provider !== "openrouter";

function systemPrompt() {
  return `You are ${NAME}, a friendly, brilliant personal AI assistant and tutor, created by Shivanshu Sharma.
You can help with anything: every school and college subject (maths, physics, chemistry, biology, history, geography, civics, economics, English, Hindi, computer science, accounts), competitive exams (JEE, NEET, boards), coding, writing, general knowledge, advice and brainstorming.

How to answer:
- Reply in the same language and style the user writes in. If they write Hinglish, reply in Hinglish (Roman script). If they write Hindi in Devanagari, reply in Hindi.
- Be clear, correct and friendly. Short questions get short answers; hard questions get thorough ones.
- For maths, physics and chemistry problems: solve step by step, show the formula used, then the working, and end with a clearly marked **Final answer**. Double-check calculations.
- Write all maths with LaTeX: inline as $...$ and display equations as $$...$$ on their own lines. Use units in physics answers.
- For theory questions: give a simple explanation first, then key points, and an example or analogy when it helps.
- If the user sends a photo of a question, a page or a diagram, read it carefully and solve or explain what is in it.
- Use Markdown (headings, bullet lists, tables, code blocks with a language tag) when it makes the answer easier to read.
- If you're not sure about something, say so instead of guessing.
- About yourself: you were made by Shivanshu Sharma. If anyone asks who made you, who created you or who your owner is, say Shivanshu Sharma made you. If anyone asks "who is Shivanshu Sharma?", answer that Shivanshu Sharma is the one who made you (in the user's language, e.g. "Shivanshu Sharma ne mujhe banaya hai"). If someone asks which AI model powers you, say S is built by Shivanshu Sharma and currently runs on ${({ gemini: "Google Gemini", openrouter: "free models from OpenRouter", claude: "Anthropic's Claude" })[settings.provider]}.
${sympyOn() ? `- You have a maths engine: the run_sympy tool runs Python with SymPy and returns exact results. Use it for any calculation that isn't trivial (equations and systems, integrals, derivatives, limits, series, differential equations, matrices, simplifying, factorising, big or precise arithmetic) and to double-check final answers. You can call it several times. If it returns an error, fix the code and try again. After using it, still explain the method step by step in normal maths (LaTeX) the way a teacher would, and don't paste the code into your answer: the user can already see it.` : ""}
${searchOn() ? "- You can search the web. Use it for recent events, prices, or facts you are unsure about, and mention your sources." : "- You cannot browse the web, so for very recent news say your information may be out of date."}
${settings.personality ? "\nExtra instructions from your owner:\n" + settings.personality : ""}`;
}

// =====================================================================
// Chats (IndexedDB: room for thousands of chats, photos and PDFs)
// =====================================================================
const db = (() => {
  let dbp = null;
  const mem = { meta: new Map(), chats: new Map() }; // fallback if IndexedDB is blocked
  function open() {
    if (dbp) return dbp;
    dbp = new Promise((resolve) => {
      try {
        const req = indexedDB.open("s-ai", 1);
        req.onupgradeneeded = () => {
          req.result.createObjectStore("meta", { keyPath: "id" });
          req.result.createObjectStore("chats", { keyPath: "id" });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
        req.onblocked = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
    return dbp;
  }
  async function run(store, mode, fn) {
    const d = await open();
    if (!d) return fn(null, mem[store])?.result;
    return new Promise((resolve, reject) => {
      const tx = d.transaction(store, mode);
      const r = fn(tx.objectStore(store));
      tx.oncomplete = () => resolve(r?.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }
  return {
    async list() {
      const rows = await run("meta", "readonly", (s, m) => (s ? s.getAll() : { result: [...m.values()] }));
      return (rows || []).sort((a, b) => b.updatedAt - a.updatedAt);
    },
    get: (id) => run("chats", "readonly", (s, m) => (s ? s.get(id) : { result: m.get(id) })),
    async put(chat) {
      chat.updatedAt = Date.now();
      const meta = { id: chat.id, title: chat.title, updatedAt: chat.updatedAt };
      await run("chats", "readwrite", (s, m) => (s ? s.put(chat) : m.set(chat.id, chat)));
      await run("meta", "readwrite", (s, m) => (s ? s.put(meta) : m.set(meta.id, meta)));
    },
    async del(id) {
      await run("chats", "readwrite", (s, m) => (s ? s.delete(id) : m.delete(id)));
      await run("meta", "readwrite", (s, m) => (s ? s.delete(id) : m.delete(id)));
    },
    async clear() {
      await run("chats", "readwrite", (s, m) => (s ? s.clear() : m.clear()));
      await run("meta", "readwrite", (s, m) => (s ? s.clear() : m.clear()));
    },
  };
})();

async function saveChat(chat) {
  try {
    await db.put(chat);
  } catch (err) {
    console.error(err);
    toast("Couldn't save this chat (phone storage may be full). Delete some old chats.");
  }
}

// Move chats from the older localStorage version into IndexedDB, once.
async function migrateOldChats() {
  const old = prefs.get("chats", null);
  if (!old) return;
  for (const c of old) {
    const chat = prefs.get("chat:" + c.id, null);
    if (chat) {
      await db.put(chat);
      prefs.del("chat:" + c.id);
    }
  }
  prefs.del("chats");
}
try {
  navigator.storage?.persist?.();
} catch {}

const textOf = (content) =>
  typeof content === "string"
    ? content
    : content.filter((b) => b.type === "text").map((b) => b.text).join("");

// =====================================================================
// Rendering: Markdown + maths
// =====================================================================
function renderMath(tex, display) {
  try {
    return katex.renderToString(tex, { displayMode: display, throwOnError: false, output: "html", strict: "ignore" });
  } catch {
    return null;
  }
}

function renderMarkdown(text) {
  // Pull maths out first so Markdown doesn't mangle it, then put rendered maths back.
  const math = [];
  const keep = (tex, display) => {
    const html = renderMath(tex.trim(), display);
    if (html == null) return display ? `$$${tex}$$` : `$${tex}$`;
    math.push(html);
    return `MATHPH${math.length - 1}XEND`;
  };
  const codeSafe = [];
  let src = text.replace(/```[\s\S]*?(```|$)|`[^`\n]*`/g, (m) => {
    codeSafe.push(m);
    return `CODEPH${codeSafe.length - 1}XEND`;
  });
  src = src
    .replace(/\$\$([\s\S]+?)\$\$/g, (_, t) => keep(t, true))
    .replace(/\\\[([\s\S]+?)\\\]/g, (_, t) => keep(t, true))
    .replace(/\\\(([\s\S]+?)\\\)/g, (_, t) => keep(t, false))
    .replace(/(^|[^\\$\w])\$(?!\s)([^$\n]+?)(?<!\s)\$(?![\w$])/g, (_, pre, t) => pre + keep(t, false));
  src = src.replace(/CODEPH(\d+)XEND/g, (_, i) => codeSafe[+i]);
  let html = DOMPurify.sanitize(marked.parse(src, { breaks: true, gfm: true }));
  // KaTeX output is generated from escaped input, so it's safe to insert after sanitizing.
  html = html.replace(/MATHPH(\d+)XEND/g, (_, i) => math[+i]);
  return html;
}

function decorate(el) {
  el.querySelectorAll("a").forEach((a) => {
    a.target = "_blank";
    a.rel = "noopener noreferrer";
  });
  el.querySelectorAll("pre").forEach((pre) => {
    if (pre.querySelector(".copy-btn")) return;
    const btn = document.createElement("button");
    btn.className = "copy-btn";
    btn.type = "button";
    btn.textContent = "Copy";
    btn.onclick = async () => {
      try {
        await navigator.clipboard.writeText(pre.querySelector("code")?.innerText ?? pre.innerText);
        btn.textContent = "Copied!";
      } catch {
        btn.textContent = "Select & copy";
      }
      setTimeout(() => (btn.textContent = "Copy"), 1500);
    };
    pre.appendChild(btn);
  });
}

// =====================================================================
// UI
// =====================================================================
const messagesEl = $("#messages");
const welcomeEl = $("#welcome");
const input = $("#input");
const sendBtn = $("#send");
const stopBtn = $("#stop");
let currentChat = null;
let controller = null;
let pendingFiles = []; // attachments waiting to be sent
let stars = null; // the background starfield

function toast(text) {
  const t = $("#toast");
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), 6000);
}

function attachmentChips(files) {
  const wrap = document.createElement("div");
  wrap.className = "attach-row";
  for (const f of files) {
    if (f.kind === "image") {
      const img = document.createElement("img");
      img.src = `data:${f.mime};base64,${f.data}`;
      img.alt = f.name;
      img.className = "attach-thumb";
      img.onclick = () => window.open(img.src, "_blank");
      wrap.appendChild(img);
    } else {
      const chip = document.createElement("span");
      chip.className = "attach-chip";
      chip.textContent = (f.kind === "pdf" ? "📄 " : "📝 ") + f.name;
      wrap.appendChild(chip);
    }
  }
  return wrap;
}

function addMessage(role, text = "", files = []) {
  welcomeEl.hidden = true;
  const wrap = document.createElement("div");
  wrap.className = `msg ${role}`;
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  if (role === "user") {
    if (files.length) bubble.appendChild(attachmentChips(files));
    if (text) {
      const t = document.createElement("div");
      t.textContent = text;
      bubble.appendChild(t);
    }
  } else {
    bubble.innerHTML = renderMarkdown(text);
    decorate(bubble);
  }
  wrap.appendChild(bubble);
  messagesEl.appendChild(wrap);
  return bubble;
}

function scrollToBottom(force = false) {
  const near = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 140;
  if (force || near) messagesEl.scrollTop = messagesEl.scrollHeight;
}

async function renderSidebar() {
  const chats = await db.list();
  const list = $("#chat-list");
  list.innerHTML = "";
  for (const c of chats) {
    const item = document.createElement("div");
    item.className = "chat-item" + (c.id === currentChat?.id ? " active" : "");
    const a = document.createElement("a");
    a.href = "#";
    a.textContent = c.title;
    a.title = c.title;
    a.onclick = (e) => {
      e.preventDefault();
      openChat(c.id);
    };
    const del = document.createElement("button");
    del.className = "del";
    del.type = "button";
    del.textContent = "🗑";
    del.title = "Delete chat";
    del.onclick = async () => {
      await db.del(c.id);
      if (c.id === currentChat?.id) openChat(null);
      else renderSidebar();
    };
    item.append(a, del);
    list.appendChild(item);
  }
  $("#model-info").textContent = `${activeModel()}${searchOn() ? " · web search on" : ""} · ${chats.length} chats`;
}

async function openChat(id) {
  controller?.abort();
  messagesEl.querySelectorAll(".msg").forEach((m) => m.remove());
  welcomeEl.hidden = false;
  currentChat = id ? (await db.get(id)) || null : null;
  $("#chat-title").textContent = currentChat?.title || "New chat";
  document.body.classList.remove("side-open");
  if (currentChat) {
    for (const m of currentChat.messages) {
      const t = textOf(m.content);
      if (t || m.attachments?.length) addMessage(m.role, t, m.attachments || []);
    }
    scrollToBottom(true);
  }
  renderSidebar();
}

function setBusy(busy) {
  sendBtn.hidden = busy;
  stopBtn.hidden = !busy;
  updateSendState();
}
function updateSendState() {
  sendBtn.disabled = !!controller || (!input.value.trim() && !pendingFiles.length);
}

// =====================================================================
// Attachments: camera, photos, files
// =====================================================================
const MAX_FILE_MB = 15;

function readAs(file, how) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    if (how === "text") r.readAsText(file);
    else r.readAsDataURL(file);
  });
}

// Shrink big photos so they upload fast and fit free limits.
async function shrinkImage(file) {
  const url = await readAs(file, "dataurl");
  const img = await new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = reject;
    i.src = url;
  });
  const max = 1600;
  const scale = Math.min(1, max / Math.max(img.width, img.height));
  if (scale === 1 && file.size < 1.5e6 && /jpeg|png|webp/.test(file.type)) {
    return { mime: file.type, data: url.split(",")[1] };
  }
  const c = document.createElement("canvas");
  c.width = Math.round(img.width * scale);
  c.height = Math.round(img.height * scale);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return { mime: "image/jpeg", data: c.toDataURL("image/jpeg", 0.85).split(",")[1] };
}

const TEXT_EXT = /\.(txt|md|csv|json|js|ts|py|java|c|cpp|h|html|css|xml|yml|yaml|sql|sh|log)$/i;

async function addFiles(fileList) {
  for (const file of fileList) {
    if (pendingFiles.length >= 10) {
      toast("Up to 10 attachments per message.");
      break;
    }
    try {
      if (file.type.startsWith("image/")) {
        const { mime, data } = await shrinkImage(file);
        pendingFiles.push({ kind: "image", mime, data, name: file.name || "photo.jpg" });
      } else if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) {
        if (file.size > MAX_FILE_MB * 1e6) {
          toast(`${file.name} is too big (max ${MAX_FILE_MB} MB).`);
          continue;
        }
        const data = (await readAs(file, "dataurl")).split(",")[1];
        pendingFiles.push({ kind: "pdf", mime: "application/pdf", data, name: file.name });
      } else if (file.type.startsWith("text/") || TEXT_EXT.test(file.name)) {
        let text = await readAs(file, "text");
        if (text.length > 300000) text = text.slice(0, 300000) + "\n…(file cut off here)";
        pendingFiles.push({ kind: "text", mime: "text/plain", text, name: file.name });
      } else {
        toast(`${file.name}: S can read photos, PDFs and text files.`);
      }
    } catch (err) {
      console.error(err);
      toast(`Couldn't read ${file.name}.`);
    }
  }
  renderPending();
}

function renderPending() {
  const tray = $("#tray");
  tray.innerHTML = "";
  tray.hidden = !pendingFiles.length;
  pendingFiles.forEach((f, i) => {
    const item = document.createElement("div");
    item.className = "tray-item";
    if (f.kind === "image") {
      const img = document.createElement("img");
      img.src = `data:${f.mime};base64,${f.data}`;
      item.appendChild(img);
    } else {
      const s = document.createElement("span");
      s.textContent = (f.kind === "pdf" ? "📄 " : "📝 ") + f.name;
      item.appendChild(s);
    }
    const x = document.createElement("button");
    x.type = "button";
    x.className = "tray-x";
    x.textContent = "✕";
    x.setAttribute("aria-label", "Remove");
    x.onclick = () => {
      pendingFiles.splice(i, 1);
      renderPending();
    };
    item.appendChild(x);
    tray.appendChild(item);
  });
  updateSendState();
}

const plusMenu = $("#plus-menu");
$("#plus").onclick = (e) => {
  e.stopPropagation();
  plusMenu.hidden = !plusMenu.hidden;
};
document.addEventListener("click", (e) => {
  if (!plusMenu.contains(e.target)) plusMenu.hidden = true;
});
for (const [btn, inp] of [
  ["#pick-camera", "#file-camera"],
  ["#pick-photos", "#file-photos"],
  ["#pick-file", "#file-any"],
]) {
  $(btn).onclick = () => {
    plusMenu.hidden = true;
    $(inp).click();
  };
  $(inp).onchange = async (e) => {
    await addFiles([...e.target.files]);
    e.target.value = "";
    input.focus();
  };
}
// Paste or drop images straight into the chat box
input.addEventListener("paste", (e) => {
  const files = [...(e.clipboardData?.files || [])];
  if (files.length) {
    e.preventDefault();
    addFiles(files);
  }
});
document.addEventListener("dragover", (e) => e.preventDefault());
document.addEventListener("drop", (e) => {
  e.preventDefault();
  if (e.dataTransfer?.files?.length) addFiles([...e.dataTransfer.files]);
});

// =====================================================================
// Mic: voice typing with the browser's speech recognition
// =====================================================================
const micBtn = $("#mic");
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let recog = null;
let micBase = "";

function stopMic() {
  try {
    recog?.stop();
  } catch {}
}
micBtn.onclick = () => {
  if (recog) return stopMic();
  if (!SR) {
    toast("Voice typing isn't supported in this browser. Use Chrome, or tap the 🎤 on your keyboard.");
    return;
  }
  recog = new SR();
  recog.lang = settings.voiceLang;
  recog.interimResults = true;
  recog.continuous = true;
  micBase = input.value ? input.value.replace(/\s*$/, " ") : "";
  recog.onresult = (e) => {
    let finalText = "";
    let interim = "";
    for (let i = 0; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) finalText += r[0].transcript;
      else interim += r[0].transcript;
    }
    input.value = micBase + finalText + interim;
    autoGrow();
  };
  recog.onerror = (e) => {
    if (e.error === "not-allowed" || e.error === "service-not-allowed")
      toast("Mic permission is blocked. Allow the microphone for Chrome (Settings → Apps → Chrome → Permissions), or tap the 🎤 on your keyboard.");
    else if (e.error === "network") toast("Voice typing needs internet.");
    else if (e.error !== "no-speech" && e.error !== "aborted") toast(`Mic error: ${e.error}`);
  };
  recog.onend = () => {
    recog = null;
    micBtn.classList.remove("listening");
    micBtn.setAttribute("aria-label", "Voice typing");
  };
  try {
    recog.start();
    micBtn.classList.add("listening");
    micBtn.setAttribute("aria-label", "Stop listening");
  } catch (err) {
    recog = null;
    toast("Couldn't start the mic. Tap the 🎤 on your keyboard instead.");
  }
};

// =====================================================================
// Long chats: send as much history as the brain can take
// =====================================================================
// Rough size budgets in characters (about 3–4 characters per token).
const HISTORY_BUDGET = { gemini: 600000, openrouter: 60000, claude: 2000000 };
const IMAGE_COST = 6000; // an image counts like ~1,500 tokens
const KEEP_FILES_TURNS = 4; // re-send photos/PDFs only from the last few messages that had them

function msgSize(m) {
  let n = textOf(m.content).length;
  for (const f of m.attachments || []) n += f.kind === "image" ? IMAGE_COST : f.kind === "pdf" ? f.data.length / 3 : f.text.length;
  return n;
}

// Returns the newest messages that fit the budget, always starting with a user message.
function fitHistory(messages, budget) {
  let total = 0;
  let start = messages.length;
  for (let i = messages.length - 1; i >= 0; i--) {
    total += msgSize(messages[i]);
    if (total > budget && i < messages.length - 1) break;
    start = i;
  }
  while (start < messages.length && messages[start].role !== "user") start++;
  return { msgs: messages.slice(start), trimmed: start > 0 };
}

// Which message indexes still get their attachments re-sent
function fileTurns(msgs) {
  const keep = new Set();
  for (let i = msgs.length - 1; i >= 0 && keep.size < KEEP_FILES_TURNS; i--) {
    if (msgs[i].attachments?.length) keep.add(i);
  }
  return keep;
}

const fileNote = (files) => `[Earlier attached: ${files.map((f) => f.name).join(", ")}]`;

// =====================================================================
// Sending
// =====================================================================
async function send(text) {
  text = text.trim();
  if ((!text && !pendingFiles.length) || controller) return;
  if (!activeKey()) {
    openSettings("Paste your API key first, then send your message again.");
    return;
  }
  stopMic();
  const files = pendingFiles;
  pendingFiles = [];
  renderPending();

  if (!currentChat) {
    const title = text || files.map((f) => f.name).join(", ") || "New chat";
    currentChat = {
      id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2),
      title: title.length > 48 ? title.slice(0, 48) + "…" : title,
      messages: [],
    };
    $("#chat-title").textContent = currentChat.title;
  }
  const chat = currentChat;
  const userMsg = { role: "user", content: text || "(see attachment)" };
  if (files.length) userMsg.attachments = files;
  chat.messages.push(userMsg);
  await saveChat(chat);
  renderSidebar();

  input.value = "";
  autoGrow();
  addMessage("user", text, files);
  const bubble = addMessage("assistant", "");
  const status = document.createElement("div");
  status.className = "status";
  status.textContent = files.length ? "Reading your files…" : "Thinking…";
  bubble.after(status);
  scrollToBottom(true);

  controller = new AbortController();
  const signal = controller.signal;
  setBusy(true);

  let full = "";
  let pending = false;
  const paint = () => {
    pending = false;
    bubble.innerHTML = renderMarkdown(full);
    decorate(bubble);
    scrollToBottom();
  };
  const onText = (t) => {
    full += t;
    if (!pending) {
      pending = true;
      requestAnimationFrame(paint);
    }
  };
  const onStatus = (t) => (status.textContent = t);

  try {
    if (settings.provider === "gemini") await askGemini(chat, onText, onStatus, signal);
    else if (settings.provider === "openrouter") await askOpenRouter(chat, onText, onStatus, signal);
    else await askClaude(chat, onText, onStatus, signal);
  } catch (err) {
    // Remove the unanswered message so the next one still works.
    if (chat.messages.at(-1) === userMsg) {
      chat.messages.pop();
      if (chat.messages.length) await saveChat(chat);
      else {
        await db.del(chat.id);
        if (currentChat === chat) currentChat = null;
      }
    }
    if (!signal.aborted) {
      console.error(err);
      if (full) paint();
      const e = document.createElement("p");
      e.className = "error";
      e.textContent = `⚠ ${err instanceof FreeError ? err.message : friendlyError(err)}`;
      bubble.appendChild(e);
      if (err instanceof Anthropic.AuthenticationError || err?.badKey) openSettings("That key didn't work. Paste a valid key.");
    }
  } finally {
    if (full && !bubble.querySelector(".error")) paint();
    if (!full && !bubble.querySelector(".error")) bubble.closest(".msg").remove();
    status.remove();
    controller = null;
    setBusy(false);
    renderSidebar();
  }
}

// =====================================================================
// Maths engine (SymPy): run the AI's code and show it in the reply as a small fold-out box
// =====================================================================
const fence = (t) => String(t).replace(/```/g, "``\u200b`");
async function useSympy(code, onText, onStatus, signal) {
  onStatus(sympyLoaded() ? "🧮 Calculating with SymPy…" : "🧮 Starting the maths engine (first time: downloading about 15 MB)…");
  const out = await runSympy(String(code || ""), signal);
  if (signal.aborted) throw new DOMException("Stopped", "AbortError");
  onText(`\n\n<details class="calc"><summary>🧮 SymPy calculation</summary>\n\n\`\`\`python\n${fence(code)}\n\`\`\`\n\n\`\`\`text\n${fence(out)}\n\`\`\`\n\n</details>\n\n`);
  onStatus("Thinking…");
  return out;
}

// =====================================================================
// Claude
// =====================================================================
function friendlyError(err) {
  if (err instanceof Anthropic.AuthenticationError)
    return "Your API key was rejected. Open ⚙ Settings and paste your key again.";
  if (err instanceof Anthropic.PermissionDeniedError)
    return "Your key can't use this model. Add credit at console.anthropic.com, or pick another model in ⚙ Settings.";
  if (err instanceof Anthropic.RateLimitError) return "Too many requests right now. Wait a moment and try again.";
  if (err instanceof Anthropic.BadRequestError) {
    if (/credit balance/i.test(err.message))
      return "Your Anthropic account is out of credit. Add some at console.anthropic.com → Billing, or switch to Gemini (free) in ⚙ Settings.";
    return `The API rejected the request: ${err.message}`;
  }
  if (err instanceof Anthropic.APIConnectionError) return "Couldn't reach Claude. Check your internet connection.";
  if (err instanceof Anthropic.APIError) return `Claude API error: ${err.message}`;
  return `Something went wrong: ${err?.message || err}`;
}

function claudeMessages(chat) {
  const { msgs, trimmed } = fitHistory(chat.messages, HISTORY_BUDGET.claude);
  return msgs.map((m) => {
    if (m.role === "assistant") {
      // If old messages were dropped, send replies as plain text so the history stays valid.
      return { role: "assistant", content: trimmed ? textOf(m.content) || "…" : m.content };
    }
    if (!m.attachments?.length) return { role: "user", content: m.content };
    const blocks = [];
    for (const f of m.attachments) {
      if (f.kind === "image") blocks.push({ type: "image", source: { type: "base64", media_type: f.mime, data: f.data } });
      else if (f.kind === "pdf")
        blocks.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: f.data } });
      else blocks.push({ type: "text", text: `File "${f.name}":\n${f.text}` });
    }
    blocks.push({ type: "text", text: m.content });
    return { role: "user", content: blocks };
  });
}

async function askClaude(chat, onText, onStatus, signal) {
  const client = new Anthropic({ apiKey: settings.claudeKey, dangerouslyAllowBrowser: true });
  const tools = [];
  if (searchOn()) tools.push({ type: "web_search_20260209", name: "web_search", max_uses: 5 });
  if (sympyOn()) tools.push({ name: SYMPY_TOOL.name, description: SYMPY_TOOL.description, input_schema: SYMPY_TOOL.parameters });
  const messages = claudeMessages(chat);
  const content = []; // everything Claude wrote this turn
  let shown = ""; // the reply as the user sees it (incl. SymPy boxes)
  let usedSympy = false;
  const show = (t) => {
    shown += t;
    onText(t);
  };
  // Continue the turn after SymPy results, or when web search pauses it ("pause_turn").
  for (let round = 0; round < 10; round++) {
    const stream = client.beta.messages.stream(
      {
        model: settings.model,
        max_tokens: 64000,
        system: systemPrompt(),
        messages,
        thinking: { type: "adaptive" },
        output_config: { effort: settings.effort },
        ...(tools.length ? { tools } : {}),
        // If a safety check declines a request, the API retries it on a fallback model.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      },
      { signal },
    );
    stream.on("streamEvent", (event) => {
      if (event.type === "content_block_start") {
        const t = event.content_block.type;
        if (t === "thinking") onStatus("Thinking…");
        else if (t === "server_tool_use") onStatus("Searching the web…");
        else if (t === "tool_use") onStatus("🧮 Writing a SymPy calculation…");
        else if (t === "text") onStatus("");
      } else if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        show(event.delta.text);
      }
    });
    const message = await stream.finalMessage();
    content.push(...message.content);
    if (message.stop_reason === "tool_use") {
      messages.push({ role: "assistant", content: message.content });
      const results = [];
      for (const block of message.content) {
        if (block.type !== "tool_use") continue;
        const out = block.name === SYMPY_TOOL.name ? await useSympy(block.input?.code, show, onStatus, signal) : "Unknown tool.";
        results.push({ type: "tool_result", tool_use_id: block.id, content: out });
      }
      messages.push({ role: "user", content: results });
      usedSympy = true;
      continue;
    }
    if (message.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: message.content });
      continue;
    }
    if (message.stop_reason === "refusal") show("\n\n_I can't help with that one._");
    if (message.stop_reason === "max_tokens") show("\n\n_(Reply cut off at the length limit.)_");
    break;
  }
  // Keep the full reply (incl. thinking) so the conversation stays consistent. After SymPy,
  // save it as text instead: the tool calls only make sense together with their results.
  chat.messages.push({ role: "assistant", content: usedSympy ? shown || "…" : content });
  await saveChat(chat);
}

// =====================================================================
// Free brains: Gemini and OpenRouter
// =====================================================================
class FreeError extends Error {}

// Read a Server-Sent Events stream and hand each JSON "data:" payload to onData.
async function readSSE(res, onData) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const flush = (raw) => {
    const data = raw
      .split(/\r?\n/)
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trim())
      .join("");
    if (!data || data === "[DONE]") return;
    let parsed;
    try {
      parsed = JSON.parse(data);
    } catch {
      return;
    }
    onData(parsed);
  };
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let m;
    while ((m = buffer.match(/\r?\n\r?\n/))) {
      flush(buffer.slice(0, m.index));
      buffer = buffer.slice(m.index + m[0].length);
    }
  }
  if (buffer.trim()) flush(buffer);
}

async function apiMessage(res) {
  try {
    const body = await res.json();
    return body?.error?.message || JSON.stringify(body).slice(0, 300);
  } catch {
    return res.statusText || "";
  }
}

async function finishReply(chat, full, onText, cutOff) {
  if (cutOff) {
    const t = "\n\n_(Reply cut off at the length limit. Say \"continue\" to get the rest.)_";
    full += t;
    onText(t);
  }
  chat.messages.push({ role: "assistant", content: full });
  await saveChat(chat);
}

// Gemini models with a free tier, best daily limit first.
const GEMINI_FREE = ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-3.8-flash", "gemini-3.6-flash"];

function geminiContents(chat) {
  const { msgs } = fitHistory(chat.messages, HISTORY_BUDGET.gemini);
  const keep = fileTurns(msgs);
  return msgs.map((m, i) => {
    const parts = [];
    if (m.attachments?.length) {
      if (keep.has(i)) {
        for (const f of m.attachments) {
          if (f.kind === "text") parts.push({ text: `File "${f.name}":\n${f.text}` });
          else parts.push({ inline_data: { mime_type: f.mime, data: f.data } });
        }
      } else parts.push({ text: fileNote(m.attachments) });
    }
    parts.push({ text: textOf(m.content) || "…" });
    return { role: m.role === "assistant" ? "model" : "user", parts };
  });
}

async function askGemini(chat, onText, onStatus, signal) {
  const contents = geminiContents(chat);
  const tools = sympyOn()
    ? [{ functionDeclarations: [{ name: SYMPY_TOOL.name, description: SYMPY_TOOL.description, parameters: SYMPY_TOOL.parameters }] }]
    : undefined;
  const request = (model) =>
    fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`, {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json", "x-goog-api-key": settings.geminiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt() }] },
        contents,
        ...(tools ? { tools } : {}),
        generationConfig: { maxOutputTokens: 32768 },
      }),
    });

  // Try the chosen model first; if its free quota is used up, try the other free models.
  const models = [settings.geminiModel, ...GEMINI_FREE.filter((m) => m !== settings.geminiModel)];
  let full = "";
  let finish = "";
  let blocked = "";
  let model = null;
  for (let round = 0; round < 10; round++) {
    let res, firstErr;
    for (const m of model ? [model] : models) {
      try {
        res = await request(m);
      } catch (err) {
        if (signal.aborted) throw err;
        throw new FreeError("Couldn't reach Gemini. Check your internet connection.");
      }
      if (res.ok) {
        if (!model && m !== settings.geminiModel) onStatus(`Using ${m} (free limit on ${settings.geminiModel} is used up)…`);
        model = m;
        break;
      }
      const err = await geminiError(res);
      firstErr ??= err;
      if (model || !(res.status === 429 || res.status === 404)) throw err; // only quota / missing model is worth retrying
      res = null;
    }
    if (!res) throw firstErr;

    // Keep the model's parts exactly as sent (incl. thought signatures) so tool calls can continue.
    const parts = [];
    const calls = [];
    finish = "";
    await readSSE(res, (chunk) => {
      if (chunk.promptFeedback?.blockReason) blocked = chunk.promptFeedback.blockReason;
      const cand = chunk.candidates?.[0];
      if (!cand) return;
      for (const part of cand.content?.parts || []) {
        parts.push(part);
        if (part.functionCall) calls.push(part.functionCall);
        else if (part.text && !part.thought) {
          onStatus("");
          full += part.text;
          onText(part.text);
        }
      }
      if (cand.finishReason) finish = cand.finishReason;
    });
    if (!calls.length) break;

    contents.push({ role: "model", parts });
    const responses = [];
    for (const call of calls) {
      const shown = (t) => {
        full += t;
        onText(t);
      };
      const out = call.name === SYMPY_TOOL.name ? await useSympy(call.args?.code, shown, onStatus, signal) : "Unknown tool.";
      responses.push({ functionResponse: { name: call.name, ...(call.id ? { id: call.id } : {}), response: { output: out } } });
    }
    contents.push({ role: "user", parts: responses });
  }
  if (!full) {
    if (blocked || /SAFETY|PROHIBITED/.test(finish)) throw new FreeError("Gemini declined to answer that one. Try asking another way.");
    throw new FreeError("Gemini sent an empty reply. Try again.");
  }
  await finishReply(chat, full, onText, finish === "MAX_TOKENS");
}

async function geminiError(res) {
  const msg = await apiMessage(res);
  const google = `\n\nGoogle said: "${msg.slice(0, 400)}"`;
  const e = new FreeError(`Gemini error ${res.status}.${google}`);
  if (res.status === 400 && /api key/i.test(msg)) {
    e.message = "Your Gemini key was rejected. Open ⚙ Settings and paste it again (it starts with AIza).";
    e.badKey = true;
  } else if (res.status === 400 && /location/i.test(msg)) {
    e.message = "Gemini's free API isn't available in your region. Switch the brain to OpenRouter (free) in ⚙ Settings." + google;
  } else if (res.status === 400 && /(too large|size|payload|token)/i.test(msg)) {
    e.message = "That's too much for Gemini in one go. Try a smaller file or fewer photos, or start a new chat." + google;
  } else if (res.status === 403 && /free tier/i.test(msg)) {
    e.message = "Google hasn't enabled the free tier for this Gemini project. Switch the brain to OpenRouter (free) in ⚙ Settings." + google;
  } else if (res.status === 403) {
    e.message = "Google blocked this Gemini key. Make a new key at aistudio.google.com, or switch to OpenRouter (free) in ⚙ Settings." + google;
    e.badKey = true;
  } else if (res.status === 429) {
    e.message = /limit: 0/i.test(msg)
      ? "Google gives this Gemini key 0 free messages right now. Switch the brain to OpenRouter (free) in ⚙ Settings." + google
      : "Gemini's free limit is used up on every free model for now. It resets daily (around 1:30 PM India time). Meanwhile, switch to OpenRouter (free) in ⚙ Settings." + google;
  } else if (res.status >= 500) {
    e.message = "Gemini is busy right now. Try again in a moment.";
  }
  return e;
}

function openrouterMessages(chat) {
  const { msgs } = fitHistory(chat.messages, HISTORY_BUDGET.openrouter);
  const keep = fileTurns(msgs);
  return [
    { role: "system", content: systemPrompt() },
    ...msgs.map((m, i) => {
      const text = textOf(m.content) || "…";
      if (!m.attachments?.length) return { role: m.role, content: text };
      if (!keep.has(i)) return { role: m.role, content: `${fileNote(m.attachments)}\n${text}` };
      const parts = [];
      for (const f of m.attachments) {
        if (f.kind === "image") parts.push({ type: "image_url", image_url: { url: `data:${f.mime};base64,${f.data}` } });
        else if (f.kind === "pdf")
          parts.push({ type: "file", file: { filename: f.name, file_data: `data:application/pdf;base64,${f.data}` } });
        else parts.push({ type: "text", text: `File "${f.name}":\n${f.text}` });
      }
      parts.push({ type: "text", text });
      return { role: m.role, content: parts };
    }),
  ];
}

// OpenRouter: one free key gives access to many free models ("openrouter/free" picks one).
async function askOpenRouter(chat, onText, onStatus, signal) {
  let res;
  try {
    res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${settings.openrouterKey}`,
        "X-Title": "S",
      },
      body: JSON.stringify({ model: "openrouter/free", messages: openrouterMessages(chat), stream: true }),
    });
  } catch (err) {
    if (signal.aborted) throw err;
    throw new FreeError("Couldn't reach OpenRouter. Check your internet connection.");
  }
  if (!res.ok) {
    const msg = await apiMessage(res);
    const said = `\n\nOpenRouter said: "${msg.slice(0, 400)}"`;
    const e = new FreeError(`OpenRouter error ${res.status}.${said}`);
    if (res.status === 401) {
      e.message = "Your OpenRouter key was rejected. Open ⚙ Settings and paste it again (it starts with sk-or-).";
      e.badKey = true;
    } else if (res.status === 429) {
      e.message = "OpenRouter's free limit is used up for now. Wait a bit and try again." + said;
    } else if (chat.messages.at(-1)?.attachments?.length) {
      e.message = "The free OpenRouter model couldn't read that attachment. Switch to Gemini for photos and PDFs." + said;
    }
    throw e;
  }
  let full = "";
  let finish = "";
  let streamErr = null;
  await readSSE(res, (chunk) => {
    if (chunk.error) streamErr = chunk.error.message || "unknown";
    const choice = chunk.choices?.[0];
    const t = choice?.delta?.content;
    if (t) {
      onStatus("");
      full += t;
      onText(t);
    }
    if (choice?.finish_reason) finish = choice.finish_reason;
  });
  if (!full) throw new FreeError(streamErr ? `OpenRouter error: ${streamErr}` : "OpenRouter sent an empty reply. Try again.");
  await finishReply(chat, full, onText, finish === "length");
}

// =====================================================================
// Settings dialog
// =====================================================================
const dialog = $("#settings");
function showProviderFields() {
  const p = $("#set-provider").value;
  $("#gemini-fields").hidden = p !== "gemini";
  $("#openrouter-fields").hidden = p !== "openrouter";
  $("#claude-fields").hidden = p !== "claude";
}
function openSettings(note = "") {
  document.body.classList.remove("side-open");
  $("#set-note").textContent = note;
  $("#set-note").hidden = !note;
  $("#set-provider").value = settings.provider;
  $("#set-gkey").value = settings.geminiKey;
  $("#set-gmodel").value = settings.geminiModel;
  $("#set-okey").value = settings.openrouterKey;
  $("#set-key").value = settings.claudeKey;
  $("#set-model").value = settings.model;
  $("#set-effort").value = settings.effort;
  $("#set-web").checked = settings.webSearch;
  $("#set-voice").value = settings.voiceLang;
  $("#set-personality").value = settings.personality;
  $("#set-sympy").checked = settings.sympy;
  showProviderFields();
  if (!dialog.open) dialog.showModal();
  if (!activeKey()) ({ gemini: $("#set-gkey"), openrouter: $("#set-okey"), claude: $("#set-key") })[settings.provider].focus();
}
$("#set-provider").addEventListener("change", showProviderFields);
$("#settings-form").addEventListener("submit", (e) => {
  if (e.submitter?.value === "cancel") return;
  settings = {
    provider: $("#set-provider").value,
    geminiKey: $("#set-gkey").value.trim(),
    geminiModel: $("#set-gmodel").value,
    openrouterKey: $("#set-okey").value.trim(),
    claudeKey: $("#set-key").value.trim(),
    model: $("#set-model").value,
    effort: $("#set-effort").value,
    webSearch: $("#set-web").checked,
    voiceLang: $("#set-voice").value,
    personality: $("#set-personality").value.trim(),
    sympy: $("#set-sympy").checked,
    v2: true,
  };
  if (!prefs.set("settings", settings)) toast("Couldn't save settings in this browser; they'll last until you close the tab.");
  renderSidebar();
});
document.querySelectorAll(".toggle-key").forEach(
  (b) =>
    (b.onclick = () => {
      const k = b.previousElementSibling;
      k.type = k.type === "password" ? "text" : "password";
      b.textContent = k.type === "password" ? "Show" : "Hide";
    }),
);
// Free key guide + privacy note
const guide = $("#guide");
function openGuide(scrollToPrivacy = false) {
  document.body.classList.remove("side-open");
  if (dialog.open) dialog.close();
  if (!guide.open) guide.showModal();
  if (scrollToPrivacy) $("#privacy").scrollIntoView({ block: "start" });
  else guide.scrollTop = 0;
}
document.querySelectorAll(".open-guide").forEach((b) => (b.onclick = () => openGuide()));
document.querySelectorAll(".open-privacy").forEach((b) => (b.onclick = () => openGuide(true)));
$(".guide-x").onclick = () => guide.close();
$("#guide-done").onclick = () => {
  guide.close();
  settings.provider = activeKey() ? settings.provider : "gemini";
  openSettings("Copy ki hui key neeche paste karo aur Save dabao.");
};

$("#clear-all").onclick = async () => {
  if (!confirm("Delete all chats from this device?")) return;
  await db.clear();
  dialog.close();
  openChat(null);
};

// =====================================================================
// Wiring
// =====================================================================
// Grow the message box with its text. Measuring only once per frame keeps typing smooth.
let growQueued = false;
let lastBoxValue = "";
function autoGrow() {
  updateSendState();
  if (growQueued) return;
  growQueued = true;
  requestAnimationFrame(() => {
    growQueued = false;
    const v = input.value;
    // Only re-measure when lines may have changed (a new line, deleted text, or a long line).
    if (v.length < lastBoxValue.length || v.includes("\n") || input.scrollHeight > input.clientHeight + 1 || !v) {
      input.style.height = "auto";
      input.style.height = Math.min(input.scrollHeight, 180) + "px";
    }
    lastBoxValue = v;
  });
}
let typingTimer = 0;
function onTyping() {
  stars?.pause();
  document.body.classList.add("typing");
  clearTimeout(typingTimer);
  typingTimer = setTimeout(() => document.body.classList.remove("typing"), 900);
  autoGrow();
}
const touchDevice = matchMedia("(pointer: coarse)").matches;
if (touchDevice) $(".hint").textContent = "Tap ➤ to send · 🎤 to talk · ＋ for photos & files";
input.addEventListener("input", onTyping);
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing && !touchDevice) {
    e.preventDefault();
    send(input.value);
  }
});
$("#composer").addEventListener("submit", (e) => {
  e.preventDefault();
  send(input.value);
});
stopBtn.onclick = () => controller?.abort();
$("#new-chat").onclick = () => openChat(null);
$("#open-settings").onclick = () => openSettings();
document.querySelectorAll(".suggestions button").forEach((b) => (b.onclick = () => send(b.dataset.q || b.textContent)));
$("#open-side").onclick = () => document.body.classList.add("side-open");
$("#close-side").onclick = $("#scrim").onclick = () => document.body.classList.remove("side-open");

stars = startStarfield($("#stars"));
setBusy(false);
migrateOldChats()
  .catch(console.error)
  .finally(() => openChat(null));
playIntro().then(() => {
  if (!activeKey()) openGuide();
});
