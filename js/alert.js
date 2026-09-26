const STORAGE_KEY = 'price-alerts';

let alerts = [];
let editingAlertIndex = -1;

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

function getAlertValues() {
    return {
        pair: pairInput?.value ?? '',
        target: targetInput?.value ?? '',
        note: noteInput?.value ?? '',
        channel: messanger?.value ?? ''
    };
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

    addBtn.addEventListener('click', () => {
        targetFetch(pairInput?.value ?? '', targetInput?.value ?? '');

        if (editingAlertIndex >= 0) {
            alerts[editingAlertIndex] = getAlertValues();
            clearEditMode();
        } else {
            alerts.push(getAlertValues());
        }

        saveAlerts();
        renderAlerts();
    });

    renderAlerts();
}

function targetFetch(alertPairName, alertMessages) {
    return [alertPairName, alertMessages];
}



