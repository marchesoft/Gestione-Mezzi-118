const APP_VERSION = "3.0.1";
let isAdmin = false;
let cachedVehicles = null;
let cachedLocations = null;
let currentOpenedVehicleId = null;
let lastRefreshTime = new Date();
let currentFilter = 'all';

// Helper to ensure strings are uppercase
const upper = (str) => (str || '').toString().toUpperCase().trim();

// Helper to format date strings from YYYY-MM-DD to DD/MM/YYYY
function formatDate(dateStr) {
    if (!dateStr) return '';
    const [year, month, day] = dateStr.split('-');
    return `${day}/${month}/${year}`;
}

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
        const tempDismissed = window.dismissedAlerts && window.dismissedAlerts.has(vehicle.id);

        const showOverlay = (isToday || isTomorrow) && !tempDismissed;
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
                ${hasCheckThisMonth ? '<div class="monthly-check-dot" title="Controllo Mensile Effettuato"></div>' : ''}
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
        // Con overlay attivo: mostriamo solo le note pure (non il testo appuntamento)
        // posizionate sopra l'overlay tramite CSS (.has-alert .mobile-notes)
        const mobileNotesContent = showOverlay ? pureNotes : noteContent;

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
                    openVehicleModal(id);
                }
            }).catch(err => {
                console.error("Failed to update todo note:", err);
                alert("Errore salvataggio nota da fare.");
            });
            renderDashboard(false);
        }
    }
}

// Set degli overlay chiusi temporaneamente (si resetta al riavvio)
if (!window.dismissedAlerts) {
    window.dismissedAlerts = new Set();
}

window.dismissAlert = function (event, vehicleId) {
    if (event) {
        event.stopPropagation();
        event.preventDefault();
    }
    window.dismissedAlerts.add(vehicleId);
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
};

window.deleteTodoNote = async function (event, id, noteIndex) {
    event.stopPropagation();
    if (!isAdmin) return;
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
            if (document.getElementById('vehicle-todo-notes')) {
                const todoVal = Array.isArray(vehicle.todo_notes) ? vehicle.todo_notes.join('\n') : (vehicle.todo_notes || '');
                document.getElementById('vehicle-todo-notes').value = todoVal;
            }
        }
    } else {
        title.textContent = 'Aggiungi Nuovo Mezzo';
        document.getElementById('vehicle-mileage-month').value = ''; // Reset
        document.getElementById('vehicle-station').value = '';
        document.getElementById('vehicle-type').value = 'Ambulanza';
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
        if (event.target === cambioModal) cambioModal.classList.add('hidden');
        if (event.target === adminModal) adminModal.classList.add('hidden');
        if (event.target === notesModal) closeOperationalNotesModal();
    }
}

window.addLocationHandler = async function (e) {
    if (e && e.preventDefault) e.preventDefault();
    const name = prompt("Nome del nuovo luogo:");
    if (!name) return;
    const color = "#3b82f6";
    try {
        await store.addLocation(upper(name), color);
        // Refresh directly
        await renderDashboard(true);
        if (!document.getElementById('data-management-modal').classList.contains('hidden')) {
            switchDataTable('locations');
        }
    } catch (err) {
        console.error("Error adding location:", err);
    }
};

