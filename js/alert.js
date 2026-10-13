import { showError } from "./error.js";
const ALERTS_API = '/api/alerts';
const pairToSymbol = {
    'Gold / USD': 'OANDA:XAUUSD',
    'EUR / USD': 'FX_IDC:EURUSD',
    'BTC / USD': 'BITSTAMP:BTCUSD',
    'GBP / USD': 'FX_IDC:GBPUSD'
};
let alerts = [];
let editingAlertIndex = -1;

const pairInput = document.querySelector('.select-input');
const targetInput = document.querySelector('.target-price');
const noteInput = document.querySelector('.custom-note');
const messanger = document.querySelector('.channel-select');
const addBtn = document.querySelector('.save-btn');
const historyContainer = document.querySelector('.realBox');



function alertCounter() {
    const count = document.querySelector('.history');
    if (!count) return;
    count.textContent = `${alerts.length} alerts`;
    return alerts.length;
}

function clearEditMode() {
    if (!addBtn) return;
    addBtn.textContent = 'Save';
    addBtn.classList.remove('modifi');
    editingAlertIndex = -1;
}

function getDecimalPlaces(value) {
    // Count from the original input so trailing zeros retain their precision.
    return (String(value).split('.')[1] || '').length;
}

export function getAlertValues() {
    const pair = pairInput?.value?.trim() || '';
    const targetInputValue = targetInput?.value?.trim() || '';
    const target = Number(targetInputValue || 0);
    const note = noteInput?.value?.trim() || '';
    const channel = messanger?.value || 'Telegram';
    const symbol = pairToSymbol[pair] || '';

    return {
        pair,
        target,
        targetInputValue,
        targetPrecision: getDecimalPlaces(targetInputValue),
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
        targetInputValue: alert?.targetInputValue ?? String(alert?.target ?? 0),
        targetPrecision: Number.isInteger(alert?.targetPrecision)
            ? alert.targetPrecision
            : getDecimalPlaces(alert?.targetInputValue ?? String(alert?.target ?? 0)),
        note: alert?.note || '',
        channel: alert?.channel || 'Telegram',
        symbol: alert?.symbol || '',
        state: alert?.state || 'up',
    }));
}

async function syncAlertState(alert) {
    const response = await fetch(alert.id ? `${ALERTS_API}/${encodeURIComponent(alert.id)}` : ALERTS_API, {
        method: alert.id ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(alert),
    });
    if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.error || 'Could not save alert');
    }
    return response.json();
}

async function removeAlert(alert) {
    const response = await fetch(`${ALERTS_API}/${encodeURIComponent(alert.id)}`, { method: 'DELETE' });
    if (!response.ok) throw new Error('Could not delete alert');
    alerts = alerts.filter(item => item.id !== alert.id);
    renderAlerts();
}

async function loadAlerts() {
    const response = await fetch(ALERTS_API);
    if (!response.ok) throw new Error('Could not load alerts');
    alerts = await response.json();

    if (alerts.length === 0) {
        try {
            const legacyAlerts = JSON.parse(localStorage.getItem('price-alerts') || '[]');
            if (Array.isArray(legacyAlerts) && legacyAlerts.length) {
                for (const legacyAlert of legacyAlerts) {
                    alerts.push(await syncAlertState(legacyAlert));
                }
                localStorage.removeItem('price-alerts');
            }
        } catch (error) {
            console.error('Could not migrate browser alerts:', error);
        }
    }
    renderAlerts();
}

function fillFormFromAlert(alert) {
    if (!alert) return;
    pairInput.value = alert.pair || '';
    targetInput.value = alert.targetInputValue ?? String(alert.target ?? '');
    noteInput.value = alert.note || '';
    messanger.value = alert.channel || '';
}

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[character]);
}

function renderAlerts() {
    if (!historyContainer) return;

    historyContainer.innerHTML = '';
    alerts = alerts.filter(Boolean);
    alerts.forEach((alert, index) => {
        if (!alert) return;
        const historyBox = document.createElement('div');
        historyBox.classList.add('history-box');

        historyBox.innerHTML = `
            <p class="pair">${escapeHtml(alert.pair)}</p>
            <p>Target: <span class="target-value">${escapeHtml(alert.targetInputValue ?? alert.target)}</span></p>
            <p>Note: <span class="note-value">${escapeHtml(alert.note)}</span></p>
            <p>Channel: <span class="channel-value">${escapeHtml(alert.channel)}</span></p>
            <p>State: <span class="state-value">${escapeHtml(alert.state || 'up')}</span></p>
            <div class="row-actions">
                <button class="mini-btn modify" data-index="${index}">Modify</button>
                <button class="mini-btn danger" data-index="${index}">Delete</button>
            </div>
        `;

        const closeBtn = historyBox.querySelector('.close-btn');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                void removeAlert(alert).catch(error => console.error(error));
                if (alerts[editingAlertIndex] === alert) clearEditMode();
            });
        }

        const deleteBtn = historyBox.querySelector('.danger');
        if (deleteBtn) {
            deleteBtn.addEventListener('click', () => {
                void removeAlert(alert).catch(error => console.error(error));
                if (alerts[editingAlertIndex] === alert) clearEditMode();
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
    void loadAlerts().catch(error => console.error(error));

    addBtn.addEventListener('click', async () => {
        try {
            const wasEditing = editingAlertIndex >= 0;
            const currentAlert = wasEditing ? alerts[editingAlertIndex] : {};
            const savedAlert = await syncAlertState({ ...currentAlert, ...getAlertValues() });
            if (wasEditing) {
                alerts[editingAlertIndex] = savedAlert;
                clearEditMode();
            } else {
                alerts.push(savedAlert);
            }
            renderAlerts();
        } catch (error) {
            console.error('Could not save alert:', error);
            showError("please enter a valid alert with a target price and pair")
        }
    });
}















