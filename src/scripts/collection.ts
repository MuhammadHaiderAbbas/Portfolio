// Search, filters and grid/list view for any listing marked with [data-collection].
// The chosen view is remembered per listing; the filter and search are kept in the address
// (?c=…&q=…) so filtered pages can be shared. Without JavaScript every item is shown.

for (const root of document.querySelectorAll<HTMLElement>('[data-collection]')) setup(root);

function setup(root: HTMLElement) {
  const name = root.dataset.collection!;
  const toolbar = root.querySelector<HTMLElement>('.toolbar');
  const list = root.querySelector<HTMLElement>('[data-items]');
  if (!toolbar || !list) return;
  toolbar.hidden = false;

  const items = [...list.children] as HTMLElement[];
  const search = toolbar.querySelector<HTMLInputElement>('input[type=search]');
  const filterBtns = [...toolbar.querySelectorAll<HTMLButtonElement>('[data-filter]')];
  const viewBtns = [...toolbar.querySelectorAll<HTMLButtonElement>('[data-view]')];
  const note = root.querySelector<HTMLElement>('[data-note]');
  const empty = root.querySelector<HTMLElement>('[data-empty]');
  const template = note?.dataset.template ?? 'Showing {shown} of {total}';

  const params = new URL(location.href).searchParams;
  let filter = params.get('c') ?? '';
  if (!filterBtns.some((b) => b.dataset.filter === filter)) filter = '';
  let query = params.get('q') ?? '';
  if (search) search.value = query;

  let view = 'grid';
  try {
    view = localStorage.getItem(`view:${name}`) || root.dataset.defaultView || 'grid';
  } catch {}

  const apply = (push: boolean) => {
    const q = query.trim().toLowerCase();
    let shown = 0;
    for (const el of items) {
      const keys = (el.dataset.keys ?? '').split('|');
      const ok = (!filter || keys.includes(filter)) && (!q || (el.dataset.text ?? el.textContent ?? '').toLowerCase().includes(q));
      el.hidden = !ok;
      if (ok) shown++;
    }
    for (const b of filterBtns) b.setAttribute('aria-pressed', String(b.dataset.filter === filter));
    for (const b of viewBtns) b.setAttribute('aria-pressed', String(b.dataset.view === view));
    list.classList.toggle('list', view === 'list');
    if (note) {
      note.textContent = template.replace('{shown}', String(shown)).replace('{total}', String(items.length));
      note.hidden = !filter && !q;
    }
    if (empty) empty.hidden = shown > 0;
    if (push) {
      const url = new URL(location.href);
      filter ? url.searchParams.set('c', filter) : url.searchParams.delete('c');
      q ? url.searchParams.set('q', query.trim()) : url.searchParams.delete('q');
      history.replaceState(null, '', url);
    }
  };

  toolbar.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('button');
    if (!btn) return;
    if (btn.dataset.filter !== undefined) {
      filter = btn.dataset.filter;
      apply(true);
    } else if (btn.dataset.view) {
      view = btn.dataset.view;
      try {
        localStorage.setItem(`view:${name}`, view);
      } catch {}
      apply(false);
    }
  });
  let timer = 0;
  search?.addEventListener('input', () => {
    clearTimeout(timer);
    timer = window.setTimeout(() => {
      query = search.value;
      apply(true);
    }, 120);
  });
  apply(false);
}
