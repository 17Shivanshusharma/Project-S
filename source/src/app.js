// S: a single-file personal AI assistant.
// Brains: Google Gemini (free), OpenRouter (free backup) or Claude (paid).
import Anthropic from "@anthropic-ai/sdk";
import { marked } from "marked";
import DOMPurify from "dompurify";
import katex from "katex";
import { startStarfield } from "./space.js";
import { playIntro } from "./intro.js";
import { runSympy, sympyLoaded, SYMPY_TOOL, PLOT_TOOL, runPlot } from "./sympy.js";
import hljs from "highlight.js/lib/core";
import hlPython from "highlight.js/lib/languages/python";
import hlJs from "highlight.js/lib/languages/javascript";
import hlTs from "highlight.js/lib/languages/typescript";
import hlXml from "highlight.js/lib/languages/xml";
import hlCss from "highlight.js/lib/languages/css";
import hlJava from "highlight.js/lib/languages/java";
import hlC from "highlight.js/lib/languages/c";
import hlCpp from "highlight.js/lib/languages/cpp";
import hlSql from "highlight.js/lib/languages/sql";
import hlBash from "highlight.js/lib/languages/bash";
import hlJson from "highlight.js/lib/languages/json";
import { readDocx } from "./docx.js";
import { drawGraph } from "./graph.js";
import { WEB_TOOLS, webSearch, readWebpage } from "./search.js";
import { SUBJECTS, detectSubject, applySubject } from "./subjects.js";

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
  geminiModel: "auto", // "auto" picks by mode
  mode: "fast", // "fast", "reasoning" or "coding"
  openrouterKey: "",
  claudeKey: "",
  model: "auto",
  effort: "auto",
  webSearch: true,
  voiceLang: "en-IN",
  personality: "",
  sympy: true,
  memoryOn: true,
  // Personalization (v5)
  language: "auto", // auto | hinglish | hindi | english
  style: "balanced", // concise | balanced | detailed | beginner
  level: "beginner", // study level
  writingStyle: "simple",
  subjectThemes: true,
  voiceName: "",
  voiceRate: 1,
};
const saved = prefs.get("settings", {});
if (saved.apiKey && !saved.claudeKey) saved.claudeKey = saved.apiKey; // from the first version
delete saved.apiKey;
if (!saved.v2) {
  if (saved.geminiModel === "gemini-3.8-flash") saved.geminiModel = "gemini-3.5-flash-lite";
  saved.v2 = true;
}
if (!saved.v3) {
  // New in v3: modes pick the model automatically, and web search works with every brain.
  saved.geminiModel = "auto";
  saved.model = "auto";
  saved.effort = "auto";
  saved.webSearch = true;
  saved.v3 = true;
}
if (!saved.v5) {
  // v5: "Normal" is the new everyday mode.
  if (!saved.mode || saved.mode === "fast") saved.mode = "normal";
  saved.v5 = true;
}
let settings = { ...DEFAULT_SETTINGS, ...saved };
const saveSettings = () => prefs.set("settings", settings);
const activeKey = () =>
  ({ gemini: settings.geminiKey, openrouter: settings.openrouterKey, claude: settings.claudeKey })[settings.provider];
