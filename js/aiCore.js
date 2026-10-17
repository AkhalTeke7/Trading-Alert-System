// aiCore.js — shared brain of the AI console: provider adapters, skill registry,
// key masking and the offline demo channel. Used by the Cloudflare worker
// (cloudflare/alertStore.js) and the local Node server (js/server.js) alike.
//
// API keys never leave the server: the website saves them through /api/ai/providers,
// both runtimes only ever return masked previews, and chat requests are proxied
// server-side so the browser never holds a credential.

export const PROVIDERS = [
    {
        id: 'demo',
        name: 'Demo channel',
        hint: 'offline · no key required',
        keyless: true,
        kind: 'demo',
        models: ['dossier-demo'],
        defaultModel: 'dossier-demo',
    },
    {
        id: 'mistral',
        name: 'Mistral AI',
        hint: 'api.mistral.ai',
        kind: 'openai',
        baseUrl: 'https://api.mistral.ai/v1',
        models: ['mistral-large-latest', 'mistral-medium-latest', 'mistral-small-latest', 'open-mistral-nemo'],
        defaultModel: 'mistral-large-latest',
    },
    {
        id: 'openai',
        name: 'OpenAI',
        hint: 'api.openai.com',
        kind: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4.1-mini'],
        defaultModel: 'gpt-4o-mini',
    },
    {
        id: 'anthropic',
        name: 'Anthropic',
        hint: 'api.anthropic.com',
        kind: 'anthropic',
        baseUrl: 'https://api.anthropic.com/v1',
        models: ['claude-sonnet-4-5', 'claude-haiku-4-5', 'claude-opus-4-1'],
        defaultModel: 'claude-sonnet-4-5',
    },
    {
        id: 'groq',
        name: 'Groq',
        hint: 'api.groq.com · fast inference',
        kind: 'openai',
        baseUrl: 'https://api.groq.com/openai/v1',
        models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768'],
        defaultModel: 'llama-3.3-70b-versatile',
    },
    {
        id: 'google',
        name: 'Google Gemini',
        hint: 'generativelanguage.googleapis.com',
        kind: 'google',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
        models: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash'],
        defaultModel: 'gemini-2.5-flash',
    },
    {
        id: 'custom',
        name: 'Custom endpoint',
        hint: 'any OpenAI-compatible API',
        kind: 'openai',
        requiresBaseUrl: true,
        models: [],
        defaultModel: '',
    },
    {
        id: 'tavily',
        name: 'Tavily Search',
        hint: 'tavily.com · better web search (optional)',
        kind: 'search',
        baseUrl: 'https://api.tavily.com',
        models: [],
        defaultModel: '',
    },
];

export const providerById = id => PROVIDERS.find(provider => provider.id === id) || null;

const RUNES = ['𐰀', '𐰇', '𐰉', '𐰴', '𐰚', '𐱅', '𐰸', '𐰺', '𐰽', '𐰾'];

export const DEFAULT_SKILLS = [
    {
        id: 'market-analyst',
        name: 'Market Analyst',
        icon: 'ti-chart-candle',
        rune: '𐰴',
        tagline: 'Structure, momentum & setups',
        builtin: true,
        systemPrompt: [
            'You are the Market Analyst skill inside the Price-Alert dossier console — a personal trading-alert workstation tracking Gold / USD, EUR / USD, GBP / USD, BTC / USD, NASDAQ / USD and S&P 500 / USD.',
            'Voice: terse, precise, dossier-like. Prefer short sections, bullet levels and explicit bias. No hype, no disclaimers spam; one-line risk note only when it matters.',
            'Always answer with: 1) bias (bullish / bearish / neutral) and timeframe, 2) key levels to watch (support, resistance, invalidation), 3) what would change your mind, 4) a concrete next action for the trader.',
            'When the user names a pair from the tracked list, speak in that instrument; otherwise ask which market they mean before going deep.',
            'Formatting rule: always use full Markdown (https://github.com/adam-p/markdown-here/wiki/markdown-cheatsheet) — headers (# ##), bold/italic, tables, blockquotes, fenced code, lists and links. Use tables for levels/comparisons, blockquote for Risk note, and bold for direction.',
        ].join(' '),
    },
    {
        id: 'alert-architect',
        name: 'Alert Architect',
        icon: 'ti-bell-ringing',
        rune: '𐰇',
        tagline: 'Design precise alert levels',
        builtin: true,
        systemPrompt: [
            'You are the Alert Architect skill inside the Price-Alert dossier console. The console creates price alerts on Gold / USD, EUR / USD, GBP / USD, BTC / USD, NASDAQ / USD and S&P 500 / USD, delivered via Telegram, Bale, both, or the mobile app.',
            'Voice: engineer-like, compact, numbered steps. Convert any trade idea into concrete alert levels: entry confirmation, stop / invalidation, partial take-profit ladders.',
            'For every alert propose: pair, direction (above / below), exact level, a short note (under 100 characters) and the best channel. Present them as a ready-to-enter list matching the console fields (pair, target, note, channel).',
            'If the user gives no level, derive candidate levels from the current market context they describe and say which level is the primary trigger.',
            'Formatting rule: always use full Markdown (https://github.com/adam-p/markdown-here/wiki/markdown-cheatsheet) — put the alert ladder in a Markdown table (columns: Pair | Direction | Level | Note | Channel), use headers for sections and bold for the primary trigger.',
        ].join(' '),
    },
    {
        id: 'journal-coach',
        name: 'Journal Coach',
        icon: 'ti-notebook',
        rune: '𐱅',
        tagline: 'Discipline & performance review',
        builtin: true,
        systemPrompt: [
            'You are the Journal Coach skill inside the Price-Alert dossier console — a trading journal companion that reviews entries, exits, screenshots and statistics logged in the journal module.',
            'Voice: calm, direct, coach-like. Focus on process over outcome: consistency, risk discipline, revenge trading, premature exits, oversized positions.',
            'Structure answers as: 1) pattern you notice from what the user shared, 2) why it costs money, 3) one specific rule to adopt this week, 4) how to measure it.',
            'Ask for concrete numbers (R, win rate, hold time) when the user has them; work with qualitative descriptions when they do not. Never promise performance improvements.',
            'Formatting rule: always use full Markdown (https://github.com/adam-p/markdown-here/wiki/markdown-cheatsheet) — headers for the 4 sections, checklist `- [ ]` for the weekly rule, table for any stats, and blockquote for the key takeaway.',
        ].join(' '),
    },
];