window.editLocationHandler = async function (oldName) {
    const newName = prompt("Inserisci il nuovo nome per questo luogo:", oldName);
    if (!newName || newName.trim() === '' || upper(newName) === upper(oldName)) return;

    try {
        await store.updateLocation(upper(oldName), upper(newName));
        // Refresh dashboard to reflect station changes in vehicle cards
        await renderDashboard(true);
        if (!document.getElementById('data-management-modal').classList.contains('hidden')) {
            switchDataTable('locations');
        }
        console.log("Luogo aggiornato con successo!");
    } catch (err) {
        console.error("Error editing location:", err);
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
    const todoNotesEl = document.getElementById('vehicle-todo-notes');
    const todo_notes_raw = todoNotesEl ? todoNotesEl.value : '';
    const todo_notes = todo_notes_raw.split('\n').map(s => s.trim()).map(upper).filter(s => s !== '');

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

        inspection_expiry: inspection_expiry || null,
        revision_o2: revision_o2 || null,
        notes: upper(notes),
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
    const vehicle = await store.getVehicleById(id);
    if (!vehicle) return;

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
                                <div style="display: flex; gap: 0.75rem; align-items: baseline; margin-bottom: 0.25rem;">
                                    ${vehicle.sigla ? `<h1 style="font-size: 1.5rem; font-weight: 800; color: var(--primary-color); margin: 0;">${vehicle.sigla}</h1>` : ''}
                                    <h1 style="font-size: 1.5rem; font-weight: 800; color: var(--text-primary); margin: 0;">${vehicle.plate}</h1>
                                </div>
                                <div style="display: flex; gap: 0.5rem; align-items: center;">
                                    <h2 style="font-size: 1.1rem; margin: 0; color: var(--text-secondary); font-weight: 600;">${vehicle.model}</h2>
                                    <span style="color: var(--border-color);">|</span>
                                    <span style="color: var(--text-secondary); font-weight: 500; font-size: 0.9rem;">${vehicle.type}</span>
                                </div>
                            </div>
                        </div>
                        ${isAdmin ? `<div style="text-align: right; display: flex; gap: 0.5rem; flex-wrap: wrap;">
                            <button class="btn btn-primary" style="padding: 0.4rem 0.8rem; font-size: 0.85rem;" onclick="openVehicleForm('${vehicle.id}')"><i class="fa-solid fa-pen"></i> Modifica</button>
                        </div>` : ''}
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
                                        ${vehicle.appointment_location ? `<span style="font-weight: 400; font-size: 0.9rem; margin-left: 0.5rem;">(${vehicle.appointment_location})</span>` : ''}
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
                                        <button class="btn" style="padding: 0.4rem 0.6rem; background: #ef4444; color: white; flex-shrink: 0;" onclick="if(confirm('Annullare l\\\'appuntamento corrente?')) { document.getElementById('admin-appointment-input').value = ''; document.getElementById('admin-appointment-location').value = ''; saveVehicleAppointment('${vehicle.id}', '', ''); }" title="Cancella appuntamento">
                                            <i class="fa-solid fa-trash"></i>
                                        </button>
                                    </div>
                                    <select id="admin-appointment-location" style="padding: 0.4rem; border: 1px solid #1e3a8a; border-radius: 0.4rem; font-size: 0.9rem; width: 100%;">
                                        <option value="">Seleziona Luogo...</option>
                                        ${cachedLocations.map(loc => `<option value="${loc.luogo}" ${vehicle.appointment_location === loc.luogo ? 'selected' : ''}>${loc.luogo}</option>`).join('')}
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
                                        <div style="font-size: 0.75rem; text-transform: uppercase; color: #0f766e; font-weight: 800; margin-bottom: 0.1rem;">Controllo Mensile</div>
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
                                            <button class="btn btn-register-check" 
                                                    onclick="saveMonthlyCheck('${vehicle.id}', document.getElementById('admin-monthly-check-date').value, document.getElementById('admin-monthly-check-notes').value, document.getElementById('admin-monthly-check-executor').value, document.getElementById('admin-monthly-check-location').value)">
                                                <span class="btn-text-desktop">Registra Controllo</span>
                                                <span class="btn-text-mobile">Registra</span>
                                            </button>
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
                                <i class="fa-solid fa-clipboard-list" style="font-size: 1rem;"></i> Segna le cose da fare
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
    if (confirm('Sei sicuro di voler eliminare questo veicolo?')) {
        await store.deleteVehicle(id);
        document.getElementById('vehicle-modal').classList.add('hidden');
        await renderDashboard();
    }
}

window.deleteMaintenanceRecord = async function (recordId, vehicleId) {
    if (confirm('Eliminare questo record?')) {
        await store.deleteIntervention(recordId);
        await openVehicleModal(vehicleId);
    }
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
            vehicle.appointment_location = upper(location) || null;
            vehicle.alert_ack_date = null; // Reset ack for new appointment
            await store.updateVehicle(vehicle);
            alert("Appuntamento aggiornato.");
            // Refresh detail modal and dashboard
            openVehicleModal(id);
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
            alert("Controllo mensile registrato.");
            openVehicleModal(id);
            renderDashboard(true);
        }
    } catch (error) {
        console.error("Error saving monthly check:", error);
        alert("Errore durante il salvataggio del controllo mensile.");
    }
}

