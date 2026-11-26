// Project S by Shivanshu Sharma: C++ version.
// A terminal chat with S, using the free Google Gemini API.
//
// Build: g++ -std=c++17 -O2 s.cpp -lcurl -o s
// Run:   ./s
// Needs: libcurl (Ubuntu/Debian: sudo apt install libcurl4-openssl-dev)
//        and a free Gemini key from https://aistudio.google.com/apikey
//        (set GEMINI_API_KEY, or paste it when asked)
#include <curl/curl.h>

#include <cctype>
#include <cstdio>
#include <cstdlib>
#include <iostream>
#include <string>
#include <vector>

namespace {

const std::string kViolet = "\033[95m", kPink = "\033[35m", kGrey = "\033[90m", kRed = "\033[91m", kReset = "\033[0m";

const char* kSystemPrompt =
    "You are S, a friendly, brilliant personal AI assistant and tutor made by Shivanshu Sharma. "
    "Help with every school subject, competitive exams, coding in any language, writing and general questions. "
    "Reply in the same language the user writes in (Hinglish if they write Hinglish). "
    "If anyone asks who made you, say Shivanshu Sharma made you; if anyone asks who Shivanshu Sharma is, say Shivanshu Sharma is the one who made you. "
    "Explain so simply that anyone can understand: everyday words, small steps, say why each step is done, explain new terms, use real-life examples, check the answer, and never call the question easy or mention the user's level. "
    "For maths and science, solve step by step and end with a clear final answer. "
    "This is a terminal, so use plain text: no LaTeX, and keep Markdown light.";

struct Message {
  std::string role;  // "user" or "model"
  std::string text;
};

struct GeminiError {
  long status;
  std::string message;
};

std::string Env(const char* name, const std::string& fallback) {
  const char* v = std::getenv(name);
  return (v && *v) ? v : fallback;
}

// ---------- tiny JSON helpers (enough for Gemini's requests and replies) ----------

std::string Quote(const std::string& s) {
  std::string out = "\"";
  for (unsigned char c : s) {
    switch (c) {
      case '"': out += "\\\""; break;
      case '\\': out += "\\\\"; break;
      case '\n': out += "\\n"; break;
      case '\r': out += "\\r"; break;
      case '\t': out += "\\t"; break;
      default:
        if (c < 0x20) {
          char buf[8];
          std::snprintf(buf, sizeof buf, "\\u%04x", c);
          out += buf;
        } else {
          out += static_cast<char>(c);  // UTF-8 bytes pass through unchanged
        }
    }
  }
  return out + "\"";
}

void AppendUtf8(std::string& out, unsigned cp) {
  if (cp < 0x80) {
    out += static_cast<char>(cp);
  } else if (cp < 0x800) {
    out += static_cast<char>(0xC0 | (cp >> 6));
    out += static_cast<char>(0x80 | (cp & 0x3F));
  } else if (cp < 0x10000) {
    out += static_cast<char>(0xE0 | (cp >> 12));
    out += static_cast<char>(0x80 | ((cp >> 6) & 0x3F));
    out += static_cast<char>(0x80 | (cp & 0x3F));
  } else {
    out += static_cast<char>(0xF0 | (cp >> 18));
    out += static_cast<char>(0x80 | ((cp >> 12) & 0x3F));
    out += static_cast<char>(0x80 | ((cp >> 6) & 0x3F));
    out += static_cast<char>(0x80 | (cp & 0x3F));
  }
}

// Reads a JSON string that starts just after its opening quote.
std::string ReadString(const std::string& json, size_t& i) {
  std::string s;
  while (i < json.size()) {
    char c = json[i++];
    if (c == '"') break;
    if (c != '\\') { s += c; continue; }
    char e = json[i++];
    switch (e) {
      case 'n': s += '\n'; break;
      case 't': s += '\t'; break;
      case 'r': s += '\r'; break;
      case 'b': s += '\b'; break;
      case 'f': s += '\f'; break;
      case 'u': {
        unsigned cp = std::stoul(json.substr(i, 4), nullptr, 16);
        i += 4;
        // Characters like emoji come as two \u escapes (a surrogate pair).
        if (cp >= 0xD800 && cp <= 0xDBFF && json.compare(i, 2, "\\u") == 0) {
          unsigned lo = std::stoul(json.substr(i + 2, 4), nullptr, 16);
          cp = 0x10000 + ((cp - 0xD800) << 10) + (lo - 0xDC00);
          i += 6;
        }
        AppendUtf8(s, cp);
        break;
      }
      default: s += e;  // \" \\ \/
    }
  }
  return s;
}

// Finds every string value stored under a given key.
std::vector<std::string> StringsFor(const std::string& json, const std::string& key) {
  std::vector<std::string> out;
  const std::string needle = "\"" + key + "\"";
  size_t i = 0;
  while ((i = json.find(needle, i)) != std::string::npos) {
    i += needle.size();
    while (i < json.size() && std::isspace(static_cast<unsigned char>(json[i]))) i++;
    if (i >= json.size() || json[i] != ':') continue;
    i++;
    while (i < json.size() && std::isspace(static_cast<unsigned char>(json[i]))) i++;
    if (i < json.size() && json[i] == '"') {
      i++;
      out.push_back(ReadString(json, i));
    }
  }
  return out;
}

// ---------- talking to Gemini ----------

size_t Collect(char* data, size_t size, size_t n, void* out) {
  static_cast<std::string*>(out)->append(data, size * n);
  return size * n;
}

std::string Generate(const std::string& key, const std::string& model, const std::vector<Message>& history) {
  std::string body = std::string("{\"systemInstruction\":{\"parts\":[{\"text\":") + Quote(kSystemPrompt) + "}]},\"contents\":[";
  for (size_t i = 0; i < history.size(); i++) {
    if (i) body += ',';
    body += "{\"role\":\"" + history[i].role + "\",\"parts\":[{\"text\":" + Quote(history[i].text) + "}]}";
  }
  body += "]}";

  const std::string url = Env("S_API_BASE", "https://generativelanguage.googleapis.com") + "/v1beta/models/" + model + ":generateContent";
  const std::string key_header = "x-goog-api-key: " + key;

  CURL* curl = curl_easy_init();
  std::string response;
  curl_slist* headers = curl_slist_append(nullptr, "Content-Type: application/json");
  headers = curl_slist_append(headers, key_header.c_str());
  curl_easy_setopt(curl, CURLOPT_URL, url.c_str());
  curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);
  curl_easy_setopt(curl, CURLOPT_POSTFIELDS, body.c_str());
  curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, Collect);
  curl_easy_setopt(curl, CURLOPT_WRITEDATA, &response);
  curl_easy_setopt(curl, CURLOPT_TIMEOUT, 120L);
  CURLcode rc = curl_easy_perform(curl);
  long status = 0;
  curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &status);
  curl_slist_free_all(headers);
  curl_easy_cleanup(curl);

  if (rc != CURLE_OK)
    throw GeminiError{0, std::string("Couldn't reach Gemini (") + curl_easy_strerror(rc) + "). Check your internet."};
  if (status != 200) {
    auto msg = StringsFor(response, "message");
    throw GeminiError{status, msg.empty() ? response : msg[0]};
  }
  std::string reply;
  for (const auto& part : StringsFor(response, "text")) reply += part;
  if (reply.empty()) throw GeminiError{-1, "Gemini sent an empty reply (it may have declined). Try asking another way."};
  return reply;
}

