const APP_VERSION = "3.4.8";
let isAdmin = false;
let cachedVehicles = null;
let cachedLocations = null;
let currentOpenedVehicleId = null;
let lastRefreshTime = new Date();
let currentFilter = 'all';

// Helper to ensure strings are uppercase
const upper = (str) => (str || '').toString().toUpperCase().trim();

// Helper to normalize text removing accents/diacritics and uppercasing
window.normalizeVehicleText = function (str) {
    if (!str) return '';
    return str
        .toString()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toUpperCase()
        .trim();
};

// Helper per convertire il mese (stringa o numero) in indice 1-12
window.parseMonthNumber = function (monthStr) {
    if (!monthStr) return null;
    const s = String(monthStr).trim().toUpperCase();
    const map = {
        'GENNAIO': 1, 'GEN': 1, '01': 1, '1': 1,
        'FEBBRAIO': 2, 'FEB': 2, '02': 2, '2': 2,
        'MARZO': 3, 'MAR': 3, '03': 3, '3': 3,
        'APRILE': 4, 'APR': 4, '04': 4, '4': 4,
        'MAGGIO': 5, 'MAG': 5, '05': 5, '5': 5,
        'GIUGNO': 6, 'GIU': 6, '06': 6, '6': 6,
        'LUGLIO': 7, 'LUG': 7, '07': 7, '7': 7,
        'AGOSTO': 8, 'AGO': 8, '08': 8, '8': 8,
        'SETTEMBRE': 9, 'SET': 9, '09': 9, '9': 9,
        'OTTOBRE': 10, 'OTT': 10, '10': 10,
        'NOVEMBRE': 11, 'NOV': 11, '11': 11,
        'DICEMBRE': 12, 'DIC': 12, '12': 12
    };
    return map[s] || null;
};

// Calcolo stima km a fine Dicembre partendo dai km del mezzo e dai km mensili della sede,
// scalando i giorni già trascorsi nel mese corrente
window.calculateDecemberKmEstimate = function (currentKm, monthStr, stationMonthlyKm, customDate = null) {
    const km = parseInt(currentKm, 10) || 0;
    if (km <= 0) {
        return { estimatedKm: 0, deltaKm: 0, remainingMonths: 0, daysRemaining: 0, fullMonths: 0, label: '-' };
    }
    
    const now = customDate instanceof Date ? customDate : new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1; // 1-12
    const currentDay = now.getDate();
    
    // Giorni totali nel mese corrente
    const daysInMonth = new Date(currentYear, currentMonth, 0).getDate();
    // Giorni rimanenti del mese corrente scalando i giorni passati
    const daysRemaining = Math.max(0, daysInMonth - currentDay);
    const fractionMonth = daysInMonth > 0 ? (daysRemaining / daysInMonth) : 0;
    
    // Mesi interi successivi fino a Dicembre (mesi da currentMonth + 1 a 12)
    const fullMonths = Math.max(0, 12 - currentMonth);
    
    const totalMonthsRemaining = fractionMonth + fullMonths;
    const monthlyRate = Number(stationMonthlyKm) || 0;
    const deltaKm = Math.round(totalMonthsRemaining * monthlyRate);
    const estimatedKm = km + deltaKm;
    
    let label = '';
    if (fullMonths > 0 && daysRemaining > 0) {
        label = `${fullMonths} ${fullMonths === 1 ? 'mese' : 'mesi'} e ${daysRemaining} gg`;
    } else if (fullMonths > 0) {
        label = `${fullMonths} ${fullMonths === 1 ? 'mese' : 'mesi'}`;
    } else if (daysRemaining > 0) {
        label = `${daysRemaining} gg`;
    } else {
        label = 'Fine anno';
    }
    
    return {
        estimatedKm,
        deltaKm,
        remainingMonths: totalMonthsRemaining,
        daysRemaining,
        fullMonths,
        label
    };
};

// Helper per generare il nome del file Word: "richiesta riparazione <SIGLA> <TARGA>.docx"
window.buildRepairFileName = function (vehicle) {
    if (!vehicle) return 'richiesta riparazione.docx';
    const sigla = (vehicle.sigla || '').trim();
    const plate = (vehicle.plate || '').trim();
    const model = (vehicle.model || '').trim();

    const parts = ['richiesta riparazione'];
    if (sigla) parts.push(sigla);
    if (plate) {
        const plateCompact = plate.replace(/\s+/g, '').toUpperCase();
        const siglaCompact = sigla.replace(/\s+/g, '').toUpperCase();
        if (!siglaCompact.includes(plateCompact)) {
            parts.push(plate);
        }
    }
    if (!sigla && !plate && model) {
        parts.push(model);
    }

    let fileName = parts.join(' ').replace(/\s+/g, ' ').trim();
    fileName = fileName.replace(/[\\/:*?"<>|]/g, "_");
    if (!fileName.toLowerCase().endsWith('.docx')) {
        fileName += '.docx';
    }
    return fileName;
};

// Funzione legacy per sincronizzazione richiesta lavaggio ECHO 22:
// Disabilitata per evitare la ricreazione automatica di richieste cancellate dall'amministratore
window.syncHistoricalWashRequest = async function (vehicles) {
    return;
};

// Helper to format date strings from YYYY-MM-DD to DD/MM/YYYY
function formatDate(dateStr) {
    if (!dateStr) return '';
    if (typeof dateStr === 'string' && /^\d{2}\/\d{2}\/\d{4}$/.test(dateStr)) {
        return dateStr;
    }
    if (typeof dateStr === 'string' && dateStr.includes('-')) {
        const clean = dateStr.split('T')[0].trim();
        const parts = clean.split('-');
        if (parts.length === 3) {
            const [year, month, day] = parts;
            return `${day.padStart(2, '0')}/${month.padStart(2, '0')}/${year}`;
        }
    }
    try {
        const d = new Date(dateStr);
        if (!isNaN(d.getTime())) {
            const day = String(d.getDate()).padStart(2, '0');
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const year = d.getFullYear();
            return `${day}/${month}/${year}`;
        }
    } catch (e) {}
    return String(dateStr);
}

// Helper to parse date strings (both DD/MM/YYYY and YYYY-MM-DD) into Date objects
window.parseInterventionDate = function (dStr) {
    if (!dStr) return null;
    if (dStr instanceof Date) return isNaN(dStr.getTime()) ? null : dStr;
    const str = dStr.toString().trim();
    if (str.includes('/')) {
        const parts = str.split('/');
        if (parts.length === 3) {
            const day = parseInt(parts[0], 10);
            const month = parseInt(parts[1], 10) - 1;
            const year = parseInt(parts[2], 10);
            const d = new Date(year, month, day);
            return isNaN(d.getTime()) ? null : d;
        }
    }
    if (str.includes('-')) {
        const clean = str.split('T')[0].trim();
        const parts = clean.split('-');
        if (parts.length === 3) {
            const year = parseInt(parts[0], 10);
            const month = parseInt(parts[1], 10) - 1;
            const day = parseInt(parts[2], 10);
            const d = new Date(year, month, day);
            return isNaN(d.getTime()) ? null : d;
        }
    }
    const d = new Date(str);
    return isNaN(d.getTime()) ? null : d;
};

// Helper to calculate days spent in workshop (both concluded and ongoing)
window.calculateStayDays = function (dateInStr, dateOutStr) {
    const dIn = window.parseInterventionDate(dateInStr);
    if (!dIn) return { days: 0, isOngoing: false };

    const dOut = window.parseInterventionDate(dateOutStr);
    if (dOut) {
        const diffMs = dOut.getTime() - dIn.getTime();
        // If entered and exited on the same day: counts as 1 day
        const days = Math.max(1, Math.round(diffMs / (1000 * 60 * 60 * 24)));
        return { days, isOngoing: false };
    } else {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const diffMs = today.getTime() - dIn.getTime();
        const days = Math.max(1, Math.round(diffMs / (1000 * 60 * 60 * 24)));
        return { days, isOngoing: true };
    }
};

// Helper for robust alpha-numerical sorting by sigla
function sortVehiclesBySigla(vehicles) {
    if (!vehicles || !Array.isArray(vehicles)) return vehicles;

    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

    return vehicles.sort((a, b) => {
        const siglaA = (a.sigla || '').toString().trim();
        const siglaB = (b.sigla || '').toString().trim();

        // Handle empty values - always at the bottom
        if (!siglaA && siglaB) return 1;
        if (siglaA && !siglaB) return -1;
        if (!siglaA && !siglaB) return 0;

        return collator.compare(siglaA, siglaB);
    });
}

// Helper for local YYYY-MM-DD
function getLocalISODate() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

document.addEventListener('DOMContentLoaded', () => {
    initApp();
});

async function initApp() {


    // Check if user was logged in as admin
    const savedAdminState = localStorage.getItem('isAdmin');
    if (savedAdminState === 'true') {
        isAdmin = true;
        document.body.classList.add('is-admin');
        const lockIcon = document.getElementById('admin-lock-icon');
        if (lockIcon) lockIcon.className = 'fa-solid fa-lock-open';
        const hintText = document.getElementById('admin-hint-text');
        if (hintText) hintText.textContent = 'Modalita amministratore';
    }

    console.log(`%c APP START: Version ${APP_VERSION}`, 'background: #1e3a8a; color: #fff; font-weight: bold; padding: 4px;');

    // Sync version display in header dynamically (so HTML never needs manual update)
    const versionEl = document.getElementById('app-version-display');
    if (versionEl) versionEl.textContent = `v${APP_VERSION}`;

    setupEventListeners();

    // Observe Firebase Auth State
    auth.onAuthStateChanged(user => {
        if (user) {
            console.log("Admin loggato:", user.email);
            isAdmin = true;
            document.body.classList.add('is-admin');
            const lockIcon = document.getElementById('admin-lock-icon');
            if (lockIcon) lockIcon.className = 'fa-solid fa-lock-open';
            const hintText = document.getElementById('admin-hint-text');
            if (hintText) hintText.textContent = 'Modalita amministratore';
            localStorage.setItem('isAdmin', 'true');
        } else {
            console.log("Utente non loggato");
            isAdmin = false;
            document.body.classList.remove('is-admin');
            const lockIcon = document.getElementById('admin-lock-icon');
            if (lockIcon) lockIcon.className = 'fa-solid fa-lock';
            const hintText = document.getElementById('admin-hint-text');
            if (hintText) hintText.textContent = 'Modalita visualizzazione';
            localStorage.removeItem('isAdmin');
        }
        renderDashboard();
    });

    await renderDashboard(true); // Force initial fetch



    setupRealtimeSubscription();
    setupIdleRefresh();
    setupAutoRefresh();

    // Refresh on return to focus (important for mobile)
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            console.log('App returned to foreground, refreshing data...');
            renderDashboard(true);
        }
    });
}

function setupIdleRefresh() {
    let idleTimer;
    const idleTime = 5 * 60 * 1000; // 5 minutes

    function resetTimer() {
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
            console.log('User idle for 5 minutes, refreshing dashboard...');
            renderDashboard(true);
        }, idleTime);
    }

    // Events to track activity
    window.addEventListener('mousemove', resetTimer);
    window.addEventListener('mousedown', resetTimer);
    window.addEventListener('keypress', resetTimer);
    window.addEventListener('touchmove', resetTimer);
    window.addEventListener('scroll', resetTimer);

    resetTimer(); // Start timer initially
}

function setupAutoRefresh() {
    setInterval(() => {
        console.log('Auto-refresh triggered...');
        renderDashboard(true);
    }, 60 * 1000); // 1 minute
}

window.manualRefresh = async function () {
    console.log('Manual refresh requested...');
    const refreshBtn = document.getElementById('manual-refresh-btn');
    if (refreshBtn) refreshBtn.classList.add('syncing');

    await renderDashboard(true);

    if (refreshBtn) {
        setTimeout(() => refreshBtn.classList.remove('syncing'), 500);
    }
}



let isSyncing = false; // Prevents race conditions during fetch
let lastVehicleSync = Date.now();

function setupRealtimeSubscription() {
    if (window.store && window.store.db) {
        console.log("Realtime: Initializing Firestore onSnapshot listeners...");

        // Vehicles Subscription
        window.store.db.collection('vehicles').onSnapshot((snapshot) => {
            console.log("Realtime: Vehicles snapshot received. Triggering full refresh for accurate maintenanceHistory...");
            // Full refresh so maintenanceHistory (including km field) is always up to date
            renderDashboard(true);
        }, err => console.error("Realtime Vehicles error:", err));

        // Interventions Subscription
        window.store.db.collection('interventions').onSnapshot((snapshot) => {
            console.log("Realtime: Interventions snapshot received. Refreshing dashboard...");
            // Interventions affect maintenanceHistory which is nested in cachedVehicles
            // Simplest is to trigger a full refresh to re-link everything
            renderDashboard(true);
        }, err => console.error("Realtime Interventions error:", err));

        // Locations Subscription
        window.store.db.collection('locations').onSnapshot((snapshot) => {
            console.log("Realtime: Locations snapshot received.");
            cachedLocations = snapshot.docs.map(doc => {
                const data = doc.data();
                return { luogo: data.name, colore: data.colore };
            }).sort((a, b) => a.luogo.localeCompare(b.luogo));
            renderDashboard(false); // Re-render with new locations (station names)
        }, err => console.error("Realtime Locations error:", err));

        // Cambi Mezzi Subscription
        window.store.db.collection('cambiomezzo').onSnapshot((snapshot) => {
            console.log("Realtime: Cambi Mezzi snapshot received.");
            if (!document.getElementById('data-management-modal').classList.contains('hidden')) {
                switchDataTable('cambiomezzo');
            }
        }, err => console.error("Realtime Cambi error:", err));
    }
}

async function renderDashboard(forceRefresh = false) {
    if (isSyncing) return; // Prevent multiple concurrent refreshes

    try {
        if (forceRefresh || !cachedVehicles) {
            isSyncing = true;
            console.log("Syncing dashboard data from DB...");

            // Parallel fetch
            const [vehicles, locations] = await Promise.all([
                store.getVehicles(),
                store.getLocations()
            ]);

            cachedVehicles = vehicles;
            cachedLocations = locations.sort((a, b) => a.luogo.localeCompare(b.luogo));
            sortVehiclesBySigla(cachedVehicles);
            lastVehicleSync = Date.now();
        }

        // AUTO-CLEANUP: Only if admin (optimization)
        if (isAdmin && cachedVehicles) {
            const todayStr = getLocalISODate();
            const cleanupPromises = [];

            for (const vehicle of cachedVehicles) {
                if (vehicle.appointment_date && vehicle.appointment_date < todayStr) {
                    console.log(`Auto-cleaning expired appointment for vehicle ${vehicle.id}`);
                    vehicle.appointment_date = null;
                    vehicle.appointment_location = null;
                    vehicle.alert_ack_date = null;
                    // Prepare batch update
                    cleanupPromises.push(store.updateVehicle(vehicle));
                }
            }

            if (cleanupPromises.length > 0) {
                await Promise.all(cleanupPromises);
                // Refresh cache once after all updates
                cachedVehicles = await store.getVehicles();
                sortVehiclesBySigla(cachedVehicles);
            }
        }

        updateStats(cachedVehicles);

        // Preserve active filter
        if (currentFilter === 'all') {
            renderVehicleGrid(cachedVehicles);
        } else {
            const filtered = cachedVehicles.filter(v => v.status === currentFilter);
            sortVehiclesBySigla(filtered);
            renderVehicleGrid(filtered);
        }

        lastRefreshTime = new Date();
        updateLastRefreshDisplay();

    } catch (err) {
        console.error("Dashboard render error:", err);
    } finally {
        isSyncing = false;
    }
}

function updateLastRefreshDisplay() {
    const display = document.getElementById('last-update-time');
    if (display) {
        const hours = String(lastRefreshTime.getHours()).padStart(2, '0');
        const minutes = String(lastRefreshTime.getMinutes()).padStart(2, '0');
        const seconds = String(lastRefreshTime.getSeconds()).padStart(2, '0');
        display.textContent = `${hours}:${minutes}:${seconds}`;
    }
}

function updateStats(vehicles) {
    const total = vehicles.length;
    const operative = vehicles.filter(v => v.status === 'operative').length;
    const available = vehicles.filter(v => v.status === 'available').length;
    const maintenance = vehicles.filter(v => v.status === 'maintenance').length;
    const toRepair = vehicles.filter(v => v.status === 'to-repair').length;

    const statAll = document.getElementById('stat-all');
    if (statAll) statAll.textContent = total;

    document.getElementById('stat-operative').textContent = operative;
    document.getElementById('stat-available').textContent = available;
    document.getElementById('stat-maintenance').textContent = maintenance;
    document.getElementById('stat-to-repair').textContent = toRepair;
}

window.setDashboardFilter = async function (status) {
    // Update active class on stat cards
    document.querySelectorAll('.stat-card').forEach(card => {
        card.classList.remove('active');
        if (card.classList.contains(status)) {
            card.classList.add('active');
        }
    });

    currentFilter = status;

    if (!cachedVehicles) {
        await renderDashboard(true);
        return; // renderDashboard handles the rendering with currentFilter
    }

    if (status === 'all') {
        renderVehicleGrid(cachedVehicles);
    } else {
        const filtered = cachedVehicles.filter(v => v.status === status);
        sortVehiclesBySigla(filtered); // Ensure sorted after filter
        renderVehicleGrid(filtered);
    }
}

function getStatusLabel(status) {
    const labels = {
        'operative': 'Operativa',
        'available': 'Disponibile',
        'maintenance': 'In Officina',
        'to-repair': 'Da Riparare',
        'internal-use': 'Uso Interno',
        'not-present': 'Non più presente'
    };
    return labels[status] || status;
}

