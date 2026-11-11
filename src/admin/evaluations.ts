// Adaptive IDS enquiries: requests sent through the "Request an evaluation" form on
// adaptiveids.com, tracked as a pipeline with private notes (like Job opportunities).
import { h, icon, ago } from './dom';
import { refreshCounts, type Ctx } from './live';

type Row = Record<string, any>;

const TABLE = 'adaptive_ids_evaluation_requests';
export const ADAPTIVE_IDS_SITE = 'https://adaptiveids.com';

export const STATUSES = [
  { value: 'new', label: 'New' },
  { value: 'contacted', label: 'Contacted' },
  { value: 'call', label: 'Call booked' },
  { value: 'evaluation', label: 'In evaluation' },
  { value: 'won', label: 'Won' },
  { value: 'declined', label: 'Declined' },
  { value: 'closed', label: 'Closed' },
];
const label = (v: string) => STATUSES.find((s) => s.value === v)?.label ?? v;

const ORG_TYPES: Record<string, string> = {
  mssp: 'MSSP / MDR provider',
  sme: 'SME',
  enterprise: 'Enterprise',
  public_sector: 'Public sector',
  education: 'Education / research',
  other: 'Other',
};
const INTERESTS: Record<string, string> = {
  evaluation: 'Free 6-week evaluation',
  feedback_call: 'Feedback call',
  partnership: 'Partnership',
  other: 'Something else',
};

export async function evaluationsView(ctx: Ctx): Promise<HTMLElement> {
  const { sb } = ctx;
  const { data, error } = await sb.from(TABLE).select('*').order('created_at', { ascending: false });
  if (error) {
    return h(
      'div',
      {},
      h('h1', {}, 'Adaptive IDS enquiries'),
      h('p', { class: 'error' }, `Enquiries are not set up in the database yet: run supabase/adaptive-ids.sql. (${error.message})`)
    );
  }
  const rows: Row[] = data ?? [];
  let filter = 'open';

  const pipeline = h('div', { class: 'pipeline', role: 'group', 'aria-label': 'Filter by stage' });
  const list = h('ul', { class: 'opps' });

  const isOpen = (r: Row) => !['won', 'declined', 'closed'].includes(r.status);
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
    const { error } = await sb.from(TABLE).update(patch).eq('id', r.id);
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
      list.replaceChildren(
        h(
          'li',
          { class: 'empty' },
          h('p', {}, rows.length ? 'Nothing at this stage.' : 'No enquiries yet. When someone uses the form on adaptiveids.com, it appears here and in your notifications.')
        )
      );
      return;
    }
    list.replaceChildren(
      ...shown.map((r) => {
        const status = h(
          'select',
          {
            'aria-label': `Stage for ${r.organisation}`,
            onchange: async () => {
              const prev = r.status;
              if (!(await save(r, { status: status.value }, `Moved to ${label(status.value)}`))) status.value = prev;
              drawPipeline();
              drawList();
            },
          },
          STATUSES.map((s) => h('option', { value: s.value, selected: s.value === r.status }, s.label))
        );
        const notes = h('textarea', {
          rows: 3,
          placeholder: 'Private notes: call dates, success criteria agreed, data available, next steps…',
          'aria-label': `Notes for ${r.organisation}`,
        });
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
          const { error } = await sb.from(TABLE).delete().eq('id', r.id);
          if (error) return ctx.toast(`Could not delete: ${error.message}`, 'error');
          rows.splice(rows.indexOf(r), 1);
          ctx.toast('Enquiry deleted');
          refreshCounts(ctx);
          drawPipeline();
          drawList();
        });
        const facts = [
          ['Interested in', INTERESTS[r.interest] ?? r.interest],
          ['Organisation type', ORG_TYPES[r.organisation_type] ?? r.organisation_type],
          ['Role', r.role],
        ].filter(([, v]) => v);
        const first = String(r.name ?? '').split(' ')[0] || 'there';
        const reply =
          `mailto:${r.email}?subject=${encodeURIComponent(`Adaptive IDS: your ${(INTERESTS[r.interest] ?? 'enquiry').toLowerCase()} request`)}` +
          `&body=${encodeURIComponent(
            `Hi ${first},\n\nThank you for your interest in Adaptive IDS. I'd be glad to set up a short call to understand your network, how you export flow data today, and what a successful evaluation would look like for ${r.organisation}.\n\nWould any of these times suit you?\n\n`
          )}`;
        return h(
          'li',
          { class: `opp status-${r.status}` },
          h(
            'div',
            { class: 'opp-head' },
            h('span', { class: 'opp-ico' }, icon('shield', 18)),
            h('div', {}, h('h2', {}, r.organisation), h('p', { class: 'opp-company' }, INTERESTS[r.interest] ?? r.interest)),
            h('span', { class: `stage-pill stage-${r.status}` }, label(r.status))
          ),
          h('dl', { class: 'opp-facts' }, facts.map(([k, v]) => h('div', {}, h('dt', {}, k), h('dd', {}, v)))),
          h(
            'p',
            { class: 'opp-contact' },
            h('strong', {}, r.name),
            ' · ',
            h('a', { href: `mailto:${r.email}` }, r.email),
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

  const copy = (text: string) => async () => {
    try {
      await navigator.clipboard.writeText(text);
      ctx.toast('Link copied');
    } catch {
      ctx.toast('Copy failed. Select the link and copy it by hand.', 'error');
    }
  };
  const formUrl = `${ADAPTIVE_IDS_SITE}/#evaluation`;

  return h(
    'div',
    {},
    h(
      'div',
      { class: 'view-head' },
      h(
        'div',
        {},
        h('h1', { tabindex: -1 }, 'Adaptive IDS enquiries'),
        h('p', { class: 'muted' }, 'Evaluation, feedback-call and partnership requests from adaptiveids.com. Reply within two working days, as the site promises, then move each one through the stages.')
      )
    ),
    pipeline,
    list,
    h(
      'section',
      { class: 'share-card' },
      h('h2', {}, 'Share the request form'),
      h('p', { class: 'muted' }, 'Put this link in outreach emails and LinkedIn posts. Requests are kept for 24 months at most, as the adaptiveids.com privacy notice says; delete older ones here.'),
      h('div', { class: 'row' }, h('code', {}, formUrl), h('button', { class: 'btn btn-quiet btn-sm', type: 'button', onclick: copy(formUrl) }, 'Copy link')),
      h('div', { class: 'row' }, h('a', { class: 'btn btn-quiet btn-sm', href: ADAPTIVE_IDS_SITE, target: '_blank', rel: 'noopener noreferrer' }, 'Open adaptiveids.com'))
    )
  );
}
