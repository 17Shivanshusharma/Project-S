/*
 * Project S by Shivanshu Sharma: C version.
 * A terminal chat with S, using the free Google Gemini API.
 *
 * Build: gcc -O2 s.c -lcurl -o s
 * Run:   ./s
 * Needs: libcurl (Ubuntu/Debian: sudo apt install libcurl4-openssl-dev)
 *        and a free Gemini key from https://aistudio.google.com/apikey
 *        (set GEMINI_API_KEY, or paste it when asked)
 */
#include <ctype.h>
#include <curl/curl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define VIOLET "\033[95m"
#define PINK "\033[35m"
#define GREY "\033[90m"
#define RED "\033[91m"
#define RESET "\033[0m"
#define MAX_TURNS 2000

static const char *SYSTEM_PROMPT =
    "You are S, a friendly, brilliant personal AI assistant and tutor made by Shivanshu Sharma. "
    "Help with every school subject, competitive exams, coding in any language, writing and general questions. "
    "Reply in the same language the user writes in (Hinglish if they write Hinglish). "
    "If anyone asks who made you, say Shivanshu Sharma made you; if anyone asks who Shivanshu Sharma is, say Shivanshu Sharma is the one who made you. "
    "For maths and science, solve step by step and end with a clear final answer. "
    "This is a terminal, so use plain text: no LaTeX, and keep Markdown light.";

static const char *FREE_MODELS[] = {"gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-3.8-flash", "gemini-3.6-flash"};

/* ---------- a growable string ---------- */
typedef struct {
    char *data;
    size_t len, cap;
} Buf;

static void buf_add(Buf *b, const char *s, size_t n) {
    if (b->len + n + 1 > b->cap) {
        b->cap = (b->len + n + 1) * 2;
        b->data = realloc(b->data, b->cap);
        if (!b->data) { fputs("Out of memory\n", stderr); exit(1); }
    }
    memcpy(b->data + b->len, s, n);
    b->len += n;
    b->data[b->len] = '\0';
}
static void buf_str(Buf *b, const char *s) { buf_add(b, s, strlen(s)); }
static void buf_chr(Buf *b, char c) { buf_add(b, &c, 1); }
static void buf_free(Buf *b) { free(b->data); b->data = NULL; b->len = b->cap = 0; }

/* ---------- tiny JSON helpers (enough for Gemini's requests and replies) ---------- */
static void json_quote(Buf *b, const char *s) {
    buf_chr(b, '"');
    for (const unsigned char *p = (const unsigned char *)s; *p; p++) {
        switch (*p) {
            case '"': buf_str(b, "\\\""); break;
            case '\\': buf_str(b, "\\\\"); break;
            case '\n': buf_str(b, "\\n"); break;
            case '\r': buf_str(b, "\\r"); break;
            case '\t': buf_str(b, "\\t"); break;
            default:
                if (*p < 0x20) {
                    char tmp[8];
                    snprintf(tmp, sizeof tmp, "\\u%04x", *p);
                    buf_str(b, tmp);
                } else {
                    buf_chr(b, (char)*p); /* UTF-8 bytes pass through unchanged */
                }
        }
    }
    buf_chr(b, '"');
}

static void add_utf8(Buf *b, unsigned cp) {
    char t[4];
    if (cp < 0x80) { t[0] = (char)cp; buf_add(b, t, 1); }
    else if (cp < 0x800) { t[0] = (char)(0xC0 | (cp >> 6)); t[1] = (char)(0x80 | (cp & 0x3F)); buf_add(b, t, 2); }
    else if (cp < 0x10000) {
        t[0] = (char)(0xE0 | (cp >> 12)); t[1] = (char)(0x80 | ((cp >> 6) & 0x3F)); t[2] = (char)(0x80 | (cp & 0x3F));
        buf_add(b, t, 3);
    } else {
        t[0] = (char)(0xF0 | (cp >> 18)); t[1] = (char)(0x80 | ((cp >> 12) & 0x3F));
        t[2] = (char)(0x80 | ((cp >> 6) & 0x3F)); t[3] = (char)(0x80 | (cp & 0x3F));
        buf_add(b, t, 4);
    }
}