// Smart model selector: each mode has a preferred order; if one model fails, the next is tried.
const MODES = {
  normal: { label: "💬 Normal", desc: "Roz ke sawaal, balanced jawab", effort: "medium" },
  fast: { label: "⚡ Fast", desc: "Jaldi aur chhota jawab", effort: "low" },
  reasoning: { label: "🧠 Reasoning", desc: "Mushkil sawaal, soch-samajh ke", effort: "high" },
  coding: { label: "💻 Coding", desc: "Code likhna, bug theek karna, samjhana", effort: "medium" },
  study: { label: "📚 Study", desc: "Tutor: hints, quiz, flashcards, notes", effort: "medium" },
  maths: { label: "🧮 Maths", desc: "Step by step, SymPy se check, graph", effort: "high" },
  research: { label: "🔎 Research", desc: "Web search, sources ke saath report", effort: "medium" },
  writing: { label: "✍️ Writing", desc: "Essay, email, application, grammar", effort: "medium" },
};
const WRITING_STYLES = { professional: "Professional", simple: "Simple", academic: "Academic", casual: "Casual", concise: "Concise", detailed: "Detailed" };
const LEVELS = { beginner: "Beginner", intermediate: "Intermediate", advanced: "Advanced" };
const GEMINI_FREE = ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-3.8-flash", "gemini-3.6-flash"];
const GEMINI_BY_MODE = {
  fast: ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-3.6-flash", "gemini-3.8-flash"],
  reasoning: ["gemini-3.8-flash", "gemini-3.6-flash", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite"],
  coding: ["gemini-3.8-flash", "gemini-3.6-flash", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite"],
  study: ["gemini-3.6-flash", "gemini-3.8-flash", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite"],
  normal: ["gemini-3.5-flash-lite", "gemini-3.6-flash", "gemini-3.1-flash-lite", "gemini-3.8-flash"],
  maths: ["gemini-3.8-flash", "gemini-3.6-flash", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite"],
  research: ["gemini-3.6-flash", "gemini-3.5-flash-lite", "gemini-3.8-flash", "gemini-3.1-flash-lite"],
  writing: ["gemini-3.6-flash", "gemini-3.5-flash-lite", "gemini-3.8-flash", "gemini-3.1-flash-lite"],
};
const CLAUDE_MODELS = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"];
const CLAUDE_BY_MODE = {
  fast: ["claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5"],
  reasoning: ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"],
  coding: ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"],
  study: ["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-5-5"],
  normal: ["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-5-5"],
  maths: ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"],
  research: ["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-5-5"],
  writing: ["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-5-5"],
};
const MODEL_NAMES = {
  "gemini-3.5-flash-lite": "Gemini 3.5 Flash-Lite",
  "gemini-3.1-flash-lite": "Gemini 3.1 Flash-Lite",
  "gemini-3.8-flash": "Gemini 3.8 Flash",
  "gemini-3.6-flash": "Gemini 3.6 Flash",
  "claude-opus-5-5": "Claude Opus 5.5",
  "claude-sonnet-5-5": "Claude Sonnet 5.5",
  "claude-haiku-5-5": "Claude Haiku 5.5",
};
const mode = () => (MODES[settings.mode] ? settings.mode : "normal");
const preferFirst = (pick, list) => (pick && pick !== "auto" ? [pick, ...list.filter((m) => m !== pick)] : list);
const geminiOrder = () => preferFirst(settings.geminiModel, GEMINI_BY_MODE[mode()]);
const claudeOrder = () => preferFirst(settings.model, CLAUDE_BY_MODE[mode()]);
const claudeEffort = () => (settings.effort && settings.effort !== "auto" ? settings.effort : MODES[mode()].effort);
const activeModel = () =>
  ({ gemini: MODEL_NAMES[geminiOrder()[0]], openrouter: "OpenRouter free models", claude: MODEL_NAMES[claudeOrder()[0]] })[settings.provider];
// Web search costs extra on Gemini, so S only searches when Claude is the brain.
const searchOn = () => !!settings.webSearch || mode() === "research";
// The SymPy maths engine is a tool the AI calls. OpenRouter's free models don't all support tools.
const sympyOn = () => settings.sympy && settings.provider !== "openrouter";

// ---------- Memory: small facts the user wants S to remember across chats ----------
const MEMORY_MAX = 60;
let memory = prefs.get("memory", []);
function saveMemory() {
  prefs.set("memory", memory);
}
function rememberFact(fact) {
  fact = String(fact || "").trim().slice(0, 300);
  if (!fact) return "Error: empty fact.";
  if (memory.some((m) => m.text.toLowerCase() === fact.toLowerCase())) return "Already remembered.";
  memory.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), text: fact, at: Date.now() });
  if (memory.length > MEMORY_MAX) memory = memory.slice(-MEMORY_MAX);
  saveMemory();
  return "Saved to memory.";
}
const MEMORY_TOOL = {
  name: "save_memory",
  description:
    "Save one short, lasting fact about the user so you remember it in future chats (their name, class, exam, subjects, goals, how they like answers). Only call it when the user shares such a fact or asks you to remember something. Don't save passwords, keys or private details like phone numbers or addresses.",
  parameters: { type: "object", properties: { fact: { type: "string", description: "The fact, in one short sentence, e.g. 'User is in class 12 (PCM) preparing for JEE'." } }, required: ["fact"] },
};
function memoryPrompt() {
  if (!settings.memoryOn) return "";
  const list = memory.map((m) => "- " + m.text).join("\n");
  return `- Memory: you remember things across chats with the save_memory tool. When the user tells you a lasting fact about themselves or says "yaad rakhna"/"remember", save it and tell them briefly ("🧠 Yaad rakh liya"). ${list ? "What you already know about the user:\n" + list + "\nUse this naturally; don't repeat it back unless it helps." : ""}`;
}

function modePrompt() {
  const lvl = LEVELS[settings.level] || "Beginner";
  return {
    normal: "NORMAL. Everyday questions and conversation. Balanced: complete but not long-winded.",
    fast: "FAST. Keep answers short and direct (still correct and simple). No long introductions.",
    reasoning: "REASONING. Think carefully, break the problem down, check each step and the final answer before replying. Show the key reasoning, not every thought.",
    coding: "CODING. Write complete, runnable code in code blocks with the language tag, with short comments. Then explain how it works and how to run it, and mention edge cases. For debugging: find the cause first, explain it, then give the fixed code. For code review: list issues by importance. You can't run the user's code; say what output to expect instead.",
    study: `STUDY (tutor), level: ${lvl}. Teach, don't just hand over answers. Explain the idea simply at a ${lvl.toLowerCase()} level, then guide the user with one hint or question at a time and let them try. When they ask, make practice questions, MCQs (answers hidden at the end under "Answers"), flashcards (a table: Question | Answer), a quiz (one question at a time, wait for their answer, then say right or wrong and why), revision notes or a topic summary. Praise effort, correct mistakes gently and explain why. Let the student choose what's next.`,
    maths: "MATHS. Solve step by step: given, to find, formula (what each letter means), working, check, **Final answer**. Use run_sympy for every non-trivial calculation and to verify the final answer; say \"✔ Checked with SymPy\" only when a SymPy run actually confirmed it. When a graph helps (functions, equations, trigonometry), call plot_graph. Use SymPy units for unit conversions.",
    research: "RESEARCH. Always search the web first (several searches if needed, and read the best pages). Answer in this format: **Short answer**, **Detailed findings**, **Important facts** (✅ each with its [n] source), **🤔 Not confirmed** (only if any), **Limitations** (what the sources don't cover, how recent they are). Never invent sources or results. If search fails or finds nothing, say clearly that live search didn't work and what you know may be outdated.",
    writing: `WRITING assistant. Style: ${WRITING_STYLES[settings.writingStyle] || "Simple"}. Help with essays, summaries, grammar correction, translation, emails, applications, reports, creative writing, rewriting and tone changes. Write the finished text first (in a quote or clearly separated), then a short note on what you changed or why. For grammar correction show the corrected text and list the main mistakes. Write in the language the user asks for; if they don't say, use the language of their message.`,
  }[mode()];
}
function personalPrompt() {
  const lang = { hinglish: "Always reply in Hinglish (Roman script).", hindi: "Always reply in Hindi (Devanagari script).", english: "Always reply in simple English.", auto: "" }[settings.language] || "";
  const style = {
    concise: "Answer style: concise. Keep answers short; use bullet points.",
    balanced: "",
    detailed: "Answer style: detailed. Give thorough answers with examples.",
    beginner: "Answer style: beginner-friendly. Assume no background; define every term.",
  }[settings.style] || "";
  return [lang && "- " + lang, style && "- " + style].filter(Boolean).join("\n");
}

function systemPrompt() {
  return `You are ${NAME}, a friendly, brilliant personal AI assistant and tutor, created by Shivanshu Sharma.
You can help with anything: every school and college subject (maths, physics, chemistry, biology, history, geography, civics, economics, English, Hindi, computer science, accounts), competitive exams (JEE, NEET, boards), coding, writing, general knowledge, advice and brainstorming.

How to answer:
- Reply in the same language and style the user writes in. If they write Hinglish, reply in Hinglish (Roman script). If they write Hindi in Devanagari, reply in Hindi.
- Be clear, correct and friendly. Short questions get short answers; hard questions get thorough ones.
- Explain so simply that anyone can understand, even someone who has never studied the topic:
  - Use everyday words and short sentences. When a term or symbol appears for the first time, say in plain words what it means (e.g. "$x$ matlab woh number jo humein dhoondhna hai").
  - Go one small step at a time. Never skip a step, and say *why* you're doing each step, not only what.
  - Use a real-life example or comparison when it helps (money, sharing roti, cricket score, distance on a road).
  - For problems, end with a quick check that the answer is right (e.g. put it back into the question), then a one-line "Yaad rakhne ki baat" (the key idea to remember).
  - Stay respectful: never call the question easy or the user weak, and never mention their level. Just make it easy.
- For maths, physics and chemistry problems: first write what is given and what we need to find, then the formula used (and what each letter in it means), then the working step by step, and end with a clearly marked **Final answer**. Double-check calculations.
- Write all maths with LaTeX: inline as $...$ and display equations as $$...$$ on their own lines. Use units in physics answers.
- When the user attaches a document, photo or notes: answer from that file. Say where in it the answer is (page, heading or line) when you can, and say clearly if something isn't in the file. For summaries use short headings and bullet points.
- Use Markdown well: headings for long answers, tables for comparisons, and code blocks with a language tag for code.
- For theory questions: give a simple explanation first, then key points, and an example or analogy when it helps.
- If the user sends a photo of a question, a page or a diagram, read it carefully and solve or explain what is in it.
- Use Markdown (headings, bullet lists, tables, code blocks with a language tag) when it makes the answer easier to read.
- If you're not sure about something, say so instead of guessing.
- About yourself: you were made by Shivanshu Sharma. If anyone asks who made you, who created you or who your owner is, say Shivanshu Sharma made you. If anyone asks "who is Shivanshu Sharma?", answer that Shivanshu Sharma is the one who made you (in the user's language, e.g. "Shivanshu Sharma ne mujhe banaya hai"). If someone asks which AI model powers you, say S is built by Shivanshu Sharma and currently runs on ${({ gemini: "Google Gemini", openrouter: "free models from OpenRouter", claude: "Anthropic's Claude" })[settings.provider]}.
${sympyOn() ? `- You have a maths engine: the run_sympy tool runs Python with SymPy and returns exact results. Use it for any calculation that isn't trivial (equations and systems, integrals, derivatives, limits, series, differential equations, matrices, simplifying, factorising, big or precise arithmetic) and to double-check final answers. You can call it several times. If it returns an error, fix the code and try again. After using it, still explain the method step by step in normal maths (LaTeX) the way a teacher would, and don't paste the code into your answer: the user can already see it.` : ""}
${searchOn() ? `- You can search the web (web_search) and open links (read_webpage). Search for anything recent or time-sensitive (news, prices, results, dates, people's current roles) and for facts you're unsure about. To summarise several websites, read each one, then combine.
- When you used the web, keep facts and guesses clearly apart:
  **✅ Verified (sources se):** facts the sources state, each with its source number like [1].
  **🤔 Andaza / not confirmed:** anything you're inferring or that sources don't confirm. Leave this out if there's nothing.
  The app lists the source links under your answer, so don't paste long URLs.` : "- Web search is off, so for very recent news say your information may be out of date and suggest turning on 🌐 Web search."}
- Current mode: ${modePrompt()}
${personalPrompt()}
${memoryPrompt()}
${settings.personality ? "\nExtra instructions from your owner:\n" + settings.personality : ""}`;
}

// =====================================================================
// Chats (IndexedDB: room for thousands of chats, photos and PDFs)
// =====================================================================
const db = (() => {
  let dbp = null;
  const mem = { meta: new Map(), chats: new Map(), notes: new Map() }; // fallback if IndexedDB is blocked
  function open() {
    if (dbp) return dbp;
    dbp = new Promise((resolve) => {
      try {
        const req = indexedDB.open("s-ai", 2);
        req.onupgradeneeded = () => {
          const d = req.result;
          for (const name of ["meta", "chats", "notes"]) if (!d.objectStoreNames.contains(name)) d.createObjectStore(name, { keyPath: "id" });
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
    async put(chat, touch = true) {
      if (touch || !chat.updatedAt) chat.updatedAt = Date.now();
      const fileCount = chat.messages.reduce((n, m) => n + (m.attachments?.length || 0), 0);
      const meta = { id: chat.id, title: chat.title, updatedAt: chat.updatedAt, fileCount, subject: chat.subject || "general", pinned: !!chat.pinned };
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
    // Library: saved answers and notes
    async notes() {
      const rows = await run("notes", "readonly", (s, m) => (s ? s.getAll() : { result: [...m.values()] }));
      return (rows || []).sort((a, b) => b.updatedAt - a.updatedAt);
    },
    async putNote(n) {
      n.updatedAt = Date.now();
      await run("notes", "readwrite", (s, m) => (s ? s.put(n) : m.set(n.id, n)));
    },
    delNote: (id) => run("notes", "readwrite", (s, m) => (s ? s.delete(id) : m.delete(id))),
  };
})();

async function saveChat(chat) {
  try {
    await db.put(chat);
    return true;
  } catch (err) {
    console.error(err);
    toast("⚠ Ye chat save nahi ho paayi (phone ki storage bhar gayi ho sakti hai). Purani chats delete karo ya ⚙ Settings → Backup download karo.");
    return false;
  }
}
const newId = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));
const themeFor = (sub) => (settings.subjectThemes === false ? "general" : sub || "general");

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

for (const [n, l] of Object.entries({ python: hlPython, javascript: hlJs, typescript: hlTs, xml: hlXml, css: hlCss, java: hlJava, c: hlC, cpp: hlCpp, sql: hlSql, bash: hlBash, json: hlJson })) hljs.registerLanguage(n, l);
hljs.registerAliases(["html", "svg"], { languageName: "xml" });
hljs.registerAliases(["py"], { languageName: "python" });
hljs.registerAliases(["js", "node"], { languageName: "javascript" });
hljs.registerAliases(["c++"], { languageName: "cpp" });
hljs.registerAliases(["sh", "shell"], { languageName: "bash" });
const LANG_NAMES = { python: "Python", javascript: "JavaScript", typescript: "TypeScript", xml: "HTML", css: "CSS", java: "Java", c: "C", cpp: "C++", sql: "SQL", bash: "Shell", json: "JSON" };

function decorate(el) {
  // Graphs drawn by the maths engine
  el.querySelectorAll("pre > code.language-s-graph").forEach((code) => {
    const pre = code.parentElement;
    try {
      pre.replaceWith(drawGraph(JSON.parse(code.textContent)));
    } catch {
      pre.remove();
    }
  });
  // Code colours + language label
  el.querySelectorAll("pre > code").forEach((code) => {
    if (code.dataset.hl) return;
    code.dataset.hl = "1";
    const m = (code.className.match(/language-([\w+#-]+)/) || [])[1];
    const lang = m && hljs.getLanguage(m) ? m : null;
    if (code.textContent.length > 60000) return;
    try {
      const r = lang ? hljs.highlight(code.textContent, { language: lang, ignoreIllegals: true }) : null;
      if (r) {
        code.innerHTML = r.value; // highlight.js escapes the code itself
        code.classList.add("hljs");
      }
    } catch {}
    const name = lang ? LANG_NAMES[hljs.getLanguage(lang)?.name?.toLowerCase()] || LANG_NAMES[lang] || hljs.getLanguage(lang).name : m;
    if (name && name !== "text" && name !== "s-graph") {
      const tag = document.createElement("span");
      tag.className = "code-lang";
      tag.textContent = name;
      code.parentElement.prepend(tag);
    }
  });
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

// Under each answer: a Copy button and the source links (when S searched the web).
function addExtras(bubble, getText, sources = []) {
  const msg = bubble.closest(".msg");
  msg.querySelector(".msg-extras")?.remove();
  const box = document.createElement("div");
  box.className = "msg-extras";
  if (sources?.length) {
    const src = document.createElement("div");
    src.className = "sources";
    const h = document.createElement("p");
    h.className = "sources-title";
    h.textContent = `🔗 Sources (${sources.length})`;
    src.appendChild(h);
    const ol = document.createElement("ol");
    for (const x of sources) {
      const li = document.createElement("li");
      const a = document.createElement("a");
      a.href = /^https?:/i.test(x.url) ? x.url : "#";
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = x.title;
      const host = document.createElement("span");
      try {
        host.textContent = new URL(x.url).hostname.replace(/^www\./, "");
      } catch {}
      li.append(a, host);
      ol.appendChild(li);
    }
    src.appendChild(ol);
    box.appendChild(src);
  }
  const copy = document.createElement("button");
  copy.type = "button";
  copy.className = "act-btn";
  copy.textContent = "⧉ Copy answer";
  copy.onclick = async () => {
    try {
      // Copy clean text without the SymPy boxes.
      await navigator.clipboard.writeText(cleanAnswer(getText()));
      copy.textContent = "✓ Copied";
    } catch {
      copy.textContent = "Couldn't copy";
    }
    setTimeout(() => (copy.textContent = "⧉ Copy answer"), 1500);
  };
  box.appendChild(copy);
  if ("speechSynthesis" in window) {
    const speak = document.createElement("button");
    speak.type = "button";
    speak.className = "act-btn speak-btn";
    speak.textContent = "🔊 Suno";
    speak.onclick = () => readAloud(getText(), speak);
    box.appendChild(speak);
  }
  const save = document.createElement("button");
  save.type = "button";
  save.className = "act-btn";
  save.textContent = "⭐ Save";
  save.title = "Save this answer to your Library";
  save.onclick = async () => {
    const q = msg.previousElementSibling?.classList.contains("user") ? msg.previousElementSibling.querySelector(".bubble")?.innerText.trim() : "";
    const text = cleanAnswer(getText());
    try {
      await db.putNote({ id: newId(), type: "answer", title: (q || text.split("\n")[0]).replace(/[#*]/g, "").slice(0, 80) || "Saved answer", text, chatId: currentChat?.id || "", createdAt: Date.now() });
      save.textContent = "✓ Saved";
      toast("⭐ Library mein save ho gaya");
    } catch {
      toast("⚠ Save nahi ho paaya (storage full?)");
    }
  };
  box.appendChild(save);
  const regen = document.createElement("button");
  regen.type = "button";
  regen.className = "act-btn regen-btn";
  regen.textContent = "↻ Regenerate";
  regen.title = "Ask for a new answer";
  regen.onclick = () => regenerate();
  box.appendChild(regen);
  msg.appendChild(box);
}
const cleanAnswer = (t) =>
  String(t)
    .replace(/<details class="calc">[\s\S]*?<\/details>\s*/g, "")
    .replace(/```s-graph[\s\S]*?```\s*/g, "")
    .trim();

// ---------- Read aloud (speechSynthesis, built into Android and iPhone browsers) ----------
let speakingBtn = null;
let speakDone = null;
function plainForSpeech(t) {
  return String(t)
    .replace(/<details class="calc">[\s\S]*?<\/details>/g, " ")
    .replace(/```s-graph[\s\S]*?```/g, " (graph) ")
    .replace(/```[\s\S]*?```/g, " (code) ")
    .replace(/\$\$?([^$]+)\$\$?/g, (m, x) => x.replace(/\\frac\{([^}]*)\}\{([^}]*)\}/g, "$1 by $2").replace(/\\(times|cdot)/g, " into ").replace(/\^2/g, " square").replace(/\^3/g, " cube").replace(/\\sqrt/g, " root ").replace(/[\\{}]/g, " "))
    .replace(/\[(\d+)\]/g, "")
    .replace(/https?:\/\/\S+/g, " link ")
    .replace(/[#*_>|`~]/g, " ")
    .replace(/-{3,}/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function pickVoice(lang) {
  const voices = window.speechSynthesis.getVoices();
  return (settings.voiceName && voices.find((v) => v.name === settings.voiceName)) || voices.find((v) => v.lang.replace("_", "-") === lang) || voices.find((v) => v.lang.startsWith(lang.slice(0, 2)));
}
function resetSpeakBtn(btn) {
  if (!btn) return;
  btn.textContent = "🔊 Suno";
  btn.nextElementSibling?.classList.contains("stop-speak") && btn.nextElementSibling.remove();
}
function stopSpeaking() {
  const synth = window.speechSynthesis;
  speakDone = null;
  synth?.cancel();
  resetSpeakBtn(speakingBtn);
  speakingBtn = null;
}
// Tap 🔊 to start, tap again to pause / resume, ⏹ to stop. onDone runs when it finishes (voice chat).
function readAloud(text, btn, onDone) {
  const synth = window.speechSynthesis;
  if (!synth) return onDone?.();
  if (btn && speakingBtn === btn) {
    if (synth.paused) {
      synth.resume();
      btn.textContent = "⏸ Pause";
    } else {
      synth.pause();
      btn.textContent = "▶ Resume";
    }
    return;
  }
  stopSpeaking();
  const clean = plainForSpeech(text);
  if (!clean) return onDone?.();
  const devanagari = /[\u0900-\u097F]/.test(clean);
  const lang = devanagari ? "hi-IN" : settings.voiceLang === "hi-IN" ? "hi-IN" : "en-IN";
  const voice = pickVoice(lang);
  // Speak in sentence-sized pieces: long texts stop early on some phones.
  const parts = clean.match(/[^.!?।\n]{1,220}[.!?।]?/g) || [clean];
  speakDone = onDone || null;
  const finish = () => {
    if (speakingBtn === btn) {
      resetSpeakBtn(btn);
      speakingBtn = null;
    }
    const cb = speakDone;
    speakDone = null;
    cb?.();
  };
  parts.forEach((p, i) => {
    const u = new SpeechSynthesisUtterance(p);
    u.lang = voice?.lang || lang;
    if (voice) u.voice = voice;
    u.rate = +settings.voiceRate || 1;
    if (i === parts.length - 1) u.onend = finish;
    u.onerror = (e) => {
      if (e.error !== "interrupted" && e.error !== "canceled") finish();
    };
    synth.speak(u);
  });
  speakingBtn = btn;
  if (btn) {
    btn.textContent = "⏸ Pause";
    const stop = document.createElement("button");
    stop.type = "button";
    stop.className = "act-btn stop-speak";
    stop.textContent = "⏹ Stop";
    stop.onclick = () => stopSpeaking();
    btn.after(stop);
  } else voiceUI("speaking");
}

function renderMessages(chat) {
  messagesEl.querySelectorAll(".msg").forEach((m) => m.remove());
  welcomeEl.hidden = !!chat.messages.length;
  chat.messages.forEach((m, i) => {
    const t = textOf(m.content);
    if (!t && !m.attachments?.length) return;
    const b = addMessage(m.role, t, m.attachments || [], i);
    if (m.role === "assistant") addExtras(b, () => t, m.sources);
  });
  refreshRegen();
  scrollToBottom(true);
}
// Only the newest answer gets the "Regenerate" button.
function refreshRegen() {
  const all = messagesEl.querySelectorAll(".msg.assistant .regen-btn");
  all.forEach((b, i) => (b.hidden = i !== all.length - 1));
}

function addMessage(role, text = "", files = [], index = -1) {
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
    if (index >= 0) wrap.dataset.index = index;
    const acts = document.createElement("div");
    acts.className = "user-acts";
    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "act-btn mini";
    edit.textContent = "✏️ Edit";
    edit.title = "Edit this message and ask again";
    edit.onclick = () => editPrompt(wrap);
    const cp = document.createElement("button");
    cp.type = "button";
    cp.className = "act-btn mini";
    cp.textContent = "⧉";
    cp.title = "Copy";
    cp.onclick = () => navigator.clipboard?.writeText(text).then(() => toast("Copied"), () => {});
    acts.append(edit, cp);
    wrap.appendChild(acts);
  } else {
    bubble.innerHTML = renderMarkdown(text);
    decorate(bubble);
  }
  wrap.prepend(bubble);
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
  const q = $("#chat-search").value.trim().toLowerCase();
  const day = 864e5;
  const today = new Date().setHours(0, 0, 0, 0);
  const groupOf = (c) =>
    c.pinned ? "📌 Pinned" : c.updatedAt >= today ? "Today" : c.updatedAt >= today - day ? "Yesterday" : c.updatedAt >= today - 7 * day ? "Previous 7 days" : c.updatedAt >= today - 30 * day ? "Previous 30 days" : "Older";
  const shown = chats.filter((c) => !q || c.title.toLowerCase().includes(q));
  shown.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.updatedAt - a.updatedAt);
  let lastGroup = "";
  for (const c of shown) {
    const g = groupOf(c);
    if (g !== lastGroup) {
      const h = document.createElement("p");
      h.className = "chat-group";
      h.textContent = g;
      list.appendChild(h);
      lastGroup = g;
    }
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
    const mk = (icon, title, fn) => {
      const b = document.createElement("button");
      b.className = "del";
      b.type = "button";
      b.textContent = icon;
      b.title = title;
      b.setAttribute("aria-label", title);
      b.onclick = fn;
      return b;
    };
    const pin = mk(c.pinned ? "📌" : "📍", c.pinned ? "Unpin chat" : "Pin chat", () => pinChat(c.id));
    if (c.pinned) pin.classList.add("on");
    const ren = mk("✏️", "Rename chat", () => renameChat(c.id));
    const del = mk("🗑", "Delete chat", async () => {
      if (!confirm(`"${c.title}" delete karein? Ye wapas nahi aayegi.`)) return;
      await db.del(c.id);
      if (c.id === currentChat?.id) openChat(null);
      else renderSidebar();
    });
    const dot = document.createElement("span");
    dot.className = "subj-dot";
    dot.style.background = (SUBJECTS[c.subject] || SUBJECTS.general).a;
    dot.title = (SUBJECTS[c.subject] || SUBJECTS.general).label;
    item.append(dot, a, pin, ren, del);
    list.appendChild(item);
  }
  if (!shown.length) {
    const empty = document.createElement("p");
    empty.className = "side-empty";
    empty.textContent = q ? "Koi chat nahi mili." : "Abhi koi chat nahi. Kuch bhi poocho!";
    list.appendChild(empty);
  }
  $("#model-info").textContent = `${BRAIN_NAMES[settings.provider]} · ${activeModel()} · ${chats.length} chats`;
  updateModeUI();
}
async function pinChat(id) {
  const chat = id === currentChat?.id ? currentChat : await db.get(id);
  if (!chat) return;
  chat.pinned = !chat.pinned;
  await db.put(chat, false);
  toast(chat.pinned ? "📌 Chat pinned (sabse upar rahegi)" : "Chat unpinned");
  renderSidebar();
}

