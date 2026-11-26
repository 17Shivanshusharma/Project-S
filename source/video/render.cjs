// node render.cjs preview  -> a few stills
// node render.cjs          -> all frames at 30 fps into frames/
const { chromium } = require('playwright');
const fs = require('fs');
const preview = process.argv[2] === 'preview';
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 720, height: 1280 }, deviceScaleFactor: preview ? 1 : 1.5 });
  await p.goto('file://' + __dirname + '/video.html');
  await p.waitForTimeout(500);
  const D = await p.evaluate(() => window.DURATION);
  if (preview) {
    for (const t of [4, 11, 24, 29, 36, 44, 57, 69, 82]) {
      await p.evaluate((t) => window.render(t), t);
      await p.screenshot({ path: `${__dirname}/prev-${t}.png` });
    }
  } else {
    fs.mkdirSync(__dirname + '/frames2', { recursive: true });
    const FPS = 30;
    const from = +(process.env.FROM || 0), to = +(process.env.TO || D * FPS);
    for (let i = from; i < to; i++) {
      const out = `${__dirname}/frames2/f${String(i).padStart(5, '0')}.jpg`;
      if (fs.existsSync(out) && fs.statSync(out).size > 0 && fs.existsSync(`${__dirname}/frames2/f${String(i + 1).padStart(5, '0')}.jpg`)) continue;
      await p.evaluate((t) => window.render(t), i / FPS);
      await p.screenshot({ path: `${__dirname}/frames2/f${String(i).padStart(5, '0')}.jpg`, type: 'jpeg', quality: 92 });
    }
  }
  await b.close();
})();
