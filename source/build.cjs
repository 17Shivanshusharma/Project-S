const fs=require("fs"), path=require("path");
require("esbuild").buildSync({entryPoints:["src/app.js"],bundle:true,minify:true,format:"iife",target:"es2020",platform:"browser",outfile:"out/app.js",legalComments:"none"});
const js=fs.readFileSync("out/app.js","utf8").replace(/<\/script/gi,"<\\/script");
const css=fs.readFileSync("src/style.css","utf8");
// KaTeX stylesheet with its woff2 fonts embedded so maths works offline from one file.
const kdir="node_modules/katex/dist";
let kcss=fs.readFileSync(kdir+"/katex.min.css","utf8");
kcss=kcss.replace(/src:url\(fonts\/([^)]+\.woff2)\) format\("woff2"\)(,url\([^)]+\) format\("[^"]+"\))*/g,(m,f)=>
  `src:url(data:font/woff2;base64,${fs.readFileSync(path.join(kdir,"fonts",f)).toString("base64")}) format("woff2")`);
if (/url\(fonts\//.test(kcss)) throw new Error("unembedded KaTeX font left");
const html=fs.readFileSync("src/template.html","utf8").replace("/*__KATEX__*/",()=>kcss).replace("/*__CSS__*/",()=>css).replace("/*__JS__*/",()=>js);
fs.mkdirSync("out",{recursive:true}); fs.writeFileSync("out/S.html",html); console.log("S.html", (html.length/1024).toFixed(0)+" KB");
