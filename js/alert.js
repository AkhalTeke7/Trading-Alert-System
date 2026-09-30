const STORAGE_KEY = 'price-alerts';

let alerts = [];
let editingAlertIndex = -1;
let isCheckingAlerts = false;

const pairInput = document.querySelector('.select-input');
const targetInput = document.querySelector('.target-price');
const noteInput = document.querySelector('.custom-note');
const messanger = document.querySelector('.channel-select');
const addBtn = document.querySelector('.save-btn');
const historyContainer = document.querySelector('.realBox');

function loadAlerts() {
    try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
        return Array.isArray(saved) ? saved : [];
    } catch {
        return [];
    }
}

function saveAlerts() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(alerts));
    } catch {
        // ignore storage errors
    }
}

function alertCounter() {
    const count = document.querySelector('.history');
    if (!count) return;
    count.textContent = `${alerts.length} alerts`;
}

function clearEditMode() {
    if (!addBtn) return;
    addBtn.textContent = 'Save';
    addBtn.classList.remove('modifi');
    editingAlertIndex = -1;
}

export function getAlertValues() {
    const pair = pairInput?.value?.trim() || '';
    const target = Number(targetInput?.value ?? 0);
    const note = noteInput?.value?.trim() || '';
    const channel = messanger?.value || 'Telegram';
    const symbol = pairToSymbol[pair] || '';

    return {
        pair,
        target,
        note,
        channel,
        symbol,
    };
}

export function buildAlertPairs(alertList = alerts) {
    return (Array.isArray(alertList) ? alertList : [])
        .map(alert => alert?.pair)
        .filter(Boolean);
}
//return alerts in array that corrently exist
export function buildAlertArray(alertList = alerts) {
    return (Array.isArray(alertList) ? alertList : []).map(alert => ({
        pair: alert?.pair || '',
        target: Number(alert?.target ?? 0),
        note: alert?.note || '',
        channel: alert?.channel || 'Telegram',
        symbol: alert?.symbol || '',
        state: alert?.state || 'up',
    }));
}

async function syncAlertState(alert) {
    const prices = await fetchPrices();
    const current = Number(prices?.[alert.symbol]?.price ?? 0);
    const target = Number(alert.target ?? 0);
    alert.currentPrice = current;
    alert.state = current < target ? 'up' : 'down';
    return alert;
}

async function fetchPrices() {
    const response = await fetch('/api/prices');
    if (!response.ok) throw new Error('Could not load current prices');
    return response.json();
}

async function sendAlert(alert) {
    const response = await fetch('/api/alerts/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            pair: alert.pair,
            target: alert.target,
            note: alert.note,
            channel: alert.channel,
        }),
    });

    if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.error || 'Could not send alert');
    }
}

function fillFormFromAlert(alert) {
    if (!alert) return;
    pairInput.value = alert.pair || '';
    targetInput.value = alert.target || '';
    noteInput.value = alert.note || '';
    messanger.value = alert.channel || '';
}

function renderAlerts() {
    if (!historyContainer) return;

    historyContainer.innerHTML = '';

    alerts.forEach((alert, index) => {
        const historyBox = document.createElement('div');
        historyBox.classList.add('history-box');

        historyBox.innerHTML = `
            <button class="close-btn" aria-label="Remove alert">X</button>
            <p class="pair">${alert.pair}</p>
            <p>Target: <span class="target-value">${alert.target}</span></p>
            <p>Note: <span class="note-value">${alert.note}</span></p>
            <p>Channel: <span class="channel-value">${alert.channel}</span></p>
            <p>State: <span class="state-value">${alert.state || 'up'}</span></p>
            <div class="row-actions">
                <button class="mini-btn modify" data-index="${index}">Modify</button>
                <button class="mini-btn danger" data-index="${index}">Delete</button>
            </div>
        `;

        const closeBtn = historyBox.querySelector('.close-btn');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                alerts.splice(index, 1);
                if (editingAlertIndex === index) clearEditMode();
                saveAlerts();
                renderAlerts();
            });
        }

        const deleteBtn = historyBox.querySelector('.danger');
        if (deleteBtn) {
            deleteBtn.addEventListener('click', () => {
                alerts.splice(index, 1);
                if (editingAlertIndex === index) clearEditMode();
                saveAlerts();
                renderAlerts();
            });
        }

        const modifyBtn = historyBox.querySelector('.modify');
        if (modifyBtn) {
            modifyBtn.addEventListener('click', () => {
                editingAlertIndex = index;
                addBtn.textContent = 'Update';
                addBtn.classList.add('modifi');
                fillFormFromAlert(alerts[index]);
            });
        }

        historyContainer.appendChild(historyBox);
    });

    alertCounter();
}

if (addBtn && historyContainer) {
    alerts = loadAlerts();

    addBtn.addEventListener('click', async () => {
        const newAlert = getAlertValues();
        const alertWithState = await syncAlertState(newAlert);

        if (editingAlertIndex >= 0) {
            alerts[editingAlertIndex] = alertWithState;
            clearEditMode();
        } else {
            alerts.push(alertWithState);
        }

        saveAlerts();
        renderAlerts();
    });

    renderAlerts();
}

function targetFetch(alertPairName, alertMessages) {
    const values = [];

    if (alertPairName) values.push(alertPairName);
    if (Array.isArray(alertMessages)) {
        values.push(...alertMessages.filter(Boolean));
    }

    return values;
}
const pairToSymbol = {
    'Gold / USD': 'OANDA:XAUUSD',
    'EUR / USD': 'FX_IDC:EURUSD',
    'BTC / USD': 'BITSTAMP:BTCUSD',
    'GBP / USD': 'FX_IDC:GBPUSD'
};
async function checkAlerts() {
    if (isCheckingAlerts) return;
    isCheckingAlerts = true;

    try {
        const prices = await fetchPrices();

        for (const alert of alerts) {
            if (alert.triggered) continue;

            const priceKey = pairToSymbol[alert.pair];
            const current = Number(prices[priceKey]?.price);

            if (Number.isFinite(current) && compare(alert.target, current, alert.state)) {
                await sendAlert(alert);
                alert.triggered = true;
                saveAlerts();
            }
        }
    } catch (error) {
        console.error('Could not check price alerts:', error);
    } finally {
        isCheckingAlerts = false;
    }
}

function compare(target, current, state) {
    if (state === 'up') return current >= target;
    if (state === 'down') return current <= target;
    return false;
}

void checkAlerts();
setInterval(() => {
    void checkAlerts();
}, 5 * 60 * 1000);