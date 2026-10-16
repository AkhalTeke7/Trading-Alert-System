import { showError } from "./error.js";
import { showSuccess } from "./success.js";
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

// Accepts Persian/Arabic digits and separators and returns a plain "12345.67" string.
function normalizeNumberString(raw) {
    return String(raw ?? '')
        .replace(/[۰-۹]/g, digit => String(digit.charCodeAt(0) - 0x06F0))
        .replace(/[٠-٩]/g, digit => String(digit.charCodeAt(0) - 0x0660))
        .replace(/٫/g, '.')
        .replace(/[,٬\s]/g, '');
}

// Returns an error message, or '' when the target is a valid positive number of any length.
function validateTarget(value) {
    if (!value) return 'Enter a target price';
    if (!/^\d+(\.\d+)?$/.test(value)) return 'Target price must be a number like 4168 or 1.2334';
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) return 'Target price must be greater than zero';
    return '';
}

export function getAlertValues() {
    const pair = pairInput?.value?.trim() || '';
    const targetInputValue = normalizeNumberString(targetInput?.value);
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
    updateNoteCount();
}

const noteCount = document.querySelector('.note-count');

function updateNoteCount() {
    if (!noteCount || !noteInput) return;
    noteCount.textContent = `${noteInput.value.length} / ${noteInput.maxLength}`;
}

if (noteInput) noteInput.addEventListener('input', updateNoteCount);

// Keep the target field clean while typing: digits and a single dot, any length.
if (targetInput) {
    targetInput.addEventListener('input', () => {
        let cleaned = normalizeNumberString(targetInput.value).replace(/[^\d.]/g, '');
        const firstDot = cleaned.indexOf('.');
        if (firstDot !== -1) {
            cleaned = cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, '');
        }
        if (cleaned !== targetInput.value) targetInput.value = cleaned;
    });
}

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[character]);
}

/* ---------- details modal ---------- */

let detailsOverlay = null;

function closeDetails() {
    if (!detailsOverlay) return;
    detailsOverlay.remove();
    detailsOverlay = null;
    document.removeEventListener('keydown', onDetailsKeydown);
    document.body.classList.remove('modal-open');
}

function onDetailsKeydown(event) {
    if (event.key === 'Escape') closeDetails();
}

function openDetails(alert) {
    closeDetails();

    detailsOverlay = document.createElement('div');
    detailsOverlay.className = 'details-overlay';
    detailsOverlay.innerHTML = `
        <div class="details-modal" role="dialog" aria-modal="true" aria-label="Alert details">
            <div class="details-head">
                <span class="badge">Alert Details</span>
                <button type="button" class="details-close" aria-label="Close">✕</button>
            </div>
            <h3 class="details-title">${escapeHtml(alert.pair)}</h3>
            <div class="details-grid">
                <div><span class="details-key">Target</span><span class="details-val">${escapeHtml(alert.targetInputValue ?? alert.target)}</span></div>
                <div><span class="details-key">Channel</span><span class="details-val">${escapeHtml(alert.channel)}</span></div>
                <div><span class="details-key">State</span><span class="details-val">${escapeHtml(alert.state || 'up')}</span></div>
            </div>
            <span class="details-key">Note</span>
            <div class="details-note" dir="auto">${escapeHtml(alert.note) || '—'}</div>
        </div>
    `;

    detailsOverlay.addEventListener('click', event => {
        if (event.target === detailsOverlay) closeDetails();
    });
    detailsOverlay.querySelector('.details-close').addEventListener('click', closeDetails);

    document.body.appendChild(detailsOverlay);
    document.body.classList.add('modal-open');
    document.addEventListener('keydown', onDetailsKeydown);
}

function renderAlerts() {
    if (!historyContainer) return;

    historyContainer.innerHTML = '';
    alerts = alerts.filter(Boolean);
    alerts.forEach((alert, index) => {
        if (!alert) return;
        const historyBox = document.createElement('div');
        historyBox.classList.add('history-box');

        const state = alert.state === 'down' ? 'down' : 'up';

        historyBox.innerHTML = `
            <div class="hb-top">
                <div class="hb-title">
                    <p class="pair">${escapeHtml(alert.pair)}</p>
                    <span class="state-badge state-${state}"><span class="state-value">${escapeHtml(alert.state || 'up')}</span></span>
                </div>
                <div class="row-actions">
                    <button class="mini-btn modify" data-index="${index}">Modify</button>
                    <button class="mini-btn danger" data-index="${index}">Delete</button>
                </div>
            </div>

            <div class="hb-meta">
                <div class="hb-item">
                    <span class="hb-key">Target</span>
                    <span class="hb-val target-value">${escapeHtml(alert.targetInputValue ?? alert.target)}</span>
                </div>
                <div class="hb-item">
                    <span class="hb-key">Channel</span>
                    <span class="hb-val channel-value">${escapeHtml(alert.channel)}</span>
                </div>
            </div>

            <div class="note-cell">
                <span class="hb-key">Note</span>
                <button type="button" class="note-box" title="Show full note">
                    <span class="note-text" dir="auto">${escapeHtml(alert.note) || '—'}</span>
                    <span class="note-more">Details ↗</span>
                </button>
            </div>
        `;

        const closeBtn = historyBox.querySelector('.close-btn');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                void removeAlert(alert).catch(error => console.error(error));
                if (alerts[editingAlertIndex] === alert) clearEditMode();
            });
        }

        const noteBox = historyBox.querySelector('.note-box');
        if (noteBox) {
            noteBox.addEventListener('click', () => openDetails(alert));
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
            const values = getAlertValues();
            const targetProblem = validateTarget(values.targetInputValue);
            if (targetProblem) {
                showError(targetProblem);
                return;
            }
            const savedAlert = await syncAlertState({ ...currentAlert, ...values });
            if (wasEditing) {
                alerts[editingAlertIndex] = savedAlert;
                clearEditMode();
            } else {
                alerts.push(savedAlert);
            }
            renderAlerts();
        } catch (error) {
            console.error('Could not save alert:', error);
            // Show the server's real reason (e.g. why a big target was refused) instead of a generic text.
            const reason = error?.message && error.message !== 'Could not save alert' ? error.message : '';
            showError(reason || "please enter a valid alert with a target price and pair");
        }
    });
}

// Website -> Android app: POST /api/test-alert makes the phone ring.
    /*const testPhoneBtn = document.querySelector('.test-phone-btn');
    if (testPhoneBtn) {
        testPhoneBtn.addEventListener('click', async () => {
            const values = getAlertValues();
            testPhoneBtn.disabled = true;
            try {
                const response = await fetch('/api/test-alert', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ pair: values.pair || 'Gold / USD', note: 'Test sound from website' }),
                });
                if (!response.ok) throw new Error('Test request failed');
                showSuccess('Test sent — your phone should ring in a few seconds');
            } catch (error) {
                console.error(error);
                showError('Could not send test sound request');
            } finally {
                testPhoneBtn.disabled = false;
            }
        });
    }*/