// Try each free model until one answers.
std::string Ask(const std::string& key, const std::vector<Message>& history) {
  std::vector<std::string> models = {"gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-3.8-flash", "gemini-3.6-flash"};
  if (const char* m = std::getenv("GEMINI_MODEL"); m && *m) models = {m};
  GeminiError last{0, "No model answered."};
  for (const auto& model : models) {
    try {
      return Generate(key, model, history);
    } catch (const GeminiError& e) {
      last = e;
      if (e.status == 404 || e.status == 429) {
        std::cout << kGrey << "(" << model << " unavailable, trying another free model…)" << kReset << "\n";
        continue;
      }
      break;
    }
  }
  throw last;
}

std::string Explain(const GeminiError& e) {
  std::string lower = e.message;
  for (auto& c : lower) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
  if (e.status == 400 && lower.find("api key") != std::string::npos) return "Your Gemini key was rejected. Check it and run S again.";
  if (e.status == 429) return "Gemini's free limit is used up for now. Try again later.\nGoogle said: " + e.message;
  return e.status > 0 ? "Gemini error " + std::to_string(e.status) + ": " + e.message : e.message;
}

}  // namespace

int main() {
  curl_global_init(CURL_GLOBAL_DEFAULT);
  std::cout << kViolet << "\n   ██████  PROJECT S\n  ██       " << kPink << "by Shivanshu Sharma" << kViolet
            << "\n   █████   " << kGrey << "C++ version · your personal AI" << kViolet << "\n       ██\n  ██████   " << kGrey
            << "Type /new for a new chat, /exit to quit." << kReset << "\n\n";

  std::string key = Env("GEMINI_API_KEY", "");
  if (key.empty()) {
    std::cout << "Paste your free Gemini API key (from aistudio.google.com/apikey): ";
    std::getline(std::cin, key);
  }
  if (key.empty()) {
    std::cout << "A Gemini key is needed to talk to S.\n";
    return 1;
  }

  std::vector<Message> history;
  std::string text;
  while (true) {
    std::cout << kPink << "You › " << kReset << std::flush;
    if (!std::getline(std::cin, text)) { std::cout << "\nBye! 👋\n"; break; }
    if (text.empty()) continue;
    if (text == "/exit" || text == "/quit") { std::cout << "Bye! 👋\n"; break; }
    if (text == "/new") { history.clear(); std::cout << kGrey << "New chat started." << kReset << "\n"; continue; }

    history.push_back({"user", text});
    try {
      std::string reply = Ask(key, history);
      history.push_back({"model", reply});
      std::cout << kViolet << "S › " << kReset << reply << "\n";
    } catch (const GeminiError& e) {
      history.pop_back();  // forget the unanswered message
      std::cout << kRed << "⚠ " << Explain(e) << kReset << "\n";
    }
  }
  curl_global_cleanup();
  return 0;
}
