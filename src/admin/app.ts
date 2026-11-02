import { createClient, type Session } from '@supabase/supabase-js';
import { marked } from 'marked';
import { sections, type Field, type Section } from './schema';
import { textDefs } from '../lib/site-text';
import starter from '../data/seed.json';
import './admin.css';
import { h } from './dom';
import { topbarWidgets, startLive, refreshCounts, counts, type Ctx } from './live';
import { dashboardView } from './dashboard';
import { opportunitiesView } from './opportunities';

type Row = Record<string, any>;

const app = document.getElementById('app') as HTMLElement;
const cfg = app.dataset as { url?: string; key?: string; repo?: string; base?: string };
const BASE = (cfg.base ?? '').replace(/\/$/, '');
/** Site paths such as "/img/x.webp" or "/projects/" need the base when the site lives in a sub-folder. */
const site = (p: string) => (p && p.startsWith('/') && !p.startsWith('//') ? BASE + p : p);

const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);

// ---------------------------------------------------------------------------
// Not configured
// ---------------------------------------------------------------------------
if (!cfg.url || !cfg.key) {
  app.replaceChildren(
    h(
      'div',
      { class: 'auth-card' },
      h('h1', {}, 'Admin is not connected yet'),
      h(
        'p',
        {},
        'Add your Supabase project address and public key to supabase.config.json in the repository (or as GitHub repository variables), then publish again. The README walks through it.'
      )
    )
  );
  throw new Error('Supabase is not configured');
}

const sb = createClient(cfg.url, cfg.key, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit' },
});

// ---------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------
const toasts = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });
document.body.append(toasts);
function toast(message: string, kind: 'ok' | 'error' = 'ok') {
  const t = h('div', { class: `toast toast-${kind}` }, message);
  toasts.append(t);
  setTimeout(() => t.remove(), kind === 'error' ? 8000 : 3500);
}
const errMessage = (e: any) => e?.message || String(e);

