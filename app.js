// --- 1. INITIALISATION DE LA CARTE ---
const map = L.map('map').setView([47.32, -3.15], 11); // Centré sur Belle-Île par défaut

// Fonds de carte (OSM et Géoportail IGN en accès libre)
const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 });
const ignOrtho = L.tileLayer('https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=HR.ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal&FORMAT=image/jpeg&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}', { maxZoom: 19 });
const ignRando = L.tileLayer('https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2&STYLE=normal&FORMAT=image/png&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}', { maxZoom: 19 });

ignRando.addTo(map); // Fond par défaut

L.control.layers({
    "IGN Rando": ignRando,
    "IGN Ortho": ignOrtho,
    "OpenStreetMap": osm
}).addTo(map);

// Variables globales pour lier la carte et le graphique
let geojsonLine = null;
let hoverMarker = L.circleMarker([0, 0], { color: 'red', radius: 6, fillOpacity: 1 }).addTo(map);

// --- 2. CHARGEMENT DES DONNÉES (GeoJSON & Excel) ---
async function loadData() {
    try {
        // Chargement du tracé
        const geojsonRes = await fetch('data/gr.geojson');
        const geojsonData = await geojsonRes.json();
        
        // On stocke la première ligne trouvée pour Turf.js (calcul de distance)
        geojsonLine = geojsonData.features.find(f => f.geometry.type === 'LineString');
        
        // Affichage sur la carte
        const trackLayer = L.geoJSON(geojsonData, { style: { color: '#0000FF', weight: 4 } }).addTo(map);
        map.fitBounds(trackLayer.getBounds());

        // Chargement du profil depuis Excel
        const excelRes = await fetch('data/profile_topo_data.xlsx');
        const excelBlob = await excelRes.arrayBuffer();
        
        // Lecture avec SheetJS
        const workbook = XLSX.read(excelBlob, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const rawExcelData = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);

        initChart(rawExcelData);
    } catch (error) {
        console.error("Erreur lors du chargement des données. Assurez-vous que les fichiers sont dans /data/", error);
    }
}

// --- 3. CRÉATION DU GRAPHIQUE INTERACTIF ---
function initChart(data) {
    const ctx = document.getElementById('topo-chart').getContext('2d');
    
    // Extraction des champs nécessaires
    const distances = data.map(row => row.distance_km);
    const altitudes = data.map(row => row.altitude_moyenne_5);

    new Chart(ctx, {
        type: 'line',
        data: {
            labels: distances,
            datasets: [{
                label: 'Altitude moyenne (m)',
                data: altitudes,
                borderColor: '#2e7d32',
                backgroundColor: 'rgba(46, 125, 50, 0.2)',
                fill: true,
                pointRadius: 0, // Masque les points pour plus de fluidité
                tension: 0.2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false
            },
            onHover: (e, activeElements) => {
                // Si on survole le graphique, on déplace le marqueur sur la carte
                if (activeElements.length > 0 && geojsonLine) {
                    const index = activeElements[0].index;
                    const distKm = distances[index];
                    
                    // Turf.js calcule les coordonnées exactes à "distKm" sur la ligne
                    const point = turf.along(geojsonLine, distKm, { units: 'kilometers' });
                    hoverMarker.setLatLng([point.geometry.coordinates[1], point.geometry.coordinates[0]]);
                }
            }
        }
    });
}

// --- 4. GÉOLOCALISATION ET ENREGISTREMENT LOCAL ---
let watchId = null;
let userTrack = []; // Historique de position
let userPathLayer = L.polyline([], { color: 'red', weight: 4 }).addTo(map);

// Récupérer le tracé enregistré s'il existe
const savedTrack = localStorage.getItem('rando_track');
if (savedTrack) {
    userTrack = JSON.parse(savedTrack);
    userPathLayer.setLatLngs(userTrack);
}

document.getElementById('btn-geoloc').addEventListener('click', function(e) {
    const btn = e.target;
    
    if (watchId) {
        // Arrêter le suivi
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
        btn.textContent = "📍 Ma Position";
        btn.classList.remove('btn-geoloc-active');
    } else {
        // Lancer le suivi
        btn.textContent = "🛑 Stop Suivi";
        btn.classList.add('btn-geoloc-active');
        
        watchId = navigator.geolocation.watchPosition(
            (pos) => {
                const latlng = [pos.coords.latitude, pos.coords.longitude];
                
                // Mettre à jour la ligne
                userTrack.push(latlng);
                userPathLayer.setLatLngs(userTrack);
                map.setView(latlng);
                
                // Sauvegarde locale
                localStorage.setItem('rando_track', JSON.stringify(userTrack));
            },
            (err) => console.error("Erreur GPS:", err),
            { enableHighAccuracy: true }
        );
    }
});

// Lancement de l'application
loadData();