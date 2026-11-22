// Account security: two-step sign-in (authenticator app codes), automatic sign-out
// when idle, and signing out every device.
import type { SupabaseClient } from '@supabase/supabase-js';
import { h, icon, ago } from './dom';

type Row = Record<string, any>;

const IDLE_KEY = 'admin:idle-minutes';
export function idleMinutes(): number {
  try {
    const v = Number(localStorage.getItem(IDLE_KEY));
    return [15, 30, 60, 240].includes(v) ? v : 30;
  } catch {
    return 30;
  }
}

/** Signs out after a period without any mouse, keyboard or touch activity. */
export function startIdleTimer(onIdle: () => void) {
  let last = Date.now();
  const bump = () => (last = Date.now());
  for (const ev of ['pointerdown', 'keydown', 'wheel', 'touchstart', 'visibilitychange']) addEventListener(ev, bump, { passive: true });
  setInterval(() => {
    if (Date.now() - last > idleMinutes() * 60_000) {
      last = Date.now();
      onIdle();
    }
  }, 30_000);
}

/** Second step of sign-in: a 6-digit code from the authenticator app. */
export function mfaChallenge(sb: SupabaseClient, app: HTMLElement, onDone: () => void, onCancel: () => void) {
  const code = h('input', { id: 'mfa-code', inputmode: 'numeric', autocomplete: 'one-time-code', pattern: '[0-9]{6}', maxlength: 6, required: true });
  const status = h('p', { class: 'form-note', role: 'status' });
  const submit = h('button', { class: 'btn', type: 'submit' }, 'Verify');
  app.replaceChildren(
    h(
      'form',
      {
        class: 'auth-card',
        onsubmit: async (e: Event) => {
          e.preventDefault();
          submit.disabled = true;
          status.textContent = 'Checking…';
          const { data } = await sb.auth.mfa.listFactors();
          const factor = data?.totp?.find((f) => f.status === 'verified');
          if (!factor) {
            submit.disabled = false;
            status.textContent = 'No authenticator is set up for this account.';
            return;
          }
          const { error } = await sb.auth.mfa.challengeAndVerify({ factorId: factor.id, code: code.value.trim() });
          submit.disabled = false;
          if (error) {
            status.textContent = 'That code did not work. Check the time on your phone and try the newest code.';
            code.select();
            return;
          }
          onDone();
        },
      },
      h('h1', {}, 'Two-step sign-in'),
      h('p', { class: 'muted' }, 'Enter the 6-digit code from your authenticator app.'),
      h('div', { class: 'field' }, h('label', { for: 'mfa-code' }, 'Code'), code),
      submit,
      h('button', { type: 'button', class: 'link-btn', onclick: onCancel }, 'Sign out'),
      status
    )
  );
  code.focus();
}