const ctx: Ctx = {
  sb,
  toast,
  site,
  repo: cfg.repo ?? '',
  route: (link: string) => {
    if (link.startsWith('#/')) return link;
    const name = link.replace(/^#/, '');
    const s = sections.find((x) => x.table === name || x.key === name);
    return `#/${s ? s.key : name}`;
  },
};

// ---------------------------------------------------------------------------
// Auth screens
// ---------------------------------------------------------------------------
function renderLogin(note?: string) {
  const email = h('input', { id: 'email', type: 'email', autocomplete: 'username', required: true });
  const password = h('input', { id: 'password', type: 'password', autocomplete: 'current-password', required: true });
  const status = h('p', { class: 'form-note', role: 'status' }, note ?? '');
  const submit = h('button', { class: 'btn', type: 'submit' }, 'Sign in');
  const form = h(
    'form',
    {
      class: 'auth-card',
      onsubmit: async (e: Event) => {
        e.preventDefault();
        submit.disabled = true;
        status.textContent = 'Signing in…';
        const { error } = await sb.auth.signInWithPassword({ email: email.value.trim(), password: password.value });
        submit.disabled = false;
        if (error) status.textContent = `Sign-in failed: ${error.message}`;
        else route();
      },
    },
    h('h1', {}, 'Site admin'),
    h('p', { class: 'muted' }, 'Sign in to edit your portfolio.'),
    h('div', { class: 'field' }, h('label', { for: 'email' }, 'Email'), email),
    h('div', { class: 'field' }, h('label', { for: 'password' }, 'Password'), password),
    submit,
    h(
      'button',
      {
        type: 'button',
        class: 'link-btn',
        onclick: async () => {
          if (!email.value.trim()) {
            status.textContent = 'Enter your email first, then choose "Forgot password" again.';
            email.focus();
            return;
          }
          const { error } = await sb.auth.resetPasswordForEmail(email.value.trim(), {
            redirectTo: `${location.origin}${location.pathname}`,
          });
          status.textContent = error
            ? `Could not send the reset email: ${error.message}`
            : 'Check your inbox for a link to set a new password.';
        },
      },
      'Forgot password?'
    ),
    status
  );
  app.replaceChildren(form);
  email.focus();
}

let recovering = location.hash.includes('type=recovery');

function renderSetPassword() {
  recovering = true;
  const pw = h('input', { id: 'newpw', type: 'password', autocomplete: 'new-password', minlength: 10, required: true });
  const status = h('p', { class: 'form-note', role: 'status' });
  app.replaceChildren(
    h(
      'form',
      {
        class: 'auth-card',
        onsubmit: async (e: Event) => {
          e.preventDefault();
          if (pw.value.length < 10) {
            status.textContent = 'Use at least 10 characters.';
            return;
          }
          const { error } = await sb.auth.updateUser({ password: pw.value });
          if (error) status.textContent = `Could not save the password: ${error.message}`;
          else {
            recovering = false;
            toast('Password saved');
            location.hash = '#/projects';
            route();
          }
        },
      },
      h('h1', {}, 'Set a new password'),
      h('div', { class: 'field' }, h('label', { for: 'newpw' }, 'New password'), pw),
      h('button', { class: 'btn', type: 'submit' }, 'Save password'),
      status
    )
  );
  pw.focus();
}

function renderNotAdmin(session: Session) {
  app.replaceChildren(
    h(
      'div',
      { class: 'auth-card' },
      h('h1', {}, 'This account cannot edit the site'),
      h('p', {}, `You are signed in as ${session.user.email}, which is not on the admin list.`),
      h('p', { class: 'muted' }, 'Add it by running the "make me an admin" query from the README in the Supabase SQL editor.'),
      h('button', { class: 'btn btn-quiet', onclick: signOut }, 'Sign out')
    )
  );
}

async function signOut() {
  await sb.auth.signOut();
  adminChecked = null;
  location.hash = '';
  renderLogin();
}

// ---------------------------------------------------------------------------
// Shell: navigation + publish bar
// ---------------------------------------------------------------------------
let adminChecked: { userId: string; ok: boolean } | null = null;
let dirty = false;

const publishBar = h('div', { class: 'publish-bar' });

async function refreshPublishState() {
  const { data } = await sb.from('site_state').select('*').eq('id', 1).maybeSingle();
  const changed = data && (!data.last_published_at || new Date(data.content_changed_at) > new Date(data.last_published_at));
  const last = data?.last_published_at ? new Date(data.last_published_at).toLocaleString('en-GB') : 'never';
  const btn = h('button', { class: 'btn', type: 'button', onclick: () => publish(btn, msg) }, 'Publish site');
  const msg = h(
    'span',
    { class: 'publish-msg' },
    changed ? 'You have changes that are not live yet.' : `Everything is live. Last published ${last}.`
  );
  publishBar.dataset.state = changed ? 'pending' : 'clean';
  publishBar.replaceChildren(msg, btn);
}

async function publish(btn: HTMLButtonElement, msg: HTMLElement) {
  btn.disabled = true;
  msg.textContent = 'Asking GitHub to rebuild the site…';
  const { data, error } = await sb.rpc('publish_site');
  if (error) {
    btn.disabled = false;
    publishBar.dataset.state = 'error';
    const manual = cfg.repo
      ? h('a', { href: `https://github.com/${cfg.repo}/actions/workflows/deploy.yml`, target: '_blank', rel: 'noopener' }, 'Run the deploy on GitHub instead')
      : '';
    if (/not set up/i.test(error.message)) {
      msg.replaceChildren(
        'The Publish button is not connected to GitHub yet: add your GitHub token to Supabase (README, step 5). ',
        manual
      );
    } else {
      msg.replaceChildren(`Publishing failed: ${error.message} `, manual);
    }
    return;
  }
  const id = (data as any)?.request_id;
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    const { data: st } = await sb.rpc('publish_status', { p_request_id: id });
    const s = st as any;
    if (s?.state === 'accepted') {
      publishBar.dataset.state = 'clean';
      window.dispatchEvent(new Event('admin:published'));
      msg.replaceChildren(
        'Published. The site is rebuilding and your changes go live in about a minute.',
        cfg.repo ? h('a', { href: `https://github.com/${cfg.repo}/actions`, target: '_blank', rel: 'noopener' }, ' Watch progress') : ''
      );
      btn.disabled = false;
      return;
    }
    if (s?.state === 'failed') {
      const hint =
        s.status_code === 401
          ? 'GitHub rejected the token. Create a new token and update the github_token secret.'
          : s.status_code === 404 || s.status_code === 403
            ? 'GitHub could not find the repository with this token. Check the github_repo secret and the token’s repository access.'
            : s.error || '';
      msg.textContent = `Publishing failed (GitHub answered ${s.status_code ?? 'with an error'}). ${hint}`;
      publishBar.dataset.state = 'error';
      btn.disabled = false;
      return;
    }
  }
  msg.textContent = 'GitHub has not answered yet. Check the Actions tab on GitHub in a minute.';
  btn.disabled = false;
}

const refreshUnread = () => refreshCounts(ctx);

function shell(active: string, main: HTMLElement, session: Session) {
  const link = (href: string, label: string, key: string, extra?: Node) =>
    h('a', { href, 'aria-current': active === key ? 'page' : undefined }, label, extra);
  const badge = (id: string, n: number) => h('span', { class: 'badge', id, hidden: !n }, n || '');
  const nav = h(
    'nav',
    { class: 'side', 'aria-label': 'Admin' },
    h('span', { class: 'side-label' }, 'Overview'),
    link('#/dashboard', 'Dashboard', 'dashboard'),
    link('#/opportunities', 'Job opportunities', 'opportunities', badge('badge-opps-side', counts.opportunities)),
    link('#/messages', 'Messages', 'messages', badge('badge-messages-side', counts.messages)),
    h('span', { class: 'side-label' }, 'Content'),
    sections.map((s) => link(`#/${s.key}`, s.label, s.key)),
    link('#/text', 'Site text & settings', 'text')
  );
  app.replaceChildren(
    h(
      'div',
      { class: 'admin' },
      h(
        'header',
        { class: 'topbar' },
        h('a', { class: 'brand', href: '#/dashboard' }, h('span', { class: 'brand-mark', 'aria-hidden': 'true' }, 'H'), 'Site admin'),
        topbarWidgets(ctx, session.user.email ?? '', signOut)
      ),
      publishBar,
      h('div', { class: 'layout' }, nav, h('main', { class: 'content', id: 'main' }, main))
    )
  );
}

// ---------------------------------------------------------------------------
// Uploads (images are resized and converted to WebP in the browser)
// ---------------------------------------------------------------------------
async function toWebp(file: File, max = 1920): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/webp', 0.82));
  if (blob && blob.type === 'image/webp') return blob;
  return (await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.85))) ?? file;
}