// ---------------------------------------------------------------------------
// Key handling — masking is one-way; raw keys are only used for upstream calls.
// ---------------------------------------------------------------------------

export function maskKey(key) {
    const value = String(key || '').trim();
    if (!value) return null;
    const head = value.slice(0, 3);
    const tail = value.length >= 7 ? value.slice(-4) : '';
    return `${head}${'•'.repeat(8)}${tail}`;
}

export function validateKey(key) {
    const value = String(key || '').trim();
    if (value.length < 8) return 'Key looks too short (min 8 characters)';
    if (value.length > 256) return 'Key is too long (max 256 characters)';
    if (/[\s\u0000-\u001f]/.test(value)) return 'Key must not contain whitespace or control characters';
    return null;
}

export function validateBaseUrl(baseUrl) {
    const value = String(baseUrl || '').trim();
    if (!value) return 'Base URL is required for the custom endpoint';
    let url;
    try {
        url = new URL(value);
    } catch {
        return 'Base URL must be a valid URL';
    }
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.protocol !== 'https:' && !local) return 'Base URL must use https';
    return null;
}

export function sanitizeModel(model, preset) {
    const value = String(model || '').trim().slice(0, 120);
    return value || preset?.defaultModel || '';
}

// ---------------------------------------------------------------------------
// Skill handling
// ---------------------------------------------------------------------------

export function sanitizeSkill(body, { builtin = false } = {}) {
    const name = String(body?.name || '').trim().slice(0, 40);
    if (!name) throw new Error('Skill name is required');
    const tagline = String(body?.tagline || '').trim().slice(0, 80);
    const systemPrompt = String(body?.systemPrompt || '').trim().slice(0, 4000);
    if (!systemPrompt) throw new Error('Skill prompt is required');
    const icon = /^[a-z0-9 -]{2,40}$/.test(String(body?.icon || '')) ? String(body.icon) : 'ti-sparkles';
    const rune = RUNES.includes(body?.rune) ? body.rune : RUNES[Math.floor(Math.random() * RUNES.length)];
    return {
        id: String(body?.id || '').trim().slice(0, 60) || `skill-${crypto.randomUUID().slice(0, 8)}`,
        name,
        icon,
        rune,
        tagline,
        systemPrompt,
        builtin,
    };
}

export function listSkills(saved = []) {
    const customs = Array.isArray(saved) ? saved : [];
    return [...DEFAULT_SKILLS.map(skill => ({ ...skill })), ...customs.map(skill => ({ ...skill, builtin: false }))];
}

// ---------------------------------------------------------------------------
// Upstream request building + response parsing
// ---------------------------------------------------------------------------

function openAiMessages(messages) {
    return messages.map(message => ({
        role: message.role === 'system' ? 'system' : message.role === 'assistant' ? 'assistant' : 'user',
        content: String(message.content),
    }));
}

function splitSystem(messages) {
    const system = messages.filter(message => message.role === 'system').map(message => message.content).join('\n');
    const rest = messages.filter(message => message.role !== 'system');
    return { system, rest };
}

export function buildUpstreamRequest({ preset, apiKey, model, baseUrl, messages, stream }) {
    const base = String(baseUrl || preset.baseUrl || '').replace(/\/+$/, '');
    if (preset.kind === 'anthropic') {
        const { system, rest } = splitSystem(messages);
        return {
            url: `${base}/messages`,
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
                model,
                max_tokens: 4096,
                ...(system ? { system } : {}),
                messages: openAiMessages(rest),
                ...(stream ? { stream: true } : {}),
            }),
        };
    }
    if (preset.kind === 'google') {
        const { system, rest } = splitSystem(messages);
        const url = `${base}/models/${encodeURIComponent(model)}:${stream ? 'streamGenerateContent?alt=sse' : 'generateContent'}`;
        return {
            url,
            headers: {
                'Content-Type': 'application/json',
                'x-goog-api-key': apiKey,
            },
            body: JSON.stringify({
                ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
                contents: rest.map(message => ({
                    role: message.role === 'assistant' ? 'model' : 'user',
                    parts: [{ text: String(message.content) }],
                })),
                generationConfig: { maxOutputTokens: 4096 },
            }),
        };
    }
    return {
        url: `${base}/chat/completions`,
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
            model,
            messages: openAiMessages(messages),
            ...(stream ? { stream: true } : {}),
        }),
    };
}

function sseDataLines(chunkText, carry) {
    const text = carry + chunkText;
    const parts = text.split('\n');
    const rest = parts.pop() ?? '';
    const events = [];
    for (const raw of parts) {
        const line = raw.trim();
        if (line.startsWith('data:')) events.push(line.slice(5).trim());
    }
    return { events, rest };
}

function deltaFromEvent(kind, data) {
    if (!data || data === '[DONE]') return null;
    let parsed;
    try {
        parsed = JSON.parse(data);
    } catch {
        return null;
    }
    if (kind === 'anthropic') {
        return parsed?.type === 'content_block_delta' && parsed?.delta?.text ? String(parsed.delta.text) : null;
    }
    if (kind === 'google') {
        const parts = parsed?.candidates?.[0]?.content?.parts;
        return Array.isArray(parts) ? parts.map(part => part?.text || '').join('') || null : null;
    }
    const content = parsed?.choices?.[0]?.delta?.content;
    return content ? String(content) : null;
}

