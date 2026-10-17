import assert from 'node:assert/strict';
import { test } from 'node:test';
import worker from '../cloudflare/worker.js';
import { AlertStore } from '../cloudflare/alertStore.js';
import {
    maskKey, validateKey, runChat, DEFAULT_SKILLS, TOOLS, FUNCTION_CATALOG,
    parseToolCall, webSearch, summarizeJournal, createToolExecutors,
    normalizeChatInput, capabilitiesSystemPrompt,
} from '../js/aiCore.js';

class MemoryStorage {
    data = new Map();
    async get(key) { return structuredClone(this.data.get(key)); }
    async put(key, value) {
        if (typeof key === 'string') this.data.set(key, structuredClone(value));
        else for (const [k, v] of Object.entries(key)) this.data.set(k, structuredClone(v));
    }
    async delete(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) this.data.delete(key); }
    async list({ prefix }) { return new Map([...this.data].filter(([k]) => k.startsWith(prefix)).map(([k, v]) => [k, structuredClone(v)])); }
    async transaction(callback) { return callback(this); }
}

const credentials = { DASHBOARD_USER: 'tester', DASHBOARD_PASSWORD: 'test-only-password' };

function authenticated(path, { method = 'GET', headers = {}, body } = {}) {
    return new Request(`https://alerts.example${path}`, {
        method,
        ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
        headers: { 'Content-Type': 'application/json', Authorization: `Basic ${btoa('tester:test-only-password')}`, ...headers },
    });
}

function setupStore(services = {}) {
    const storage = new MemoryStorage();
    const store = new AlertStore({ storage }, credentials, { demoDelayMs: 0, ...services });
    const env = {
        ...credentials,
        ALERT_STORE: {
            idFromName: () => 'store',
            get: () => ({ fetch: request => store.fetch(request) }),
        },
    };
    return { store, env };
}

async function readSse(response) {
    const text = await response.text();
    return text.split('\n')
        .filter(line => line.startsWith('data:'))
        .map(line => JSON.parse(line.slice(5).trim()));
}

async function collectEvents(result) {
    const events = [];
    if (result.kind === 'stream') {
        for await (const event of result.events) events.push(event);
    }
    return events;
}

test('keys are masked on the way out and never returned in plaintext', async () => {
    const { env } = setupStore();
    const secret = 'sk-test-1234567890abcdef';
    const saved = await worker.fetch(authenticated('/api/ai/providers', {
        method: 'PUT',
        body: { provider: 'mistral', apiKey: secret, model: 'mistral-large-latest', active: true },
    }), env);
    assert.equal(saved.status, 200);
    const state = await saved.json();
    const serialized = JSON.stringify(state);
    assert.ok(!serialized.includes(secret), 'raw key must not appear in any response');
    const mistral = state.providers.find(provider => provider.id === 'mistral');
    assert.equal(mistral.configured, true);
    assert.match(mistral.keyMask, /^sk-•{8}[a-f0-9]{4}$/);
    assert.equal(maskKey(secret), mistral.keyMask);
    assert.equal(state.active.provider, 'mistral');
    assert.equal(state.active.model, 'mistral-large-latest');
});

test('provider keys are validated, listed masked and removable', async () => {
    const { env } = setupStore();
    const bad = await worker.fetch(authenticated('/api/ai/providers', {
        method: 'PUT',
        body: { provider: 'openai', apiKey: 'short' },
    }), env);
    assert.equal(bad.status, 400);
    assert.match((await bad.json()).error, /too short/);
    assert.equal(validateKey('has space in it somehow'), 'Key must not contain whitespace or control characters');

    await worker.fetch(authenticated('/api/ai/providers', {
        method: 'PUT',
        body: { provider: 'openai', apiKey: 'sk-good-1234567890', active: true },
    }), env);
    const removed = await worker.fetch(authenticated('/api/ai/providers/openai', { method: 'DELETE' }), env);
    assert.equal(removed.status, 200);
    const state = await removed.json();
    assert.equal(state.providers.find(provider => provider.id === 'openai').configured, false);
    // removing the active provider falls back to the demo channel
    assert.equal(state.active.provider, 'demo');
});