async function renderVehicleGrid(vehicles) {
    // Escludi i mezzi non più presenti dalla dashboard
    vehicles = vehicles.filter(v => v.status !== 'not-present');

    const grid = document.getElementById('vehicle-grid');
    const todayStr = getLocalISODate();

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowYear = tomorrow.getFullYear();
    const tomorrowMonth = String(tomorrow.getMonth() + 1).padStart(2, '0');
    const tomorrowDay = String(tomorrow.getDate()).padStart(2, '0');
    const tomorrowStr = `${tomorrowYear}-${tomorrowMonth}-${tomorrowDay}`;

    // Ensure vehicles are sorted based on sigla
    sortVehiclesBySigla(vehicles);
    console.log("Realtime: Rendering grid with sorted sigle:", vehicles.map(v => v.sigla).join(', '));

    if (vehicles.length === 0) {
        grid.innerHTML = '<p style="grid-column: 1/-1; text-align: center; padding: 2rem;">Nessun veicolo trovato.</p>';
        return;
    }

    grid.innerHTML = vehicles.map(vehicle => {
        // ALERT LOGIC
        let alertHTML = '';
        const isToday = vehicle.appointment_date === todayStr;
        const isTomorrow = vehicle.appointment_date === tomorrowStr;
        const alreadyAcked = (vehicle.alert_ack_date === todayStr) || isDismissedToday(vehicle.id);

        const showOverlay = (isToday || isTomorrow) && !alreadyAcked;
        if (showOverlay) {
            alertHTML = `
                <div class="appointment-alert-overlay" id="alert-overlay-${vehicle.id}">
                    <div class="alert-title">${isToday ? 'OGGI' : 'DOMANI'} APPUNTAMENTO</div>
                    <div class="alert-subtitle">${vehicle.appointment_location || 'Luogo non specificato'}</div>
                    <button class="alert-ack-btn" onclick="dismissAlert(event, '${vehicle.id}')">PRESA VISIONE</button>
                </div>
            `;
        }

        // Status 
        const statusLabels = {
            'operative': 'In Servizio',
            'available': 'Disponibile',
            'maintenance': 'In Officina',
            'to-repair': 'Da Riparare',
            'internal-use': 'Uso Interno',
            'not-present': 'Non più presente'
        };

        const now = new Date();
        const currentYearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        const hasCheckThisMonth = vehicle.monthly_checks && vehicle.monthly_checks.some(c => c.date && c.date.startsWith(currentYearMonth));

        let statusHtml = `
            <div style="position: relative; width: 100%;">
                ${hasCheckThisMonth ? '<div class="monthly-check-dot" title="Controllo Scadenze Mensile Effettuato"></div>' : ''}
                ${isAdmin ? `
                    <select class="status-full-bar status-${vehicle.status}" onchange="quickUpdateStatus(event, '${vehicle.id}')" onclick="event.stopPropagation()" ${vehicle.status === 'internal-use' ? 'disabled' : ''}>
                        <option value="operative" ${vehicle.status === 'operative' ? 'selected' : ''}>In Servizio</option>
                        <option value="available" ${vehicle.status === 'available' ? 'selected' : ''}>Disponibile</option>
                        <option value="maintenance" ${vehicle.status === 'maintenance' ? 'selected' : ''}>In Officina</option>
                        <option value="to-repair" ${vehicle.status === 'to-repair' ? 'selected' : ''}>Da Riparare</option>
                        ${vehicle.status === 'internal-use' ? '<option value="internal-use" selected>Uso Interno</option>' : ''}
                    </select>
                ` : `
                    <div class="status-full-bar status-${vehicle.status}" style="cursor: default;">
                        ${statusLabels[vehicle.status] || vehicle.status}
                    </div>
                `}
                ${vehicle.appointment_date ? '<div class="appointment-dot" title="Appuntamento Fissato"><i class="fa-solid fa-calendar-day"></i></div>' : ''}
            </div>
        `;

        // Location
        let locationHtml = '';
        if (isAdmin) {
            locationHtml = `
            <div class="location-select-container" onclick="event.stopPropagation()">
                <div class="location-label">Posizione</div>
                <div style="width: 100%;">
                    <select class="location-select" onchange="quickUpdateStationSelect(event, '${vehicle.id}')">
                        ${cachedLocations.map(loc => `<option value="${loc.luogo}" ${vehicle.station === loc.luogo ? 'selected' : ''}>${loc.luogo}</option>`).join('')}
                    </select>
                </div>
            </div>
            `;
        } else {
            locationHtml = `
            <div class="location-select-container" style="cursor: default; background: transparent; border: none; padding: 0;">
                <div class="location-label">Posizione</div>
                <div style="width: 100%; text-align: center;">
                    <span class="location-display" style="font-weight: 700; color: black;">${vehicle.station || '-'}</span>
                </div>
            </div>
            `;
        }

        // Notes
        const pureNotes = (vehicle.notes || '').trim();
        let noteContent = pureNotes;
        if (vehicle.appointment_date) {
            const locText = vehicle.appointment_location ? ` @ ${vehicle.appointment_location}` : '';
            const apptText = `APPUNTAMENTO: ${formatDate(vehicle.appointment_date)}${locText}`;
            noteContent = pureNotes ? `${apptText}\n---\n${pureNotes}` : apptText;
        }
        // Note ed eventuale appuntamento sempre visibili nell'etichetta gialla
        const mobileNotesContent = noteContent;

        // --- Badge scadenze ---
        function expiryBadge(label, dateStr) {
            if (!dateStr) return '';
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const currentMonth = today.getMonth();
            const currentYear = today.getFullYear();

            const exp = new Date(dateStr);
            exp.setHours(0, 0, 0, 0);
            const expMonth = exp.getMonth();
            const expYear = exp.getFullYear();

            const isExpired = exp < today;
            const isCurrentMonth = (expMonth === currentMonth && expYear === currentYear);

            // Mostra solo se già scaduta o se scade nel mese corrente
            if (!isExpired && !isCurrentMonth) return '';

            const days = Math.round((exp - today) / (1000 * 60 * 60 * 24));
            const cls = days <= 30 ? 'danger' : 'warning';
            const dateFormatted = exp.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: '2-digit' });
            const icon = isExpired ? '⚠️' : '🔔';
            const label2 = isExpired ? `${label}: SCADUTA` : `${label}: ${dateFormatted}`;
            return `<span class="expiry-badge ${cls}">${icon} ${label2}</span>`;
        }
        const revBadge = expiryBadge('REV', vehicle.inspection_expiry);

        // --- Badge Tagliando probabile ---
        // Logica: confronta km dell'ultimo intervento con "TAGLIANDO" nella descrizione
        // vs km dell'intervento più recente. Se differenza > 20.000 è avviso.
        let kmIntervalBadge = '';
        const history = vehicle.maintenanceHistory || [];
        
        const parseKmSafe = (val) => {
            if (!val) return 0;
            return parseInt(val.toString().replace(/[^0-9]/g, '')) || 0;
        };
        const currentMileage = parseKmSafe(vehicle.mileage);

        let maxKm = currentMileage;
        const withKm = history.filter(r => r.km != null && r.km !== '' && parseKmSafe(r.km) > 0);
        if (withKm.length > 0) {
            const maxHistoryKm = Math.max(...withKm.map(r => parseKmSafe(r.km)));
            maxKm = Math.max(maxKm, maxHistoryKm);
        }

        const tagliandoListWithKm = withKm.filter(r => r.description && r.description.toUpperCase().includes('TAGLIANDO'));
        
        let referenceKm = null;
        if (tagliandoListWithKm.length > 0) {
            referenceKm = Math.max(...tagliandoListWithKm.map(r => parseKmSafe(r.km)));
        } else if (currentMileage > 0) {
            referenceKm = currentMileage;
        }

        if (referenceKm !== null) {
            const delta = maxKm - referenceKm;
            if (delta >= 20000) {
                kmIntervalBadge = `<span class="expiry-badge danger">🔧 Tagliando probabile (+${delta.toLocaleString()} km)</span>`;
            }
        }

        const allBadges = [revBadge, kmIntervalBadge].filter(Boolean).join('');
        const expiryBadgesHtml = allBadges ? `<div class="expiry-badges">${allBadges}</div>` : '';

        // --- Da Fare HTML ---
        let todoHtml = '';
        let todos = [];
        if (Array.isArray(vehicle.todo_notes)) {
            todos = vehicle.todo_notes.flatMap(note => (note || '').toString().split('\n').map(s => s.trim()).filter(s => s !== ''));
        } else if (vehicle.todo_notes && typeof vehicle.todo_notes === 'string' && vehicle.todo_notes.trim() !== '') {
            todos = vehicle.todo_notes.split('\n').map(s => s.trim()).filter(s => s !== '');
        }

        if (todos.length > 0) {
            todoHtml = todos.map((note, idx) => `
            <div class="todo-note-box" style="width: 100%; margin-bottom: 0.5rem;" onclick="event.stopPropagation()">
                <div class="todo-text"><i class="fa-solid fa-clipboard-list" style="margin-right:4px;"></i>${note.replace(/\n/g, '<br>')}</div>
                ${isAdmin ? `<button class="todo-done-btn" onclick="deleteTodoNote(event, '${vehicle.id}', ${idx})" title="Segna come completato"><i class="fa-solid fa-check"></i></button>` : ''}
            </div>
            `).join('');
        }

        const mobileNoteHtml = mobileNotesContent
            ? `<div class="mobile-notes">${mobileNotesContent.replace(/\n/g, '<br>')}</div>`
            : '';

        return `
            <div class="vehicle-card border-${vehicle.status}${showOverlay ? ' has-alert' : ''}" 
                 data-id="${vehicle.id}" 
                 draggable="${isAdmin}" 
                 onclick="openVehicleModal('${vehicle.id}')"
                 ondragstart="handleDragStart(event)" 
                 ondragover="handleDragOver(event)" 
                 ondrop="handleDrop(event)" 
                 ondragenter="handleDragEnter(event)" 
                 ondragleave="handleDragLeave(event)" 
                 ondragend="handleDragEnd(event)">
                ${alertHTML}
                ${statusHtml}
                <div class="card-body">
                    ${todoHtml}
                    <div class="vehicle-id" style="text-align: center; margin-bottom: 0.5rem; display: flex; flex-direction: column; gap: 0.1rem;">
                        ${vehicle.sigla ? `<div class="sigla-text">${vehicle.sigla}</div>` : ''}
                        <div class="model-text">${vehicle.model}</div>
                        <div class="plate-number">${vehicle.plate}</div>
                        <div class="km-text">KM: ${(parseInt(vehicle.mileage) || 0).toLocaleString()}</div>
                        ${vehicle.mileage_month ? `<div class="month-text">${vehicle.mileage_month}</div>` : ''}
                    </div>
                    <div class="card-actions" style="justify-content: center; flex-direction: column; align-items: center;">
                        ${locationHtml}
                        ${mobileNoteHtml}
                        ${expiryBadgesHtml}
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

// Drag & Drop Handlers
let dragSrcEl = null;

function handleDragStart(e) {
    dragSrcEl = this;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/html', this.innerHTML);
    this.classList.add('dragging');
}

function handleDragOver(e) {
    if (e.preventDefault) {
        e.preventDefault();
    }
    e.dataTransfer.dropEffect = 'move';
    return false;
}

function handleDragEnter(e) {
    this.classList.add('over');
}

function handleDragLeave(e) {
    this.classList.remove('over');
}

function handleDragEnd(e) {
    this.classList.remove('dragging');
    let items = document.querySelectorAll('.vehicle-grid .vehicle-card');
    items.forEach(function (item) {
        item.classList.remove('over');
    });
}

function handleDrop(e) {
    if (e.stopPropagation) {
        e.stopPropagation();
    }

    if (dragSrcEl !== this) {
        // Swap DOM elements
        // Actually, renaming innerHTML is weak for complex elements with events.
        // Better to swap the nodes or use `insertBefore`.

        const grid = document.getElementById('vehicle-grid');
        const allCards = [...grid.querySelectorAll('.vehicle-card')];
        const srcIndex = allCards.indexOf(dragSrcEl);
        const targetIndex = allCards.indexOf(this);

        if (srcIndex < targetIndex) {
            this.after(dragSrcEl);
        } else {
            this.before(dragSrcEl);
        }

        // Save new order
        const newOrder = [...document.querySelectorAll('.vehicle-card')].map(card => card.dataset.id);
        localStorage.setItem('vehicleOrder', JSON.stringify(newOrder));
    }
    return false;
}

// Quick Actions
window.addTodoNote = async function (event, id) {
    event.stopPropagation();
    if (!isAdmin) return;
    const note = prompt("Inserisci la cosa da fare per questo mezzo:");
    if (!note || note.trim() === '') return;

    if (cachedVehicles) {
        const idx = cachedVehicles.findIndex(v => v.id === id);
        if (idx !== -1) {
            const vehicle = cachedVehicles[idx];
            let todos = Array.isArray(vehicle.todo_notes) ? [...vehicle.todo_notes] : (vehicle.todo_notes && typeof vehicle.todo_notes === 'string' && vehicle.todo_notes.trim() !== '' ? [vehicle.todo_notes] : []);
            todos.push(upper(note));
            vehicle.todo_notes = todos;

            store.updateVehicle(vehicle).then(() => {
                const modal = document.getElementById('vehicle-modal');
                if (modal && !modal.classList.contains('hidden')) {
                    closeVehicleModal();
                }
            }).catch(err => {
                console.error("Failed to update todo note:", err);
                alert("Errore salvataggio nota da fare.");
            });
            renderDashboard(false);
        }
    }
}

// Gestione overlay avviso appuntamenti con "Presa Visione" persistente per la giornata
if (!window.dismissedAlerts) {
    window.dismissedAlerts = new Set();
}

function isDismissedToday(vehicleId) {
    const todayStr = getLocalISODate();
    if (window.dismissedAlerts && window.dismissedAlerts.has(vehicleId)) {
        return true;
    }
    try {
        const stored = JSON.parse(localStorage.getItem('app_dismissed_alerts') || '{}');
        if (stored[vehicleId] === todayStr) {
            return true;
        }
    } catch (e) {}
    return false;
}

function setDismissedToday(vehicleId) {
    const todayStr = getLocalISODate();
    if (!window.dismissedAlerts) {
        window.dismissedAlerts = new Set();
    }
    window.dismissedAlerts.add(vehicleId);
    try {
        const stored = JSON.parse(localStorage.getItem('app_dismissed_alerts') || '{}');
        const cleaned = {};
        for (const [id, date] of Object.entries(stored)) {
            if (date === todayStr) {
                cleaned[id] = date;
            }
        }
        cleaned[vehicleId] = todayStr;
        localStorage.setItem('app_dismissed_alerts', JSON.stringify(cleaned));
    } catch (e) {
        console.error('Error saving dismissed alert to localStorage:', e);
    }
}

function clearDismissedAlert(vehicleId) {
    if (window.dismissedAlerts) {
        window.dismissedAlerts.delete(vehicleId);
    }
    try {
        const stored = JSON.parse(localStorage.getItem('app_dismissed_alerts') || '{}');
        delete stored[vehicleId];
        localStorage.setItem('app_dismissed_alerts', JSON.stringify(stored));
    } catch (e) {}
}

window.dismissAlert = async function (event, vehicleId) {
    if (event) {
        event.stopPropagation();
        event.preventDefault();
    }
    setDismissedToday(vehicleId);

    const el = document.getElementById('alert-overlay-' + vehicleId);
    if (el) {
        el.style.transition = 'opacity 0.25s ease';
        el.style.opacity = '0';
        setTimeout(() => {
            el.remove();
            const card = document.querySelector(`.vehicle-card[data-id="${vehicleId}"]`);
            if (card) card.classList.remove('has-alert');
        }, 250);
    }

    // Persisti la presa visione per la giornata anche su DB se l'utente è autorizzato
    const todayStr = getLocalISODate();
    if (cachedVehicles) {
        const v = cachedVehicles.find(item => item.id === vehicleId);
        if (v) v.alert_ack_date = todayStr;
    }
    try {
        const vehicle = await store.getVehicleById(vehicleId);
        if (vehicle) {
            vehicle.alert_ack_date = todayStr;
            await store.updateVehicle(vehicle);
        }
    } catch (err) {
        // Fallback silenzioso (già registrato in localStorage)
        console.warn("Persistenza Firestore alert_ack_date non disponibile per questo utente:", err);
    }
};

window.deleteTodoNote = async function (event, id, noteIndex) {
    event.stopPropagation();
    if (!isAdmin) return;
    setTimeout(() => {
        if (!confirm("Hai completato questa attività? La nota verrà eliminata.")) return;

        if (cachedVehicles) {
            const idx = cachedVehicles.findIndex(v => v.id === id);
            if (idx !== -1) {
                const vehicle = cachedVehicles[idx];
                let todos = Array.isArray(vehicle.todo_notes) ? [...vehicle.todo_notes] : (vehicle.todo_notes && typeof vehicle.todo_notes === 'string' && vehicle.todo_notes.trim() !== '' ? [vehicle.todo_notes] : []);
                
                if (noteIndex !== undefined && noteIndex >= 0 && noteIndex < todos.length) {
                    todos.splice(noteIndex, 1);
                } else {
                    todos = [];
                }
                vehicle.todo_notes = todos;

                store.updateVehicle(vehicle).then(() => {
                    const modal = document.getElementById('vehicle-modal');
                    if (modal && !modal.classList.contains('hidden')) {
                        openVehicleModal(id);
                    }
                }).catch(err => {
                    console.error("Failed to delete todo note:", err);
                    alert("Errore salvataggio nota da fare.");
                });
                renderDashboard(false);
            }
        }
    }, 50);
}

window.quickUpdateStatus = async function (event, id) {
    event.stopPropagation();
    const newStatus = event.target.value;
    const select = event.target;

    // Check if locked
    if (cachedVehicles) {
        const v = cachedVehicles.find(v => v.id === id);
        if (v && v.status === 'internal-use') {
            alert("I veicoli 'Uso Interno' possono essere modificati solo dalla gestione database.");
            renderDashboard(false);
            return;
        }
    }

    // 1. Force Immediate UI update (Robustness for re-clicks)
    const allStatuses = ['status-operative', 'status-available', 'status-maintenance', 'status-to-repair'];
    select.classList.remove(...allStatuses);
    select.classList.add(`status-${newStatus}`);

    const card = select.closest('.vehicle-card');
    if (card) {
        const allBorders = ['border-operative', 'border-available', 'border-maintenance', 'border-to-repair'];
        card.classList.remove(...allBorders);
        card.classList.add(`border-${newStatus}`);
    }

    // 2. Optimistic Update
    if (cachedVehicles) {
        const idx = cachedVehicles.findIndex(v => v.id === id);
        if (idx !== -1) {
            const vehicle = cachedVehicles[idx];
            if (vehicle.status !== newStatus) {
                vehicle.status = newStatus;
                updateStats(cachedVehicles);

                // Background DB Update
                store.updateVehicle(vehicle).catch(err => {
                    console.error("Failed to update status in DB:", err);
                    alert("Errore di connessione: aggiornamento non salvato.");
                });
            }
            // Refresh modal if open (immediate)
            if (!document.getElementById('vehicle-modal').classList.contains('hidden')) {
                openVehicleModal(id);
            }
        }
    }
}

window.quickUpdateStationSelect = function (event, id) {
    event.stopPropagation();
    const newStation = upper(event.target.value);

    if (cachedVehicles) {
        const idx = cachedVehicles.findIndex(v => v.id === id);
        if (idx !== -1) {
            const vehicle = cachedVehicles[idx];
            if (vehicle.station !== newStation) {
                vehicle.station = newStation;

                // Update DB in background
                store.updateVehicle(vehicle).catch(err => {
                    console.error("Failed to update station:", err);
                    alert("Errore salvataggio stazione.");
                });

                // If modal is open, we might need to update it
                if (!document.getElementById('vehicle-modal').classList.contains('hidden')) {
                    openVehicleModal(id);
                }
            }
        }
    }
}

// Global Admin State
// Moved to top

window.toggleAdminMode = function () {
    const hintText = document.getElementById('admin-hint-text');

    if (isAdmin) {
        // Logout via Firebase
        auth.signOut().then(() => {
            alert("Modalità Amministratore Disattivata.");
        }).catch(error => {
            console.error("Errore logout:", error);
        });
    } else {
        // Open Login Modal
        document.getElementById('admin-login-modal').classList.remove('hidden');
        document.getElementById('admin-email-input').focus();
    }
}

// Global functions attached to window for HTML event handlers

window.openVehicleForm = async function (vehicleId = null) {
    // Fallback check: if isAdmin is false but body has is-admin, sync them
    if (!isAdmin && document.body.classList.contains('is-admin')) {
        isAdmin = true;
    }

    if (!isAdmin) {
        console.warn("Attempted to open vehicle form without administrative privileges.");
        return;
    }

    const managementModal = document.getElementById('data-management-modal');
    const isFromManagement = managementModal && !managementModal.classList.contains('hidden');

    const modal = document.getElementById('vehicle-form-modal');
    const title = document.querySelector('#vehicle-form-modal h3');
    const form = document.getElementById('vehicle-form');

    form.reset();
    document.getElementById('vehicle-id').value = '';

    // Conditionally show/hide "Uso Interno" in the form status dropdown
    const statusSelect = document.getElementById('vehicle-status');
    const internalOption = statusSelect.querySelector('option[value="internal-use"]');
    if (internalOption) {
        internalOption.style.display = isFromManagement ? 'block' : 'none';
    }

    // Populate Station Select
    const stationSelect = document.getElementById('vehicle-station');
    stationSelect.innerHTML = '<option value="">-- Seleziona --</option>';
    if (cachedLocations) {
        cachedLocations.forEach(loc => {
            const option = document.createElement('option');
            option.value = loc.luogo;
            option.textContent = loc.luogo;
            stationSelect.appendChild(option);
        });
    }

    if (vehicleId) {
        title.textContent = 'Modifica Mezzo';

        let vehicle = (cachedVehicles || []).find(v => v.id === vehicleId);
        if (!vehicle) {
            try {
                vehicle = await store.getVehicleById(vehicleId);
            } catch (err) {
                console.error("Error fetching vehicle for edit:", err);
            }
        }

        if (vehicle) {
            document.getElementById('vehicle-id').value = vehicle.id;
            document.getElementById('vehicle-plate').value = vehicle.plate;
            document.getElementById('vehicle-model').value = vehicle.model;
            document.getElementById('vehicle-sigla').value = vehicle.sigla || '';
            document.getElementById('vehicle-station').value = vehicle.station;
            document.getElementById('vehicle-status').value = vehicle.status;
            document.getElementById('vehicle-mileage').value = vehicle.mileage;
            document.getElementById('vehicle-mileage-month').value = vehicle.mileage_month || '';
            document.getElementById('vehicle-radio').value = vehicle.radio_id || '';
            document.getElementById('vehicle-inspection').value = vehicle.inspection_expiry || '';
            document.getElementById('vehicle-revision-o2').value = vehicle.revision_o2 || '';
            document.getElementById('vehicle-type').value = vehicle.type;
            document.getElementById('vehicle-notes').value = vehicle.notes || '';
            if (document.getElementById('vehicle-db-notes')) {
                document.getElementById('vehicle-db-notes').value = vehicle.db_notes || '';
            }
            if (document.getElementById('vehicle-todo-notes')) {
                const todoVal = Array.isArray(vehicle.todo_notes) ? vehicle.todo_notes.join('\n') : (vehicle.todo_notes || '');
                document.getElementById('vehicle-todo-notes').value = todoVal;
            }
            const aleaFormChk = document.getElementById('vehicle-is-alea');
            if (aleaFormChk) {
                aleaFormChk.checked = !!(vehicle.is_alea === true || vehicle.is_alea === 'true' || window.isAleaVehicle(vehicle));
            }
        }
    } else {
        title.textContent = 'Aggiungi Nuovo Mezzo';
        document.getElementById('vehicle-mileage-month').value = ''; // Reset
        document.getElementById('vehicle-station').value = '';
        document.getElementById('vehicle-type').value = 'Ambulanza';
        const aleaFormChk = document.getElementById('vehicle-is-alea');
        if (aleaFormChk) {
            aleaFormChk.checked = false;
        }
    }

    modal.classList.remove('hidden');

    // Status Locking Logic
    const isInternalUse = vehicleId && cachedVehicles.find(v => v.id === vehicleId)?.status === 'internal-use';
    const shouldLockFromDashboard = isInternalUse && !isFromManagement;

    const inputs = form.querySelectorAll('input, select, textarea');
    inputs.forEach(input => {
        if (isFromManagement) {
            input.disabled = false;
        } else if (shouldLockFromDashboard) {
            // Dashboard view: only status is locked for Uso Interno
            input.disabled = (input.id === 'vehicle-status');
        } else {
            input.disabled = false;
        }
    });

    const submitBtn = form.querySelector('button[type="submit"]') || form.querySelector('button[onclick*="saveVehicleForm"]');
    if (submitBtn) {
        submitBtn.style.display = 'block'; // Always show button to allow saving changes (including station)
    }

    if (shouldLockFromDashboard) {
        title.textContent = 'Mezzo Uso Interno (Stato Bloccato)';
    } else if (vehicleId) {
        title.textContent = 'Modifica Mezzo';
    } else {
        title.textContent = 'Aggiungi Nuovo Mezzo';
    }
}

window.openCambioMezzoModal = async function (cambioId = null) {
    if (!isAdmin) return;

    const modal = document.getElementById('cambio-mezzo-modal');
    const form = document.getElementById('cambio-mezzo-form');
    const title = document.querySelector('#cambio-mezzo-modal h3');

    form.reset();
    document.getElementById('cambio-id').value = '';

    // 1. Populate Dropdowns FIRST
    const luogoSelect = document.getElementById('cambio-luogo');
    luogoSelect.innerHTML = '<option value="">-- Seleziona Luogo --</option>';
    if (cachedLocations) {
        cachedLocations.forEach(loc => {
            const option = document.createElement('option');
            option.value = loc.luogo;
            option.textContent = loc.luogo;
            luogoSelect.appendChild(option);
        });
    }

    const dalSelect = document.getElementById('cambio-dal-mezzo');
    const alSelect = document.getElementById('cambio-al-mezzo');
    dalSelect.innerHTML = '<option value="">-- Seleziona --</option>';
    alSelect.innerHTML = '<option value="">-- Seleziona --</option>';

    if (cachedVehicles) {
        const vehiclesWithSigla = cachedVehicles.filter(v => v.sigla).sort((a, b) => a.sigla.localeCompare(b.sigla));
        vehiclesWithSigla.forEach(v => {
            const option = document.createElement('option');
            option.value = v.sigla;
            option.textContent = v.sigla;
            dalSelect.appendChild(option.cloneNode(true));
            alSelect.appendChild(option);
        });
    }

    // 2. Load and Apply Data
    if (cambioId) {
        title.textContent = 'Modifica Cambio Mezzo';
        try {
            const list = await store.getCambiMezzi();
            const cambio = list.find(c => c.id === cambioId);
            if (cambio) {
                document.getElementById('cambio-id').value = cambio.id;

                // Ensure date is in YYYY-MM-DD for the input type="date"
                if (cambio.data) {
                    const d = new Date(cambio.data);
                    if (!isNaN(d)) {
                        document.getElementById('cambio-data').value = d.toISOString().split('T')[0];
                    }
                }

                document.getElementById('cambio-turno').value = cambio.turno || '';
                document.getElementById('cambio-luogo').value = cambio.luogo || '';
                document.getElementById('cambio-equipaggio').value = cambio.equipaggio || '';
                document.getElementById('cambio-dal-mezzo').value = cambio.dal_mezzo || '';
                document.getElementById('cambio-al-mezzo').value = cambio.al_mezzo || '';
            }
        } catch (error) {
            console.error("Error loading cambio data:", error);
        }
    } else {
        title.textContent = 'Registra Cambio Mezzo';
        document.getElementById('cambio-data').valueAsDate = new Date();
    }

    modal.classList.remove('hidden');
}

window.saveCambioMezzo = async function () {
    const id = document.getElementById('cambio-id').value;
    const data = document.getElementById('cambio-data').value;
    const turno = document.getElementById('cambio-turno').value;
    const luogo = document.getElementById('cambio-luogo').value;
    const equipaggio = document.getElementById('cambio-equipaggio').value;
    const dal_mezzo = document.getElementById('cambio-dal-mezzo').value;
    const al_mezzo = document.getElementById('cambio-al-mezzo').value;

    const cambioData = {
        data,
        turno: upper(turno),
        luogo: upper(luogo),
        equipaggio: upper(equipaggio),
        dal_mezzo: upper(dal_mezzo),
        al_mezzo: upper(al_mezzo)
    };

    try {
        if (id) {
            await store.updateCambioMezzo(id, cambioData);
            alert("Cambio mezzo aggiornato con successo!");
        } else {
            await store.addCambioMezzo(cambioData);
            alert("Cambio mezzo registrato con successo!");
        }
        document.getElementById('cambio-mezzo-modal').classList.add('hidden');

        // Refresh Data Management if open
        if (!document.getElementById('data-management-modal').classList.contains('hidden')) {
            switchDataTable(window.lastDataManagerTab || 'cambiomezzo');
        }
    } catch (error) {
        console.error("Error saving cambio mezzo:", error);
    }
}

window.openContactsModal = async function () {
    document.getElementById('contacts-modal').classList.remove('hidden');
    await switchContactCategory('sedi');
};

window.closeContactsModal = function () {
    document.getElementById('contacts-modal').classList.add('hidden');
};

window.switchContactCategory = async function (category) {
    document.querySelectorAll('.contact-tab').forEach(t => t.classList.remove('active'));
    const activeTab = document.getElementById(`tab-${category}`);
    if (activeTab) activeTab.classList.add('active');
    await renderContacts(category);
};

window.renderContacts = async function (category) {
    const container = document.getElementById('contacts-list-container');
    container.innerHTML = '<p style="text-align: center; padding: 2rem; color: var(--text-secondary);"><i class="fa-solid fa-spinner fa-spin"></i> Caricamento in corso...</p>';

    try {
        const allContacts = await store.getContacts();
        const filtered = allContacts.filter(c => {
            const cat = (c.category || '').toLowerCase();
            if (category === 'officine') {
                return cat === 'officine' || cat === 'utili' || cat === 'officine utili';
            }
            return cat === 'sedi' || cat === 'sedi mezzi';
        });

        if (filtered.length === 0) {
            container.innerHTML = '<p style="text-align: center; padding: 3rem; color: var(--text-secondary); background: #f8fafc; border-radius: 0.75rem; border: 1px dotted var(--border-color);">Nessun contatto presente in questa categoria.</p>';
            return;
        }

        let html = `
            <div class="contacts-table-container">
                <table class="contacts-table" style="table-layout: auto; width: 100%;">
                    <colgroup>
                        <col style="width: 1%;">
                        <col style="width: 1%;">
                        <col style="width: 1%;">
                        ${category !== 'sedi' ? '<col style="width: 1%;">' : ''}
                        ${category === 'sedi' ? '<col style="width: 1%;">' : ''}
                        <col style="width: 1%;">
                    </colgroup>
                    <thead>
                        <tr>
                            <th style="white-space:nowrap;">NOME / SIGLA</th>
                            <th style="white-space:nowrap;">FISSO</th>
                            <th style="white-space:nowrap;">CELLULARE 1</th>
                            ${category !== 'sedi' ? '<th style="white-space:nowrap;">CELLULARE 2</th>' : ''}
                            ${category === 'sedi' ? '<th style="white-space:nowrap;">CELL. MEDICO</th>' : ''}
                            <th class="admin-only" style="white-space:nowrap;">AZIONI</th>
                        </tr>
                    </thead>
                    <tbody>
        `;

        const phoneCell = (num, label) => {
            if (!num) return '<span style="color: #cbd5e1">-</span>';
            const lbl = label ? `<span style="font-size:0.7rem; color:var(--text-secondary); display:block;">${label}</span>` : '';

            const clean = num.replace(/[\\/\s+]/g, '');
            return `${lbl}<a href="tel:${clean}" class="tel-link"><i class="fa-solid fa-phone"></i> ${num}</a>`;
        };

        filtered.forEach(c => {
            const medicalClean = c.mobile_medical ? c.mobile_medical.replace(/\s+/g, '') : '';
            html += `
                <tr>
                    <td style="font-weight: 700; color: var(--text-primary); white-space: nowrap;">${c.name}</td>
                    <td style="white-space: nowrap;">${phoneCell(c.urban, c.urban_label)}</td>
                    <td style="white-space: nowrap;">${phoneCell(c.mobile, c.mobile_label)}</td>
                    ${category !== 'sedi' ? `<td style="white-space: nowrap;">${phoneCell(c.mobile2, c.mobile2_label)}</td>` : ''}
                    ${category === 'sedi' ? `<td style="white-space: nowrap;">${c.mobile_medical ? `<a href="tel:${medicalClean}" class="tel-link"><i class="fa-solid fa-user-doctor"></i> ${c.mobile_medical}</a>` : '<span style="color: #cbd5e1">-</span>'}</td>` : ''}
                    <td class="admin-only" style="white-space: nowrap;">
                        <div style="display: flex; gap: 0.4rem;">
                            <button onclick="openContactForm('${c.id}')" class="btn btn-sm" style="padding: 0.3rem 0.6rem; background: #f1f5f9; color: #475569; border: 1px solid #e2e8f0;" title="Modifica">
                                <i class="fa-solid fa-pen-to-square"></i>
                            </button>
                            <button onclick="deleteContactHandler('${c.id}')" class="btn btn-sm" style="padding: 0.3rem 0.6rem; background: #fef2f2; color: #ef4444; border: 1px solid #fee2e2;" title="Elimina">
                                <i class="fa-solid fa-trash"></i>
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        });

        html += `</tbody></table></div>`;
        container.innerHTML = html;
    } catch (err) {
        console.error("Error rendering contacts:", err);
        container.innerHTML = '<p style="text-align: center; color: var(--danger-color);">Errore nel caricamento dei contatti.</p>';
    }
};

// Show/hide form fields based on selected category
window.updateContactFormFields = function () {
    const cat = document.getElementById('contact-category').value;
    const isSedi = cat === 'sedi';
    document.getElementById('mobile2-field-group').style.display = isSedi ? 'none' : 'block';
    document.getElementById('medical-field-group').style.display = isSedi ? 'block' : 'none';
};

window.openContactForm = async function (id = null) {
    const modal = document.getElementById('contact-form-modal');
    const form = document.getElementById('contact-form');
    const title = document.getElementById('contact-form-title');

    form.reset();
    document.getElementById('contact-edit-id').value = id || '';

    if (id) {
        title.innerText = "Modifica Contatto";
        const contacts = await store.getContacts();
        const contact = contacts.find(c => c.id === id);
        if (contact) {
            document.getElementById('contact-category').value = contact.category;
            document.getElementById('contact-name').value = contact.name;
            document.getElementById('contact-urban').value = contact.urban || '';
            document.getElementById('contact-urban-label').value = contact.urban_label || '';
            document.getElementById('contact-mobile').value = contact.mobile || '';
            document.getElementById('contact-mobile-label').value = contact.mobile_label || '';
            document.getElementById('contact-mobile2').value = contact.mobile2 || '';
            document.getElementById('contact-mobile2-label').value = contact.mobile2_label || '';
            document.getElementById('contact-mobile-medical').value = contact.mobile_medical || '';
        }
    } else {
        title.innerText = "Nuovo Contatto";
        const activeTab = document.querySelector('.contact-tab.active');
        if (activeTab) {
            const cat = activeTab.id.replace('tab-', '');
            document.getElementById('contact-category').value = cat;
        }
    }

    updateContactFormFields();
    modal.classList.remove('hidden');
};

window.closeContactForm = function () {
    document.getElementById('contact-form-modal').classList.add('hidden');
};

window.saveContactHandler = async function (e) {
    e.preventDefault();
    const id = document.getElementById('contact-edit-id').value;
    const contact = {
        category: document.getElementById('contact-category').value,
        name: document.getElementById('contact-name').value.toUpperCase(),
        urban: document.getElementById('contact-urban').value.trim() || null,
        urban_label: document.getElementById('contact-urban-label').value.trim() || null,
        mobile: document.getElementById('contact-mobile').value.trim() || null,
        mobile_label: document.getElementById('contact-mobile-label').value.trim() || null,
        mobile2: document.getElementById('contact-mobile2').value.trim() || null,
        mobile2_label: document.getElementById('contact-mobile2-label').value.trim() || null,
        mobile_medical: document.getElementById('contact-mobile-medical').value.trim() || null,
    };

    try {
        if (id) {
            await store.updateContact(id, contact);
        } else {
            await store.addContact(contact);
        }
        closeContactForm();
        await renderContacts(contact.category);
    } catch (err) {
        console.error("Error saving contact:", err);
    }
};

window.deleteContactHandler = async function (id) {
    if (!confirm("Sei sicuro di voler eliminare questo contatto?")) return;

    try {
        const allContacts = await store.getContacts();
        const contact = allContacts.find(c => c.id === id);
        const categoryToRefresh = contact ? contact.category : 'sedi';

        await store.deleteContact(id);
        await renderContacts(categoryToRefresh);
    } catch (err) {
        console.error("Error deleting contact:", err);
    }
};

function setupEventListeners() {


    // Admin Login Form
    const adminLoginForm = document.getElementById('admin-login-form');
    if (adminLoginForm) {
        adminLoginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const email = document.getElementById('admin-email-input').value;
            const password = document.getElementById('admin-password-input').value;

            try {
                const btn = adminLoginForm.querySelector('button[type="submit"]');
                const originalText = btn.textContent;
                btn.disabled = true;
                btn.textContent = 'Accesso in corso...';

                await auth.signInWithEmailAndPassword(email, password);

                document.getElementById('admin-login-modal').classList.add('hidden');
                document.getElementById('admin-email-input').value = '';
                document.getElementById('admin-password-input').value = '';
                alert("Accesso Amministratore Effettuato!");

                btn.disabled = false;
                btn.textContent = originalText;
            } catch (error) {
                console.error("Errore login:", error);
                alert("Credenziali Errate o Errore di Connessione!");
                const btn = adminLoginForm.querySelector('button[type="submit"]');
                btn.disabled = false;
                btn.textContent = 'Entra';
            }
        });
    }

    // Modal Close handlers, same as before...
    const closeDetailModal = document.querySelector('.close-modal');
    if (closeDetailModal) {
        closeDetailModal.addEventListener('click', () => {
            document.getElementById('vehicle-modal').classList.add('hidden');
            renderDashboard(true); // Refresh to show note updates
        });
    }

    const closeFormModal = document.querySelector('.close-form-modal');
    if (closeFormModal) {
        closeFormModal.addEventListener('click', () => {
            document.getElementById('vehicle-form-modal').classList.add('hidden');
        });
    }

    const closeMaintenanceModal = document.querySelector('.close-maintenance-modal');
    if (closeMaintenanceModal) {
        closeMaintenanceModal.addEventListener('click', () => {
            document.getElementById('maintenance-form-modal').classList.add('hidden');
        });
    }

    const closeLocModal = document.querySelector('.close-location-modal');
    if (closeLocModal) {
        closeLocModal.addEventListener('click', () => {
            document.getElementById('location-modal').classList.add('hidden');
        });
    }

    const closeCambioModal = document.querySelector('.close-cambio-modal');
    if (closeCambioModal) {
        closeCambioModal.addEventListener('click', () => {
            document.getElementById('cambio-mezzo-modal').classList.add('hidden');
        });
    }

    const cancelBtn = document.getElementById('cancel-vehicle-btn');
    if (cancelBtn) {
        cancelBtn.addEventListener('click', () => {
            document.getElementById('vehicle-form-modal').classList.add('hidden');
        });
    }

    const cancelMaintBtn = document.getElementById('cancel-maintenance-btn');
    if (cancelMaintBtn) {
        cancelMaintBtn.addEventListener('click', () => {
            document.getElementById('maintenance-form-modal').classList.add('hidden');
        });
    }

    const cancelCambioBtn = document.getElementById('cancel-cambio-btn');
    if (cancelCambioBtn) {
        cancelCambioBtn.addEventListener('click', () => {
            document.getElementById('cambio-mezzo-modal').classList.add('hidden');
        });
    }

    const closeDataModal = document.querySelector('.close-data-modal');
    if (closeDataModal) {
        closeDataModal.addEventListener('click', () => {
            document.getElementById('data-management-modal').classList.add('hidden');
            window.lastDataManagerTab = null; // Clear history to prevent auto-reopen
        });
    }

    const btnManageData = document.getElementById('btn-manage-data');
    if (btnManageData) {
        btnManageData.onclick = function () { // Use onclick directly to avoid multi-listener issues
            console.log("Opening Data Management...");
            window.openDataManagement();
        };
    } else {
        console.error("Manage Data Button not found!");
    }


    const cambiBtn = document.getElementById('btn-cambi-mezzi');
    if (cambiBtn) {
        cambiBtn.addEventListener('click', () => {
            openCambioMezzoModal();
        });
    }

    const form = document.getElementById('vehicle-form');
    if (form) {
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            saveVehicleForm();
        });
    }

    const addLocForm = document.getElementById('add-location-form');
    if (addLocForm) {
        addLocForm.addEventListener('submit', window.addLocationHandler);
    }

    const maintenanceForm = document.getElementById('maintenance-form');
    if (maintenanceForm) {
        maintenanceForm.addEventListener('submit', (e) => {
            e.preventDefault();
            saveMaintenanceRecord();
        });
    }

    const cambioForm = document.getElementById('cambio-mezzo-form');
    if (cambioForm) {
        cambioForm.addEventListener('submit', (e) => {
            e.preventDefault();
            saveCambioMezzo();
        });
    }

    window.closeVehicleModal = function () {
        document.getElementById('vehicle-modal').classList.add('hidden');
        currentOpenedVehicleId = null;
    }

    window.onclick = function (event) {
        const modal = document.getElementById('vehicle-modal');
        const formModal = document.getElementById('vehicle-form-modal');
        const maintModal = document.getElementById('maintenance-form-modal');
        const locModal = document.getElementById('location-modal');
        const adminModal = document.getElementById('admin-login-modal');

        if (event.target == modal) {
            closeVehicleModal();
        }
        if (event.target === formModal) formModal.classList.add('hidden');
        if (event.target === maintModal) maintModal.classList.add('hidden');
        if (event.target === locModal) locModal.classList.add('hidden');
        const cambioModal = document.getElementById('cambio-mezzo-modal');
        const notesModal = document.getElementById('operational-notes-modal');
        const repairModal = document.getElementById('repair-request-modal');
        const repairHistoryModal = document.getElementById('vehicle-repair-history-modal');
        const locationFormModal = document.getElementById('location-form-modal');
        if (event.target === cambioModal) cambioModal.classList.add('hidden');
        if (event.target === adminModal) adminModal.classList.add('hidden');
        if (event.target === notesModal) closeOperationalNotesModal();
        if (event.target === repairModal) closeRepairRequestModal();
        if (event.target === repairHistoryModal) closeVehicleRepairHistoryModal();
        if (event.target === locationFormModal) window.closeLocationFormModal();
    }
}

window.openAddLocationModal = function () {
    const modal = document.getElementById('location-form-modal');
    if (!modal) return;
    document.getElementById('location-form-title').textContent = "Nuovo Luogo / Sede";
    document.getElementById('location-old-name').value = "";
    document.getElementById('location-name-input').value = "";
    document.getElementById('location-km-input').value = "";
    modal.classList.remove('hidden');
    setTimeout(() => {
        const input = document.getElementById('location-name-input');
        if (input) input.focus();
    }, 50);
};

window.addLocationHandler = async function (e) {
    if (e && e.preventDefault) e.preventDefault();
    window.openAddLocationModal();
};

window.openEditLocationModal = function (name, monthlyKm) {
    const modal = document.getElementById('location-form-modal');
    if (!modal) return;
    const decodedName = decodeURIComponent(name || '');
    document.getElementById('location-form-title').textContent = "Modifica Luogo / Sede";
    document.getElementById('location-old-name').value = decodedName;
    document.getElementById('location-name-input').value = decodedName;
    document.getElementById('location-km-input').value = (monthlyKm !== undefined && monthlyKm !== null && monthlyKm !== '') ? monthlyKm : "";
    modal.classList.remove('hidden');
    setTimeout(() => {
        const input = document.getElementById('location-km-input');
        if (input) input.focus();
    }, 50);
};

window.editLocationHandler = async function (name, monthlyKm) {
    window.openEditLocationModal(name, monthlyKm);
};

window.closeLocationFormModal = function () {
    const modal = document.getElementById('location-form-modal');
    if (modal) modal.classList.add('hidden');
};

window.saveLocationForm = async function (e) {
    if (e && e.preventDefault) e.preventDefault();
    const oldName = (document.getElementById('location-old-name').value || '').trim();
    const rawName = (document.getElementById('location-name-input').value || '').trim();
    const rawKm = document.getElementById('location-km-input').value;
    const monthlyKm = rawKm !== '' ? Number(rawKm) : 0;

    if (!rawName) {
        alert("Inserisci il nome del luogo.");
        return;
    }

    const newName = upper(rawName);

    try {
        if (oldName) {
            await store.updateLocation(upper(oldName), newName, monthlyKm);
        } else {
            await store.addLocation(newName, '#3b82f6', monthlyKm);
        }

        window.closeLocationFormModal();

        // Ricarica cache e dashboard
        cachedLocations = await store.getLocations();
        cachedLocations.sort((a, b) => a.luogo.localeCompare(b.luogo));
        await renderDashboard(true);

        const dataMgmt = document.getElementById('data-management-modal');
        if (dataMgmt && !dataMgmt.classList.contains('hidden')) {
            switchDataTable('locations');
        }
    } catch (err) {
        console.error("Errore salvataggio luogo:", err);
        alert("Errore durante il salvataggio del luogo: " + (err.message || err));
    }
};