function textFromJson(kind, data) {
    if (kind === 'anthropic') {
        return (data?.content || []).map(block => block?.text || '').join('');
    }
    if (kind === 'google') {
        const parts = data?.candidates?.[0]?.content?.parts;
        return Array.isArray(parts) ? parts.map(part => part?.text || '').join('') : '';
    }
    return data?.choices?.[0]?.message?.content || '';
}

/** Normalize any provider's stream body into a plain text-delta async iterator. */
export async function* streamDeltas(kind, body) {
    const reader = body?.getReader ? body.getReader() : null;
    if (!reader) return;
    const decoder = new TextDecoder();
    let carry = '';
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const { events, rest } = sseDataLines(decoder.decode(value, { stream: true }), carry);
        carry = rest;
        for (const event of events) {
            const delta = deltaFromEvent(kind, event);
            if (delta) yield delta;
        }
    }
    const tail = sseDataLines(decoder.decode() + '\n', carry);
    for (const event of tail.events) {
        const delta = deltaFromEvent(kind, event);
        if (delta) yield delta;
    }
}

export function parseJsonCompletion(kind, data) {
    return textFromJson(kind, data);
}

// ---------------------------------------------------------------------------
// Console data tools — the chat can call the dashboard's own functions and use
// their outputs as live data (prices, alerts, journal, news) plus web search.
// The tool loop is provider-agnostic: the model replies with a fenced `tool`
// JSON block, the server runs the real function, feeds the result back, and the
// model answers with the data. Works with every provider incl. the demo channel.
// ---------------------------------------------------------------------------

// A complete, inspect-only inventory of the dashboard's user-facing functions.
// This is deliberately data rather than callable endpoints: the AI may learn what
// each function does, but it cannot create, change, delete, test, or send anything.
export const FUNCTION_CATALOG = [
    { name: 'chart_data', access: 'read', description: 'Read live tracked-market prices and TradingView symbols used by the charts.' },
    { name: 'alerts', access: 'read', description: 'Read pending price alerts and their pair, target, direction, note, delivery channel, and creation time.' },
    { name: 'trigger_history', access: 'read', description: 'Read recently triggered alert events and their delivery source.' },
    { name: 'journal', access: 'read', description: 'Read journal performance summaries, pair breakdowns, and recent trade notes when a journal backup is available.' },
    { name: 'economic_calendar', access: 'read', description: 'Read upcoming high-impact economic events.' },
    { name: 'web_search', access: 'read', description: 'Read time-sensitive market context from web search results.' },
    { name: 'alert_testing', access: 'inspect-only', description: 'Inspect the test-alert capability. Running a test can deliver a real notification and is not available to the AI.' },
    { name: 'messaging_delivery', access: 'inspect-only', description: 'Inspect Telegram and Bale delivery capability. Sending messages is not available to the AI.' },
    { name: 'mobile_delivery', access: 'inspect-only', description: 'Inspect mobile-app notification capability. Registering devices or sending push notifications is not available to the AI.' },
    { name: 'alert_creation', access: 'inspect-only', description: 'Inspect alert creation requirements: pair, target, note, and delivery channel. Creating alerts is not available to the AI.' },
    { name: 'alert_management', access: 'inspect-only', description: 'Inspect alert update and deletion capability. Updating or deleting alerts is not available to the AI.' },
];

export const TOOLS = [
    { name: 'read_functions', args: '{}', description: 'Read the complete dashboard function catalog, including chart data, testing, messaging/mobile delivery, and alerts. This is inspect-only and never executes or changes a function.' },
    { name: 'get_prices', args: '{}', description: 'Live prices for the tracked pairs (Gold / USD, EUR / USD, GBP / USD, BTC / USD, NASDAQ / USD, S&P 500 / USD) plus their TradingView symbols.' },
    { name: 'list_alerts', args: '{}', description: 'Pending price alerts saved in the console: id, pair, target, direction, note, channel, created time.' },
    { name: 'list_triggered', args: '{}', description: 'Recently triggered alert events: pair, target, note, channel, when.' },
    { name: 'journal_summary', args: '{}', description: 'Trading journal statistics from the journal module: win/loss/BE counts, net pnl, per-pair breakdown, recent trades with notes.' },
    { name: 'get_events', args: '{}', description: "This week's economic calendar (high-impact news events: time, country, importance, title)." },
    { name: 'web_search', args: '{"query": "search terms", "max_results": 5}', description: 'Search the web for news, analysis or macro context. Use for anything time-sensitive or outside the tracked pairs.' },
    { name: 'get_time', args: '{}', description: 'Current UTC timestamp.' },
];

export function toolsSystemPrompt() {
    const lines = TOOLS.map(tool => `- ${tool.name} ${tool.args} — ${tool.description}`);
    return [
        '## CONSOLE DATA TOOLS',
        'You can call this dashboard\'s own live functions and use their outputs as data. When you need live data, answer with ONLY one fenced block and no other text:',
        '```tool',
        '{"tool": "get_prices", "args": {}}',
        '```',
        'You will then receive a "TOOL RESULT" message — use it to answer the user in your normal voice.',
        'Available tools:',
        ...lines,
        'All tool access is read-only. You can inspect dashboard data and function capabilities, but you must not create, update, delete, test, send, deliver, or register anything. Use read_functions when asked what the dashboard can do or whether an action is available to you.',
        'Rules: at most 2 tool calls per reply; never invent tool names; never repeat a tool you already called; prefer get_prices/list_alerts/list_triggered/journal_summary for dashboard data; web_search for anything time-sensitive or beyond the tracked pairs.',
        '',
        '## FORMATTING — Markdown cheatsheet (https://github.com/adam-p/markdown-here/wiki/markdown-cheatsheet)',
        'Always render your final answer in Markdown. Use: `# ## ###` headers (h1/h2/h3), `**bold**` + `*italic*` + `~~strike~~` + `***bold+italic***`, `[label](https://url)` links, `![alt](https://url)` images, `` `inline code` ``, fenced blocks ```` ```js ..``` ````, `> blockquotes`, `---` rules, `-`/`1.` lists, `- [x]`/`- [ ]` task lists, `| a | b |` tables with `|---|---|` separators and `:---` / `---:` / `:---:` alignment. Keep tables 2-5 columns, escape inner pipes.',
    ].join('\n');
}

