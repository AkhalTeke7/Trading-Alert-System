/* ---------- navigation (same behaviour as the main page) ---------- */
document.getElementById("backBtn").addEventListener("click", function () {
    if (document.referrer && history.length > 1) history.back();
    else window.location = "./main.html";
});

/* ---------- config ---------- */
const API = "/api/events";
const COUNTRIES = "AR,AU,BR,CA,CN,FR,DE,IN,ID,IT,JP,KR,MX,RU,SA,ZA,TR,GB,US,ERL";
const LOCAL_FALLBACK = "./events.json";

const state = { events: [], imp: "all", country: "all" };

/* ---------- helpers ---------- */
function weekRange() {
    // Monday 00:00 -> next Monday 00:00 (browser local time) - matches TradingView widget
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    return [start, end];
}

function utc4(d) {
    // fixed UTC-4 clock time (no DST handling)
    const s = new Date(d.getTime() - 4 * 3600 * 1000);
    return String(s.getUTCHours()).padStart(2, "0") + ":" + String(s.getUTCMinutes()).padStart(2, "0");
}

function released(ev) {
    // released = its time has passed AND it has a real actual value
    if (ev.date.getTime() > Date.now()) return false;
    const a = ev.actual;
    if (a === null || a === undefined) return false;
    const s = String(a).trim();
    return s !== "" && s !== "-" && s !== "—" && s.toLowerCase() !== "n/a";
}