async function openChat(id) {
  controller?.abort();
  showView("chat");
  messagesEl.querySelectorAll(".msg").forEach((m) => m.remove());
  welcomeEl.hidden = false;
  currentChat = id ? (await db.get(id)) || null : null;
  $("#chat-title").textContent = currentChat?.title || "New chat";
  nextSubject = null;
  applySubject(themeFor(currentChat?.subject));
  updateSubjectUI();
  document.body.classList.remove("side-open");
  window.speechSynthesis?.cancel();
  if (currentChat) renderMessages(currentChat);
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

const MAX_TEXT = 1500000;
// Big documents: send only the parts that match the question (plus the start), so long files
// still fit the AI's limit and the answer stays on the right part.
let currentQuestion = "";
function fileText(f) {
  const limit = { gemini: 250000, openrouter: 30000, claude: 400000 }[settings.provider] || 100000;
  const t = f.text || "";
  if (t.length <= limit) return t;
  const size = 4000;
  const chunks = [];
  for (let i = 0; i < t.length; i += size) chunks.push(t.slice(i, i + size));
  const words = [...new Set(currentQuestion.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || [])];
  const scored = chunks.map((c, i) => {
    const low = c.toLowerCase();
    let score = i === 0 ? 1e6 : 0;
    for (const w of words) score += low.split(w).length - 1;
    return { i, score };
  });
  const keep = new Set();
  let used = 0;
  for (const { i } of scored.sort((a, b) => b.score - a.score)) {
    if (used + size > limit) break;
    keep.add(i);
    used += size;
  }
  return `(This file is long: ${chunks.length} parts. Only the ${keep.size} parts most related to the question are included. If the answer isn't here, say which part might have it and ask the user to ask about that part.)\n\n` +
    [...keep].sort((a, b) => a - b).map((i) => `[Part ${i + 1} of ${chunks.length}]\n${chunks[i]}`).join("\n\n");
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
      } else if (/\.docx$/i.test(file.name) || file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
        if (file.size > MAX_FILE_MB * 1e6) {
          toast(`${file.name} is too big (max ${MAX_FILE_MB} MB).`);
          continue;
        }
        const text = await readDocx(file);
        if (!text.trim()) {
          toast(`${file.name}: is Word file mein koi text nahi mila (shayad sirf photos hain).`);
          continue;
        }
        pendingFiles.push({ kind: "text", mime: "text/plain", text: text.slice(0, MAX_TEXT), name: file.name });
        if (text.length > MAX_TEXT) toast(`${file.name} is very long; S kept the first ${Math.round(MAX_TEXT / 1000)}k characters.`);
      } else if (file.type.startsWith("text/") || TEXT_EXT.test(file.name)) {
        if (file.size > MAX_FILE_MB * 1e6) {
          toast(`${file.name} is too big (max ${MAX_FILE_MB} MB).`);
          continue;
        }
        let text = await readAs(file, "text");
        if (text.length > MAX_TEXT) {
          text = text.slice(0, MAX_TEXT) + "\n…(file cut off here)";
          toast(`${file.name} is very long; S kept the first ${Math.round(MAX_TEXT / 1000)}k characters.`);
        }
        pendingFiles.push({ kind: "text", mime: "text/plain", text, name: file.name });
      } else {
        toast(`${file.name}: S can read photos, PDF, Word (.docx), TXT and Markdown files.`);
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
  $("#doc-chips").hidden = !pendingFiles.length;
  if (!pendingFiles.length) input.placeholder = "Message S…";
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
    if (!voiceMode) voiceUI("off");
    micBtn.classList.remove("listening");
    micBtn.setAttribute("aria-label", "Voice typing");
  };
  try {
    recog.start();
    voiceUI("typing");
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
const BRAINS = ["gemini", "openrouter", "claude"];
const BRAIN_NAMES = { gemini: "Gemini", openrouter: "OpenRouter", claude: "Claude" };
const keyFor = (b) => ({ gemini: settings.geminiKey, openrouter: settings.openrouterKey, claude: settings.claudeKey })[b];
const ASK = { gemini: (c, ui) => askGemini(c, ui), openrouter: (c, ui) => askOpenRouter(c, ui), claude: (c, ui) => askClaude(c, ui) };
function shortReason(err) {
  const m = err instanceof FreeError ? err.message : friendlyError(err);
  return m.split(/[.\n]/)[0].slice(0, 90);
}

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
  currentQuestion = text;
  renderPending();

  if (!currentChat) {
    const title = text || files.map((f) => f.name).join(", ") || "New chat";
    currentChat = {
      id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2),
      title: title.length > 48 ? title.slice(0, 48) + "…" : title,
      messages: [],
      subject: nextSubject || "general",
      subjectManual: !!nextSubject,
    };
    nextSubject = null;
    $("#chat-title").textContent = currentChat.title;
  }
  const chat = currentChat;
  // Pick this chat's subject theme from what the user writes (until they choose one themselves).
  if (!chat.subjectManual && (!chat.subject || chat.subject === "general")) {
    const sub = detectSubject(text + " " + files.map((f) => f.name).join(" "));
    if (sub !== "general") {
      chat.subject = sub;
      applySubject(themeFor(sub));
      updateSubjectUI();
    }
  }
  const userMsg = { role: "user", content: text || "(see attachment)" };
  if (files.length) userMsg.attachments = files;
  chat.messages.push(userMsg);
  await saveChat(chat);
  renderSidebar();

  input.value = "";
  autoGrow();
  addMessage("user", text, files, chat.messages.length - 1);
  return answer(chat, userMsg, null);
}