const TOOL_NAMES = new Set(TOOLS.map(tool => tool.name));

export function parseToolCall(text) {
    const fenced = String(text || '').match(/```(?:tool)?\s*\n?(\{[\s\S]*?\})\s*\n?```/);
    const candidates = [];
    if (fenced) candidates.push(fenced[1]);
    for (const line of String(text || '').split('\n')) {
        const trimmed = line.trim();
        if (trimmed.startsWith('{"tool"') || trimmed.startsWith('{ "tool"')) candidates.push(trimmed);
    }
    for (const raw of candidates) {
        try {
            const parsed = JSON.parse(raw);
            const name = String(parsed?.tool || '');
            if (!TOOL_NAMES.has(name)) continue;
            const args = parsed.args && typeof parsed.args === 'object' && !Array.isArray(parsed.args) ? parsed.args : {};
            return { tool: name, args };
        } catch { /* try the next candidate */ }
    }
    return null;
}

export function summarizeToolResult(tool, result) {
    if (!result || result.error) return String(result?.error || 'failed');
    if (tool === 'read_functions') return `${(result.functions || []).length} functions · ${result.access || 'read-only'}`;
    if (tool === 'get_prices') {
        const pairs = Object.keys(result.prices || result || {});
        const first = (result.prices || result)[pairs[0]] || {};
        return `${pairs.length} pairs${first.price !== undefined ? ` · ${pairs[0]} ${first.price}` : ''}`;
    }
    if (tool === 'list_alerts') return `${(result.alerts || result || []).length} pending`;
    if (tool === 'list_triggered') return `${(result.events || result || []).length} events`;
    if (tool === 'journal_summary') return result.trades !== undefined ? `${result.trades} trades · ${result.winRate ?? '—'} win rate` : 'journal';
    if (tool === 'get_events') return `${(result.events || result || []).length} events`;
    if (tool === 'web_search') return `${(result.results || []).length} results`;
    if (tool === 'get_time') return result.utc || '';
    return 'done';
}

function stripTags(html) {
    return String(html || '').replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
}

function parseDdgLite(html, max) {
    const results = [];
    const snippets = [...String(html).matchAll(/<td[^>]*class="result-snippet"[^>]*>([\s\S]*?)<\/td>/g)]
        .map(match => stripTags(match[1]));
    const anchorRe = /<a\b([^>]*)>([\s\S]*?)<\/a>/g;
    let match;
    while ((match = anchorRe.exec(String(html))) && results.length < max) {
        const attrs = match[1] || '';
        if (!/class="[^"]*result-link/.test(attrs)) continue;
        const href = attrs.match(/href="([^"]+)"/)?.[1] || '';
        let url = href;
        const redirect = url.match(/[?&]uddg=([^&]+)/);
        if (redirect) {
            try {
                url = decodeURIComponent(redirect[1]);
            } catch { /* keep raw */ }
        }
        if (!/^https?:\/\//.test(url)) continue;
        results.push({ title: stripTags(match[2]), url, snippet: snippets[results.length] || '' });
    }
    return results;
}

/** Web search: Tavily when a key is saved, keyless DuckDuckGo otherwise. */
export async function webSearch(query, maxResults = 5, { fetchImpl = fetch, apiKey = '' } = {}) {
    const q = String(query || '').trim().slice(0, 200);
    if (!q) return { error: 'Empty search query' };
    const max = Math.min(Math.max(Number(maxResults) || 5, 1), 8);
    if (apiKey) {
        try {
            const response = await fetchImpl('https://api.tavily.com/search', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
                body: JSON.stringify({ query: q, max_results: max, search_depth: 'basic', include_answer: false }),
                signal: AbortSignal.timeout(20_000),
            });
            if (!response.ok) return { error: `Search provider rejected the request (HTTP ${response.status})` };
            const data = await response.json();
            return {
                provider: 'tavily',
                query: q,
                results: (data?.results || []).slice(0, max).map(item => ({
                    title: String(item?.title || '').slice(0, 200),
                    url: String(item?.url || ''),
                    snippet: String(item?.content || '').slice(0, 300),
                })),
            };
        } catch {
            return { error: 'Could not reach the search provider' };
        }
    }
    try {
        const response = await fetchImpl(`https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(q)}`, {
            headers: { 'User-Agent': 'Mozilla/5.0 (PriceAlertConsole/1.0)', Accept: 'text/html' },
            signal: AbortSignal.timeout(20_000),
        });
        if (!response.ok) return { error: `Web search unavailable (HTTP ${response.status})` };
        const results = parseDdgLite(await response.text(), max);
        return { provider: 'duckduckgo', query: q, results };
    } catch {
        return { error: 'Could not reach web search' };
    }
}

