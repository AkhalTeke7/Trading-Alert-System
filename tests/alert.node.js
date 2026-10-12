import assert from 'node:assert/strict';
import { test } from 'node:test';

let importId = 0;

async function setup(t, { saving = false } = {}) {
    const listeners = {};
    const fields = {
        '.select-input': { value: 'EUR / USD' },
        '.target-price': { value: ' 1.2300 ' },
        '.custom-note': { value: ' Test alert ' },
        '.channel-select': { value: 'Telegram' },
    };
    const history = { innerHTML: '', appendChild() {} };
    if (saving) {
        fields['.save-btn'] = {
            addEventListener(event, callback) { listeners[event] = callback; },
        };
        fields['.realBox'] = history;
        fields['.history'] = { textContent: '' };
    }
    const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
    globalThis.document = {
        querySelector: selector => fields[selector] ?? null,
        createElement: () => ({
            classList: { add() {} },
            innerHTML: '',
            querySelector: () => null,
        }),
    };
    t.after(() => {
        if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument);
        else delete globalThis.document;
    });
    const module = await import(`../js/alert.js?test=${importId++}`);
    return { ...module, fields, listeners };
}

test('getAlertValues preserves decimal precision, including trailing zeros', async t => {
    const { getAlertValues, fields } = await setup(t);
    assert.deepEqual(getAlertValues(), {
        pair: 'EUR / USD', target: 1.23, targetInputValue: '1.2300',
        targetPrecision: 4, note: 'Test alert', channel: 'Telegram', symbol: 'FX_IDC:EURUSD',
    });
    for (const [input, precision] of [['2500', 0], ['', 0], ['1.', 0], ['0.00001', 5]]) {
        fields['.target-price'].value = input;
        assert.equal(getAlertValues().targetPrecision, precision, input);
    }
});

test('buildAlertArray derives precision for alerts without stored precision', async t => {
    const { buildAlertArray } = await setup(t);
    const alerts = buildAlertArray([
        { target: 1.23, targetInputValue: '1.2300' },
        { target: 1.2345 },
        { target: 2500 },
        { target: 1.23, targetPrecision: 0 },
        { target: 1.23, targetPrecision: 3 },
        {},
    ]);
    assert.deepEqual(alerts.map(alert => alert.targetPrecision), [4, 4, 0, 0, 3, 0]);
});

test('Save posts the alert with precision and adds it to the alert list', async t => {
    const errors = [];
    t.mock.method(console, 'error', (...args) => errors.push(args));
    const requests = [];
    t.mock.method(globalThis, 'fetch', async (url, options) => {
        if (!options) {
            // An existing alert avoids the unrelated localStorage migration path.
            return { ok: true, json: async () => [{ id: 'existing', pair: 'Gold / USD', target: 2500 }] };
        }
        requests.push({ url, ...options });
        return { ok: true, json: async () => ({ id: 'saved', ...JSON.parse(options.body) }) };
    });
    const { listeners, buildAlertArray, fields } = await setup(t, { saving: true });
    await new Promise(resolve => setImmediate(resolve));
    await listeners.click();

    assert.deepEqual(errors, []);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, '/api/alerts');
    assert.equal(requests[0].method, 'POST');
    const saved = JSON.parse(requests[0].body);
    assert.equal(saved.target, 1.23);
    assert.equal(saved.targetInputValue, '1.2300');
    assert.equal(saved.targetPrecision, 4);
    assert.equal(buildAlertArray().length, 2);
    assert.equal(fields['.history'].textContent, '2 alerts');
});