// Ask again for the last question (removes the old answer first).
async function regenerate() {
  const chat = currentChat;
  if (!chat || controller) return;
  let i = chat.messages.length - 1;
  while (i >= 0 && chat.messages[i].role !== "user") i--;
  if (i < 0) return;
  const removed = chat.messages.splice(i + 1);
  renderMessages(chat);
  currentQuestion = textOf(chat.messages[i].content);
  return answer(chat, chat.messages[i], removed);
}

// Edit an earlier question: everything after it is removed, and the text goes back into the box.
async function editPrompt(wrap) {
  const chat = currentChat;
  const i = +wrap.dataset.index;
  if (!chat || controller || !(i >= 0) || chat.messages[i]?.role !== "user") return;
  const later = chat.messages.length - i - 1;
  if (later > 1 && !confirm("Is message ke baad ke saare jawab hat jaayenge. Edit karein?")) return;
  const m = chat.messages[i];
  chat.messages.splice(i);
  if (chat.messages.length) await saveChat(chat);
  else await db.del(chat.id);
  renderMessages(chat);
  input.value = textOf(m.content) === "(see attachment)" ? "" : textOf(m.content);
  pendingFiles = (m.attachments || []).map((f) => structuredClone(f));
  renderPending();
  autoGrow();
  input.focus();
  renderSidebar();
  toast("✏️ Message edit karo aur ➤ dabao");
}

