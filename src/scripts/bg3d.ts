// 3D scene for the blue band at the top of each page: a globe of connected points with
// shaded orbs at different depths. Plain canvas 2D with a perspective projection (no libraries).
//
// Interaction: the globe turns to face the pointer, points near the pointer light up and link
// to it, and the orbs shift with depth (parallax). When the pointer leaves, the globe eases back
// to a slow spin. The canvas follows the band's size exactly (ResizeObserver) and renders at the
// screen's pixel density, so it stays sharp. It pauses off-screen and in hidden tabs. Visitors
// who prefer reduced motion get no automatic spin, but the scene still responds to the pointer.

type Vec = { x: number; y: number; z: number };
type Orb = Vec & { r: number; hue: number; phase: number; speed: number };

for (const cv of document.querySelectorAll<HTMLCanvasElement>('canvas.scene')) start(cv);

function start(cv: HTMLCanvasElement) {
  const ctx = cv.getContext('2d', { alpha: true });
  if (!ctx) return;
  const band = cv.parentElement as HTMLElement;
  const density = cv.dataset.density || 'medium';
  const counts = { low: 120, medium: 200, high: 300 } as const;
  const N = counts[density as keyof typeof counts] ?? 200;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const anchorSel = cv.dataset.anchor;

  // ---- Geometry: points on a sphere (Fibonacci lattice), linked to their 3 nearest neighbours
  const pts: Vec[] = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < N; i++) {
    const y = 1 - (i / (N - 1)) * 2;
    const rad = Math.sqrt(1 - y * y);
    pts.push({ x: Math.cos(golden * i) * rad, y, z: Math.sin(golden * i) * rad });
  }
  const links: [number, number][] = [];
  const seen = new Set<number>();
  for (let i = 0; i < N; i++) {
    const near = pts
      .map((p, j) => [j, (p.x - pts[i].x) ** 2 + (p.y - pts[i].y) ** 2 + (p.z - pts[i].z) ** 2] as const)
      .sort((a, b) => a[1] - b[1]);
    for (let k = 1; k <= 3; k++) {
      const j = near[k][0];
      const key = Math.min(i, j) * N + Math.max(i, j);
      if (!seen.has(key)) {
        seen.add(key);
        links.push([i, j]);
      }
    }
  }

  // Orbs, placed relative to the globe (x, y in globe radii; z = depth, larger is further away)
  const orbs: Orb[] = [
    { x: -1.25, y: -0.65, z: 0.6, r: 0.17, hue: 0, phase: 0.2, speed: 0.7 },
    { x: 1.15, y: 0.7, z: 1.3, r: 0.26, hue: 1, phase: 1.7, speed: 0.5 },
    { x: -0.85, y: 0.9, z: 0.2, r: 0.1, hue: 1, phase: 3.1, speed: 0.9 },
    { x: 0.55, y: -1.05, z: 1.7, r: 0.14, hue: 0, phase: 4.4, speed: 0.6 },
    { x: 1.4, y: -0.35, z: 0.4, r: 0.08, hue: 0, phase: 2.4, speed: 1.1 },
    { x: -1.55, y: 0.25, z: 2.0, r: 0.22, hue: 1, phase: 5.2, speed: 0.4 },
  ];

  // ---- Layout: keep the whole globe inside the band
  let W = 0, H = 0, R = 0, cx = 0, cy = 0;
  function layout() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const box = band.getBoundingClientRect();
    W = box.width;
    H = box.height;
    const pw = Math.round(W * dpr), ph = Math.round(H * dpr);
    if (cv.width !== pw || cv.height !== ph) {
      cv.width = pw;
      cv.height = ph;
    }
    ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    const anchor = anchorSel ? band.querySelector(anchorSel)?.getBoundingClientRect() : null;
    if (anchor && anchor.width) {
      // Homepage: the globe frames the portrait
      cx = anchor.left - box.left + anchor.width / 2;
      cy = anchor.top - box.top + anchor.height / 2;
      R = anchor.width * 0.72;
    } else {
      // Inner pages: the globe sits on the right
      R = Math.min(H * 0.4, W * 0.2);
      cx = W - R * 1.35 - Math.max(16, W * 0.04);
      cy = H / 2;
    }
    // Never let the globe leave the band
    R = Math.max(40, Math.min(R, cy - 12, H - cy - 12, cx - 12, W - cx - 12));
  }

  // ---- Pointer tracking (relative to the band)
  const pointer = { x: 0, y: 0, active: false };
  let yawTarget = 0, pitchTarget = 0, yaw = 0, pitch = 0, glowX = 0, glowY = 0, glow = 0;
  const onMove = (e: PointerEvent) => {
    const box = band.getBoundingClientRect();
    pointer.x = e.clientX - box.left;
    pointer.y = e.clientY - box.top;
    pointer.active = pointer.x >= 0 && pointer.y >= 0 && pointer.x <= box.width && pointer.y <= box.height;
    if (!pointer.active) return;
    // Turn the globe to face the pointer: up to ±50° left/right and ±30° up/down
    yawTarget = ((pointer.x - cx) / Math.max(W / 2, 1)) * 0.9;
    pitchTarget = ((pointer.y - cy) / Math.max(H / 2, 1)) * -0.55;
    wake();
  };
  band.addEventListener('pointermove', onMove, { passive: true });
  band.addEventListener('pointerdown', onMove, { passive: true });
  band.addEventListener('pointerleave', () => {
    pointer.active = false;
    yawTarget = 0;
    pitchTarget = 0;
    wake();
  });

  // ---- Drawing
  const F = 900;
  const proj = (x: number, y: number, z: number) => {
    const s = F / (F + z);
    return { x: cx + x * s, y: cy + y * s, s };
  };

  function drawOrb(o: Orb, t: number) {
    const drift = reduce ? 0 : Math.sin(t * 0.00025 * o.speed + o.phase);
    const par = 1 / (1 + o.z); // nearer orbs move more
    const px = pointer.active ? (pointer.x - cx) / W : 0;
    const py = pointer.active ? (pointer.y - cy) / H : 0;
    const x = o.x * R + px * -120 * par + drift * 14;
    const y = o.y * R + py * -80 * par + (reduce ? 0 : Math.cos(t * 0.0002 * o.speed + o.phase) * 10);
    const p = proj(x, y, o.z * R);
    const r = o.r * R * p.s;
    if (r < 1) return;
    const halo = ctx!.createRadialGradient(p.x, p.y, r * 0.6, p.x, p.y, r * 2.2);
    halo.addColorStop(0, 'rgba(120,190,255,0.16)');
    halo.addColorStop(1, 'rgba(120,190,255,0)');
    ctx!.fillStyle = halo;
    ctx!.beginPath();
    ctx!.arc(p.x, p.y, r * 2.2, 0, Math.PI * 2);
    ctx!.fill();
    // Light comes from the pointer when it is over the band, otherwise from the top left
    let lx = -0.35, ly = -0.4;
    if (pointer.active) {
      const dx = pointer.x - p.x, dy = pointer.y - p.y, d = Math.hypot(dx, dy) || 1;
      lx = (dx / d) * 0.45;
      ly = (dy / d) * 0.45;
    }
    const g = ctx!.createRadialGradient(p.x + lx * r, p.y + ly * r, r * 0.05, p.x, p.y, r);
    if (o.hue === 0) {
      g.addColorStop(0, 'rgba(240,248,255,0.97)');
      g.addColorStop(0.35, 'rgba(96,176,255,0.92)');
      g.addColorStop(1, 'rgba(0,62,160,0.9)');
    } else {
      g.addColorStop(0, 'rgba(215,236,255,0.92)');
      g.addColorStop(0.4, 'rgba(40,140,240,0.8)');
      g.addColorStop(1, 'rgba(0,36,110,0.85)');
    }
    ctx!.fillStyle = g;
    ctx!.beginPath();
    ctx!.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx!.fill();
  }

  const sx = new Float32Array(N), sy = new Float32Array(N), sz = new Float32Array(N), near = new Float32Array(N);
  function drawGlobe(t: number) {
    const spin = reduce ? 0.6 : t * 0.00008;
    const ry = spin + yaw, rx = -0.3 + pitch;
    const sY = Math.sin(ry), cY = Math.cos(ry), sX = Math.sin(rx), cX = Math.cos(rx);
    const reach = Math.max(90, R * 0.45);
    for (let i = 0; i < N; i++) {
      const p = pts[i];
      const x1 = p.x * cY + p.z * sY;
      const z1 = -p.x * sY + p.z * cY;
      const y2 = p.y * cX - z1 * sX;
      const z2 = p.y * sX + z1 * cX;
      const q = proj(x1 * R, y2 * R, z2 * R);
      sx[i] = q.x;
      sy[i] = q.y;
      sz[i] = z2;
      near[i] = glow > 0 ? Math.max(0, 1 - Math.hypot(q.x - glowX, q.y - glowY) / reach) * glow : 0;
    }
    // Back half first, then front half, so nearer lines sit on top
    for (const front of [false, true]) {
      for (const [a, b] of links) {
        const z = (sz[a] + sz[b]) / 2;
        if (z < 0 !== front) continue;
        const depth = 1 - (z + 1) / 2;
        const lit = Math.max(near[a], near[b]);
        ctx!.strokeStyle = `rgba(${200 + lit * 55},${230 + lit * 25},255,${(0.07 + depth * 0.45 + lit * 0.45).toFixed(3)})`;
        ctx!.lineWidth = 0.7 + depth * 0.5 + lit * 0.8;
        ctx!.beginPath();
        ctx!.moveTo(sx[a], sy[a]);
        ctx!.lineTo(sx[b], sy[b]);
        ctx!.stroke();
      }
    }
    for (let i = 0; i < N; i++) {
      const depth = 1 - (sz[i] + 1) / 2;
      const lit = near[i];
      ctx!.fillStyle = `rgba(240,248,255,${(0.28 + depth * 0.65 + lit * 0.3).toFixed(3)})`;
      ctx!.beginPath();
      ctx!.arc(sx[i], sy[i], 0.8 + depth * 1.8 + lit * 2.2, 0, Math.PI * 2);
      ctx!.fill();
    }
    // Links from the pointer to the nearest front-facing points
    if (glow > 0.02) {
      ctx!.lineWidth = 1;
      for (let i = 0; i < N; i++) {
        if (near[i] > 0.25 && sz[i] < 0.2) {
          ctx!.strokeStyle = `rgba(160,215,255,${(near[i] * 0.55).toFixed(3)})`;
          ctx!.beginPath();
          ctx!.moveTo(glowX, glowY);
          ctx!.lineTo(sx[i], sy[i]);
          ctx!.stroke();
        }
      }
      const cg = ctx!.createRadialGradient(glowX, glowY, 0, glowX, glowY, 26);
      cg.addColorStop(0, `rgba(200,235,255,${(0.55 * glow).toFixed(3)})`);
      cg.addColorStop(1, 'rgba(200,235,255,0)');
      ctx!.fillStyle = cg;
      ctx!.beginPath();
      ctx!.arc(glowX, glowY, 26, 0, Math.PI * 2);
      ctx!.fill();
    }
    // Equator ring, tilted with the globe
    ctx!.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx!.lineWidth = 1;
    ctx!.beginPath();
    ctx!.ellipse(cx, cy, R * 1.22, Math.max(4, R * 1.22 * Math.abs(Math.sin(rx + 1.25)) * 0.34), 0, 0, Math.PI * 2);
    ctx!.stroke();
  }

  // ---- Frame loop
  let visible = true, raf = 0, idleFrames = 0;
  function frame(t: number) {
    // Ease towards the pointer quickly, but smoothly
    yaw += (yawTarget - yaw) * 0.12;
    pitch += (pitchTarget - pitch) * 0.12;
    if (pointer.active) {
      glowX += (pointer.x - glowX) * 0.35;
      glowY += (pointer.y - glowY) * 0.35;
    }
    glow += ((pointer.active ? 1 : 0) - glow) * 0.15;

    ctx!.clearRect(0, 0, W, H);
    const sorted = [...orbs].sort((a, b) => b.z - a.z);
    for (const o of sorted) if (o.z >= 1) drawOrb(o, t);
    drawGlobe(t);
    for (const o of sorted) if (o.z < 1) drawOrb(o, t);

    // With reduced motion, stop drawing once the scene has settled after the pointer moves
    const settled = Math.abs(yawTarget - yaw) < 0.001 && Math.abs(pitchTarget - pitch) < 0.001 && (pointer.active ? true : glow < 0.01);
    idleFrames = settled ? idleFrames + 1 : 0;
    if (reduce && idleFrames > 3) {
      raf = 0;
      return;
    }
    raf = visible && !document.hidden ? requestAnimationFrame(frame) : 0;
  }
  function wake() {
    if (!raf && visible && !document.hidden) raf = requestAnimationFrame(frame);
  }

  new ResizeObserver(() => {
    layout();
    if (!raf) frame(performance.now());
  }).observe(band);
  window.addEventListener('load', () => {
    layout();
    wake();
  });
  new IntersectionObserver(([e]) => {
    visible = e.isIntersecting;
    if (visible) wake();
  }).observe(band);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) wake();
  });

  layout();
  frame(performance.now());
  cv.classList.add('ready');
}