/** Compact journal digest from the journal module's backup JSON. */
export function summarizeJournal(payload) {
    const trades = Array.isArray(payload) ? payload : (Array.isArray(payload?.trades) ? payload.trades : []);
    if (!trades.length) return { trades: 0, note: 'No journal trades found' };
    const wins = trades.filter(t => t.outcome === 'WIN').length;
    const losses = trades.filter(t => t.outcome === 'LOSS').length;
    const be = trades.filter(t => t.outcome === 'BE').length;
    const pnlValues = trades.map(t => Number(t.pnl)).filter(Number.isFinite);
    const netPnl = pnlValues.length ? Number(pnlValues.reduce((sum, value) => sum + value, 0).toFixed(2)) : null;
    const byPair = {};
    for (const trade of trades) {
        const key = trade.pair || 'unknown';
        byPair[key] = byPair[key] || { n: 0, wins: 0, pnl: 0 };
        byPair[key].n += 1;
        if (trade.outcome === 'WIN') byPair[key].wins += 1;
        const value = Number(trade.pnl);
        if (Number.isFinite(value)) byPair[key].pnl = Number((byPair[key].pnl + value).toFixed(2));
    }
    return {
        trades: trades.length,
        wins,
        losses,
        be,
        winRate: trades.length ? `${Math.round((wins / trades.length) * 100)}%` : '—',
        netPnl,
        byPair,
        recent: trades.slice(0, 6).map(t => ({
            date: t.date || '',
            pair: t.pair || '',
            dir: t.dir || '',
            outcome: t.outcome || '',
            strategy: t.strategy || '',
            pnl: t.pnl ?? '',
            notes: String(t.notes || '').slice(0, 120),
        })),
    };
}

/**
 * Builds the executor table for the tool loop. Runtimes inject their own data
 * accessors (prices / alerts / triggered / journal); search + time are shared.
 */
export function createToolExecutors({
    getPrices,
    getAlerts,
    getTriggered,
    getJournal,
    fetchImpl = fetch,
    searchApiKey = '',
} = {}) {
    return {
        async exec(tool, args = {}) {
            switch (tool) {
                case 'read_functions':
                    return {
                        access: 'read-only',
                        functions: FUNCTION_CATALOG.map(entry => ({ ...entry })),
                    };
                case 'get_prices': {
                    if (!getPrices) return { error: 'Prices are not available in this runtime' };
                    try {
                        const raw = await getPrices();
                        const prices = {};
                        for (const [symbol, entry] of Object.entries(raw || {}).slice(0, 12)) {
                            prices[symbol] = { price: entry?.price, change: entry?.change, changePercent: entry?.changePercent };
                        }
                        return { prices, at: new Date().toISOString() };
                    } catch {
                        return { error: 'Could not fetch current prices' };
                    }
                }
                case 'list_alerts': {
                    const alerts = await getAlerts?.() || [];
                    return {
                        alerts: alerts.slice(0, 30).map(a => ({
                            id: a.id, pair: a.pair, target: a.target, state: a.state,
                            note: a.note, channel: a.channel, createdAt: a.createdAt,
                        })),
                    };
                }
                case 'list_triggered': {
                    const events = await getTriggered?.() || [];
                    return {
                        events: events.slice(-20).reverse().map(e => ({
                            pair: e.pair, target: e.target, note: e.note,
                            channel: e.channel, triggeredAt: e.triggeredAt, source: e.source,
                        })),
                    };
                }
                case 'journal_summary': {
                    let payload = null;
                    try {
                        payload = await getJournal?.() ?? null;
                    } catch {
                        payload = null;
                    }
                    return summarizeJournal(payload);
                }
                case 'get_events': {
                    try {
                        const from = new Date().toISOString();
                        const to = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
                        const upstream = `https://chartevents-reuters.tradingview.com/events?minImportance=1&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&countries=US,EU,GB,CN,JP`;
                        const response = await fetchImpl(upstream, {
                            headers: { Accept: 'application/json', 'User-Agent': 'Price-Alert/1.0' },
                            signal: AbortSignal.timeout(15_000),
                        });
                        if (!response.ok) return { error: `Calendar unavailable (HTTP ${response.status})` };
                        const data = await response.json();
                        const list = Array.isArray(data?.result) ? data.result : Array.isArray(data) ? data : [];
                        return {
                            events: list.slice(0, 25).map(e => ({
                                time: e?.start || e?.time || e?.date || '',
                                country: e?.country || e?.countryCode || '',
                                importance: e?.importance ?? e?.weight ?? '',
                                title: String(e?.title || e?.name || '').slice(0, 120),
                            })),
                        };
                    } catch {
                        return { error: 'Could not fetch the economic calendar' };
                    }
                }
                case 'web_search':
                    return webSearch(args.query, args.max_results, { fetchImpl, apiKey: searchApiKey });
                case 'get_time':
                    return { utc: new Date().toISOString() };
                default:
                    return { error: `Unknown tool: ${tool}` };
            }
        },
    };
}

// ---------------------------------------------------------------------------
// Offline demo channel — keeps the console alive before any key is saved, and
// demonstrates the tools with real dashboard data.
// ---------------------------------------------------------------------------

function demoToolPlan(prompt) {
    const text = String(prompt || '').toLowerCase();
    const plan = [];
    if (/(function|capabilit|what.{0,12}(can|do|access)|available.{0,12}(tool|action|feature)|read.only)/.test(text)) {
        plan.push({ tool: 'read_functions', args: {} });
    }
    if (/(price|market|gold|xau|eur|btc|bitcoin|nasdaq|s&p|level|structure|momentum|what.{0,12}(doing|moving))/.test(text)) {
        plan.push({ tool: 'get_prices', args: {} });
    }
    if (/(alert|trigger|notify|ladder)/.test(text)) plan.push({ tool: 'list_alerts', args: {} });
    if (/(journal|trade|discipline|win rate|review|performance|dossier)/.test(text)) plan.push({ tool: 'journal_summary', args: {} });
    if (/(search|news|web|forecast|today|this week|macro|headline)/.test(text)) {
        plan.push({ tool: 'web_search', args: { query: String(prompt).slice(0, 120), max_results: 4 } });
    }
    return plan.slice(0, 2);
}