async function answer(chat, userMsg, removed) {
  const files = userMsg.attachments || [];
  const bubble = addMessage("assistant", "");
  const status = document.createElement("div");
  status.className = "status";
  status.innerHTML = '<span class="dots" aria-hidden="true"><i></i><i></i><i></i></span> ';
  status.append(files.length ? "Reading your files…" : "Thinking…");
  bubble.after(status);
  scrollToBottom(true);
  voiceUI("thinking");

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
  const onStatus = (t) => (status.lastChild.textContent = t);
  const sources = [];
  const addSource = (src) => {
    const at = sources.findIndex((x) => x.url === src.url);
    if (at >= 0) return at + 1;
    sources.push({ title: String(src.title || src.url).slice(0, 140), url: src.url });
    return sources.length;
  };
  const ui = { onText, onStatus, signal, addSource };
  let failed = false;

  try {
    // Fallback: if the chosen brain fails before answering, try the other brains you have keys for.
    const order = [settings.provider, ...BRAINS.filter((b) => b !== settings.provider && keyFor(b))];
    let firstErr = null;
    for (const [n, brain] of order.entries()) {
      try {
        if (n > 0) onStatus(`${BRAIN_NAMES[order[n - 1]]} didn't answer, trying ${BRAIN_NAMES[brain]}…`);
        await ASK[brain](chat, ui);
        if (n > 0) {
          const note = document.createElement("p");
          note.className = "fallback-note";
          note.textContent = `↪ ${BRAIN_NAMES[settings.provider]} didn't answer (${shortReason(firstErr)}), so this reply is from ${BRAIN_NAMES[brain]}.`;
          bubble.closest(".msg").appendChild(note);
        }
        firstErr = null;
        break;
      } catch (err) {
        firstErr ??= err;
        if (signal.aborted || full) throw err; // stopped, or already part-answered: don't start over
      }
    }
    if (firstErr) throw firstErr;
    if (!full.trim()) {
      const e = new Error("empty");
      e.empty = true;
      throw e;
    }
    const last = chat.messages.at(-1);
    if (sources.length && last?.role === "assistant") {
      last.sources = sources;
      await saveChat(chat);
    }
  } catch (err) {
    failed = true;
    // Put the chat back the way it was, so nothing is lost and the next message still works.
    if (removed) {
      while (chat.messages.length && chat.messages.at(-1) !== userMsg) chat.messages.pop();
      chat.messages.push(...removed);
      await saveChat(chat);
    } else if (chat.messages.at(-1) === userMsg) {
      chat.messages.pop();
      if (chat.messages.length) await saveChat(chat);
      else await db.del(chat.id).catch(() => {});
    } else if (chat.messages.at(-1)?.role === "assistant" && full) {
      await saveChat(chat); // part of an answer arrived: keep it
      failed = false;
    }
    if (!signal.aborted) {
      console.error(err);
      if (full) paint();
      const e = document.createElement("div");
      e.className = "error";
      const msg = document.createElement("p");
      msg.textContent = err.empty
        ? "⚠ S ko khaali jawab mila (AI ne kuch nahi bheja). Dobara try karo ya ⚙ mode/model badlo."
        : `⚠ ${err instanceof FreeError ? err.message : friendlyError(err)}`;
      const retry = document.createElement("button");
      retry.type = "button";
      retry.className = "act-btn";
      retry.textContent = "↻ Retry";
      retry.onclick = () => {
        if (controller) return;
        if (removed) {
          renderMessages(chat);
          regenerate();
          return;
        }
        // The question was taken back out of the chat: send it again.
        const msgEl = bubble.closest(".msg");
        msgEl.previousElementSibling?.classList.contains("user") && msgEl.previousElementSibling.remove();
        msgEl.remove();
        pendingFiles = files.map((f) => structuredClone(f));
        send(textOf(userMsg.content) === "(see attachment)" ? "" : textOf(userMsg.content));
      };
      e.append(msg, retry);
      bubble.appendChild(e);
      if (err instanceof Anthropic.AuthenticationError || err?.badKey) openSettings("That key didn't work. Paste a valid key.");
    } else if (removed && !full) renderMessages(chat);
  } finally {
    if (full && !bubble.querySelector(".error")) {
      paint();
      addExtras(bubble, () => full, sources);
      refreshRegen();
    }
    if (!full && !bubble.querySelector(".error")) bubble.closest(".msg").remove();
    status.remove();
    controller = null;
    setBusy(false);
    renderSidebar();
    if (voiceMode) {
      if (full && !failed) readAloud(full, null, () => voiceMode && listenForVoice());
      else stopVoiceMode();
    }
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

// Every tool call the AI makes goes through here. `ui` shows progress and collects source links.
async function runTool(name, args, ui) {
  const { onText, onStatus, signal } = ui;
  if (name === SYMPY_TOOL.name) return useSympy(args?.code, onText, onStatus, signal);
  if (name === "web_search" || name === "read_webpage") {
    const r =
      name === "web_search"
        ? (onStatus(`🌐 Searching: ${String(args?.query || "").slice(0, 60)}…`),
          await webSearch(args?.query, { geminiKey: settings.geminiKey, model: GEMINI_BY_MODE.fast[0], signal }))
        : (onStatus(`📖 Reading ${String(args?.url || "").replace(/^https?:\/\//, "").slice(0, 50)}…`), await readWebpage(args?.url, signal));
    // Give each source one number for the whole answer, so [1], [2] match the list under it.
    const nums = r.sources.map((src) => ui.addSource(src));
    let text = r.text.replace(/^\[(\d+)\]/gm, (m, k) => (nums[k - 1] ? `[${nums[k - 1]}]` : m));
    if (nums.length) text += "\n\nSources:\n" + r.sources.map((src, k) => `[${nums[k]}] ${src.title} (${src.url})`).join("\n");
    onStatus("Thinking…");
    return text;
  }
  if (name === PLOT_TOOL.name) {
    onStatus("📈 Drawing the graph with SymPy…");
    const r = await runPlot(args, signal);
    if (signal.aborted) throw new DOMException("Stopped", "AbortError");
    onStatus("Thinking…");
    if (r.error) return r.error;
    const ok = r.series.filter((x) => x.points.some(Boolean));
    if (!ok.length) return "Error: none of the expressions could be drawn (maybe not real numbers in this range). Try another range.";
    onText("\n\n```s-graph\n" + JSON.stringify({ title: String(args?.title || "").slice(0, 80), series: ok }) + "\n```\n\n");
    return `Graph shown to the user under your answer (${ok.map((x) => x.label).join(", ")}, x from ${args?.xmin ?? -10} to ${args?.xmax ?? 10}). Don't describe drawing it; just refer to it.`;
  }
  if (name === MEMORY_TOOL.name) {
    const r = rememberFact(args?.fact);
    if (r === "Saved to memory.") toast("🧠 Memory saved: " + String(args?.fact).slice(0, 80));
    return r;
  }
  return "Error: unknown tool.";
}
const customTools = () => [...(sympyOn() ? [SYMPY_TOOL, PLOT_TOOL] : []), ...(searchOn() ? WEB_TOOLS : []), ...(settings.memoryOn ? [MEMORY_TOOL] : [])];
// Errors where trying another model makes sense (busy, quota, missing model, network).
const retryable = (status) => !status || [404, 408, 429, 500, 502, 503, 504, 529].includes(status);

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
      else blocks.push({ type: "text", text: `File "${f.name}":\n${fileText(f)}` });
    }
    blocks.push({ type: "text", text: m.content });
    return { role: "user", content: blocks };
  });
}

async function askClaude(chat, ui) {
  const client = new Anthropic({ apiKey: settings.claudeKey, dangerouslyAllowBrowser: true, maxRetries: 1 });
  const tools = [];
  if (searchOn()) tools.push({ type: "web_search_20260209", name: "web_search", max_uses: 5 });
  for (const t of customTools()) {
    if (t.name === "web_search") continue; // Claude has its own web search
    tools.push({ name: t.name, description: t.description, input_schema: t.parameters });
  }
  const models = claudeOrder();
  let firstErr = null;
  for (const [n, model] of models.entries()) {
    let shown = ""; // the reply as the user sees it (incl. SymPy boxes)
    const show = (t) => {
      shown += t;
      ui.onText(t);
    };
    try {
      if (n > 0) ui.onStatus(`${MODEL_NAMES[models[n - 1]]} didn't answer, trying ${MODEL_NAMES[model]}…`);
      const messages = claudeMessages(chat);
      const content = []; // everything Claude wrote this turn
      let usedTools = false;
      // Continue the turn after tool results, or when web search pauses it ("pause_turn").
      for (let round = 0; round < 12; round++) {
        const stream = client.beta.messages.stream(
          {
            model,
            max_tokens: 64000,
            system: systemPrompt(),
            messages,
            thinking: { type: "adaptive" },
            output_config: { effort: claudeEffort() },
            ...(tools.length ? { tools } : {}),
            // If a safety check declines a request, the API retries it on a fallback model.
            betas: ["server-side-fallback-2026-07-01"],
            fallbacks: "default",
          },
          { signal: ui.signal },
        );
        stream.on("streamEvent", (event) => {
          if (event.type === "content_block_start") {
            const t = event.content_block.type;
            if (t === "thinking") ui.onStatus("Thinking…");
            else if (t === "server_tool_use") ui.onStatus("🌐 Searching the web…");
            else if (t === "tool_use") ui.onStatus(event.content_block.name === SYMPY_TOOL.name ? "🧮 Writing a SymPy calculation…" : "📖 Opening a page…");
            else if (t === "text") ui.onStatus("");
          } else if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            show(event.delta.text);
          }
        });
        const message = await stream.finalMessage();
        content.push(...message.content);
        for (const block of message.content) {
          if (block.type === "web_search_tool_result" && Array.isArray(block.content))
            for (const r of block.content) if (r.url) ui.addSource({ title: r.title || r.url, url: r.url });
        }
        if (message.stop_reason === "tool_use") {
          messages.push({ role: "assistant", content: message.content });
          const results = [];
          for (const block of message.content) {
            if (block.type !== "tool_use") continue;
            const out = await runTool(block.name, block.input, { ...ui, onText: show });
            results.push({ type: "tool_result", tool_use_id: block.id, content: out });
          }
          messages.push({ role: "user", content: results });
          usedTools = true;
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
      // Keep the full reply (incl. thinking) so the conversation stays consistent. After our own
      // tools, save it as text instead: tool calls only make sense together with their results.
      chat.messages.push({ role: "assistant", content: usedTools ? shown || "…" : content });
      await saveChat(chat);
      return;
    } catch (err) {
      firstErr ??= err;
      if (ui.signal.aborted || shown || !(err instanceof Anthropic.APIError) || !retryable(err.status)) throw err;
    }
  }
  throw firstErr;
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


function geminiContents(chat) {
  const { msgs } = fitHistory(chat.messages, HISTORY_BUDGET.gemini);
  const keep = fileTurns(msgs);
  return msgs.map((m, i) => {
    const parts = [];
    if (m.attachments?.length) {
      if (keep.has(i)) {
        for (const f of m.attachments) {
          if (f.kind === "text") parts.push({ text: `File "${f.name}":\n${fileText(f)}` });
          else parts.push({ inline_data: { mime_type: f.mime, data: f.data } });
        }
      } else parts.push({ text: fileNote(m.attachments) });
    }
    parts.push({ text: textOf(m.content) || "…" });
    return { role: m.role === "assistant" ? "model" : "user", parts };
  });
}

async function askGemini(chat, ui) {
  const { onText, onStatus, signal } = ui;
  const contents = geminiContents(chat);
  const decl = customTools();
  const tools = decl.length
    ? [{ functionDeclarations: decl.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters })) }]
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

  // Try the models in the order the mode prefers; if one is busy or its free quota is used up, try the next.
  const models = geminiOrder();
  let full = "";
  let finish = "";
  let blocked = "";
  let model = null;
  for (let round = 0; round < 12; round++) {
    let res, firstErr;
    for (const m of model ? [model] : models) {
      try {
        res = await request(m);
      } catch (err) {
        if (signal.aborted) throw err;
        firstErr ??= new FreeError("Couldn't reach Gemini. Check your internet connection.");
        if (model) throw firstErr;
        continue; // network hiccup: try the next model
      }
      if (res.ok) {
        if (!model && m !== models[0]) onStatus(`Using ${MODEL_NAMES[m] || m} (${MODEL_NAMES[models[0]] || models[0]} didn't answer)…`);
        model = m;
        break;
      }
      const err = await geminiError(res);
      firstErr ??= err;
      if (model || !retryable(res.status)) throw err; // a bad key or request won't work on another model either
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
    const shown = (t) => {
      full += t;
      onText(t);
    };
    for (const call of calls) {
      const out = await runTool(call.name, call.args, { ...ui, onText: shown });
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
        else parts.push({ type: "text", text: `File "${f.name}":\n${fileText(f)}` });
      }
      parts.push({ type: "text", text });
      return { role: m.role, content: parts };
    }),
  ];
}

