/*
 * Project S by Shivanshu Sharma: Java version.
 * A terminal chat with S, using the free Google Gemini API.
 *
 * Run:   java S.java          (Java 11 or newer, no extra libraries)
 * Needs: a free Gemini key from https://aistudio.google.com/apikey
 *        (set GEMINI_API_KEY, or paste it when asked)
 */
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Scanner;

public class S {
    static final String API_BASE = env("S_API_BASE", "https://generativelanguage.googleapis.com");
    // Free Gemini models, best daily limit first. If one is used up, S tries the next.
    static final String[] MODELS = System.getenv("GEMINI_MODEL") != null
            ? new String[] {System.getenv("GEMINI_MODEL")}
            : new String[] {"gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-3.8-flash", "gemini-3.6-flash"};
    static final String SYSTEM_PROMPT =
            "You are S, a friendly, brilliant personal AI assistant and tutor made by Shivanshu Sharma. "
          + "Help with every school subject, competitive exams, coding in any language, writing and general questions. "
          + "Reply in the same language the user writes in (Hinglish if they write Hinglish). "
          + "For maths and science, solve step by step and end with a clear final answer. "
          + "This is a terminal, so use plain text: no LaTeX, and keep Markdown light.";

    static final String VIOLET = "\033[95m", PINK = "\033[35m", GREY = "\033[90m", RED = "\033[91m", RESET = "\033[0m";
    static final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(20)).build();

    /** One message in the chat: role is "user" or "model". */
    record Message(String role, String text) {}

    static class GeminiException extends Exception {
        final int status;
        GeminiException(int status, String message) { super(message); this.status = status; }
    }

    public static void main(String[] args) throws Exception {
        // Print emoji and Hindi correctly on every system.
        System.setOut(new java.io.PrintStream(new java.io.FileOutputStream(java.io.FileDescriptor.out), true, "UTF-8"));
        System.out.println(VIOLET + "\n   ██████  PROJECT S\n  ██       " + PINK + "by Shivanshu Sharma" + VIOLET
                + "\n   █████   " + GREY + "Java version · your personal AI" + VIOLET
                + "\n       ██\n  ██████   " + GREY + "Type /new for a new chat, /exit to quit." + RESET + "\n");
        Scanner in = new Scanner(System.in, "UTF-8");
        String key = System.getenv("GEMINI_API_KEY");
        if (key == null || key.isBlank()) {
            System.out.print("Paste your free Gemini API key (from aistudio.google.com/apikey): ");
            key = in.hasNextLine() ? in.nextLine().trim() : "";
        }
        if (key.isEmpty()) { System.out.println("A Gemini key is needed to talk to S."); return; }

        List<Message> history = new ArrayList<>();
        while (true) {
            System.out.print(PINK + "You › " + RESET);
            if (!in.hasNextLine()) { System.out.println("\nBye! 👋"); break; }
            String text = in.nextLine().trim();
            if (text.isEmpty()) continue;
            if (text.equals("/exit") || text.equals("/quit")) { System.out.println("Bye! 👋"); break; }
            if (text.equals("/new")) { history.clear(); System.out.println(GREY + "New chat started." + RESET); continue; }

            history.add(new Message("user", text));
            try {
                String reply = ask(key, history);
                history.add(new Message("model", reply));
                System.out.println(VIOLET + "S › " + RESET + reply);
            } catch (GeminiException e) {
                history.remove(history.size() - 1); // forget the unanswered message
                System.out.println(RED + "⚠ " + explain(e) + RESET);
            }
        }
    }

    /** Try each free model until one answers. */
    static String ask(String key, List<Message> history) throws GeminiException {
        GeminiException last = null;
        for (String model : MODELS) {
            try {
                return generate(key, model, history);
            } catch (GeminiException e) {
                last = e;
                if (e.status == 404 || e.status == 429) {
                    System.out.println(GREY + "(" + model + " unavailable, trying another free model…)" + RESET);
                    continue;
                }
                break;
            }
        }
        throw last;
    }

    static String generate(String key, String model, List<Message> history) throws GeminiException {
        StringBuilder body = new StringBuilder();
        body.append("{\"systemInstruction\":{\"parts\":[{\"text\":").append(quote(SYSTEM_PROMPT)).append("}]},\"contents\":[");
        for (int i = 0; i < history.size(); i++) {
            Message m = history.get(i);
            if (i > 0) body.append(',');
            body.append("{\"role\":\"").append(m.role()).append("\",\"parts\":[{\"text\":").append(quote(m.text())).append("}]}");
        }
        body.append("]}");

        HttpRequest req = HttpRequest.newBuilder(URI.create(API_BASE + "/v1beta/models/" + model + ":generateContent"))
                .timeout(Duration.ofSeconds(120))
                .header("Content-Type", "application/json")
                .header("x-goog-api-key", key)
                .POST(HttpRequest.BodyPublishers.ofString(body.toString()))
                .build();
        HttpResponse<String> res;
        try {
            res = http.send(req, HttpResponse.BodyHandlers.ofString());
        } catch (Exception e) {
            throw new GeminiException(0, "Couldn't reach Gemini (" + e.getMessage() + "). Check your internet.");
        }
        if (res.statusCode() != 200) {
            List<String> msg = Json.stringsFor(res.body(), "message");
            throw new GeminiException(res.statusCode(), msg.isEmpty() ? res.body() : msg.get(0));
        }
        String reply = String.join("", Json.stringsFor(res.body(), "text"));
        if (reply.isEmpty()) throw new GeminiException(-1, "Gemini sent an empty reply (it may have declined). Try asking another way.");
        return reply;
    }

    static String explain(GeminiException e) {
        String m = e.getMessage();
        if (e.status == 400 && m.toLowerCase().contains("api key")) return "Your Gemini key was rejected. Check it and run S again.";
        if (e.status == 429) return "Gemini's free limit is used up for now. Try again later.\nGoogle said: " + m;
        return e.status > 0 ? "Gemini error " + e.status + ": " + m : m;
    }

    static String env(String name, String fallback) {
        String v = System.getenv(name);
        return v == null || v.isBlank() ? fallback : v;
    }

    /** Turn text into a JSON string literal. */
    static String quote(String s) {
        StringBuilder b = new StringBuilder("\"");
        for (char c : s.toCharArray()) {
            switch (c) {
                case '"' -> b.append("\\\"");
                case '\\' -> b.append("\\\\");
                case '\n' -> b.append("\\n");
                case '\r' -> b.append("\\r");
                case '\t' -> b.append("\\t");
                default -> {
                    if (c < 0x20) b.append(String.format("\\u%04x", (int) c));
                    else b.append(c);
                }
            }
        }
        return b.append('"').toString();
    }

    /** Tiny JSON helper: finds every string value stored under a given key. Enough for Gemini's replies. */
    static class Json {
        static List<String> stringsFor(String json, String key) {
            List<String> out = new ArrayList<>();
            String needle = "\"" + key + "\"";
            int i = 0;
            while ((i = json.indexOf(needle, i)) >= 0) {
                int j = i + needle.length();
                while (j < json.length() && Character.isWhitespace(json.charAt(j))) j++;
                if (j < json.length() && json.charAt(j) == ':') {
                    j++;
                    while (j < json.length() && Character.isWhitespace(json.charAt(j))) j++;
                    if (j < json.length() && json.charAt(j) == '"') {
                        StringBuilder s = new StringBuilder();
                        j = readString(json, j + 1, s);
                        out.add(s.toString());
                    }
                }
                i = j;
            }
            return out;
        }

        /** Reads a JSON string starting just after its opening quote; returns the index after the closing quote. */
        static int readString(String json, int i, StringBuilder s) {
            while (i < json.length()) {
                char c = json.charAt(i++);
                if (c == '"') return i;
                if (c != '\\') { s.append(c); continue; }
                char e = json.charAt(i++);
                switch (e) {
                    case 'n' -> s.append('\n');
                    case 't' -> s.append('\t');
                    case 'r' -> s.append('\r');
                    case 'b' -> s.append('\b');
                    case 'f' -> s.append('\f');
                    case 'u' -> { s.append((char) Integer.parseInt(json.substring(i, i + 4), 16)); i += 4; }
                    default -> s.append(e); // \" \\ \/
                }
            }
            return i;
        }
    }
}
