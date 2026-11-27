// Make real .pdf files in the browser, with no library and no server.
// Each A4 page is drawn as a picture (so Hindi, Hinglish, emoji, maths and graphs all look right)
// and the pictures are packed into a small PDF file. If a browser can't draw the pages,
// S opens the print screen instead, where "Save as PDF" makes the file.

const PAGE_W = 794; // A4 at 96 dpi
const PAGE_H = 1123;
const MARGIN = 56;
const SCALE = 2; // sharp text

const PDF_CSS = `
.pdf-doc { width: ${PAGE_W}px; box-sizing: border-box; padding: 0 ${MARGIN}px; background: #fff; color: #111827;
  font: 15px/1.6 system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", "Noto Sans Devanagari", sans-serif; }
.pdf-doc * { box-sizing: border-box; }
.pdf-head { display: flex; align-items: center; gap: 10px; padding: 0 0 12px; border-bottom: 2px solid #2563eb; margin-bottom: 18px; }
.pdf-logo { width: 26px; height: 26px; border-radius: 50%; background: radial-gradient(circle, #000 42%, transparent 46%), conic-gradient(#2563eb, #93c5fd, #22d3ee, #1d4ed8, #2563eb); flex-shrink: 0; }
.pdf-head h1 { font-size: 22px; line-height: 1.25; margin: 0; color: #0f172a; }
.pdf-head small { display: block; color: #64748b; font-size: 12px; font-weight: 500; }
.pdf-doc h1, .pdf-doc h2, .pdf-doc h3 { color: #0f172a; line-height: 1.3; margin: 18px 0 8px; }
.pdf-doc h2 { font-size: 19px; } .pdf-doc h3 { font-size: 16.5px; }
.pdf-doc p { margin: 0 0 10px; } .pdf-doc ul, .pdf-doc ol { margin: 0 0 10px; padding-left: 24px; }
.pdf-doc table { border-collapse: collapse; margin: 10px 0; width: 100%; }
.pdf-doc th, .pdf-doc td { border: 1px solid #cbd5e1; padding: 6px 9px; text-align: left; vertical-align: top; }
.pdf-doc th { background: #eff6ff; }
.pdf-doc pre { background: #f1f5f9; border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px 12px; white-space: pre-wrap; word-break: break-word; font: 12.5px/1.5 ui-monospace, Menlo, Consolas, monospace; }
.pdf-doc code { font-family: ui-monospace, Menlo, Consolas, monospace; background: #f1f5f9; padding: 1px 4px; border-radius: 4px; }
.pdf-doc pre code { background: none; padding: 0; }
.pdf-doc blockquote { margin: 10px 0; padding: 6px 14px; border-left: 4px solid #93c5fd; background: #f8fafc; color: #334155; }
.pdf-doc a { color: #1d4ed8; }
.pdf-doc .katex-display { margin: 10px 0; overflow: hidden; }
.pdf-doc details { margin: 8px 0; } .pdf-doc summary { font-weight: 600; color: #334155; }
.pdf-doc .copy-btn, .pdf-doc .code-lang, .pdf-doc button { display: none !important; }
.pdf-doc .graph { border: 1px solid #e2e8f0; border-radius: 10px; padding: 8px; background: #fff; }
.pdf-doc .graph svg { width: 100%; height: auto; }
.pdf-doc .g-grid line { stroke: #e5e7eb; } .pdf-doc .g-axis { stroke: #6b7280; } .pdf-doc .g-lbl { fill: #6b7280; font: 12px sans-serif; }
.pdf-doc .graph figcaption { display: flex; flex-wrap: wrap; gap: 6px 14px; font-size: 13px; }
.pdf-doc .g-key::before { content: ""; display: inline-block; width: 14px; height: 3px; background: var(--c); margin-right: 6px; vertical-align: middle; }
.pdf-doc .sources { font-size: 12.5px; color: #475569; border-top: 1px solid #e2e8f0; margin-top: 10px; padding-top: 6px; }
.pdf-doc .sources a { word-break: break-all; }
.pdf-msg { margin: 0 0 14px; }
.pdf-q { background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 10px; padding: 8px 12px; font-weight: 600; color: #1e3a8a; }
.pdf-foot { margin-top: 24px; padding-top: 8px; border-top: 1px solid #e2e8f0; color: #94a3b8; font-size: 11.5px; }
.pdf-doc img { max-width: 100%; }
.hljs-keyword, .hljs-built_in, .hljs-type { color: #1d4ed8; } .hljs-string { color: #047857; } .hljs-number, .hljs-literal { color: #b45309; }
.hljs-comment { color: #6b7280; font-style: italic; } .hljs-title { color: #0e7490; } .hljs-attr, .hljs-variable, .hljs-property { color: #6d28d9; }
`;