// OpenRouter: one free key gives access to many free models ("openrouter/free" picks one).
async function askOpenRouter(chat, ui) {
  const { onText, onStatus, signal } = ui;
  const messages = openrouterMessages(chat);
  // OpenRouter's free models can't all use tools, so S searches first and hands them the results.
  if (searchOn()) {
    const q = textOf(chat.messages.at(-1)?.content || "").slice(0, 200);
    if (q.length > 3) {
      onStatus(`🌐 Searching: ${q.slice(0, 60)}…`);
      const found = await runTool("web_search", { query: q }, ui);
      const last = messages.at(-1);
      const note = `\n\n[Web search results for this question. Use them if relevant and cite as [n].]\n${found}`;
      if (typeof last.content === "string") last.content += note;
      else last.content.push({ type: "text", text: note });
    }
  }
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
      body: JSON.stringify({ model: "openrouter/free", messages, stream: true }),
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
  $("#set-memory").checked = settings.memoryOn !== false;
  $("#set-themes").checked = settings.subjectThemes !== false;
  $("#set-language").value = settings.language;
  $("#set-style").value = settings.style;
  $("#set-level").value = settings.level;
  $("#set-wstyle").value = settings.writingStyle;
  $("#set-rate").value = settings.voiceRate || 1;
  $("#rate-val").textContent = (+settings.voiceRate || 1).toFixed(1) + "×";
  fillVoices();
  document.querySelectorAll(".key-status").forEach((x) => (x.textContent = ""));
  showStorage();
  renderMemory();
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
    memoryOn: $("#set-memory").checked,
    subjectThemes: $("#set-themes").checked,
    language: $("#set-language").value,
    style: $("#set-style").value,
    level: $("#set-level").value,
    writingStyle: $("#set-wstyle").value,
    voiceName: $("#set-voicename").value,
    voiceRate: +$("#set-rate").value || 1,
    mode: settings.mode,
    v2: true,
    v3: true,
    v5: true,
  };
  applySubject(themeFor(currentChat?.subject));
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
if (touchDevice) $(".hint").textContent = "Tap ➤ to send · 🎤 voice typing · 🗣 voice chat · ＋ photos, PDF, Word";
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
const wide = () => matchMedia("(min-width: 761px)").matches;
$("#open-side").onclick = () => {
  if (wide()) {
    document.body.classList.remove("side-collapsed");
    prefs.set("sideCollapsed", false);
  } else document.body.classList.add("side-open");
};
$("#collapse-side").onclick = () => {
  document.body.classList.add("side-collapsed");
  prefs.set("sideCollapsed", true);
};
if (prefs.get("sideCollapsed", false)) document.body.classList.add("side-collapsed");
// Scroll-to-bottom button
const toBottom = $("#to-bottom");
messagesEl.addEventListener(
  "scroll",
  () => {
    toBottom.hidden = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 300;
  },
  { passive: true },
);
toBottom.onclick = () => messagesEl.scrollTo({ top: messagesEl.scrollHeight, behavior: "smooth" });
$("#close-side").onclick = $("#scrim").onclick = () => document.body.classList.remove("side-open");

// ---------- Sidebar views: History (chat list) and Library (all uploaded files) ----------
function showView(view) {
  const lib = view === "library";
  $("#library").hidden = !lib;
  messagesEl.hidden = lib;
  $("#composer").hidden = lib;
  $("#chips").hidden = lib;
  $("#tray").hidden = lib || !pendingFiles.length;
  document.querySelector(".hint").hidden = lib;
  $("#nav-history").classList.toggle("active", !lib);
  $("#nav-library").classList.toggle("active", lib);
  if (lib) {
    $("#chat-title").textContent = "Library";
    renderLibrary();
  } else $("#chat-title").textContent = currentChat?.title || "New chat";
}
$("#nav-history").onclick = () => {
  showView("chat");
  $("#chat-search").focus();
};
$("#nav-library").onclick = () => {
  document.body.classList.remove("side-open");
  showView("library");
};
$("#chat-search").addEventListener("input", () => renderSidebar());

// ---------- Voice conversation: listen → answer → speak → listen again ----------
let voiceMode = false;
let voiceRecog = null;
function voiceUI(state) {
  const pill = $("#voice-pill");
  const txt = { listening: "🎙 Sun raha hoon… bolo", thinking: "🤔 Soch raha hoon…", speaking: "🔊 Bol raha hoon…", typing: "🎙 Mic on: bolo, phir 🎤 dabake roko" }[state];
  if (state === "thinking" && !voiceMode) return;
  pill.hidden = !txt;
  pill.dataset.state = state;
  if (txt) $("#vp-text").textContent = txt;
  $("#voice-mode").classList.toggle("listening", voiceMode);
}
function listenForVoice() {
  if (!voiceMode) return;
  if (!SR) {
    toast("Is browser mein voice chat nahi chalta. Chrome (Android) ya Safari (iPhone) use karo.");
    return stopVoiceMode();
  }
  voiceRecog = new SR();
  voiceRecog.lang = settings.voiceLang;
  voiceRecog.interimResults = true;
  voiceRecog.continuous = false;
  let heard = "";
  voiceRecog.onresult = (e) => {
    heard = [...e.results].map((r) => r[0].transcript).join("");
    input.value = heard;
    autoGrow();
  };
  voiceRecog.onerror = (e) => {
    if (e.error === "not-allowed" || e.error === "service-not-allowed") {
      toast("🎙 Mic ki permission band hai. Browser settings mein microphone allow karo.");
      stopVoiceMode();
    } else if (e.error === "network") {
      toast("Voice ke liye internet chahiye.");
      stopVoiceMode();
    }
  };
  voiceRecog.onend = () => {
    voiceRecog = null;
    if (!voiceMode) return;
    if (heard.trim()) send(heard);
    else {
      toast("Kuch sunai nahi diya. 🗣 dabake phir se bolo.");
      stopVoiceMode();
    }
  };
  try {
    voiceRecog.start();
    voiceUI("listening");
  } catch {
    toast("Mic start nahi ho paaya.");
    stopVoiceMode();
  }
}
function stopVoiceMode() {
  voiceMode = false;
  try {
    voiceRecog?.abort();
  } catch {}
  voiceRecog = null;
  stopSpeaking();
  voiceUI("off");
}
$("#voice-mode").onclick = () => {
  if (voiceMode) return stopVoiceMode();
  if (!activeKey()) return openSettings("Paste your API key first.");
  stopMic();
  voiceMode = true;
  stopSpeaking();
  listenForVoice();
};
$("#vp-stop").onclick = () => {
  if (voiceMode) stopVoiceMode();
  else {
    stopMic();
    stopSpeaking();
    voiceUI("off");
  }
};

let libTab = "files";
document.querySelectorAll(".lib-tab").forEach(
  (t) =>
    (t.onclick = () => {
      libTab = t.dataset.tab;
      document.querySelectorAll(".lib-tab").forEach((x) => {
        x.classList.toggle("active", x === t);
        x.setAttribute("aria-selected", String(x === t));
      });
      renderLibrary();
    }),
);
$("#lib-search").addEventListener("input", () => renderLibrary());
const download = (name, text, type = "text/markdown") => {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => (URL.revokeObjectURL(a.href), a.remove()), 1000);
};
const safeName = (t) => (String(t).replace(/[^\p{L}\p{N} _-]+/gu, "").trim().slice(0, 50) || "note").replace(/\s+/g, "-");
function noteDialog(note) {
  return new Promise((resolve) => {
    const d = $("#note-dlg");
    $("#note-dlg-title").textContent = note ? "✏️ Edit" : "📝 New note";
    $("#note-title").value = note?.title || "";
    $("#note-body").value = note?.text || "";
    d.onclose = () => resolve(d.returnValue === "save" ? { title: $("#note-title").value.trim() || "Untitled note", text: $("#note-body").value } : null);
    d.returnValue = "";
    d.showModal();
    $("#note-title").focus();
  });
}
$("#lib-new-note").onclick = async () => {
  const r = await noteDialog(null);
  if (!r) return;
  try {
    await db.putNote({ id: newId(), type: "note", title: r.title.slice(0, 120), text: r.text, createdAt: Date.now() });
  } catch {
    toast("⚠ Note save nahi ho paaya (storage full?)");
  }
  renderLibrary();
};
$("#lib-export").onclick = async () => {
  const want = libTab === "saved" ? "answer" : "note";
  const items = (await db.notes()).filter((n) => n.type === want);
  if (!items.length) return toast("Export karne ke liye kuch nahi hai.");
  download(`project-s-${want === "answer" ? "saved-answers" : "notes"}.md`, items.map((n) => `# ${n.title}\n\n${n.text}\n`).join("\n---\n\n"));
};