static unsigned hex4(const char *p) {
    char tmp[5] = {p[0], p[1], p[2], p[3], 0};
    return (unsigned)strtoul(tmp, NULL, 16);
}

/* Reads a JSON string starting just after its opening quote; returns a pointer past the closing quote. */
static const char *read_string(const char *p, Buf *out) {
    while (*p && *p != '"') {
        if (*p != '\\') { buf_chr(out, *p++); continue; }
        p++;
        switch (*p) {
            case 'n': buf_chr(out, '\n'); p++; break;
            case 't': buf_chr(out, '\t'); p++; break;
            case 'r': buf_chr(out, '\r'); p++; break;
            case 'b': buf_chr(out, '\b'); p++; break;
            case 'f': buf_chr(out, '\f'); p++; break;
            case 'u': {
                unsigned cp = hex4(p + 1);
                p += 5;
                /* Characters like emoji come as two \u escapes (a surrogate pair). */
                if (cp >= 0xD800 && cp <= 0xDBFF && p[0] == '\\' && p[1] == 'u') {
                    unsigned lo = hex4(p + 2);
                    cp = 0x10000 + ((cp - 0xD800) << 10) + (lo - 0xDC00);
                    p += 6;
                }
                add_utf8(out, cp);
                break;
            }
            default: if (*p) buf_chr(out, *p++); /* \" \\ \/ */
        }
    }
    return *p ? p + 1 : p;
}

/* Joins every string value stored under `key` into `out`. Returns how many were found. */
static int strings_for(const char *json, const char *key, Buf *out, int first_only) {
    char needle[64];
    snprintf(needle, sizeof needle, "\"%s\"", key);
    int found = 0;
    const char *p = json;
    while ((p = strstr(p, needle))) {
        p += strlen(needle);
        while (isspace((unsigned char)*p)) p++;
        if (*p != ':') continue;
        p++;
        while (isspace((unsigned char)*p)) p++;
        if (*p == '"') {
            p = read_string(p + 1, out);
            found++;
            if (first_only) break;
        }
    }
    return found;
}

/* ---------- the chat ---------- */
typedef struct {
    const char *role; /* "user" or "model" */
    char *text;
} Message;

static Message history[MAX_TURNS];
static int turns = 0;

static size_t collect(char *data, size_t size, size_t n, void *out) {
    buf_add((Buf *)out, data, size * n);
    return size * n;
}

/* Sends the chat to one model. Returns the HTTP status (0 = network problem); reply or error text goes in `out`. */
static long generate(const char *key, const char *model, Buf *out) {
    Buf body = {0};
    buf_str(&body, "{\"systemInstruction\":{\"parts\":[{\"text\":");
    json_quote(&body, SYSTEM_PROMPT);
    buf_str(&body, "}]},\"contents\":[");
    for (int i = 0; i < turns; i++) {
        if (i) buf_chr(&body, ',');
        buf_str(&body, "{\"role\":\"");
        buf_str(&body, history[i].role);
        buf_str(&body, "\",\"parts\":[{\"text\":");
        json_quote(&body, history[i].text);
        buf_str(&body, "}]}");
    }
    buf_str(&body, "]}");

    const char *base = getenv("S_API_BASE");
    char url[512], key_header[512];
    snprintf(url, sizeof url, "%s/v1beta/models/%s:generateContent", base && *base ? base : "https://generativelanguage.googleapis.com", model);
    snprintf(key_header, sizeof key_header, "x-goog-api-key: %s", key);

    Buf response = {0};
    buf_str(&response, "");
    CURL *curl = curl_easy_init();
    struct curl_slist *headers = curl_slist_append(NULL, "Content-Type: application/json");
    headers = curl_slist_append(headers, key_header);
    curl_easy_setopt(curl, CURLOPT_URL, url);
    curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);
    curl_easy_setopt(curl, CURLOPT_POSTFIELDS, body.data);
    curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, collect);
    curl_easy_setopt(curl, CURLOPT_WRITEDATA, &response);
    curl_easy_setopt(curl, CURLOPT_TIMEOUT, 120L);
    CURLcode rc = curl_easy_perform(curl);
    long status = 0;
    curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &status);
    curl_slist_free_all(headers);
    curl_easy_cleanup(curl);
    buf_free(&body);

    if (rc != CURLE_OK) {
        buf_str(out, "Couldn't reach Gemini (");
        buf_str(out, curl_easy_strerror(rc));
        buf_str(out, "). Check your internet.");
        status = 0;
    } else if (status != 200) {
        if (!strings_for(response.data, "message", out, 1)) buf_str(out, response.data);
    } else if (!strings_for(response.data, "text", out, 0) || out->len == 0) {
        buf_str(out, "Gemini sent an empty reply (it may have declined). Try asking another way.");
        status = -1;
    }
    buf_free(&response);
    return status;
}

