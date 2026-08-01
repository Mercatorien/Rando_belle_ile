// --- 1. INITIALISATION DE LA CARTE ---
const map = L.map('map').setView([47.32, -3.15], 11);

const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 });
const ignRando = L.tileLayer('https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2&STYLE=normal&FORMAT=image/png&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}', { maxZoom: 19 });
ignRando.addTo(map);

L.control.layers({ "IGN Rando": ignRando, "OpenStreetMap": osm }).addTo(map);

let geojsonLine = null; // Stockera la ligne exploitée par Turf.js
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
        
        const distances = [];
        const altitudes = [];
        
        for (let i = 1; i < rows.length; i++) {
            const cols = rows[i].split(';');
            if (cols.length >= 3) {
                distances.push(parseFloat(cols[0].replace(',', '.')));
                altitudes.push(parseFloat(cols[2].replace(',', '.'))); 
            }
        }

        initChart(distances, altitudes);
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

    new Chart(ctx, {
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
        plugins: [verticalLinePlugin]
    });
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
            },
            (err) => alert("Erreur GPS : Veuillez autoriser la localisation."),
            { enableHighAccuracy: true }
        );
    }
});

loadData();