const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

// Build the page content (light theme) from ready-made HTML blocks.
export function pdfDocument(title, blocks) {
  const doc = document.createElement("div");
  doc.className = "pdf-doc";
  const date = new Date().toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
  doc.innerHTML = `<div class="pdf-head"><span class="pdf-logo"></span><h1>${esc(title)}<small>Project S · ${esc(date)}</small></h1></div>`;
  for (const b of blocks) {
    const wrap = document.createElement("div");
    wrap.className = "pdf-msg";
    if (b.question) {
      const q = document.createElement("div");
      q.className = "pdf-q";
      q.textContent = "❓ " + b.question;
      wrap.appendChild(q);
    }
    if (b.html) {
      const a = document.createElement("div");
      a.innerHTML = b.html;
      wrap.appendChild(a);
    }
    doc.appendChild(wrap);
  }
  const foot = document.createElement("div");
  foot.className = "pdf-foot";
  foot.textContent = "Made with Project S · Created by Shivanshu Sharma · 17shivanshusharma.github.io/Project-S";
  doc.appendChild(foot);
  return doc;
}

// Page breaks: fill each page, breaking between blocks; cut inside a block only when it's taller than a page.
function pageBreaks(doc) {
  const usable = PAGE_H - 2 * MARGIN;
  const top0 = doc.getBoundingClientRect().top;
  const pieces = [];
  const walk = (el) => {
    for (const ch of el.children) {
      const r = ch.getBoundingClientRect();
      if (r.height > usable * 0.6 && ch.children.length && !/^(TABLE|PRE|FIGURE|SVG)$/i.test(ch.tagName) && !ch.classList.contains("katex-display")) walk(ch);
      else pieces.push([r.top - top0, r.bottom - top0]);
    }
  };
  walk(doc);
  const total = doc.scrollHeight;
  const breaks = [0];
  let start = 0;
  for (const [t, b] of pieces) {
    if (b - start <= usable) continue;
    if (t > start + 40 && t - start <= usable) start = t;
    else while (b - start > usable) start += usable; // very tall block: cut it
    breaks.push(start);
  }
  while (total - start > usable) breaks.push((start += usable));
  return [...new Set(breaks)].sort((a, b) => a - b);
}

function cssText() {
  return [document.getElementById("katex-css")?.textContent || "", PDF_CSS].join("\n");
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("render"));
    img.src = url;
  });
}

