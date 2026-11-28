// UI effects for the v3 redesign, written in plain JS (no React).
// The ideas come from React Bits (reactbits.dev): BlurText, RotatingText,
// SpotlightCard, Magnet and ClickSpark. These are small rewrites, not copies.
//
// Rules for every effect:
//  - prefers-reduced-motion turns the motion off; the content always stays readable.
//  - hover effects (spotlight, magnet) run only on mouse/trackpad, never on phones.
//  - nothing runs in a loop unless something is moving right now, so typing stays smooth.

const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
const finePointer = matchMedia("(hover: hover) and (pointer: fine)").matches;

// BlurText: each word comes in from a blur, one after another.
function blurText(el) {
  if (!el || el.dataset.fxSplit) return;
  el.dataset.fxSplit = "1";
  const words = el.textContent.trim().split(/\s+/);
  el.setAttribute("aria-label", words.join(" "));
  el.textContent = "";
  words.forEach((w, i) => {
    const s = document.createElement("span");
    s.className = "fx-word";
    s.setAttribute("aria-hidden", "true");
    s.style.setProperty("--i", i);
    s.textContent = w;
    el.append(s, i < words.length - 1 ? " " : "");
  });
}

// RotatingText: swaps through a list of words with a slide-up.
function rotatingText(el) {
  const words = (el?.dataset.words || "").split("|").filter(Boolean);
  if (!el || words.length < 2) return;
  let i = 0;
  const wrap = document.createElement("span");
  wrap.className = "fx-rot-word";
  wrap.textContent = words[0];
  el.textContent = "";
  el.append(wrap);
  if (reduce) return;
  setInterval(() => {
    if (document.hidden || el.closest("[hidden]") || document.body.classList.contains("typing")) return;
    i = (i + 1) % words.length;
    wrap.classList.add("out");
    setTimeout(() => {
      wrap.textContent = words[i];
      wrap.classList.remove("out");
      wrap.classList.add("in");
      requestAnimationFrame(() => requestAnimationFrame(() => wrap.classList.remove("in")));
    }, 260);
  }, 2400);
}

// SpotlightCard: a soft light that follows the mouse inside the card.
function spotlight(selector) {
  if (!finePointer) return;
  document.addEventListener(
    "pointermove",
    (e) => {
      const card = e.target.closest?.(selector);
      if (!card) return;
      const r = card.getBoundingClientRect();
      card.style.setProperty("--mx", `${e.clientX - r.left}px`);
      card.style.setProperty("--my", `${e.clientY - r.top}px`);
    },
    { passive: true }
  );
}

// Magnet: the button leans a little towards the mouse when it comes close.
function magnet(el, strength = 0.28, pad = 28) {
  if (!el || !finePointer || reduce) return;
  let raf = 0;
  addEventListener(
    "pointermove",
    (e) => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const r = el.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        const dx = e.clientX - cx;
        const dy = e.clientY - cy;
        const near = Math.abs(dx) < r.width / 2 + pad && Math.abs(dy) < r.height / 2 + pad;
        el.style.translate = near && !el.disabled ? `${(dx * strength).toFixed(1)}px ${(dy * strength).toFixed(1)}px` : "";
      });
    },
    { passive: true }
  );
}

// ClickSpark: small lines burst out where you tap a button.
function clickSpark() {
  if (reduce) return;
  const c = document.createElement("canvas");
  c.className = "fx-spark";
  c.setAttribute("aria-hidden", "true");
  document.body.append(c);
  const ctx = c.getContext("2d");
  let sparks = [];
  let raf = 0;
  const size = () => {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    c.width = innerWidth * dpr;
    c.height = innerHeight * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  size();
  addEventListener("resize", size);
  const color = () => getComputedStyle(document.documentElement).getPropertyValue("--magenta").trim() || "#38bdf8";
  function draw(now) {
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    sparks = sparks.filter((s) => now - s.t < 420);
    for (const s of sparks) {
      const p = (now - s.t) / 420;
      const ease = p * (2 - p);
      const d = ease * 22;
      const len = 9 * (1 - ease);
      ctx.strokeStyle = s.c;
      ctx.globalAlpha = 1 - p;
      ctx.lineWidth = 2;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(s.x + Math.cos(s.a) * d, s.y + Math.sin(s.a) * d);
      ctx.lineTo(s.x + Math.cos(s.a) * (d + len), s.y + Math.sin(s.a) * (d + len));
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    raf = sparks.length ? requestAnimationFrame(draw) : 0;
  }
  document.addEventListener(
    "pointerdown",
    (e) => {
      if (!e.target.closest?.("button, .chip-btn, a.btn")) return;
      const t = performance.now();
      const col = color();
      for (let k = 0; k < 8; k++) sparks.push({ x: e.clientX, y: e.clientY, a: (k / 8) * Math.PI * 2, t, c: col });
      if (!raf) raf = requestAnimationFrame(draw);
    },
    { passive: true }
  );
}

// Plays the welcome entrance again each time the welcome screen comes back (new chat).
function replayOnShow(el) {
  if (!el) return;
  const play = () => {
    el.classList.remove("fx-in");
    void el.offsetWidth; // restart the CSS animations
    el.classList.add("fx-in");
  };
  new MutationObserver(() => !el.hidden && play()).observe(el, { attributes: true, attributeFilter: ["hidden"] });
  play();
}

export function initFx() {
  document.documentElement.classList.add("fx");
  blurText(document.querySelector(".welcome h2"));
  rotatingText(document.querySelector(".fx-rotator"));
  spotlight(".suggestions button, .fx-spot");
  magnet(document.getElementById("send"));
  clickSpark();
  replayOnShow(document.getElementById("welcome"));
}