window.deleteMonthlyCheckFromDb = async function (id, date, notes, executor, location) {
    if (!confirm("Eliminare questa registrazione di controllo?")) return;
    try {
        const vehicle = await store.getVehicleById(id);
        if (vehicle && vehicle.monthly_checks) {
            const idx = vehicle.monthly_checks.findIndex(c => 
                c.date === date && 
                (c.notes || '') === (notes || '') && 
                (c.executor || '') === (executor || '') && 
                (c.location || '') === (location || '')
            );
            if (idx !== -1) {
                vehicle.monthly_checks.splice(idx, 1);
                await store.updateVehicle(vehicle);
                alert("Controllo eliminato.");
                switchDataTable('controlli');
                renderDashboard(true);
            } else {
                alert("Controllo non trovato nel database.");
            }
        }
    } catch (e) {
        console.error("Error deleting monthly check:", e);
        alert("Errore durante l'eliminazione del controllo.");
    }
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
            'controlli': 'Controlli_Mensili'
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
        }

        if (!data || data.length === 0) {
            alert("Nessun dato da esportare.");
            return;
        }

        let headers = [];
        let csvRows = [];

        // Mapping for headers
        if (type === 'vehicles') {
            headers = ['id', 'plate', 'model', 'sigla', 'station', 'status', 'mileage', 'mileage_month', 'notes', 'radio_id', 'inspection_expiry', 'revision_o2'];
            const italianHeaders = ['ID (Non modificare)', 'Targa', 'Modello', 'Sigla', 'Stazione', 'Stato', 'Km', 'Mese Km', 'Note', 'Radio ID', 'Scadenza Revisione', 'Revisione O2'];
            csvRows.push(italianHeaders.join(';'));
        } else if (type === 'locations') {
            headers = ['luogo', 'colore'];
            const italianHeaders = ['Luogo', 'Colore'];
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
                        'Colore': 'colore', 'colore': 'colore'
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
                            if (dbField === 'mileage' || dbField === 'cost') val = parseFloat(val) || 0;

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
                <div style="margin-bottom: 1.5rem; background: #f8fafc; padding: 1rem; border-radius: 0.75rem; border: 1px solid var(--border-color); display: flex; justify-content: space-between; align-items: center; gap: 1rem;">
                    <h4 style="font-size: 0.9rem;">Elenco Luoghi</h4>
                    ${isAdmin ? `
                    <div style="display: flex; gap: 0.5rem; align-items: center;">
                        <button class="btn btn-export" onclick="exportCurrentTableToCSV()" style="white-space: nowrap;">
                            <i class="fa-solid fa-file-excel"></i> Esporta Excel
                        </button>
                        <button class="btn btn-export" onclick="importDataTableFromCSV()" style="white-space: nowrap; background-color: #065f46;">
                            <i class="fa-solid fa-file-import"></i> Importa Excel
                        </button>
                        <button class="btn btn-primary" onclick="window.addLocationHandler();" style="padding: 0.5rem 1rem;"><i class="fa-solid fa-plus"></i> Nuovo Luogo</button>
                    </div>
                    ` : ''}
                </div>
                <div style="overflow-x: auto;">
                    <table class="mgmt-table">
                        <thead>
                            <tr>
                                <th>Luogo</th>
                                ${isAdmin ? '<th class="col-actions">Azioni</th>' : ''}
                            </tr>
                        </thead>
                        <tbody>
                            ${data.map(l =>
                '<tr>'
                + `<td>${l.luogo}</td>`
                + (isAdmin ? '<td class="col-actions">'
                    + `<button onclick="window.editLocationHandler('${l.luogo}')" style="margin-right:0.5rem; cursor:pointer; background:none; border:none; color:var(--primary-color);"><i class="fa-solid fa-edit"></i></button>`
                    + `<button onclick="if(confirm('Eliminare questo luogo?')){store.deleteLocation('${l.luogo}').then(() => switchDataTable('locations'))}" style="cursor:pointer; background:none; border:none; color:var(--status-to-repair);"><i class="fa-solid fa-trash"></i></button>`
                    + '</td>' : '') + '</tr>'
            ).join('')}
                        </tbody>
                    </table>
                </div>`;
        } else if (type === 'interventions') {
            data = await store.getInterventions();
            html = `
                <div style="margin-bottom: 1rem; background: #f8fafc; padding: 1rem; border-radius: 0.75rem; border: 1px solid var(--border-color); display: flex; gap: 1rem; align-items: center;">
                    <div style="flex-grow: 1; position: relative;">
                        <i class="fa-solid fa-search" style="position: absolute; left: 1rem; top: 50%; transform: translateY(-50%); color: var(--text-secondary);"></i>
                        <input type="text" id="intervention-search" placeholder="Filtra per Mezzo (Sigla)..." 
                               oninput="window.filterInterventionTable(this.value)"
                               style="width: 100%; padding: 0.5rem 1rem 0.5rem 2.5rem; border-radius: 0.5rem; border: 1px solid var(--border-color); outline: none;">
                    </div>
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
                    + `<button onclick="if(confirm('Eliminare questo intervento?')){store.deleteIntervention('${i.id}').then(() => switchDataTable('interventions'))}" style="cursor:pointer; background:none; border:none; color:var(--status-to-repair);"><i class="fa-solid fa-trash"></i></button>`
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
                    + `<button onclick="if(confirm('Eliminare questo cambio?')){store.deleteCambioMezzo('${c.id}').then(() => switchDataTable('cambiomezzo'))}" style="cursor:pointer; background:none; border:none; color:var(--status-to-repair);"><i class="fa-solid fa-trash"></i></button>`
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
                        + `<button onclick="if(confirm('Eliminare questo contatto?')){store.deleteContact('${c.id}').then(() => switchDataTable('contacts'))}" style="cursor:pointer;background:none;border:none;color:var(--status-to-repair);" title="Elimina"><i class="fa-solid fa-trash"></i></button>`
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
        }
    } catch (e) {
        html = `<p style="color:red;">Errore caricamento dati: ${e.message}</p>`;
    }

    container.innerHTML = html;
}

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
