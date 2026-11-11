// Email alerts: where to send them, which events, the Resend key, and a test email.
import { h, icon, ago } from './dom';
import type { Ctx } from './live';

type Row = Record<string, any>;

export async function alertsView(ctx: Ctx): Promise<HTMLElement> {
  const { sb } = ctx;
  const [settings, secrets, log] = await Promise.all([
    sb.from('alert_settings').select('*').eq('id', 1).maybeSingle(),
    sb.rpc('secret_status'),
    sb.from('email_log').select('*').order('created_at', { ascending: false }).limit(10),
  ]);
  if (settings.error) {
    return h('div', {}, h('h1', {}, 'Email alerts'), h('p', { class: 'error' }, `Email alerts are not set up in the database yet: run supabase/autopilot.sql. (${settings.error.message})`));
  }
  const s: Row = settings.data ?? {};
  const sec: Row = (secrets.data as Row) ?? {};

  const email = h('input', { id: 'al-email', type: 'email', value: s.email ?? '', autocomplete: 'email' });
  const toggle = (name: string, label: string, help: string) => {
    const box = h('input', { type: 'checkbox', id: `al-${name}`, checked: Boolean(s[name]) });
    return { name, box, el: h('div', { class: 'field field-bool' }, h('label', { for: `al-${name}` }, box, ' ', label), h('p', { class: 'help' }, help)) };
  };
  const toggles = [
    toggle('enabled', 'Send email alerts', 'Master switch for every email below.'),
    toggle('on_articles', 'Articles', 'A new article is ready (with Publish now / Hold buttons) and when one goes live.'),
    toggle('on_opportunities', 'Job opportunities', 'A company sends a role through the Hire me page.'),
    toggle('on_evaluations', 'Adaptive IDS enquiries', 'Someone requests an evaluation, call or partnership on adaptiveids.com.'),
    toggle('on_messages', 'Messages', 'Someone uses the contact form.'),
    toggle('on_problems', 'Problems', 'The AI writer fails, a deploy fails, or a site check finds an error.'),
  ];
  const status = h('p', { class: 'form-note', role: 'status' });

  const save = h(
    'form',
    {
      class: 'edit-form',
      onsubmit: async (e: Event) => {
        e.preventDefault();
        const patch: Row = { email: email.value.trim(), updated_at: new Date().toISOString() };
        for (const t of toggles) patch[t.name] = t.box.checked;
        const { error } = await sb.from('alert_settings').update(patch).eq('id', 1);
        status.textContent = error ? `Could not save: ${error.message}` : 'Saved.';
        if (!error) ctx.toast('Email settings saved');
      },
    },
    h('div', { class: 'field' }, h('label', { for: 'al-email' }, 'Send alerts to'), email, h('p', { class: 'help' }, 'With Resend’s free plan and no domain set up, this must be the email address you signed up to Resend with.')),
    toggles.map((t) => t.el),
    h('div', { class: 'form-actions' }, h('button', { class: 'btn', type: 'submit' }, 'Save'), status)
  );

  // Resend key
  const keyInput = h('input', { id: 'al-key', type: 'password', autocomplete: 'off', placeholder: sec.resend_api_key ? 'Saved. Paste a new key to replace it.' : 're_…' });
  const fromInput = h('input', { id: 'al-from', type: 'text', value: sec.alert_from ?? '', placeholder: 'Portfolio alerts <onboarding@resend.dev>' });
  const keyStatus = h('p', { class: 'form-note', role: 'status' });
  const keyForm = h(
    'form',
    {
      class: 'edit-form',
      onsubmit: async (e: Event) => {
        e.preventDefault();
        const key = keyInput.value.trim();
        if (key) {
          if (!/^re_[A-Za-z0-9_]{10,}$/.test(key)) {
            keyStatus.textContent = 'That does not look like a Resend API key (it starts with re_).';
            return;
          }
          const { error } = await sb.rpc('set_secret', { p_name: 'resend_api_key', p_value: key });
          if (error) return (keyStatus.textContent = `Could not save the key: ${error.message}`);
        }
        if (fromInput.value.trim() !== (sec.alert_from ?? '')) {
          const { error } = await sb.rpc('set_secret', { p_name: 'alert_from', p_value: fromInput.value.trim() });
          if (error) return (keyStatus.textContent = `Could not save the sender: ${error.message}`);
        }
        keyInput.value = '';
        sec.resend_api_key = sec.resend_api_key || Boolean(key);
        keyInput.placeholder = 'Saved. Paste a new key to replace it.';
        keyStatus.textContent = 'Saved securely in Supabase Vault.';
        ctx.toast('Email service saved');
      },
    },
    h(
      'ol',
      { class: 'steps' },
      h('li', {}, 'Create a free account at ', h('a', { href: 'https://resend.com/signup', target: '_blank', rel: 'noopener' }, 'resend.com'), ' with the email address above.'),
      h('li', {}, 'Open ', h('a', { href: 'https://resend.com/api-keys', target: '_blank', rel: 'noopener' }, 'API Keys'), ', create a key with "Sending access", and paste it here.'),
      h('li', {}, 'Optional: verify personalportfolio.website under Resend → Domains (it gives you DNS records for Namecheap), then set the sender below, e.g. ', h('code', {}, 'Portfolio <alerts@personalportfolio.website>'), '. Then alerts can go to any address.')
    ),
    h('div', { class: 'field' }, h('label', { for: 'al-key' }, 'Resend API key ', sec.resend_api_key ? h('span', { class: 'pill' }, 'saved') : ''), keyInput),
    h('div', { class: 'field' }, h('label', { for: 'al-from' }, 'Sender (optional)'), fromInput),
    h('div', { class: 'form-actions' }, h('button', { class: 'btn', type: 'submit' }, 'Save email service'), keyStatus)
  );

  // Test email
  const testStatus = h('p', { class: 'form-note', role: 'status' });
  const testBtn = h('button', { class: 'btn btn-quiet', type: 'button' }, icon('mail', 16), ' Send a test email');
  testBtn.addEventListener('click', async () => {
    testBtn.disabled = true;
    testStatus.textContent = 'Sending…';
    const { data, error } = await sb.rpc('send_test_email');
    if (error) {
      testBtn.disabled = false;
      testStatus.textContent = error.message;
      return;
    }
    const id = (data as Row).request_id;
    for (let i = 0; i < 12; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      const st = (await sb.rpc('email_status', { p_request_id: id })).data as Row;
      if (st?.state === 'sent') {
        testStatus.textContent = `Sent. Check ${email.value || 'your inbox'} (and the spam folder the first time).`;
        break;
      }
      if (st?.state === 'failed') {
        testStatus.textContent = `Resend refused it (${st.status_code}): ${st.error || ''}`;
        break;
      }
    }
    testBtn.disabled = false;
  });

  const logList = (log.data ?? []).length
    ? h('ul', { class: 'feed' }, (log.data ?? []).map((m: Row) => h('li', {}, h('span', { class: 'feed-ico' }, icon('mail', 14)), h('span', { class: 'feed-main' }, h('span', {}, m.subject)), h('time', { class: 'feed-time', datetime: m.created_at }, ago(m.created_at)))))
    : h('p', { class: 'muted dash-empty' }, 'No emails sent yet.');

  const card = (title: string, ...body: Node[]) => h('section', { class: 'dash-card' }, h('header', { class: 'dash-card-head' }, h('h2', {}, title)), ...body);
  return h(
    'div',
    { class: 'alerts' },
    h('div', { class: 'view-head' }, h('div', {}, h('h1', { tabindex: -1 }, 'Email alerts'), h('p', { class: 'muted' }, 'Get an email when something important happens on your site.'))),
    h(
      'div',
      { class: 'writer-grid' },
      card('Where and what', save),
      card('Email service (Resend, free)', keyForm),
      card('Check it works', h('div', { class: 'row' }, testBtn), testStatus, h('h3', {}, 'Recent emails'), logList)
    )
  );
}
