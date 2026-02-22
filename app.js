const APP_VERSION = "1.3.4 - 2026-02-22"; // Dynamic Contacts Management
let isAdmin = false;
let cachedVehicles = null;
let cachedLocations = null;
let currentOpenedVehicleId = null;

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
    await renderDashboard(true); // Force initial fetch
    setupRealtimeSubscription();
    setupIdleRefresh();

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

let isSyncing = false; // Prevents race conditions during fetch
let lastVehicleSync = Date.now();

function setupRealtimeSubscription() {
    if (window.store && window.store.supabase) {
        console.log("Realtime: Initializing subscriptions...");

        const handleStatusChange = (status, channelName) => {
            console.log(`Realtime: ${channelName} status:`, status);
            if (status === 'SUBSCRIBED') {
                console.log(`Realtime: ${channelName} active.`);
                // We used to call renderDashboard(true) here, but that causes 
                // race conditions if triggered too often. 
                // Initial load handles the first pull anyway.
            } else if (status === 'CHANNEL_ERROR' || status === 'CLOSED') {
                console.warn(`Realtime: ${channelName} connection lost (${status}). Auto-retrying...`);
                // Supabase JS client handles some retry internally, but we reinforce it.
            }
        };

        // Vehicles Subscription
        window.store.supabase
            .channel('public:vehicles')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'vehicles' }, (payload) => {
                console.log("Realtime event received:", payload.eventType, payload.new?.id || payload.old?.id);

                if (!cachedVehicles) return renderDashboard(true);

                if (payload.eventType === 'UPDATE') {
                    const idx = cachedVehicles.findIndex(v => v.id === payload.new.id);
                    if (idx !== -1) {
                        // Merge fields carefully to not lose maintenanceHistory if event payload is partial
                        // (Wait, REPLICA IDENTITY FULL should give us all columns)
                        const oldHistory = cachedVehicles[idx].maintenanceHistory || [];
                        cachedVehicles[idx] = { ...payload.new, maintenanceHistory: oldHistory };
                    } else {
                        // If not in cache, just refresh to be safe
                        return renderDashboard(true);
                    }
                } else if (payload.eventType === 'INSERT') {
                    if (!cachedVehicles.find(v => v.id === payload.new.id)) {
                        cachedVehicles.push({ ...payload.new, maintenanceHistory: [] });
                    }
                } else if (payload.eventType === 'DELETE') {
                    cachedVehicles = cachedVehicles.filter(v => v.id !== payload.old.id);
                    if (currentOpenedVehicleId === payload.old.id) closeVehicleModal();
                }

                sortVehiclesBySigla(cachedVehicles);
                updateStats(cachedVehicles);
                renderVehicleGrid(cachedVehicles);

                if (currentOpenedVehicleId === payload.new?.id) {
                    openVehicleModal(payload.new.id);
                }
            })
            .subscribe((status) => handleStatusChange(status, 'Vehicles'));

        // Interventions Subscription
        window.store.supabase
            .channel('public:interventions')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'interventions' }, (payload) => {
                // Interventions are deep-linked, trigger full refresh to sync maintenanceHistory
                renderDashboard(true);
            })
            .subscribe((status) => handleStatusChange(status, 'Interventions'));

        // Locations Subscription
        window.store.supabase
            .channel('public:locations')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'locations' }, (payload) => {
                renderDashboard(true);
            })
            .subscribe((status) => handleStatusChange(status, 'Locations'));

        // Cambi Mezzi Subscription
        window.store.supabase
            .channel('public:cambiomezzo')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'cambiomezzo' }, (payload) => {
                console.log("Realtime: Cambi Mezzi event received.");
                // If Data Management is open and showing Cambi, refresh it
                if (!document.getElementById('data-management-modal').classList.contains('hidden')) {
                    switchDataTable('cambiomezzo');
                }
            })
            .subscribe((status) => handleStatusChange(status, 'CambiMezzi'));
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
            cachedLocations = locations;
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
        renderVehicleGrid(cachedVehicles);

    } catch (err) {
        console.error("Dashboard render error:", err);
    } finally {
        isSyncing = false;
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

    if (!cachedVehicles) {
        await renderDashboard(true);
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
        'to-repair': 'Da Riparare'
    };
    return labels[status] || status;
}

