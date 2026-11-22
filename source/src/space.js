// A 3D starfield: stars fly slowly toward you, with a gentle tilt that
// follows your finger, mouse or phone movement (parallax).
export function startStarfield(canvas) {
  if (!canvas?.getContext) return;
  const ctx = canvas.getContext("2d");
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const COLORS = ["#ffffff", "#e9d5ff", "#c4b5fd", "#a5b4fc", "#f5d0fe", "#bae6fd"];
  let w = 0, h = 0, dpr = 1, stars = [];
  let tx = 0, ty = 0, px = 0, py = 0; // target and current tilt

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = canvas.clientWidth;
    h = canvas.clientHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const count = Math.round(Math.min(420, (w * h) / 2600));
    stars = Array.from({ length: count }, () => newStar(true));
  }
  function newStar(anywhere) {
    return {
      x: (Math.random() - 0.5) * 2,
      y: (Math.random() - 0.5) * 2,
      z: anywhere ? Math.random() * 0.95 + 0.05 : 1,
      c: COLORS[(Math.random() * COLORS.length) | 0],
      s: Math.random() * 0.9 + 0.4,
    };
  }

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    px += (tx - px) * 0.04;
    py += (ty - py) * 0.04;
    ctx.clearRect(0, 0, w, h);
    const cx = w / 2 + px * 40;
    const cy = h * 0.42 + py * 40;
    const f = Math.max(w, h) * 0.55;
    for (const st of stars) {
      if (!reduce) st.z -= dt * 0.035;
      if (st.z <= 0.03) Object.assign(st, newStar(false));
      // Perspective: things further away (bigger z) sit closer to the centre.
      const sx = cx + (st.x / st.z) * f * 0.5 - px * (1 - st.z) * 60;
      const sy = cy + (st.y / st.z) * f * 0.5 - py * (1 - st.z) * 60;
      if (sx < -20 || sx > w + 20 || sy < -20 || sy > h + 20) {
        Object.assign(st, newStar(false));
        continue;
      }
      const near = 1 - st.z;
      const r = st.s * (0.3 + near * 1.9);
      ctx.globalAlpha = Math.min(1, 0.15 + near * 1.1);
      ctx.fillStyle = st.c;
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.fill();
      if (near > 0.75) {
        ctx.globalAlpha = (near - 0.75) * 0.8;
        ctx.beginPath();
        ctx.arc(sx, sy, r * 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    if (!document.hidden) requestAnimationFrame(frame);
  }
  function tilt(x, y) {
    tx = Math.max(-1, Math.min(1, x));
    ty = Math.max(-1, Math.min(1, y));
    document.documentElement.style.setProperty("--tilt-x", tx.toFixed(3));
    document.documentElement.style.setProperty("--tilt-y", ty.toFixed(3));
  }
  addEventListener("pointermove", (e) => tilt((e.clientX / innerWidth - 0.5) * 2, (e.clientY / innerHeight - 0.5) * 2), { passive: true });
  addEventListener("deviceorientation", (e) => {
    if (e.gamma == null) return;
    tilt(e.gamma / 30, (e.beta - 45) / 30);
  });
  addEventListener("resize", resize);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      last = performance.now();
      requestAnimationFrame(frame);
    }
  });
  resize();
  requestAnimationFrame(frame);
}
