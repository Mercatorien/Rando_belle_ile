// =====================================================================
//  JOURNAL DE BORD — étapes planifiées + stats calculées sur le profil
// =====================================================================

const STORE_KEY = 'rando_journal';

// --- Données du profil (chargées depuis le CSV) ---
let pDist = [];       // distance cumulée (km)
let pAlt = [];        // altitude lissée (m)
let pCumPlus = [];    // D+ cumulé (m)
let pCumMoins = [];   // D- cumulé (m)
let totalKm = 0;
let totalPlus = 0;

async function loadProfile() {
    const res = await fetch('data/data.csv');
    const text = await res.text();
    const rows = text.trim().split('\n');
    let cp = 0, cm = 0;
    for (let i = 1; i < rows.length; i++) {
        const c = rows[i].split(';');
        if (c.length >= 3) {
            pDist.push(parseFloat(c[0].replace(',', '.')));
            pAlt.push(parseFloat(c[2].replace(',', '.')));
            cp += c.length >= 4 ? (parseFloat(c[3].replace(',', '.')) || 0) : 0;
            cm += c.length >= 5 ? (parseFloat(c[4].replace(',', '.')) || 0) : 0;
            pCumPlus.push(cp);
            pCumMoins.push(cm);
        }
    }
    totalKm = pDist[pDist.length - 1] || 0;
    totalPlus = cp;
}

// Index du point de profil le plus proche d'une distance (km)
function idxForKm(km) {
    if (pDist.length === 0) return 0;
    let lo = 0, hi = pDist.length - 1;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (pDist[mid] < km) lo = mid + 1;
        else hi = mid;
    }
    if (lo > 0 && Math.abs(pDist[lo - 1] - km) < Math.abs(pDist[lo] - km)) return lo - 1;
    return lo;
}

// Stats déterministes d'une étape entre deux bornes kilométriques
function statsForRange(startKm, endKm) {
    const i0 = idxForKm(startKm);
    const i1 = idxForKm(endKm);
    const slice = pAlt.slice(Math.min(i0, i1), Math.max(i0, i1) + 1);
    return {
        dist: Math.max(0, pDist[i1] - pDist[i0]),
        dplus: Math.max(0, Math.round(pCumPlus[i1] - pCumPlus[i0])),
        dmoins: Math.max(0, Math.round(pCumMoins[i1] - pCumMoins[i0])),
        altMin: slice.length ? Math.round(Math.min(...slice)) : 0,
        altMax: slice.length ? Math.round(Math.max(...slice)) : 0
    };
}

// --- Stockage local ---
function loadJournal() {
    try {
        return JSON.parse(localStorage.getItem(STORE_KEY)) || { stages: [] };
    } catch {
        return { stages: [] };
    }
}
function saveJournal(data) {
    localStorage.setItem(STORE_KEY, JSON.stringify(data));
}

function stageStatus(s) {
    if (s.finishedAt) return 'done';
    if (s.startedAt) return 'in_progress';
    return 'todo';
}

const STATUS_LABEL = { todo: 'À faire', in_progress: 'En cours', done: 'Terminée' };

function fmtDuration(ms) {
    if (!ms || ms < 0) return '–';
    const min = Math.round(ms / 60000);
    const h = Math.floor(min / 60);
    const m = min % 60;
    return h > 0 ? `${h} h ${String(m).padStart(2, '0')}` : `${m} min`;
}

function fmtDate(ts) {
    if (!ts) return '';
    return new Date(ts).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
}

