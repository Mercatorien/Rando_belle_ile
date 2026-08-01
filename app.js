// --- 1. INITIALISATION DE LA CARTE ---
const map = L.map('map').setView([47.32, -3.15], 11);

const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 });
const ignRando = L.tileLayer('https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2&STYLE=normal&FORMAT=image/png&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}', { maxZoom: 19 });
ignRando.addTo(map);

L.control.layers({ "IGN Rando": ignRando, "OpenStreetMap": osm }).addTo(map);

let geojsonLine = null; // Stockera la ligne exploitée par Turf.js

// Données du profil topographique (rendues globales pour le suivi live)
let profileDistances = [];   // distance cumulée (km) à chaque point
let profileAltitudes = [];   // altitude lissée (m)
let profileCumDplus = [];    // D+ cumulé (m) depuis le départ
let totalDistanceKm = 0;
let totalDplus = 0;

// Position live projetée sur le profil
let liveIndex = null;
let topoChart = null;

const OFFTRACK_THRESHOLD_M = 50; // seuil d'alerte hors-sentier

let hoverMarker = L.circleMarker([0, 0], {
    radius: 8, 
    color: '#fff', 
    weight: 2, 
    fillColor: '#0078A8', 
    fillOpacity: 1 
});

// --- 2. CHARGEMENT DES DONNÉES (GeoJSON & CSV) ---
async function loadData() {
    try {
        // 1. Chargement et affichage du tracé
        const geojsonRes = await fetch('data/gr.geojson');
        const geojsonData = await geojsonRes.json();
        
        // CORRECTION : On extrait et on fusionne tous les segments du MultiLineString
        let allCoordinates = [];
        turf.flatten(geojsonData).features.forEach(f => {
            if (f.geometry.type === 'LineString') {
                // On ajoute les coordonnées de chaque segment bout à bout
                allCoordinates = allCoordinates.concat(f.geometry.coordinates);
            }
        });

        // On crée une seule ligne continue (LineString) pour Turf.js
        if (allCoordinates.length > 0) {
            geojsonLine = turf.lineString(allCoordinates);
        } else {
            console.error("Aucune coordonnée de ligne trouvée dans le GeoJSON.");
        }

        // Affichage sur la carte (on affiche le fichier brut original)
        const trackLayer = L.geoJSON(geojsonData, { style: { color: '#2e7d32', weight: 5 } }).addTo(map);
        map.fitBounds(trackLayer.getBounds());

        // 2. Chargement et parsing du CSV
        const csvRes = await fetch('data/data.csv');
        const csvText = await csvRes.text();
        const rows = csvText.trim().split('\n');
        
        let cumDplus = 0;
        for (let i = 1; i < rows.length; i++) {
            const cols = rows[i].split(';');
            if (cols.length >= 3) {
                profileDistances.push(parseFloat(cols[0].replace(',', '.')));
                profileAltitudes.push(parseFloat(cols[2].replace(',', '.')));
                // d_plus (colonne 4) = dénivelé positif du segment ; on cumule
                const dPlus = cols.length >= 4 ? parseFloat(cols[3].replace(',', '.')) || 0 : 0;
                cumDplus += dPlus;
                profileCumDplus.push(cumDplus);
            }
        }

        totalDistanceKm = profileDistances[profileDistances.length - 1] || 0;
        totalDplus = cumDplus;

        initChart(profileDistances, profileAltitudes);
    } catch (error) {
        console.error("Erreur lors du chargement des données :", error);
    }
}

// --- 3. CRÉATION DU GRAPHIQUE ET INTERACTIVITÉ ---

// Plugin pour dessiner la barre verticale rouge
const verticalLinePlugin = {
    id: 'verticalLine',
    afterDraw: chart => {
        if (chart.tooltip?._active?.length) {
            const x = chart.tooltip._active[0].element.x;
            const ctx = chart.ctx;
            ctx.save();
            ctx.beginPath();
            ctx.moveTo(x, chart.scales.y.top);
            ctx.lineTo(x, chart.scales.y.bottom);
            ctx.lineWidth = 2;
            ctx.strokeStyle = 'rgba(255, 0, 0, 0.8)';
            ctx.stroke();
            ctx.restore();
        }
    }
};