window.saveVehicleForm = async function () {
    const id = document.getElementById('vehicle-id').value;
    const model = document.getElementById('vehicle-model').value;
    const plate = document.getElementById('vehicle-plate').value;
    const status = document.getElementById('vehicle-status').value;
    const mileage = document.getElementById('vehicle-mileage').value;
    const sigla = (document.getElementById('vehicle-sigla').value || '').trim();
    const type = document.getElementById('vehicle-type').value;
    const station = document.getElementById('vehicle-station').value;

    const mileage_month = document.getElementById('vehicle-mileage-month').value;
    const radio_id = document.getElementById('vehicle-radio').value;

    const inspection_expiry = document.getElementById('vehicle-inspection').value;
    const revision_o2 = document.getElementById('vehicle-revision-o2').value;
    const notes = document.getElementById('vehicle-notes').value;
    const dbNotesEl = document.getElementById('vehicle-db-notes');
    const db_notes = dbNotesEl ? dbNotesEl.value.trim() : '';
    const todoNotesEl = document.getElementById('vehicle-todo-notes');
    const todo_notes_raw = todoNotesEl ? todoNotesEl.value : '';
    const todo_notes = todo_notes_raw.split('\n').map(s => s.trim()).map(upper).filter(s => s !== '');
    const aleaChk = document.getElementById('vehicle-is-alea');
    const is_alea = aleaChk ? aleaChk.checked : false;

    const vehicleData = {
        model: upper(model),
        plate: upper(plate),
        sigla: upper(sigla),
        status,
        type,
        station: upper(station),
        mileage: parseInt(mileage) || 0,
        mileage_month: upper(mileage_month),
        radio_id: upper(radio_id),
        is_alea: is_alea,

        inspection_expiry: inspection_expiry || null,
        revision_o2: revision_o2 || null,
        notes: upper(notes),
        db_notes: db_notes,
        todo_notes: todo_notes
    };

    if (id) {
        // Optimistic Update for Existing Vehicle
        const existing = cachedVehicles ? cachedVehicles.find(v => v.id === id) : await store.getVehicleById(id);
        if (existing) {
            const updated = { ...existing, ...vehicleData };

            // Update Cache
            if (cachedVehicles) {
                const idx = cachedVehicles.findIndex(v => v.id === id);
                if (idx !== -1) cachedVehicles[idx] = updated;
            }

            // Render UI Immediately (Optimistic)
            document.getElementById('vehicle-form-modal').classList.add('hidden');
            renderDashboard(false);

            // Persist to DB and wait
            try {
                await store.updateVehicle(updated);
            } catch (err) {
                console.error("Failed to update vehicle:", err);
                alert("Errore salvataggio modifiche nel database. Ricaricare la pagina.");
            }
        }
    } else {
        // New Vehicle - Wait for DB
        const newId = type.substring(0, 3).toUpperCase() + '-' + Math.floor(100 + Math.random() * 900) + '-' + Math.floor(10 + Math.random() * 90);
        const newVehicle = {
            id: newId,
            ...vehicleData,
            maintenanceHistory: []
        };
        await store.addVehicle(newVehicle);
        document.getElementById('vehicle-form-modal').classList.add('hidden');
        await renderDashboard(true);
    }

    // Refresh Data Management table if it's open
    const dataModal = document.getElementById('data-management-modal');
    if (dataModal && !dataModal.classList.contains('hidden')) {
        await switchDataTable(window.lastDataManagerTab || 'vehicles');
    }



    if (!document.getElementById('vehicle-modal').classList.contains('hidden') && id) {
        window.openVehicleModal(id);
    }
}