// --- Rendu ---
function render() {
    const data = loadJournal();
    const listEl = document.getElementById('stage-list');
    listEl.innerHTML = '';

    let doneKm = 0, doneDplus = 0;

    data.stages
        .sort((a, b) => a.startKm - b.startKm)
        .forEach(s => {
            const st = statsForRange(s.startKm, s.endKm);
            const status = stageStatus(s);
            if (status === 'done') { doneKm += st.dist; doneDplus += st.dplus; }

            const durMs = (s.startedAt && s.finishedAt) ? (s.finishedAt - s.startedAt) : 0;
            const speed = (durMs > 0 && st.dist > 0) ? (st.dist / (durMs / 3600000)) : 0;

            const card = document.createElement('div');
            card.className = `stage-card status-${status}`;
            card.innerHTML = `
                <div class="stage-head">
                    <span class="stage-name">${escapeHtml(s.name)}</span>
                    <span class="stage-badge">${STATUS_LABEL[status]}</span>
                </div>
                <div class="stage-range">km ${s.startKm} → ${s.endKm}</div>
                <div class="stage-stats">
                    <span>📏 ${st.dist.toFixed(1)} km</span>
                    <span>↗ ${st.dplus} m</span>
                    <span>↘ ${st.dmoins} m</span>
                    <span>⛰️ ${st.altMin}–${st.altMax} m</span>
                </div>
                ${status !== 'todo' ? `
                <div class="stage-real">
                    ${s.startedAt ? `📅 ${fmtDate(s.startedAt)}` : ''}
                    ${durMs ? ` · ⏱️ ${fmtDuration(durMs)}` : ''}
                    ${speed ? ` · 🚶 ${speed.toFixed(1)} km/h` : ''}
                </div>` : ''}
                <textarea class="stage-note" data-id="${s.id}" placeholder="Note (météo, gîte, ressenti…)">${escapeHtml(s.note || '')}</textarea>
                <div class="stage-actions">
                    ${status === 'todo' ? `<button data-act="start" data-id="${s.id}">▶️ Démarrer</button>` : ''}
                    ${status === 'in_progress' ? `<button data-act="finish" data-id="${s.id}">✅ Terminer</button>` : ''}
                    ${status === 'done' ? `<button data-act="reset" data-id="${s.id}">↺ Rouvrir</button>` : ''}
                    <button data-act="delete" data-id="${s.id}" class="danger">🗑️</button>
                </div>
            `;
            listEl.appendChild(card);
        });

    // Progression globale
    const pctKm = totalKm > 0 ? Math.round((doneKm / totalKm) * 100) : 0;
    document.getElementById('prog-km').textContent = `${doneKm.toFixed(1)} / ${totalKm.toFixed(1)} km`;
    document.getElementById('prog-pct').textContent = `${pctKm}%`;
    document.getElementById('prog-dplus').textContent = `${doneDplus} m`;
    document.getElementById('prog-bar-fill').style.width = pctKm + '%';

    if (data.stages.length === 0) {
        listEl.innerHTML = '<p class="empty">Aucune étape planifiée. Ajoute ta première étape ci-dessous 👇</p>';
    }
}

function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// --- Interactions ---
document.getElementById('stage-list').addEventListener('click', e => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const data = loadJournal();
    const s = data.stages.find(x => x.id == btn.dataset.id);
    if (!s) return;

    switch (btn.dataset.act) {
        case 'start': s.startedAt = Date.now(); s.finishedAt = null; break;
        case 'finish': s.finishedAt = Date.now(); if (!s.startedAt) s.startedAt = s.finishedAt; break;
        case 'reset': s.startedAt = null; s.finishedAt = null; break;
        case 'delete':
            if (!confirm(`Supprimer l'étape « ${s.name} » ?`)) return;
            data.stages = data.stages.filter(x => x.id != s.id);
            break;
    }
    saveJournal(data);
    render();
});

document.getElementById('stage-list').addEventListener('change', e => {
    if (!e.target.classList.contains('stage-note')) return;
    const data = loadJournal();
    const s = data.stages.find(x => x.id == e.target.dataset.id);
    if (s) { s.note = e.target.value; saveJournal(data); }
});

document.getElementById('add-form').addEventListener('submit', e => {
    e.preventDefault();
    const name = document.getElementById('f-name').value.trim();
    const startKm = parseFloat(document.getElementById('f-start').value);
    const endKm = parseFloat(document.getElementById('f-end').value);
    if (!name || isNaN(startKm) || isNaN(endKm)) return;
    if (endKm <= startKm) { alert('Le km d\'arrivée doit être supérieur au km de départ.'); return; }

    const data = loadJournal();
    data.stages.push({ id: Date.now(), name, startKm, endKm, note: '', startedAt: null, finishedAt: null });
    saveJournal(data);
    e.target.reset();
    render();
});

// Export JSON
document.getElementById('btn-export').addEventListener('click', () => {
    const data = loadJournal();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `journal-belle-ile-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
});

// --- Init ---
(async () => {
    await loadProfile();
    // Aperçu live des stats pendant la saisie
    const preview = () => {
        const a = parseFloat(document.getElementById('f-start').value);
        const b = parseFloat(document.getElementById('f-end').value);
        const el = document.getElementById('f-preview');
        if (!isNaN(a) && !isNaN(b) && b > a) {
            const st = statsForRange(a, b);
            el.textContent = `≈ ${st.dist.toFixed(1)} km · ↗ ${st.dplus} m · ↘ ${st.dmoins} m`;
        } else {
            el.textContent = '';
        }
    };
    document.getElementById('f-start').addEventListener('input', preview);
    document.getElementById('f-end').addEventListener('input', preview);
    render();
})();
