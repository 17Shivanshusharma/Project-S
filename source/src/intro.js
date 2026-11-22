// Opening intro: a black hole charges up, bursts, then shows "Project S by Shivanshu Sharma".
// Resolves when the intro is gone. Tap anywhere to skip.
export function playIntro() {
  const el = document.getElementById("intro");
  if (!el) return Promise.resolve();
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const canvas = document.getElementById("intro-canvas");
  const ctx = canvas.getContext("2d");
  const timers = [];
  let raf = 0;
  let done;
  const finished = new Promise((r) => (done = r));

  function size() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = innerWidth * dpr;
    canvas.height = innerHeight * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  size();

  // Particles for the burst
  const COLORS = ["#ffffff", "#f5d0fe", "#e879f9", "#c084fc", "#a855f7", "#7c3aed", "#67e8f9"];
  let parts = [];
  function burst() {
    const cx = innerWidth / 2;
    const cy = innerHeight * 0.42;
    const n = Math.min(700, Math.round((innerWidth * innerHeight) / 900));
    parts = Array.from({ length: n }, () => {
      const a = Math.random() * Math.PI * 2;
      const sp = 2 + Math.random() ** 0.6 * 14;
      return {
        x: cx, y: cy,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.75,
        life: 1, decay: 0.003 + Math.random() * 0.007,
        r: 0.6 + Math.random() * 2.2,
        c: COLORS[(Math.random() * COLORS.length) | 0],
      };
    });
    const loop = () => {
      ctx.fillStyle = "rgba(3, 2, 10, 0.22)"; // leaves short trails
      ctx.fillRect(0, 0, innerWidth, innerHeight);
      let alive = 0;
      for (const p of parts) {
        if (p.life <= 0) continue;
        alive++;
        p.x += p.vx;
        p.y += p.vy;
        p.vx *= 0.975;
        p.vy *= 0.975;
        p.life -= p.decay;
        ctx.globalAlpha = Math.max(0, p.life);
        ctx.fillStyle = p.c;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * (0.5 + p.life), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      if (alive) raf = requestAnimationFrame(loop);
    };
    loop();
  }

  const at = (ms, fn) => timers.push(setTimeout(fn, ms));
  function finish() {
    timers.forEach(clearTimeout);
    el.classList.add("leaving");
    setTimeout(() => {
      cancelAnimationFrame(raf);
      el.remove();
      done();
    }, 1100);
  }
  el.addEventListener("click", finish, { once: true });

  if (reduce) {
    el.classList.add("title", "tagline");
    at(4500, finish);
  } else {
    el.classList.add("charging"); //   0.0s  black hole spins up and grows
    at(3600, () => {
      el.classList.remove("charging");
      el.classList.add("burst"); //    3.6s  flash + shockwave + particles
      burst();
      if (navigator.vibrate) try { navigator.vibrate(60); } catch {}
    });
    at(4300, () => el.classList.add("title")); // 4.3s  "Project S by Shivanshu Sharma"
    at(6600, () => el.classList.add("tagline")); // 6.6s  "Your personal AI · Har subject, har sawaal"
    at(10500, finish); //                         10.5s  fade into the app (1.1s)
  }
  return finished;
}