window.openVehicleModal = async function (id) {
    currentOpenedVehicleId = id;
    let vehicle = await store.getVehicleById(id);
    if (!vehicle) return;

    if (cachedVehicles) {
        const updated = cachedVehicles.find(v => v.id === id);
        if (updated) vehicle = updated;
    }

    const now = new Date();
    const currentYM = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const hasCheckThisMonth = vehicle.monthly_checks && vehicle.monthly_checks.some(c => c.date && c.date.startsWith(currentYM));

    const modal = document.getElementById('vehicle-modal');
    const content = document.getElementById('vehicle-details-content');

    let statusColorClass = '';
    if (vehicle.status === 'operative') statusColorClass = 'status-operative';
    else if (vehicle.status === 'available') statusColorClass = 'status-available';
    else if (vehicle.status === 'maintenance') statusColorClass = 'status-maintenance';
    else statusColorClass = 'status-to-repair';

    content.innerHTML = `
                <div class="modal-header-image" style="position: relative; padding: 1.5rem 1.5rem 0 1.5rem;">
                    <button onclick="closeVehicleModal()" style="position: absolute; top: 1rem; right: 1rem; background: rgba(0,0,0,0.5); border: none; color: white; width: 32px; height: 32px; border-radius: 50%; cursor: pointer; font-size: 1.2rem; display: flex; align-items: center; justify-content: center; z-index: 10;">&times;</button>
                    <div class="status-badge ${statusColorClass}" style="position: relative; top: 0; left: 0; font-size: 1.1rem; padding: 0.6rem 1.2rem; display: inline-block; margin-bottom: 1rem;">
                        ${getStatusLabel(vehicle.status)}
                    </div>
                </div>
                <div style="padding: 1.5rem;">
                    <div class="modal-main-title" style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 1rem;">
                        <div>
                            <div>
                                <div style="display: flex; gap: 0.75rem; align-items: center; margin-bottom: 0.25rem; flex-wrap: wrap;">
                                    ${vehicle.sigla ? `<h1 style="font-size: 1.5rem; font-weight: 800; color: var(--primary-color); margin: 0;">${vehicle.sigla}</h1>` : ''}
                                    <h1 style="font-size: 1.5rem; font-weight: 800; color: var(--text-primary); margin: 0;">${vehicle.plate}</h1>
                                    ${(window.isAleaVehicle && window.isAleaVehicle(vehicle)) ? '<span style="background: #fef3c7; color: #92400e; border: 1px solid #fde68a; font-size: 0.75rem; font-weight: 700; padding: 0.15rem 0.5rem; border-radius: 6px; letter-spacing: 0.05em; vertical-align: middle;"><i class="fa-solid fa-file-contract"></i> ALEA</span>' : ''}
                                </div>
                                <div style="display: flex; gap: 0.5rem; align-items: center;">
                                    <h2 style="font-size: 1.1rem; margin: 0; color: var(--text-secondary); font-weight: 600;">${vehicle.model}</h2>
                                    <span style="color: var(--border-color);">|</span>
                                    <span style="color: var(--text-secondary); font-weight: 500; font-size: 0.9rem;">${vehicle.type}</span>
                                </div>
                            </div>
                        </div>
                        <div style="text-align: right; display: flex; gap: 0.5rem; flex-wrap: wrap;">
                            <button class="btn btn-repair-request" style="background: #16a34a; color: white; padding: 0.4rem 0.8rem; font-size: 0.85rem; border: none; border-radius: 0.375rem; cursor: pointer; display: flex; align-items: center; gap: 0.4rem;" onclick="openRepairRequestModal('${vehicle.id}')" title="Compila e scarica richiesta riparazione Word">
                                <i class="fa-solid fa-file-word"></i> Richiesta Riparazione
                            </button>
                            <button class="btn btn-wash-request" style="background: #06b6d4; color: white; padding: 0.4rem 0.8rem; font-size: 0.85rem; border: none; border-radius: 0.375rem; cursor: pointer; display: flex; align-items: center; gap: 0.4rem;" onclick="openWashModal('${vehicle.id}')" title="Compila e scarica modulo lavaggio Word (stampato)">
                                <i class="fa-solid fa-shower"></i> Modulo Lavaggio
                            </button>
                            <button class="btn" style="background: #0284c7; color: white; padding: 0.4rem 0.8rem; font-size: 0.85rem; border: none; border-radius: 0.375rem; cursor: pointer; display: flex; align-items: center; gap: 0.4rem;" onclick="openVehicleRepairHistoryModal('${vehicle.id}')" title="Visualizza lo storico delle richieste di riparazione">
                                <i class="fa-solid fa-clock-rotate-left"></i> Storico Richieste ${(vehicle.repair_requests && vehicle.repair_requests.length > 0) ? `<span style="background: rgba(255,255,255,0.25); padding: 0.1rem 0.45rem; border-radius: 9999px; font-size: 0.75rem; font-weight: 700;">${vehicle.repair_requests.length}</span>` : ''}
                            </button>
                            ${isAdmin ? `<button class="btn btn-primary" style="padding: 0.4rem 0.8rem; font-size: 0.85rem;" onclick="openVehicleForm('${vehicle.id}')"><i class="fa-solid fa-pen"></i> Modifica</button>` : ''}
                        </div>
                    </div>

                    <div class="form-grid-3" style="margin-bottom: 0.75rem; background: #f8fafc; padding: 0.5rem 1rem; border-radius: 0.75rem;">
                        <div>
                            <div style="font-size: 0.7rem; text-transform: uppercase; color: var(--text-secondary); font-weight: 800; margin-bottom: 0.2rem;">Posizione</div>
                            <div style="font-size: 1.1rem; font-weight: 600; color: black;">${vehicle.station}</div>
                        </div>
                        <div>
                            <div style="font-size: 0.75rem; text-transform: uppercase; color: black; font-weight: 600; margin-bottom: 0.25rem;">Chilometri</div>
                            <div style="font-size: 1.1rem; font-weight: 600; color: black;">${parseInt(vehicle.mileage).toLocaleString()} km</div>
                        </div>
                        <div>
                            <div style="font-size: 0.75rem; text-transform: uppercase; color: black; font-weight: 600; margin-bottom: 0.25rem;">Mese Riferimento Km</div>
                            <div style="font-size: 1.1rem; font-weight: 600; color: black;">${vehicle.mileage_month || '-'}</div>
                        </div>
                    </div>

                    ${(() => {
            // Logica: ultimo intervento con "TAGLIANDO" vs km più recente (incluso vehicle.mileage)
            const histModal = vehicle.maintenanceHistory || [];
            
            const parseKmSafe = (val) => {
                if (!val) return 0;
                return parseInt(val.toString().replace(/[^0-9]/g, '')) || 0;
            };
            const currentMileage = parseKmSafe(vehicle.mileage);

            let maxKm = currentMileage;
            const withKm = histModal.filter(r => r.km != null && r.km !== '' && parseKmSafe(r.km) > 0);
            if (withKm.length > 0) {
                const maxHistoryKm = Math.max(...withKm.map(r => parseKmSafe(r.km)));
                maxKm = Math.max(maxKm, maxHistoryKm);
            }

            const tagliandoListWithKm = withKm.filter(r => r.description && r.description.toUpperCase().includes('TAGLIANDO'));
            
            let referenceKm = null;
            if (tagliandoListWithKm.length > 0) {
                referenceKm = Math.max(...tagliandoListWithKm.map(r => parseKmSafe(r.km)));
            } else if (currentMileage > 0) {
                referenceKm = currentMileage;
            }

            if (referenceKm !== null) {
                const delta = maxKm - referenceKm;
                if (delta >= 20000) {
                    return `<div style="margin-bottom: 0.75rem; background: #fff3cd; border: 2px solid #f59e0b; border-radius: 0.75rem; padding: 0.75rem 1rem; display: flex; align-items: center; gap: 0.75rem;">
                                        <div style="background: #f59e0b; color: white; padding: 0.5rem; border-radius: 0.5rem; flex-shrink: 0;">
                                            <i class="fa-solid fa-wrench"></i>
                                        </div>
                                        <div>
                                            <div style="font-weight: 700; color: #b45309; margin-bottom: 0.1rem;">Avviso: Possibile Tagliando</div>
                                            <div style="font-size: 0.85rem; color: #92400e;"><strong>${delta.toLocaleString()} km</strong> dall'ultimo riferimento (${referenceKm.toLocaleString()} km)</div>
                                        </div>
                                    </div>`;
                }
            }
            return '';
        })()}

                    <div class="form-grid-3" style="margin-bottom: 0.75rem; background: #f1f5f9; padding: 0.5rem 1rem; border-radius: 0.75rem;">
                        <div>
                            <div style="font-size: 0.75rem; text-transform: uppercase; color: black; font-weight: 600; margin-bottom: 0.25rem;">ID Radio</div>
                            <div style="font-size: 0.95rem; font-weight: 600; color: black;">${vehicle.radio_id || '-'}</div>
                        </div>
                        <div>
                            <div style="font-size: 0.75rem; text-transform: uppercase; color: black; font-weight: 600; margin-bottom: 0.25rem;">Scadenza Revisione</div>
                            <div style="font-size: 0.95rem; font-weight: 600; color: black;">${vehicle.inspection_expiry ? formatDate(vehicle.inspection_expiry) : '-'}</div>
                        </div>
                        <div>
                            <div style="font-size: 0.75rem; text-transform: uppercase; color: black; font-weight: 600; margin-bottom: 0.25rem;">Ultima revisione O2</div>
                            <div style="font-size: 0.95rem; font-weight: 600; color: black;">${vehicle.revision_o2 ? formatDate(vehicle.revision_o2) : '-'}</div>
                        </div>
                    </div>

                    <div class="vehicle-modal-sections-row">
                        <div class="appointment-block" style="background: #fff7ed; padding: 1rem; border: 2px solid #1e3a8a; border-radius: 0.75rem; display: flex; flex-direction: column; align-items: stretch; gap: 0.75rem;">
                            <div style="display: flex; align-items: center; gap: 1rem;">
                                <div style="background: #1e3a8a; color: white; padding: 0.5rem; border-radius: 0.5rem;">
                                    <i class="fa-solid fa-calendar-check" style="font-size: 1.2rem;"></i>
                                </div>
                                <div>
                                    <div style="font-size: 0.75rem; text-transform: uppercase; color: #1e3a8a; font-weight: 800; margin-bottom: 0.1rem;">Prossimo Appuntamento</div>
                                    <div style="font-size: 1.1rem; font-weight: 700; color: #1e3a8a;">
                                        ${vehicle.appointment_date ? formatDate(vehicle.appointment_date) : 'Nessun appuntamento'}
                                        ${(vehicle.appointment_date && vehicle.appointment_location) ? `<span style="font-weight: 400; font-size: 0.9rem; margin-left: 0.5rem;">(${vehicle.appointment_location})</span>` : ''}
                                    </div>
                                </div>
                            </div>
                            ${isAdmin ? `
                                <div class="admin-appointment-controls" style="display: flex; flex-direction: column; gap: 0.5rem; align-items: stretch; width: 100%;">
                                    <div style="display: flex; align-items: center; gap: 0.5rem; width: 100%;">
                                        <input type="date" id="admin-appointment-input" value="${vehicle.appointment_date || ''}" 
                                               style="padding: 0.4rem; border: 1px solid #1e3a8a; border-radius: 0.4rem; font-size: 0.9rem; flex-grow: 1; min-width: 0; background-color: white; color: black; color-scheme: light;">
                                        <button class="btn btn-primary" style="padding: 0.4rem 0.6rem; flex-shrink: 0;" onclick="saveVehicleAppointment('${vehicle.id}', document.getElementById('admin-appointment-input').value, document.getElementById('admin-appointment-location').value)" title="Salva appuntamento">
                                            <i class="fa-solid fa-save"></i>
                                        </button>
                                        <button class="btn" style="padding: 0.4rem 0.6rem; background: #ef4444; color: white; flex-shrink: 0;" onclick="setTimeout(() => { if(confirm('Annullare l\\\'appuntamento corrente?')) { document.getElementById('admin-appointment-input').value = ''; document.getElementById('admin-appointment-location').value = ''; saveVehicleAppointment('${vehicle.id}', '', ''); } }, 50)" title="Cancella appuntamento">
                                            <i class="fa-solid fa-trash"></i>
                                        </button>
                                    </div>
                                    <select id="admin-appointment-location" style="padding: 0.4rem; border: 1px solid #1e3a8a; border-radius: 0.4rem; font-size: 0.9rem; width: 100%;">
                                        <option value="">Seleziona Luogo...</option>
                                        ${cachedLocations.map(loc => `<option value="${loc.luogo}" ${(vehicle.appointment_date && vehicle.appointment_location === loc.luogo) ? 'selected' : ''}>${loc.luogo}</option>`).join('')}
                                    </select>
                                </div>
                            ` : ''}
                        </div>

                        <div class="monthly-check-block" style="background: #f0fdfa; padding: 1rem; border: 2px solid #2dd4bf; border-radius: 0.75rem;">
                            <div style="display: flex; align-items: center; justify-content: space-between;">
                                <div style="display: flex; align-items: center; gap: 0.75rem;">
                                    <div style="background: #2dd4bf; color: white; padding: 0.5rem; border-radius: 0.5rem; display: flex; align-items: center; justify-content: center;">
                                        <i class="fa-solid fa-circle-check" style="font-size: 1.2rem;"></i>
                                    </div>
                                    <div>
                                        <div style="font-size: 0.75rem; text-transform: uppercase; color: #0f766e; font-weight: 800; margin-bottom: 0.1rem;">Controllo Scadenze Mensile</div>
                                        <div style="font-size: 1rem; font-weight: 700; color: #0f766e;">
                                            ${(function() {
                                                const now = new Date();
                                                const currentYM = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
                                                const thisMonthChecks = (vehicle.monthly_checks || []).filter(c => c.date && c.date.startsWith(currentYM));
                                                if (thisMonthChecks.length > 0) {
                                                    return `EFFETTUATO (${formatDate(thisMonthChecks[0].date)})`;
                                                } else {
                                                    return 'NON EFFETTUATO QUESTO MESE';
                                                }
                                            })()}
                                        </div>
                                    </div>
                                </div>
                            </div>

                            ${isAdmin ? `
                                <div style="border-top: 1px dashed #99f6e4; padding-top: 0.75rem; margin-top: 0.75rem;">
                                    <div style="display: flex; flex-direction: column; gap: 0.5rem;">
                                        <div style="display: flex; gap: 0.5rem;">
                                            <input type="date" id="admin-monthly-check-date" value="${getLocalISODate()}" 
                                                   style="padding: 0.4rem; border: 1px solid #2dd4bf; border-radius: 0.4rem; font-size: 0.9rem; flex-grow: 1; min-width: 0; background-color: white; color: black; color-scheme: light;">
                                            ${hasCheckThisMonth ? `
                                                <button class="btn" style="background-color: #ef4444; color: white; padding: 0.4rem 0.8rem; font-weight: bold; font-size: 0.85rem; border-radius: 0.4rem; border: none; cursor: pointer;"
                                                        onclick="deleteCurrentMonthCheck('${vehicle.id}')">
                                                    <span class="btn-text-desktop">Elimina Controllo</span>
                                                    <span class="btn-text-mobile">Elimina</span>
                                                </button>
                                            ` : `
                                                <button class="btn btn-register-check" 
                                                        onclick="saveMonthlyCheck('${vehicle.id}', document.getElementById('admin-monthly-check-date').value, document.getElementById('admin-monthly-check-notes').value, document.getElementById('admin-monthly-check-executor').value, document.getElementById('admin-monthly-check-location').value)">
                                                    <span class="btn-text-desktop">Registra Controllo</span>
                                                    <span class="btn-text-mobile">Registra</span>
                                                </button>
                                            `}
                                        </div>
                                        <div style="display: flex; gap: 0.5rem;">
                                            <input type="text" id="admin-monthly-check-executor" placeholder="Esecutore" 
                                                   style="padding: 0.4rem; border: 1px solid #2dd4bf; border-radius: 0.4rem; font-size: 0.9rem; width: 50%; color: black; background-color: white;">
                                            <select id="admin-monthly-check-location" 
                                                    style="padding: 0.4rem; border: 1px solid #2dd4bf; border-radius: 0.4rem; font-size: 0.9rem; width: 50%; color: black; background-color: white;">
                                                <option value="">Posizione...</option>
                                                ${cachedLocations.map(loc => `<option value="${loc.luogo}">${loc.luogo}</option>`).join('')}
                                            </select>
                                        </div>
                                        <input type="text" id="admin-monthly-check-notes" placeholder="Note controllo (es. OK, fari regolati...)" 
                                               style="padding: 0.4rem; border: 1px solid #2dd4bf; border-radius: 0.4rem; font-size: 0.9rem; width: 100%; color: black; background-color: white;">
                                    </div>
                                </div>
                            ` : ''}
                        </div>

                        <div class="todo-block" style="background: #f8fafc; padding: 1rem; border: 2px solid #94a3b8; border-radius: 0.75rem;">
                            <div style="font-size: 0.75rem; text-transform: uppercase; color: #475569; font-weight: 800; margin-bottom: 0.75rem; display: flex; align-items: center; gap: 0.5rem;">
                                <i class="fa-solid fa-clipboard-list" style="font-size: 1rem;"></i> Memo
                            </div>
                            ${(function () {
                                let todos = [];
                                if (Array.isArray(vehicle.todo_notes)) {
                                    todos = vehicle.todo_notes.flatMap(note => (note || '').toString().split('\n').map(s => s.trim()).filter(s => s !== ''));
                                } else if (vehicle.todo_notes && typeof vehicle.todo_notes === 'string' && vehicle.todo_notes.trim() !== '') {
                                    todos = vehicle.todo_notes.split('\n').map(s => s.trim()).filter(s => s !== '');
                                }
                                let html = '';
                                
                                if (todos.length > 0) {
                                    html += '<div style="display: flex; flex-direction: column; gap: 0.5rem;">';
                                    html += todos.map((note, idx) => `
                                        <div style="background-color: white; border: 1px solid var(--border-color); border-radius: 0.5rem; padding: 0.75rem; color: black; display: flex; justify-content: space-between; align-items: flex-start; gap: 0.5rem;">
                                            <div style="flex-grow: 1; font-size: 0.95rem; white-space: pre-wrap;">${note}</div>
                                            ${isAdmin ? `
                                            <button class="btn" style="background: #ef4444; color: white; padding: 0.3rem 0.6rem; font-size: 0.8rem; border-radius: 0.3rem; flex-shrink: 0;" onclick="deleteTodoNote(event, '${vehicle.id}', ${idx})" title="Elimina">
                                                <i class="fa-solid fa-trash"></i>
                                            </button>
                                            ` : ''}
                                        </div>
                                    `).join('');
                                    html += '</div>';
                                } else {
                                    html += `<div style="font-style: italic; color: var(--text-secondary); font-size: 0.85rem;">Nessuna attività da fare</div>`;
                                }
                                
                                if (isAdmin) {
                                    html += `
                                        <button class="btn" style="background: transparent; border: 1px dashed #94a3b8; color: #475569; width: 100%; padding: 0.75rem; text-align: center; border-radius: 0.5rem; margin-top: 0.75rem;" onclick="addTodoNote(event, '${vehicle.id}')">
                                            <i class="fa-solid fa-plus"></i> ${todos.length > 0 ? 'Aggiungi ulteriore attività' : 'Aggiungi attività'}
                                        </button>
                                    `;
                                }
                                return html;
                            })()}
                        </div>
                    </div>

                    <div style="margin-bottom: 1.5rem;">
                        <label style="font-size: 0.75rem; text-transform: uppercase; color: black; font-weight: 600; margin-bottom: 0.25rem; display: block;">Problematiche Note</label>
                        <textarea id="vehicle-notes-textarea"
                            style="width: 100%; padding: 0.75rem; border: 1px solid var(--border-color); border-radius: 0.5rem; font-family: inherit; font-size: 0.95rem; resize: vertical; min-height: 80px; color: black; ${!isAdmin ? 'background-color: #f8fafc; cursor: not-allowed;' : ''}"
                            placeholder="${isAdmin ? 'Scrivi qui le problematiche note del mezzo...' : 'Nessuna problematica nota'}"
                            ${!isAdmin ? 'readonly' : ''}
                        >${vehicle.notes || ''}</textarea>
                        ${isAdmin ? `<div style="text-align: right; margin-top: 0.5rem;">
                            <button class="btn btn-primary" style="padding: 0.4rem 0.8rem; font-size: 0.85rem;" onclick="saveVehicleNote('${vehicle.id}', document.getElementById('vehicle-notes-textarea').value, true)">
                                <i class="fa-solid fa-save"></i> Salva Problematiche Note
                            </button>
                        </div>` : ''}
                    </div>

                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
                        <h3 style="font-size: 1.1rem; margin: 0; color: black;">Storico Manutenzione</h3>
                        ${isAdmin ? `<button class="btn btn-primary" style="font-size: 0.9rem; padding: 0.5rem 1rem;" onclick="openMaintenanceForm('${vehicle.id}', '${vehicle.sigla || vehicle.plate}')">
                    <i class="fa-solid fa-plus"></i> Aggiungi Manutenzione
                </button>` : ''}
                    </div>

                    <div style="background: white; border: 1px solid var(--border-color); border-radius: 1rem; overflow-x: auto;">
                        ${vehicle.maintenanceHistory && vehicle.maintenanceHistory.length > 0 ? `
                    <table style="width: 100%; border-collapse: collapse;">
                        <thead style="background: #f8fafc; border-bottom: 1px solid var(--border-color);">
                            <tr>
                                <th style="text-align: left; padding: 1rem; font-size: 0.85rem; color: var(--text-secondary);">Data Entrata</th>
                                <th style="text-align: left; padding: 1rem; font-size: 0.85rem; color: var(--text-secondary);">Data Uscita</th>
                                <th style="text-align: left; padding: 1rem; font-size: 0.85rem; color: var(--text-secondary);">Officina</th>
                                <th style="text-align: left; padding: 1rem; font-size: 0.85rem; color: var(--text-secondary);">KM</th>
                                <th style="text-align: left; padding: 1rem; font-size: 0.85rem; color: var(--text-secondary);">Descrizione</th>
                                <th style="text-align: right; padding: 1rem; font-size: 0.85rem; color: var(--text-secondary);">Azioni</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${vehicle.maintenanceHistory.map(record => `
                                <tr style="border-bottom: 1px solid var(--border-color);">
                                    <td style="padding: 1rem; font-weight: 500;">${record.date ? formatDate(record.date) : '-'}</td>
                                    <td style="padding: 1rem; font-weight: 500;">${record.date_out ? formatDate(record.date_out) : '-'}</td>
                                    <td style="padding: 1rem; font-weight: 500;">${record.workshop || '-'}</td>
                                    <td style="padding: 1rem; font-weight: 600; color: var(--primary-color);">${record.km ? parseInt(record.km).toLocaleString() + ' km' : '-'}</td>
                                    <td style="padding: 1rem;">${record.description}</td>
                                    ${isAdmin ? `
                                    <td style="padding: 1rem; text-align: right;">
                                        <button class="btn" style="padding: 0.25rem 0.5rem; font-size: 0.8rem; background: var(--primary-color); color: white; margin-right: 0.5rem;" onclick='openMaintenanceForm("${vehicle.id}", "${vehicle.sigla || vehicle.plate}", ${JSON.stringify(record).replace(/'/g, "&#39;")})'><i class="fa-solid fa-pen"></i></button>
                                        <button class="btn" style="padding: 0.25rem 0.5rem; font-size: 0.8rem; background: var(--status-to-repair); color: white;" onclick="deleteMaintenanceRecord('${record.id}', '${vehicle.id}')"><i class="fa-solid fa-trash"></i></button>
                                    </td>
                                    ` : ''}
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                ` : '<p style="padding: 2rem; text-align: center; color: var(--text-secondary);">Nessun record di manutenzione trovato.</p>'}
                    </div>
                </div>
                `;

    modal.classList.remove('hidden');
}

window.deleteVehicleHandler = async function (id) {
    setTimeout(() => {
        if (confirm('Sei sicuro di voler eliminare questo veicolo?')) {
            store.deleteVehicle(id).then(() => {
                document.getElementById('vehicle-modal').classList.add('hidden');
                renderDashboard();
            });
        }
    }, 50);
}

window.deleteMaintenanceRecord = async function (recordId, vehicleId) {
    setTimeout(() => {
        if (confirm('Eliminare questo record?')) {
            store.deleteIntervention(recordId).then(() => {
                openVehicleModal(vehicleId);
            });
        }
    }, 50);
}

window.openMaintenanceForm = function (vehicleId, vehicleSigla, record = null) {
    const modal = document.getElementById('maintenance-form-modal');
    const form = document.getElementById('maintenance-form');
    const workshopSelect = document.getElementById('maintenance-workshop');

    form.reset();
    document.getElementById('maintenance-vehicle-id').value = vehicleId;
    document.getElementById('maintenance-vehicle-sigla').value = vehicleSigla || 'N/A';

    // Populate Workshop dropdown from cachedLocations
    workshopSelect.innerHTML = '<option value="">-- Seleziona Officina --</option>' +
        (cachedLocations || []).map(loc => `<option value="${loc.luogo}">${loc.luogo}</option>`).join('');

    if (record) {
        // Edit Mode
        document.querySelector('#maintenance-form-modal h3').textContent = 'Modifica Manutenzione';
        document.getElementById('maintenance-id').value = record.id;
        document.getElementById('maintenance-date').value = record.date;
        document.getElementById('maintenance-date-out').value = record.date_out || '';
        document.getElementById('maintenance-workshop').value = record.workshop || '';
        document.getElementById('maintenance-km').value = record.km || '';
        document.getElementById('maintenance-description').value = record.description;
    } else {
        // Add Mode
        document.querySelector('#maintenance-form-modal h3').textContent = 'Aggiungi Manutenzione';
        document.getElementById('maintenance-id').value = '';
        document.getElementById('maintenance-date').valueAsDate = new Date();
        document.getElementById('maintenance-date-out').value = '';
        document.getElementById('maintenance-workshop').value = '';
        document.getElementById('maintenance-km').value = '';
        document.getElementById('maintenance-description').value = '';
    }

    modal.classList.remove('hidden');
}

window.saveMaintenanceRecord = async function (e) {
    if (e) e.preventDefault(); // Handle form submit event

    const vehicleId = document.getElementById('maintenance-vehicle-id').value;
    const id = document.getElementById('maintenance-id').value;
    const date = document.getElementById('maintenance-date').value;
    const date_out = document.getElementById('maintenance-date-out').value;
    const workshop = document.getElementById('maintenance-workshop').value;
    const kmVal = document.getElementById('maintenance-km').value;
    const description = document.getElementById('maintenance-description').value;

    // Fetch vehicle to get sigla
    const vehicle = await store.getVehicleById(vehicleId);
    const vehicleSigla = vehicle ? (vehicle.sigla || vehicle.plate) : 'N/A';

    const record = {
        date,
        date_out: date_out || null,
        workshop: upper(workshop),
        km: kmVal ? parseInt(kmVal) : null,
        description: upper(description),
        type: 'Routine',
        cost: 0
        // 'sigla' removed as it's not a column in 'interventions' table
    };

    try {
        if (id) {
            await store.updateIntervention(id, record);
        } else {
            await store.addIntervention(vehicleId, record);
        }
        document.getElementById('maintenance-form-modal').classList.add('hidden');

        // Refresh appropriate views
        await renderDashboard();
        if (!document.getElementById('vehicle-modal').classList.contains('hidden') && vehicleId) {
            await openVehicleModal(vehicleId);
        }

        // Refresh Data Management table if it's open
        const dataModal = document.getElementById('data-management-modal');
        if (dataModal && !dataModal.classList.contains('hidden')) {
            await switchDataTable(window.lastDataManagerTab || 'interventions');
        }

        // If data management was used, re-open it to requested tab
        // We can detect if it was likely open or just always refresh dashboard/lists
        // Let's check a global flag or just rely on manual re-opening if needed, 
        // but for better UX, let's try to detect.
        // For now, let's just make sure switchDataTable is called if we want to be proactive.

    } catch (error) {
        console.error("Error saving record:", error);
        alert("Errore durante il salvataggio: " + error.message);
    }
}

function convertToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve(reader.result);
        reader.onerror = (error) => reject(error);
    });
}
// Mileage Month Auto-Save
window.saveVehicleMileageMonth = async function (id, text) {
    try {
        const vehicle = await store.getVehicleById(id);
        if (vehicle) {
            vehicle.mileage_month = upper(text);
            await store.updateVehicle(vehicle);
            renderDashboard(true); // Use renderDashboard instead of legacy loadVehicles
        }
    } catch (e) {
        console.error('Error saving mileage month:', e);
        alert('Errore nel salvataggio del mese chilometri');
    }
}

// Appointment Save (Admin Only)
window.saveVehicleAppointment = async function (id, date, location) {
    try {
        const vehicle = await store.getVehicleById(id);
        if (vehicle) {
            vehicle.appointment_date = date || null;
            vehicle.appointment_location = vehicle.appointment_date ? (upper(location) || null) : null;
            vehicle.alert_ack_date = null; // Reset ack for new appointment
            clearDismissedAlert(id);
            await store.updateVehicle(vehicle);
            alert("Appuntamento aggiornato.");
            // Refresh detail modal and dashboard
            closeVehicleModal();
            renderDashboard(true);
        }
    } catch (error) {
        console.error("Error saving appointment:", error);
        alert("Errore durante il salvataggio dell'appuntamento.");
    }
}

// Monthly Check Save (Admin Only)
window.saveMonthlyCheck = async function (id, date, notes, executor, location) {
    try {
        const vehicle = await store.getVehicleById(id);
        if (vehicle) {
            if (!vehicle.monthly_checks) {
                vehicle.monthly_checks = [];
            }
            vehicle.monthly_checks.unshift({
                date: date || getLocalISODate(),
                notes: (notes || '').toString().trim(),
                executor: (executor || '').toString().trim(),
                location: (location || '').toString().trim()
            });
            await store.updateVehicle(vehicle);
            alert("Controllo scadenze mensile registrato.");
            closeVehicleModal();
            renderDashboard(true);
        }
    } catch (error) {
        console.error("Error saving monthly check:", error);
        alert("Errore durante il salvataggio del controllo scadenze mensile.");
    }
}

window.deleteMonthlyCheckFromDb = async function (id, date, notes, executor, location) {
    setTimeout(() => {
        if (!confirm("Eliminare questa registrazione di controllo?")) return;
        try {
            const vehicle = cachedVehicles.find(v => v.id === id); // fetch from cache for sync check or query
            store.getVehicleById(id).then(vehicle => {
                if (vehicle && vehicle.monthly_checks) {
                    const idx = vehicle.monthly_checks.findIndex(c => 
                        c.date === date && 
                        (c.notes || '') === (notes || '') && 
                        (c.executor || '') === (executor || '') && 
                        (c.location || '') === (location || '')
                    );
                    if (idx !== -1) {
                        vehicle.monthly_checks.splice(idx, 1);
                        store.updateVehicle(vehicle).then(() => {
                            alert("Controllo eliminato.");
                            switchDataTable('controlli');
                            renderDashboard(true);
                        });
                    } else {
                        alert("Controllo non trovato nel database.");
                    }
                }
            });
        } catch (e) {
            console.error("Error deleting monthly check:", e);
            alert("Errore durante l'eliminazione del controllo.");
        }
    }, 50);
}

window.deleteCurrentMonthCheck = async function (id) {
    setTimeout(() => {
        if (!confirm("Eliminare la registrazione di controllo per questo mese?")) return;
        store.getVehicleById(id).then(vehicle => {
            if (vehicle && vehicle.monthly_checks) {
                const now = new Date();
                const currentYM = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
                const idx = vehicle.monthly_checks.findIndex(c => c.date && c.date.startsWith(currentYM));
                if (idx !== -1) {
                    vehicle.monthly_checks.splice(idx, 1);
                    store.updateVehicle(vehicle).then(() => {
                        alert("Controllo mensile eliminato.");
                        closeVehicleModal();
                        renderDashboard(true);
                    });
                } else {
                    alert("Nessun controllo mensile trovato per questo mese.");
                }
            }
        }).catch(e => {
            console.error("Error deleting current monthly check:", e);
            alert("Errore durante l'eliminazione del controllo mensile.");
        });
    }, 50);
}

window.openEditMonthlyCheckModal = function (vehicleId, date, notes, executor, location) {
    document.getElementById('edit-check-vehicle-id').value = vehicleId;
    document.getElementById('edit-check-original-date').value = date;
    document.getElementById('edit-check-original-notes').value = notes || '';
    document.getElementById('edit-check-original-executor').value = executor || '';
    document.getElementById('edit-check-original-location').value = location || '';
    
    document.getElementById('edit-check-date').value = date;
    document.getElementById('edit-check-notes').value = notes || '';
    document.getElementById('edit-check-executor').value = executor || '';
    
    // Populate locations select dynamically
    const select = document.getElementById('edit-check-location');
    if (select) {
        select.innerHTML = '<option value="">Posizione...</option>' +
            cachedLocations.map(loc => `<option value="${loc.luogo}" ${location === loc.luogo ? 'selected' : ''}>${loc.luogo}</option>`).join('');
    }
    
    document.getElementById('monthly-check-edit-modal').classList.remove('hidden');
}

window.saveEditedMonthlyCheck = async function () {
    const vehicleId = document.getElementById('edit-check-vehicle-id').value;
    const origDate = document.getElementById('edit-check-original-date').value;
    const origNotes = document.getElementById('edit-check-original-notes').value;
    const origExecutor = document.getElementById('edit-check-original-executor').value;
    const origLocation = document.getElementById('edit-check-original-location').value;
    
    const newDate = document.getElementById('edit-check-date').value;
    const newNotes = (document.getElementById('edit-check-notes').value || '').trim();
    const newExecutor = (document.getElementById('edit-check-executor').value || '').trim();
    const newLocation = document.getElementById('edit-check-location').value;
    
    if (!newDate) {
        alert("La data è obbligatoria.");
        return;
    }
    
    try {
        const vehicle = await store.getVehicleById(vehicleId);
        if (vehicle && vehicle.monthly_checks) {
            const idx = vehicle.monthly_checks.findIndex(c => 
                c.date === origDate && 
                (c.notes || '') === origNotes && 
                (c.executor || '') === origExecutor && 
                (c.location || '') === origLocation
            );
            if (idx !== -1) {
                vehicle.monthly_checks[idx] = {
                    date: newDate,
                    notes: newNotes,
                    executor: newExecutor,
                    location: newLocation
                };
                vehicle.monthly_checks.sort((a, b) => new Date(b.date) - new Date(a.date));
                
                await store.updateVehicle(vehicle);
                alert("Controllo modificato con successo.");
                document.getElementById('monthly-check-edit-modal').classList.add('hidden');
                switchDataTable('controlli');
                renderDashboard(true);
            } else {
                alert("Controllo originale non trovato.");
            }
        }
    } catch (e) {
        console.error("Error editing monthly check:", e);
        alert("Errore durante il salvataggio delle modifiche.");
    }
}

window.acknowledgeAppointmentAlert = async function (event, id) {
    if (event) {
        event.stopPropagation();
        event.preventDefault();
    }

    try {
        const todayStr = getLocalISODate();
        setDismissedToday(id);

        // 1. Optimistic Update in Cache
        if (cachedVehicles) {
            const v = cachedVehicles.find(item => item.id === id);
            if (v) {
                v.alert_ack_date = todayStr;
                renderVehicleGrid(cachedVehicles);
            }
        }

        // 2. Persistent Update in DB
        const vehicle = await store.getVehicleById(id);
        if (vehicle) {
            vehicle.alert_ack_date = todayStr;
            await store.updateVehicle(vehicle);
            // Full refresh to ensure consistency
            renderDashboard(true);
        }
    } catch (error) {
        console.error("Error acknowledging alert:", error);
        alert("Errore durante la conferma dell'avviso. Riprova.");
    }
}

// Note Auto-Save
window.saveVehicleNote = async function (id, text, showFeedback = false) {
    try {
        const vehicle = await store.getVehicleById(id);
        if (vehicle) {
            vehicle.notes = upper(text);
            await store.updateVehicle(vehicle);
            await renderDashboard(true); // Force refresh
            if (showFeedback) {
                alert('Note aggiornate con successo!');
                document.getElementById('vehicle-modal').classList.add('hidden');
            }
        }
    } catch (e) {
        console.error('Error saving note:', e);
        alert('Errore nel salvataggio della nota');
    }
}

// Note Da Fare Save
window.saveVehicleTodoNote = async function (id, text, showFeedback = true) {
    if (!isAdmin) return;
    try {
        const vehicle = await store.getVehicleById(id);
        if (vehicle) {
            vehicle.todo_notes = upper(text);
            await store.updateVehicle(vehicle);
            await renderDashboard(true); // Force refresh
            if (showFeedback) {
                alert("Note 'Da Fare' aggiornate con successo!");
                document.getElementById('vehicle-modal').classList.add('hidden');
            }
        }
    } catch (error) {
        console.error("Errore salvataggio note da fare:", error);
        if (showFeedback) alert("Errore durante il salvataggio.");
    }
}

// --- CSV Export Utility ---
window.exportCurrentTableToCSV = async function () {
    const type = window.lastDataManagerTab || 'vehicles';
    console.log(`Exporting ${type} to CSV...`);

    try {
        let data = [];

        const tableNames = {
            'vehicles': 'Mezzi',
            'locations': 'Luoghi',
            'interventions': 'Interventi',
            'cambiomezzo': 'Cambi_Mezzi',
            'contacts': 'Rubrica',
            'controlli': 'Controlli_Mensili',
            'riparazioni': 'Riparazioni_Word',
            'report_officina': 'Report_Permanenza_Officina'
        };
        const friendlyName = tableNames[type] || type;
        const now = new Date();
        const dd = String(now.getDate()).padStart(2, '0');
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        const yyyy = now.getFullYear();
        const dateStr = `${dd}-${mm}-${yyyy}`;
        let filename = `${friendlyName}_${dateStr}.csv`;

        // Fetch fresh data for export
        if (type === 'vehicles') data = await store.getVehicles();
        else if (type === 'locations') data = await store.getLocations();
        else if (type === 'interventions') data = await store.getInterventions();
        else if (type === 'cambiomezzo') data = await store.getCambiMezzi();
        else if (type === 'contacts') data = await store.getContacts();
        else if (type === 'controlli') {
            const vehicles = await store.getVehicles();
            data = [];
            vehicles.forEach(v => {
                if (v.monthly_checks && Array.isArray(v.monthly_checks)) {
                    v.monthly_checks.forEach(check => {
                        data.push({
                            vehicle_id: v.id,
                            sigla: v.sigla || '-',
                            plate: v.plate || '-',
                            model: v.model || '-',
                            date: check.date,
                            executor: check.executor || '',
                            location: check.location || '',
                            notes: check.notes
                        });
                    });
                }
            });
            data.sort((a, b) => new Date(b.date) - new Date(a.date));
        } else if (type === 'riparazioni') {
            const vehicles = await store.getVehicles();
            data = [];
            vehicles.forEach(v => {
                if (v.repair_requests && Array.isArray(v.repair_requests)) {
                    v.repair_requests.forEach(req => {
                        data.push({
                            vehicle_id: v.id,
                            sigla: v.sigla || '-',
                            plate: v.plate || '-',
                            model: v.model || '-',
                            date: req.date || '',
                            types: (req.types || []).join(', '),
                            description: req.description || '',
                            driver: req.driver || '',
                            dept: req.dept || '',
                            phone: req.phone || '',
                            station: req.station || '',
                            email: req.email || ''
                        });
                    });
                }
            });
            data.sort((a, b) => {
                const parseD = (s) => {
                    if (!s) return 0;
                    const parts = s.split('/');
                    if (parts.length === 3) return new Date(`${parts[2]}-${parts[1]}-${parts[0]}`).getTime();
                    return new Date(s).getTime() || 0;
                };
                return parseD(b.date) - parseD(a.date);
            });
        } else if (type === 'report_officina') {
            const vehicles = await store.getVehicles();
            const interventions = await store.getInterventions();
            const locations = await store.getLocations();
            const locMap = new Map();
            locations.forEach(loc => {
                if (loc.luogo) locMap.set(loc.luogo.trim().toUpperCase(), loc);
            });

            data = [];

            const vMap = new Map();
            vehicles.forEach(v => {
                vMap.set(v.id, {
                    id: v.id,
                    sigla: v.sigla || '-',
                    plate: v.plate || '-',
                    model: v.model || '-',
                    station: v.station || '-',
                    status: v.status || 'unknown',
                    mileage: v.mileage || 0,
                    mileage_month: v.mileage_month || '',
                    interventions: []
                });
            });

            interventions.forEach(i => {
                let v = null;
                if (i.vehicle_id && vMap.has(i.vehicle_id)) {
                    v = vMap.get(i.vehicle_id);
                } else if (i.sigla) {
                    for (const item of vMap.values()) {
                        if (item.sigla === i.sigla) {
                            v = item;
                            break;
                        }
                    }
                }
                if (v) {
                    v.interventions.push(i);
                }
            });

            const selectedYear = window.currentWorkshopReportYear || 'all';

            for (const v of vMap.values()) {
                let filtered = v.interventions;
                if (selectedYear !== 'all') {
                    const yr = parseInt(selectedYear, 10);
                    filtered = filtered.filter(item => {
                        const dIn = window.parseInterventionDate(item.date);
                        const dOut = window.parseInterventionDate(item.date_out);
                        const itemYear = dIn ? dIn.getFullYear() : (dOut ? dOut.getFullYear() : null);
                        return itemYear === yr;
                    });
                }

                if (filtered.length === 0 && v.status !== 'maintenance') continue;

                let totalDays = 0;
                let lastDateIn = '';
                let lastDateOut = '';
                let lastWorkshop = '';
                let hasOngoing = (v.status === 'maintenance');

                filtered.sort((a, b) => {
                    const dA = window.parseInterventionDate(a.date);
                    const dB = window.parseInterventionDate(b.date);
                    return (dB ? dB.getTime() : 0) - (dA ? dA.getTime() : 0);
                });

                filtered.forEach((item, idx) => {
                    const stay = window.calculateStayDays(item.date, item.date_out);
                    totalDays += stay.days;
                    if (stay.isOngoing) hasOngoing = true;
                    if (idx === 0) {
                        lastWorkshop = item.workshop || '';
                    }
                });

                const count = filtered.length;
                const statusLabel = hasOngoing 
                    ? `In Officina${lastWorkshop ? ' (' + lastWorkshop + ')' : ''}` 
                    : (v.status === 'available' ? 'Disponibile' : 'Operativa');

                let maxKm = parseInt(v.mileage) || 0;
                filtered.forEach(item => {
                    if (item.km && parseInt(item.km) > maxKm) maxKm = parseInt(item.km);
                });

                const loc = locMap.get((v.station || '').trim().toUpperCase());
                const stationMonthlyKm = (loc && loc.monthly_km) ? Number(loc.monthly_km) : 0;
                const est = window.calculateDecemberKmEstimate(maxKm || v.mileage, v.mileage_month, stationMonthlyKm);

                data.push({
                    sigla: v.sigla,
                    plate: v.plate,
                    model: v.model,
                    station: v.station,
                    status: statusLabel,
                    total_days: totalDays,
                    count: count,
                    mileage: maxKm > 0 ? `${maxKm.toLocaleString('it-IT')} km` : '-',
                    mileage_month: v.mileage_month || '-',
                    station_monthly_km: stationMonthlyKm > 0 ? `${stationMonthlyKm.toLocaleString('it-IT')} km` : '-',
                    estimated_december_km: est.estimatedKm > 0 ? `${est.estimatedKm.toLocaleString('it-IT')} km` : '-'
                });
            }

            data.sort((a, b) => b.total_days - a.total_days);
        }

        if (!data || data.length === 0) {
            alert("Nessun dato da esportare.");
            return;
        }

        let headers = [];
        let csvRows = [];

        // Mapping for headers
        if (type === 'vehicles') {
            headers = ['id', 'plate', 'model', 'sigla', 'station', 'status', 'mileage', 'mileage_month', 'notes', 'db_notes', 'radio_id', 'inspection_expiry', 'revision_o2'];
            const italianHeaders = ['ID (Non modificare)', 'Targa', 'Modello', 'Sigla', 'Stazione', 'Stato', 'Km', 'Mese Km', 'Note', 'Note Interne', 'Radio ID', 'Scadenza Revisione', 'Revisione O2'];
            csvRows.push(italianHeaders.join(';'));
        } else if (type === 'locations') {
            headers = ['luogo', 'monthly_km', 'colore'];
            const italianHeaders = ['Luogo', 'Km Mensili', 'Colore'];
            csvRows.push(italianHeaders.join(';'));
        } else if (type === 'interventions') {
            headers = ['id', 'date', 'date_out', 'sigla', 'workshop', 'description', 'cost'];
            const italianHeaders = ['ID (Non modificare)', 'Data Entrata', 'Data Uscita', 'Mezzo (Sigla)', 'Officina', 'Descrizione Intervento', 'Costo'];
            csvRows.push(italianHeaders.join(';'));
        } else if (type === 'cambiomezzo') {
            headers = ['id', 'data', 'turno', 'luogo', 'equipaggio', 'dal_mezzo', 'al_mezzo'];
            const italianHeaders = ['ID (Non modificare)', 'Data', 'Turno', 'Luogo', 'Equipaggio', 'Dal Mezzo', 'Al Mezzo'];
            csvRows.push(italianHeaders.join(';'));
        } else if (type === 'contacts') {
            headers = ['id', 'category', 'name', 'urban', 'mobile', 'mobile2', 'mobile_medical'];
            const italianHeaders = ['ID (Non modificare)', 'Categoria', 'Nome/Sigla', 'Fisso', 'Cellulare 1', 'Cellulare 2', 'Cell. Medico'];
            csvRows.push(italianHeaders.join(';'));
        } else if (type === 'controlli') {
            headers = ['vehicle_id', 'sigla', 'plate', 'model', 'date', 'executor', 'location', 'notes'];
            const italianHeaders = ['ID Veicolo', 'Sigla', 'Targa', 'Modello', 'Data Controllo', 'Esecutore', 'Posizione', 'Note'];
            csvRows.push(italianHeaders.join(';'));
        } else if (type === 'riparazioni') {
            headers = ['sigla', 'plate', 'model', 'date', 'types', 'description', 'driver', 'dept', 'phone', 'station', 'email'];
            const italianHeaders = ['Sigla', 'Targa', 'Modello', 'Data Richiesta', 'Tipologia', 'Descrizione', 'Driver / Richiedente', 'Dipartimento', 'Telefono', 'Ubicazione', 'Email'];
            csvRows.push(italianHeaders.join(';'));
        } else if (type === 'report_officina') {
            headers = ['sigla', 'plate', 'model', 'station', 'mileage', 'mileage_month', 'station_monthly_km', 'estimated_december_km', 'total_days', 'count'];
            const italianHeaders = ['Mezzo (Sigla)', 'Targa', 'Modello', 'Sede', 'Ultimi Km Rilevati', 'Mese Riferimento Km', 'Km Mensili Sede', 'Stima Km Fine Dicembre', 'Totale Giorni in Officina', 'Numero Ricoveri'];
            csvRows.push(italianHeaders.join(';'));
        } else {
            headers = Object.keys(data[0]);
            csvRows.push(headers.join(';'));
        }

        // Add data rows
        for (const row of data) {
            const values = headers.map(header => {
                let val = row[header];
                if (val === null || val === undefined) return '';
                if (header.includes('date') || header === 'data' || header === 'inspection_expiry' || header === 'revision_o2') {
                    val = formatDate(val);
                }
                // Escape semicolons and handle strings
                let escaped = ('' + val).replace(/;/g, ',').replace(/\n/g, ' ');
                return `"${escaped}"`;
            });
            csvRows.push(values.join(';'));
        }

        // Prepend UTF-8 BOM for Excel compatibility (mandatory for Italian characters)
        const BOM = '\uFEFF';
        const csvString = BOM + csvRows.join('\n');

        const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement("a");

        if (navigator.msSaveBlob) { // IE 10+
            navigator.msSaveBlob(blob, filename);
        } else {
            const url = URL.createObjectURL(blob);
            link.setAttribute("href", url);
            link.setAttribute("download", filename);
            link.style.visibility = 'hidden';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }
    } catch (err) {
        console.error("Export error:", err);
        alert("Errore durante l'esportazione dei dati.");
    }
}

// Alias per compatibilità con eventuali richiami da pulsanti Excel
window.exportCurrentTableToExcel = function (type) {
    if (type) window.lastDataManagerTab = type;
    exportCurrentTableToCSV();
};

// Esportazione granulare riga per riga di tutti i singoli ricoveri in officina
window.exportDetailedWorkshopReportToCSV = async function () {
    try {
        const vehicles = await store.getVehicles();
        const interventions = await store.getInterventions();

        const vMap = new Map();
        vehicles.forEach(v => {
            vMap.set(v.id, v);
        });

        const rows = [];
        const selectedYear = window.currentWorkshopReportYear || 'all';

        interventions.forEach(i => {
            const v = (i.vehicle_id && vMap.get(i.vehicle_id)) || null;
            const sigla = v ? (v.sigla || '-') : (i.sigla || '-');
            const plate = v ? (v.plate || '-') : '-';
            const model = v ? (v.model || '-') : '-';
            const station = v ? (v.station || '-') : '-';

            const dIn = window.parseInterventionDate(i.date);
            const dOut = window.parseInterventionDate(i.date_out);
            const itemYear = dIn ? dIn.getFullYear() : (dOut ? dOut.getFullYear() : null);

            if (selectedYear !== 'all') {
                const yr = parseInt(selectedYear, 10);
                if (itemYear !== yr) return;
            }

            const stay = window.calculateStayDays(i.date, i.date_out);
            const statusStr = stay.isOngoing ? 'In corso (ricoverata)' : 'Concluso';

            rows.push({
                sigla,
                plate,
                model,
                station,
                date: i.date || '',
                date_out: i.date_out || '',
                days: stay.days,
                status: statusStr,
                workshop: i.workshop || '-',
                km: i.km || '',
                description: (i.description || '').replace(/\n/g, ' ')
            });
        });

        if (rows.length === 0) {
            alert("Nessun ricovero in officina da esportare per i filtri selezionati.");
            return;
        }

        rows.sort((a, b) => {
            const dA = window.parseInterventionDate(a.date);
            const dB = window.parseInterventionDate(b.date);
            return (dB ? dB.getTime() : 0) - (dA ? dA.getTime() : 0);
        });

        const headers = ['sigla', 'plate', 'model', 'station', 'date', 'date_out', 'days', 'status', 'workshop', 'km', 'description'];
        const italianHeaders = ['Mezzo (Sigla)', 'Targa', 'Modello', 'Sede', 'Data Entrata', 'Data Uscita', 'Giorni Sosta', 'Stato Ricovero', 'Officina', 'Km Ingresso', 'Descrizione / Causale'];

        const csvRows = [italianHeaders.join(';')];
        for (const row of rows) {
            const values = headers.map(h => {
                let val = row[h];
                if (val === null || val === undefined) return '';
                if (h === 'date' || h === 'date_out') val = formatDate(val);
                let escaped = ('' + val).replace(/;/g, ',').replace(/\n/g, ' ');
                return `"${escaped}"`;
            });
            csvRows.push(values.join(';'));
        }

        const BOM = '\uFEFF';
        const csvString = BOM + csvRows.join('\n');
        const now = new Date();
        const dateStr = `${String(now.getDate()).padStart(2, '0')}-${String(now.getMonth() + 1).padStart(2, '0')}-${now.getFullYear()}`;
        const yearSuffix = selectedYear !== 'all' ? `_${selectedYear}` : '';
        const filename = `Dettaglio_Ricoveri_Officina${yearSuffix}_${dateStr}.csv`;

        const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement("a");
        if (navigator.msSaveBlob) {
            navigator.msSaveBlob(blob, filename);
        } else {
            const url = URL.createObjectURL(blob);
            link.setAttribute("href", url);
            link.setAttribute("download", filename);
            link.style.visibility = 'hidden';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }
    } catch (e) {
        console.error("Export detailed workshop error:", e);
        alert("Errore durante l'esportazione del dettaglio officina.");
    }
};

window.importDataTableFromCSV = function () {
    const type = window.lastDataManagerTab || 'vehicles';
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv';

    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        // Check file extension
        if (!file.name.toLowerCase().endsWith('.csv')) {
            alert("Errore: Il sistema accetta solo file in formato .csv (delimitatore punto e virgola). Se hai un file Excel (.xlsx), esportalo prima come CSV.");
            return;
        }

        const reader = new FileReader();
        reader.onload = async (event) => {
            try {
                let content = event.target.result;
                // Remove BOM if present
                if (content.startsWith('\uFEFF')) content = content.substring(1);

                const rows = content.split('\n').filter(row => row.trim() !== '');
                if (rows.length < 1) {
                    alert("Il file CSV è vuoto o non contiene dati validi.");
                    return;
                }

                const delimiter = rows[0].includes(';') ? ';' : ',';
                const rawHeaders = rows[0].split(delimiter).map(h => h.replace(/"/g, '').trim());
                const dataRows = rows.slice(1);

                // Header mapping (maps both Italian labels and Raw DB names)
                const headerMap = {
                    'vehicles': {
                        'ID (Non modificare)': 'id', 'id': 'id',
                        'Targa': 'plate', 'plate': 'plate',
                        'Modello': 'model', 'model': 'model',
                        'Sigla': 'sigla', 'sigla': 'sigla',
                        'Stazione': 'station', 'station': 'station',
                        'Stato': 'status', 'status': 'status',
                        'Km': 'mileage', 'mileage': 'mileage',
                        'Mese Km': 'mileage_month', 'mileage_month': 'mileage_month',
                        'Note': 'notes', 'notes': 'notes',
                        'Radio ID': 'radio_id', 'radio_id': 'radio_id',
                        'Scadenza Revisione': 'inspection_expiry', 'inspection_expiry': 'inspection_expiry',
                        'Revisione O2': 'revision_o2', 'revision_o2': 'revision_o2'
                    },
                    'locations': {
                        'Luogo': 'name', 'luogo': 'name', 'name': 'name',
                        'Colore': 'colore', 'colore': 'colore',
                        'Km Mensili': 'monthly_km', 'km_mensili': 'monthly_km', 'monthly_km': 'monthly_km', 'Km': 'monthly_km', 'km': 'monthly_km'
                    },
                    'interventions': {
                        'ID (Non modificare)': 'id', 'id': 'id',
                        'Data Entrata': 'date', 'date': 'date',
                        'Data Uscita': 'date_out', 'date_out': 'date_out',
                        'Mezzo (Sigla)': 'sigla', 'sigla': 'sigla', 'vehicle_id': 'vehicle_id',
                        'Officina': 'workshop', 'workshop': 'workshop',
                        'Descrizione Intervento': 'description', 'description': 'description',
                        'Costo': 'cost', 'cost': 'cost'
                    },
                    'cambiomezzo': {
                        'ID (Non modificare)': 'id', 'id': 'id',
                        'Data': 'data', 'data': 'data',
                        'Turno': 'turno', 'turno': 'turno',
                        'Luogo': 'luogo', 'luogo': 'luogo',
                        'Equipaggio': 'equipaggio', 'equipaggio': 'equipaggio',
                        'Dal Mezzo': 'dal_mezzo', 'dal_mezzo': 'dal_mezzo',
                        'Al Mezzo': 'al_mezzo', 'al_mezzo': 'al_mezzo'
                    },
                    'contacts': {
                        'ID (Non modificare)': 'id', 'id': 'id',
                        'Categoria': 'category', 'category': 'category',
                        'Nome/Sigla': 'name', 'name': 'name',
                        'Fisso': 'urban', 'urban': 'urban',
                        'Cellulare 1': 'mobile', 'mobile': 'mobile',
                        'Cellulare 2': 'mobile2', 'mobile2': 'mobile2',
                        'Cell. Medico': 'mobile_medical', 'mobile_medical': 'mobile_medical'
                    }
                };

                const currentMap = headerMap[type];
                const dbRows = [];

                for (const row of dataRows) {
                    const values = row.split(delimiter).map(v => v.replace(/"/g, '').trim());
                    const obj = {};
                    rawHeaders.forEach((label, idx) => {
                        const dbField = currentMap[label];
                        if (dbField) {
                            let val = values[idx];
                            // Basic type conversion
                            if (dbField === 'mileage' || dbField === 'cost' || dbField === 'monthly_km') val = parseFloat(val) || 0;

                            // Date conversion (handle both ISO and Italian format)
                            if (['date', 'date_out', 'data', 'inspection_expiry', 'revision_o2'].includes(dbField) && val) {
                                if (val.includes('/')) { // Italian DD/MM/YYYY
                                    const parts = val.split('/');
                                    if (parts.length === 3) val = `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
                                }
                            }

                            // Don't set empty strings for ID
                            if (dbField === 'id' && !val) return;

                            obj[dbField] = val || null;
                        }
                    });

                    // For interventions, we might have vehicle_id directly (Supabase) or need to map sigla -> vehicle_id
                    if (type === 'interventions' && obj.sigla && !obj.vehicle_id) {
                        const vehicles = await store.getVehicles();
                        const v = vehicles.find(m => m.sigla === obj.sigla);
                        if (v) obj.vehicle_id = v.id;
                    }
                    if (obj.sigla) delete obj.sigla;

                    // For locations, Supabase 'locations' table uses 'name' as PK, mapped to 'luogo' in UI
                    if (type === 'locations' && obj.luogo) {
                        obj.name = obj.luogo;
                        delete obj.luogo;
                    }

                    if (Object.keys(obj).length > 0) dbRows.push(obj);
                }

                if (dbRows.length > 0) {
                    const tableMap = { 'vehicles': 'vehicles', 'locations': 'locations', 'interventions': 'interventions', 'cambiomezzo': 'cambiomezzo', 'contacts': 'contacts' };

                    // Deduplicate rows to avoid "ON CONFLICT DO UPDATE command cannot affect row a second time"
                    // Unique key is 'name' for locations, 'id' for orthers
                    const uniqueKey = type === 'locations' ? 'name' : 'id';
                    if (uniqueKey) {
                        const uniqueMap = new Map();
                        dbRows.forEach(row => {
                            if (row[uniqueKey]) {
                                uniqueMap.set(row[uniqueKey], row);
                            }
                        });
                        // Also need to handle rows without ID (new ones) - they should stay
                        const existingRows = Array.from(uniqueMap.values());
                        const newRows = dbRows.filter(r => !r[uniqueKey]);
                        const finalRows = [...existingRows, ...newRows];

                        await store.upsertData(tableMap[type], finalRows);
                        alert(`Importazione completata: ${finalRows.length} record elaborati.`);
                    } else {
                        await store.upsertData(tableMap[type], dbRows);
                        alert(`Importazione completata: ${dbRows.length} record elaborati.`);
                    }
                    switchDataTable(type);
                } else {
                    alert("Nessun dato valido trovato nel file.");
                }

            } catch (err) {
                console.error("Import error:", err);
                alert("Errore durante l'importazione: " + err.message);
            }
        };
        reader.readAsText(file, 'utf-8');
    };

    input.click();
}

// --- Data Management System ---

