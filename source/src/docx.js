// Read the text of a Word (.docx) file in the browser, with no library.
// A .docx is a zip; the text is in word/document.xml. Modern browsers can unzip ("deflate-raw").

async function inflateRaw(bytes) {
  if (typeof DecompressionStream === "undefined") throw new Error("This browser can't open Word files. Update the browser, or save the file as PDF.");
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function unzipEntry(buf, wanted) {
  const v = new DataView(buf);
  // Find the "end of central directory" record (at most 64 KB from the end).
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) {
    if (v.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("This doesn't look like a real .docx file.");
  const count = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (v.getUint32(p, true) !== 0x02014b50) break;
    const method = v.getUint16(p + 10, true);
    const csize = v.getUint32(p + 20, true);
    const nameLen = v.getUint16(p + 28, true);
    const extraLen = v.getUint16(p + 30, true);
    const commentLen = v.getUint16(p + 32, true);
    const local = v.getUint32(p + 42, true);
    const name = dec.decode(new Uint8Array(buf, p + 46, nameLen));
    if (name === wanted) {
      const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
      const data = new Uint8Array(buf, start, csize);
      if (method === 0) return data;
      if (method === 8) return inflateRaw(data);
      throw new Error("Unsupported compression in this Word file.");
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error("No text found in this Word file.");
}

export async function readDocx(file) {
  const xml = new TextDecoder().decode(await unzipEntry(await file.arrayBuffer(), "word/document.xml"));
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const lines = [];
  for (const para of doc.getElementsByTagNameNS(W, "p")) {
    let line = "";
    for (const node of para.getElementsByTagNameNS("*", "*")) {
      if (node.namespaceURI !== W) continue;
      if (node.localName === "t") line += node.textContent;
      else if (node.localName === "tab") line += "\t";
      else if (node.localName === "br") line += "\n";
    }
    const style = para.getElementsByTagNameNS(W, "pStyle")[0]?.getAttributeNS(W, "val") || "";
    const h = /^Heading(\d)/i.exec(style);
    lines.push(h && line.trim() ? "#".repeat(Math.min(+h[1], 4)) + " " + line : line);
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