function demoFormatResult(call) {
    const { tool, result } = call;
    if (!result || result.error) return `- ${tool}: ${result?.error || 'unavailable'}`;
    if (tool === 'read_functions') {
        const names = (result.functions || []).map(entry => entry.name).join(', ');
        return `- **Dashboard functions (${result.access || 'read-only'}):** ${names || 'none'}`;
    }
    if (tool === 'get_prices') {
        const rows = Object.entries(result.prices || {}).map(([symbol, entry]) => `  - ${symbol}: ${entry.price ?? '—'}`);
        return [`- **Live prices** (${result.at ? result.at.slice(11, 16) : ''} UTC):`, ...rows].join('\n');
    }
    if (tool === 'list_alerts') {
        const alerts = result.alerts || [];
        if (!alerts.length) return '- **Pending alerts:** none — the board is clear.';
        const rows = alerts.slice(0, 5).map(a => `  - ${a.pair} ${a.state === 'up' ? 'above' : 'below'} ${a.target}${a.note ? ` — ${a.note}` : ''} [${a.channel || '—'}]`);
        return [`- **Pending alerts (${alerts.length}):**`, ...rows].join('\n');
    }
    if (tool === 'journal_summary') {
        if (!result.trades) return '- **Journal:** no trades logged yet.';
        return `- **Journal:** ${result.trades} trades · ${result.wins}W / ${result.losses}L / ${result.be}BE · win rate ${result.winRate}${result.netPnl !== null ? ` · net pnl ${result.netPnl}` : ''}`;
    }
    if (tool === 'web_search') {
        const rows = (result.results || []).slice(0, 4).map(r => `  - ${r.title} — ${r.url}`);
        return [rows.length ? '- **Web search:**' : '- **Web search:** no results.', ...rows].join('\n');
    }
    return `- ${tool}: ${JSON.stringify(result).slice(0, 400)}`;
}

function demoAnswerText({ skill, messages, calls }) {
    const prompt = [...(messages || [])].reverse().find(message => message.role === 'user')?.content || '';
    const subject = prompt.trim().replace(/\s+/g, ' ').slice(0, 120) || 'the market';
    const name = skill?.name || 'Console';
    const lines = [
        `**${name}** · demo channel${skill?.tagline ? ` — ${skill.tagline}` : ''}.`,
        '',
        `Received: "${subject}${prompt.length > 120 ? '...' : ''}"`,
        '',
    ];
    if (calls.length) {
        lines.push('Live data pulled from your console functions:');
        lines.push('');
        for (const call of calls) lines.push(demoFormatResult(call));
        lines.push('');
    }
    lines.push(
        'This reply was assembled by the built-in **demo channel** (no AI key saved yet). The tool calls above are real — the same functions a configured model would use. Save a key in **Settings → AI providers** and the model will reason over this data itself.',
    );
    return lines.join('\n');
}

async function* demoEvents({ skill, messages, exec, model, demoDelayMs }) {
    const prompt = [...(messages || [])].reverse().find(message => message.role === 'user')?.content || '';
    const plan = demoToolPlan(prompt);
    const calls = [];
    for (const call of plan) {
        yield { tool: { name: call.tool, args: call.args, status: 'running' } };
        let result;
        try {
            result = await exec.exec(call.tool, call.args);
        } catch (error) {
            result = { error: String(error?.message || error) };
        }
        const summary = summarizeToolResult(call.tool, result);
        calls.push({ ...call, result, summary });
        yield { tool: { name: call.tool, args: call.args, status: 'done', ok: !result?.error, summary } };
    }
    const text = demoAnswerText({ skill, messages, calls });
    const tokens = text.match(/\S+\s*/g) || [text];
    for (const token of tokens) {
        if (demoDelayMs > 0) await new Promise(resolve => setTimeout(resolve, demoDelayMs));
        yield { delta: token };
    }
    yield {
        done: true,
        provider: 'demo',
        model: model || 'dossier-demo',
        skill: skill?.id || null,
        toolCalls: calls.map(({ tool, args, summary }) => ({ name: tool, args, summary })),
    };
}

// ---------------------------------------------------------------------------
// Public chat entry — shared by both runtimes.
// ---------------------------------------------------------------------------

export function normalizeChatInput(body, { providers = {}, skills = [] } = {}) {
    const skillId = String(body?.skillId || '').trim();
    const skill = listSkills(skills).find(item => item.id === skillId) || null;
    const rawMessages = Array.isArray(body?.messages) ? body.messages : [];
    if (!rawMessages.length) throw new Error('Messages are required');
    if (rawMessages.length > 40) throw new Error('Conversation is too long for one request (max 40 messages)');
    const messages = rawMessages.map(message => {
        const role = ['user', 'assistant', 'system'].includes(message?.role) ? message.role : 'user';
        const content = String(message?.content ?? '').slice(0, 8000);
        return { role, content };
    }).filter(message => message.content.trim());
    if (!messages.length) throw new Error('Messages are required');

    const presetId = String(body?.provider || 'demo').trim();
    let preset = providerById(presetId) || providerById('demo');
    // 'search' entries hold tool keys (e.g. Tavily) — they are not chat channels.
    if (preset.kind === 'search') {
        const error = new Error(`${preset.name} is a search provider, not a chat channel. Pick a chat provider in Settings.`);
        error.publicMessage = error.message;
        error.status = 400;
        throw error;
    }
    const saved = providers[preset.id] || {};
    const model = sanitizeModel(body?.model || saved.model, preset);
    // The skill's system prompt + tool protocol are always prepended server-side
    // so the browser cannot drop the mode or the data-tool contract.
    const systemText = [
        skill?.systemPrompt || '',
        toolsSystemPrompt(),
    ].filter(Boolean).join('\n\n');
    const promptMessages = systemText
        ? [{ role: 'system', content: systemText }, ...messages]
        : messages;
    return { skill, messages: promptMessages, preset, saved, model, stream: body?.stream !== false };
}

const MAX_TOOL_ROUNDS = 3;

function toolResultMessage(call, result) {
    const payload = JSON.stringify(result ?? null).slice(0, 7000);
    return {
        role: 'user',
        content: `TOOL RESULT (${call.tool}):\n${payload}\nUse this data to answer the user. Do not call the same tool again.`,
    };
}