window.openDataManagement = function () {
    const modal = document.getElementById('data-management-modal');
    modal.classList.remove('hidden');
    switchDataTable(window.lastDataManagerTab || 'vehicles');
}

window.editInterventionHandler = async function (id) {
    const interventions = await store.getInterventions();
    const intervention = interventions.find(i => i.id === id);
    if (intervention) {
        // Need to find vehicle sigla. For simplicity, we can fetch it or pass it.
        // Let's fetch the vehicle to get the sigla.
        const vehicle = await store.getVehicleById(intervention.vehicle_id);
        openMaintenanceForm(intervention.vehicle_id, vehicle ? vehicle.sigla : 'N/A', intervention);
    }
}

window.switchDataTable = async function (type) {
    window.lastDataManagerTab = type; // Track for refresh logic
    // Update tabs
    const buttons = document.querySelectorAll('.filter-btn'); // Reuse existing class for styling
    buttons.forEach(btn => {
        if (btn.onclick && btn.onclick.toString().includes(type)) btn.classList.add('active');
        else if (btn.parentElement && btn.parentElement.classList.contains('modal-tabs-mgmt')) btn.classList.remove('active');
    });

    const container = document.getElementById('data-table-container');
    container.innerHTML = '<p style="text-align:center;">Caricamento...</p>';

    let data = [];
    let html = '';

    try {
        if (type === 'vehicles') {
            data = await store.getVehicles();
            sortVehiclesBySigla(data);
            html = `
                <div style="margin-bottom: 1.5rem; background: #f8fafc; padding: 1rem; border-radius: 0.75rem; border: 1px solid var(--border-color); display: flex; justify-content: space-between; align-items: center; gap: 1rem;">
                    <h4 style="font-size: 0.9rem;">Elenco Mezzi</h4>
                    ${isAdmin ? `
                    <div style="display: flex; gap: 0.5rem; align-items: center;">
                        <button class="btn btn-export" onclick="exportCurrentTableToCSV()" style="white-space: nowrap;">
                            <i class="fa-solid fa-file-excel"></i> Esporta Excel
                        </button>
                        <button class="btn btn-export" onclick="importDataTableFromCSV()" style="white-space: nowrap; background-color: #065f46;">
                            <i class="fa-solid fa-file-import"></i> Importa Excel
                        </button>
                        <button class="btn btn-primary" onclick="openVehicleForm();" style="padding: 0.5rem 1rem;"><i class="fa-solid fa-plus"></i> Nuovo Mezzo</button>
                    </div>
                    ` : ''}
                </div>
                <div style="overflow-x: auto;">
                    <table class="mgmt-table">
                        <thead>
                            <tr>
                                <th class="col-shrink">Targa</th>
                                <th>Modello</th>
                                <th class="col-shrink">Sigla</th>
                                <th class="col-shrink">Stazione</th>
                                <th class="col-shrink">Stato</th>
                                <th class="col-shrink">Km</th>
                                <th class="col-shrink">Mese Km</th>
                                <th class="col-expand">Note</th>
                                <th class="col-shrink">Radio</th>
                                <th class="col-shrink">Rev. Scad.</th>
                                <th class="col-shrink">Rev. O2</th>
                                ${isAdmin ? '<th class="col-actions">Azioni</th>' : ''}
                            </tr>
                        </thead>
                        <tbody>
                            ${data.map(v =>
                '<tr>'
                + `<td class="col-shrink">${v.plate}</td>`
                + `<td>${v.model}</td>`
                + `<td class="col-shrink text-bold text-primary">${v.sigla || '-'}</td>`
                + `<td class="col-shrink">${v.station}</td>`
                + `<td class="col-shrink">${v.status}</td>`
                + `<td class="col-shrink">${v.mileage}</td>`
                + `<td class="col-shrink">${v.mileage_month || '-'}</td>`
                + `<td class="col-expand">${v.notes || '-'}</td>`
                + `<td class="col-shrink">${v.radio_id || '-'}</td>`
                + `<td class="col-shrink">${formatDate(v.inspection_expiry)}</td>`
                + `<td class="col-shrink">${formatDate(v.revision_o2)}</td>`
                + (isAdmin ? '<td class="col-actions">'
                    + `<button onclick="openVehicleForm('${v.id}');" style="margin-right:0.5rem; cursor:pointer; background:none; border:none; color:var(--primary-color);"><i class="fa-solid fa-pen"></i></button>`
                    + `<button onclick="deleteVehicleHandler('${v.id}')" style="cursor:pointer; background:none; border:none; color:var(--status-to-repair);"><i class="fa-solid fa-trash"></i></button>`
                    + '</td>' : '') + '</tr>'
            ).join('')}
                        </tbody>
                    </table>
                </div>`;
        } else if (type === 'locations') {
            data = await store.getLocations();
            html = `
                <div style="margin-bottom: 1.5rem; background: #f8fafc; padding: 1rem; border-radius: 0.75rem; border: 1px solid var(--border-color); display: flex; justify-content: space-between; align-items: center; gap: 1rem; flex-wrap: wrap;">
                    <div>
                        <h4 style="font-size: 0.95rem; font-weight: 700; color: #0f172a; margin: 0 0 0.25rem 0;">Elenco Luoghi / Sedi Flotta</h4>
                        <span style="font-size: 0.8rem; color: #64748b;">Gestisci le sedi operative e i chilometri mensili di riferimento stimati.</span>
                    </div>
                    ${isAdmin ? `
                    <div style="display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap;">
                        <button class="btn btn-export" onclick="exportCurrentTableToCSV()" style="white-space: nowrap;">
                            <i class="fa-solid fa-file-excel"></i> Esporta Excel
                        </button>
                        <button class="btn btn-export" onclick="importDataTableFromCSV()" style="white-space: nowrap; background-color: #065f46;">
                            <i class="fa-solid fa-file-import"></i> Importa Excel
                        </button>
                        <button class="btn btn-primary" onclick="window.addLocationHandler();" style="padding: 0.5rem 1rem; background: #0284c7; border-color: #0284c7; display: flex; align-items: center; gap: 0.4rem;">
                            <i class="fa-solid fa-plus"></i> Nuovo Luogo
                        </button>
                    </div>
                    ` : ''}
                </div>
                <div style="overflow-x: auto;">
                    <table class="mgmt-table">
                        <thead>
                            <tr>
                                <th>Luogo / Sede</th>
                                <th style="text-align: right; width: 220px;">Km Mensili Sede</th>
                                ${isAdmin ? '<th class="col-actions" style="text-align: center; width: 120px;">Azioni</th>' : ''}
                            </tr>
                        </thead>
                        <tbody>
                            ${data.map(l => {
                                const hasKm = l.monthly_km !== undefined && l.monthly_km !== null && l.monthly_km !== 0 && !isNaN(l.monthly_km);
                                const kmFormatted = hasKm 
                                    ? `<span style="display: inline-flex; align-items: center; gap: 0.35rem; font-weight: 700; color: #0284c7; background: #e0f2fe; padding: 0.25rem 0.65rem; border-radius: 9999px; font-size: 0.85rem;"><i class="fa-solid fa-gauge-high" style="font-size: 0.75rem;"></i> ${Number(l.monthly_km).toLocaleString('it-IT')} km</span>`
                                    : `<span style="color: #94a3b8; font-style: italic; font-size: 0.82rem;">Non impostato</span>`;
                                const encodedName = encodeURIComponent(l.luogo || '');
                                const kmNum = Number(l.monthly_km) || 0;
                                return `<tr>
                                    <td style="font-weight: 700; color: #0f172a;">
                                        <i class="fa-solid fa-location-dot" style="color: #0284c7; margin-right: 0.5rem;"></i>
                                        ${l.luogo}
                                    </td>
                                    <td style="text-align: right;">${kmFormatted}</td>
                                    ${isAdmin ? `<td class="col-actions" style="text-align: center;">
                                        <button onclick="window.editLocationHandler('${encodedName}', ${kmNum})" title="Modifica Luogo e Km" style="margin-right:0.6rem; cursor:pointer; background:none; border:none; color:var(--primary-color); font-size: 1.05rem;"><i class="fa-solid fa-pen-to-square"></i></button>
                                        <button onclick="setTimeout(() => { if(confirm('Eliminare il luogo ${l.luogo}?')){store.deleteLocation('${l.luogo}').then(() => switchDataTable('locations'))} }, 50)" title="Elimina Luogo" style="cursor:pointer; background:none; border:none; color:var(--status-to-repair); font-size: 1.05rem;"><i class="fa-solid fa-trash"></i></button>
                                    </td>` : ''}
                                </tr>`;
                            }).join('')}
                        </tbody>
                    </table>
                </div>`;
        } else if (type === 'interventions') {
            data = await store.getInterventions();
            html = `
                <div style="margin-bottom: 1rem; background: #f8fafc; padding: 1rem; border-radius: 0.75rem; border: 1px solid var(--border-color); display: flex; gap: 1rem; align-items: center; justify-content: space-between; flex-wrap: wrap;">
                    <div style="flex-grow: 1; position: relative; min-width: 220px;">
                        <i class="fa-solid fa-search" style="position: absolute; left: 1rem; top: 50%; transform: translateY(-50%); color: var(--text-secondary);"></i>
                        <input type="text" id="intervention-search" placeholder="Filtra per Mezzo (Sigla)..." 
                               oninput="window.filterInterventionTable(this.value)"
                               style="width: 100%; padding: 0.5rem 1rem 0.5rem 2.5rem; border-radius: 0.5rem; border: 1px solid var(--border-color); outline: none;">
                    </div>
                    <div style="display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap;">
                        <button class="btn btn-export" onclick="switchDataTable('report_officina')" style="white-space: nowrap; background: linear-gradient(135deg, #7c3aed, #6d28d9); color: white; display: flex; align-items: center; gap: 0.4rem;">
                            <i class="fa-solid fa-clock-rotate-left"></i> Report Tempi Officina
                        </button>
                        ${isAdmin ? `
                        <button class="btn btn-export" onclick="exportCurrentTableToCSV()" style="white-space: nowrap;">
                            <i class="fa-solid fa-file-excel"></i> Esporta Excel
                        </button>
                        <button class="btn btn-export" onclick="importDataTableFromCSV()" style="white-space: nowrap; background-color: #065f46;">
                            <i class="fa-solid fa-file-import"></i> Importa Excel
                        </button>
                        ` : ''}
                    </div>
                </div>
                <div style="overflow-x: auto;">
                    <table class="mgmt-table" id="interventions-table">
                        <thead>
                            <tr>
                                <th class="col-shrink">Data Entrata</th>
                                <th class="col-shrink">Data Uscita</th>
                                <th class="col-shrink">Mezzo</th>
                                <th class="col-shrink">Officina</th>
                                <th class="col-shrink">KM</th>
                                <th class="col-expand">Descrizione</th>
                                ${isAdmin ? '<th class="col-actions">Azioni</th>' : ''}
                            </tr>
                        </thead>
                        <tbody>
                            ${data.map(i =>
                '<tr>'
                + `<td class="col-shrink">${formatDate(i.date)}</td>`
                + `<td class="col-shrink">${formatDate(i.date_out)}</td>`
                + `<td class="col-shrink text-bold text-primary">${i.sigla || 'N/A'}</td>`
                + `<td class="col-shrink">${i.workshop || '-'}</td>`
                + `<td class="col-shrink" style="font-weight:600; color:var(--primary-color);">${i.km ? parseInt(i.km).toLocaleString() + ' km' : '-'}</td>`
                + `<td class="col-expand">${i.description}</td>`
                + (isAdmin ? '<td class="col-actions">'
                    + `<button onclick="editInterventionHandler('${i.id}')" style="margin-right:0.5rem; cursor:pointer; background:none; border:none; color:var(--primary-color);"><i class="fa-solid fa-pen"></i></button>`
                    + `<button onclick="setTimeout(() => { if(confirm('Eliminare questo intervento?')){store.deleteIntervention('${i.id}').then(() => switchDataTable('interventions'))} }, 50)" style="cursor:pointer; background:none; border:none; color:var(--status-to-repair);"><i class="fa-solid fa-trash"></i></button>`
                    + '</td>' : '') + '</tr>'
            ).join('')}
                        </tbody>
                    </table>
                </div>`;
        } else if (type === 'cambiomezzo') {
            data = await store.getCambiMezzi();
            html = `
                <div style="margin-bottom: 1rem; background: #f8fafc; padding: 1rem; border-radius: 0.75rem; border: 1px solid var(--border-color); display: flex; justify-content: space-between; align-items: center; gap: 1rem;">
                    <h4 style="font-size: 0.9rem;">Storico Cambi Mezzo</h4>
                    ${isAdmin ? `
                    <div style="display: flex; gap: 0.5rem; align-items: center;">
                        <button class="btn btn-export" onclick="exportCurrentTableToCSV()" style="white-space: nowrap;">
                            <i class="fa-solid fa-file-excel"></i> Esporta Excel
                        </button>
                        <button class="btn btn-export" onclick="importDataTableFromCSV()" style="white-space: nowrap; background-color: #065f46;">
                            <i class="fa-solid fa-file-import"></i> Importa Excel
                        </button>
                    </div>
                    ` : ''}
                </div>
                <div style="overflow-x: auto;">
                    <table class="mgmt-table">
                        <thead>
                            <tr>
                                <th class="col-shrink">Data</th>
                                <th class="col-shrink">Luogo</th>
                                <th class="col-shrink">Turno</th>
                                <th>Equipaggio</th>
                                <th class="col-shrink">Dal Mezzo</th>
                                <th class="col-shrink">Al Mezzo</th>
                                ${isAdmin ? '<th class="col-actions">Azioni</th>' : ''}
                            </tr>
                        </thead>
                        <tbody>
                            ${data.map(c =>
                '<tr>'
                + `<td class="col-shrink">${formatDate(c.data)}</td>`
                + `<td class="col-shrink">${c.luogo || '-'}</td>`
                + `<td class="col-shrink">${c.turno}</td>`
                + `<td>${c.equipaggio || '-'}</td>`
                + `<td class="col-shrink text-bold text-primary">${c.dal_mezzo}</td>`
                + `<td class="col-shrink text-bold" style="color:var(--status-available);">${c.al_mezzo}</td>`
                + (isAdmin ? '<td class="col-actions">'
                    + `<button onclick="openCambioMezzoModal('${c.id}')" style="cursor:pointer; background:none; border:none; color:var(--primary-color); margin-right: 0.5rem;"><i class="fa-solid fa-edit"></i></button>`
                    + `<button onclick="setTimeout(() => { if(confirm('Eliminare questo cambio?')){store.deleteCambioMezzo('${c.id}').then(() => switchDataTable('cambiomezzo'))} }, 50)" style="cursor:pointer; background:none; border:none; color:var(--status-to-repair);"><i class="fa-solid fa-trash"></i></button>`
                    + '</td>' : '') + '</tr>'
            ).join('')}
                        </tbody>
                    </table>
                </div>`;
        } else if (type === 'contacts') {
            data = await store.getContacts();
            const catLabel = { sedi: 'Sedi Mezzi', officine: 'Officine', utili: 'Utili' };
            html = `
                <div style="margin-bottom: 1.5rem; background: #f8fafc; padding: 1rem; border-radius: 0.75rem; border: 1px solid var(--border-color); display: flex; justify-content: space-between; align-items: center; gap: 1rem;">
                    <h4 style="font-size: 0.9rem;">Elenco Contatti (${data.length})</h4>
                    ${isAdmin ? `
                    <div style="display: flex; gap: 0.5rem; align-items: center;">
                        <button class="btn btn-export" onclick="exportCurrentTableToCSV()" style="white-space: nowrap;">
                            <i class="fa-solid fa-file-excel"></i> Esporta Excel
                        </button>
                        <button class="btn btn-export" onclick="importDataTableFromCSV()" style="white-space: nowrap; background-color: #065f46;">
                            <i class="fa-solid fa-file-import"></i> Importa Excel
                        </button>
                        <button class="btn btn-primary" onclick="openContactForm()" style="padding: 0.5rem 1rem;"><i class="fa-solid fa-plus"></i> Nuovo</button>
                    </div>
                    ` : ''}
                </div>
                <div style="overflow-x: auto;">
                    <table class="mgmt-table" style="table-layout: auto; width: 100%;">
                        <thead>
                            <tr>
                                <th class="col-shrink">CATEGORIA</th>
                                <th>NOME / SIGLA</th>
                                <th class="col-shrink">FISSO</th>
                                <th class="col-shrink">CELLULARE 1</th>
                                <th class="col-shrink">CELLULARE 2</th>
                                <th class="col-shrink">CELL. MEDICO</th>
                                ${isAdmin ? '<th class="col-actions">AZIONI</th>' : ''}
                            </tr>
                        </thead>
                        <tbody>
                            ${data.map(c => {
                const bg = c.category === 'sedi' ? '#dbeafe' : c.category === 'officine' ? '#fef3c7' : '#f0fdf4';
                const fg = c.category === 'sedi' ? '#1e40af' : c.category === 'officine' ? '#92400e' : '#166534';
                const pCell = (num, lbl) => {
                    if (!num) return '<span style="color:#cbd5e1">-</span>';
                    const tag = lbl ? `<span style="font-size:0.7rem;color:#64748b;display:block;">${lbl}</span>` : '';
                    if (!isAdmin) return tag + num;
                    const clean = num.replace(/[\\/\s+]/g, '');
                    return `${tag}<a href="tel:${clean}" class="tel-link" style="display:inline-block; padding:0.2rem 0.5rem; background:#ecfdf5; color:#059669; text-decoration:none; border-radius:0.3rem; font-weight:700; font-size:0.8rem;">${num}</a>`;
                };
                return '<tr>'
                    + `<td class="col-shrink"><span style="font-size:0.75rem;font-weight:700;padding:0.2rem 0.5rem;border-radius:0.3rem;background:${bg};color:${fg};">${catLabel[c.category] || c.category}</span></td>`
                    + `<td style="font-weight:600; white-space:nowrap;">${c.name}</td>`
                    + `<td class="col-shrink">${pCell(c.urban, c.urban_label)}</td>`
                    + `<td class="col-shrink">${pCell(c.mobile, c.mobile_label)}</td>`
                    + `<td class="col-shrink">${pCell(c.mobile2, c.mobile2_label)}</td>`
                    + `<td class="col-shrink">${c.mobile_medical ? (isAdmin ? `<a href="tel:${c.mobile_medical.replace(/[\\/\s+]/g, '')}" class="tel-link" style="display:inline-block; padding:0.2rem 0.5rem; background:#ecfdf5; color:#059669; text-decoration:none; border-radius:0.3rem; font-weight:700; font-size:0.8rem;">${c.mobile_medical}</a>` : c.mobile_medical) : '<span style="color:#cbd5e1">-</span>'}</td>`
                    + (isAdmin ? `<td class="col-actions">`
                        + `<button onclick="openContactForm('${c.id}')" style="cursor:pointer;background:none;border:none;color:var(--primary-color);margin-right:0.5rem;" title="Modifica"><i class="fa-solid fa-pen-to-square"></i></button>`
                        + `<button onclick="setTimeout(() => { if(confirm('Eliminare questo contatto?')){store.deleteContact('${c.id}').then(() => switchDataTable('contacts'))} }, 50)" style="cursor:pointer;background:none;border:none;color:var(--status-to-repair);" title="Elimina"><i class="fa-solid fa-trash"></i></button>`
                        + '</td>' : '') + '</tr>';
            }).join('')}
                        </tbody>
                    </table>
                </div>`;
        } else if (type === 'controlli') {
            const vehicles = await store.getVehicles();
            data = [];
            vehicles.forEach(v => {
                if (v.monthly_checks && Array.isArray(v.monthly_checks)) {
                    v.monthly_checks.forEach(check => {
                        data.push({
                            vehicle_id: v.id,
                            sigla: v.sigla || '-',
                            plate: v.plate || '-',
                            model: v.model || '-',
                            date: check.date,
                            notes: check.notes,
                            executor: check.executor || '',
                            location: check.location || ''
                        });
                    });
                }
            });
            data.sort((a, b) => new Date(b.date) - new Date(a.date));

            const getItalianMonthYearName = (dateStr) => {
                const [year, month] = dateStr.split('-');
                const months = {
                    '01': 'GENNAIO', '02': 'FEBBRAIO', '03': 'MARZO', '04': 'APRILE',
                    '05': 'MAGGIO', '06': 'GIUGNO', '07': 'LUGLIO', '08': 'AGOSTO',
                    '09': 'SETTEMBRE', '10': 'OTTOBRE', '11': 'NOVEMBRE', '12': 'DICEMBRE'
                };
                return `${months[month] || ''} ${year}`;
            };

            const groups = {};
            data.forEach(c => {
                if (c.date) {
                    const ym = c.date.substring(0, 7); // 'YYYY-MM'
                    if (!groups[ym]) groups[ym] = [];
                    groups[ym].push(c);
                }
            });
            const sortedYM = Object.keys(groups).sort((a, b) => b.localeCompare(a));

            html = `
                <div style="margin-bottom: 1.5rem; background: #f8fafc; padding: 1rem; border-radius: 0.75rem; border: 1px solid var(--border-color); display: flex; justify-content: space-between; align-items: center; gap: 1rem;">
                    <h4 style="font-size: 0.9rem;">Storico Controlli Mensili</h4>
                    ${isAdmin ? `
                    <div style="display: flex; gap: 0.5rem; align-items: center;">
                        <button class="btn btn-export" onclick="exportCurrentTableToCSV()" style="white-space: nowrap;">
                            <i class="fa-solid fa-file-excel"></i> Esporta Excel
                        </button>
                    </div>
                    ` : ''}
                </div>
                <div style="overflow-x: auto;">
                    <table class="mgmt-table">
                        <thead>
                            <tr>
                                <th class="col-shrink">Mezzo (Sigla)</th>
                                <th class="col-shrink">Targa</th>
                                <th class="col-shrink">Data Controllo</th>
                                <th class="col-shrink">Esecutore</th>
                                <th class="col-shrink">Posizione</th>
                                <th class="col-expand">Note</th>
                                ${isAdmin ? '<th class="col-actions">Azioni</th>' : ''}
                            </tr>
                        </thead>
                        <tbody>
                            ${sortedYM.map(ym => {
                                const groupHeader = `
                                    <tr style="background: #f1f5f9; font-weight: 800; color: #0f766e;">
                                        <td colspan="${isAdmin ? 7 : 6}" style="padding: 0.6rem 1rem;">
                                            <i class="fa-solid fa-calendar-days" style="margin-right: 6px;"></i> ${getItalianMonthYearName(ym)}
                                        </td>
                                    </tr>
                                `;
                                const groupRows = groups[ym].map(c => 
                                    '<tr>'
                                    + `<td class="col-shrink text-bold text-primary">${c.sigla}</td>`
                                    + `<td class="col-shrink">${c.plate}</td>`
                                    + `<td class="col-shrink">${formatDate(c.date)}</td>`
                                    + `<td class="col-shrink">${c.executor || '-'}</td>`
                                    + `<td class="col-shrink">${c.location || '-'}</td>`
                                    + `<td class="col-expand">${c.notes || '-'}</td>`
                                    + (isAdmin ? `<td class="col-actions">`
                                        + `<button onclick="openEditMonthlyCheckModal('${c.vehicle_id}', '${c.date}', \`${(c.notes || '').replace(/`/g, '\\`').replace(/\$/g, '\\$')}\`, \`${(c.executor || '').replace(/`/g, '\\`').replace(/\$/g, '\\$')}\`, \`${(c.location || '').replace(/`/g, '\\`').replace(/\$/g, '\\$')}\`)" style="cursor:pointer; background:none; border:none; color:var(--primary-color); margin-right:0.5rem;" title="Modifica"><i class="fa-solid fa-pen"></i></button>`
                                        + `<button onclick="deleteMonthlyCheckFromDb('${c.vehicle_id}', '${c.date}', \`${(c.notes || '').replace(/`/g, '\\`').replace(/\$/g, '\\$')}\`, \`${(c.executor || '').replace(/`/g, '\\`').replace(/\$/g, '\\$')}\`, \`${(c.location || '').replace(/`/g, '\\`').replace(/\$/g, '\\$')}\`)" style="cursor:pointer; background:none; border:none; color:var(--status-to-repair);" title="Elimina"><i class="fa-solid fa-trash"></i></button>`
                                        + '</td>' : '') + '</tr>'
                                ).join('');
                                return groupHeader + groupRows;
                            }).join('')}
                        </tbody>
                    </table>
                </div>`;
        } else if (type === 'riparazioni') {
            const vehicles = await store.getVehicles();
            data = [];
            vehicles.forEach(v => {
                if (v.repair_requests && Array.isArray(v.repair_requests)) {
                    v.repair_requests.forEach((req, idx) => {
                        data.push({
                            vehicle_id: v.id,
                            req_index: idx,
                            sigla: v.sigla || '-',
                            plate: v.plate || '-',
                            model: v.model || '-',
                            ...req
                        });
                    });
                }
            });
            data.sort((a, b) => {
                const parseD = (s) => {
                    if (!s) return 0;
                    const parts = s.split('/');
                    if (parts.length === 3) return new Date(`${parts[2]}-${parts[1]}-${parts[0]}`).getTime();
                    return new Date(s).getTime() || 0;
                };
                return parseD(b.date) - parseD(a.date);
            });

            html = `
                <div style="margin-bottom: 1.5rem; background: #eff6ff; padding: 1rem; border-radius: 0.75rem; border: 1px solid #bfdbfe; display: flex; justify-content: space-between; align-items: center; gap: 1rem;">
                    <div>
                        <h4 style="margin: 0; color: #1e3a8a; font-size: 1.1rem; display: flex; align-items: center; gap: 0.5rem;">
                            <i class="fa-solid fa-file-word" style="color: #2563eb;"></i> Storico Richieste di Riparazione Word (${data.length})
                        </h4>
                        <div style="font-size: 0.85rem; color: #475569; margin-top: 0.2rem;">Tutte le richieste di riparazione generate per i mezzi della flotta</div>
                    </div>
                    <button class="btn btn-export" onclick="exportCurrentTableToExcel('riparazioni')" style="background: #10b981; color: white; display: flex; align-items: center; gap: 0.5rem; white-space: nowrap;">
                        <i class="fa-solid fa-file-excel"></i> Esporta Excel
                    </button>
                </div>
                <div style="overflow-x: auto;">
                    <table class="mgmt-table">
                        <thead>
                            <tr>
                                <th class="col-shrink">Mezzo (Sigla)</th>
                                <th class="col-shrink">Targa</th>
                                <th class="col-shrink">Data</th>
                                <th class="col-shrink">Tipologia</th>
                                <th class="col-expand">Descrizione</th>
                                <th class="col-shrink">Richiedente</th>
                                <th class="col-actions">Azioni</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${data.length === 0 ? '<tr><td colspan="7" style="text-align:center; padding: 2rem; color: var(--text-secondary);">Nessuna richiesta di riparazione registrata.</td></tr>' : ''}
                            ${data.map(item => `
                                <tr>
                                    <td class="col-shrink text-bold text-primary">
                                        ${item.sigla}
                                        ${item.is_alea ? '<span style="background: #fef3c7; color: #92400e; font-size: 0.7rem; font-weight: 700; padding: 0.15rem 0.4rem; border-radius: 4px; margin-left: 0.35rem; vertical-align: middle;">Alea</span>' : ''}
                                    </td>
                                    <td class="col-shrink">${item.plate}</td>
                                    <td class="col-shrink" style="white-space: nowrap; font-weight: 600;">${item.date || '-'}</td>
                                    <td class="col-shrink">${(item.types && item.types.length > 0) ? item.types.map(t => `<span style="background: #dbeafe; color: #1e40af; font-size: 0.75rem; font-weight: 600; padding: 0.2rem 0.5rem; border-radius: 4px; display: inline-block; margin: 0.1rem;">${t}</span>`).join('') : '-'}</td>
                                    <td class="col-expand" style="font-size: 0.85rem; white-space: pre-wrap;">${item.description || '-'}</td>
                                    <td class="col-shrink" style="font-size: 0.85rem;"><strong>${item.driver || '-'}</strong><div style="font-size: 0.75rem; color: #64748b;">${[item.dept, item.phone].filter(Boolean).join(' • ')}</div></td>
                                    <td class="col-actions" style="white-space: nowrap;">
                                        <button onclick="downloadSavedRepairDocx('${item.vehicle_id}', '${item.id || ''}', ${item.req_index})" style="cursor:pointer; background:none; border:none; color:#2563eb; margin-right:0.5rem; font-size:1.1rem;" title="Scarica Word (.docx)"><i class="fa-solid fa-download"></i></button>
                                        ${isAdmin ? `<button onclick="deleteRepairRequest('${item.vehicle_id}', '${item.id || ''}', ${item.req_index})" style="cursor:pointer; background:none; border:none; color:var(--status-to-repair); font-size:1.1rem;" title="Elimina"><i class="fa-solid fa-trash"></i></button>` : ''}
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>`;
        } else if (type === 'report_officina') {
            const vehicles = await store.getVehicles();
            let interventions = await store.getInterventions();
            const locations = await store.getLocations();
            const locMap = new Map();
            locations.forEach(loc => {
                if (loc.luogo) locMap.set(loc.luogo.trim().toUpperCase(), loc);
            });

            // AUTO-CLEANUP: elimina interventi orfani (vehicle_id non corrisponde a nessun veicolo) se admin
            if (isAdmin) {
                const vehicleIdSet = new Set(vehicles.map(v => v.id));
                const orphaned = interventions.filter(i => !i.vehicle_id || !vehicleIdSet.has(i.vehicle_id));
                if (orphaned.length > 0) {
                    const confirmMsg = `Trovati ${orphaned.length} interventi orfani (mezzo N/A) non collegati ad alcun veicolo in flotta.\n\nVuoi eliminarli definitivamente da Firestore?`;
                    if (confirm(confirmMsg)) {
                        for (const oi of orphaned) {
                            await store.deleteIntervention(oi.id);
                        }
                        // Ricarica gli interventi dopo la pulizia
                        interventions = await store.getInterventions();
                        alert(`${orphaned.length} interventi orfani eliminati con successo.`);
                    }
                }
            }

            // Raccoglie tutti gli anni disponibili negli interventi
            const yearsSet = new Set();
            interventions.forEach(i => {
                const dIn = window.parseInterventionDate(i.date);
                if (dIn) yearsSet.add(dIn.getFullYear());
                const dOut = window.parseInterventionDate(i.date_out);
                if (dOut) yearsSet.add(dOut.getFullYear());
            });
            const availableYears = Array.from(yearsSet).sort((a, b) => b - a);
            // Default: anno più recente disponibile (non "tutti gli anni")
            const defaultYear = availableYears.length > 0 ? String(availableYears[0]) : String(new Date().getFullYear());
            if (!window.currentWorkshopReportYear || window.currentWorkshopReportYear === 'all') {
                window.currentWorkshopReportYear = defaultYear;
            }
            const selectedYear = window.currentWorkshopReportYear;

            // Mappatura per veicolo
            const vMap = new Map();
            vehicles.forEach(v => {
                vMap.set(v.id, {
                    id: v.id,
                    sigla: v.sigla || '-',
                    plate: v.plate || '-',
                    model: v.model || '-',
                    station: v.station || '-',
                    status: v.status || 'unknown',
                    is_alea: !!v.is_alea,
                    mileage: v.mileage || 0,
                    mileage_month: v.mileage_month || '',
                    interventions: []
                });
            });

            interventions.forEach(i => {
                let v = null;
                if (i.vehicle_id && vMap.has(i.vehicle_id)) {
                    v = vMap.get(i.vehicle_id);
                } else if (i.sigla) {
                    for (const item of vMap.values()) {
                        if (item.sigla === i.sigla) {
                            v = item;
                            break;
                        }
                    }
                }

                if (!v) {
                    const fakeId = i.vehicle_id || ('unknown_' + (i.sigla || 'N/A'));
                    v = {
                        id: fakeId,
                        sigla: i.sigla || 'N/A',
                        plate: '-',
                        model: '-',
                        station: '-',
                        status: 'unknown',
                        is_alea: false,
                        mileage: i.km || 0,
                        mileage_month: '',
                        interventions: []
                    };
                    vMap.set(fakeId, v);
                }

                const dIn = window.parseInterventionDate(i.date);
                const dOut = window.parseInterventionDate(i.date_out);
                const itemYear = dIn ? dIn.getFullYear() : (dOut ? dOut.getFullYear() : null);

                // Filtro anno se impostato
                if (selectedYear !== 'all') {
                    const yr = parseInt(selectedYear, 10);
                    if (itemYear !== yr) return;
                }

                const stay = window.calculateStayDays(i.date, i.date_out);

                v.interventions.push({
                    id: i.id,
                    date: i.date,
                    date_out: i.date_out,
                    dIn,
                    dOut,
                    days: stay.days,
                    isOngoing: stay.isOngoing,
                    workshop: i.workshop || '-',
                    km: i.km || null,
                    description: i.description || '-'
                });
            });

            // Calcolo metriche per singolo veicolo
            const reportRows = [];
            let fleetTotalDays = 0;
            let fleetTotalStays = 0;
            let fleetVehiclesInShop = 0;

            for (const v of vMap.values()) {
                // Ordina dal ricovero più recente
                v.interventions.sort((a, b) => {
                    const timeA = a.dIn ? a.dIn.getTime() : 0;
                    const timeB = b.dIn ? b.dIn.getTime() : 0;
                    return timeB - timeA;
                });

                const count = v.interventions.length;
                let totalDays = 0;
                let hasOngoing = false;

                v.interventions.forEach(item => {
                    totalDays += item.days;
                    if (item.isOngoing) hasOngoing = true;
                });

                if (v.status === 'maintenance') {
                    hasOngoing = true;
                }

                if (hasOngoing) {
                    fleetVehiclesInShop++;
                }

                fleetTotalDays += totalDays;
                fleetTotalStays += count;

                const lastStay = count > 0 ? v.interventions[0] : null;

                let maxKm = parseInt(v.mileage) || 0;
                v.interventions.forEach(item => {
                    if (item.km && parseInt(item.km) > maxKm) maxKm = parseInt(item.km);
                });

                const loc = locMap.get((v.station || '').trim().toUpperCase());
                const stationMonthlyKm = (loc && loc.monthly_km) ? Number(loc.monthly_km) : 0;
                const est = window.calculateDecemberKmEstimate(maxKm || v.mileage, v.mileage_month, stationMonthlyKm);

                reportRows.push({
                    ...v,
                    totalDays,
                    count,
                    hasOngoing,
                    lastStay,
                    mileage: maxKm || v.mileage || 0,
                    mileage_month: v.mileage_month || '',
                    stationMonthlyKm,
                    stationColor: loc ? loc.colore : '#3b82f6',
                    estimatedKm: est.estimatedKm,
                    deltaKm: est.deltaKm,
                    remainingMonths: est.remainingMonths,
                    estimateLabel: est.label
                });
            }

            // Ordinamento per sigla crescente (A → Z)
            reportRows.sort((a, b) => (a.sigla || '').localeCompare(b.sigla || '', 'it', { numeric: true }));

            const vehiclesWithStays = reportRows.filter(r => r.count > 0 || r.hasOngoing).length;

            html = `
                <div style="margin-bottom: 1.25rem; background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%); color: white; padding: 1.25rem 1.5rem; border-radius: 0.75rem; display: flex; justify-content: space-between; align-items: center; gap: 1rem; flex-wrap: wrap; box-shadow: 0 4px 6px -1px rgba(79, 70, 229, 0.2);">
                    <div>
                        <h3 style="margin: 0; font-size: 1.2rem; font-weight: 700; display: flex; align-items: center; gap: 0.6rem;">
                            <i class="fa-solid fa-clock-rotate-left"></i> Report Tempo di Permanenza in Officina
                        </h3>
                        <div style="font-size: 0.85rem; opacity: 0.9; margin-top: 0.35rem;">
                            Monitoraggio dettagliato dei giorni di fermo macchina, chilometri e storico ricoveri per singola ambulanza
                        </div>
                    </div>
                    <div style="display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap;">
                        <button class="btn btn-export" onclick="exportCurrentTableToCSV()" style="background: white; color: #6d28d9; border: none; font-weight: 600; display: flex; align-items: center; gap: 0.4rem; white-space: nowrap; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                            <i class="fa-solid fa-file-excel"></i> Esporta Riepilogo Excel
                        </button>
                    </div>
                </div>

                <!-- KPI Cards Grid -->
                <div class="workshop-kpi-grid">
                    <div class="workshop-kpi-card">
                        <div class="workshop-kpi-icon" style="background: #eef2ff; color: #4f46e5;">
                            <i class="fa-solid fa-stopwatch"></i>
                        </div>
                        <div>
                            <div class="workshop-kpi-val">${fleetTotalDays} <span style="font-size: 0.9rem; font-weight: 500; color: #64748b;">giorni</span></div>
                            <div class="workshop-kpi-lbl">Totale Giorni Fermo Flotta</div>
                        </div>
                    </div>
                    <div class="workshop-kpi-card">
                        <div class="workshop-kpi-icon" style="background: #ecfdf5; color: #059669;">
                            <i class="fa-solid fa-truck-medical"></i>
                        </div>
                        <div>
                            <div class="workshop-kpi-val">${fleetTotalStays} <span style="font-size: 0.9rem; font-weight: 500; color: #64748b;">ricoveri</span></div>
                            <div class="workshop-kpi-lbl">Ricoveri Complessivi (${vehiclesWithStays} mezzi)</div>
                        </div>
                    </div>
                    <div class="workshop-kpi-card" style="${fleetVehiclesInShop > 0 ? 'border: 1px solid #fecaca; background: #fff5f5;' : ''}">
                        <div class="workshop-kpi-icon" style="background: ${fleetVehiclesInShop > 0 ? '#fee2e2' : '#f8fafc'}; color: ${fleetVehiclesInShop > 0 ? '#dc2626' : '#64748b'};">
                            <i class="fa-solid ${fleetVehiclesInShop > 0 ? 'fa-triangle-exclamation' : 'fa-check'}"></i>
                        </div>
                        <div>
                            <div class="workshop-kpi-val" style="color: ${fleetVehiclesInShop > 0 ? '#dc2626' : 'var(--text-primary)'};">${fleetVehiclesInShop} <span style="font-size: 0.9rem; font-weight: 500; color: #64748b;">mezzi</span></div>
                            <div class="workshop-kpi-lbl">${fleetVehiclesInShop > 0 ? 'Attualmente in Officina' : 'Nessun Mezzo in Officina'}</div>
                        </div>
                    </div>
                </div>

                <!-- Filters & Search Toolbar -->
                <div style="margin-bottom: 1rem; background: #f8fafc; padding: 0.75rem 1rem; border-radius: 0.75rem; border: 1px solid var(--border-color); display: flex; gap: 1rem; align-items: center; justify-content: space-between; flex-wrap: wrap;">
                    <div style="flex-grow: 1; position: relative; min-width: 240px;">
                        <i class="fa-solid fa-search" style="position: absolute; left: 1rem; top: 50%; transform: translateY(-50%); color: var(--text-secondary);"></i>
                        <input type="text" id="workshop-report-search" placeholder="Cerca mezzo (Sigla, Targa, Officina, Sede)..." 
                                oninput="window.filterWorkshopReport(this.value)"
                                style="width: 100%; padding: 0.5rem 1rem 0.5rem 2.5rem; border-radius: 0.5rem; border: 1px solid var(--border-color); outline: none; font-size: 0.9rem;">
                    </div>
                    <div style="display: flex; gap: 0.75rem; align-items: center; flex-wrap: wrap;">
                        <div style="display: flex; align-items: center; gap: 0.4rem; font-size: 0.85rem; font-weight: 600; color: #475569;">
                            <i class="fa-solid fa-calendar"></i> Anno:
                            <select id="workshop-year-select" onchange="window.filterWorkshopByYear(this.value)" style="padding: 0.4rem 0.8rem; border-radius: 0.375rem; border: 1px solid var(--border-color); background: white; font-weight: 600; outline: none; cursor: pointer;">
                                ${availableYears.map(yr => `<option value="${yr}" ${selectedYear === String(yr) ? 'selected' : ''}>${yr}</option>`).join('')}
                            </select>
                        </div>
                        <label style="display: flex; align-items: center; gap: 0.4rem; font-size: 0.85rem; font-weight: 500; color: #475569; cursor: pointer; user-select: none;">
                            <input type="checkbox" id="workshop-only-active" onchange="window.toggleOnlyActiveWorkshop(this.checked)" checked style="cursor: pointer;">
                            Mostra solo con ricoveri
                        </label>
                    </div>
                </div>

                <!-- Main Report Table -->
                <div style="overflow-x: auto;">
                    <table class="mgmt-table" id="workshop-report-table">
                        <thead>
                            <tr>
                                <th class="col-shrink">Mezzo</th>
                                <th class="col-shrink">Modello</th>
                                <th class="col-shrink">Sede</th>
                                <th class="col-shrink" style="text-align: right;">Ultimi Km Rilevati</th>
                                <th class="col-shrink" style="text-align: right;">Stima Fine Dicembre</th>
                                <th class="col-shrink" style="text-align: center;">Giorni in Officina</th>
                                <th class="col-shrink" style="text-align: center;">N° Ricoveri</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${reportRows.length === 0 ? '<tr><td colspan="7" style="text-align:center; padding: 2rem; color: var(--text-secondary);">Nessun dato trovato per i criteri selezionati.</td></tr>' : ''}
                            ${reportRows.map(row => {
                                let badgeClass = 'badge-days-zero';
                                if (row.hasOngoing) badgeClass = 'badge-days-ongoing';
                                else if (row.totalDays > 10) badgeClass = 'badge-days-high';
                                else if (row.totalDays >= 4) badgeClass = 'badge-days-med';
                                else if (row.totalDays > 0) badgeClass = 'badge-days-low';

                                const isOnlyZero = row.count === 0 && !row.hasOngoing;
                                const trStyle = isOnlyZero ? 'style="display: none;" class="workshop-row-zero"' : 'class="workshop-row"';

                                const currentWorkshop = (row.lastStay && row.lastStay.workshop) ? row.lastStay.workshop : 'Officina';

                                const kmVal = parseInt(row.mileage) || 0;
                                const kmText = kmVal > 0 ? `${kmVal.toLocaleString('it-IT')} km` : '-';
                                const monthText = row.mileage_month ? `<div style="font-size: 0.75rem; color: #64748b; font-weight: 500;">${row.mileage_month}</div>` : '';

                                return `
                                    <tr ${trStyle} id="w-row-${row.id}" data-search="${(row.sigla + ' ' + row.plate + ' ' + row.model + ' ' + (row.station || '') + ' ' + (row.lastStay ? row.lastStay.workshop : '')).toLowerCase()}">
                                        <td class="col-shrink text-bold text-primary">
                                            <span style="font-size: 1rem;">${row.sigla}</span>
                                            ${row.is_alea ? '<span style="background: #fef3c7; color: #92400e; font-size: 0.7rem; font-weight: 700; padding: 0.15rem 0.4rem; border-radius: 4px; margin-left: 0.35rem; vertical-align: middle;">Alea</span>' : ''}
                                            <div style="font-size: 0.75rem; color: #64748b; font-weight: 500;">${row.plate}</div>
                                        </td>
                                        <td class="col-shrink" style="font-size: 0.85rem;">${row.model}</td>
                                        <td class="col-shrink" style="font-size: 0.85rem;">
                                            <div style="font-weight: 700; color: #1e293b;">${row.station || '-'}</div>
                                            ${row.stationMonthlyKm > 0 
                                                ? `<div style="font-size: 0.75rem; color: #0284c7; font-weight: 600;"><i class="fa-solid fa-gauge-high" style="font-size: 0.65rem;"></i> ${row.stationMonthlyKm.toLocaleString('it-IT')} km/m</div>` 
                                                : '<div style="font-size: 0.75rem; color: #94a3b8;">0 km/m</div>'}
                                        </td>
                                        <td class="col-shrink" style="text-align: right; white-space: nowrap;">
                                            <div style="font-weight: 700; color: var(--primary-color); font-size: 0.95rem;">${kmText}</div>
                                            ${monthText}
                                        </td>
                                        <td class="col-shrink" style="text-align: right; white-space: nowrap;">
                                            ${row.estimatedKm > 0 ? `
                                                <div style="font-weight: 800; color: #6d28d9; font-size: 0.95rem;">
                                                    ${row.estimatedKm.toLocaleString('it-IT')} km
                                                </div>
                                                <div style="font-size: 0.75rem; color: ${row.deltaKm > 0 ? '#059669' : '#64748b'}; font-weight: 600;">
                                                    ${row.deltaKm > 0 
                                                        ? `+${row.deltaKm.toLocaleString('it-IT')} km (${row.estimateLabel})`
                                                        : (row.stationMonthlyKm === 0 ? '(0 km/m sede)' : '(Fine anno)')}
                                                </div>
                                            ` : '<span style="color: #94a3b8;">-</span>'}
                                        </td>
                                        <td class="col-shrink" style="text-align: center;">
                                            <span class="badge-days ${badgeClass}">
                                                ${row.totalDays} ${row.totalDays === 1 ? 'giorno' : 'giorni'}
                                                ${row.hasOngoing ? ' <i class="fa-solid fa-spinner fa-spin" style="margin-left: 3px;" title="Ricovero in corso"></i>' : ''}
                                            </span>
                                        </td>
                                        <td class="col-shrink" style="text-align: center; font-weight: 700; font-size: 0.9rem; color: #1e293b;">
                                            ${row.count}
                                        </td>
                                    </tr>
                                `;
                            }).join('')}
                        </tbody>
                    </table>
                </div>
            `;
        }
    } catch (e) {
        html = `<p style="color:red;">Errore caricamento dati: ${e.message}</p>`;
    }

    container.innerHTML = html;
}

window.toggleWorkshopRow = function (vehicleId) {
    const detailRow = document.getElementById(`w-detail-${vehicleId}`);
    const chevron = document.getElementById(`chevron-${vehicleId}`);
    if (!detailRow) return;

    if (detailRow.style.display === 'none' || !detailRow.style.display) {
        detailRow.style.display = 'table-row';
        if (chevron) {
            chevron.classList.remove('fa-chevron-down');
            chevron.classList.add('fa-chevron-up');
        }
    } else {
        detailRow.style.display = 'none';
        if (chevron) {
            chevron.classList.remove('fa-chevron-up');
            chevron.classList.add('fa-chevron-down');
        }
    }
};

window.filterWorkshopReport = function (query) {
    const table = document.getElementById('workshop-report-table');
    if (!table) return;
    const q = (query || '').toLowerCase().trim();
    const rows = table.querySelectorAll('tbody tr.workshop-row, tbody tr.workshop-row-zero');
    const isOnlyActiveChecked = document.getElementById('workshop-only-active') ? document.getElementById('workshop-only-active').checked : true;

    rows.forEach(row => {
        const searchData = row.getAttribute('data-search') || '';
        const isZero = row.classList.contains('workshop-row-zero');
        const matchesQuery = !q || searchData.includes(q);

        if (matchesQuery) {
            if (isZero && isOnlyActiveChecked && !q) {
                row.style.display = 'none';
            } else {
                row.style.display = '';
            }
        } else {
            row.style.display = 'none';
            const id = row.id.replace('w-row-', '');
            const detailRow = document.getElementById(`w-detail-${id}`);
            if (detailRow) detailRow.style.display = 'none';
        }
    });
};

window.filterWorkshopByYear = function (year) {
    window.currentWorkshopReportYear = year;
    switchDataTable('report_officina');
};

window.toggleOnlyActiveWorkshop = function (onlyActive) {
    const zeroRows = document.querySelectorAll('.workshop-row-zero');
    const searchVal = (document.getElementById('workshop-report-search') ? document.getElementById('workshop-report-search').value : '').trim();
    zeroRows.forEach(row => {
        if (!onlyActive || searchVal !== '') {
            row.style.display = '';
        } else {
            row.style.display = 'none';
        }
    });
};

window.filterInterventionTable = function (query) {
    const table = document.querySelector('.data-mgmt-content table');
    if (!table) return;
    const rows = table.querySelectorAll('tbody tr');
    const q = query.toLowerCase();
    rows.forEach(row => {
        const text = row.innerText.toLowerCase();
        row.style.display = text.includes(q) ? '' : 'none';
    });
};
// --- Operational Notes ---

window.openOperationalNotesModal = async function () {
    const modal = document.getElementById('operational-notes-modal');
    const daFareTxt = document.getElementById('note-da-fare');
    const assegnazioniTxt = document.getElementById('note-assegnazioni');

    try {
        const notes = await store.getOperationalNotes();
        daFareTxt.value = notes.da_fare || '';
        assegnazioniTxt.value = notes.assegnazioni || '';
        modal.classList.remove('hidden');
    } catch (error) {
        console.error("Error opening operational notes:", error);
    }
}

window.closeOperationalNotesModal = function () {
    document.getElementById('operational-notes-modal').classList.add('hidden');
}

window.saveAndCloseOperationalNotes = async function () {
    const daFare = document.getElementById('note-da-fare').value;
    const assegnazioniVal = document.getElementById('note-assegnazioni').value;

    try {
        await store.saveOperationalNotes({
            da_fare: upper(daFare),
            assegnazioni: upper(assegnazioniVal)
        });
        closeOperationalNotesModal();
    } catch (error) {
        console.error("Error saving operational notes:", error);
        alert("Errore durante il salvataggio delle note.");
    }
}

// ==========================================
// MODULO E DOWNLOAD RICHIESTA RIPARAZIONE (WORD .DOCX)
// ==========================================

window.isAleaVehicle = function (vehicle) {
    if (!vehicle) return false;
    if (vehicle.is_alea === true || vehicle.is_alea === 'true') return true;

    // Controllo su tutti i campi di testo con rimozione di accenti/diacritici (es. aléa, alèa, alea, alia)
    const todoStr = Array.isArray(vehicle.todo_notes) ? vehicle.todo_notes.join(' ') : (vehicle.todo_notes || '');
    const checkFields = [
        vehicle.sigla || '',
        vehicle.model || '',
        vehicle.plate || '',
        vehicle.notes || '',
        vehicle.db_notes || '',
        vehicle.type || '',
        vehicle.station || '',
        todoStr
    ];

    const normalizedJoined = checkFields.map(window.normalizeVehicleText).join(' ');

    if (normalizedJoined.includes('ALEA') || normalizedJoined.includes('ALIA')) {
        return true;
    }

    const aleaSigle = [
        'ECHO 20', 'ECHO 21', 'ECHO 22', 'ECHO 26',
        'ECHO20', 'ECHO21', 'ECHO22', 'ECHO26',
        'E20', 'E21', 'E22', 'E26',
        'MIKE 20', 'MIKE 21', 'MIKE 22', 'MIKE 26',
        'M20', 'M21', 'M22', 'M26'
    ];
    const aleaPlates = [
        'HA514AY', 'HA 514 AY',
        'HA550AY', 'HA 550 AY',
        'FF837RS', 'FF 837 RS',
        'FV414RW', 'FV 414 RW'
    ];

    const siglaNorm = window.normalizeVehicleText(vehicle.sigla);
    if (aleaSigle.some(s => {
        const sNorm = window.normalizeVehicleText(s);
        return siglaNorm === sNorm || siglaNorm.includes(sNorm);
    })) {
        return true;
    }

    const plateNorm = window.normalizeVehicleText(vehicle.plate).replace(/\s+/g, '');
    if (aleaPlates.some(p => plateNorm === window.normalizeVehicleText(p).replace(/\s+/g, ''))) {
        return true;
    }

    return false;
};

window.toggleRepairTemplate = function (isAlea) {
    const banner = document.getElementById('repair-template-banner');
    const icon = document.getElementById('repair-template-icon');
    const title = document.getElementById('repair-template-title');
    const sub = document.getElementById('repair-template-sub');
    const badge = document.getElementById('repair-template-badge');
    const aleaChk = document.getElementById('repair-is-alea');
    const submitBtn = document.getElementById('repair-submit-btn');

    if (aleaChk) {
        aleaChk.checked = !!isAlea;
    }

    if (badge) {
        if (isAlea) {
            badge.textContent = 'Modello Alea';
            badge.style.background = '#d97706';
            badge.style.color = '#ffffff';
        } else {
            badge.textContent = 'Standard 118';
            badge.style.background = '#dbeafe';
            badge.style.color = '#1e40af';
        }
    }

    if (banner && icon && title && sub) {
        if (isAlea) {
            banner.style.background = '#fef3c7';
            banner.style.borderColor = '#f59e0b';
            icon.style.background = '#d97706';
            icon.innerHTML = '<i class="fa-solid fa-file-contract"></i>';
            title.style.color = '#92400e';
            title.innerHTML = 'Modello Ufficiale Flotta Alea <span style="background: #d97706; color: white; font-size: 0.68rem; font-weight: 700; padding: 0.15rem 0.45rem; border-radius: 4px; text-transform: uppercase; margin-left: 0.35rem; vertical-align: middle;">Alea</span>';
            sub.style.color = '#78350f';
            sub.textContent = 'Modulo di richiesta riparazione e ricovero dedicato esclusivamente ai mezzi della flotta Alea';
        } else {
            banner.style.background = '#eff6ff';
            banner.style.borderColor = '#3b82f6';
            icon.style.background = '#2563eb';
            icon.innerHTML = '<i class="fa-solid fa-file-word"></i>';
            title.style.color = '#1e3a8a';
            title.innerHTML = 'Modello Standard 118 (AUSL Ferrara)';
            sub.style.color = '#1e40af';
            sub.textContent = 'Modulo ufficiale di richiesta riparazione All. 1 per i mezzi della flotta 118';
        }
    }

    if (submitBtn) {
        submitBtn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Salva';
        if (isAlea) {
            submitBtn.style.background = '#d97706';
        } else {
            submitBtn.style.background = '#2563eb';
        }
    }
};

window.selectRepairTemplate = function (isAlea) {
    window.toggleRepairTemplate(isAlea);
};

window.openRepairRequestModal = async function (vehicleId) {
    try {
        if (!cachedVehicles || !cachedLocations) {
            const [vehicles, locations] = await Promise.all([
                cachedVehicles ? Promise.resolve(cachedVehicles) : store.getVehicles(),
                cachedLocations ? Promise.resolve(cachedLocations) : store.getLocations()
            ]);
            if (!cachedVehicles) cachedVehicles = vehicles;
            if (!cachedLocations) cachedLocations = locations.sort((a, b) => a.luogo.localeCompare(b.luogo));
        }

        const vehicle = vehicleId ? (cachedVehicles.find(v => v.id === vehicleId) || await store.getVehicleById(vehicleId)) : cachedVehicles[0];
        if (!vehicle) {
            alert("Dati veicolo non trovati.");
            return;
        }

        // Stato del collegamento al file Excel delle richieste
        if (window.excelSyncRefreshButton) window.excelSyncRefreshButton();

        // Salva ID veicolo per la richiesta corrente
        window.currentRepairVehicleId = vehicle.id;

        // 1. Mostra solo il mezzo della card corrente
        const vehicleDisplay = document.getElementById('repair-vehicle-display');
        if (vehicleDisplay) {
            const parts = [];
            if (vehicle.sigla) parts.push(vehicle.sigla);
            if (vehicle.plate) parts.push(vehicle.plate);
            if (vehicle.model) parts.push(`(${vehicle.model})`);
            vehicleDisplay.value = parts.length > 0 ? parts.join(' - ') : (vehicle.type || vehicle.id);
        }

        // Rilevamento automatico Mezzo Alea e aggiornamento interfaccia / selettore a schede
        const isAlea = window.isAleaVehicle(vehicle);
        window.toggleRepairTemplate(isAlea);

        // 2. Popola menu a discesa Ubicazioni (ordinate alfabeticamente)
        const stationSelect = document.getElementById('repair-station');
        if (stationSelect) {
            const sortedLocations = [...cachedLocations].sort((a, b) => a.luogo.localeCompare(b.luogo));
            stationSelect.innerHTML = sortedLocations.map(loc => {
                const isSelected = (vehicle.station && vehicle.station.toUpperCase() === loc.luogo.toUpperCase());
                return `<option value="${loc.luogo}" ${isSelected ? 'selected' : ''}>${loc.luogo}</option>`;
            }).join('');
        }

        // 3. Data corrente impostata nel selettore a finestra (date picker)
        const dateInput = document.getElementById('repair-date');
        if (dateInput) {
            dateInput.value = getLocalISODate();
        }

        // Contatti e richiedente di default
        document.getElementById('repair-dept').value = 'LOGISTICA 118';
        document.getElementById('repair-driver').value = 'MARSILI PAOLO – GAMBERONI FEDERICO – MARCHESINI LUCA';
        document.getElementById('repair-phone').value = '3209229345';
        document.getElementById('repair-email').value = 'logistica118fe@ausl.fe.it';

window.handleWashOptionChange = function (type) {
    const chkEsterno = document.getElementById('repair-chk-lavaggio-esterno');
    const chkCompleto = document.getElementById('repair-chk-lavaggio-completo');
    const descEl = document.getElementById('repair-description');
    if (!descEl) return;

    const textEsterno = "AUTOLAVAGGIO ESTERNO IP VIA CANAPA";
    const textCompleto = "AUTOLAVAGGIO INTERNO ED ESTERNO IP VIA CANAPA";
    const allWashTexts = [
        textEsterno,
        textCompleto,
        "AUTOLAVAGGIO ESTERNO",
        "AUTOLAVAGGIO INTERNO ED ESTERNO",
        "AUTOLAVAGGIO INTERNO ED ESTERNO PIÙ SANIFICAZIONE IP VIA CANAPA",
        "AUTOLAVAGGIO INTERNO ED ESTERNO PIÙ SANIFICAZIONE"
    ];

    const cleanAllWashTexts = (str) => {
        let res = str;
        allWashTexts.forEach(t => {
            const escaped = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            res = res.replace(new RegExp('^' + escaped + '\\n?', 'i'), '');
            res = res.replace(new RegExp('\\n?' + escaped + '$', 'i'), '');
            res = res.replace(new RegExp(escaped + '\\n?', 'gi'), '');
        });
        return res.trim();
    };

    let baseText = cleanAllWashTexts(descEl.value);

    if (type === 'esterno') {
        if (chkEsterno && chkEsterno.checked) {
            if (chkCompleto) chkCompleto.checked = false;
            descEl.value = textEsterno + (baseText ? '\n' + baseText : '');
        } else {
            descEl.value = baseText;
        }
    } else if (type === 'completo') {
        if (chkCompleto && chkCompleto.checked) {
            if (chkEsterno) chkEsterno.checked = false;
            descEl.value = textCompleto + (baseText ? '\n' + baseText : '');
        } else {
            descEl.value = baseText;
        }
    }
};

        // Checkbox reset (Manutenzione Mecc. / Elettrauto selezionata di default)
        document.getElementById('repair-chk-meccanica').checked = true;
        document.getElementById('repair-chk-gommista').checked = false;
        document.getElementById('repair-chk-carrozzeria').checked = false;
        if (document.getElementById('repair-chk-lavaggio-esterno')) document.getElementById('repair-chk-lavaggio-esterno').checked = false;
        if (document.getElementById('repair-chk-lavaggio-completo')) document.getElementById('repair-chk-lavaggio-completo').checked = false;
        document.getElementById('repair-chk-sinistro').checked = false;
        document.getElementById('repair-chk-soccorso').checked = false;

        // Descrizione: precarica eventuali problematiche note del mezzo o lascia vuoto
        document.getElementById('repair-description').value = vehicle.notes || '';

        // Nome file predefinito: "richiesta riparazione <SIGLA> <TARGA>"
        const defaultFileName = window.buildRepairFileName(vehicle).replace(/\.docx$/i, '');
        document.getElementById('repair-filename').value = defaultFileName;

        // Mostra modal
        const modal = document.getElementById('repair-request-modal');
        if (modal) {
            modal.classList.remove('hidden');
        }
    } catch (err) {
        console.error("Errore nell'apertura del modulo richiesta riparazione:", err);
    }
};

window.closeRepairRequestModal = function () {
    const modal = document.getElementById('repair-request-modal');
    if (modal) {
        modal.classList.add('hidden');
    }
};

function formatDescriptionLines(text, maxLines = 8, maxCharsPerLine = 65) {
    if (!text) return [];
    const rawParagraphs = text.split('\n');
    let resultLines = [];

    for (const para of rawParagraphs) {
        const trimmed = para.trim();
        if (!trimmed) {
            resultLines.push('');
            continue;
        }
        if (trimmed.length <= maxCharsPerLine) {
            resultLines.push(trimmed);
        } else {
            // Word wrap
            const words = trimmed.split(/\s+/);
            let currentLine = '';
            for (const w of words) {
                if ((currentLine + (currentLine ? ' ' : '') + w).length <= maxCharsPerLine) {
                    currentLine += (currentLine ? ' ' : '') + w;
                } else {
                    if (currentLine) resultLines.push(currentLine);
                    currentLine = w;
                }
            }
            if (currentLine) resultLines.push(currentLine);
        }
    }

    if (resultLines.length > maxLines) {
        // Unisci le righe in eccesso sull'ultima riga disponibile per non perdere testo
        const head = resultLines.slice(0, maxLines - 1);
        const tail = resultLines.slice(maxLines - 1).filter(s => s.trim() !== '').join(' ');
        head.push(tail);
        resultLines = head;
    }

    return resultLines;
}

window.createRepairDocxBlob = async function (data) {
    if (!window.JSZip) {
        throw new Error("Libreria JSZip non caricata. Ricarica la pagina.");
    }
    if (!window.REPAIR_TEMPLATE_BASE64) {
        throw new Error("Template del documento non trovato. Ricarica la pagina.");
    }

    // 1. Carica il template base64
    const zip = await JSZip.loadAsync(window.REPAIR_TEMPLATE_BASE64, { base64: true });

    // 2. Leggi word/document.xml
    const docXmlStr = await zip.file("word/document.xml").async("string");
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(docXmlStr, "application/xml");

    const nsW = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
    const tables = xmlDoc.getElementsByTagNameNS ? xmlDoc.getElementsByTagNameNS(nsW, "tbl") : xmlDoc.getElementsByTagName("w:tbl");

    if (tables.length < 3) {
        throw new Error("Struttura del documento Word non valida (meno di 3 tabelle trovate).");
    }

    // 3. Popola Tabella 0 (Info veicolo e richiedente)
    const infoValues = [
        data.driver || '',
        data.dept || '',
        data.phone || '',
        data.targa || '',
        data.station || '',
        data.email || '',
        data.date || ''
    ];
    const tbl0 = tables[0];
    const tbl0Rows = tbl0.getElementsByTagNameNS ? tbl0.getElementsByTagNameNS(nsW, "tr") : tbl0.getElementsByTagName("w:tr");

    for (let i = 0; i < infoValues.length && i < tbl0Rows.length; i++) {
        const row = tbl0Rows[i];
        const cells = row.getElementsByTagNameNS ? row.getElementsByTagNameNS(nsW, "tc") : row.getElementsByTagName("w:tc");
        if (cells.length >= 2) {
            const tc1 = cells[1];
            const wtNodes = tc1.getElementsByTagNameNS ? tc1.getElementsByTagNameNS(nsW, "t") : tc1.getElementsByTagName("w:t");
            if (wtNodes.length > 0) {
                wtNodes[0].textContent = infoValues[i];
            }
        }
    }

    // 4. Popola Tabella 1 (Caselle di controllo Wingdings)
    const checks = data.checks || [false, false, false, false, false, false];
    const tbl1 = tables[1];
    const tbl1Rows = tbl1.getElementsByTagNameNS ? tbl1.getElementsByTagNameNS(nsW, "tr") : tbl1.getElementsByTagName("w:tr");
    for (let i = 0; i < checks.length && i < tbl1Rows.length; i++) {
        const row = tbl1Rows[i];
        const cells = row.getElementsByTagNameNS ? row.getElementsByTagNameNS(nsW, "tc") : row.getElementsByTagName("w:tc");
        if (cells.length >= 2) {
            const tc1 = cells[1];
            const wtNodes = tc1.getElementsByTagNameNS ? tc1.getElementsByTagNameNS(nsW, "t") : tc1.getElementsByTagName("w:t");
            if (wtNodes.length > 0) {
                // \uF0FE = casella selezionata con spunta, \uF0A8 = casella vuota (font Wingdings)
                wtNodes[0].textContent = checks[i] ? "\uF0FE" : "\uF0A8";
            }
        }
    }

    // 5. Popola Tabella 2 (Descrizione del guasto su righe)
    const descRaw = data.description || '';
    const descLines = formatDescriptionLines(descRaw, 8, 65);

    const tbl2 = tables[2];
    const tbl2Rows = tbl2.getElementsByTagNameNS ? tbl2.getElementsByTagNameNS(nsW, "tr") : tbl2.getElementsByTagName("w:tr");
    for (let i = 0; i < 8 && i < tbl2Rows.length; i++) {
        const row = tbl2Rows[i];
        const cells = row.getElementsByTagNameNS ? row.getElementsByTagNameNS(nsW, "tc") : row.getElementsByTagName("w:tc");
        if (cells.length >= 2) {
            const tc1 = cells[1];
            const pNodes = tc1.getElementsByTagNameNS ? tc1.getElementsByTagNameNS(nsW, "p") : tc1.getElementsByTagName("w:p");
            if (pNodes.length > 0) {
                const p = pNodes[0];
                // Rimuovi eventuali run già presenti
                const existingRuns = Array.from(p.getElementsByTagNameNS ? p.getElementsByTagNameNS(nsW, "r") : p.getElementsByTagName("w:r"));
                existingRuns.forEach(r => r.parentNode.removeChild(r));

                // Se abbiamo testo per questa riga, aggiungiamo il run formattato a 12pt
                if (i < descLines.length && descLines[i] !== '') {
                    const rElem = xmlDoc.createElementNS(nsW, "w:r");
                    const rPrElem = xmlDoc.createElementNS(nsW, "w:rPr");
                    const szElem = xmlDoc.createElementNS(nsW, "w:sz");
                    szElem.setAttributeNS(nsW, "w:val", "24");
                    const szCsElem = xmlDoc.createElementNS(nsW, "w:szCs");
                    szCsElem.setAttributeNS(nsW, "w:val", "24");
                    rPrElem.appendChild(szElem);
                    rPrElem.appendChild(szCsElem);
                    rElem.appendChild(rPrElem);

                    const tElem = xmlDoc.createElementNS(nsW, "w:t");
                    tElem.setAttribute("xml:space", "preserve");
                    tElem.textContent = descLines[i];
                    rElem.appendChild(tElem);

                    p.appendChild(rElem);
                }
            }
        }
    }

    // 6. Serializza l'XML aggiornato
    const serializer = new XMLSerializer();
    const updatedXmlStr = serializer.serializeToString(xmlDoc);
    zip.file("word/document.xml", updatedXmlStr);

    // 7. Genera il blob del file .docx
    return await zip.generateAsync({
        type: "blob",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        compression: "DEFLATE"
    });
};

window.createAleaRepairDocxBlob = async function (data) {
    if (!window.JSZip) {
        throw new Error("Libreria JSZip non caricata. Ricarica la pagina.");
    }
    if (!window.ALEA_TEMPLATE_BASE64) {
        throw new Error("Template Word per mezzi Alea non trovato. Ricarica la pagina.");
    }

    // 1. Carica il template base64 Alea
    const zip = await JSZip.loadAsync(window.ALEA_TEMPLATE_BASE64, { base64: true });

    // 2. Leggi word/document.xml
    const docXmlStr = await zip.file("word/document.xml").async("string");
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(docXmlStr, "application/xml");

    const nsW = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
    const tables = xmlDoc.getElementsByTagNameNS ? xmlDoc.getElementsByTagNameNS(nsW, "tbl") : xmlDoc.getElementsByTagName("w:tbl");

    if (tables.length < 1) {
        throw new Error("Struttura del documento Word Alea non valida (nessuna tabella trovata).");
    }

    const tbl = tables[0];
    const rows = tbl.getElementsByTagNameNS ? tbl.getElementsByTagNameNS(nsW, "tr") : tbl.getElementsByTagName("w:tr");

    // 3. Popola Row 3 (Targa e Modello Veicolo)
    let aleaVehicleStr = (data.targa || '').trim();
    if (aleaVehicleStr) {
        if (!data.is_wash && !aleaVehicleStr.toUpperCase().includes('ALEA') && !aleaVehicleStr.toUpperCase().includes('ALIA')) {
            if (aleaVehicleStr.toUpperCase().startsWith('AMBULANZA')) {
                aleaVehicleStr = aleaVehicleStr.replace(/^AMBULANZA\s*/i, 'AMBULANZA ALEA ');
            } else {
                aleaVehicleStr = 'AMBULANZA ALEA ' + aleaVehicleStr;
            }
        }
    } else {
        aleaVehicleStr = 'AMBULANZA ALEA';
    }

    if (rows.length > 3) {
        const r3 = rows[3];
        const sdts3 = r3.getElementsByTagNameNS ? r3.getElementsByTagNameNS(nsW, "sdt") : r3.getElementsByTagName("w:sdt");
        if (sdts3.length > 0) {
            const sdtContent = sdts3[0].getElementsByTagNameNS ? sdts3[0].getElementsByTagNameNS(nsW, "sdtContent") : sdts3[0].getElementsByTagName("w:sdtContent");
            if (sdtContent.length > 0) {
                const wtNodes = sdtContent[0].getElementsByTagNameNS ? sdtContent[0].getElementsByTagNameNS(nsW, "t") : sdtContent[0].getElementsByTagName("w:t");
                if (wtNodes.length > 0) {
                    wtNodes[0].textContent = aleaVehicleStr;
                }
            }
        }
    }

    // 4. Popola Row 5 (Ditta / Officina e Km se specificata)
    if (rows.length > 5) {
        const r5 = rows[5];
        const cells5 = r5.getElementsByTagNameNS ? r5.getElementsByTagNameNS(nsW, "tc") : r5.getElementsByTagName("w:tc");
        if (cells5.length >= 1 && data.km) {
            const wtKm = cells5[0].getElementsByTagNameNS ? cells5[0].getElementsByTagNameNS(nsW, "t") : cells5[0].getElementsByTagName("w:t");
            if (wtKm.length > 0) {
                wtKm[0].textContent = 'Km:  ' + data.km;
            }
        }
        if (cells5.length >= 2 && data.station) {
            const wtNodes5 = cells5[1].getElementsByTagNameNS ? cells5[1].getElementsByTagNameNS(nsW, "t") : cells5[1].getElementsByTagName("w:t");
            if (wtNodes5.length >= 2) {
                wtNodes5[1].textContent = data.station;
            } else if (wtNodes5.length === 1) {
                wtNodes5[0].textContent = 'Ditta      ' + data.station;
            }
        }
    }

    // 5. Popola Righe 10 - 14 (Descrizione lavori / guasto, 5 righe)
    const descRaw = data.description || '';
    const descLines = formatDescriptionLines(descRaw, 5, 65);
    for (let rIdx = 10; rIdx <= 14 && rIdx < rows.length; rIdx++) {
        const row = rows[rIdx];
        const cells = row.getElementsByTagNameNS ? row.getElementsByTagNameNS(nsW, "tc") : row.getElementsByTagName("w:tc");
        if (cells.length > 0) {
            const tc = cells[0];
            const pNodes = tc.getElementsByTagNameNS ? tc.getElementsByTagNameNS(nsW, "p") : tc.getElementsByTagName("w:p");
            if (pNodes.length > 0) {
                const p = pNodes[0];
                const existingRuns = Array.from(p.getElementsByTagNameNS ? p.getElementsByTagNameNS(nsW, "r") : p.getElementsByTagName("w:r"));
                existingRuns.forEach(r => r.parentNode.removeChild(r));

                const lineIdx = rIdx - 10;
                if (lineIdx < descLines.length && descLines[lineIdx] !== '') {
                    const rElem = xmlDoc.createElementNS(nsW, "w:r");
                    const rPrElem = xmlDoc.createElementNS(nsW, "w:rPr");

                    const rFonts = xmlDoc.createElementNS(nsW, "w:rFonts");
                    rFonts.setAttributeNS(nsW, "w:ascii", "Arial");
                    rFonts.setAttributeNS(nsW, "w:hAnsi", "Arial");
                    const szElem = xmlDoc.createElementNS(nsW, "w:sz");
                    szElem.setAttributeNS(nsW, "w:val", "22");
                    const szCsElem = xmlDoc.createElementNS(nsW, "w:szCs");
                    szCsElem.setAttributeNS(nsW, "w:val", "22");

                    rPrElem.appendChild(rFonts);
                    rPrElem.appendChild(szElem);
                    rPrElem.appendChild(szCsElem);
                    rElem.appendChild(rPrElem);

                    const tElem = xmlDoc.createElementNS(nsW, "w:t");
                    tElem.setAttribute("xml:space", "preserve");
                    tElem.textContent = descLines[lineIdx];
                    rElem.appendChild(tElem);

                    p.appendChild(rElem);
                }
            }
        }
    }

    // 6. Popola Row 16 (Richiedente, Data, Telefono)
    if (rows.length > 16) {
        const r16 = rows[16];
        const pNodes = r16.getElementsByTagNameNS ? r16.getElementsByTagNameNS(nsW, "p") : r16.getElementsByTagName("w:p");

        // Para 0: Telefono
        if (pNodes.length > 0 && data.phone) {
            const wt0 = pNodes[0].getElementsByTagNameNS ? pNodes[0].getElementsByTagNameNS(nsW, "t") : pNodes[0].getElementsByTagName("w:t");
            if (wt0.length > 0) {
                const lastWt = wt0[wt0.length - 1];
                if (lastWt.textContent.trim().startsWith('Tel')) {
                    lastWt.textContent = 'Tel ' + data.phone;
                }
            }
        }

        // Para 3: Nome richiedente
        if (pNodes.length > 3 && data.driver) {
            const sdts3 = pNodes[3].getElementsByTagNameNS ? pNodes[3].getElementsByTagNameNS(nsW, "sdt") : pNodes[3].getElementsByTagName("w:sdt");
            if (sdts3.length > 0) {
                const sdtContent = sdts3[0].getElementsByTagNameNS ? sdts3[0].getElementsByTagNameNS(nsW, "sdtContent") : sdts3[0].getElementsByTagName("w:sdtContent");
                if (sdtContent.length > 0) {
                    const wtNodes = sdtContent[0].getElementsByTagNameNS ? sdtContent[0].getElementsByTagNameNS(nsW, "t") : sdtContent[0].getElementsByTagName("w:t");
                    if (wtNodes.length > 0) {
                        wtNodes[0].textContent = data.driver;
                    }
                }
            }
        }

        // Para 5: Data richiesta
        if (pNodes.length > 5 && data.date) {
            const sdts5 = pNodes[5].getElementsByTagNameNS ? pNodes[5].getElementsByTagNameNS(nsW, "sdt") : pNodes[5].getElementsByTagName("w:sdt");
            if (sdts5.length > 0) {
                const sdtContent = sdts5[0].getElementsByTagNameNS ? sdts5[0].getElementsByTagNameNS(nsW, "sdtContent") : sdts5[0].getElementsByTagName("w:sdtContent");
                if (sdtContent.length > 0) {
                    const wtNodes = sdtContent[0].getElementsByTagNameNS ? sdtContent[0].getElementsByTagNameNS(nsW, "t") : sdtContent[0].getElementsByTagName("w:t");
                    if (wtNodes.length > 0) {
                        wtNodes[0].textContent = data.date;
                    }
                }
                const datePr = sdts5[0].getElementsByTagNameNS ? sdts5[0].getElementsByTagNameNS(nsW, "date") : sdts5[0].getElementsByTagName("w:date");
                if (datePr.length > 0) {
                    const parts = data.date.split('/');
                    if (parts.length === 3) {
                        datePr[0].setAttributeNS(nsW, "w:fullDate", `${parts[2]}-${parts[1]}-${parts[0]}T00:00:00Z`);
                    }
                }
            }
        }
    }

    // 6b. Aggiorna tutti i controlli data nel documento (es. data consegna e data ritiro)
    if (data.date) {
        const allSdts = xmlDoc.getElementsByTagNameNS ? xmlDoc.getElementsByTagNameNS(nsW, "sdt") : xmlDoc.getElementsByTagName("w:sdt");
        for (let i = 0; i < allSdts.length; i++) {
            const sdt = allSdts[i];
            const datePr = sdt.getElementsByTagNameNS ? sdt.getElementsByTagNameNS(nsW, "date") : sdt.getElementsByTagName("w:date");
            if (datePr.length > 0) {
                const sdtContent = sdt.getElementsByTagNameNS ? sdt.getElementsByTagNameNS(nsW, "sdtContent") : sdt.getElementsByTagName("w:sdtContent");
                if (sdtContent.length > 0) {
                    const wtNodes = sdtContent[0].getElementsByTagNameNS ? sdtContent[0].getElementsByTagNameNS(nsW, "t") : sdtContent[0].getElementsByTagName("w:t");
                    if (wtNodes.length > 0) {
                        wtNodes[0].textContent = data.date;
                    }
                }
                const parts = data.date.split('/');
                if (parts.length === 3) {
                    datePr[0].setAttributeNS(nsW, "w:fullDate", `${parts[2]}-${parts[1]}-${parts[0]}T00:00:00Z`);
                }
            }
        }
    }

    // 7. Serializza l'XML aggiornato
    const serializer = new XMLSerializer();
    const updatedXmlStr = serializer.serializeToString(xmlDoc);
    zip.file("word/document.xml", updatedXmlStr);

    // 8. Genera il blob del file .docx
    return await zip.generateAsync({
        type: "blob",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        compression: "DEFLATE"
    });
};

window.copyTextToClipboard = async function (text) {
    if (!text) return false;
    try {
        if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(text);
            return true;
        }
    } catch (e) {
        console.warn("navigator.clipboard non disponibile, uso fallback execCommand:", e);
    }
    try {
        const textArea = document.createElement("textarea");
        textArea.value = text;
        textArea.style.position = "fixed";
        textArea.style.left = "-999999px";
        textArea.style.top = "-999999px";
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        const successful = document.execCommand('copy');
        document.body.removeChild(textArea);
        return successful;
    } catch (err) {
        console.error("Errore durante la copia negli appunti:", err);
        return false;
    }
};

// Banner di notifica/conferma per il salvataggio della richiesta di riparazione
window.showRepairSaveConfirmationBanner = function (filename, targetFolder = "Cartella Download", excelRes = null) {
    const existing = document.getElementById('repair-save-banner-toast');
    if (existing) {
        existing.remove();
    }

    let excelLine = '';
    if (excelRes && !excelRes.skipped) {
        if (excelRes.ok) {
            excelLine = `<div class="repair-banner-item"><i class="fa-solid fa-file-excel" style="color: #16a34a;"></i><span>Riga aggiunta a <strong>${excelRes.fileName || 'ORGANIZZAZIONE RICHIESTE MEZZI.xlsx'}</strong></span></div>`;
        } else if (excelRes.notLinked) {
            excelLine = `<div class="repair-banner-item"><i class="fa-solid fa-triangle-exclamation" style="color: #d97706;"></i><span>File Excel non selezionato</span></div>`;
        } else {
            excelLine = `<div class="repair-banner-item"><i class="fa-solid fa-triangle-exclamation" style="color: #d97706;"></i><span>Excel: ${excelRes.error || 'non aggiornato (in sospeso)'}</span></div>`;
        }
    }

    const banner = document.createElement('div');
    banner.id = 'repair-save-banner-toast';
    banner.className = 'repair-save-banner';
    banner.innerHTML = `
        <div class="repair-banner-card">
            <div class="repair-banner-icon">
                <i class="fa-solid fa-circle-check"></i>
            </div>
            <div class="repair-banner-content">
                <div class="repair-banner-header">
                    <span class="repair-banner-title">Richiesta Salvata con Successo!</span>
                    <button type="button" class="repair-banner-close" onclick="closeRepairSaveBanner()">&times;</button>
                </div>
                <div class="repair-banner-body">
                    <div class="repair-banner-item">
                        <i class="fa-solid fa-file-word file-icon"></i>
                        <span class="file-name">${filename}</span>
                    </div>
                    <div class="repair-banner-item location-item">
                        <i class="fa-solid fa-folder-open folder-icon"></i>
                        <span>Salvata in: <strong>${targetFolder}</strong></span>
                    </div>
                    <div class="repair-banner-item clip-item">
                        <i class="fa-solid fa-clipboard-check clip-icon"></i>
                        <span>Dati veicolo copiati negli appunti</span>
                    </div>
                    ${excelLine}
                </div>
            </div>
            <div class="repair-banner-progress"></div>
        </div>
    `;

    document.body.appendChild(banner);

    requestAnimationFrame(() => {
        banner.classList.add('show');
    });

    if (window._repairBannerTimeout) {
        clearTimeout(window._repairBannerTimeout);
    }
    window._repairBannerTimeout = setTimeout(() => {
        closeRepairSaveBanner();
    }, 6500);
};

window.closeRepairSaveBanner = function () {
    const banner = document.getElementById('repair-save-banner-toast');
    if (banner) {
        banner.classList.remove('show');
        banner.classList.add('hide');
        setTimeout(() => {
            if (banner && banner.parentNode) {
                banner.parentNode.removeChild(banner);
            }
        }, 300);
    }
};

window.generateAndDownloadRepairDocx = async function () {
    try {
        // Veicolo della card corrente
        const vehicleId = window.currentRepairVehicleId || currentOpenedVehicleId;
        const vehicle = (cachedVehicles && cachedVehicles.find(v => v.id === vehicleId)) || (vehicleId ? await store.getVehicleById(vehicleId) : null);

        let targa = '';
        if (vehicle) {
            const vehicleTypeStr = (vehicle.type || '').toUpperCase();
            const plateStr = (vehicle.plate || '').toUpperCase();
            const siglaStr = (vehicle.sigla || '').toUpperCase();
            if (vehicleTypeStr) targa += vehicleTypeStr + '  ';
            if (plateStr) targa += plateStr + '  ';
            if (siglaStr) targa += siglaStr;
            targa = targa.trim();
        } else {
            const displayElem = document.getElementById('repair-vehicle-display');
            if (displayElem) targa = displayElem.value.trim();
        }

        // Valori campi informativi
        const driver = document.getElementById('repair-driver').value.trim();
        const dept = document.getElementById('repair-dept').value.trim();
        const phone = document.getElementById('repair-phone').value.trim();
        const station = document.getElementById('repair-station').value.trim();
        const email = document.getElementById('repair-email').value.trim();

        // Conversione data YYYY-MM-DD -> DD/MM/YYYY per Word e storico
        const rawDate = document.getElementById('repair-date').value.trim();
        let dateVal = rawDate;
        if (rawDate && rawDate.includes('-')) {
            const parts = rawDate.split('-');
            if (parts.length === 3) {
                dateVal = `${parts[2]}/${parts[1]}/${parts[0]}`;
            }
        }
        if (!dateVal) {
            const now = new Date();
            dateVal = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;
        }

        const chkMeccanica = document.getElementById('repair-chk-meccanica') ? document.getElementById('repair-chk-meccanica').checked : false;
        const chkGommista = document.getElementById('repair-chk-gommista') ? document.getElementById('repair-chk-gommista').checked : false;
        const chkCarrozzeria = document.getElementById('repair-chk-carrozzeria') ? document.getElementById('repair-chk-carrozzeria').checked : false;
        const chkLavaggioEsterno = document.getElementById('repair-chk-lavaggio-esterno') ? document.getElementById('repair-chk-lavaggio-esterno').checked : false;
        const chkLavaggioCompleto = document.getElementById('repair-chk-lavaggio-completo') ? document.getElementById('repair-chk-lavaggio-completo').checked : false;
        const chkSinistro = document.getElementById('repair-chk-sinistro') ? document.getElementById('repair-chk-sinistro').checked : false;
        const chkSoccorso = document.getElementById('repair-chk-soccorso') ? document.getElementById('repair-chk-soccorso').checked : false;

        const isAnyLavaggio = chkLavaggioEsterno || chkLavaggioCompleto;

        // Nel template Word originale: Tabella 1 ha 6 caselle (0: Meccanica, 1: Gommista, 2: Carrozzeria, 3: Autolavaggio, 4: Sinistro, 5: Soccorso)
        const checks = [
            chkMeccanica,
            chkGommista,
            chkCarrozzeria,
            isAnyLavaggio,
            chkSinistro,
            chkSoccorso
        ];

        const selectedTypes = [];
        if (chkMeccanica) selectedTypes.push('Meccanica / Elettrauto');
        if (chkGommista) selectedTypes.push('Gommista');
        if (chkCarrozzeria) selectedTypes.push('Carrozzeria');
        if (chkLavaggioEsterno) selectedTypes.push('Autolavaggio Esterno');
        if (chkLavaggioCompleto) selectedTypes.push('Autolavaggio Interno ed Esterno');
        if (chkSinistro) selectedTypes.push('Sinistro');
        if (chkSoccorso) selectedTypes.push('Soccorso Stradale');

        let descRaw = document.getElementById('repair-description').value.trim();
        if (chkLavaggioEsterno && !descRaw.toUpperCase().includes('AUTOLAVAGGIO ESTERNO') && !descRaw.toUpperCase().includes('LAVAGGIO ESTERNO')) {
            descRaw = 'AUTOLAVAGGIO ESTERNO IP VIA CANAPA' + (descRaw ? '\n' + descRaw : '');
        } else if (chkLavaggioCompleto && !descRaw.toUpperCase().includes('AUTOLAVAGGIO INTERNO') && !descRaw.toUpperCase().includes('LAVAGGIO INTERNO') && !descRaw.toUpperCase().includes('INTERNO ED ESTERNO')) {
            descRaw = 'AUTOLAVAGGIO INTERNO ED ESTERNO IP VIA CANAPA' + (descRaw ? '\n' + descRaw : '');
        }

        let filenameInput = (document.getElementById('repair-filename').value || '').trim();
        let filename = filenameInput ? filenameInput : window.buildRepairFileName(vehicle).replace(/\.docx$/i, '');
        filename = filename.replace(/[\\/:*?"<>|]/g, "_");
        if (!filename.toLowerCase().endsWith(".docx")) {
            filename += ".docx";
        }

        const isAleaChk = document.getElementById('repair-is-alea');
        const isAlea = isAleaChk ? isAleaChk.checked : window.isAleaVehicle(vehicle);

        const reqData = {
            id: 'req_' + Date.now(),
            is_alea: isAlea,
            date: dateVal,
            created_at: new Date().toISOString(),
            driver: driver,
            dept: dept,
            phone: phone,
            targa: targa,
            station: station,
            email: email,
            checks: checks,
            types: selectedTypes,
            description: descRaw,
            filename: filename
        };

        // 1. Sincronizzazione immediata con il foglio Excel locale sul Desktop (nel contesto del click utente)
        let excelRes = null;
        if (window.excelSyncAppendRequest) {
            try {
                excelRes = await window.excelSyncAppendRequest(vehicle, reqData);
            } catch (e) {
                console.error('Errore sincronizzazione Excel:', e);
                excelRes = { ok: false, error: e.message };
            }
        }

        // 2. Copia nella clipboard il testo della cella con i dati del mezzo
        const vehicleDisplayElem = document.getElementById('repair-vehicle-display');
        const vehicleTextToCopy = vehicleDisplayElem ? vehicleDisplayElem.value.trim() : (targa || '');
        if (vehicleTextToCopy) {
            try { await window.copyTextToClipboard(vehicleTextToCopy); } catch (e) {}
        }

        // Salva la richiesta nello storico del veicolo su Firestore (senza forzare il download automatico del file Word)
        if (vehicleId) {
            const targetVehicle = (cachedVehicles && cachedVehicles.find(v => v.id === vehicleId)) || await store.getVehicleById(vehicleId);
            if (targetVehicle) {
                if (!targetVehicle.repair_requests) {
                    targetVehicle.repair_requests = [];
                }
                targetVehicle.repair_requests.unshift(reqData);
                // Se la richiesta è per mezzo Alea, salva permanentemente is_alea sul veicolo
                if (isAlea && !targetVehicle.is_alea) {
                    targetVehicle.is_alea = true;
                }
                await store.updateVehicle(targetVehicle);

                // Aggiorna la vista dei dettagli del veicolo
                if (currentOpenedVehicleId === vehicleId) {
                    await openVehicleModal(vehicleId);
                }
                // Se lo storico modale del veicolo è aperto, ricarica
                const histModal = document.getElementById('vehicle-repair-history-modal');
                if (histModal && !histModal.classList.contains('hidden')) {
                    await openVehicleRepairHistoryModal(vehicleId);
                }
                // Se la tabella di gestione è aperta su riparazioni, ricarica
                if (window.lastDataManagerTab === 'riparazioni') {
                    switchDataTable('riparazioni');
                }
            }
        }

        // Genera e scarica il documento Word (.docx) salvato
        const blob = isAlea
            ? await window.createAleaRepairDocxBlob(reqData)
            : await window.createRepairDocxBlob(reqData);
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        closeRepairRequestModal();

        // Mostra banner di conferma salvataggio e cartella di destinazione
        window.showRepairSaveConfirmationBanner(filename, "Cartella Download", excelRes);
        if (excelRes && !excelRes.ok && window.excelSyncNotify) window.excelSyncNotify(excelRes);
    } catch (err) {
        console.error("Errore nel salvataggio della richiesta riparazione:", err);
        alert("Si è verificato un errore durante il salvataggio della richiesta: " + err.message);
    }
};

window.downloadSavedRepairDocx = async function (vehicleId, reqIdOrIndex, fallbackIndex) {
    try {
        const vehicle = await store.getVehicleById(vehicleId);
        if (!vehicle || !vehicle.repair_requests || !Array.isArray(vehicle.repair_requests)) {
            alert("Richiesta non trovata.");
            return;
        }

        let req = null;
        if (fallbackIndex !== undefined && fallbackIndex !== null) {
            const fIdx = parseInt(fallbackIndex, 10);
            if (!isNaN(fIdx) && fIdx >= 0 && fIdx < vehicle.repair_requests.length) {
                if (!reqIdOrIndex || vehicle.repair_requests[fIdx].id === reqIdOrIndex) {
                    req = vehicle.repair_requests[fIdx];
                }
            }
        }

        if (!req && typeof reqIdOrIndex === 'string' && reqIdOrIndex.startsWith('req_')) {
            req = vehicle.repair_requests.find(r => r.id === reqIdOrIndex);
        }

        if (!req && reqIdOrIndex !== undefined && reqIdOrIndex !== null) {
            const numIdx = parseInt(reqIdOrIndex, 10);
            if (!isNaN(numIdx) && numIdx >= 0 && numIdx < vehicle.repair_requests.length) {
                req = vehicle.repair_requests[numIdx];
            }
        }

        if (!req && typeof reqIdOrIndex === 'string' && reqIdOrIndex.length > 0) {
            req = vehicle.repair_requests.find(r => r.id === reqIdOrIndex);
        }

        if (!req) {
            alert("Richiesta non trovata.");
            return;
        }

        req = { ...req };

        // Assicura campi fondamentali
        if (!req.targa) {
            const vehicleTypeStr = (vehicle.type || '').toUpperCase();
            const plateStr = (vehicle.plate || '').toUpperCase();
            const siglaStr = (vehicle.sigla || '').toUpperCase();
            req.targa = `${vehicleTypeStr}  ${plateStr}  ${siglaStr}`.trim();
        }
        if (!req.station) {
            req.station = (vehicle.station || 'FERRARA').toUpperCase();
        }

        const defaultName = window.buildRepairFileName(vehicle);
        let filename = (req.filename || defaultName).trim();
        // Se nel nome file salvato precedentemente mancava la targa del veicolo, aggiungila
        if (vehicle.plate) {
            const plateClean = vehicle.plate.replace(/\s+/g, '').toUpperCase();
            if (!filename.toUpperCase().replace(/\s+/g, '').includes(plateClean)) {
                const baseWithoutExt = filename.replace(/\.docx$/i, '').trim();
                filename = `${baseWithoutExt} ${vehicle.plate.trim()}`;
            }
        }
        filename = filename.replace(/[\\/:*?"<>|]/g, "_");
        if (!filename.toLowerCase().endsWith(".docx")) {
            filename += ".docx";
        }

        const isWash = !!req.is_wash;
        const isAlea = req.is_alea !== undefined ? !!req.is_alea : window.isAleaVehicle(vehicle);
        const blob = isWash
            ? await window.createWashDocxBlob(req)
            : (isAlea
                ? await window.createAleaRepairDocxBlob(req)
                : await window.createRepairDocxBlob(req));
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        // Mostra banner di conferma salvataggio e cartella di destinazione
        window.showRepairSaveConfirmationBanner(filename, "Cartella Download");
    } catch (err) {
        console.error("Errore nel download del file Word salvato:", err);
        alert("Si è verificato un errore durante il download del documento Word: " + err.message);
    }
};

window.deleteRepairRequest = async function (vehicleId, reqIdOrIndex, fallbackIndex) {
    if (!confirm("Sei sicuro di voler eliminare questa richiesta di riparazione dallo storico?")) return;
    try {
        const vehicle = await store.getVehicleById(vehicleId);
        if (!vehicle || !vehicle.repair_requests || !Array.isArray(vehicle.repair_requests)) {
            alert("Dati veicolo non trovati.");
            return;
        }

        let targetIdx = -1;

        // 1. Se fornito fallbackIndex valido, verifica se corrisponde all'ID o all'indice
        if (fallbackIndex !== undefined && fallbackIndex !== null) {
            const fIdx = parseInt(fallbackIndex, 10);
            if (!isNaN(fIdx) && fIdx >= 0 && fIdx < vehicle.repair_requests.length) {
                if (!reqIdOrIndex || vehicle.repair_requests[fIdx].id === reqIdOrIndex) {
                    targetIdx = fIdx;
                }
            }
        }

        // 2. Se non ancora trovato, cerca per ID univoco (es. req_...)
        if (targetIdx === -1 && typeof reqIdOrIndex === 'string' && reqIdOrIndex.startsWith('req_')) {
            targetIdx = vehicle.repair_requests.findIndex(r => r.id === reqIdOrIndex);
        }

        // 3. Se non ancora trovato, prova reqIdOrIndex come indice numerico
        if (targetIdx === -1 && reqIdOrIndex !== undefined && reqIdOrIndex !== null) {
            const numIdx = parseInt(reqIdOrIndex, 10);
            if (!isNaN(numIdx) && numIdx >= 0 && numIdx < vehicle.repair_requests.length) {
                targetIdx = numIdx;
            }
        }

        // 4. Ultimo fallback: cerca corrispondenza su qualsiasi ID stringa
        if (targetIdx === -1 && typeof reqIdOrIndex === 'string' && reqIdOrIndex.length > 0) {
            targetIdx = vehicle.repair_requests.findIndex(r => r.id === reqIdOrIndex);
        }

        if (targetIdx !== -1) {
            const reqToDelete = vehicle.repair_requests[targetIdx];
            vehicle.repair_requests.splice(targetIdx, 1);
            await store.updateVehicle(vehicle);

            // Sincronizza l'eliminazione con il foglio Excel locale (se su PC)
            let excelDelMsg = '';
            if (window.excelSyncDeleteRequest && reqToDelete) {
                try {
                    const delRes = await window.excelSyncDeleteRequest(vehicle, reqToDelete);
                    if (delRes && delRes.ok) {
                        if (delRes.removed) {
                            excelDelMsg = `\n(Riga ${delRes.rowNumber} rimossa da ${delRes.fileName})`;
                        }
                    } else if (delRes && !delRes.notLinked && !delRes.skipped) {
                        excelDelMsg = `\n(Attenzione: non è stato possibile aggiornare il file Excel: ${delRes.error})`;
                    }
                } catch (e) {
                    console.error('Errore sincronizzazione eliminazione Excel:', e);
                }
            }

            alert("Richiesta eliminata con successo." + excelDelMsg);

            if (cachedVehicles) {
                const cv = cachedVehicles.find(v => v.id === vehicleId);
                if (cv) cv.repair_requests = vehicle.repair_requests;
            }

            if (currentOpenedVehicleId === vehicleId) {
                await openVehicleModal(vehicleId);
            }
            const histModal = document.getElementById('vehicle-repair-history-modal');
            if (histModal && !histModal.classList.contains('hidden')) {
                await openVehicleRepairHistoryModal(vehicleId);
            }
            if (window.lastDataManagerTab === 'riparazioni') {
                switchDataTable('riparazioni');
            }
        } else {
            alert("Richiesta non trovata o già eliminata.");
        }
    } catch (err) {
        console.error("Errore nell'eliminazione della richiesta:", err);
        alert("Errore durante l'eliminazione della richiesta: " + err.message);
    }
};

window.openVehicleRepairHistoryModal = async function (vehicleId) {
    try {
        let vehicle = (cachedVehicles && cachedVehicles.find(v => v.id === vehicleId)) || await store.getVehicleById(vehicleId);
        if (!vehicle) {
            alert("Dati veicolo non trovati.");
            return;
        }

        if (cachedVehicles) {
            const updated = cachedVehicles.find(v => v.id === vehicleId);
            if (updated) vehicle = updated;
        }

        const modal = document.getElementById('vehicle-repair-history-modal');
        if (!modal) return;

        const titleElem = document.getElementById('repair-history-modal-title');
        const subElem = document.getElementById('repair-history-modal-subtitle');
        const countBadge = document.getElementById('repair-history-count-badge');
        const bodyElem = document.getElementById('vehicle-repair-history-body');

        const vehicleTitle = [vehicle.sigla, vehicle.plate].filter(Boolean).join(' - ') || vehicle.model || 'Mezzo';
        if (titleElem) titleElem.textContent = `Storico Richieste: ${vehicleTitle}`;
        if (subElem) subElem.textContent = `${vehicle.model || ''} • Tipo: ${vehicle.type || '-'} • Sede: ${vehicle.station || '-'}`;

        const requests = vehicle.repair_requests || [];
        if (countBadge) {
            countBadge.textContent = `${requests.length} ${requests.length === 1 ? 'richiesta registrata' : 'richieste registrate'}`;
        }

        if (requests.length === 0) {
            bodyElem.innerHTML = `
                <div style="padding: 3rem 1rem; text-align: center; color: var(--text-secondary);">
                    <i class="fa-solid fa-file-circle-question" style="font-size: 3rem; color: #cbd5e1; margin-bottom: 1rem; display: block;"></i>
                    <p style="font-size: 1rem; font-weight: 600; color: #475569; margin-bottom: 0.5rem;">Nessuna richiesta di riparazione registrata per questo mezzo.</p>
                </div>
            `;
        } else {
            bodyElem.innerHTML = `
                <div style="background: white; border: 1px solid var(--border-color); border-radius: 0.75rem; overflow-x: auto;">
                    <table style="width: 100%; border-collapse: collapse; min-width: 600px;">
                        <thead style="background: #f1f5f9; border-bottom: 1px solid var(--border-color);">
                            <tr>
                                <th style="text-align: left; padding: 0.75rem 1rem; font-size: 0.8rem; color: #475569; text-transform: uppercase;">Data</th>
                                <th style="text-align: left; padding: 0.75rem 1rem; font-size: 0.8rem; color: #475569; text-transform: uppercase;">Tipologia</th>
                                <th style="text-align: left; padding: 0.75rem 1rem; font-size: 0.8rem; color: #475569; text-transform: uppercase;">Descrizione Lavori</th>
                                <th style="text-align: left; padding: 0.75rem 1rem; font-size: 0.8rem; color: #475569; text-transform: uppercase;">Richiedente / Driver</th>
                                <th style="text-align: right; padding: 0.75rem 1rem; font-size: 0.8rem; color: #475569; text-transform: uppercase;">Azioni</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${requests.map((req, reqIdx) => `
                                <tr style="border-bottom: 1px solid var(--border-color);">
                                    <td style="padding: 0.85rem 1rem; font-weight: 700; white-space: nowrap; color: #0f172a; font-size: 0.9rem;">
                                        <i class="fa-solid fa-calendar-day" style="color: #64748b; margin-right: 0.3rem;"></i>${req.date || '-'}
                                        ${(req.is_alea || (window.isAleaVehicle && window.isAleaVehicle(vehicle))) ? '<span style="background: #fef3c7; color: #92400e; font-size: 0.7rem; font-weight: 700; padding: 0.15rem 0.45rem; border-radius: 4px; margin-left: 0.4rem; vertical-align: middle;">Alea</span>' : ''}
                                    </td>
                                    <td style="padding: 0.85rem 1rem;">
                                        ${(req.types && req.types.length > 0) ? req.types.map(t => `<span style="background: #dbeafe; color: #1e40af; font-size: 0.75rem; font-weight: 600; padding: 0.2rem 0.5rem; border-radius: 4px; display: inline-block; margin: 0.1rem;">${t}</span>`).join('') : '<span style="color: var(--text-secondary); font-size: 0.8rem;">Non specificata</span>'}
                                    </td>
                                    <td style="padding: 0.85rem 1rem; max-width: 280px; font-size: 0.88rem; color: #334155; white-space: pre-wrap;">${req.description || '-'}</td>
                                    <td style="padding: 0.85rem 1rem; font-size: 0.85rem; color: #475569;">
                                        <strong>${req.driver || '-'}</strong>
                                        ${(req.dept || req.phone) ? `<div style="font-size: 0.75rem; color: #64748b; margin-top: 0.15rem;">${[req.dept, req.phone].filter(Boolean).join(' • ')}</div>` : ''}
                                    </td>
                                    <td style="padding: 0.85rem 1rem; text-align: right; white-space: nowrap;">
                                        <button class="btn" style="background: #2563eb; color: white; padding: 0.35rem 0.7rem; font-size: 0.8rem; margin-right: 0.35rem; border: none; border-radius: 0.3rem; cursor: pointer;" onclick="downloadSavedRepairDocx('${vehicle.id}', '${req.id || ''}', ${reqIdx})" title="Riscarica il file Word precompilato">
                                            <i class="fa-solid fa-download"></i> Word
                                        </button>
                                        ${isAdmin ? `
                                        <button class="btn" style="background: var(--status-to-repair); color: white; padding: 0.35rem 0.65rem; font-size: 0.8rem; border: none; border-radius: 0.3rem; cursor: pointer;" onclick="deleteRepairRequest('${vehicle.id}', '${req.id || ''}', ${reqIdx})" title="Elimina richiesta">
                                            <i class="fa-solid fa-trash"></i>
                                        </button>
                                        ` : ''}
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            `;
        }

        modal.classList.remove('hidden');
    } catch (err) {
        console.error("Errore nell'apertura dello storico richieste:", err);
    }
};

window.closeVehicleRepairHistoryModal = function () {
    const modal = document.getElementById('vehicle-repair-history-modal');
    if (modal) {
        modal.classList.add('hidden');
    }
};

// ==========================================
// MODULO LAVAGGIO ESTERNO (STAMPATO WORD PARTS & SERVICES)
// NOTA: Non viene salvato nello storico richieste, serve unicamente come stampato da compilare
// ==========================================
window.createWashDocxBlob = async function (data) {
    if (!window.JSZip) {
        throw new Error("Libreria JSZip non caricata. Ricarica la pagina.");
    }
    if (!window.WASH_TEMPLATE_BASE64) {
        throw new Error("Template Word per Modulo Lavaggio non trovato. Ricarica la pagina.");
    }

    // 1. Carica il template base64 Modulo Lavaggio
    const zip = await JSZip.loadAsync(window.WASH_TEMPLATE_BASE64, { base64: true });

    // 2. Leggi word/document.xml
    const docXmlStr = await zip.file("word/document.xml").async("string");
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(docXmlStr, "application/xml");

    const nsW = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
    const paragraphs = xmlDoc.getElementsByTagNameNS ? xmlDoc.getElementsByTagNameNS(nsW, "p") : xmlDoc.getElementsByTagName("w:p");

    // 3. Popola Veicolo: cerca sdt o paragraph contenente 'Veicolo'
    const sdtElements = xmlDoc.getElementsByTagNameNS ? xmlDoc.getElementsByTagNameNS(nsW, "sdt") : xmlDoc.getElementsByTagName("w:sdt");
    let vehicleReplaced = false;
    for (let i = 0; i < sdtElements.length; i++) {
        const sdt = sdtElements[i];
        const sdtContent = sdt.getElementsByTagNameNS ? sdt.getElementsByTagNameNS(nsW, "sdtContent") : sdt.getElementsByTagName("w:sdtContent");
        if (sdtContent.length > 0) {
            const wtNodes = sdtContent[0].getElementsByTagNameNS ? sdtContent[0].getElementsByTagNameNS(nsW, "t") : sdtContent[0].getElementsByTagName("w:t");
            if (wtNodes.length > 0) {
                wtNodes[0].textContent = (data.targa || 'AMBULANZA').trim();
                for (let j = 1; j < wtNodes.length; j++) {
                    wtNodes[j].textContent = '';
                }
                vehicleReplaced = true;
                break;
            }
        }
    }
    if (!vehicleReplaced && paragraphs.length > 13) {
        const p13 = paragraphs[13];
        const tNodes = p13.getElementsByTagNameNS ? p13.getElementsByTagNameNS(nsW, "t") : p13.getElementsByTagName("w:t");
        if (tNodes.length > 0) {
            tNodes[tNodes.length - 1].textContent = (data.targa || 'AMBULANZA').trim();
        }
    }

    // 4. Popola Km e Officina
    for (let i = 0; i < paragraphs.length; i++) {
        const p = paragraphs[i];
        const tNodes = p.getElementsByTagNameNS ? p.getElementsByTagNameNS(nsW, "t") : p.getElementsByTagName("w:t");
        let pText = "";
        for (let j = 0; j < tNodes.length; j++) pText += tNodes[j].textContent;
        if (pText.includes("ricoverato") || pText.includes("l'officina") || pText.includes("Km:")) {
            for (let j = 0; j < tNodes.length; j++) {
                if (tNodes[j].textContent.includes("CAVAGION") || (j > 0 && tNodes[j - 1].textContent.includes("l'officina"))) {
                    tNodes[j].textContent = " " + (data.station || 'CAVAGION').trim() + " ";
                }
            }
            if (data.km) {
                for (let j = 0; j < tNodes.length; j++) {
                    if (tNodes[j].textContent.includes("Km:")) {
                        if (j + 1 < tNodes.length) {
                            tNodes[j + 1].textContent = "  " + data.km + "  ";
                        }
                    }
                }
            }
        }
    }

    // 5. Popola Intervento (LAVAGGIO ESTERNO oppure LAVAGGIO ESTERNO E INTERNO)
    const washDesc = (data.description || 'LAVAGGIO ESTERNO').trim();
    for (let i = 0; i < paragraphs.length; i++) {
        const p = paragraphs[i];
        const tNodes = p.getElementsByTagNameNS ? p.getElementsByTagNameNS(nsW, "t") : p.getElementsByTagName("w:t");
        let pText = "";
        for (let j = 0; j < tNodes.length; j++) pText += tNodes[j].textContent;
        if (pText.includes("interventi:") || pText.includes("LAVAGGIO")) {
            for (let j = 0; j < tNodes.length; j++) {
                if (tNodes[j].textContent.includes("LAVAGGIO ESTERNO") || tNodes[j].textContent.includes("LAVAGGIO")) {
                    tNodes[j].textContent = washDesc;
                    for (let k = j + 1; k < tNodes.length; k++) {
                        if (tNodes[k].textContent.trim().startsWith("ESTERNO") || tNodes[k].textContent.trim().startsWith("SANIFICAZIONE") || tNodes[k].textContent.trim().startsWith("INTERNO")) {
                            tNodes[k].textContent = "";
                        }
                    }
                }
            }
        }
    }

    // 6. Popola Driver / Nome Cognome (P[24] e P[34])
    if (data.driver) {
        if (paragraphs.length > 24) {
            const p24 = paragraphs[24];
            const tNodes24 = p24.getElementsByTagNameNS ? p24.getElementsByTagNameNS(nsW, "t") : p24.getElementsByTagName("w:t");
            if (tNodes24.length > 0) {
                tNodes24[0].textContent = "        " + data.driver;
                for (let j = 1; j < tNodes24.length; j++) tNodes24[j].textContent = "";
            }
        }
        if (paragraphs.length > 34) {
            const p34 = paragraphs[34];
            const tNodes34 = p34.getElementsByTagNameNS ? p34.getElementsByTagNameNS(nsW, "t") : p34.getElementsByTagName("w:t");
            if (tNodes34.length > 0) {
                tNodes34[0].textContent = "        " + data.driver;
                for (let j = 1; j < tNodes34.length; j++) tNodes34[j].textContent = "";
            }
        }
    }

    // 7. Popola Indirizzo Email (P[25] e P[35])
    if (data.email) {
        for (let i = 0; i < paragraphs.length; i++) {
            const p = paragraphs[i];
            const tNodes = p.getElementsByTagNameNS ? p.getElementsByTagNameNS(nsW, "t") : p.getElementsByTagName("w:t");
            for (let j = 0; j < tNodes.length; j++) {
                if (tNodes[j].textContent.includes("logistica118fe@ausl.fe.it") || tNodes[j].textContent.includes("@")) {
                    tNodes[j].textContent = data.email.trim();
                }
            }
        }
    }

    // 8. Popola Nr. Cellulare (P[27] e P[37])
    if (data.phone) {
        for (let i = 0; i < paragraphs.length; i++) {
            const p = paragraphs[i];
            const tNodes = p.getElementsByTagNameNS ? p.getElementsByTagNameNS(nsW, "t") : p.getElementsByTagName("w:t");
            for (let j = 0; j < tNodes.length; j++) {
                if (tNodes[j].textContent.includes("3209229345")) {
                    tNodes[j].textContent = tNodes[j].textContent.replace("3209229345", data.phone.trim());
                }
            }
        }
    }

    // 9. Popola Data (P[29] e P[39])
    if (data.date) {
        let dateVal = data.date;
        if (dateVal.includes('-')) {
            const p = dateVal.split('-');
            if (p.length === 3) dateVal = `${p[2]}/${p[1]}/${p[0]}`;
        }
        const parts = dateVal.split('/');
        const day = (parts[0] || '29').padStart(2, '0');
        const month = (parts[1] || '01').padStart(2, '0');
        const year = (parts[2] || '2026');
        const yy = year.length === 4 ? year.slice(-2) : year;

        for (let i = 0; i < paragraphs.length; i++) {
            const p = paragraphs[i];
            const tNodes = p.getElementsByTagNameNS ? p.getElementsByTagNameNS(nsW, "t") : p.getElementsByTagName("w:t");
            let pText = "";
            for (let j = 0; j < tNodes.length; j++) pText += tNodes[j].textContent;
            if (pText.includes("data:") && pText.includes("Firma")) {
                for (let j = 0; j < tNodes.length; j++) {
                    if (tNodes[j].textContent === "2" && j + 1 < tNodes.length && tNodes[j + 1].textContent === "9") {
                        tNodes[j].textContent = day[0] || '';
                        tNodes[j + 1].textContent = day[1] || '';
                    } else if (tNodes[j].textContent === "01") {
                        tNodes[j].textContent = month;
                    } else if (tNodes[j].textContent === "26") {
                        tNodes[j].textContent = yy;
                    }
                }
            }
        }
    }

    // 10. Serializza l'XML aggiornato
    const serializer = new XMLSerializer();
    const updatedXmlStr = serializer.serializeToString(xmlDoc);
    zip.file("word/document.xml", updatedXmlStr);

    // 11. Genera il blob del file .docx
    return await zip.generateAsync({
        type: "blob",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        compression: "DEFLATE"
    });
};

window.openWashModal = async function (vehicleId) {
    try {
        if (!cachedVehicles) {
            cachedVehicles = await store.getVehicles();
        }
        const vehicle = vehicleId ? (cachedVehicles.find(v => v.id === vehicleId) || await store.getVehicleById(vehicleId)) : cachedVehicles[0];
        if (!vehicle) {
            alert("Dati veicolo non trovati.");
            return;
        }
        window.currentWashVehicleId = vehicle.id;

        // Formato veicolo come nello stampato ufficiale: AMBULANZA <TARGA> <SIGLA>
        const parts = ['AMBULANZA'];
        if (vehicle.plate) parts.push(vehicle.plate);
        if (vehicle.sigla) parts.push(vehicle.sigla);
        const vehicleStr = parts.join(' ');

        const displayElem = document.getElementById('wash-vehicle-display');
        if (displayElem) displayElem.value = vehicleStr;

        const stationElem = document.getElementById('wash-station');
        if (stationElem) stationElem.value = 'IP VIA CANAPA';

        const kmElem = document.getElementById('wash-km');
        if (kmElem) kmElem.value = vehicle.km || vehicle.mileage || '';

        const dateElem = document.getElementById('wash-date');
        if (dateElem) dateElem.value = getLocalISODate();

        // Selezione predefinita: LAVAGGIO ESTERNO
        const radEsterno = document.getElementById('wash-type-esterno');
        if (radEsterno) radEsterno.checked = true;
        const radCompleto = document.getElementById('wash-type-completo');
        if (radCompleto) radCompleto.checked = false;

        const driverElem = document.getElementById('wash-driver');
        if (driverElem) driverElem.value = 'MARSILI PAOLO – GAMBERONI FEDERICO – MARCHESINI LUCA';

        const phoneElem = document.getElementById('wash-phone');
        if (phoneElem) phoneElem.value = '3209229345';

        const emailElem = document.getElementById('wash-email');
        if (emailElem) emailElem.value = 'logistica118fe@ausl.fe.it';

        const modal = document.getElementById('wash-modal');
        if (modal) modal.classList.remove('hidden');
    } catch (err) {
        console.error("Errore nell'apertura del modulo lavaggio:", err);
    }
};

window.closeWashModal = function () {
    const modal = document.getElementById('wash-modal');
    if (modal) modal.classList.add('hidden');
};

window.printWashModule = async function () {
    try {
        const escapeHtml = (str) => {
            if (!str) return '';
            return String(str)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#039;');
        };

        const vehicleId = window.currentWashVehicleId || currentOpenedVehicleId;
        let vehicle = (cachedVehicles && cachedVehicles.find(v => v.id === vehicleId));
        if (!vehicle && vehicleId && window.store) {
            try {
                vehicle = await store.getVehicleById(vehicleId);
            } catch (e) {}
        }

        // Leggi i valori inseriti/modificati nel modale
        const displayElem = document.getElementById('wash-vehicle-display');
        const targa = (displayElem && displayElem.value ? displayElem.value.trim() : (vehicle ? `AMBULANZA ${vehicle.plate || ''} ${vehicle.sigla || ''}`.trim() : 'AMBULANZA'));

        const stationElem = document.getElementById('wash-station');
        const station = (stationElem && stationElem.value ? stationElem.value.trim() : 'IP VIA CANAPA');

        const kmElem = document.getElementById('wash-km');
        const km = (kmElem && kmElem.value ? kmElem.value.trim() : (vehicle ? (vehicle.km || vehicle.mileage || '') : ''));

        const dateElem = document.getElementById('wash-date');
        let rawDate = (dateElem && dateElem.value ? dateElem.value.trim() : '');
        let dateVal = rawDate;
        if (rawDate && rawDate.includes('-')) {
            const p = rawDate.split('-');
            if (p.length === 3) dateVal = `${p[2]}/${p[1]}/${p[0]}`;
        }
        if (!dateVal) {
            const now = new Date();
            dateVal = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;
        }

        const driverElem = document.getElementById('wash-driver');
        const driver = (driverElem && driverElem.value ? driverElem.value.trim() : 'MARSILI PAOLO – GAMBERONI FEDERICO – MARCHESINI LUCA');

        const phoneElem = document.getElementById('wash-phone');
        const phone = (phoneElem && phoneElem.value ? phoneElem.value.trim() : '3209229345');

        const emailElem = document.getElementById('wash-email');
        const email = (emailElem && emailElem.value ? emailElem.value.trim() : 'logistica118fe@ausl.fe.it');

        const isCompleto = document.getElementById('wash-type-completo') && document.getElementById('wash-type-completo').checked;
        const description = isCompleto ? 'LAVAGGIO ESTERNO E INTERNO' : 'LAVAGGIO ESTERNO';

        const dParts = dateVal.split('/');
        const day = (dParts[0] || '29').padStart(2, '0');
        const month = (dParts[1] || '01').padStart(2, '0');
        const yearFull = (dParts[2] || '2026');
        const yy = yearFull.length === 4 ? yearFull.slice(-2) : yearFull;

        // Estrai il logo dal template docx base64
        let logoB64 = '';
        if (window.JSZip && window.WASH_TEMPLATE_BASE64) {
            try {
                const zip = await JSZip.loadAsync(window.WASH_TEMPLATE_BASE64, { base64: true });
                const img = zip.file("word/media/image1.png");
                if (img) logoB64 = await img.async("base64");
            } catch (e) {
                console.warn("Logo extraction error:", e);
            }
        }
        const logoImgTag = logoB64 ? `<img src="data:image/png;base64,${logoB64}" style="height: 70px; object-fit: contain; margin-bottom: 4px;" alt="Logo Parts & Services">` : '';

        const htmlContent = `<!DOCTYPE html>
<html lang="it">
<head>
    <meta charset="UTF-8">
    <title>Modulo Lavaggio - ${escapeHtml(targa)}</title>
    <style>
        @page {
            size: A4 portrait;
            margin: 15mm 20mm 15mm 20mm;
        }
        * {
            box-sizing: border-box;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
        }
        body {
            font-family: Verdana, Geneva, Tahoma, sans-serif;
            color: #000;
            margin: 0;
            padding: 0;
            background: #fff;
            font-size: 11pt;
            line-height: 1.5;
        }
        .header-section {
            margin-bottom: 24px;
        }
        .title-ps {
            font-size: 17pt;
            font-weight: bold;
            color: #000;
            letter-spacing: 0.5px;
            margin-top: 2px;
            margin-bottom: 2px;
        }
        .slogan-ps {
            font-size: 10pt;
            color: #222;
            margin-bottom: 20px;
        }
        .oggetto-line {
            font-size: 11.5pt;
            font-weight: bold;
            margin-bottom: 14px;
            color: #000;
        }
        .spett-line {
            font-size: 11pt;
            margin-bottom: 14px;
            color: #000;
        }
        .scrivere-line {
            font-size: 9.5pt;
            font-style: italic;
            color: #444;
            margin-bottom: 22px;
        }
        .statement-p {
            font-size: 11pt;
            margin-bottom: 14px;
            line-height: 1.6;
        }
        .val-bold {
            font-weight: bold;
        }
        .signature-block {
            margin-top: 20px;
            margin-bottom: 20px;
        }
        .sig-header {
            font-size: 11.5pt;
            font-weight: bold;
            margin-bottom: 8px;
        }
        .sig-names-label {
            font-size: 10.5pt;
            color: #333;
            margin-bottom: 4px;
        }
        .sig-names-val {
            font-size: 11pt;
            font-weight: bold;
            padding-left: 30px;
            margin-bottom: 8px;
        }
        .sig-contact {
            font-size: 10.5pt;
            margin-bottom: 6px;
        }
        .sig-date-row {
            font-size: 10.5pt;
            display: flex;
            justify-content: space-between;
            align-items: baseline;
            margin-top: 8px;
        }
        .footer-line {
            text-align: center;
            margin-top: 40px;
            font-size: 8.5pt;
            color: #333;
            line-height: 1.4;
        }
    </style>
</head>
<body>
    <div class="header-section">
        ${logoImgTag}
        <div class="title-ps">PARTS &amp; SERVICES</div>
        <div class="slogan-ps">Hard for your need</div>
    </div>

    <div class="oggetto-line">
        OGGETTO: Ricovero Veicolo per manutenzione - consegna/ Ritiro
    </div>

    <div class="spett-line">
        Spett: AZIENDA U.S.L. FERRARA Via Arturo Cassoli, 30 44121- FERRARA
    </div>

    <div class="scrivere-line">
        Scrivere in modo chiaro e leggibile
    </div>

    <div class="statement-p">
        Si comunica che il Veicolo: &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; <span class="val-bold">${escapeHtml(targa)}</span>
    </div>

    <div class="statement-p">
        Km: &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; è stato ricoverato presso l'officina: <span class="val-bold">${escapeHtml(station)}</span>
    </div>

    <div class="statement-p" style="margin-bottom: 24px;">
        per svolgere i seguenti interventi: &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; <span class="val-bold">${escapeHtml(description)}</span>
    </div>

    <!-- Sezione Consegna -->
    <div class="signature-block">
        <div class="sig-header">Consegna il veicolo:</div>
        <div class="sig-names-label">Nome &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; Cognome</div>
        <div class="sig-names-val">${escapeHtml(driver)}</div>
        <div class="sig-contact">Indirizzo e-mail: <span class="val-bold">${escapeHtml(email)}</span></div>
        <div class="sig-contact">Nr. Cell.: <span class="val-bold">${escapeHtml(phone)}</span></div>
        <div class="sig-date-row">
            <span>data: …${day}...../…..${month}.../…….${yy}....</span>
            <span>Firma _________________________________</span>
        </div>
    </div>

    <!-- Sezione Ritiro -->
    <div class="signature-block" style="margin-top: 24px;">
        <div class="sig-header">Ritira il veicolo:</div>
        <div class="sig-names-label">Nome &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; Cognome</div>
        <div class="sig-names-val">${escapeHtml(driver)}</div>
        <div class="sig-contact">Indirizzo e-mail: <span class="val-bold">${escapeHtml(email)}</span></div>
        <div class="sig-contact">Nr. Cell.: <span class="val-bold">${escapeHtml(phone)}</span></div>
        <div class="sig-date-row">
            <span>data: …${day}…../…${month}...../….${yy}…....</span>
            <span>Firma _________________________________</span>
        </div>
    </div>

    <div class="footer-line">
        PARTS &amp; SERVICES - Via Pollenzo, 28 - 00166 Roma<br>
        info@parts-services.it - www.parts-services.it - Tel. +39 0692936934
    </div>
</body>
</html>`;

        // Utilizzo di iframe invisibile per avviare la stampa nativa
        let printFrame = document.getElementById('wash-print-iframe');
        if (printFrame && printFrame.parentNode) {
            printFrame.parentNode.removeChild(printFrame);
        }
        printFrame = document.createElement('iframe');
        printFrame.id = 'wash-print-iframe';
        printFrame.style.position = 'fixed';
        printFrame.style.top = '-9999px';
        printFrame.style.left = '-9999px';
        printFrame.style.width = '1024px';
        printFrame.style.height = '1024px';
        printFrame.style.border = '0';
        printFrame.style.opacity = '0';
        printFrame.style.pointerEvents = 'none';
        document.body.appendChild(printFrame);

        const frameDoc = printFrame.contentWindow ? printFrame.contentWindow.document : printFrame.contentDocument;
        frameDoc.open();
        frameDoc.write(htmlContent);
        frameDoc.close();

        setTimeout(() => {
            try {
                printFrame.contentWindow.focus();
                printFrame.contentWindow.print();
            } catch (err) {
                console.warn("Stampa via iframe non disponibile, apertura finestra:", err);
                const win = window.open('', '_blank');
                if (win) {
                    win.document.write(htmlContent);
                    win.document.close();
                    win.focus();
                    win.print();
                }
            }
        }, 350);

        // Chiudi il modal lavaggio
        window.closeWashModal();
    } catch (err) {
        console.error("Errore durante la stampa del modulo lavaggio:", err);
        alert("Errore durante la preparazione per la stampa: " + (err.message || err));
    }
};

window.generateAndDownloadWashDocx = async function () {
    try {
        const vehicleId = window.currentWashVehicleId || currentOpenedVehicleId;
        const vehicle = (cachedVehicles && cachedVehicles.find(v => v.id === vehicleId)) || (vehicleId ? await store.getVehicleById(vehicleId) : null);

        const targa = (document.getElementById('wash-vehicle-display').value || '').trim() || (vehicle ? `AMBULANZA ${vehicle.plate || ''} ${vehicle.sigla || ''}`.trim() : 'AMBULANZA');
        const station = (document.getElementById('wash-station').value || 'IP VIA CANAPA').trim();
        const km = (document.getElementById('wash-km').value || '').trim();
        const rawDate = (document.getElementById('wash-date').value || '').trim();
        let dateVal = rawDate;
        if (rawDate && rawDate.includes('-')) {
            const p = rawDate.split('-');
            if (p.length === 3) dateVal = `${p[2]}/${p[1]}/${p[0]}`;
        }
        if (!dateVal) {
            const now = new Date();
            dateVal = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;
        }

        const driver = (document.getElementById('wash-driver').value || '').trim();
        const phone = (document.getElementById('wash-phone').value || '').trim();
        const email = (document.getElementById('wash-email').value || '').trim();

        // Tipologia di intervento: esclusivamente l'opzione selezionata tra le 2 disponibili
        const isCompleto = document.getElementById('wash-type-completo') && document.getElementById('wash-type-completo').checked;
        const description = isCompleto ? 'LAVAGGIO ESTERNO E INTERNO' : 'LAVAGGIO ESTERNO';

        let filenameInput = (document.getElementById('wash-filename').value || '').trim();
        let filename = filenameInput || ('modulo lavaggio ' + (vehicle ? `${vehicle.sigla || ''} ${vehicle.plate || ''}`.trim() : '')).trim();
        filename = filename.replace(/[\\/:*?"<>|]/g, "_");
        if (!filename.toLowerCase().endsWith(".docx")) {
            filename += ".docx";
        }

        const washData = {
            targa: targa,
            station: station,
            km: km,
            date: dateVal,
            driver: driver,
            phone: phone,
            email: email,
            description: description,
            is_wash: true,
            is_alea: true
        };

        // Genera Blob dal template Word Parts & Services (Modulo Lavaggio)
        const blob = await window.createWashDocxBlob(washData);
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        // Chiudi il modal
        window.closeWashModal();

        // NOTA FONDAMENTALE: Non viene effettuato alcun salvataggio nello storico veicolo né su Firestore!
    } catch (err) {
        console.error("Errore generazione modulo lavaggio:", err);
        alert("Errore nella generazione dello stampato Word: " + (err.message || err));
    }
};
