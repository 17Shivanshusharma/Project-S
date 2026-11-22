#!/usr/bin/env python3
"""
Project S by Shivanshu Sharma: Python version.
A terminal chat with S, using the free Google Gemini API.

Run:   python s.py
Needs: Python 3.8+ (no extra packages) and a free Gemini key from
       https://aistudio.google.com/apikey  (set GEMINI_API_KEY, or paste it when asked)
"""
import json
import os
import sys
import urllib.error
import urllib.request

API_BASE = os.environ.get("S_API_BASE", "https://generativelanguage.googleapis.com")
# Free Gemini models, best daily limit first. If one is used up, S tries the next.
MODELS = [os.environ["GEMINI_MODEL"]] if os.environ.get("GEMINI_MODEL") else [
    "gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-3.8-flash", "gemini-3.6-flash",
]
SYSTEM_PROMPT = (
    "You are S, a friendly, brilliant personal AI assistant and tutor made by Shivanshu Sharma. "
    "Help with every school subject, competitive exams, coding in any language, writing and general questions. "
    "Reply in the same language the user writes in (Hinglish if they write Hinglish). "
    "For maths and science, solve step by step and end with a clear final answer. "
    "This is a terminal, so use plain text: no LaTeX, and keep Markdown light."
)

VIOLET, PINK, GREY, RED, RESET = "\033[95m", "\033[35m", "\033[90m", "\033[91m", "\033[0m"


class GeminiError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status


def stream_reply(key, model, history):
    """Send the chat to Gemini and yield the reply piece by piece as it arrives."""
    body = json.dumps({
        "systemInstruction": {"parts": [{"text": SYSTEM_PROMPT}]},
        "contents": history,
    }).encode()
    req = urllib.request.Request(
        f"{API_BASE}/v1beta/models/{model}:streamGenerateContent?alt=sse",
        data=body,
        headers={"Content-Type": "application/json", "x-goog-api-key": key},
    )
    try:
        resp = urllib.request.urlopen(req, timeout=120)
    except urllib.error.HTTPError as e:
        try:
            msg = json.loads(e.read()).get("error", {}).get("message", "")
        except Exception:
            msg = e.reason
        raise GeminiError(e.code, msg)
    except urllib.error.URLError as e:
        raise GeminiError(0, f"Couldn't reach Gemini ({e.reason}). Check your internet.")

    with resp:
        for raw in resp:
            line = raw.decode("utf-8").strip()
            if not line.startswith("data:"):
                continue
            chunk = json.loads(line[5:])
            for cand in chunk.get("candidates", [])[:1]:
                for part in cand.get("content", {}).get("parts", []):
                    if part.get("text") and not part.get("thought"):
                        yield part["text"]


def ask(key, history):
    """Try each free model until one answers. Returns the full reply text."""
    last_error = None
    for model in MODELS:
        try:
            reply = ""
            for piece in stream_reply(key, model, history):
                print(piece, end="", flush=True)
                reply += piece
            print()
            return reply
        except GeminiError as e:
            last_error = e
            if e.status in (404, 429):  # model missing or its free limit is used up: try the next one
                print(f"{GREY}({model} unavailable, trying another free model…){RESET}")
                continue
            break
    raise last_error


def explain(err):
    if err.status == 400 and "api key" in str(err).lower():
        return "Your Gemini key was rejected. Check it and run S again."
    if err.status == 429:
        return "Gemini's free limit is used up for now. Try again later.\nGoogle said: " + str(err)
    return f"Gemini error {err.status}: {err}"


def main():
    print(f"""{VIOLET}
   ██████  PROJECT S
  ██       {PINK}by Shivanshu Sharma{VIOLET}
   █████   {GREY}Python version · your personal AI{VIOLET}
       ██
  ██████   {GREY}Type /new for a new chat, /exit to quit.{RESET}
""")
    key = os.environ.get("GEMINI_API_KEY") or input("Paste your free Gemini API key (from aistudio.google.com/apikey): ").strip()
    if not key:
        sys.exit("A Gemini key is needed to talk to S.")

    history = []
    while True:
        try:
            text = input(f"{PINK}You ›{RESET} ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\nBye! 👋")
            break
        if not text:
            continue
        if text in ("/exit", "/quit"):
            print("Bye! 👋")
            break
        if text == "/new":
            history = []
            print(f"{GREY}New chat started.{RESET}")
            continue

        history.append({"role": "user", "parts": [{"text": text}]})
        print(f"{VIOLET}S ›{RESET} ", end="", flush=True)
        try:
            reply = ask(key, history)
            history.append({"role": "model", "parts": [{"text": reply}]})
        except GeminiError as e:
            history.pop()  # forget the unanswered message
            print(f"\n{RED}⚠ {explain(e)}{RESET}")


if __name__ == "__main__":
    main()