// Plugin pour marquer la position GPS live (barre + point bleus) sur le profil
const livePositionPlugin = {
    id: 'livePosition',
    afterDraw: chart => {
        if (liveIndex === null || liveIndex < 0) return;
        const x = chart.scales.x.getPixelForValue(liveIndex);
        const y = chart.scales.y.getPixelForValue(profileAltitudes[liveIndex]);
        const ctx = chart.ctx;
        ctx.save();
        // barre verticale bleue
        ctx.beginPath();
        ctx.moveTo(x, chart.scales.y.top);
        ctx.lineTo(x, chart.scales.y.bottom);
        ctx.lineWidth = 2;
        ctx.strokeStyle = 'rgba(0, 120, 168, 0.9)';
        ctx.stroke();
        // point de position
        ctx.beginPath();
        ctx.arc(x, y, 6, 0, 2 * Math.PI);
        ctx.fillStyle = '#0078A8';
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.fill();
        ctx.stroke();
        ctx.restore();
    }
};

function initChart(distances, altitudes) {
    const ctx = document.getElementById('topo-chart').getContext('2d');
    
    // Fonction qui déplace le point sur la carte
    const updateMapMarker = (activeElements) => {
        if (activeElements.length > 0 && geojsonLine) {
            const index = activeElements[0].index;
            const distanceKm = distances[index];
            
            try {
                // turf.along trouve les coordonnées exactes à X kilomètres sur le tracé
                const point = turf.along(geojsonLine, distanceKm, { units: 'kilometers' });
                const latlng = [point.geometry.coordinates[1], point.geometry.coordinates[0]];
                
                // Affiche le marqueur s'il n'est pas encore sur la carte
                if (!map.hasLayer(hoverMarker)) {
                    hoverMarker.addTo(map);
                }
                
                // Déplace le marqueur et centre la carte
                hoverMarker.setLatLng(latlng);
                // On utilise panTo pour un effet de glissement fluide
                map.panTo(latlng, { animate: true, duration: 0.25 });
            } catch (err) {
                console.error("Erreur de calcul de la position :", err);
            }
        }
    };

    topoChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: distances,
            datasets: [{
                label: 'Altitude (m)',
                data: altitudes,
                borderColor: '#4caf50',
                backgroundColor: 'rgba(76, 175, 80, 0.2)',
                fill: true,
                pointRadius: 0, // Cache les points pour plus de fluidité
                tension: 0.1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { 
                mode: 'index', 
                intersect: false // Permet de déclencher l'événement sans être exactement sur la ligne
            },
            plugins: {
                tooltip: {
                    callbacks: {
                        title: (context) => `Distance : ${context[0].label} km`,
                        label: (context) => `Altitude : ${context.parsed.y} m`
                    }
                }
            },
            // Gère le survol à la souris (PC)
            onHover: (e, activeElements) => updateMapMarker(activeElements),
            // Gère le toucher (Mobile)
            onClick: (e, activeElements) => updateMapMarker(activeElements)
        },
        plugins: [verticalLinePlugin, livePositionPlugin]
    });
}

// --- 3bis. SUIVI LIVE : projette la position GPS sur le tracé et le profil ---
function updateLiveTracking(latlng) {
    if (!geojsonLine) return;

    // Point du tracé le plus proche + distance parcourue le long du GR
    const userPt = turf.point([latlng[1], latlng[0]]); // turf = [lng, lat]
    const snapped = turf.nearestPointOnLine(geojsonLine, userPt, { units: 'kilometers' });
    const doneKm = snapped.properties.location;          // distance depuis le départ
    const offTrackM = snapped.properties.dist * 1000;    // écart au tracé (m)

    // Index du point de profil le plus proche de la distance parcourue
    liveIndex = nearestProfileIndex(doneKm);

    // Mise à jour du bandeau de stats
    const leftKm = Math.max(0, totalDistanceKm - doneKm);
    const dplusLeft = liveIndex !== null
        ? Math.max(0, Math.round(totalDplus - profileCumDplus[liveIndex]))
        : 0;
    const pct = totalDistanceKm > 0 ? Math.round((doneKm / totalDistanceKm) * 100) : 0;
    const altNow = liveIndex !== null ? Math.round(profileAltitudes[liveIndex]) : '–';

    document.getElementById('live-stats').classList.remove('hidden');
    document.getElementById('st-alt').textContent = altNow;
    document.getElementById('st-done').textContent = doneKm.toFixed(1);
    document.getElementById('st-left').textContent = leftKm.toFixed(1);
    document.getElementById('st-dplus').textContent = dplusLeft;
    document.getElementById('st-pct').textContent = pct + '%';

    // Redessine le profil pour afficher la position live
    if (topoChart) topoChart.render();

    // Met à jour l'avancement des étapes planifiées du journal
    updateStageProgress(doneKm);

    // Alerte hors-sentier (#3)
    const alertEl = document.getElementById('offtrack-alert');
    if (offTrackM > OFFTRACK_THRESHOLD_M) {
        if (alertEl.classList.contains('hidden')) {
            if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
        }
        alertEl.textContent = `⚠️ Hors sentier (${Math.round(offTrackM)} m)`;
        alertEl.classList.remove('hidden');
    } else {
        alertEl.classList.add('hidden');
    }
}

