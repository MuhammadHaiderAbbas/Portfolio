// Job opportunities sent by companies from the "Hire me" page, tracked as a simple pipeline.
import { h, icon, ago } from './dom';
import { refreshCounts, type Ctx } from './live';

type Row = Record<string, any>;

export const STATUSES = [
  { value: 'new', label: 'New' },
  { value: 'reviewing', label: 'Reviewing' },
  { value: 'interview', label: 'Interview' },
  { value: 'offer', label: 'Offer' },
  { value: 'declined', label: 'Declined' },
  { value: 'closed', label: 'Closed' },
];
const label = (v: string) => STATUSES.find((s) => s.value === v)?.label ?? v;

export async function opportunitiesView(ctx: Ctx): Promise<HTMLElement> {
  const { sb } = ctx;
  const { data, error } = await sb.from('opportunities').select('*').order('created_at', { ascending: false });
  if (error) return h('div', {}, h('h1', {}, 'Job opportunities'), h('p', { class: 'error' }, error.message));
  const rows: Row[] = data ?? [];
  let filter = 'open';

  const pipeline = h('div', { class: 'pipeline', role: 'group', 'aria-label': 'Filter by stage' });
  const list = h('ul', { class: 'opps' });

  const isOpen = (r: Row) => !['declined', 'closed'].includes(r.status);
  const drawPipeline = () => {
    const tile = (value: string, text: string, n: number) =>
      h(
        'button',
        {
          type: 'button',
          class: `stage stage-${value}`,
          'aria-pressed': String(filter === value),
          onclick: () => {
            filter = value;
            drawPipeline();
            drawList();
          },
        },
        h('strong', {}, String(n)),
        h('span', {}, text)
      );
    pipeline.replaceChildren(
      tile('open', 'Open', rows.filter(isOpen).length),
      ...STATUSES.map((s) => tile(s.value, s.label, rows.filter((r) => r.status === s.value).length)),
      tile('all', 'All', rows.length)
    );
  };

  const save = async (r: Row, patch: Row, note: string) => {
    const { error } = await sb.from('opportunities').update(patch).eq('id', r.id);
    if (error) {
      ctx.toast(`Could not save: ${error.message}`, 'error');
      return false;
    }
    Object.assign(r, patch);
    ctx.toast(note);
    refreshCounts(ctx);
    return true;
  };

  const drawList = () => {
    const shown = rows.filter((r) => (filter === 'all' ? true : filter === 'open' ? isOpen(r) : r.status === filter));
    if (!shown.length) {
      list.replaceChildren(h('li', { class: 'empty' }, h('p', {}, rows.length ? 'Nothing at this stage.' : 'No opportunities yet. When a company fills in the Hire me form, it appears here and in your notifications.')));
      return;
    }
    list.replaceChildren(
      ...shown.map((r) => {
        const status = h(
          'select',
          {
            'aria-label': `Stage for ${r.company}`,
            onchange: async () => {
              const prev = r.status;
              if (!(await save(r, { status: status.value }, `Moved to ${label(status.value)}`))) status.value = prev;
              drawPipeline();
              drawList();
            },
          },
          STATUSES.map((s) => h('option', { value: s.value, selected: s.value === r.status }, s.label))
        );
        const notes = h('textarea', { rows: 3, placeholder: 'Private notes: interview dates, contacts, next steps…', 'aria-label': `Notes for ${r.company}` });
        notes.value = r.notes ?? '';
        const saveNotes = h(
          'button',
          { class: 'btn btn-quiet btn-sm', type: 'button', onclick: () => save(r, { notes: notes.value }, 'Notes saved') },
          'Save notes'
        );
        const del = h('button', { class: 'btn btn-quiet btn-sm', type: 'button' }, 'Delete');
        let armed = false;
        del.addEventListener('click', async () => {
          if (!armed) {
            armed = true;
            del.textContent = 'Click again to delete';
            setTimeout(() => {
              armed = false;
              del.textContent = 'Delete';
            }, 4000);
            return;
          }
          const { error } = await sb.from('opportunities').delete().eq('id', r.id);
          if (error) return ctx.toast(`Could not delete: ${error.message}`, 'error');
          rows.splice(rows.indexOf(r), 1);
          ctx.toast('Opportunity deleted');
          refreshCounts(ctx);
          drawPipeline();
          drawList();
        });
        const facts = [
          ['Type', r.job_type],
          ['Work mode', r.work_mode],
          ['Location', r.location],
          ['Salary', r.salary],
        ].filter(([, v]) => v);
        const reply = `mailto:${r.email}?subject=${encodeURIComponent(`Re: ${r.role_title} at ${r.company}`)}&body=${encodeURIComponent(`Hi ${r.contact_name.split(' ')[0]},\n\nThank you for getting in touch about the ${r.role_title} role.\n\n`)}`;
        return h(
          'li',
          { class: `opp status-${r.status}` },
          h(
            'div',
            { class: 'opp-head' },
            h('span', { class: 'opp-ico' }, icon('briefcase', 18)),
            h('div', {}, h('h2', {}, r.role_title), h('p', { class: 'opp-company' }, r.company)),
            h('span', { class: `stage-pill stage-${r.status}` }, label(r.status))
          ),
          h('dl', { class: 'opp-facts' }, facts.map(([k, v], i) => h('div', {}, h('dt', {}, k), h('dd', { class: i < 2 ? 'cap' : undefined }, v)))),
          h(
            'p',
            { class: 'opp-contact' },
            h('strong', {}, r.contact_name),
            ' · ',
            h('a', { href: `mailto:${r.email}` }, r.email),
            r.phone ? [' · ', h('a', { href: `tel:${r.phone.replace(/\s/g, '')}` }, r.phone)] : '',
            r.job_url ? [' · ', h('a', { href: r.job_url, target: '_blank', rel: 'noopener noreferrer' }, 'Job advert')] : '',
            h('time', { datetime: r.created_at, title: new Date(r.created_at).toLocaleString('en-GB') }, ` · received ${ago(r.created_at)}`)
          ),
          r.message ? h('p', { class: 'msg-body' }, r.message) : '',
          h('div', { class: 'opp-notes' }, notes),
          h('div', { class: 'row' }, h('a', { class: 'btn btn-sm', href: reply }, 'Reply by email'), h('label', { class: 'stage-select' }, 'Stage ', status), saveNotes, del)
        );
      })
    );
  };

  drawPipeline();
  drawList();

  const hireUrl = new URL(ctx.site('/hire/'), location.origin).href;
  const example = `${hireUrl}?company=Acme&role=Security%20Analyst`;
  const copy = (text: string) => async () => {
    try {
      await navigator.clipboard.writeText(text);
      ctx.toast('Link copied');
    } catch {
      ctx.toast('Copy failed. Select the link and copy it by hand.', 'error');
    }
  };

  return h(
    'div',
    {},
    h('div', { class: 'view-head' }, h('div', {}, h('h1', { tabindex: -1 }, 'Job opportunities'), h('p', { class: 'muted' }, 'Roles companies sent through your Hire me page. Move each one through the stages and keep private notes.'))),
    pipeline,
    list,
    h(
      'section',
      { class: 'share-card' },
      h('h2', {}, 'Share your Hire me page'),
      h('p', { class: 'muted' }, 'Put this link on your CV, LinkedIn or email signature. Recruiters can also send a pre-filled link, like the example.'),
      h('div', { class: 'row' }, h('code', {}, hireUrl), h('button', { class: 'btn btn-quiet btn-sm', type: 'button', onclick: copy(hireUrl) }, 'Copy link')),
      h('div', { class: 'row' }, h('code', {}, example), h('button', { class: 'btn btn-quiet btn-sm', type: 'button', onclick: copy(example) }, 'Copy example'))
    )
  );
}