test('three built-in skills ship; custom skills can be added, edited and deleted', async () => {
    const { env } = setupStore();
    const initial = await (await worker.fetch(authenticated('/api/ai/skills'), env)).json();
    assert.equal(initial.skills.length, DEFAULT_SKILLS.length);
    assert.equal(DEFAULT_SKILLS.length, 3);
    assert.deepEqual(initial.skills.map(skill => skill.id), ['market-analyst', 'alert-architect', 'journal-coach']);

    const created = await worker.fetch(authenticated('/api/ai/skills', {
        method: 'POST',
        body: { name: 'Risk Sentinel', icon: 'ti-shield', tagline: 'Position sizing checks', systemPrompt: 'You check position sizing.' },
    }), env);
    assert.equal(created.status, 201);
    const afterCreate = await created.json();
    assert.equal(afterCreate.skills.length, 4);
    const custom = afterCreate.created;
    assert.equal(custom.builtin, false);
    assert.equal(custom.name, 'Risk Sentinel');

    const updated = await worker.fetch(authenticated(`/api/ai/skills/${custom.id}`, {
        method: 'PUT',
        body: { name: 'Risk Sentinel', icon: 'ti-shield', tagline: 'Updated tagline', systemPrompt: 'You enforce risk.' },
    }), env);
    assert.equal(updated.status, 200);
    assert.equal((await updated.json()).updated.tagline, 'Updated tagline');

    const protectedSkill = await worker.fetch(authenticated('/api/ai/skills/market-analyst', { method: 'DELETE' }), env);
    assert.equal(protectedSkill.status, 403);

    const deleted = await worker.fetch(authenticated(`/api/ai/skills/${custom.id}`, { method: 'DELETE' }), env);
    assert.equal(deleted.status, 200);
    assert.equal((await deleted.json()).skills.length, 3);
});

test('demo chat streams and replies in json without any key', async () => {
    const { env } = setupStore();
    const json = await worker.fetch(authenticated('/api/ai/chat', {
        method: 'POST',
        body: {
            skillId: 'alert-architect',
            provider: 'demo',
            stream: false,
            messages: [{ role: 'user', content: 'Build an alert ladder for Gold / USD' }],
        },
    }), env);
    assert.equal(json.status, 200);
    const payload = await json.json();
    assert.equal(payload.provider, 'demo');
    assert.match(payload.message.content, /Alert Architect/);

    const streamed = await worker.fetch(authenticated('/api/ai/chat', {
        method: 'POST',
        body: {
            skillId: 'market-analyst',
            provider: 'demo',
            stream: true,
            messages: [{ role: 'user', content: 'Read Gold / USD' }],
        },
    }), env);
    assert.equal(streamed.status, 200);
    assert.match(streamed.headers.get('content-type'), /text\/event-stream/);
    const events = await readSse(streamed);
    const text = events.filter(event => event.delta).map(event => event.delta).join('');
    const done = events.find(event => event.done);
    assert.match(text, /Market Analyst/);
    assert.ok(done, 'stream must end with a done event');
    assert.equal(done.provider, 'demo');
});