async function renderLibrary() {
  const list = $("#lib-list");
  const q = $("#lib-search").value.trim().toLowerCase();
  $("#lib-new-note").hidden = libTab !== "notes";
  $("#lib-export").hidden = libTab === "files";
  list.innerHTML = '<p class="side-empty">Loading…</p>';
  if (libTab !== "files") return renderNotes(list, q);
  const items = [];
  for (const meta of await db.list()) {
    if (meta.fileCount === 0) continue;
    const chat = await db.get(meta.id);
    for (const m of chat?.messages || [])
      for (const f of m.attachments || []) if (!q || f.name.toLowerCase().includes(q) || meta.title.toLowerCase().includes(q)) items.push({ f, chat: meta, at: meta.updatedAt });
  }
  list.innerHTML = "";
  if (!items.length) {
    list.innerHTML = q ? '<p class="side-empty">Kuch nahi mila.</p>' : '<p class="side-empty">Abhi koi file nahi. Chat mein ＋ dabake photo, PDF, Word ya notes bhejo, wo yahan dikhengi.</p>';
    return;
  }
  for (const { f, chat } of items) {
    const card = document.createElement("div");
    card.className = "lib-card";
    const thumb = document.createElement("div");
    thumb.className = "lib-thumb";
    if (f.kind === "image") {
      const img = document.createElement("img");
      img.src = `data:${f.mime};base64,${f.data}`;
      img.alt = f.name;
      img.loading = "lazy";
      thumb.appendChild(img);
    } else thumb.textContent = f.kind === "pdf" ? "📄" : /\.docx$/i.test(f.name) ? "📘" : "📝";
    const info = document.createElement("div");
    info.className = "lib-info";
    const name = document.createElement("b");
    name.textContent = f.name;
    const size = document.createElement("small");
    const bytes = f.kind === "text" ? f.text.length : Math.round((f.data?.length || 0) * 0.75);
    size.textContent = bytes > 1e6 ? (bytes / 1e6).toFixed(1) + " MB" : Math.max(1, Math.round(bytes / 1e3)) + " KB";
    const from = document.createElement("a");
    from.href = "#";
    from.textContent = `From: ${chat.title}`;
    from.onclick = (e) => {
      e.preventDefault();
      openChat(chat.id);
    };
    const acts = document.createElement("div");
    acts.className = "lib-acts";
    for (const [label, q2] of [
      ["📝 Summarize", "Is file ka simple summary banao: main points, short mein."],
      ["📒 Notes", "Is file se revision ke liye study notes banao: headings, short points, important formulas/definitions, aur end mein 5 quick questions."],
      ["❓ Ask a question", ""],
    ]) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "chip-btn";
      b.textContent = label;
      b.onclick = async () => {
        await openChat(null);
        pendingFiles = [structuredClone(f)];
        renderPending();
        if (q2) send(q2);
        else {
          input.placeholder = `"${f.name}" ke baare mein poocho…`;
          input.focus();
        }
      };
      acts.appendChild(b);
    }
    info.append(name, size, from, acts);
    card.append(thumb, info);
    list.appendChild(card);
  }
}

async function renderNotes(list, q) {
  const want = libTab === "saved" ? "answer" : "note";
  const items = (await db.notes()).filter((n) => n.type === want && (!q || n.title.toLowerCase().includes(q) || n.text.toLowerCase().includes(q)));
  list.innerHTML = "";
  if (!items.length) {
    list.innerHTML = q
      ? '<p class="side-empty">Kuch nahi mila.</p>'
      : want === "answer"
        ? '<p class="side-empty">Abhi koi saved answer nahi. Kisi bhi jawab ke neeche ⭐ Save dabao.</p>'
        : '<p class="side-empty">Abhi koi note nahi. ＋ New note dabao.</p>';
    return;
  }
  for (const n of items) {
    const card = document.createElement("article");
    card.className = "note-card";
    const head = document.createElement("div");
    head.className = "note-head";
    const t = document.createElement("b");
    t.textContent = n.title;
    const when = document.createElement("small");
    when.textContent = new Date(n.updatedAt).toLocaleDateString();
    head.append(t, when);
    const body = document.createElement("div");
    body.className = "note-body bubble collapsed";
    body.innerHTML = renderMarkdown(n.text);
    decorate(body);
    const acts = document.createElement("div");
    acts.className = "lib-acts";
    const btn = (label, fn) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "chip-btn";
      b.textContent = label;
      b.onclick = fn;
      acts.appendChild(b);
      return b;
    };
    const more = btn("⤢ Open", () => {
      body.classList.toggle("collapsed");
      more.textContent = body.classList.contains("collapsed") ? "⤢ Open" : "⤡ Close";
    });
    if (n.type === "note")
      btn("✏️ Edit", async () => {
        const r = await noteDialog(n);
        if (!r) return;
        Object.assign(n, { title: r.title.slice(0, 120), text: r.text });
        await db.putNote(n);
        renderLibrary();
      });
    else
      btn("✏️ Rename", async () => {
        const v = prompt("Naya naam:", n.title);
        if (!v?.trim()) return;
        n.title = v.trim().slice(0, 120);
        await db.putNote(n);
        renderLibrary();
      });
    if (n.chatId)
      btn("💬 Chat", async () => {
        if (await db.get(n.chatId)) openChat(n.chatId);
        else toast("Wo chat ab nahi hai (delete ho gayi).");
      });
    btn("⬇ Export", () => download(safeName(n.title) + ".md", `# ${n.title}\n\n${n.text}\n`));
    btn("🗑 Delete", async () => {
      if (!confirm(`"${n.title}" delete karein?`)) return;
      await db.delNote(n.id);
      renderLibrary();
    });
    card.append(head, body, acts);
    list.appendChild(card);
  }
}

// ---------- Subject theme picker (changes only this chat's colours) ----------
const subjMenu = $("#subject-menu");
for (const [key, t] of Object.entries(SUBJECTS)) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "subj-opt";
  b.dataset.subject = key;
  b.innerHTML = `<i style="background:${t.a}"></i>`;
  b.append(t.label);
  b.onclick = async () => {
    subjMenu.hidden = true;
    applySubject(key);
    if (currentChat) {
      currentChat.subject = key;
      currentChat.subjectManual = true;
      if (currentChat.messages.length) await saveChat(currentChat);
      renderSidebar();
    } else nextSubject = key;
    updateSubjectUI();
  };
  subjMenu.appendChild(b);
}
let nextSubject = null;
function updateSubjectUI() {
  const key = currentChat?.subject || nextSubject || "general";
  $("#subject-btn").textContent = (SUBJECTS[key] || SUBJECTS.general).label.split(" ")[0];
  $("#subject-btn").title = "Theme: " + (SUBJECTS[key] || SUBJECTS.general).label;
  subjMenu.querySelectorAll(".subj-opt").forEach((b) => b.classList.toggle("active", b.dataset.subject === key));
}
$("#subject-btn").onclick = (e) => {
  e.stopPropagation();
  modeMenu.hidden = true;
  subjMenu.hidden = !subjMenu.hidden;
};
document.addEventListener("click", (e) => {
  if (!subjMenu.hidden && !subjMenu.contains(e.target)) subjMenu.hidden = true;
});