async function renderPage(xhtml, css, offset, height) {
  const usable = PAGE_H - 2 * MARGIN;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${PAGE_W}" height="${PAGE_H}"><foreignObject x="0" y="0" width="${PAGE_W}" height="${PAGE_H}"><div xmlns="http://www.w3.org/1999/xhtml" style="width:${PAGE_W}px;height:${PAGE_H}px;background:#fff;overflow:hidden;position:relative"><style>${css}</style><div style="position:absolute;left:0;right:0;top:${MARGIN}px;height:${Math.min(height, usable)}px;overflow:hidden"><div style="margin-top:${-offset}px">${xhtml}</div></div></div></foreignObject></svg>`;
  const img = await loadImage("data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg));
  const c = document.createElement("canvas");
  c.width = PAGE_W * SCALE;
  c.height = PAGE_H * SCALE;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.scale(SCALE, SCALE);
  ctx.drawImage(img, 0, 0);
  // Reading the pixels fails if the browser marked the picture unsafe: then we use printing instead.
  const jpg = c.toDataURL("image/jpeg", 0.85);
  return Uint8Array.from(atob(jpg.split(",")[1]), (ch) => ch.charCodeAt(0));
}

// A minimal PDF: one JPEG image per A4 page.
function buildPdf(jpegs, title) {
  const enc = new TextEncoder();
  const chunks = [];
  let size = 0;
  const offsets = [];
  const push = (x) => {
    const b = typeof x === "string" ? enc.encode(x) : x;
    chunks.push(b);
    size += b.length;
  };
  const obj = (n, body) => {
    offsets[n] = size;
    push(`${n} 0 obj\n`);
    for (const part of body) push(part);
    push("\nendobj\n");
  };
  const W = 595.28, H = 841.89;
  const n = jpegs.length;
  const pageIds = jpegs.map((_, i) => 3 + i * 3);
  push("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
  obj(1, ["<< /Type /Catalog /Pages 2 0 R >>"]);
  obj(2, [`<< /Type /Pages /Count ${n} /Kids [${pageIds.map((id) => id + " 0 R").join(" ")}] >>`]);
  jpegs.forEach((jpg, i) => {
    const p = 3 + i * 3;
    obj(p, [`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /XObject << /Im${i} ${p + 1} 0 R >> >> /Contents ${p + 2} 0 R >>`]);
    obj(p + 1, [`<< /Type /XObject /Subtype /Image /Width ${PAGE_W * SCALE} /Height ${PAGE_H * SCALE} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpg.length} >>\nstream\n`, jpg, "\nendstream"]);
    const content = `q ${W} 0 0 ${H} 0 0 cm /Im${i} Do Q`;
    obj(p + 2, [`<< /Length ${content.length} >>\nstream\n${content}\nendstream`]);
  });
  const info = 3 + n * 3;
  const pdfStr = (t) => "(" + String(t).replace(/[^\x20-\x7E]/g, "").replace(/[()\\]/g, "\\$&") + ")";
  obj(info, [`<< /Title ${pdfStr(title)} /Creator (Project S) /Producer (Project S) >>`]);
  const xref = size;
  push(`xref\n0 ${info + 1}\n0000000000 65535 f \n`);
  for (let i = 1; i <= info; i++) push(String(offsets[i]).padStart(10, "0") + " 00000 n \n");
  push(`trailer\n<< /Size ${info + 1} /Root 1 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(chunks, { type: "application/pdf" });
}

function saveBlob(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => (URL.revokeObjectURL(a.href), a.remove()), 4000);
}

// Fallback: the browser's own print screen ("Save as PDF" / "Print to PDF").
export function printDoc(doc, title) {
  let area = document.getElementById("print-area");
  if (!area) {
    area = document.createElement("div");
    area.id = "print-area";
    document.body.appendChild(area);
  }
  area.innerHTML = `<style>${PDF_CSS}</style>`;
  area.appendChild(doc);
  const old = document.title;
  document.title = title;
  document.body.classList.add("printing");
  const done = () => {
    document.body.classList.remove("printing");
    document.title = old;
    area.innerHTML = "";
    removeEventListener("afterprint", done);
  };
  addEventListener("afterprint", done);
  setTimeout(() => window.print(), 50);
}

export const pdfFileName = (title) => (String(title).replace(/[^\p{L}\p{N} _-]+/gu, "").trim().slice(0, 60).replace(/\s+/g, "-") || "project-s") + ".pdf";

// Make the PDF and download it. Returns { pages } or throws.
export async function makePdf(title, doc, onProgress = () => {}) {
  const host = document.createElement("div");
  host.style.cssText = `position:fixed;left:-${PAGE_W + 200}px;top:0;width:${PAGE_W}px;pointer-events:none;opacity:0;z-index:-1`;
  const style = document.createElement("style");
  style.textContent = PDF_CSS;
  host.append(style, doc);
  document.body.appendChild(host);
  try {
    await document.fonts?.ready;
    const breaks = pageBreaks(doc);
    const total = doc.scrollHeight;
    const xhtml = new XMLSerializer().serializeToString(doc);
    const css = cssText();
    const pages = [];
    for (let i = 0; i < breaks.length; i++) {
      onProgress(i + 1, breaks.length);
      const end = i + 1 < breaks.length ? breaks[i + 1] : total;
      if (end - breaks[i] < 4 && i > 0) continue;
      pages.push(await renderPage(xhtml, css, breaks[i], end - breaks[i]));
    }
    const blob = buildPdf(pages, title);
    saveBlob(blob, pdfFileName(title));
    return { pages: pages.length, blob };
  } finally {
    host.remove();
  }
}