async function upload(file: File, folder = 'misc'): Promise<string> {
  let blob: Blob = file;
  let ext = (file.name.split('.').pop() || 'bin').toLowerCase();
  if (file.type.startsWith('image/') && file.type !== 'image/gif') {
    blob = await toWebp(file);
    ext = blob.type === 'image/webp' ? 'webp' : 'jpg';
  }
  const base = slugify(file.name.replace(/\.[^.]+$/, '')) || 'file';
  const path = `${folder}/${Date.now()}-${base}.${ext}`;
  const { error } = await sb.storage
    .from('media')
    .upload(path, blob, { contentType: blob.type || file.type, cacheControl: '31536000', upsert: false });
  if (error) throw error;
  return sb.storage.from('media').getPublicUrl(path).data.publicUrl;
}

function pickFiles(accept: string, multiple: boolean): Promise<File[]> {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept, multiple, hidden: true });
    input.addEventListener('change', () => {
      resolve([...(input.files ?? [])]);
      input.remove();
    });
    document.body.append(input);
    input.click();
  });
}

// ---------------------------------------------------------------------------
// Field editors
// ---------------------------------------------------------------------------
interface Editor {
  el: HTMLElement;
  get(): unknown;
}

const markDirty = () => (dirty = true);

function fieldWrap(f: Field, id: string, control: Node, extra?: Node): HTMLElement {
  return h(
    'div',
    { class: `field field-${f.type}` },
    h('label', { for: id }, f.label, f.required ? h('span', { class: 'req', 'aria-hidden': 'true' }, ' *') : ''),
    control,
    extra,
    f.help ? h('p', { class: 'help', id: `${id}-help` }, f.help) : ''
  );
}

function imagePreview(url: string) {
  return url ? h('img', { src: site(url), alt: '', loading: 'lazy' }) : h('span', { class: 'muted' }, 'No image');
}

