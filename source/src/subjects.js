// Each chat gets a colour theme from its subject. Only the open chat changes colour;
// a new chat or a general chat uses the normal electric blue.

export const SUBJECTS = {
  general: { label: "💬 General", a: "#3d8bff", a2: "#1f6bff", b: "#38bdf8", tint: "#0a1838" },
  maths: { label: "🧮 Maths", a: "#7c6cff", a2: "#5b4bf0", b: "#a5b4fc", tint: "#14123f" },
  physics: { label: "⚛️ Physics", a: "#22d3ee", a2: "#0891b2", b: "#67e8f9", tint: "#062a36" },
  chemistry: { label: "🧪 Chemistry", a: "#22c55e", a2: "#15803d", b: "#86efac", tint: "#072a18" },
  biology: { label: "🧬 Biology", a: "#10b981", a2: "#047857", b: "#a7f3d0", tint: "#06291f" },
  history: { label: "📜 History", a: "#f59e0b", a2: "#b45309", b: "#fcd34d", tint: "#2a1a06" },
  geography: { label: "🌍 Geography", a: "#14b8a6", a2: "#0f766e", b: "#5eead4", tint: "#06282a" },
  languages: { label: "📝 English/Hindi", a: "#f43f5e", a2: "#be123c", b: "#fda4af", tint: "#2a0812" },
  coding: { label: "💻 Coding", a: "#f97316", a2: "#c2410c", b: "#fdba74", tint: "#2a1306" },
  commerce: { label: "📊 Commerce", a: "#eab308", a2: "#a16207", b: "#fde047", tint: "#272106" },
};

// Words that point to a subject (English + Hinglish). The subject with the most hits wins.
const HINTS = {
  maths: /\b(math|maths|ganit|solve|equation|integra\w*|derivative|differentiat\w*|algebra|trigonometr\w*|sin|cos|tan|matrix|matrices|determinant|probability|quadratic|polynomial|logarithm|log|limit|calculus|geometry|triangle|circle|area|volume|percentage|ratio|fraction|lcm|hcf|prime|factori[sz]\w*|sequence|series|vector|statistics|mean|median)\b|[0-9]\s*[x-z]\s*[²^]|[x-z]\s*[²³^]\s*\d?|\d\s*[+\-×*/÷^]\s*\d|=\s*0/gi,
  physics: /\b(physics|bhautiki|force|newton|velocity|acceleration|momentum|gravity|gravitation|friction|work|energy|power|motion|projectile|current|voltage|resistance|ohm|circuit|magnet\w*|electric\w*|optics|lens|mirror|refraction|reflection|wave|sound|light|thermodynamics|heat|pressure|nuclear|quantum|relativity|kinematics)\b/gi,
  chemistry: /\b(chemistry|rasayan|chemical|reaction|mole|molar\w*|atom\w*|molecule|element|periodic|compound|acid|base|salt|ph|oxidation|reduction|redox|bond\w*|organic|inorganic|hydrocarbon|alkane|alkene|benzene|valency|electron\w*|isotope|catalyst|equilibrium|titration|h2o|co2|nacl|h2so4)\b/gi,
  biology: /\b(biology|jeev\w*|cell|dna|rna|gene\w*|photosynthesis|respiration|plant\w*|animal\w*|human body|heart|blood|digest\w*|enzyme|protein|evolution|ecosystem|bacteria|virus|organ\w*|tissue|hormone|reproduction|neet|chromosome|mitosis|meiosis|kidney|brain|nervous)\b/gi,
  history: /\b(history|itihas|war|revolution|empire|king|queen|mughal|british|freedom struggle|independence|gandhi|nehru|ancient|medieval|civili[sz]ation|dynasty|battle|colonial|french revolution|world war|harappa|maurya|gupta|akbar|ashoka)\b/gi,
  geography: /\b(geography|bhugol|map|river|mountain|climate|weather|monsoon|soil|continent|ocean|latitude|longitude|earthquake|volcano|population|resources|agriculture|plateau|desert|forest|country|capital)\b/gi,
  languages: /\b(english|hindi|grammar|essay|letter|poem|poetry|story|translate|translation|meaning|synonym|antonym|tense|noun|verb|adjective|paragraph|comprehension|summary of the chapter|vyakaran|nibandh|kavita|kahani|patra)\b/gi,
  coding: /\b(code|coding|program\w*|python|java|javascript|c\+\+|html|css|sql|function|loop|array|bug|error|debug|algorithm|compile\w*|api|react|node|class|variable|recursion|github|app|website)\b|```/gi,
  commerce: /\b(accounts?|accountancy|economics|arthshastra|business|commerce|profit|loss|gst|tax|balance sheet|journal|ledger|demand|supply|market|gdp|inflation|bank\w*|interest|investment|budget|marketing)\b/gi,
};

export function detectSubject(text) {
  let best = "general";
  let bestScore = 0;
  for (const [subject, re] of Object.entries(HINTS)) {
    const hits = (String(text || "").match(re) || []).length;
    if (hits > bestScore) {
      best = subject;
      bestScore = hits;
    }
  }
  return best;
}

const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)).join(", ");

// Switch the page colours to this subject's theme.
export function applySubject(subject) {
  const t = SUBJECTS[subject] || SUBJECTS.general;
  const root = document.documentElement.style;
  root.setProperty("--violet", t.a);
  root.setProperty("--violet-2", t.a2);
  root.setProperty("--magenta", t.b);
  root.setProperty("--accent-rgb", hexRgb(t.a));
  root.setProperty("--accent2-rgb", hexRgb(t.b));
  root.setProperty("--tint", t.tint);
  root.setProperty("--glow", `rgba(${hexRgb(t.a)}, 0.55)`);
  document.body.dataset.subject = subject in SUBJECTS ? subject : "general";
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", t.tint);
}