async function* toolLoopStream({ fetchImpl, preset, apiKey, baseUrl, model, skill, messages, exec }) {
    const convo = [...messages];
    const toolCalls = [];
    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
        const request = buildUpstreamRequest({ preset, apiKey, model, baseUrl, messages: convo, stream: true });
        let upstream;
        try {
            upstream = await fetchImpl(request.url, {
                method: 'POST',
                headers: request.headers,
                body: request.body,
                signal: AbortSignal.timeout(90_000),
            });
        } catch {
            yield { error: `Could not reach ${preset.name}. Check the worker's outbound network and try again.` };
            return;
        }
        if (!upstream.ok) {
            yield { error: `${preset.name} rejected the request (HTTP ${upstream.status}). Check the saved key and model name.` };
            return;
        }
        let text = '';
        for await (const delta of streamDeltas(preset.kind, upstream.body)) {
            text += delta;
            yield { delta };
        }
        const call = parseToolCall(text);
        if (!call || round === MAX_TOOL_ROUNDS) {
            yield {
                done: true,
                provider: preset.id,
                model,
                skill: skill?.id || null,
                toolCalls,
            };
            return;
        }
        // The streamed text was a tool-call block — replace it with tool chips.
        yield { reset: true };
        yield { tool: { name: call.tool, args: call.args, status: 'running' } };
        let result;
        let ok = true;
        try {
            result = await exec.exec(call.tool, call.args);
            ok = !result?.error;
        } catch (error) {
            result = { error: String(error?.message || error) };
            ok = false;
        }
        const summary = summarizeToolResult(call.tool, result);
        toolCalls.push({ name: call.tool, args: call.args, summary });
        yield { tool: { name: call.tool, args: call.args, status: 'done', ok, summary } };
        convo.push({ role: 'assistant', content: text });
        convo.push(toolResultMessage(call, result));
    }
}

async function toolLoopJson({ fetchImpl, preset, apiKey, baseUrl, model, skill, messages, exec }) {
    const convo = [...messages];
    const toolCalls = [];
    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
        const request = buildUpstreamRequest({ preset, apiKey, model, baseUrl, messages: convo, stream: false });
        let upstream;
        try {
            upstream = await fetchImpl(request.url, {
                method: 'POST',
                headers: request.headers,
                body: request.body,
                signal: AbortSignal.timeout(90_000),
            });
        } catch {
            const error = new Error(`Could not reach ${preset.name}. Check the worker's outbound network and try again.`);
            error.publicMessage = error.message;
            error.status = 502;
            throw error;
        }
        if (!upstream.ok) {
            const error = new Error(`${preset.name} rejected the request (HTTP ${upstream.status}). Check the saved key and model name.`);
            error.publicMessage = error.message;
            error.status = upstream.status === 401 || upstream.status === 403 ? 402 : 502;
            throw error;
        }
        let data = null;
        try {
            data = await upstream.json();
        } catch {
            const error = new Error(`${preset.name} returned a response the console could not read.`);
            error.publicMessage = error.message;
            error.status = 502;
            throw error;
        }
        const text = parseJsonCompletion(preset.kind, data);
        const call = parseToolCall(text);
        if (!call || round === MAX_TOOL_ROUNDS) {
            return { content: text, toolCalls };
        }
        let result;
        try {
            result = await exec.exec(call.tool, call.args);
        } catch (error) {
            result = { error: String(error?.message || error) };
        }
        toolCalls.push({ name: call.tool, args: call.args, summary: summarizeToolResult(call.tool, result) });
        convo.push({ role: 'assistant', content: text });
        convo.push(toolResultMessage(call, result));
    }
    return { content: '', toolCalls };
}

/**
 * Runs one chat turn with the console data-tool loop. Returns either:
 *   { kind: 'stream', provider, model, skill, events } — async iterable of
 *     { delta } | { reset } | { tool } | { done } | { error } events
 *   { kind: 'json', provider, model, skill, content, toolCalls }
 * Throws Error with .publicMessage for user-facing failures.
 */
export async function runChat(input, {
    providers = {},
    skills = [],
    fetchImpl = fetch,
    demoDelayMs = 18,
    executors = null,
} = {}) {
    const { skill, messages, preset, saved, model, stream } = normalizeChatInput(input, { providers, skills });
    const exec = executors || createToolExecutors({ fetchImpl });

    if (preset.kind === 'demo') {
        if (stream) {
            return {
                kind: 'stream',
                provider: 'demo',
                model: model || 'dossier-demo',
                skill,
                events: demoEvents({ skill, messages, exec, model, demoDelayMs }),
            };
        }
        const calls = [];
        for (const call of demoToolPlan([...messages].reverse().find(m => m.role === 'user')?.content || '')) {
            let result;
            try {
                result = await exec.exec(call.tool, call.args);
            } catch (error) {
                result = { error: String(error?.message || error) };
            }
            calls.push({ ...call, result, summary: summarizeToolResult(call.tool, result) });
        }
        return {
            kind: 'json',
            provider: 'demo',
            model: model || 'dossier-demo',
            skill,
            content: demoAnswerText({ skill, messages, calls }),
            toolCalls: calls.map(({ tool, args, summary }) => ({ name: tool, args, summary })),
        };
    }

    const apiKey = String(saved.apiKey || '').trim();
    if (!apiKey) {
        const error = new Error(`No API key saved for ${preset.name} — open Settings -> AI providers to add one.`);
        error.publicMessage = error.message;
        error.status = 409;
        throw error;
    }
    const baseUrl = saved.baseUrl || preset.baseUrl;

    if (stream) {
        return {
            kind: 'stream',
            provider: preset.id,
            model,
            skill,
            events: toolLoopStream({ fetchImpl, preset, apiKey, baseUrl, model, skill, messages, exec }),
        };
    }
    const { content, toolCalls } = await toolLoopJson({ fetchImpl, preset, apiKey, baseUrl, model, skill, messages, exec });
    return {
        kind: 'json',
        provider: preset.id,
        model,
        skill,
        content,
        toolCalls,
    };
}

