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