/* Try each free model until one answers. */
static long ask(const char *key, Buf *out) {
    const char *only = getenv("GEMINI_MODEL");
    int count = only && *only ? 1 : (int)(sizeof FREE_MODELS / sizeof *FREE_MODELS);
    long status = 0;
    for (int i = 0; i < count; i++) {
        const char *model = only && *only ? only : FREE_MODELS[i];
        out->len = 0;
        if (out->data) out->data[0] = '\0';
        status = generate(key, model, out);
        if (status == 404 || status == 429) {
            printf(GREY "(%s unavailable, trying another free model…)" RESET "\n", model);
            continue;
        }
        break;
    }
    return status;
}

static void read_line(char **line, size_t *cap, int *ok) {
    ssize_t n = getline(line, cap, stdin);
    *ok = n >= 0;
    if (*ok) {
        while (n > 0 && ((*line)[n - 1] == '\n' || (*line)[n - 1] == '\r')) (*line)[--n] = '\0';
    }
}

int main(void) {
    curl_global_init(CURL_GLOBAL_DEFAULT);
    printf(VIOLET "\n   ██████  PROJECT S\n  ██       " PINK "by Shivanshu Sharma" VIOLET
                  "\n   █████   " GREY "C version · your personal AI" VIOLET "\n       ██\n  ██████   " GREY
                  "Type /new for a new chat, /exit to quit." RESET "\n\n");

    char *line = NULL;
    size_t cap = 0;
    int ok = 1;
    const char *env_key = getenv("GEMINI_API_KEY");
    char *key;
    if (env_key && *env_key) {
        key = strdup(env_key);
    } else {
        printf("Paste your free Gemini API key (from aistudio.google.com/apikey): ");
        fflush(stdout);
        read_line(&line, &cap, &ok);
        key = strdup(ok ? line : "");
    }
    if (!*key) {
        puts("A Gemini key is needed to talk to S.");
        return 1;
    }

    Buf reply = {0};
    while (1) {
        printf(PINK "You › " RESET);
        fflush(stdout);
        read_line(&line, &cap, &ok);
        if (!ok) { puts("\nBye! 👋"); break; }
        if (!*line) continue;
        if (!strcmp(line, "/exit") || !strcmp(line, "/quit")) { puts("Bye! 👋"); break; }
        if (!strcmp(line, "/new")) {
            for (int i = 0; i < turns; i++) free(history[i].text);
            turns = 0;
            puts(GREY "New chat started." RESET);
            continue;
        }
        if (turns >= MAX_TURNS - 1) {
            puts(GREY "This chat is very long. Type /new to start a fresh one." RESET);
            continue;
        }

        history[turns].role = "user";
        history[turns].text = strdup(line);
        turns++;
        long status = ask(key, &reply);
        if (status == 200) {
            history[turns].role = "model";
            history[turns].text = strdup(reply.data);
            turns++;
            printf(VIOLET "S › " RESET "%s\n", reply.data);
        } else {
            turns--; /* forget the unanswered message */
            free(history[turns].text);
            if (status == 400 && strstr(reply.data, "API key"))
                puts(RED "⚠ Your Gemini key was rejected. Check it and run S again." RESET);
            else if (status == 429)
                printf(RED "⚠ Gemini's free limit is used up for now. Try again later.\nGoogle said: %s" RESET "\n", reply.data);
            else if (status > 0)
                printf(RED "⚠ Gemini error %ld: %s" RESET "\n", status, reply.data);
            else
                printf(RED "⚠ %s" RESET "\n", reply.data);
        }
    }
    for (int i = 0; i < turns; i++) free(history[i].text);
    buf_free(&reply);
    free(line);
    free(key);
    curl_global_cleanup();
    return 0;
}