async function renderVehicleGrid(vehicles) {
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
        const alreadyAcked = vehicle.alert_ack_date === todayStr;

        if ((isToday || isTomorrow) && !alreadyAcked) {
            alertHTML = `
                <div class="appointment-alert-overlay">
                    <div class="alert-title">${isToday ? 'OGGI' : 'DOMANI'} APPUNTAMENTO</div>
                    <div class="alert-subtitle">${vehicle.appointment_location || 'Luogo non specificato'}</div>
                    <button class="alert-ack-btn" onclick="acknowledgeAppointmentAlert(event, '${vehicle.id}')">PRESA VISIONE</button>
                </div>
            `;
        }

        // Status 
        const statusLabels = {
            'operative': 'In Servizio',
            'available': 'Disponibile',
            'maintenance': 'In Officina',
            'to-repair': 'Da Riparare'
        };

        let statusHtml = `
            <div style="position: relative; width: 100%;">
                ${isAdmin ? `
                    <select class="status-full-bar status-${vehicle.status}" onchange="quickUpdateStatus(event, '${vehicle.id}')" onclick="event.stopPropagation()">
                        <option value="operative" ${vehicle.status === 'operative' ? 'selected' : ''}>In Servizio</option>
                        <option value="available" ${vehicle.status === 'available' ? 'selected' : ''}>Disponibile</option>
                        <option value="maintenance" ${vehicle.status === 'maintenance' ? 'selected' : ''}>In Officina</option>
                        <option value="to-repair" ${vehicle.status === 'to-repair' ? 'selected' : ''}>Da Riparare</option>
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
        let noteContent = vehicle.notes || '';
        if (vehicle.appointment_date) {
            const locText = vehicle.appointment_location ? ` @ ${vehicle.appointment_location}` : '';
            const apptText = `APPUNTAMENTO: ${formatDate(vehicle.appointment_date)}${locText}`;
            noteContent = noteContent ? `${apptText}\n---\n${noteContent}` : apptText;
        }

        return `
            <div class="vehicle-card border-${vehicle.status}" 
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
                ${noteContent ? `<div class="note-tooltip">${noteContent}</div>` : ''}
                ${statusHtml}
                <div class="card-body">
                    <div class="vehicle-id" style="text-align: center; margin-bottom: 0.5rem; display: flex; flex-direction: column; gap: 0.1rem;">
                        ${vehicle.sigla ? `<div class="sigla-text">${vehicle.sigla}</div>` : ''}
                        <div class="model-text">${vehicle.model}</div>
                        <div class="plate-number">${vehicle.plate}</div>
                        <div class="km-text">KM: ${(parseInt(vehicle.mileage) || 0).toLocaleString()}</div>
                    </div>
                    <div class="card-actions" style="justify-content: center; flex-direction: column; align-items: center;">
                        ${locationHtml}
                        ${noteContent ? `<div class="mobile-notes">${noteContent.replace(/\n/g, '<br>')}</div>` : ''}
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
window.quickUpdateStatus = async function (event, id) {
    event.stopPropagation();
    const newStatus = event.target.value;
    const select = event.target;

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
        // Logout
        isAdmin = false;
        localStorage.removeItem('isAdmin'); // Remove from localStorage
        document.body.classList.remove('is-admin');
        document.getElementById('admin-lock-icon').className = 'fa-solid fa-lock';
        if (hintText) hintText.textContent = 'Modalita visualizzazione';
        alert("Modalità Amministratore Disattivata.");
        renderDashboard();
    } else {
        // Open Login Modal
        document.getElementById('admin-login-modal').classList.remove('hidden');
        document.getElementById('admin-password-input').focus();
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

    const modal = document.getElementById('vehicle-form-modal');
    const title = document.querySelector('#vehicle-form-modal h3');
    const form = document.getElementById('vehicle-form');

    form.reset();
    document.getElementById('vehicle-id').value = '';

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
        const vehicle = cachedVehicles.find(v => v.id === vehicleId);
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
        }
    } else {
        title.textContent = 'Aggiungi Nuovo Mezzo';
        document.getElementById('vehicle-mileage-month').value = ''; // Reset
        document.getElementById('vehicle-station').value = '';
        document.getElementById('vehicle-type').value = 'Ambulanza';
    }

    modal.classList.remove('hidden');
}

window.openCambioMezzoModal = async function (cambioId = null) {
    if (!isAdmin) return;

    const modal = document.getElementById('cambio-mezzo-modal');
    const form = document.getElementById('cambio-mezzo-form');
    const title = document.querySelector('#cambio-mezzo-modal h3');
    form.reset();
    document.getElementById('cambio-id').value = '';

    if (cambioId) {
        title.textContent = 'Modifica Cambio Mezzo';
        try {
            // We could fetch specifically or filter from a list if we had one cached. 
            // For now, let's fetch it from the store to be safe.
            const list = await store.getCambiMezzi();
            const cambio = list.find(c => c.id === cambioId);
            if (cambio) {
                document.getElementById('cambio-id').value = cambio.id;
                document.getElementById('cambio-data').value = cambio.data;
                document.getElementById('cambio-turno').value = cambio.turno;
                document.getElementById('cambio-luogo').value = cambio.luogo || '';
                document.getElementById('cambio-equipaggio').value = cambio.equipaggio || '';
                // Dropdowns will be populated below, we need to set values AFTER populating
                // But Dal/Al depend on cachedVehicles which is usually ready
            }
        } catch (error) {
            console.error("Error loading cambio data:", error);
        }
    } else {
        title.textContent = 'Registra Cambio Mezzo';
        document.getElementById('cambio-data').valueAsDate = new Date();
    }

    // Populate Luogo Dropdown
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

    // Populate Vehicle Selects (Sigle)
    const dalSelect = document.getElementById('cambio-dal-mezzo');
    const alSelect = document.getElementById('cambio-al-mezzo');

    dalSelect.innerHTML = '<option value="">-- Seleziona --</option>';
    alSelect.innerHTML = '<option value="">-- Seleziona --</option>';

    if (cachedVehicles) {
        // Filter out vehicles without sigla and sort them
        const vehiclesWithSigla = cachedVehicles.filter(v => v.sigla).sort((a, b) => a.sigla.localeCompare(b.sigla));

        vehiclesWithSigla.forEach(v => {
            const option = document.createElement('option');
            option.value = v.sigla;
            option.textContent = v.sigla;
            dalSelect.appendChild(option.cloneNode(true));
            alSelect.appendChild(option);
        });
    }

    // Set values if editing
    const cambioIdVal = document.getElementById('cambio-id').value;
    if (cambioIdVal) {
        // We need the data again or passed in. Let's assume we fetch it or it's simple.
        // Actually, better to set values here if they were already fetched.
        const list = await store.getCambiMezzi();
        const cambio = list.find(c => c.id === cambioIdVal);
        if (cambio) {
            dalSelect.value = cambio.dal_mezzo;
            alSelect.value = cambio.al_mezzo;
        }
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
        const filtered = allContacts.filter(c => c.category === category);

        if (filtered.length === 0) {
            container.innerHTML = '<p style="text-align: center; padding: 3rem; color: var(--text-secondary); background: #f8fafc; border-radius: 0.75rem; border: 1px dotted var(--border-color);">Nessun contatto presente in questa categoria.</p>';
            return;
        }

        let html = `
            <div class="contacts-table-container">
                <table class="contacts-table">
                    <thead>
                        <tr>
                            <th>NOME / SIGLA</th>
                            <th>CELLULARE</th>
                            ${category === 'sedi' ? '<th>CELL. MEDICO</th>' : ''}
                            <th>URBANO</th>
                            <th class="admin-only">AZIONI</th>
                        </tr>
                    </thead>
                    <tbody>
        `;

        filtered.forEach(c => {
            const mobileClean = c.mobile ? c.mobile.replace(/\s+/g, '') : '';
            const medicalClean = c.mobile_medical ? c.mobile_medical.replace(/\s+/g, '') : '';
            const urbanClean = c.urban ? c.urban.replace(/[\/\s+]/g, '') : '';

            html += `
                <tr>
                    <td style="font-weight: 700; color: var(--text-primary);">${c.name}</td>
                    <td>${c.mobile ? `<a href="tel:${mobileClean}" class="tel-link">${c.mobile}</a>` : '<span style="color: #cbd5e1">-</span>'}</td>
                    ${category === 'sedi' ? `<td>${c.mobile_medical ? `<a href="tel:${medicalClean}" class="tel-link">${c.mobile_medical}</a>` : '<span style="color: #cbd5e1">-</span>'}</td>` : ''}
                    <td>${c.urban ? `<a href="tel:${urbanClean}" class="tel-link">${c.urban}</a>` : '<span style="color: #cbd5e1">-</span>'}</td>
                    <td class="admin-only">
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
            document.getElementById('contact-mobile').value = contact.mobile || '';
            document.getElementById('contact-mobile-medical').value = contact.mobile_medical || '';
            document.getElementById('contact-urban').value = contact.urban || '';
        }
    } else {
        title.innerText = "Nuovo Contatto";
        // Default category to current active tab if possible, or 'sedi'
        const activeTab = document.querySelector('.contact-tab.active');
        if (activeTab) {
            const cat = activeTab.id.replace('tab-', '');
            document.getElementById('contact-category').value = cat;
        }
    }

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
        mobile: document.getElementById('contact-mobile').value.trim() || null,
        mobile_medical: document.getElementById('contact-mobile-medical').value.trim() || null,
        urban: document.getElementById('contact-urban').value.trim() || null
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
        adminLoginForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const password = document.getElementById('admin-password-input').value;
            if (password === 'admin118') { // Simple shared password
                isAdmin = true;
                localStorage.setItem('isAdmin', 'true'); // Save to localStorage
                document.body.classList.add('is-admin');
                document.getElementById('admin-lock-icon').className = 'fa-solid fa-lock-open';
                const hintText = document.getElementById('admin-hint-text');
                if (hintText) hintText.textContent = 'Modalita amministratore';
                document.getElementById('admin-login-modal').classList.add('hidden');
                document.getElementById('admin-password-input').value = '';
                alert("Modalità Amministratore Attiva!");
                renderDashboard();
            } else {
                alert("Password Errata!");
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

    const addBtn = document.getElementById('add-vehicle-btn');
    if (addBtn) {
        addBtn.addEventListener('click', () => {
            openVehicleForm();
        });
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
        if (event.target === cambioModal) cambioModal.classList.add('hidden');
        if (event.target === adminModal) adminModal.classList.add('hidden');
    }
}