export async function securityView(sb: SupabaseClient, toast: (m: string, k?: 'ok' | 'error') => void, signOut: () => void): Promise<HTMLElement> {
  const root = h('div', { class: 'alerts' });
  const { data: userData } = await sb.auth.getUser();
  const user = userData.user;
  const mfaSlot = h('div', {});

  async function drawMfa() {
    const { data, error } = await sb.auth.mfa.listFactors();
    if (error) {
      mfaSlot.replaceChildren(h('p', { class: 'error' }, `Could not read your sign-in methods: ${error.message}`));
      return;
    }
    const verified = (data?.totp ?? []).filter((f) => f.status === 'verified');
    if (verified.length) {
      mfaSlot.replaceChildren(
        h('p', { class: 'health-summary ok' }, icon('check', 18), 'Two-step sign-in is on'),
        h('p', { class: 'muted' }, 'Every sign-in asks for a code from your authenticator app, and the database refuses admin changes without it.'),
        h(
          'ul',
          { class: 'feed' },
          verified.map((f: Row) => {
            const remove = h('button', { class: 'btn btn-quiet btn-sm', type: 'button' }, 'Remove');
            let armed = false;
            remove.addEventListener('click', async () => {
              if (!armed) {
                armed = true;
                remove.textContent = 'Click again to turn off two-step sign-in';
                setTimeout(() => {
                  armed = false;
                  remove.textContent = 'Remove';
                }, 5000);
                return;
              }
              const { error } = await sb.auth.mfa.unenroll({ factorId: f.id });
              if (error) return toast(`Could not remove it: ${error.message}`, 'error');
              toast('Two-step sign-in turned off');
              drawMfa();
            });
            return h(
              'li',
              {},
              h('span', { class: 'feed-ico' }, icon('phone', 16)),
              h('span', { class: 'feed-main' }, h('strong', {}, f.friendly_name || 'Authenticator app'), h('span', { class: 'muted' }, `Added ${ago(f.created_at)}`)),
              remove
            );
          })
        )
      );
      return;
    }
    // Clean up half-finished setups, then offer to start
    for (const f of data?.all ?? []) if (f.status !== 'verified') await sb.auth.mfa.unenroll({ factorId: f.id });
    const start = h('button', { class: 'btn', type: 'button' }, icon('phone', 16), ' Turn on two-step sign-in');
    start.addEventListener('click', enroll);
    mfaSlot.replaceChildren(
      h('p', { class: 'health-summary warn' }, icon('alert', 18), 'Two-step sign-in is off'),
      h('p', { class: 'muted' }, 'Right now your password alone opens the admin panel. With two-step sign-in, someone who learns your password still cannot get in or change anything without your phone.'),
      h('div', { class: 'row' }, start)
    );
  }

  async function enroll() {
    const { data, error } = await sb.auth.mfa.enroll({ factorType: 'totp', friendlyName: `Authenticator ${new Date().toLocaleDateString('en-GB')}` });
    if (error || !data) return toast(`Could not start: ${error?.message}`, 'error');
    const code = h('input', { id: 'mfa-new', inputmode: 'numeric', autocomplete: 'one-time-code', pattern: '[0-9]{6}', maxlength: 6, required: true });
    const status = h('p', { class: 'form-note', role: 'status' });
    mfaSlot.replaceChildren(
      h(
        'form',
        {
          class: 'edit-form',
          onsubmit: async (e: Event) => {
            e.preventDefault();
            const { error } = await sb.auth.mfa.challengeAndVerify({ factorId: data.id, code: code.value.trim() });
            if (error) {
              status.textContent = 'That code did not work. Use the newest code shown in the app.';
              return;
            }
            toast('Two-step sign-in is on');
            drawMfa();
          },
        },
        h(
          'ol',
          { class: 'steps' },
          h('li', {}, 'Open an authenticator app on your phone (Google Authenticator, Microsoft Authenticator, 1Password, Authy…).'),
          h('li', {}, 'Scan this QR code, or type the setup key below.'),
          h('li', {}, 'Enter the 6-digit code it shows.')
        ),
        h('img', { src: data.totp.qr_code, alt: 'QR code for your authenticator app', width: 200, height: 200, class: 'qr' }),
        h('p', { class: 'small muted' }, 'Setup key: ', h('code', { class: 'token' }, data.totp.secret)),
        h('div', { class: 'field' }, h('label', { for: 'mfa-new' }, 'Code from the app'), code),
        h(
          'div',
          { class: 'form-actions' },
          h('button', { class: 'btn', type: 'submit' }, 'Confirm'),
          h(
            'button',
            {
              class: 'btn btn-quiet',
              type: 'button',
              onclick: async () => {
                await sb.auth.mfa.unenroll({ factorId: data.id });
                drawMfa();
              },
            },
            'Cancel'
          ),
          status
        )
      )
    );
    code.focus();
  }

  const idle = h(
    'select',
    {
      id: 'idle',
      onchange: () => {
        try {
          localStorage.setItem(IDLE_KEY, idle.value);
        } catch {}
        toast('Saved');
      },
    },
    [15, 30, 60, 240].map((m) => h('option', { value: String(m), selected: m === idleMinutes() }, m < 60 ? `${m} minutes` : `${m / 60} hour${m > 60 ? 's' : ''}`))
  );
  const everywhere = h('button', { class: 'btn btn-quiet', type: 'button' }, 'Sign out on every device');
  everywhere.addEventListener('click', async () => {
    await sb.auth.signOut({ scope: 'global' });
    signOut();
  });

  const card = (title: string, ...body: (Node | string)[]) => h('section', { class: 'dash-card' }, h('header', { class: 'dash-card-head' }, h('h2', {}, title)), ...body);
  root.append(
    h('div', { class: 'view-head' }, h('div', {}, h('h1', { tabindex: -1 }, 'Security'), h('p', { class: 'muted' }, 'Protect the admin panel.'))),
    h(
      'div',
      { class: 'writer-grid' },
      card('Two-step sign-in', mfaSlot),
      card(
        'Sessions',
        h('p', { class: 'muted' }, `Signed in as ${user?.email ?? ''}. Last sign-in ${user?.last_sign_in_at ? ago(user.last_sign_in_at) : 'unknown'}.`),
        h('div', { class: 'field' }, h('label', { for: 'idle' }, 'Sign out automatically after no activity for'), idle),
        h('div', { class: 'row' }, everywhere)
      ),
      card(
        'Good habits',
        h(
          'ul',
          { class: 'steps' },
          h('li', {}, 'Use a long password you use nowhere else (a password manager helps).'),
          h('li', {}, 'Keep two-step sign-in on. If you change phones, add the new one before removing the old.'),
          h('li', {}, 'Only sign in at personalportfolio.website/admin/. The site never asks for your password by email.')
        )
      )
    )
  );
  drawMfa();
  return root;
}