function editorFor(f: Field, value: any, suggestions: string[]): Editor {
  const id = `f-${f.name}`;
  const describedBy = f.help ? `${id}-help` : undefined;
  switch (f.type) {
    case 'textarea':
    case 'markdown': {
      const ta = h('textarea', { id, rows: f.type === 'markdown' ? 16 : 3, oninput: markDirty, 'aria-describedby': describedBy });
      ta.value = value ?? '';
      if (f.type === 'textarea') return { el: fieldWrap(f, id, ta), get: () => ta.value };
      const preview = h('div', { class: 'md-preview prose', hidden: true });
      const toggle = h(
        'button',
        {
          type: 'button',
          class: 'btn btn-quiet btn-sm',
          onclick: () => {
            const showing = preview.hidden;
            if (showing)
              preview.innerHTML = (marked.parse(ta.value, { async: false }) as string).replace(
                /(\s(?:src|href)=")\/(?!\/)/g,
                `$1${BASE}/`
              );
            preview.hidden = !showing;
            ta.hidden = showing;
            toggle.textContent = showing ? 'Edit' : 'Preview';
          },
        },
        'Preview'
      );
      const insertImg = h(
        'button',
        {
          type: 'button',
          class: 'btn btn-quiet btn-sm',
          onclick: async () => {
            const [file] = await pickFiles('image/*', false);
            if (!file) return;
            insertImg.disabled = true;
            try {
              const url = await upload(file, f.folder ?? 'content');
              const snippet = `\n![](${url})\n`;
              const pos = ta.selectionStart ?? ta.value.length;
              ta.setRangeText(snippet, pos, pos, 'end');
              markDirty();
              toast('Image added');
            } catch (e) {
              toast(`Upload failed: ${errMessage(e)}`, 'error');
            } finally {
              insertImg.disabled = false;
            }
          },
        },
        'Insert image'
      );
      const tools = h('div', { class: 'md-tools' }, toggle, insertImg, h('span', { class: 'muted' }, 'Markdown: ## heading, **bold**, - list, [link](url)'));
      return { el: fieldWrap(f, id, h('div', {}, tools, ta, preview)), get: () => ta.value };
    }
    case 'bool': {
      const cb = h('input', { id, type: 'checkbox', checked: Boolean(value), onchange: markDirty, 'aria-describedby': describedBy });
      const el = h(
        'div',
        { class: 'field field-bool' },
        h('label', { for: id }, cb, f.label),
        f.help ? h('p', { class: 'help', id: `${id}-help` }, f.help) : ''
      );
      return { el, get: () => cb.checked };
    }
    case 'number': {
      const inp = h('input', { id, type: 'number', step: 1, value: value ?? 100, oninput: markDirty, 'aria-describedby': describedBy });
      return { el: fieldWrap(f, id, inp), get: () => (inp.value === '' ? 100 : Number(inp.value)) };
    }
    case 'level': {
      const inp = h('input', { id, type: 'number', min: 0, max: 100, step: 1, value: value ?? '', placeholder: 'No bar', oninput: markDirty, 'aria-describedby': describedBy });
      return {
        el: fieldWrap(f, id, inp),
        get: () => (inp.value === '' ? null : Math.max(0, Math.min(100, Math.round(Number(inp.value))))),
      };
    }
    case 'lines': {
      const ta = h('textarea', { id, rows: 5, oninput: markDirty, 'aria-describedby': describedBy });
      ta.value = (value ?? []).join('\n');
      return {
        el: fieldWrap(f, id, ta),
        get: () =>
          ta.value
            .split('\n')
            .map((s) => s.trim())
            .filter(Boolean),
      };
    }
    case 'date': {
      const inp = h('input', { id, type: 'date', value: value ?? '', oninput: markDirty });
      return { el: fieldWrap(f, id, inp), get: () => inp.value || null };
    }
    case 'select': {
      const sel = h('select', { id, onchange: markDirty }, (f.options ?? []).map((o) => h('option', { value: o.value }, o.label)));
      sel.value = value ?? f.options?.[0]?.value ?? '';
      return { el: fieldWrap(f, id, sel), get: () => sel.value };
    }
    case 'tags': {
      const inp = h('input', { id, value: (value ?? []).join(', '), oninput: markDirty, 'aria-describedby': `${id}-help` });
      const el = fieldWrap({ ...f, help: f.help ?? 'Separate with commas.' }, id, inp);
      return {
        el,
        get: () =>
          inp.value
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
      };
    }
    case 'image':
    case 'file': {
      const isImage = f.type === 'image';
      const inp = h('input', { id, type: 'text', value: value ?? '', placeholder: 'Upload, or paste a link', oninput: () => { markDirty(); prev.replaceChildren(isImage ? imagePreview(inp.value) : fileLink(inp.value)); } });
      const fileLink = (u: string) => (u ? h('a', { href: u, target: '_blank', rel: 'noopener' }, 'Open current file') : h('span', { class: 'muted' }, 'No file'));
      const prev = h('div', { class: 'thumb' }, isImage ? imagePreview(inp.value) : fileLink(inp.value));
      const up = h(
        'button',
        {
          type: 'button',
          class: 'btn btn-quiet btn-sm',
          onclick: async () => {
            const [file] = await pickFiles(isImage ? 'image/*' : '.pdf,.docx,application/pdf', false);
            if (!file) return;
            up.disabled = true;
            up.textContent = 'Uploading…';
            try {
              inp.value = await upload(file, f.folder);
              prev.replaceChildren(isImage ? imagePreview(inp.value) : fileLink(inp.value));
              markDirty();
              toast(isImage ? 'Image uploaded' : 'File uploaded');
            } catch (e) {
              toast(`Upload failed: ${errMessage(e)}`, 'error');
            } finally {
              up.disabled = false;
              up.textContent = isImage ? 'Upload image' : 'Upload file';
            }
          },
        },
        isImage ? 'Upload image' : 'Upload file'
      );
      const clear = h('button', { type: 'button', class: 'btn btn-quiet btn-sm', onclick: () => { inp.value = ''; prev.replaceChildren(isImage ? imagePreview('') : fileLink('')); markDirty(); } }, 'Remove');
      return { el: fieldWrap(f, id, h('div', { class: 'media-field' }, prev, h('div', { class: 'media-controls' }, inp, h('div', { class: 'row' }, up, clear)))), get: () => inp.value.trim() };
    }
    case 'images': {
      let urls: string[] = [...(value ?? [])];
      const list = h('ul', { class: 'gallery-edit' });
      const draw = () => {
        list.replaceChildren(
          ...urls.map((u, i) =>
            h(
              'li',
              {},
              h('img', { src: u, alt: '', loading: 'lazy' }),
              h(
                'div',
                { class: 'row' },
                h('button', { type: 'button', class: 'btn btn-quiet btn-sm', disabled: i === 0, 'aria-label': 'Move earlier', onclick: () => { [urls[i - 1], urls[i]] = [urls[i], urls[i - 1]]; markDirty(); draw(); } }, '‹'),
                h('button', { type: 'button', class: 'btn btn-quiet btn-sm', disabled: i === urls.length - 1, 'aria-label': 'Move later', onclick: () => { [urls[i + 1], urls[i]] = [urls[i], urls[i + 1]]; markDirty(); draw(); } }, '›'),
                h('button', { type: 'button', class: 'btn btn-quiet btn-sm', onclick: () => { urls.splice(i, 1); markDirty(); draw(); } }, 'Remove')
              )
            )
          )
        );
      };
      draw();
      const add = h(
        'button',
        {
          type: 'button',
          id,
          class: 'btn btn-quiet btn-sm',
          onclick: async () => {
            const files = await pickFiles('image/*', true);
            if (!files.length) return;
            add.disabled = true;
            try {
              for (const file of files) {
                add.textContent = `Uploading ${files.indexOf(file) + 1} of ${files.length}…`;
                urls.push(await upload(file, f.folder));
                draw();
              }
              markDirty();
              toast(files.length > 1 ? `${files.length} images uploaded` : 'Image uploaded');
            } catch (e) {
              toast(`Upload failed: ${errMessage(e)}`, 'error');
            } finally {
              add.disabled = false;
              add.textContent = 'Add images';
            }
          },
        },
        'Add images'
      );
      return { el: fieldWrap(f, id, h('div', {}, list, add)), get: () => urls };
    }
    case 'pairs': {
      const [a, b] = f.pair!;
      let rows: Row[] = Array.isArray(value) ? value.map((r: Row) => ({ ...r })) : [];
      const box = h('div', { class: 'pairs' });
      const draw = () => {
        box.replaceChildren(
          ...rows.map((r, i) =>
            h(
              'div',
              { class: 'pair' },
              h('input', { 'aria-label': `${a.label} ${i + 1}`, placeholder: a.label, value: r[a.name] ?? '', oninput: (e: Event) => { r[a.name] = (e.target as HTMLInputElement).value; markDirty(); } }),
              h('input', { 'aria-label': `${b.label} ${i + 1}`, placeholder: b.label, value: r[b.name] ?? '', oninput: (e: Event) => { r[b.name] = (e.target as HTMLInputElement).value; markDirty(); } }),
              h('button', { type: 'button', class: 'btn btn-quiet btn-sm', onclick: () => { rows.splice(i, 1); markDirty(); draw(); } }, 'Remove')
            )
          ),
          h('button', { type: 'button', id, class: 'btn btn-quiet btn-sm', onclick: () => { rows.push({ [a.name]: '', [b.name]: '' }); draw(); } }, 'Add row')
        );
      };
      draw();
      return {
        el: fieldWrap(f, id, box),
        get: () => rows.filter((r) => String(r[a.name] ?? '').trim() || String(r[b.name] ?? '').trim()),
      };
    }
    default: {
      const type = f.type === 'email' ? 'email' : f.type === 'url' ? 'url' : 'text';
      const listId = suggestions.length ? `${id}-list` : undefined;
      const inp = h('input', { id, type, value: value ?? '', required: f.required, list: listId, oninput: markDirty, 'aria-describedby': describedBy });
      const dl = listId ? h('datalist', { id: listId }, suggestions.map((s) => h('option', { value: s }))) : undefined;
      return { el: fieldWrap(f, id, inp, dl), get: () => inp.value.trim() };
    }
  }
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------
async function listView(s: Section): Promise<HTMLElement> {
  let q = sb.from(s.table).select('*');
  for (const o of s.order) q = q.order(o.column, { ascending: o.ascending });
  const { data, error } = await q;
  if (error) return h('div', {}, h('h1', {}, s.label), h('p', { class: 'error' }, `Could not load ${s.label.toLowerCase()}: ${error.message}`));
  const rows = data ?? [];
  return h(
    'div',
    {},
    h('div', { class: 'view-head' }, h('h1', {}, s.label), h('a', { class: 'btn', href: `#/${s.key}/new` }, `Add a ${s.singular}`)),
    rows.length
      ? h(
          'ul',
          { class: 'rows' },
          rows.map((r) =>
            h(
              'li',
              {},
              h(
                'a',
                { href: `#/${s.key}/${r.id}`, class: 'row-main' },
                h('span', { class: 'row-title' }, r[s.titleField] || 'Untitled'),
                s.subtitle ? h('span', { class: 'row-sub' }, s.subtitle(r)) : ''
              ),
              r.published === false ? h('span', { class: 'pill' }, 'Hidden') : ''
            )
          )
        )
      : h('div', { class: 'empty' }, h('p', {}, `No ${s.label.toLowerCase()} yet.`), h('a', { class: 'btn', href: `#/${s.key}/new` }, `Add your first ${s.singular}`))
  );
}

async function formView(s: Section, id: string | 'new'): Promise<HTMLElement> {
  let row: Row = { ...(s.defaults ?? {}) };
  if (s.singleton || id !== 'new') {
    const { data, error } = await sb.from(s.table).select('*').eq('id', s.singleton ? 1 : id).maybeSingle();
    if (error || !data) return h('div', {}, h('h1', {}, s.label), h('p', { class: 'error' }, error ? error.message : 'This item no longer exists.'), h('a', { href: `#/${s.key}` }, `Back to ${s.label.toLowerCase()}`));
    row = data;
  }
  const isNew = !s.singleton && id === 'new';

  // Suggestions such as existing categories
  const suggestions: Record<string, string[]> = {};
  for (const f of s.fields.filter((f) => f.suggestFrom)) {
    const { data } = await sb.from(s.table).select(f.suggestFrom!);
    suggestions[f.name] = [...new Set((data ?? []).map((r: Row) => r[f.suggestFrom!]).filter(Boolean))].sort();
  }

  const editors = new Map<string, Editor>();
  for (const f of s.fields) editors.set(f.name, editorFor(f, row[f.name], suggestions[f.name] ?? []));

  // Auto-fill the web address from the title for new items
  if (s.hasSlug && isNew) {
    const title = editors.get(s.titleField)!.el.querySelector('input')!;
    const slug = editors.get('slug')!.el.querySelector('input')!;
    let touched = false;
    slug.addEventListener('input', () => (touched = true));
    title.addEventListener('input', () => {
      if (!touched) slug.value = slugify(title.value);
    });
  }

  const status = h('p', { class: 'form-note', role: 'status' });
  const save = h('button', { class: 'btn', type: 'submit' }, isNew ? `Create ${s.singular}` : 'Save changes');

  const form = h(
    'form',
    {
      class: 'edit-form',
      novalidate: true,
      onsubmit: async (e: Event) => {
        e.preventDefault();
        const values: Row = {};
        for (const [name, ed] of editors) values[name] = ed.get();
        for (const f of s.fields) {
          if (f.required && !String(values[f.name] ?? '').trim()) {
            status.textContent = `${f.label} is required.`;
            (editors.get(f.name)!.el.querySelector('input,textarea') as HTMLElement | null)?.focus();
            return;
          }
        }
        if (s.hasSlug && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(values.slug)) {
          status.textContent = 'Web address can only use lowercase letters, numbers and single hyphens.';
          editors.get('slug')!.el.querySelector('input')!.focus();
          return;
        }
        save.disabled = true;
        status.textContent = 'Saving…';
        const res = isNew
          ? await sb.from(s.table).insert(values).select().single()
          : await sb.from(s.table).update(values).eq('id', s.singleton ? 1 : id).select().single();
        save.disabled = false;
        if (res.error) {
          status.textContent = res.error.code === '23505' ? 'Another item already uses this web address. Choose a different one.' : `Could not save: ${res.error.message}`;
          return;
        }
        dirty = false;
        status.textContent = '';
        toast(isNew ? `${cap(s.singular)} created. Publish to put it live.` : 'Saved. Publish to put your changes live.');
        refreshPublishState();
        if (isNew) location.hash = `#/${s.key}/${res.data.id}`;
      },
    },
    h(
      'div',
      { class: 'view-head' },
      h('div', {}, !s.singleton ? h('a', { href: `#/${s.key}`, class: 'back' }, `All ${s.label.toLowerCase()}`) : '', h('h1', {}, isNew ? `New ${s.singular}` : s.singleton ? s.label : row[s.titleField] || 'Untitled')),
      viewLink(s, row)
    ),
    [...editors.values()].map((e) => e.el),
    h('div', { class: 'form-actions' }, save, !isNew && !s.singleton ? deleteButton(s, id) : '', status)
  );
  return form;
}

function viewLink(s: Section, row: Row) {
  const path = row.id || s.singleton ? s.publicPath?.(row) : null;
  return path ? h('a', { href: site(path), target: '_blank', rel: 'noopener', class: 'btn btn-quiet btn-sm' }, 'View on site') : '';
}

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

function deleteButton(s: Section, id: string) {
  let armed = false;
  let timer: number | undefined;
  const btn: HTMLButtonElement = h(
    'button',
    {
      type: 'button',
      class: 'btn btn-danger',
      onclick: async () => {
        if (!armed) {
          armed = true;
          btn.textContent = `Click again to delete this ${s.singular}`;
          timer = window.setTimeout(() => {
            armed = false;
            btn.textContent = `Delete ${s.singular}`;
          }, 4000);
          return;
        }
        clearTimeout(timer);
        btn.disabled = true;
        const { error } = await sb.from(s.table).delete().eq('id', id);
        if (error) {
          toast(`Could not delete: ${error.message}`, 'error');
          btn.disabled = false;
          return;
        }
        dirty = false;
        toast(`${cap(s.singular)} deleted. Publish to remove it from the site.`);
        refreshPublishState();
        location.hash = `#/${s.key}`;
      },
    },
    `Delete ${s.singular}`
  );
  return btn;
}

async function messagesView(): Promise<HTMLElement> {
  const { data, error } = await sb.from('messages').select('*').order('created_at', { ascending: false });
  if (error) return h('div', {}, h('h1', {}, 'Messages'), h('p', { class: 'error' }, error.message));
  const rows = data ?? [];
  const list = h('ul', { class: 'messages' });
  const draw = () =>
    list.replaceChildren(
      ...rows.map((m: Row) => {
        const del = h('button', { class: 'btn btn-quiet btn-sm', type: 'button' }, 'Delete');
        let armed = false;
        del.addEventListener('click', async () => {
          if (!armed) {
            armed = true;
            del.textContent = 'Click again to delete';
            setTimeout(() => { armed = false; del.textContent = 'Delete'; }, 4000);
            return;
          }
          const { error } = await sb.from('messages').delete().eq('id', m.id);
          if (error) return toast(`Could not delete: ${error.message}`, 'error');
          rows.splice(rows.indexOf(m), 1);
          draw();
          refreshUnread();
          toast('Message deleted');
        });
        return h(
          'li',
          { class: m.is_read ? 'read' : 'unread' },
          h(
            'div',
            { class: 'msg-head' },
            h('strong', {}, m.name),
            h('a', { href: `mailto:${m.email}` }, m.email),
            h('time', { datetime: m.created_at }, new Date(m.created_at).toLocaleString('en-GB'))
          ),
          m.subject ? h('p', { class: 'msg-subject' }, m.subject) : '',
          h('p', { class: 'msg-body' }, m.body),
          h(
            'div',
            { class: 'row' },
            h('a', { class: 'btn btn-sm', href: `mailto:${m.email}?subject=${encodeURIComponent('Re: ' + (m.subject || 'your message'))}` }, 'Reply by email'),
            h(
              'button',
              {
                class: 'btn btn-quiet btn-sm',
                type: 'button',
                onclick: async () => {
                  const { error } = await sb.from('messages').update({ is_read: !m.is_read }).eq('id', m.id);
                  if (error) return toast(`Could not update: ${error.message}`, 'error');
                  m.is_read = !m.is_read;
                  draw();
                  refreshUnread();
                },
              },
              m.is_read ? 'Mark as unread' : 'Mark as read'
            ),
            del
          )
        );
      })
    );
  draw();
  return h(
    'div',
    {},
    h('div', { class: 'view-head' }, h('h1', {}, 'Messages')),
    rows.length ? list : h('div', { class: 'empty' }, h('p', {}, 'No messages yet. Messages from the contact form appear here.'))
  );
}

// ---------------------------------------------------------------------------
// First run: copy the site's built-in content into an empty database
// ---------------------------------------------------------------------------
const importTables = ['projects', 'posts', 'certifications', 'timeline', 'skills', 'services', 'stats', 'focus_areas'] as const;
let importDone = false;

async function databaseIsEmpty(): Promise<boolean> {
  if (importDone) return false;
  const { count, error } = await sb.from('projects').select('id', { count: 'exact', head: true });
  importDone = Boolean(error) || Boolean(count);
  return !importDone;
}

function importView(): HTMLElement {
  const s = starter as Record<string, any>;
  const summary = [
    `${s.projects.length} projects`,
    `${s.posts.length} blog posts`,
    `${s.certifications.length} certifications`,
    `${s.timeline.length} experience and education entries`,
    `${s.skills.length} skills`,
    `${s.services.length} services`,
    `${s.stats.length} snapshot numbers`,
    `${s.focus_areas.length} "What I do" blocks`,
    'your profile and contact details',
  ];
  const status = h('p', { class: 'form-note', role: 'status' });
  const btn = h(
    'button',
    {
      class: 'btn',
      type: 'button',
      onclick: async () => {
        btn.disabled = true;
        try {
          status.textContent = 'Importing your profile…';
          const { id, ...profile } = s.profile;
          let r = await sb.from('profile').update(profile).eq('id', 1);
          if (r.error) throw r.error;
          for (const table of importTables) {
            const rows = s[table] ?? [];
            if (!rows.length) continue;
            const { count } = await sb.from(table).select('id', { count: 'exact', head: true });
            if (count) continue; // already imported on an earlier try
            status.textContent = `Importing ${table.replace('_', ' ')}…`;
            r = await sb.from(table).insert(rows);
            if (r.error) throw new Error(`${table}: ${r.error.message}`);
          }
          if (s.site_text?.length) {
            r = await sb.from('site_text').upsert(s.site_text, { onConflict: 'key' });
            if (r.error) throw r.error;
          }
          importDone = true;
          toast('Content imported. Publish to put it live.');
          refreshPublishState();
          location.hash = '#/projects';
          route();
        } catch (e) {
          status.textContent = `The import stopped: ${errMessage(e)}. Press "Import your content" again to continue; anything already imported is skipped.`;
          btn.disabled = false;
        }
      },
    },
    'Import your content'
  );
  return h(
    'div',
    { class: 'import-card' },
    h('h1', {}, 'Your database is empty'),
    h('p', {}, 'Import the content from your previous site to start editing. This adds:'),
    h('ul', {}, summary.map((x) => h('li', {}, x))),
    btn,
    status
  );
}

// ---------------------------------------------------------------------------
// Site text & settings: every heading, label and setting on the site
// ---------------------------------------------------------------------------
async function siteTextView(): Promise<HTMLElement> {
  const { data, error } = await sb.from('site_text').select('key,value');
  if (error) return h('div', {}, h('h1', {}, 'Site text & settings'), h('p', { class: 'error' }, error.message));
  const saved = new Map<string, string>((data ?? []).map((r: Row) => [r.key, r.value]));
  const current = (key: string, fallback: string) => (saved.has(key) ? saved.get(key)! : fallback);

  const getters = new Map<string, () => string>();
  const groups = new Map<string, typeof textDefs>();
  for (const d of textDefs) {
    if (!groups.has(d.group)) groups.set(d.group, []);
    groups.get(d.group)!.push(d);
  }

  const fields: HTMLElement[] = [];
  const blocks = [...groups.entries()].map(([group, defs]) =>
    h(
      'fieldset',
      { class: 'text-group' },
      h('legend', {}, group),
      defs.map((d) => {
        const id = `t-${d.key.replace(/\W/g, '-')}`;
        const value = current(d.key, d.value);
        let control: HTMLElement;
        let get: () => string;
        let set: (v: string) => void;
        if (d.kind === 'bool') {
          const cb = h('input', { id, type: 'checkbox', checked: value === 'true', onchange: markDirty });
          control = cb;
          get = () => (cb.checked ? 'true' : 'false');
          set = (v) => (cb.checked = v === 'true');
        } else if (d.kind === 'select') {
          const sel = h('select', { id, onchange: markDirty }, (d.options ?? []).map((o) => h('option', { value: o.value }, o.label)));
          sel.value = value;
          control = sel;
          get = () => sel.value;
          set = (v) => (sel.value = v);
        } else if (d.kind === 'color') {
          const picker = h('input', { type: 'color', value, 'aria-label': `${d.label} picker` });
          const hex = h('input', { id, type: 'text', value, maxlength: 7, pattern: '#[0-9a-fA-F]{6}' });
          picker.addEventListener('input', () => { hex.value = picker.value; markDirty(); });
          hex.addEventListener('input', () => { if (/^#[0-9a-f]{6}$/i.test(hex.value)) picker.value = hex.value; markDirty(); });
          control = h('div', { class: 'color-field' }, picker, hex);
          get = () => (/^#[0-9a-f]{6}$/i.test(hex.value) ? hex.value.toLowerCase() : d.value);
          set = (v) => { hex.value = v; picker.value = v; };
        } else {
          const inp =
            d.kind === 'textarea'
              ? h('textarea', { id, rows: 2, oninput: markDirty })
              : h('input', { id, type: 'text', oninput: markDirty });
          inp.value = value;
          control = inp;
          get = () => inp.value;
          set = (v) => (inp.value = v);
        }
        getters.set(d.key, get);
        const reset = h(
          'button',
          {
            type: 'button',
            class: 'link-btn small',
            onclick: () => {
              set(d.value);
              markDirty();
            },
          },
          'Reset to default'
        );
        const row =
          d.kind === 'bool'
            ? h('div', { class: 'field field-bool', 'data-search': `${d.label} ${d.value}`.toLowerCase() }, h('label', { for: id }, control, d.label), d.help ? h('p', { class: 'help' }, d.help) : '')
            : h(
                'div',
                { class: 'field', 'data-search': `${d.label} ${value} ${d.value}`.toLowerCase() },
                h('label', { for: id }, d.label),
                control,
                h('p', { class: 'help' }, d.help ? `${d.help} ` : '', d.kind === 'select' || d.kind === 'color' ? '' : `Default: "${d.value}". `, reset)
              );
        fields.push(row);
        return row;
      })
    )
  );

  const search = h('input', {
    type: 'search',
    placeholder: 'Search, e.g. "button" or "Contact"',
    'aria-label': 'Search site text',
    class: 'text-search',
    oninput: () => {
      const q = search.value.trim().toLowerCase();
      for (const f of fields) f.hidden = Boolean(q) && !(f.dataset.search ?? '').includes(q);
      for (const b of blocks) b.hidden = [...b.querySelectorAll<HTMLElement>('.field')].every((f) => f.hidden);
    },
  });

  const status = h('p', { class: 'form-note', role: 'status' });
  const save = h('button', { class: 'btn', type: 'submit' }, 'Save changes');
  return h(
    'form',
    {
      class: 'edit-form',
      onsubmit: async (e: Event) => {
        e.preventDefault();
        const changed = textDefs
          .map((d) => ({ key: d.key, value: getters.get(d.key)!() }))
          .filter((r) => r.value !== current(r.key, textDefs.find((d) => d.key === r.key)!.value));
        if (!changed.length) {
          status.textContent = 'Nothing has changed.';
          return;
        }
        save.disabled = true;
        status.textContent = 'Saving…';
        const { error } = await sb.from('site_text').upsert(changed, { onConflict: 'key' });
        save.disabled = false;
        if (error) {
          status.textContent = `Could not save: ${error.message}`;
          return;
        }
        for (const r of changed) saved.set(r.key, r.value);
        dirty = false;
        status.textContent = '';
        toast(`Saved ${changed.length} change${changed.length > 1 ? 's' : ''}. Publish to put them live.`);
        refreshPublishState();
      },
    },
    h('div', { class: 'view-head' }, h('div', {}, h('h1', {}, 'Site text & settings'), h('p', { class: 'muted' }, 'Every heading, button, label and setting on the site.')), search),
    blocks,
    h('div', { class: 'form-actions' }, save, status)
  );
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------
let routing = 0;
async function route() {
  if (recovering) return;
  const run = ++routing;
  const { data } = await sb.auth.getSession();
  const session = data.session;
  if (!session) return renderLogin();

  if (!adminChecked || adminChecked.userId !== session.user.id) {
    const { data: ok, error } = await sb.rpc('is_admin');
    if (error) return renderLogin(`Could not check your access: ${error.message}`);
    adminChecked = { userId: session.user.id, ok: Boolean(ok) };
    if (ok) {
      refreshPublishState();
      startLive(ctx);
    }
  }
  if (!adminChecked.ok) return renderNotAdmin(session);

  const [, key = 'dashboard', id] = location.hash.replace(/^#/, '').split('/');
  const section = sections.find((s) => s.key === key);
  const loading = h('p', { class: 'muted' }, 'Loading…');
  shell(key, loading, session);

  let view: HTMLElement;
  try {
    if (await databaseIsEmpty()) view = importView();
    else if (key === 'dashboard') view = await dashboardView(ctx);
    else if (key === 'opportunities') view = await opportunitiesView(ctx);
    else if (key === 'messages') view = await messagesView();
    else if (key === 'text') view = await siteTextView();
    else if (!section) view = await dashboardView(ctx);
    else if (section.singleton || id) view = await formView(section, id ?? 'new');
    else view = await listView(section);
  } catch (e) {
    view = h('p', { class: 'error' }, `Something went wrong: ${errMessage(e)}`);
  }
  if (run !== routing) return;
  dirty = false;
  loading.replaceWith(view);
  document.getElementById('main')?.querySelector('h1')?.focus?.();
}

let lastHash = location.hash;
window.addEventListener('hashchange', () => {
  if (dirty && !window.confirm('You have unsaved changes. Leave this page and lose them?')) {
    history.replaceState(null, '', lastHash || '#/');
    return;
  }
  lastHash = location.hash;
  route();
});
window.addEventListener('beforeunload', (e) => {
  if (dirty) e.preventDefault();
});

sb.auth.onAuthStateChange((event) => {
  if (event === 'PASSWORD_RECOVERY') renderSetPassword();
});

// On a password-reset link, supabase-js reads the token from the URL and fires
// PASSWORD_RECOVERY, which shows the new-password form instead of the dashboard.
if (!recovering) route();
