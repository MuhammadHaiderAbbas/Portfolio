// Small interactive touches: 3D tilt on cards and the photo, rotating role titles,
// theme switch and mobile menu. Everything degrades gracefully without JavaScript.

const root = document.documentElement;
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const finePointer = matchMedia('(hover: hover) and (pointer: fine)').matches;

// Theme switch
document.getElementById('theme-toggle')?.addEventListener('click', () => {
  const current =
    root.dataset.theme === 'dark' || root.dataset.theme === 'light'
      ? root.dataset.theme
      : matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light';
  const next = current === 'dark' ? 'light' : 'dark';
  root.dataset.theme = next;
  try {
    localStorage.setItem('theme', next);
  } catch {}
});

// Mobile menu
const menuBtn = document.getElementById('menu-toggle');
const nav = document.getElementById('site-nav');
menuBtn?.addEventListener('click', () => {
  const open = nav!.classList.toggle('open');
  menuBtn.setAttribute('aria-expanded', String(open));
  menuBtn.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
});

// 3D tilt
if (root.dataset.tilt === 'on' && finePointer && !reduce) {
  for (const el of document.querySelectorAll<HTMLElement>('[data-tilt]')) {
    const max = Number(el.dataset.tilt) || 8;
    let frame = 0;
    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect();
      // Wide elements (list rows) tilt less, so they never look skewed.
      const scale = Math.min(1, 420 / Math.max(r.width, 1));
      const px = (e.clientX - r.left) / r.width - 0.5;
      const py = (e.clientY - r.top) / r.height - 0.5;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        el.style.setProperty('--rx', `${(-py * max * scale).toFixed(2)}deg`);
        el.style.setProperty('--ry', `${(px * max * scale).toFixed(2)}deg`);
        el.style.setProperty('--gx', `${((px + 0.5) * 100).toFixed(1)}%`);
        el.style.setProperty('--gy', `${((py + 0.5) * 100).toFixed(1)}%`);
      });
    });
    el.addEventListener('pointerleave', () => {
      cancelAnimationFrame(frame);
      el.style.setProperty('--rx', '0deg');
      el.style.setProperty('--ry', '0deg');
    });
  }
}

// Rotating role titles
const roles = document.querySelector<HTMLElement>('[data-roles]');
if (roles && !reduce) {
  const items = [...roles.querySelectorAll<HTMLElement>('span')];
  if (items.length > 1) {
    let i = 0;
    setInterval(() => {
      items[i].classList.remove('on');
      i = (i + 1) % items.length;
      items[i].classList.add('on');
    }, 3200);
  }
}

// Reveal sections as they scroll into view, and count the snapshot numbers up.
const revealEls = document.querySelectorAll<HTMLElement>('[data-reveal]');
const counters = document.querySelectorAll<HTMLElement>('[data-count]');
const countUp = (el: HTMLElement) => {
  const target = Number(el.dataset.count);
  if (!Number.isFinite(target) || reduce) return;
  const decimals = (el.dataset.count!.split('.')[1] || '').length;
  const start = performance.now();
  const dur = 1400;
  const step = (now: number) => {
    const p = Math.min(1, (now - start) / dur);
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = (target * eased).toFixed(decimals);
    if (p < 1) requestAnimationFrame(step);
  };
  el.textContent = (0).toFixed(decimals);
  requestAnimationFrame(step);
};
if ('IntersectionObserver' in window) {
  const io = new IntersectionObserver(
    (entries) => {
      for (const en of entries) {
        if (!en.isIntersecting) continue;
        const el = en.target as HTMLElement;
        el.classList.add('in');
        el.querySelectorAll<HTMLElement>('[data-count]').forEach(countUp);
        io.unobserve(el);
      }
    },
    { rootMargin: '0px 0px -8% 0px', threshold: 0.12 }
  );
  revealEls.forEach((el) => io.observe(el));
} else {
  revealEls.forEach((el) => el.classList.add('in'));
}
void counters;
