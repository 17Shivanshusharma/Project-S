const fs=require("fs"), path=require("path");
require("esbuild").buildSync({entryPoints:["src/app.js"],bundle:true,minify:true,format:"iife",target:"es2020",platform:"browser",outfile:"out/app.js",legalComments:"none"});
const js=fs.readFileSync("out/app.js","utf8").replace(/<\/script/gi,"<\\/script");
// Inter, Fraunces and Caveat (SIL Open Font License), Latin subset only, embedded so the file works offline.
// Devanagari text falls back to the phone's own font.
const font=(family,file)=>`@font-face{font-family:"${family}";font-style:normal;font-display:swap;font-weight:100 900;src:url(data:font/woff2;base64,${fs.readFileSync(file).toString("base64")}) format("woff2");unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD}`;
const fonts=[["Inter Variable","inter"],["Fraunces Variable","fraunces"],["Caveat Variable","caveat"]]
  .map(([family,pkg])=>font(family,`node_modules/@fontsource-variable/${pkg}/files/${pkg}-latin-wght-normal.woff2`)).join("\n");
const css=fs.readFileSync("src/style.css","utf8")+"\n"+fs.readFileSync("src/fx.css","utf8").replace("/*__FONTS__*/",()=>fonts);
// KaTeX stylesheet with its woff2 fonts embedded so maths works offline from one file.
const kdir="node_modules/katex/dist";
let kcss=fs.readFileSync(kdir+"/katex.min.css","utf8");
kcss=kcss.replace(/src:url\(fonts\/([^)]+\.woff2)\) format\("woff2"\)(,url\([^)]+\) format\("[^"]+"\))*/g,(m,f)=>
  `src:url(data:font/woff2;base64,${fs.readFileSync(path.join(kdir,"fonts",f)).toString("base64")}) format("woff2")`);
if (/url\(fonts\//.test(kcss)) throw new Error("unembedded KaTeX font left");
const html=fs.readFileSync("src/template.html","utf8").replace("/*__KATEX__*/",()=>kcss).replace("/*__CSS__*/",()=>css).replace("/*__JS__*/",()=>js);
fs.mkdirSync("out",{recursive:true}); fs.writeFileSync("out/S.html",html); console.log("S.html", (html.length/1024).toFixed(0)+" KB");