window.addLocationHandler = async function (e) {
    if (e && e.preventDefault) e.preventDefault();
    const name = prompt("Nome del nuovo luogo:");
    if (!name) return;
    const color = prompt("Colore (HEX, es: #3b82f6) o premi OK per default:", "#3b82f6");
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
        notes: upper(notes)
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

            // Render UI Immediately
            document.getElementById('vehicle-form-modal').classList.add('hidden');
            renderDashboard(false);

            // Background DB Sync
            store.updateVehicle(updated).catch(err => {
                console.error("Failed to update vehicle:", err);
                alert("Errore salvataggio modifiche. Ricaricare la pagina.");
            });
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
                        ${isAdmin ? `<div style="text-align: right; display: flex; gap: 0.5rem;">
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
                            <div style="font-size: 0.75rem; text-transform: uppercase; color: black; font-weight: 600; margin-bottom: 0.25rem;">Rev. O2</div>
                            <div style="font-size: 0.95rem; font-weight: 600; color: black;">${vehicle.revision_o2 ? formatDate(vehicle.revision_o2) : '-'}</div>
                        </div>
                    </div>

                    <div class="appointment-block" style="margin-bottom: 1rem; background: #fff7ed; padding: 1rem; border: 2px solid #1e3a8a; border-radius: 0.75rem; display: flex; align-items: center; justify-content: space-between; gap: 1rem;">
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
                            <div class="admin-appointment-controls" style="display: flex; flex-direction: column; gap: 0.5rem; align-items: flex-end;">
                                <div style="display: flex; align-items: center; gap: 0.5rem;">
                                    <input type="date" id="admin-appointment-input" value="${vehicle.appointment_date || ''}" 
                                           style="padding: 0.4rem; border: 1px solid #1e3a8a; border-radius: 0.4rem; font-size: 0.9rem;">
                                    <button class="btn btn-primary" style="padding: 0.4rem 0.6rem;" onclick="saveVehicleAppointment('${vehicle.id}', document.getElementById('admin-appointment-input').value, document.getElementById('admin-appointment-location').value)">
                                        <i class="fa-solid fa-save"></i>
                                    </button>
                                </div>
                                <select id="admin-appointment-location" style="padding: 0.4rem; border: 1px solid #1e3a8a; border-radius: 0.4rem; font-size: 0.9rem; width: 100%;">
                                    <option value="">Seleziona Luogo...</option>
                                    ${cachedLocations.map(loc => `<option value="${loc.luogo}" ${vehicle.appointment_location === loc.luogo ? 'selected' : ''}>${loc.luogo}</option>`).join('')}
                                </select>
                            </div>
                        ` : ''}
                    </div>

                    <div style="margin-bottom: 1.5rem;">
                        <label style="font-size: 0.75rem; text-transform: uppercase; color: black; font-weight: 600; margin-bottom: 0.25rem; display: block;">Note</label>
                        <textarea id="vehicle-notes-textarea"
                            style="width: 100%; padding: 0.75rem; border: 1px solid var(--border-color); border-radius: 0.5rem; font-family: inherit; font-size: 0.95rem; resize: vertical; min-height: 80px; color: black; ${!isAdmin ? 'background-color: #f8fafc; cursor: not-allowed;' : ''}"
                            placeholder="${isAdmin ? 'Scrivi qui le note del mezzo...' : 'Nessuna nota'}"
                            ${!isAdmin ? 'readonly' : ''}
                        >${vehicle.notes || ''}</textarea>
                        ${isAdmin ? `<div style="text-align: right; margin-top: 0.5rem;">
                            <button class="btn btn-primary" style="padding: 0.4rem 0.8rem; font-size: 0.85rem;" onclick="saveVehicleNote('${vehicle.id}', document.getElementById('vehicle-notes-textarea').value, true)">
                                <i class="fa-solid fa-save"></i> Salva Note
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
                                    <td style="padding: 1rem;">${record.description}</td>
                                    <td style="padding: 1rem; text-align: right;">
                                        <button class="btn" style="padding: 0.25rem 0.5rem; font-size: 0.8rem; background: var(--primary-color); color: white; margin-right: 0.5rem;" onclick='openMaintenanceForm("${vehicle.id}", "${vehicle.sigla || vehicle.plate}", ${JSON.stringify(record).replace(/'/g, "&#39;")})'><i class="fa-solid fa-pen"></i></button>
                                        <button class="btn" style="padding: 0.25rem 0.5rem; font-size: 0.8rem; background: var(--status-to-repair); color: white;" onclick="deleteMaintenanceRecord('${record.id}', '${vehicle.id}')"><i class="fa-solid fa-trash"></i></button>
                                    </td>
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
        (cachedLocations || []).map(loc => `<option value="${loc}">${loc}</option>`).join('');

    if (record) {
        // Edit Mode
        document.querySelector('#maintenance-form-modal h3').textContent = 'Modifica Manutenzione';
        document.getElementById('maintenance-id').value = record.id;
        document.getElementById('maintenance-date').value = record.date;
        document.getElementById('maintenance-date-out').value = record.date_out || '';
        document.getElementById('maintenance-workshop').value = record.workshop || '';
        document.getElementById('maintenance-description').value = record.description;
    } else {
        // Add Mode
        document.querySelector('#maintenance-form-modal h3').textContent = 'Aggiungi Manutenzione';
        document.getElementById('maintenance-id').value = '';
        document.getElementById('maintenance-date').valueAsDate = new Date();
        document.getElementById('maintenance-date-out').value = '';
        document.getElementById('maintenance-workshop').value = '';
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
    const description = document.getElementById('maintenance-description').value;

    // Fetch vehicle to get sigla
    const vehicle = await store.getVehicleById(vehicleId);
    const vehicleSigla = vehicle ? (vehicle.sigla || vehicle.plate) : 'N/A';

    const record = {
        date,
        date_out: date_out || null,
        workshop: upper(workshop),
        description: upper(description),
        type: 'Routine',
        cost: 0,
        sigla: upper(vehicleSigla)
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
        if (window.lastDataManagerTab) {
            window.openDataManagement();
            switchDataTable(window.lastDataManagerTab);
        }
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
                <div style="margin-bottom: 1.5rem; background: #f8fafc; padding: 1rem; border-radius: 0.75rem; border: 1px solid var(--border-color); display: flex; justify-content: space-between; align-items: center;">
                    <h4 style="font-size: 0.9rem;">Elenco Mezzi</h4>
                    <button class="btn btn-primary" onclick="openVehicleForm();" style="padding: 0.5rem 1rem;"><i class="fa-solid fa-plus"></i> Nuovo Mezzo</button>
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
                                <th class="col-actions">Azioni</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${data.map(v => `
                                <tr>
                                    <td class="col-shrink">${v.plate}</td>
                                    <td>${v.model}</td>
                                    <td class="col-shrink text-bold text-primary">${v.sigla || '-'}</td>
                                    <td class="col-shrink">${v.station}</td>
                                    <td class="col-shrink">${v.status}</td>
                                    <td class="col-shrink">${v.mileage}</td>
                                    <td class="col-shrink">${v.mileage_month || '-'}</td>
                                    <td class="col-expand">${v.notes || '-'}</td>
                                    <td class="col-shrink">${v.radio_id || '-'}</td>
                                    <td class="col-shrink">${formatDate(v.inspection_expiry)}</td>
                                    <td class="col-shrink">${formatDate(v.revision_o2)}</td>
                                    <td class="col-actions">
                                        <button onclick="openVehicleForm('${v.id}');" style="margin-right:0.5rem; cursor:pointer; background:none; border:none; color:var(--primary-color);"><i class="fa-solid fa-pen"></i></button>
                                        <button onclick="deleteVehicleHandler('${v.id}')" style="cursor:pointer; background:none; border:none; color:var(--status-to-repair);"><i class="fa-solid fa-trash"></i></button>
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>`;
        } else if (type === 'locations') {
            data = await store.getLocations();
            html = `
                <div style="margin-bottom: 1.5rem; background: #f8fafc; padding: 1rem; border-radius: 0.75rem; border: 1px solid var(--border-color); display: flex; justify-content: space-between; align-items: center;">
                    <h4 style="font-size: 0.9rem;">Elenco Luoghi</h4>
                    <button class="btn btn-primary" onclick="window.addLocationHandler();" style="padding: 0.5rem 1rem;"><i class="fa-solid fa-plus"></i> Nuovo Luogo</button>
                </div>
                <div style="overflow-x: auto;">
                    <table class="mgmt-table">
                        <thead>
                            <tr>
                                <th>Luogo</th>
                                <th class="col-actions">Azioni</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${data.map(l => `
                                <tr>
                                    <td>${l.luogo}</td>
                                    <td class="col-actions">
                                        <button onclick="window.editLocationHandler('${l.luogo}')" style="margin-right:0.5rem; cursor:pointer; background:none; border:none; color:var(--primary-color);"><i class="fa-solid fa-edit"></i></button>
                                        <button onclick="if(confirm('Eliminare questo luogo?')){store.deleteLocation('${l.luogo}').then(() => switchDataTable('locations'))}" style="cursor:pointer; background:none; border:none; color:var(--status-to-repair);"><i class="fa-solid fa-trash"></i></button>
                                    </td>
                                </tr>
                            `).join('')}
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
                </div>
                <div style="overflow-x: auto;">
                    <table class="mgmt-table" id="interventions-table">
                        <thead>
                            <tr>
                                <th class="col-shrink">Data Entrata</th>
                                <th class="col-shrink">Data Uscita</th>
                                <th class="col-shrink">Mezzo</th>
                                <th class="col-shrink">Officina</th>
                                <th class="col-expand">Descrizione</th>
                                <th class="col-actions">Azioni</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${data.map(i => `
                                <tr>
                                    <td class="col-shrink">${formatDate(i.date)}</td>
                                    <td class="col-shrink">${formatDate(i.date_out)}</td>
                                    <td class="col-shrink text-bold text-primary">${i.sigla || 'N/A'}</td>
                                    <td class="col-shrink">${i.workshop || '-'}</td>
                                    <td class="col-expand">${i.description}</td>
                                    <td class="col-actions">
                                        <button onclick="editInterventionHandler('${i.id}')" style="margin-right:0.5rem; cursor:pointer; background:none; border:none; color:var(--primary-color);"><i class="fa-solid fa-pen"></i></button>
                                        <button onclick="if(confirm('Eliminare questo intervento?')){store.deleteIntervention('${i.id}').then(() => switchDataTable('interventions'))}" style="cursor:pointer; background:none; border:none; color:var(--status-to-repair);"><i class="fa-solid fa-trash"></i></button>
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>`;
        } else if (type === 'cambiomezzo') {
            data = await store.getCambiMezzi();
            html = `
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
                                <th class="col-actions">Azioni</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${data.map(c => `
                                <tr>
                                    <td class="col-shrink">${formatDate(c.data)}</td>
                                    <td class="col-shrink">${c.luogo || '-'}</td>
                                    <td class="col-shrink">${c.turno}</td>
                                    <td>${c.equipaggio || '-'}</td>
                                    <td class="col-shrink text-bold text-primary">${c.dal_mezzo}</td>
                                    <td class="col-shrink text-bold" style="color:var(--status-available);">${c.al_mezzo}</td>
                                    <td class="col-actions" style="display: flex; gap: 0.5rem; justify-content: flex-end;">
                                        <button onclick="openCambioMezzoModal('${c.id}')" style="cursor:pointer; background:none; border:none; color:var(--primary-color);"><i class="fa-solid fa-edit"></i></button>
                                        <button onclick="if(confirm('Eliminare questo cambio?')){store.deleteCambioMezzo('${c.id}').then(() => switchDataTable('cambiomezzo'))}" style="cursor:pointer; background:none; border:none; color:var(--status-to-repair);"><i class="fa-solid fa-trash"></i></button>
                                    </td>
                                </tr>
                            `).join('')}
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
    const table = document.getElementById('interventions-table');
    if (!table) return;
    const rows = table.querySelectorAll('tbody tr');
    const q = upper(query).trim();

    rows.forEach(row => {
        // The sigla is in the 3rd column (index 2)
        const siglaCell = row.cells[2];
        if (siglaCell) {
            const sigla = upper(siglaCell.textContent);
            if (sigla.includes(q)) {
                row.style.display = '';
            } else {
                row.style.display = 'none';
            }
        }
    });
}
