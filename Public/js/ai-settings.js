/* ai-settings.js — slide-over Settings panel shared by every page.
   Lets the owner paste AI provider API keys from inside the site: they are
   saved through /api/ai/providers and used only server-side (Cloudflare Durable
   Object in Worker mode, ignored data/ai-settings.json in local Node mode).
   The browser only sees masked previews after saving. Also manages custom
   chat skills (create / edit / delete).
   Usage: <link css/ai-settings.css> + <script js/ai-settings.js> then
   window.PriceAlertSettings.open(). */
(function () {
  'use strict';

  const PROVIDER_ICONS = {
    demo: 'ti-flask',
    opencode: 'ti-code',
    mistral: 'ti-wind',
    openai: 'ti-robot',
    anthropic: 'ti-brain',
    groq: 'ti-bolt',
    google: 'ti-diamond',
    custom: 'ti-world',
    tavily: 'ti-search',
  };
  const SKILL_ICONS = [
    'ti-sparkles', 'ti-chart-candle', 'ti-bell-ringing', 'ti-notebook', 'ti-robot',
    'ti-target', 'ti-compass', 'ti-bolt', 'ti-shield', 'ti-search', 'ti-pencil',
    'ti-message-chatbot', 'ti-brain', 'ti-flask', 'ti-world', 'ti-rocket',
    'ti-book', 'ti-calculator', 'ti-clock', 'ti-scale',
  ];

  const state = {
    providers: [],
    skills: [],
    active: { provider: 'opencode', model: '' },
    loaded: false,
    editingSkillId: null,
    openProvider: null,
    pending: {},
    newCustom: { id: '', name: '', baseUrl: '', model: '', apiKey: '' },
  };

  let root = null;

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  async function api(path, options = {}) {
    const response = await fetch(path, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    });
    let data = {};
    try { data = await response.json(); } catch { /* empty body */ }
    if (!response.ok) {
      const error = new Error(data.error || `Request failed (${response.status})`);
      error.status = response.status;
      throw error;
    }
    return data;
  }

  function flash(message, kind = 'ok') {
    const bar = root.querySelector('.ais-flash');
    if (!bar) return;
    bar.textContent = message;
    bar.className = `ais-flash show ${kind === 'err' ? 'err' : ''}`;
    clearTimeout(flash._t);
    flash._t = setTimeout(() => bar.classList.remove('show'), 3800);
  }

  function isOpencodeId(id){ return String(id)==='opencode'; }
  function providerIcon(id){ if(id==='opencode') return 'ti-code'; if(/^custom[:_-]/i.test(id)) return 'ti-world'; return PROVIDER_ICONS[id] || 'ti-key'; }
  function providerCard(preset) {
    const open = state.openProvider === preset.id;
    const pending = state.pending[preset.id] || {};
    const isCustom = preset.requiresBaseUrl || /^custom[:_-]/i.test(preset.id);
    const isSearch = preset.kind === 'search';
    const isOC = isOpencodeId(preset.id);
    return `
      <div class="ais-provider ${preset.configured ? 'configured' : ''} ${open ? 'open' : ''}" data-provider="${esc(preset.id)}">
        <div class="ais-provider-head" data-toggle="${esc(preset.id)}">
          <span class="p-ico"><i class="ti ${esc(providerIcon(preset.id))}"></i></span>
          <span>
            <span class="p-name">${esc(preset.name)}</span>
            <span class="p-hint">${esc(preset.hint)}</span>
          </span>
          <span class="ais-provider-status">
            <span class="dot"></span>${preset.configured ? (preset.keyless ? 'Ready' : 'Key saved') : (isOC ? 'Ready' : 'No key')}
          </span>
          <span class="p-chev"><i class="ti ti-chevron-down"></i></span>
        </div>
        <div class="ais-provider-body">
          ${isOC ? `
            <div class="ais-hint-line"><b>OpenCode — default, no key, tested first.</b> Local OpenAI-compatible gateway. Set Base URL (e.g. <code>http://127.0.0.1:4096/v1</code>) and Model; chat auto-falls back here when other providers fail.</div>
            <div class="ais-field">
              <label>Base URL (OpenAI-compatible)</label>
              <input type="text" data-field="baseUrl" data-provider="${esc(preset.id)}"
                placeholder="http://127.0.0.1:4096/v1" value="${esc(pending.baseUrl ?? preset.baseUrl ?? '')}">
            </div>
            <div class="ais-field">
              <label>Model</label>
              <input type="text" data-field="model" data-provider="${esc(preset.id)}" list="ais-models-${esc(preset.id)}"
                placeholder="${esc(preset.defaultModel || 'opencode-default')}" value="${esc(pending.model ?? preset.model ?? '')}">
              <datalist id="ais-models-${esc(preset.id)}">
                ${(preset.models || []).map(m => `<option value="${esc(m)}"></option>`).join('')}
              </datalist>
            </div>
            <div class="ais-row-actions">
              <button type="button" class="ais-btn primary" data-save="${esc(preset.id)}">Save</button>
              <button type="button" class="ais-btn" data-test="${esc(preset.id)}">Test</button>
              <button type="button" class="ais-btn" data-activate="${esc(preset.id)}">Use in chat</button>
              ${preset.configured && (pending.baseUrl || preset.baseUrl) ? `<button type="button" class="ais-btn danger" data-remove-provider="${esc(preset.id)}">Clear</button>` : ''}
            </div>
            <div class="ais-test-result" data-test-result="${esc(preset.id)}"></div>
          ` : preset.keyless ? `
            <div class="ais-hint-line">Built-in offline channel — the console stays usable before any key exists.</div>
          ` : `
            ${isSearch ? `<div class="ais-hint-line">Powers the chat's <b>web_search</b> tool. Optional — without it the console searches via a keyless provider.</div>` : ''}
            ${isSearch ? '' : `
            <div class="ais-key-row">
              <div class="ais-key-wrap">
                <input type="password" autocomplete="off" spellcheck="false"
                  data-field="apiKey" data-provider="${esc(preset.id)}"
                  placeholder="${preset.configured && preset.keyMask ? esc(preset.keyMask) : 'Paste your ' + esc(preset.name) + ' API key'}"
                  value="${esc(pending.apiKey || '')}">
                <button type="button" class="ais-reveal" data-reveal title="Show / hide"><i class="ti ti-eye"></i></button>
              </div>
            </div>
            ${preset.configured && preset.keyMask ? `<div><span class="ais-mask">${esc(preset.keyMask)}</span></div>` : ''}`}
            ${isCustom ? `
              <div class="ais-field">
                <label>Base URL (OpenAI-compatible)</label>
                <input type="text" data-field="baseUrl" data-provider="${esc(preset.id)}"
                  placeholder="https://api.example.com/v1" value="${esc(pending.baseUrl ?? preset.baseUrl ?? '')}">
              </div>
            ` : ''}
            ${isSearch ? '' : `
            <div class="ais-field">
              <label>Model</label>
              <input type="text" data-field="model" data-provider="${esc(preset.id)}" list="ais-models-${esc(preset.id)}"
                placeholder="${esc(preset.defaultModel || 'model name')}" value="${esc(pending.model ?? preset.model ?? '')}">
              <datalist id="ais-models-${esc(preset.id)}">
                ${(preset.models || []).map(m => `<option value="${esc(m)}"></option>`).join('')}
              </datalist>
            </div>`}
            ${isSearch && !isCustom ? `
              <div class="ais-field" style="margin-top:6px">
                <label>API key (optional)</label>
                <div class="ais-key-row"><div class="ais-key-wrap">
                  <input type="password" autocomplete="off" data-field="apiKey" data-provider="${esc(preset.id)}" placeholder="${preset.configured && preset.keyMask ? esc(preset.keyMask) : 'Tavily key (optional)'}"
                    value="${esc(pending.apiKey||'')}"><button type="button" class="ais-reveal" data-reveal><i class="ti ti-eye"></i></button>
                </div></div>
                ${preset.configured && preset.keyMask ? `<div><span class="ais-mask">${esc(preset.keyMask)}</span></div>` : ''}
              </div>` : ''}
            <div class="ais-row-actions">
              <button type="button" class="ais-btn primary" data-save="${esc(preset.id)}">Save key</button>
              <button type="button" class="ais-btn" data-test="${esc(preset.id)}">Test</button>
              ${isSearch ? '' : `<button type="button" class="ais-btn" data-activate="${esc(preset.id)}">Use in chat</button>`}
              ${preset.configured ? `<button type="button" class="ais-btn danger" data-remove-provider="${esc(preset.id)}">Remove</button>` : ''}
            </div>
            <div class="ais-test-result" data-test-result="${esc(preset.id)}"></div>
          `}
        </div>
      </div>`;
  }

  function skillRow(skill) {
    return `
      <div class="ais-skill-row">
        <span class="s-rune">${esc(skill.rune || '𐰀')}</span>
        <span style="min-width:0">
          <span class="s-name">${esc(skill.name)} <span class="pill">${skill.builtin ? 'builtin' : 'custom'}</span></span>
          <span class="s-tag">${esc(skill.tagline || '')}</span>
        </span>
        <span class="s-actions">
          ${skill.builtin ? '' : `
            <button type="button" class="ais-icon-btn" data-edit-skill="${esc(skill.id)}" title="Edit"><i class="ti ti-pencil"></i></button>
            <button type="button" class="ais-icon-btn danger" data-delete-skill="${esc(skill.id)}" title="Delete"><i class="ti ti-trash"></i></button>
          `}
        </span>
      </div>`;
  }

  let bootTimer = null;
  function markBooted() {
    const drawer = root && root.querySelector('.ais-drawer');
    if (!drawer) return;
    drawer.classList.add('ais-boot');
    clearTimeout(bootTimer);
    bootTimer = setTimeout(() => drawer.classList.add('ais-settled'), 700);
  }
  function patchToggle(id) {
    const body = root.querySelector('.ais-body');
    if (!body) return false;
    const card = body.querySelector(`[data-provider="${CSS.escape ? CSS.escape(id) : id}"]`);
    if (!card) return false;
    const isOpen = card.classList.contains('open');
    body.querySelectorAll('.ais-provider.open').forEach(el => el.classList.remove('open'));
    if (!isOpen) card.classList.add('open');
    state.openProvider = isOpen ? null : id;
    return true;
  }
  function render() {
    const prevBody = root.querySelector('.ais-body');
    const savedTop = prevBody ? prevBody.scrollTop : 0;
    const hadOpen = !!root.querySelector('.ais-drawer.open');
    const hadBoot = !!root.querySelector('.ais-drawer.ais-boot');
    const savedFocusId = document.activeElement && document.activeElement.id ? document.activeElement.id : null;
    const editing = state.editingSkillId
      ? state.skills.find(skill => skill.id === state.editingSkillId)
      : null;
    const activeOptions = state.providers
      .filter(preset => preset.configured && preset.kind !== 'search')
      .map(preset => `<option value="${esc(preset.id)}" ${state.active.provider === preset.id ? 'selected' : ''}>${esc(preset.name)}${preset.keyless ? '' : ' · ' + esc(preset.keyMask || 'key')}</option>`)
      .join('');
    root.innerHTML = `
      <div class="ais-backdrop" data-close></div>
      <aside class="ais-drawer" role="dialog" aria-label="Settings">
        <header class="ais-head">
          <span class="mark"><i class="ti ti-settings"></i></span>
          <span>
            <h2>Settings</h2>
            <span class="sub">AI providers · keys · skills</span>
          </span>
          <button type="button" class="ais-close" data-close title="Close"><i class="ti ti-x"></i></button>
        </header>
        <div class="ais-body">
          <div class="ais-flash" role="status"></div>

          <section class="ais-section" style="--d:.05s">
            <div class="ais-section-label"><span class="tag">01 // Active channel</span><span class="rule"></span></div>
            <div class="ais-note">
              The built-in Demo needs no key. For live chat, add one AI provider key below, then click <b>Save key → Test → Use in chat</b>.
              For web search, add a separate <b>Tavily Search</b> key; it is optional, and DuckDuckGo is used without it.
              Keys stay server-side and the browser only receives a masked preview.
            </div>
            <div class="ais-active-row">
              <div class="ais-field">
                <label>Provider</label>
                <select id="ais-active-provider">${activeOptions}</select>
              </div>
              <div class="ais-field">
                <label>Model</label>
                <input id="ais-active-model" type="text" placeholder="model name" value="${esc(state.active.model || '')}">
              </div>
            </div>
            <div class="ais-row-actions">
              <button type="button" class="ais-btn primary" id="ais-save-active">Apply</button>
            </div>
          </section>

          <section class="ais-section" style="--d:.14s">
            <div class="ais-section-label"><span class="tag">02 // AI providers</span><span class="rule"></span></div>
            <div class="ais-note" style="margin-bottom:12px">Default is <b>OpenCode</b> (local, no key, tested first). Chat auto-fails over across your saved custom endpoints by availability. Add as many Custom endpoints as you need — each is an independent OpenAI-compatible API.</div>
            <div class="ais-providers">
              ${state.providers.map(providerCard).join('')}
            </div>
            <div style="margin-top:12px;border:1px dashed var(--line);padding:12px;background:rgba(233,228,214,.02)">
              <div class="ais-hint-line" style="margin-bottom:8px">Add another custom endpoint (OpenAI-compatible)</div>
              <div class="ais-form-2" style="margin-bottom:8px">
                <div class="ais-field"><label>Endpoint id (slug)</label><input id="ais-custom-id" placeholder="custom-2 or my-llm" value="${esc(state.newCustom.id)}"></div>
                <div class="ais-field"><label>Display name</label><input id="ais-custom-name" placeholder="My LLM" value="${esc(state.newCustom.name)}"></div>
              </div>
              <div class="ais-field" style="margin-bottom:8px"><label>Base URL</label><input id="ais-custom-base" placeholder="https://api.example.com/v1" value="${esc(state.newCustom.baseUrl)}"></div>
              <div class="ais-form-2">
                <div class="ais-field"><label>Model (optional)</label><input id="ais-custom-model" placeholder="gpt-4o-mini" value="${esc(state.newCustom.model)}"></div>
                <div class="ais-field"><label>API key (optional if gateway is keyless)</label><input id="ais-custom-key" type="password" placeholder="sk-..." value="${esc(state.newCustom.apiKey)}"></div>
              </div>
              <div class="ais-row-actions" style="margin-top:10px"><button type="button" class="ais-btn primary" id="ais-custom-add">Add endpoint</button><span class="ais-hint-line">Saved server-side · used in fallback chain</span></div>
            </div>
          </section>

          <section class="ais-section" style="--d:.22s">
            <div class="ais-section-label"><span class="tag">03 // Chat skills</span><span class="rule"></span></div>
            <div class="ais-note">
              Skills are the console's modes: each one rewrites the system prompt, tone and output format.
              Three ship built in — add more below.
            </div>
            <div class="ais-skill-list">
              ${state.skills.map(skillRow).join('')}
            </div>
            <div class="ais-skill-form ${editing || state.editingSkillId === 'new' ? '' : 'hidden'}" id="ais-skill-form">
              <div class="ais-form-2">
                <div class="ais-field">
                  <label>Name</label>
                  <input id="ais-skill-name" type="text" maxlength="40" placeholder="Risk Sentinel" value="${esc(editing?.name || '')}">
                </div>
                <div class="ais-field">
                  <label>Icon</label>
                  <select id="ais-skill-icon">
                    ${SKILL_ICONS.map(icon => `<option value="${icon}" ${(editing?.icon || 'ti-sparkles') === icon ? 'selected' : ''}>${icon}</option>`).join('')}
                  </select>
                </div>
              </div>
              <div class="ais-field">
                <label>Tagline</label>
                <input id="ais-skill-tagline" type="text" maxlength="80" placeholder="Position sizing &amp; risk checks" value="${esc(editing?.tagline || '')}">
              </div>
              <div class="ais-field">
                <label>System prompt</label>
                <textarea id="ais-skill-prompt" maxlength="4000" placeholder="Describe the role, voice and answer format…">${esc(editing?.systemPrompt || '')}</textarea>
              </div>
              <div class="ais-row-actions">
                <button type="button" class="ais-btn primary" id="ais-skill-save">${editing ? 'Update skill' : 'Create skill'}</button>
                <button type="button" class="ais-btn" id="ais-skill-cancel">Cancel</button>
                <span class="ais-hint-line">Stored server-side · up to 24 custom skills</span>
              </div>
            </div>
            <div class="ais-row-actions" id="ais-skill-open-actions">
              <button type="button" class="ais-btn" id="ais-skill-new"><i class="ti ti-plus"></i> New skill</button>
            </div>
          </section>
        </div>
        <footer class="ais-foot">
          <span>Price-Alert · AI console</span>
          <span>Keys stay server-side</span>
        </footer>
      </aside>`;
    wire();
    const newBody = root.querySelector('.ais-body');
    if (newBody) {
      newBody.scrollTop = savedTop;
      if (state.openProvider) {
        const card = newBody.querySelector(`[data-provider="${state.openProvider}"]`);
        if (card) {
          const cardTop = card.offsetTop;
          const cardBottom = cardTop + card.offsetHeight;
          if (cardTop < newBody.scrollTop || cardBottom > newBody.scrollTop + newBody.clientHeight) {
            card.scrollIntoView({ block: 'nearest' });
          }
        }
      }
    }
    if (hadOpen) {
      root.querySelector('.ais-backdrop')?.classList.add('open');
      const drawer = root.querySelector('.ais-drawer');
      drawer?.classList.add('open');
      if (hadBoot) drawer?.classList.add('ais-boot');
    }
    if (hadBoot) markBooted();
    // restore focus without scrolling the page to top
    if (savedFocusId) {
      const toFocus = document.getElementById(savedFocusId);
      if (toFocus && typeof toFocus.focus === 'function') {
        try { toFocus.focus({ preventScroll: true }); } catch { toFocus.focus(); }
        if (toFocus.setSelectionRange && toFocus.value != null) {
          const len = toFocus.value.length;
          try { toFocus.setSelectionRange(len, len); } catch {}
        }
      }
    } else if (document.activeElement === document.body) {
      // focus was on a provider key/model input (no id) — restore via pending provider field
      // keep drawer focus inside without jumping to window top
      const fallback = newBody && newBody.querySelector('input:focus, select:focus');
      if (!fallback && state.openProvider) {
        const field = newBody && newBody.querySelector(`[data-provider="${state.openProvider}"][data-field]`);
        if (field) { try { field.focus({ preventScroll: true }); } catch { field.focus(); } }
      }
    }
  }

  function providerDraft(id) {
    state.pending[id] = state.pending[id] || {};
    return state.pending[id];
  }

  function collectProviderFields(id) {
    root.querySelectorAll(`[data-provider="${id}"][data-field]`).forEach(input => {
      providerDraft(id)[input.dataset.field] = input.value;
    });
  }

  function wire() {
    root.querySelectorAll('[data-close]').forEach(el => el.addEventListener('click', close));

    root.querySelectorAll('[data-toggle]').forEach(head => head.addEventListener('click', () => {
      const id = head.dataset.toggle;
      if (patchToggle(id)) return;
      state.openProvider = state.openProvider === id ? null : id;
      render();
    }));

    root.querySelectorAll('[data-field][data-provider]').forEach(input => {
      input.addEventListener('input', () => {
        providerDraft(input.dataset.provider)[input.dataset.field] = input.value;
      });
    });

    root.querySelectorAll('[data-reveal]').forEach(button => button.addEventListener('click', event => {
      event.stopPropagation();
      const field = button.parentElement.querySelector('input');
      const showing = field.type === 'text';
      field.type = showing ? 'password' : 'text';
      button.innerHTML = showing ? '<i class="ti ti-eye"></i>' : '<i class="ti ti-eye-off"></i>';
    }));

    root.querySelectorAll('[data-save]').forEach(button => button.addEventListener('click', async () => {
      const id = button.dataset.save;
      collectProviderFields(id);
      const draft = state.pending[id] || {};
      const preset = state.providers.find(p => p.id === id);
      const body = { provider: preset?.id || id };
      const isOC = isOpencodeId(body.provider);
      if (!isOC && draft.apiKey) body.apiKey = draft.apiKey.trim();
      if (draft.baseUrl !== undefined) body.baseUrl = (draft.baseUrl || '').trim();
      if (draft.baseUrl === undefined && (preset?.requiresBaseUrl || isOC)) {
        const inp = root.querySelector(`[data-provider="${body.provider}"][data-field="baseUrl"]`);
        if (inp) body.baseUrl = inp.value.trim();
      }
      if (draft.model !== undefined) body.model = draft.model.trim();
      if (isOC) delete body.apiKey;
      button.classList.add('busy');
      try {
        const data = await api('/api/ai/providers', { method: 'PUT', body: JSON.stringify(body) });
        applyState(data);
        delete state.pending[id];
        flash(`${preset?.name || id} saved server-side.`);
        render();
      } catch (error) {
        flash(error.message, 'err');
        button.classList.remove('busy');
      }
    }));

    root.querySelectorAll('[data-test]').forEach(button => button.addEventListener('click', async () => {
      const id = button.dataset.test;
      collectProviderFields(id);
      const draft = state.pending[id] || {};
      const resultEl = root.querySelector(`[data-test-result="${id}"]`);
      button.classList.add('busy');
      if (resultEl) { resultEl.textContent = 'Contacting provider…'; resultEl.className = 'ais-test-result'; }
      try {
        const preset = state.providers.find(p => p.id === id);
        const body = { provider: id };
        if (draft.apiKey) body.apiKey = draft.apiKey.trim();
        if (preset?.requiresBaseUrl && draft.baseUrl) body.baseUrl = draft.baseUrl.trim();
        if (draft.model) body.model = draft.model.trim();
        const result = await api('/api/ai/providers/test', { method: 'POST', body: JSON.stringify(body) });
        if (resultEl) {
          resultEl.textContent = `OK · ${result.model || ''} · "${result.sample || 'ready'}"`;
          resultEl.className = 'ais-test-result ok';
        }
        flash(`${id} responded — key verified.`);
      } catch (error) {
        if (resultEl) {
          resultEl.textContent = error.message;
          resultEl.className = 'ais-test-result err';
        }
        flash(error.message, 'err');
      } finally {
        button.classList.remove('busy');
      }
    }));

    root.querySelectorAll('[data-activate]').forEach(button => button.addEventListener('click', async () => {
      const id = button.dataset.activate;
      collectProviderFields(id);
      const preset = state.providers.find(p => p.id === id);
      const model = (state.pending[id]?.model ?? preset?.model ?? '').trim();
      try {
        const data = await api('/api/ai/providers', {
          method: 'PUT',
          body: JSON.stringify({ provider: id, model, active: true }),
        });
        applyState(data);
        flash(`Chat now runs on ${preset?.name || id}.`);
        render();
      } catch (error) {
        flash(error.message, 'err');
      }
    }));

    root.querySelectorAll('[data-remove-provider]').forEach(button => button.addEventListener('click', async () => {
      const id = button.dataset.removeProvider;
      if (!window.confirm('Remove the saved key for this provider?')) return;
      try {
        const data = await api(`/api/ai/providers/${encodeURIComponent(id)}`, { method: 'DELETE' });
        applyState(data);
        delete state.pending[id];
        flash('Key removed from server storage.');
        render();
      } catch (error) {
        flash(error.message, 'err');
      }
    }));

    const saveActive = root.querySelector('#ais-save-active');
    if (saveActive) saveActive.addEventListener('click', async () => {
      const provider = root.querySelector('#ais-active-provider')?.value || 'demo';
      const model = (root.querySelector('#ais-active-model')?.value || '').trim();
      try {
        const data = await api('/api/ai/providers', {
          method: 'PUT',
          body: JSON.stringify({ provider, model, active: true }),
        });
        applyState(data);
        flash('Active chat channel updated.');
        render();
      } catch (error) {
        flash(error.message, 'err');
      }
    });

    const newSkill = root.querySelector('#ais-skill-new');
    if (newSkill) newSkill.addEventListener('click', () => {
      state.editingSkillId = 'new';
      render();
      root.querySelector('#ais-skill-name')?.focus();
    });

    const cancelSkill = root.querySelector('#ais-skill-cancel');
    if (cancelSkill) cancelSkill.addEventListener('click', () => {
      state.editingSkillId = null;
      render();
    });

    root.querySelectorAll('[data-edit-skill]').forEach(button => button.addEventListener('click', () => {
      state.editingSkillId = button.dataset.editSkill;
      render();
    }));

    root.querySelectorAll('[data-delete-skill]').forEach(button => button.addEventListener('click', async () => {
      const id = button.dataset.deleteSkill;
      if (!window.confirm('Delete this custom skill?')) return;
      try {
        const data = await api(`/api/ai/skills/${encodeURIComponent(id)}`, { method: 'DELETE' });
        applyState(data);
        flash('Skill deleted.');
        render();
      } catch (error) {
        flash(error.message, 'err');
      }
    }));

    const customAdd = root.querySelector('#ais-custom-add');
    if (customAdd) customAdd.addEventListener('click', async () => {
      const rawId = (root.querySelector('#ais-custom-id')?.value || '').trim();
      const name = (root.querySelector('#ais-custom-name')?.value || '').trim();
      const baseUrl = (root.querySelector('#ais-custom-base')?.value || '').trim();
      const model = (root.querySelector('#ais-custom-model')?.value || '').trim();
      const apiKey = (root.querySelector('#ais-custom-key')?.value || '').trim();
      // persist draft even on validation errors so field values don't flicker away on re-render
      state.newCustom = { id: rawId, name, baseUrl, model, apiKey };
      const id = rawId || `custom-${Date.now().toString(36)}`;
      const normId = /^custom[:_-]/i.test(id) ? id : `custom-${id.replace(/[^a-z0-9_-]/gi,'-').toLowerCase()}`;
      if (!baseUrl) { flash('Base URL is required for a custom endpoint', 'err'); render(); return; }
      const body = { provider: normId, baseUrl, model };
      if (apiKey) body.apiKey = apiKey;
      // name is display-only, stored via model field hint is from PROVIDERS; keep tag via model list — name sent as part of fallback label only
      customAdd.classList.add('busy');
      try {
        const data = await api('/api/ai/providers', { method: 'PUT', body: JSON.stringify(body) });
        applyState(data);
        state.newCustom = { id: '', name: '', baseUrl: '', model: '', apiKey: '' };
        flash(`Custom endpoint ${normId} saved — will participate in auto-failover.`);
        render();
      } catch (e) { flash(e.message, 'err'); customAdd.classList.remove('busy'); }
    });
    // keep draft live without full re-render flicker
    ['#ais-custom-id','#ais-custom-name','#ais-custom-base','#ais-custom-model','#ais-custom-key'].forEach(sel=>{
      const el=root.querySelector(sel); if(!el) return;
      el.addEventListener('input', ()=>{ state.newCustom={ id: root.querySelector('#ais-custom-id')?.value||'', name: root.querySelector('#ais-custom-name')?.value||'', baseUrl: root.querySelector('#ais-custom-base')?.value||'', model: root.querySelector('#ais-custom-model')?.value||'', apiKey: root.querySelector('#ais-custom-key')?.value||'' }; });
    });

    const saveSkill = root.querySelector('#ais-skill-save');
    if (saveSkill) saveSkill.addEventListener('click', async () => {
      const body = {
        name: root.querySelector('#ais-skill-name')?.value.trim(),
        icon: root.querySelector('#ais-skill-icon')?.value,
        tagline: root.querySelector('#ais-skill-tagline')?.value.trim(),
        systemPrompt: root.querySelector('#ais-skill-prompt')?.value.trim(),
      };
      if (!body.name || !body.systemPrompt) {
        flash('Skill needs a name and a system prompt.', 'err');
        return;
      }
      saveSkill.classList.add('busy');
      try {
        const editing = state.editingSkillId && state.editingSkillId !== 'new';
        const data = await api(editing ? `/api/ai/skills/${encodeURIComponent(state.editingSkillId)}` : '/api/ai/skills', {
          method: editing ? 'PUT' : 'POST',
          body: JSON.stringify(body),
        });
        applyState(data);
        state.editingSkillId = null;
        flash(editing ? 'Skill updated.' : 'Skill created — it now appears in the console rail.');
        render();
      } catch (error) {
        flash(error.message, 'err');
        saveSkill.classList.remove('busy');
      }
    });
  }

  function applyState(data) {
    if (!data) return;
    if (Array.isArray(data.providers)) state.providers = data.providers;
    if (Array.isArray(data.skills)) state.skills = data.skills;
    if (data.active) state.active = data.active;
    state.loaded = true;
    document.dispatchEvent(new CustomEvent('ai-state-changed', { detail: { ...state } }));
  }

  async function refresh() {
    try {
      applyState(await api('/api/ai/state'));
      if (root && root.querySelector('.ais-drawer')) render();
      return true;
    } catch (error) {
      flash(error.message, 'err');
      return false;
    }
  }

  function ensureRoot() {
    if (root && document.body.contains(root)) return;
    root = document.createElement('div');
    root.id = 'ais-root';
    document.body.appendChild(root);
  }

  async function open(options = {}) {
    ensureRoot();
    render();
    requestAnimationFrame(() => {
      root.querySelector('.ais-backdrop')?.classList.add('open');
      const drawer = root.querySelector('.ais-drawer');
      drawer?.classList.add('open');
      drawer?.classList.add('ais-boot');
      markBooted();
    });
    if (options.section === 'skills') {
      state.editingSkillId = 'new';
    }
    await refresh();
    if (options.section === 'skills') {
      render();
      root.querySelector('#ais-skill-name')?.focus();
    }
  }

  function close() {
    if (!root) return;
    const backdrop = root.querySelector('.ais-backdrop');
    const drawer = root.querySelector('.ais-drawer');
    backdrop?.classList.remove('open');
    drawer?.classList.remove('open');
    setTimeout(() => {
      if (root && !root.querySelector('.ais-drawer.open')) root.innerHTML = '';
    }, 480);
  }

  function toggle(options) {
    if (root && root.querySelector('.ais-drawer.open')) close();
    else open(options);
  }

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && root && root.querySelector('.ais-drawer.open')) close();
  });

  window.PriceAlertSettings = { open, close, toggle, refresh, getState: () => ({ ...state }) };
})();
