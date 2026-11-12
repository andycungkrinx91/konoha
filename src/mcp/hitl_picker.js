'use strict';

/**
 * src/mcp/hitl_picker.js — Interactive picker binding for HITL gates.
 *
 * A gate is a decision, not a paragraph. Printing "1. approve / 2. reject" and
 * asking the human to retype a label makes the human do the client's UI work,
 * and it loses the answer to typos. Every harness Konoha deploys into already
 * has some way to ask a structured question; this module names that mechanism
 * per client so a gate payload can hand the client a control instead of prose.
 *
 * Transports:
 *   native_tool — the harness ships a question tool; `tool` names it and `call`
 *                 carries the exact arguments to pass.
 *   web_picker  — no question tool; the Konoha web server renders a real HTML
 *                 form (option cards + custom-instruction field) that posts the
 *                 verdict itself.
 *
 * Only mechanisms that exist are named. A harness with no question tool gets the
 * web form rather than a guessed tool name that would fail at call time.
 *
 * The binding is advisory data for the client; the authoritative verdict path
 * stays `sannin({ task_dir, choice, refinement })` for every transport, so a
 * client that ignores the picker still cannot bypass the gate.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
// `src/mcp` is mirrored flat into `~/.konoha/mcp`, so `../../bin` is only right
// in the repo and in `~/.konoha/src/mcp`; the flat copy needs `../bin`.
const SKILLS_DB_DIR = (() => {
  for (const candidate of ['../../bin/lib/paths', '../bin/lib/paths']) {
    try {
      return require(candidate).SKILLS_DB_DIR;
    } catch (_) { /* candidate unavailable in this layout */ }
  }
  throw new Error('bin/lib/paths is unreachable; the install is incomplete — re-run `konoha upgrade`.');
})();

/**
 * The session token the web server persists (mode 0600). It is the secret a gate
 * capability is signed with — never something the picker URL carries, because a
 * gate payload is model context and may be logged.
 */
function readSessionToken() {
  try {
    const token = fs.readFileSync(path.join(SKILLS_DB_DIR, 'web_token'), 'utf8').trim();
    return token || null;
  } catch (_) {
    return null;
  }
}

/**
 * A gate capability is an HMAC of the task directory, so one gate's URL cannot
 * approve another and the signature reveals nothing about the session token it
 * was derived from. That is what lets the picker page authenticate without a
 * cookie: a human opening a link has no jar, and handing them the master token
 * would put it in every transcript.
 */
function signTaskDir(taskDir, secret) {
  const key = secret || readSessionToken();
  if (!key || !taskDir) return null;
  return crypto.createHmac('sha256', key).update(String(taskDir)).digest('hex').slice(0, 32);
}

/**
 * `secrets` is a candidate list, so a link minted just before the server rotated
 * its token still opens during the rotation grace window instead of becoming a
 * dead link the human cannot act on.
 */
function verifyTaskDirSignature(taskDir, signature, secrets) {
  if (!signature) return false;
  const candidates = (Array.isArray(secrets) ? secrets : [secrets]).filter(Boolean);
  const supplied = Buffer.from(String(signature), 'utf8');
  return candidates.some((secret) => {
    const expected = signTaskDir(taskDir, secret);
    if (!expected) return false;
    const want = Buffer.from(expected, 'utf8');
    return want.length === supplied.length && crypto.timingSafeEqual(want, supplied);
  });
}

const PICKER_BINDINGS = Object.freeze({
  // Harnesses with a documented structured-question tool.
  omp: { transport: 'native_tool', tool: 'ask' },
  claude: { transport: 'native_tool', tool: 'AskUserQuestion' },
  // Harnesses Konoha drives through a file/config surface with no question tool
  // of its own; the Konoha picker page is the control.
  antigravity: { transport: 'web_picker' },
  cursor: { transport: 'web_picker' },
  codex: { transport: 'web_picker' },
  opencode: { transport: 'web_picker' },
  commandcode: { transport: 'web_picker' },
  pi: { transport: 'web_picker' },
  gemini: { transport: 'web_picker' }
});

const FALLBACK_BINDING = Object.freeze({ transport: 'web_picker' });

const VERDICT_ENDPOINT = '/api/v1/hitl/verdict';

function resolvePickerBinding(client) {
  const key = String(client || '').trim().toLowerCase();
  return PICKER_BINDINGS[key] || FALLBACK_BINDING;
}

/**
 * The arguments a harness needs to raise its own control. For `native_tool`
 * this is the option list in the shape a question tool expects; the free-text
 * escape hatch is a separate option so "type your own instruction" stays
 * reachable without the human editing the prompt.
 */
function buildNativeToolCall(prompt) {
  return {
    questions: [
      {
        question: prompt.question,
        header: prompt.gate_name,
        multiSelect: false,
        options: (prompt.options || []).map((opt) => ({
          label: opt.label,
          description: opt.description
        }))
      }
    ]
  };
}

function buildPickerUrl({ baseUrl, taskDir }) {
  const root = String(baseUrl || '').replace(/\/+$/, '');
  const query = new URLSearchParams();
  if (taskDir) query.set('task_dir', taskDir);
  const signature = signTaskDir(taskDir);
  if (signature) query.set('sig', signature);
  const suffix = query.toString();
  return `${root}/api/v1/hitl/picker${suffix ? `?${suffix}` : ''}`;
}