function esc(v) {
    return String(v ?? "").replace(/[&<>"']/g, c => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
}

function flag(code) {
    const c = code === "ERL" ? "EU" : code;
    if (!/^[A-Z]{2}$/.test(c || "")) return "";
    return String.fromCodePoint(...[...c].map(ch => 127397 + ch.charCodeAt(0)));
}

function fmtVal(v, unit) {
    if (v === null || v === undefined || v === "") return "—";
    const u = unit && unit.length <= 3 ? unit : "";   // long text like "Number of ..." is not a symbol
    if (typeof v === "number") return v.toLocaleString(undefined, { maximumFractionDigits: 3 }) + u;
    return String(v);
}

function normalize(raw) {
    const list = Array.isArray(raw) ? raw : (raw.result || raw.payload || raw.events || []);
    return list.map(e => ({
        id: e.id,
        title: e.title || e.indicator || "Event",
        country: e.country || "",
        date: new Date(e.date),
        importance: Number(e.importance ?? 0),
        actual: e.actual ?? e.actualRaw,
        forecast: e.forecast ?? e.forecastRaw,
        previous: e.previous ?? e.previousRaw,
        unit: e.unit || "",
        period: e.period || "",
        source: e.source || ""
    })).filter(e => !isNaN(e.date));
}

function inWeek(list) {
    const [s, e] = weekRange();
    return list.filter(x => x.date >= s && x.date < e).sort((a, b) => a.date - b.date);
}

/* ---------- loading ---------- */
function setStatus(msg, kind) {
    const el = document.getElementById("status");
    if (!msg) { el.hidden = true; return; }
    el.hidden = false;
    el.className = "status " + (kind || "");
    el.textContent = msg;
}

async function fetchJSON(url) {
    const r = await fetch(url, { headers: { Accept: "application/json" } });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.json();
}

async function load() {
    const [s, e] = weekRange();
    const url = `${API}?minImportance=0&from=${encodeURIComponent(s.toISOString())}&to=${encodeURIComponent(e.toISOString())}&countries=${encodeURIComponent(COUNTRIES)}`;
    setStatus("Loading events…", "loading");

    // 1) primary: same-origin proxy (avoids CORS). Empty = valid, just no weekend events.
    try {
        const data = await fetchJSON(url);
        const list = inWeek(normalize(data));
        state.events = list;
        buildCountries();
        render();
        if (list.length) setStatus("");
        else setStatus("No events scheduled for the rest of this week — check again Monday or set filter to All.", "");
        return;
    } catch (err) {
        console.warn("api/events failed:", err.message || err);
    }

    // 2) fallback: static file next to page
    try {
        const data = await fetchJSON(LOCAL_FALLBACK);
        const list = inWeek(normalize(data));
        if (list.length) {
            state.events = list;
            setStatus("");
            buildCountries();
            render();
            return;
        }
        // empty fallback also counts as loaded
        state.events = list;
        buildCountries();
        render();
        setStatus("No events in events.json for this week.", "");
        return;
    } catch (err) {
        console.warn("events.json fallback failed:", err.message || err);
    }

    state.events = [];
    render();
    setStatus("Couldn't load events — is the dev server running? Open via http://127.0.0.1:3000/news.html (not file://) and restart with npm start. Proxy: GET /api/events", "error");
}

/* ---------- rendering ---------- */
function buildCountries() {
    const sel = document.getElementById("countryFilter");
    const codes = [...new Set(state.events.map(e => e.country).filter(Boolean))].sort();
    sel.innerHTML = '<option value="all">All countries</option>' +
        codes.map(c => `<option value="${esc(c)}">${flag(c)} ${esc(c === "ERL" ? "EU" : c)}</option>`).join("");
    sel.value = state.country;
    if (sel.value !== state.country) { state.country = "all"; sel.value = "all"; }
}

function render() {
    const [s, e] = weekRange();
    const last = new Date(e - 1);
    const opts = { month: "short", day: "numeric" };
    document.getElementById("weekTitle").textContent =
        `${s.toLocaleDateString("en-US", opts)} – ${last.toLocaleDateString("en-US", opts)}, ${last.getFullYear()}`;

    let list = state.events;
    if (state.imp === "1") list = list.filter(x => x.importance >= 1);
    else if (state.imp === "0") list = list.filter(x => x.importance >= 0);
    if (state.country !== "all") list = list.filter(x => x.country === state.country);

    document.getElementById("weekSub").textContent =
        `${list.length} event${list.length === 1 ? "" : "s"} · times in ${Intl.DateTimeFormat().resolvedOptions().timeZone}`;

    const box = document.getElementById("days");
    if (!list.length) { box.innerHTML = ""; return; }

    const groups = new Map();
    list.forEach(ev => {
        const key = ev.date.toDateString();
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(ev);
    });

    let n = 1;
    const todayKey = new Date().toDateString();
    const ordered = [...groups.entries()].sort((a, b) =>
        (b[0] === todayKey) - (a[0] === todayKey));
    box.innerHTML = ordered.map(([key, evs]) => {
        const d = evs[0].date;
        const label = d.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
        const isToday = d.toDateString() === new Date().toDateString();
        const rows = evs.map(ev => {
            const t = ev.date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
            const imp = ev.importance >= 1 ? "high" : ev.importance === 0 ? "mid" : "low";
            return `
            <div class="ev imp-${imp}">
                <span class="ev-time">${esc(t)}<small>${esc(utc4(ev.date))} UTC-4</small></span>
                <span class="ev-dot" title="importance: ${imp}"></span>
                <span class="ev-country">${flag(ev.country)} ${esc(ev.country === "ERL" ? "EU" : ev.country)}</span>
                <span class="ev-title">${released(ev) ? '<span class="rel">Released</span>' : ""}${esc(ev.title)}${ev.period ? ` <em>${esc(ev.period)}</em>` : ""}</span>
                <span class="ev-num"><small>Actual</small>${esc(fmtVal(ev.actual, ev.unit))}</span>
                <span class="ev-num"><small>Forecast</small>${esc(fmtVal(ev.forecast, ev.unit))}</span>
                <span class="ev-num"><small>Previous</small>${esc(fmtVal(ev.previous, ev.unit))}</span>
            </div>`;
        }).join("");
        const num = String(++n).padStart(2, "0");
        return `
        <section class="card day${isToday ? " today" : ""}">
            <div class="card-head">
                <span class="tag">${num} // ${esc(d.toLocaleDateString("en-US", { weekday: "short" }).toUpperCase())}</span>
                <span class="kanji">𐰇</span>
            </div>
            <div class="card-body">
                <h2>${esc(label)}${isToday ? ' <span class="badge">today</span>' : ""}</h2>
                <div class="ev-list">${rows}</div>
            </div>
        </section>`;
    }).join("");
}

/* ---------- events ---------- */
document.getElementById("impFilter").addEventListener("click", ev => {
    const b = ev.target.closest("[data-imp]");
    if (!b) return;
    state.imp = b.dataset.imp;
    document.querySelectorAll("#impFilter .chip").forEach(c => c.classList.toggle("active", c === b));
    render();
});
document.getElementById("countryFilter").addEventListener("change", ev => {
    state.country = ev.target.value;
    render();
});
document.getElementById("refreshBtn").addEventListener("click", load);

load();