// Avancement automatique des étapes planifiées (journal de bord)
// Une étape passe en "en cours" quand on franchit son km de départ,
// et en "terminée" quand on franchit son km d'arrivée. Les horodatages
// permettent de calculer durée et vitesse dans le journal.
function updateStageProgress(doneKm) {
    let data;
    try {
        data = JSON.parse(localStorage.getItem('rando_journal')) || { stages: [] };
    } catch {
        return;
    }
    if (!data.stages || data.stages.length === 0) return;

    let changed = false;
    const now = Date.now();
    data.stages.forEach(s => {
        if (doneKm >= s.endKm) {
            if (!s.startedAt) { s.startedAt = now; changed = true; }
            if (!s.finishedAt) { s.finishedAt = now; changed = true; }
        } else if (doneKm >= s.startKm) {
            if (!s.startedAt) { s.startedAt = now; changed = true; }
        }
    });

    if (changed) localStorage.setItem('rando_journal', JSON.stringify(data));
}

// Recherche binaire de l'index de profil le plus proche d'une distance (km)
function nearestProfileIndex(km) {
    if (profileDistances.length === 0) return null;
    let lo = 0, hi = profileDistances.length - 1;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (profileDistances[mid] < km) lo = mid + 1;
        else hi = mid;
    }
    // compare le voisin précédent pour prendre le plus proche
    if (lo > 0 && Math.abs(profileDistances[lo - 1] - km) < Math.abs(profileDistances[lo] - km)) {
        return lo - 1;
    }
    return lo;
}

// --- 4. GÉOLOCALISATION ---
let watchId = null;
let userTrack = [];
let userPathLayer = L.polyline([], { color: '#d32f2f', weight: 4 }).addTo(map);
let userMarker = null; // Le gros point GPS

document.getElementById('btn-geoloc').addEventListener('click', function(e) {
    const btn = e.target;
    if (watchId) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
        btn.textContent = "📍 Ma Position";
        btn.classList.remove('btn-geoloc-active');
        // On masque le suivi live
        liveIndex = null;
        document.getElementById('live-stats').classList.add('hidden');
        document.getElementById('offtrack-alert').classList.add('hidden');
        if (topoChart) topoChart.render();
    } else {
        btn.textContent = "🛑 Stop Suivi";
        btn.classList.add('btn-geoloc-active');
        
        watchId = navigator.geolocation.watchPosition(
            (pos) => {
                const latlng = [pos.coords.latitude, pos.coords.longitude];
                if (!userMarker) {
                    userMarker = L.circleMarker(latlng, { 
                        radius: 12, 
                        color: '#fff', 
                        weight: 3, 
                        fillColor: '#d32f2f', 
                        fillOpacity: 1 
                    }).addTo(map);
                } else {
                    userMarker.setLatLng(latlng);
                }
                userTrack.push(latlng);
                userPathLayer.setLatLngs(userTrack);
                map.setView(latlng);

                // #1 + #2 + #3 : projection sur profil, stats live et alerte hors-sentier
                updateLiveTracking(latlng);
            },
            (err) => alert("Erreur GPS : Veuillez autoriser la localisation."),
            { enableHighAccuracy: true }
        );
    }
});

loadData();