/**
 * The `picker` block attached to every gate payload. `transport` is always
 * present; the transport-specific fields are present only when they apply, so a
 * client reads one field and knows what to do.
 */
function buildPickerBinding(prompt, options = {}) {
  const binding = resolvePickerBinding(options.client);
  const picker = {
    transport: binding.transport,
    submit_tool: 'sannin',
    submit_args: ['task_dir', 'choice', 'refinement'],
    custom_choice_label: prompt.refinement_option || null
  };

  if (binding.transport === 'native_tool') {
    picker.tool = binding.tool;
    picker.call = buildNativeToolCall(prompt);
  } else {
    picker.url = buildPickerUrl(options);
    picker.open_when = 'A gate is pending and this harness has no question tool.';
  }

  picker.instruction = binding.transport === 'native_tool'
    ? `Call ${binding.tool} with picker.call; do not print a numbered list for the human to retype.`
    : 'Raise the picker; do not print a numbered list for the human to retype.';

  return picker;
}

function escapeHtml(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Self-contained picker page. No external assets, no inline event handlers: the
 * script is served with the page and posts the verdict with the CSRF header the
 * API requires, so the page works from a browser opened by any harness.
 */
function renderPickerPage(prompt, options = {}) {
  const choices = prompt.options || [];
  const taskDir = options.taskDir || '';
  const signature = options.signature || signTaskDir(taskDir) || '';
  const gateName = prompt.gate_name || prompt.title || 'HITL Gate';

  const cards = choices.map((opt, index) => {
    const id = `opt-${index}`;
    return `<label class="card" for="${id}">
  <input type="radio" id="${id}" name="choice" value="${escapeHtml(opt.label)}"${index === 0 ? ' checked' : ''}>
  <span class="label">${escapeHtml(opt.label)}</span>
  <span class="desc">${escapeHtml(opt.description || '')}</span>
</label>`;
  }).join('\n');

  const needsText = choices.some((opt) => opt.accepts_text);

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(gateName)}</title>
<style>
:root{color-scheme:dark light}
body{margin:0;padding:2rem 1rem;font:16px/1.5 system-ui,sans-serif;background:#0f172a;color:#f8fafc}
main{max-width:44rem;margin:0 auto}
h1{font-size:1.15rem;letter-spacing:.02em;margin:0 0 .35rem}
p.q{margin:0 0 1.5rem;color:#cbd5e1}
.card{display:block;border:1px solid #334155;border-radius:.6rem;padding:.85rem 1rem;margin-bottom:.6rem;cursor:pointer}
.card:hover{border-color:#64748b}
.card input{margin-right:.6rem}
.label{font-weight:600}
.desc{display:block;margin:.3rem 0 0 1.6rem;color:#94a3b8;font-size:.9rem}
textarea{width:100%;min-height:4.5rem;margin-top:.5rem;padding:.6rem;border-radius:.5rem;border:1px solid #334155;background:#111827;color:inherit;font:inherit}
button{margin-top:1rem;padding:.65rem 1.4rem;border-radius:.5rem;border:0;background:#22c55e;color:#052e16;font-weight:700;cursor:pointer}
button:disabled{opacity:.6;cursor:default}
#status{margin-top:1rem;color:#94a3b8;min-height:1.4rem}
</style></head>
<body><main>
<h1>${escapeHtml(gateName)}</h1>
<p class="q">${escapeHtml(prompt.question || '')}</p>
<form id="picker">
${cards}
${needsText ? '<textarea id="refinement" placeholder="Custom instruction (used only when you pick the free-text option)"></textarea>' : ''}
<button type="submit" id="submit">Submit verdict</button>
<div id="status" role="status" aria-live="polite"></div>
</form>
</main>
<script>
const CONFIG = ${JSON.stringify({ taskDir, signature, endpoint: VERDICT_ENDPOINT }).replace(/</g, '\\u003c')};
const form = document.getElementById('picker');
const statusEl = document.getElementById('status');
const submit = document.getElementById('submit');
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const picked = new FormData(form).get('choice');
  const refinementEl = document.getElementById('refinement');
  const refinement = refinementEl ? refinementEl.value.trim() : '';
  if (!picked) { statusEl.textContent = 'Pick an option first.'; return; }
  submit.disabled = true;
  statusEl.textContent = 'Submitting…';
  try {
    const res = await fetch(CONFIG.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task_dir: CONFIG.taskDir, choice: picked, refinement, sig: CONFIG.signature })
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(payload.error || ('HTTP ' + res.status));
    statusEl.textContent = 'Verdict submitted: ' + picked + '. You can close this tab.';
  } catch (err) {
    submit.disabled = false;
    statusEl.textContent = 'Failed: ' + err.message;
  }
});
</script>
</body></html>`;
}

module.exports = {
  PICKER_BINDINGS,
  VERDICT_ENDPOINT,
  resolvePickerBinding,
  readSessionToken,
  signTaskDir,
  verifyTaskDirSignature,
  buildNativeToolCall,
  buildPickerUrl,
  buildPickerBinding,
  renderPickerPage
};
