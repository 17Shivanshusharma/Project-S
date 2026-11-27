// Draw the maths engine's sampled points as a light SVG chart (no chart library).
const NS = "http://www.w3.org/2000/svg";
const COLORS = ["var(--violet)", "#f59e0b", "#22c55e", "#f43f5e"];
const el = (tag, attrs = {}, parent) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  parent?.appendChild(e);
  return e;
};
const nice = (v) => {
  const a = Math.abs(v);
  return a >= 1000 || (a > 0 && a < 0.01) ? v.toExponential(1) : String(+v.toFixed(2));
};

export function drawGraph({ title = "", series = [] }) {
  const W = 640, H = 380, L = 48, R = 14, T = 16, B = 34;
  const pts = series.flatMap((s) => s.points.filter(Boolean));
  if (!pts.length) throw new Error("no points");
  let x0 = Math.min(...pts.map((p) => p[0])), x1 = Math.max(...pts.map((p) => p[0]));
  // Ignore extreme spikes (e.g. tan x) when choosing the y range.
  const ys = pts.map((p) => p[1]).sort((a, b) => a - b);
  let y0 = ys[Math.floor(ys.length * 0.02)], y1 = ys[Math.ceil(ys.length * 0.98) - 1];
  if (y0 === y1) (y0 -= 1), (y1 += 1);
  const pad = (y1 - y0) * 0.08;
  (y0 -= pad), (y1 += pad);
  const X = (x) => L + ((x - x0) / (x1 - x0)) * (W - L - R);
  const Y = (y) => T + (1 - (y - y0) / (y1 - y0)) * (H - T - B);

  const fig = document.createElement("figure");
  fig.className = "graph";
  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": title || "Graph" }, fig);
  const grid = el("g", { class: "g-grid" }, svg);
  for (let i = 0; i <= 5; i++) {
    const gx = x0 + ((x1 - x0) * i) / 5, gy = y0 + ((y1 - y0) * i) / 5;
    el("line", { x1: X(gx), x2: X(gx), y1: T, y2: H - B }, grid);
    el("line", { x1: L, x2: W - R, y1: Y(gy), y2: Y(gy) }, grid);
    el("text", { x: X(gx), y: H - B + 18, "text-anchor": "middle", class: "g-lbl" }, svg).textContent = nice(gx);
    el("text", { x: L - 6, y: Y(gy) + 4, "text-anchor": "end", class: "g-lbl" }, svg).textContent = nice(gy);
  }
  if (y0 < 0 && y1 > 0) el("line", { x1: L, x2: W - R, y1: Y(0), y2: Y(0), class: "g-axis" }, svg);
  if (x0 < 0 && x1 > 0) el("line", { x1: X(0), x2: X(0), y1: T, y2: H - B, class: "g-axis" }, svg);
  const clip = el("clipPath", { id: "gc" + Math.random().toString(36).slice(2) }, el("defs", {}, svg));
  el("rect", { x: L, y: T, width: W - L - R, height: H - T - B }, clip);
  series.forEach((s, k) => {
    let d = "", pen = false, prev = null;
    for (const p of s.points) {
      // Break the line at gaps and at jumps (asymptotes).
      if (!p || (prev && Math.abs(p[1] - prev[1]) > (y1 - y0) * 1.5)) pen = false;
      if (p) {
        d += `${pen ? "L" : "M"}${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`;
        pen = true;
      }
      prev = p;
    }
    el("path", { d, fill: "none", stroke: COLORS[k % 4], "stroke-width": 2.6, "stroke-linejoin": "round", "clip-path": `url(#${clip.id})` }, svg);
  });
  const cap = document.createElement("figcaption");
  if (title) {
    const b = document.createElement("b");
    b.textContent = title + " ";
    cap.appendChild(b);
  }
  series.forEach((s, k) => {
    const i = document.createElement("span");
    i.className = "g-key";
    i.style.setProperty("--c", COLORS[k % 4]);
    i.textContent = "y = " + s.label.replace(/^\s*y\s*=\s*/, "").replace(/\*\*/g, "^").replace(/\*/g, "·");
    cap.appendChild(i);
  });
  const note = document.createElement("small");
  note.textContent = "📈 Drawn from SymPy";
  cap.appendChild(note);
  fig.appendChild(cap);
  return fig;
}