/** Validates a saved or to-be-saved key with a minimal upstream call. */
export async function testProvider({ provider, apiKey, model, baseUrl }, { providers = {}, fetchImpl = fetch } = {}) {
    const preset = providerById(provider);
    if (!preset || preset.kind === 'demo') {
        return { ok: true, provider: 'demo', model: 'dossier-demo', sample: 'Demo channel is always available.' };
    }
    const saved = providers[preset.id] || {};
    const key = String(apiKey || saved.apiKey || '').trim();
    const keyError = validateKey(key);
    if (keyError) {
        const err = new Error(keyError);
        err.status = 400;
        throw err;
    }
    if (preset.kind === 'search') {
        const result = await webSearch('cloudflare workers', 1, { fetchImpl, apiKey: key });
        if (result.error) {
            const err = new Error(result.error);
            err.status = 502;
            throw err;
        }
        return {
            ok: true,
            provider: preset.id,
            model: 'web-search',
            sample: result.results?.[0]?.title || `${result.provider} responded`,
        };
    }
    const targetBase = baseUrl || saved.baseUrl || preset.baseUrl;
    if (preset.requiresBaseUrl) {
        const urlError = validateBaseUrl(targetBase);
        if (urlError) {
            const err = new Error(urlError);
            err.status = 400;
            throw err;
        }
    }
    const finalModel = sanitizeModel(model || saved.model, preset);
    const result = await runChat({
        provider: preset.id,
        model: finalModel,
        stream: false,
        messages: [{ role: 'user', content: 'Reply with the single word: ready' }],
    }, {
        providers: { ...providers, [preset.id]: { apiKey: key, model: finalModel, baseUrl: targetBase } },
        fetchImpl,
    });
    return {
        ok: true,
        provider: preset.id,
        model: result.model,
        sample: String(result.content || '').trim().slice(0, 80) || 'OK',
    };
}

// ---------------------------------------------------------------------------
// Settings mutations — shared by the Durable Object and the Node server so
// both runtimes enforce identical rules for keys and custom skills.
// ---------------------------------------------------------------------------

export function upsertProvider(settings, body) {
    const preset = providerById(String(body?.provider || ''));
    if (!preset || preset.keyless) return { error: 'Unknown provider' };
    const providers = { ...(settings.providers || {}) };
    const next = { ...(providers[preset.id] || {}), savedAt: new Date().toISOString() };
    if (body.apiKey !== undefined) {
        const key = String(body.apiKey || '').trim();
        if (key) {
            const keyError = validateKey(key);
            if (keyError) return { error: keyError };
            next.apiKey = key;
        } else {
            delete next.apiKey;
        }
    }
    if (body.baseUrl !== undefined) {
        const baseUrl = String(body.baseUrl || '').trim();
        if (baseUrl) {
            const urlError = validateBaseUrl(baseUrl);
            if (urlError) return { error: urlError };
            next.baseUrl = baseUrl;
        } else {
            delete next.baseUrl;
        }
    }
    if (body.model !== undefined) next.model = sanitizeModel(body.model, preset);
    if (preset.requiresBaseUrl && next.apiKey && !next.baseUrl) {
        return { error: 'Base URL is required for the custom endpoint' };
    }
    if (next.apiKey) providers[preset.id] = next;
    else delete providers[preset.id];

    const activeProvider = body.active === true && providers[preset.id]
        ? preset.id
        : (settings.activeProvider === preset.id && !providers[preset.id] ? 'demo' : settings.activeProvider);
    const activeModel = body.active === true && providers[preset.id]
        ? (next.model || preset.defaultModel)
        : (activeProvider === 'demo' ? '' : settings.activeModel);
    return {
        settings: { ...settings, providers, activeProvider, activeModel },
        provider: providers[preset.id] || null,
    };
}

export function removeProvider(settings, id) {
    const preset = providerById(id);
    if (!preset || preset.keyless) return { error: 'Unknown provider' };
    const providers = { ...(settings.providers || {}) };
    if (!providers[id]) return { error: 'Provider not configured', status: 404 };
    delete providers[id];
    const activeProvider = settings.activeProvider === id ? 'demo' : settings.activeProvider;
    const activeModel = activeProvider === 'demo' ? '' : settings.activeModel;
    return { settings: { ...settings, providers, activeProvider, activeModel } };
}

export function createSkillEntry(settings, body) {
    const skills = Array.isArray(settings.skills) ? [...settings.skills] : [];
    if (skills.length >= 24) return { error: 'Maximum of 24 custom skills reached', status: 409 };
    let skill;
    try {
        skill = sanitizeSkill(body);
    } catch (error) {
        return { error: error.message };
    }
    if (listSkills(skills).some(item => item.id === skill.id)) {
        return { error: 'A skill with this id already exists', status: 409 };
    }
    skills.push(skill);
    return { settings: { ...settings, skills }, skill };
}

export function updateSkillEntry(settings, id, body) {
    const skills = Array.isArray(settings.skills) ? [...settings.skills] : [];
    const index = skills.findIndex(skill => skill.id === id);
    if (index === -1) {
        const builtin = listSkills([]).some(skill => skill.id === id);
        return builtin
            ? { error: 'Built-in skills cannot be modified', status: 403 }
            : { error: 'Skill not found', status: 404 };
    }
    try {
        skills[index] = sanitizeSkill({ ...body, id });
    } catch (error) {
        return { error: error.message };
    }
    return { settings: { ...settings, skills }, skill: skills[index] };
}

export function deleteSkillEntry(settings, id) {
    const skills = Array.isArray(settings.skills) ? [...settings.skills] : [];
    const index = skills.findIndex(skill => skill.id === id);
    if (index === -1) {
        const builtin = listSkills([]).some(skill => skill.id === id);
        return builtin
            ? { error: 'Built-in skills cannot be modified', status: 403 }
            : { error: 'Skill not found', status: 404 };
    }
    skills.splice(index, 1);
    return { settings: { ...settings, skills } };
}