test('chat proxies to the configured provider with the stored key and skill prompt', async () => {
    let seenUrl = '';
    let seenAuth = '';
    let seenBody = null;
    const sse = [
        'data: {"choices":[{"delta":{"content":"Hello world"}}]}',
        '',
        'data: [DONE]',
        '',
    ].join('\n');
    const { env } = setupStore({
        aiFetch: async (url, options) => {
            seenUrl = url;
            seenAuth = options.headers.Authorization;
            seenBody = JSON.parse(options.body);
            return new Response(sse, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
        },
    });
    await worker.fetch(authenticated('/api/ai/providers', {
        method: 'PUT',
        body: { provider: 'mistral', apiKey: 'sk-live-1234567890', model: 'mistral-small-latest', active: true },
    }), env);

    const response = await worker.fetch(authenticated('/api/ai/chat', {
        method: 'POST',
        body: {
            skillId: 'journal-coach',
            stream: true,
            messages: [{ role: 'user', content: 'Review my week' }],
        },
    }), env);
    assert.equal(response.status, 200);
    const events = await readSse(response);
    const text = events.filter(event => event.delta).map(event => event.delta).join('');
    assert.equal(text, 'Hello world');
    assert.equal(seenUrl, 'https://api.mistral.ai/v1/chat/completions');
    assert.equal(seenAuth, 'Bearer sk-live-1234567890');
    // the skill system prompt + tool protocol are prepended server-side
    assert.equal(seenBody.messages[0].role, 'system');
    assert.match(seenBody.messages[0].content, /Journal Coach/);
    assert.match(seenBody.messages[0].content, /CONSOLE DATA TOOLS/);
    assert.equal(seenBody.model, 'mistral-small-latest');
});

test('the AI can inspect every dashboard function with limited notification test access', async () => {
    assert.ok(TOOLS.some(tool => tool.name === 'read_functions'));
    const result = await createToolExecutors().exec('read_functions');
    assert.equal(result.access, 'read-and-test');
    assert.deepEqual(result.functions, FUNCTION_CATALOG);
    assert.deepEqual(result.functions.map(entry => entry.name), [
        'chart_data', 'alerts', 'trigger_history', 'journal', 'economic_calendar', 'web_search',
        'alert_testing', 'messaging_delivery', 'mobile_delivery', 'alert_creation', 'alert_management',
    ]);
    assert.ok(result.functions.every(entry => ['read', 'inspect-only', 'test'].includes(entry.access)));
});

test('every skill, including Market Analyst, is told that delivery tests are supported', () => {
    const capability = capabilitiesSystemPrompt();
    assert.match(capability, /every skill/i);
    assert.match(capability, /test_notification/);
    assert.match(capability, /never claim/i);
    for (const skill of DEFAULT_SKILLS) {
        const { messages } = normalizeChatInput({
            skillId: skill.id,
            provider: 'demo',
            messages: [{ role: 'user', content: 'Send a Telegram test message' }],
        }, { skills: [] });
        const system = messages.find(message => message.role === 'system')?.content || '';
        assert.match(system, /CONSOLE CAPABILITIES & PERMISSIONS/, `${skill.id} must receive the capability contract`);
        assert.match(system, /available in every skill, including Market Analyst/i, `${skill.id} must not feel read-only`);
        assert.match(system, /test_notification/);
        assert.match(system, /never claim/i);
    }
    const analyst = DEFAULT_SKILLS.find(skill => skill.id === 'market-analyst');
    assert.match(analyst.systemPrompt, /not a read-only assistant/i);
    assert.doesNotMatch(analyst.systemPrompt, /you are (a )?read-only/i);
});

test('Market Analyst can send a delivery test through its own tool loop', async () => {
    const toolCall = JSON.stringify({
        choices: [{ message: { content: '```tool\n{"tool": "test_notification", "args": {"channel": "Telegram"}}\n```' } }],
    });
    const final = JSON.stringify({
        choices: [{ message: { content: 'Telegram test accepted.' } }],
    });
    let sent = null;
    const bodies = [];
    const result = await runChat({
        skillId: 'market-analyst',
        provider: 'mistral',
        model: 'mistral-small-latest',
        stream: false,
        messages: [{ role: 'user', content: 'Send a Telegram test notification' }],
    }, {
        providers: { mistral: { apiKey: 'sk-live-1234567890' } },
        executors: createToolExecutors({
            testNotification: async args => {
                sent = args;
                return { channel: args.channel, status: 'accepted' };
            },
        }),
        fetchImpl: async (url, options) => {
            bodies.push(JSON.parse(options.body));
            return new Response(bodies.length === 1 ? toolCall : final, {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            });
        },
        demoDelayMs: 0,
    });
    assert.equal(result.content, 'Telegram test accepted.');
    assert.deepEqual(sent, { channel: 'Telegram' });
    assert.equal(result.toolCalls.length, 1);
    assert.equal(result.toolCalls[0].name, 'test_notification');
    assert.match(bodies[0].messages[0].content, /CONSOLE CAPABILITIES & PERMISSIONS/);
    assert.match(bodies[0].messages[0].content, /including Market Analyst/);
});

test('the model can call console data tools and gets their real outputs', async () => {
    // JSON (non-stream) round 1: the model asks for live prices
    const roundOne = JSON.stringify({
        choices: [{ message: { content: '```tool\n{"tool": "get_prices", "args": {}}\n```' } }],
    });
    const roundTwo = JSON.stringify({
        choices: [{ message: { content: 'Gold is 2412.5 — alerts pending.' } }],
    });
    const upstreamBodies = [];
    let toolRuns = 0;
    const executors = createToolExecutors({
        getPrices: async () => {
            toolRuns += 1;
            return { 'OANDA:XAUUSD': { price: 2412.5 }, 'FX_IDC:EURUSD': { price: 1.0832 } };
        },
    });
    const result = await runChat({
        skillId: 'market-analyst',
        provider: 'mistral',
        model: 'mistral-small-latest',
        stream: false,
        messages: [{ role: 'user', content: 'What is gold doing?' }],
    }, {
        providers: { mistral: { apiKey: 'sk-live-1234567890' } },
        executors,
        fetchImpl: async (url, options) => {
            upstreamBodies.push(JSON.parse(options.body));
            return new Response(upstreamBodies.length === 1 ? roundOne : roundTwo, {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            });
        },
        demoDelayMs: 0,
    });
    assert.equal(result.kind, 'json');
    assert.equal(result.content, 'Gold is 2412.5 — alerts pending.');
    assert.equal(toolRuns, 1);
    assert.equal(result.toolCalls.length, 1);
    assert.equal(result.toolCalls[0].name, 'get_prices');
    // the tool result was fed back into the conversation
    const second = upstreamBodies[1];
    assert.match(JSON.stringify(second.messages), /2412\.5/);
    assert.match(JSON.stringify(second.messages), /TOOL RESULT \(get_prices\)/);
});

test('the tool loop streams tool events, resets the call block and finishes with done', async () => {
    const toolCallSse = [
        'data: {"choices":[{"delta":{"content":"```tool\\n{\\"tool\\": \\"list_alerts\\", \\"args\\": {}}\\n```"}}]}',
        '',
        'data: [DONE]',
        '',
    ].join('\n');
    const answerSse = [
        'data: {"choices":[{"delta":{"content":"You have 1 pending alert."}}]}',
        '',
        'data: [DONE]',
        '',
    ].join('\n');
    let calls = 0;
    const result = await runChat({
        skillId: 'alert-architect',
        provider: 'mistral',
        stream: true,
        messages: [{ role: 'user', content: 'What alerts are set?' }],
    }, {
        providers: { mistral: { apiKey: 'sk-live-1234567890' } },
        executors: createToolExecutors({
            getAlerts: async () => [{ id: 'a1', pair: 'Gold / USD', target: 2400, state: 'up', note: 'breakout', channel: 'Telegram', createdAt: '2026-10-17' }],
        }),
        fetchImpl: async () => {
            calls += 1;
            return new Response(calls === 1 ? toolCallSse : answerSse, {
                status: 200,
                headers: { 'Content-Type': 'text/event-stream' },
            });
        },
        demoDelayMs: 0,
    });
    const events = await collectEvents(result);
    const kinds = events.map(event => {
        if (event.delta) return 'delta';
        if (event.reset) return 'reset';
        if (event.tool) return `tool:${event.tool.status}`;
        if (event.done) return 'done';
        return 'other';
    });
    assert.ok(kinds.includes('reset'), 'tool-call block must be reset');
    assert.ok(kinds.includes('tool:running') && kinds.includes('tool:done'));
    assert.equal(kinds[kinds.length - 1], 'done');
    const text = events.filter(event => event.delta).map(event => event.delta).join('');
    assert.match(text, /1 pending alert/);
    const done = events.find(event => event.done);
    assert.equal(done.toolCalls[0].summary, '1 pending');
});

test('demo mode runs the tools too and answers with real dashboard data', async () => {
    const result = await runChat({
        skillId: 'market-analyst',
        provider: 'demo',
        stream: false,
        messages: [{ role: 'user', content: 'What is the market doing right now?' }],
    }, {
        executors: createToolExecutors({
            getPrices: async () => ({ 'OANDA:XAUUSD': { price: 4210.75 } }),
        }),
        demoDelayMs: 0,
    });
    assert.equal(result.kind, 'json');
    assert.match(result.content, /4210\.75/);
    assert.equal(result.toolCalls[0].name, 'get_prices');
});

test('chat on a provider without a key fails with a clear, credential-free error', async () => {
    const { env } = setupStore();
    const response = await worker.fetch(authenticated('/api/ai/chat', {
        method: 'POST',
        body: {
            skillId: 'market-analyst',
            provider: 'groq',
            stream: true,
            messages: [{ role: 'user', content: 'hi' }],
        },
    }), env);
    assert.equal(response.status, 409);
    const payload = await response.json();
    assert.match(payload.error, /No API key saved for Groq/);
});

test('anthropic and google stream formats are normalized to plain deltas', async () => {
    const anthropicSse = [
        'event: content_block_delta',
        'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Bon"}}',
        '',
        'event: content_block_delta',
        'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"jour"}}',
        '',
    ].join('\n');
    const anthropic = await runChat({
        provider: 'anthropic',
        model: 'claude-sonnet-4-5',
        stream: true,
        messages: [{ role: 'user', content: 'hi' }],
    }, {
        providers: { anthropic: { apiKey: 'sk-ant-1234567890' } },
        fetchImpl: async () => new Response(anthropicSse, { status: 200 }),
        demoDelayMs: 0,
    });
    let text = '';
    for await (const event of anthropic.events) {
        if (event.delta) text += event.delta;
    }
    assert.equal(text, 'Bonjour');

    const googleSse = [
        'data: {"candidates":[{"content":{"parts":[{"text":"Hey"}]}}]}',
        '',
        'data: {"candidates":[{"content":{"parts":[{"text":" there"}]}}]}',
        '',
    ].join('\n');
    const google = await runChat({
        provider: 'google',
        model: 'gemini-2.5-flash',
        stream: true,
        messages: [{ role: 'user', content: 'hi' }],
    }, {
        providers: { google: { apiKey: 'AIza-key-1234567890' } },
        fetchImpl: async () => new Response(googleSse, { status: 200 }),
        demoDelayMs: 0,
    });
    text = '';
    for await (const event of google.events) {
        if (event.delta) text += event.delta;
    }
    assert.equal(text, 'Hey there');
});

test('web_search works keyless (DuckDuckGo) and with a Tavily key', async () => {
    const ddgHtml = `
      <a rel="nofollow" href="/l/?uddg=https%3A%2F%2Fexample.com%2Fgold" class="result-link">Gold outlook</a>
      <td class="result-snippet">Gold steadies as dollar cools.</td>
      <a rel="nofollow" href="https://other.example/x" class="result-link">Rates preview</a>
      <td class="result-snippet">Fed seen holding.</td>`;
    const keyless = await webSearch('gold price', 3, {
        fetchImpl: async () => new Response(ddgHtml, { status: 200 }),
    });
    assert.equal(keyless.provider, 'duckduckgo');
    assert.equal(keyless.results.length, 2);
    assert.equal(keyless.results[0].url, 'https://example.com/gold');
    assert.match(keyless.results[0].snippet, /Gold steadies/);

    let sentBody = null;
    const tavily = await webSearch('gold price', 2, {
        apiKey: 'tvly-key-1234567890',
        fetchImpl: async (url, options) => {
            sentBody = JSON.parse(options.body);
            return new Response(JSON.stringify({
                results: [{ title: 'T1', url: 'https://t.example/1', content: 'snippet one' }],
            }), { status: 200 });
        },
    });
    assert.equal(tavily.provider, 'tavily');
    assert.equal(tavily.results.length, 1);
    assert.equal(sentBody.query, 'gold price');
});

test('tool-call blocks are parsed defensively', () => {
    assert.deepEqual(parseToolCall('```tool\n{"tool": "get_time", "args": {}}\n```'), { tool: 'get_time', args: {} });
    assert.deepEqual(parseToolCall('Sure!\n{"tool": "web_search", "args": {"query": "gold"}}'), { tool: 'web_search', args: { query: 'gold' } });
    assert.equal(parseToolCall('```tool\n{"tool": "rm_rf", "args": {}}\n```'), null);
    assert.equal(parseToolCall('no tools here'), null);
    assert.ok(TOOLS.length >= 7);
});

test('journal_summary digests the journal module payload', () => {
    const summary = summarizeJournal({
        trades: [
            { pair: 'Gold / USD', date: '2026-10-15', dir: 'long', outcome: 'WIN', strategy: 'Breakout', pnl: '2.5', notes: 'clean' },
            { pair: 'Gold / USD', date: '2026-10-16', dir: 'short', outcome: 'LOSS', strategy: 'Breakout', pnl: -1, notes: 'late exit' },
            { pair: 'BTC / USD', date: '2026-10-16', dir: 'long', outcome: 'BE', strategy: 'Range', pnl: '', notes: '' },
        ],
    });
    assert.equal(summary.trades, 3);
    assert.equal(summary.wins, 1);
    assert.equal(summary.losses, 1);
    assert.equal(summary.winRate, '33%');
    assert.equal(summary.byPair['Gold / USD'].n, 2);
    assert.equal(summary.recent.length, 3);
});

test('the key test endpoint verifies keys against the provider', async () => {
    const { env } = setupStore({
        aiFetch: async () => new Response(JSON.stringify({
            choices: [{ message: { content: 'ready' } }],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    });
    const ok = await worker.fetch(authenticated('/api/ai/providers/test', {
        method: 'POST',
        body: { provider: 'openai', apiKey: 'sk-check-1234567890' },
    }), env);
    assert.equal(ok.status, 200);
    const result = await ok.json();
    assert.equal(result.ok, true);
    assert.equal(result.sample, 'ready');

    const fail = await worker.fetch(authenticated('/api/ai/providers/test', {
        method: 'POST',
        body: { provider: 'openai', apiKey: 'x' },
    }), env);
    assert.equal(fail.status, 400);
});

test('search providers are not chat channels', async () => {
    const { env } = setupStore();
    await worker.fetch(authenticated('/api/ai/providers', {
        method: 'PUT',
        body: { provider: 'tavily', apiKey: 'tvly-key-1234567890' },
    }), env);
    const state = await (await worker.fetch(authenticated('/api/ai/state'), env)).json();
    const tavily = state.providers.find(provider => provider.id === 'tavily');
    assert.equal(tavily.configured, true);
    assert.equal(tavily.kind, 'search');
    assert.ok(!state.providers.find(provider => provider.id === 'tavily').models.length, 'search providers expose no chat models');

    const chat = await worker.fetch(authenticated('/api/ai/chat', {
        method: 'POST',
        body: { skillId: 'market-analyst', provider: 'tavily', stream: true, messages: [{ role: 'user', content: 'hi' }] },
    }), env);
    assert.equal(chat.status, 400);
    assert.match((await chat.json()).error, /search provider, not a chat channel/);
});

test('the worker requires dashboard auth for /api/ai and denies cross-origin writes', async () => {
    const { env } = setupStore();
    const anonymous = await worker.fetch(new Request('https://alerts.example/api/ai/state'), env);
    assert.equal(anonymous.status, 401);

    const crossSite = await worker.fetch(authenticated('/api/ai/providers', {
        method: 'PUT',
        headers: { Origin: 'https://evil.example' },
        body: { provider: 'demo' },
    }), env);
    assert.equal(crossSite.status, 403);

    // same site over a TLS-terminating proxy (https origin, http worker) is allowed
    const proxied = await worker.fetch(authenticated('/api/ai/state', {
        headers: { Origin: 'https://alerts.example' },
    }), env);
    assert.equal(proxied.status, 200);
});

test('default skills describe the three distinct console modes', () => {
    assert.equal(DEFAULT_SKILLS.filter(skill => skill.builtin).length, 3);
    const ids = DEFAULT_SKILLS.map(skill => skill.id);
    assert.ok(ids.includes('market-analyst') && ids.includes('alert-architect') && ids.includes('journal-coach'));
    for (const skill of DEFAULT_SKILLS) {
        assert.ok(skill.systemPrompt.length > 40, `${skill.id} needs a real system prompt`);
        assert.ok(skill.icon.startsWith('ti-'), `${skill.id} needs a tabler icon`);
    }
});
