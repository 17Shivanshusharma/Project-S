#!/usr/bin/env node
/*
 * Project S by Shivanshu Sharma: JavaScript (Node.js) version.
 * A terminal chat with S, using the free Google Gemini API.
 *
 * Run:   node s.js            (Node.js 18 or newer, no npm packages)
 * Needs: a free Gemini key from https://aistudio.google.com/apikey
 *        (set GEMINI_API_KEY, or paste it when asked)
 */
const readline = require("node:readline");

const API_BASE = process.env.S_API_BASE || "https://generativelanguage.googleapis.com";
// Free Gemini models, best daily limit first. If one is used up, S tries the next.
const MODELS = process.env.GEMINI_MODEL
  ? [process.env.GEMINI_MODEL]
  : ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-3.8-flash", "gemini-3.6-flash"];
const SYSTEM_PROMPT =
  "You are S, a friendly, brilliant personal AI assistant and tutor made by Shivanshu Sharma. " +
  "Help with every school subject, competitive exams, coding in any language, writing and general questions. " +
  "Reply in the same language the user writes in (Hinglish if they write Hinglish). " +
  "For maths and science, solve step by step and end with a clear final answer. " +
  "This is a terminal, so use plain text: no LaTeX, and keep Markdown light.";

const VIOLET = "\x1b[95m", PINK = "\x1b[35m", GREY = "\x1b[90m", RED = "\x1b[91m", RESET = "\x1b[0m";

class GeminiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** Send the chat to Gemini and print the reply piece by piece as it arrives. */
async function streamReply(key, model, history) {
  let res;
  try {
    res = await fetch(`${API_BASE}/v1beta/models/${model}:streamGenerateContent?alt=sse`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] }, contents: history }),
      signal: AbortSignal.timeout(120000),
    });
  } catch (e) {
    throw new GeminiError(0, `Couldn't reach Gemini (${e.cause?.code || e.message}). Check your internet.`);
  }
  if (!res.ok) {
    let msg = res.statusText;
    try { msg = (await res.json()).error?.message || msg; } catch {}
    throw new GeminiError(res.status, msg);
  }

  let reply = "";
  let buffer = "";
  const decoder = new TextDecoder();
  for await (const bytes of res.body) {
    buffer += decoder.decode(bytes, { stream: true });
    let nl;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line.startsWith("data:")) continue;
      const chunk = JSON.parse(line.slice(5));
      for (const part of chunk.candidates?.[0]?.content?.parts || []) {
        if (part.text && !part.thought) {
          process.stdout.write(part.text);
          reply += part.text;
        }
      }
    }
  }
  process.stdout.write("\n");
  return reply;
}

/** Try each free model until one answers. */
async function ask(key, history) {
  let last;
  for (const model of MODELS) {
    try {
      return await streamReply(key, model, history);
    } catch (e) {
      if (!(e instanceof GeminiError)) throw e;
      last = e;
      if (e.status === 404 || e.status === 429) {
        console.log(`${GREY}(${model} unavailable, trying another free model…)${RESET}`);
        continue;
      }
      break;
    }
  }
  throw last;
}

function explain(e) {
  if (e.status === 400 && /api key/i.test(e.message)) return "Your Gemini key was rejected. Check it and run S again.";
  if (e.status === 429) return "Gemini's free limit is used up for now. Try again later.\nGoogle said: " + e.message;
  return e.status > 0 ? `Gemini error ${e.status}: ${e.message}` : e.message;
}

async function main() {
  console.log(`${VIOLET}
   ██████  PROJECT S
  ██       ${PINK}by Shivanshu Sharma${VIOLET}
   █████   ${GREY}JavaScript version · your personal AI${VIOLET}
       ██
  ██████   ${GREY}Type /new for a new chat, /exit to quit.${RESET}
`);
  const rl = readline.createInterface({ input: process.stdin, terminal: process.stdin.isTTY });
  const lines = rl[Symbol.asyncIterator]();
  const prompt = async (q) => {
    process.stdout.write(q);
    const { value, done } = await lines.next();
    return done ? null : value.trim();
  };

  const key = process.env.GEMINI_API_KEY || (await prompt("Paste your free Gemini API key (from aistudio.google.com/apikey): "));
  if (!key) {
    console.log("A Gemini key is needed to talk to S.");
    process.exit(1);
  }

  let history = [];
  while (true) {
    const text = await prompt(`${PINK}You ›${RESET} `);
    if (text === null) { console.log("\nBye! 👋"); break; }
    if (!text) continue;
    if (text === "/exit" || text === "/quit") { console.log("Bye! 👋"); break; }
    if (text === "/new") { history = []; console.log(`${GREY}New chat started.${RESET}`); continue; }

    history.push({ role: "user", parts: [{ text }] });
    process.stdout.write(`${VIOLET}S ›${RESET} `);
    try {
      const reply = await ask(key, history);
      history.push({ role: "model", parts: [{ text: reply }] });
    } catch (e) {
      history.pop(); // forget the unanswered message
      console.log(`\n${RED}⚠ ${explain(e)}${RESET}`);
    }
  }
  rl.close();
}

main();