// ---------- Chat history tools: rename, backup, restore ----------
async function renameChat(id) {
  const chat = await db.get(id);
  if (!chat) return;
  const name = prompt("Chat ka naya naam:", chat.title);
  if (!name || !name.trim()) return;
  chat.title = name.trim().slice(0, 80);
  await db.put(chat);
  if (currentChat?.id === id) {
    currentChat.title = chat.title;
    $("#chat-title").textContent = chat.title;
  }
  renderSidebar();
}
$("#export-chats").onclick = async () => {
  const metas = await db.list();
  const chats = [];
  for (const m of metas) {
    const c = await db.get(m.id);
    if (c) chats.push(c);
  }
  const notes = await db.notes().catch(() => []);
  const blob = new Blob([JSON.stringify({ app: "Project S", version: 5, exportedAt: new Date().toISOString(), chats, memory, notes }, null, 1)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `project-s-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => (URL.revokeObjectURL(a.href), a.remove()), 1000);
  toast(`💾 Backup ready: ${chats.length} chats (API keys are NOT included).`);
};
$("#import-chats").onclick = () => $("#import-file").click();
$("#import-file").onchange = async (e) => {
  const f = e.target.files[0];
  e.target.value = "";
  if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    if (!Array.isArray(data.chats)) throw new Error("not a Project S backup");
    let n = 0;
    for (const c of data.chats) {
      if (!c?.id || !Array.isArray(c.messages)) continue;
      c.title = String(c.title || "Chat").slice(0, 80);
      const keep = c.updatedAt;
      await db.put(c);
      n++;
      if (keep) c.updatedAt = keep;
    }
    if (Array.isArray(data.memory)) for (const m of data.memory) if (m?.text) rememberFact(m.text);
    if (Array.isArray(data.notes)) for (const n of data.notes) if (n?.id && n.text != null) await db.putNote({ ...n, title: String(n.title || "Note").slice(0, 120) });
    renderMemory();
    renderSidebar();
    toast(`✅ ${n} chats restored.`);
  } catch (err) {
    toast("Couldn't restore: " + err.message);
  }
};
function renderMemory() {
  const list = $("#memory-list");
  list.innerHTML = "";
  if (!memory.length) {
    const p = document.createElement("p");
    p.className = "small";
    p.textContent = "Abhi kuch yaad nahi. Chat mein bolo \"yaad rakhna, main class 12 mein hoon\", ya neeche khud add karo.";
    list.appendChild(p);
  }
  for (const m of memory) {
    const row = document.createElement("div");
    row.className = "mem-row";
    const t = document.createElement("span");
    t.textContent = m.text;
    const ed = document.createElement("button");
    ed.type = "button";
    ed.className = "del";
    ed.textContent = "✏️";
    ed.title = "Edit";
    ed.onclick = () => {
      const v = prompt("Memory edit karo:", m.text);
      if (v == null) return;
      if (!v.trim()) memory = memory.filter((y) => y.id !== m.id);
      else m.text = v.trim().slice(0, 300);
      saveMemory();
      renderMemory();
    };
    const x = document.createElement("button");
    x.type = "button";
    x.className = "del";
    x.textContent = "🗑";
    x.title = "Forget this";
    x.onclick = () => {
      memory = memory.filter((y) => y.id !== m.id);
      saveMemory();
      renderMemory();
    };
    row.append(t, ed, x);
    list.appendChild(row);
  }
}
$("#mem-add").onclick = () => {
  const v = $("#mem-new").value.trim();
  if (!v) return;
  rememberFact(v);
  $("#mem-new").value = "";
  renderMemory();
};
$("#mem-new").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    $("#mem-add").click();
  }
});

// ---------- Settings helpers: voices, storage, key test ----------
function fillVoices() {
  const sel = $("#set-voicename");
  const voices = window.speechSynthesis?.getVoices() || [];
  sel.innerHTML = "";
  sel.add(new Option("Auto (language ke hisaab se)", ""));
  for (const v of voices.filter((v) => /^(hi|en)/i.test(v.lang))) sel.add(new Option(`${v.name} (${v.lang})`, v.name));
  sel.value = voices.some((v) => v.name === settings.voiceName) ? settings.voiceName : "";
  sel.disabled = !window.speechSynthesis;
}
if (window.speechSynthesis) window.speechSynthesis.onvoiceschanged = () => dialog.open && fillVoices();
$("#set-rate").oninput = (e) => ($("#rate-val").textContent = (+e.target.value).toFixed(1) + "×");
$("#test-voice").onclick = () => {
  const old = { voiceName: settings.voiceName, voiceRate: settings.voiceRate };
  settings.voiceName = $("#set-voicename").value;
  settings.voiceRate = +$("#set-rate").value;
  readAloud("Namaste! Main S hoon. Aapka personal AI assistant.", null, () => {});
  voiceUI(voiceMode ? "speaking" : "off");
  Object.assign(settings, old);
};
async function showStorage() {
  const el = $("#storage-info");
  try {
    const [est, chats, notes] = await Promise.all([navigator.storage?.estimate?.(), db.list(), db.notes()]);
    const persisted = await navigator.storage?.persisted?.();
    const mb = (n) => (n / 1e6).toFixed(1) + " MB";
    el.textContent = `💽 Storage: ${chats.length} chats, ${notes.length} Library items, ${memory.length} memories` + (est ? ` · ${mb(est.usage || 0)} used of about ${mb(est.quota || 0)}` : "") + (persisted ? " · protected from auto-cleanup ✅" : "") + ". Sab kuch sirf isi browser mein hai.";
  } catch {
    el.textContent = "💽 Storage info isn't available in this browser.";
  }
}
const KEY_FIELDS = { gemini: "#set-gkey", openrouter: "#set-okey", claude: "#set-key" };
async function testKey(brain, key) {
  if (!key) return "❌ Pehle key paste karo.";
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res =
      brain === "gemini"
        ? await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1", { headers: { "x-goog-api-key": key }, signal: ctrl.signal })
        : brain === "openrouter"
          ? await fetch("https://openrouter.ai/api/v1/key", { headers: { Authorization: "Bearer " + key }, signal: ctrl.signal })
          : await fetch("https://api.anthropic.com/v1/models?limit=1", { headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" }, signal: ctrl.signal });
    if (res.ok) return "✅ Key sahi hai, connect ho gaya.";
    if ([400, 401, 403].includes(res.status)) return `❌ Key reject ho gayi (${res.status}). Sahi key copy-paste karo.`;
    if (res.status === 429) return "⚠ Key sahi lagti hai, par abhi limit khatam hai. Thodi der baad try karo.";
    return `⚠ Provider ne error diya (${res.status}). Thodi der baad try karo.`;
  } catch {
    return "⚠ Provider tak nahi pahunch paaye. Internet check karo.";
  } finally {
    clearTimeout(timer);
  }
}
for (const [brain, sel] of Object.entries(KEY_FIELDS)) {
  const box = $(sel).closest(".key-row").nextElementSibling;
  if (!box?.classList.contains("key-tools")) continue;
  const status = box.querySelector(".key-status");
  box.querySelector(".test-key").onclick = async () => {
    status.textContent = "⏳ Checking…";
    status.textContent = await testKey(brain, $(sel).value.trim());
  };
  box.querySelector(".remove-key").onclick = () => {
    if (!$(sel).value && !keyFor(brain)) return;
    if (!confirm("Ye key is browser se hata dein?")) return;
    $(sel).value = "";
    settings[{ gemini: "geminiKey", openrouter: "openrouterKey", claude: "claudeKey" }[brain]] = "";
    saveSettings();
    status.textContent = "🗑 Key hata di gayi.";
    renderSidebar();
  };
}
document.querySelectorAll(".set-tabs a").forEach(
  (a) =>
    (a.onclick = (e) => {
      e.preventDefault();
      $(a.getAttribute("href")).scrollIntoView({ behavior: "smooth", block: "start" });
    }),
);

// ---------- About ----------
const about = $("#about");
document.querySelectorAll(".open-about").forEach(
  (b) =>
    (b.onclick = () => {
      document.body.classList.remove("side-open");
      if (dialog.open) dialog.close();
      about.showModal();
    }),
);
$(".about-x").onclick = () => about.close();

// ---------- Mode + model selector ----------
const modeMenu = $("#mode-menu");
for (const [key, m] of Object.entries(MODES)) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "mode-opt";
  b.dataset.mode = key;
  const t = document.createElement("b");
  t.textContent = m.label;
  const d = document.createElement("span");
  d.textContent = m.desc;
  b.append(t, d);
  b.onclick = () => setMode(key);
  $("#mode-list").appendChild(b);
}
function setMode(key, quiet = false) {
  settings.mode = key;
  saveSettings();
  updateModeUI();
  if (!quiet) {
    modeMenu.hidden = true;
    toast(`${MODES[mode()].label} mode · ${activeModel()}` + (key === "research" ? " · web search on" : ""));
  }
}
function updateModeUI() {
  $("#mode-btn").textContent = `${MODES[mode()].label} ▾`;
  document.querySelectorAll(".mode-opt").forEach((b) => b.classList.toggle("active", b.dataset.mode === mode()));
  document.querySelectorAll(".mode-link").forEach((b) => b.classList.toggle("active", b.dataset.mode === mode()));
  // Extra choice for some modes
  const extra = $("#mode-extra");
  extra.innerHTML = "";
  const choice = (label, opts, key) => {
    const l = document.createElement("label");
    l.className = "menu-label";
    l.textContent = label;
    const sel = document.createElement("select");
    for (const [v, t] of Object.entries(opts)) sel.add(new Option(t, v));
    sel.value = settings[key];
    sel.onchange = () => {
      settings[key] = sel.value;
      saveSettings();
    };
    l.appendChild(sel);
    extra.appendChild(l);
  };
  if (mode() === "study") choice("Level", LEVELS, "level");
  if (mode() === "writing") {
    choice("Style", WRITING_STYLES, "writingStyle");
    choice("Language", { auto: "Auto", hinglish: "Hinglish", hindi: "हिंदी", english: "English" }, "language");
  }
  $("#brain-pick").value = settings.provider;
  const pick = $("#model-pick");
  const opts = settings.provider === "gemini" ? GEMINI_FREE : settings.provider === "claude" ? CLAUDE_MODELS : [];
  const current = settings.provider === "gemini" ? settings.geminiModel : settings.model;
  pick.innerHTML = "";
  pick.add(new Option(`Auto (${activeModel()})`, "auto"));
  for (const m of opts) pick.add(new Option(MODEL_NAMES[m] || m, m));
  pick.value = settings.provider === "openrouter" ? "auto" : opts.includes(current) ? current : "auto";
  pick.disabled = settings.provider === "openrouter";
  const web = $("#web-toggle");
  web.setAttribute("aria-pressed", String(searchOn()));
  web.textContent = `🌐 Web search: ${searchOn() ? "On" : "Off"}` + (mode() === "research" && !settings.webSearch ? " (Research)" : "");
}
$("#mode-btn").onclick = (e) => {
  e.stopPropagation();
  subjMenu.hidden = true;
  modeMenu.hidden = !modeMenu.hidden;
};
document.addEventListener("click", (e) => {
  if (!modeMenu.hidden && !modeMenu.contains(e.target) && e.target !== $("#mode-btn")) modeMenu.hidden = true;
});
$("#brain-pick").onchange = (e) => {
  const brain = e.target.value;
  if (!keyFor(brain)) {
    modeMenu.hidden = true;
    e.target.value = settings.provider;
    openSettings(`${BRAIN_NAMES[brain]} ke liye pehle uski API key daalo.`);
    $("#set-provider").value = brain;
    showProviderFields();
    return;
  }
  settings.provider = brain;
  saveSettings();
  renderSidebar();
  toast(`🤖 ${BRAIN_NAMES[brain]} · ${activeModel()}`);
};
document.querySelectorAll(".mode-link").forEach(
  (b) =>
    (b.onclick = async () => {
      setMode(b.dataset.mode, true);
      await openChat(null);
      toast(`${MODES[mode()].label} mode: ${MODES[mode()].desc}`);
      input.focus();
    }),
);
$("#model-pick").onchange = (e) => {
  if (settings.provider === "gemini") settings.geminiModel = e.target.value;
  else if (settings.provider === "claude") settings.model = e.target.value;
  saveSettings();
  renderSidebar();
};
$("#web-toggle").onclick = () => {
  settings.webSearch = !settings.webSearch;
  saveSettings();
  updateModeUI();
};
// Quick actions for attached files
document.querySelectorAll(".doc-act").forEach((b) => (b.onclick = () => send(b.dataset.q)));

stars = startStarfield($("#stars"));
setBusy(false);
migrateOldChats()
  .catch(console.error)
  .finally(() => openChat(null));
playIntro().then(() => {
  if (!activeKey()) openGuide();
});
