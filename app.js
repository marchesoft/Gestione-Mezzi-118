let isAdmin = false;
let cachedVehicles = null;
let cachedLocations = null;

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

    setupEventListeners();
    await renderDashboard(true); // Force initial fetch
    setupRealtimeSubscription();
    setupIdleRefresh();
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

function setupRealtimeSubscription() {
    // To be safe, we'll try to use the one from store.js if exported, or assume global.
    // Based on previous file reads, implicit global 'supabase' or initialized in store.js

    if (window.store && window.store.supabase) {
        window.store.supabase
            .channel('public:vehicles')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'vehicles' }, (payload) => {
                // Determine if we need to update cache
                if (!cachedVehicles) {
                    return renderDashboard(true);
                }

                if (payload.eventType === 'UPDATE') {
                    const idx = cachedVehicles.findIndex(v => v.id === payload.new.id);
                    if (idx !== -1) {
                        // Merge new data but preserve existing properties not in payload if any (though payload.new is usually full row)
                        // Important: payload.new might lack joined fields if any (like maintenanceHistory which is not in vehicles table)
                        // So we merge INTO existing
                        cachedVehicles[idx] = { ...cachedVehicles[idx], ...payload.new };
                    }
                } else if (payload.eventType === 'INSERT') {
                    // Start with empty maintenance history for new item
                    const newVehicle = { ...payload.new, maintenanceHistory: [] };
                    cachedVehicles.push(newVehicle);
                } else if (payload.eventType === 'DELETE') {
                    cachedVehicles = cachedVehicles.filter(v => v.id !== payload.old.id);
                }

                updateStats(cachedVehicles);
                renderVehicleGrid(cachedVehicles);
            })
            .subscribe();
    } else {
        console.warn("Supabase client not found in store. Realtime updates may not work.");
    }
}

async function renderDashboard(forceRefresh = false) {
    if (forceRefresh || !cachedVehicles) {
        cachedVehicles = await store.getVehicles();
    }
    if (forceRefresh || !cachedLocations) {
        cachedLocations = await store.getLocations();
    }
    updateStats(cachedVehicles);
    renderVehicleGrid(cachedVehicles);
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

    // Sort vehicles based on localStorage order if available
    const savedOrder = JSON.parse(localStorage.getItem('vehicleOrder') || '[]');
    if (savedOrder.length > 0) {
        vehicles.sort((a, b) => {
            const indexA = savedOrder.indexOf(a.id);
            const indexB = savedOrder.indexOf(b.id);
            // If both are found, sort by index
            if (indexA !== -1 && indexB !== -1) return indexA - indexB;
            // If only A is found, it comes first
            if (indexA !== -1) return -1;
            // If only B is found, it comes first
            if (indexB !== -1) return 1;
            // If neither is found, keep original order (or sort by ID/something else)
            return 0;
        });
    }

    grid.innerHTML = '';

    if (vehicles.length === 0) {
        grid.innerHTML = '<p style="grid-column: 1/-1; text-align: center; padding: 2rem;">Nessun veicolo trovato.</p>';
        return;
    }


    const savedLocations = cachedLocations || [];

    vehicles.forEach(vehicle => {
        const card = document.createElement('div');
        card.className = `vehicle-card border-${vehicle.status}`;
        card.draggable = isAdmin; // Only draggable if admin

        card.addEventListener('click', (e) => {
            // Check for mobile logic
            const isMobile = window.innerWidth <= 768;
            const hasNotes = vehicle.notes && vehicle.notes.trim().length > 0;

            if (isMobile && hasNotes) {
                if (card.classList.contains('notes-visible')) {
                    // Second click: Open datails
                    window.openVehicleModal(vehicle.id);
                } else {
                    // First click: Show notes
                    // Optional: Hide other open notes
                    document.querySelectorAll('.vehicle-card.notes-visible').forEach(c => c.classList.remove('notes-visible'));
                    card.classList.add('notes-visible');
                }
            } else {
                // Desktop or no notes: Open details immediately
                window.openVehicleModal(vehicle.id);
            }
        });

        card.dataset.id = vehicle.id;

        // Drag Events - Only if admin
        if (isAdmin) {
            card.addEventListener('dragstart', handleDragStart);
            card.addEventListener('dragover', handleDragOver);
            card.addEventListener('drop', handleDrop);
            card.addEventListener('dragenter', handleDragEnter);
            card.addEventListener('dragleave', handleDragLeave);
            card.addEventListener('dragend', handleDragEnd);
        }

        // Status Display - Admin: Dropdown, Non-Admin: Static Badge
        let statusHtml = '';
        const statusLabels = {
            'operative': 'In Servizio',
            'available': 'Disponibile',
            'maintenance': 'In Officina',
            'to-repair': 'Da Riparare'
        };

        if (isAdmin) {
            statusHtml = `
            <select class="status-full-bar status-${vehicle.status}" onchange="quickUpdateStatus(event, '${vehicle.id}')" onclick="event.stopPropagation()">
                <option value="operative" ${vehicle.status === 'operative' ? 'selected' : ''}>In Servizio</option>
                <option value="available" ${vehicle.status === 'available' ? 'selected' : ''}>Disponibile</option>
                <option value="maintenance" ${vehicle.status === 'maintenance' ? 'selected' : ''}>In Officina</option>
                <option value="to-repair" ${vehicle.status === 'to-repair' ? 'selected' : ''}>Da Riparare</option>
            </select>
            `;
        } else {
            statusHtml = `
            <div class="status-full-bar status-${vehicle.status}" style="cursor: default;">
                ${statusLabels[vehicle.status] || vehicle.status}
            </div>
            `;
        }

        // Location Display - Admin: Dropdown, Non-Admin: Static Text
        let locationHtml = '';
        const locationOptions = savedLocations.map(loc =>
            `<option value="${loc}" ${vehicle.station === loc ? 'selected' : ''}>${loc}</option>`
        ).join('');

        if (isAdmin) {
            locationHtml = `
            <div class="location-select-container" onclick="event.stopPropagation()">
                <div style="font-size: 0.7rem; text-transform: uppercase; font-weight: 800; color: var(--text-secondary); margin-bottom: 0.1rem;">Posizione</div>
                <div style="width: 100%;">
                    <select class="location-select" onchange="quickUpdateStationSelect(event, '${vehicle.id}')">
                        ${locationOptions}
                    </select>
                </div>
            </div>
            `;
        } else {
            locationHtml = `
            <div class="location-select-container" style="cursor: default; background: transparent; border: none; padding: 0;">
                <div style="font-size: 0.7rem; text-transform: uppercase; font-weight: 800; color: var(--text-secondary); margin-bottom: 0.1rem;">Posizione</div>
                <div style="width: 100%; text-align: center;">
                    <span style="font-weight: 700; font-size: 1.4rem; color: black;">${vehicle.station}</span>
                </div>
            </div>
            `;
        }

        card.innerHTML = `
            ${vehicle.notes ? `<div class="note-tooltip">${vehicle.notes}</div>` : ''}
            ${statusHtml}
            <div class="card-body">
                <div class="vehicle-id" style="text-align: center; margin-bottom: 0.5rem; display: flex; flex-direction: column; gap: 0.1rem;">
                    ${vehicle.sigla ? `<div class="sigla-text">${vehicle.sigla}</div>` : ''}
                    <div class="model-text">${vehicle.model}</div>
                    <div class="plate-number">${vehicle.plate}</div>
                </div>
                <div class="card-actions" style="justify-content: center; flex-direction: column; align-items: center;">
                    ${locationHtml}
                    ${vehicle.notes ? `<div class="mobile-notes">${vehicle.notes}</div>` : ''}
                </div>
            </div>
        `;
        grid.appendChild(card);
    });
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

    // 2. Update cached data immediately
    const vehicle = await store.getVehicleById(id);
    if (vehicle) {
        // Even if status matches DB (vehicle.status === newStatus), we ensure our local cache is updated
        // But we only write to DB if different to save bandwidth/calls
        if (vehicle.status !== newStatus) {
            vehicle.status = newStatus;

            // Update local cache immediately so any subsequent re-renders use new data
            if (cachedVehicles) {
                const idx = cachedVehicles.findIndex(v => v.id === id);
                if (idx !== -1) cachedVehicles[idx].status = newStatus;
            }
            // Update stats immediately
            updateStats(cachedVehicles || [vehicle]);

            await store.updateVehicle(vehicle);
        }

        // Refresh modal if open
        if (!document.getElementById('vehicle-modal').classList.contains('hidden')) {
            openVehicleModal(id);
        }
    }
}

window.quickUpdateStationSelect = async function (event, id) {
    event.stopPropagation();
    const newStation = event.target.value;

    const vehicle = await store.getVehicleById(id);
    if (vehicle && vehicle.station !== newStation) {
        vehicle.station = newStation;
        await store.updateVehicle(vehicle);
        await renderDashboard(true);

        if (!document.getElementById('vehicle-modal').classList.contains('hidden')) {
            openVehicleModal(id);
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
        if (hintText) hintText.textContent = 'Modalita visualizzazione,';
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
    const title = document.getElementById('form-modal-title');
    const form = document.getElementById('vehicle-form');
    form.reset();
    document.getElementById('vehicle-id').value = '';

    // Populate Station Select
    const stationSelect = document.getElementById('vehicle-station');
    stationSelect.innerHTML = '<option value="">-- Seleziona --</option>';
    if (cachedLocations) {
        cachedLocations.forEach(loc => {
            const option = document.createElement('option');
            option.value = loc;
            option.textContent = loc;
            stationSelect.appendChild(option);
        });
    }

    if (vehicleId) {
        title.textContent = 'Modifica Mezzo';
        const vehicle = await store.getVehicleById(vehicleId);
        if (vehicle) {
            document.getElementById('vehicle-id').value = vehicle.id;
            document.getElementById('vehicle-model').value = vehicle.model;
            document.getElementById('vehicle-plate').value = vehicle.plate;
            document.getElementById('vehicle-sigla').value = vehicle.sigla || '';
            document.getElementById('vehicle-type').value = vehicle.type || 'Ambulanza';
            document.getElementById('vehicle-status').value = vehicle.status;
            document.getElementById('vehicle-station').value = vehicle.station || '';

            document.getElementById('vehicle-mileage').value = vehicle.mileage;

            // Extended Fields
            document.getElementById('vehicle-mileage-month').value = vehicle.mileage_month || ''; // Populate new field
            document.getElementById('vehicle-radio').value = vehicle.radio_id || '';

            document.getElementById('vehicle-inspection').value = vehicle.inspection_expiry || '';
            document.getElementById('vehicle-revision-o2').value = vehicle.revision_o2 || '';
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

    window.onclick = function (event) {
        const modal = document.getElementById('vehicle-modal');
        const formModal = document.getElementById('vehicle-form-modal');
        const maintModal = document.getElementById('maintenance-form-modal');
        const locModal = document.getElementById('location-modal');
        const adminModal = document.getElementById('admin-login-modal');

        if (event.target === modal) modal.classList.add('hidden');
        if (event.target === formModal) formModal.classList.add('hidden');
        if (event.target === maintModal) maintModal.classList.add('hidden');
        if (event.target === locModal) locModal.classList.add('hidden');
        if (event.target === adminModal) adminModal.classList.add('hidden');
    }
}



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
        model, plate, sigla, status, type, station,
        mileage: parseInt(mileage) || 0,
        mileage_month,
        radio_id,

        inspection_expiry: inspection_expiry || null,
        revision_o2: revision_o2 || null,
        notes
    };

    if (id) {
        const existing = await store.getVehicleById(id);
        const updated = { ...existing, ...vehicleData };
        await store.updateVehicle(updated);
    } else {
        const newId = type.substring(0, 3).toUpperCase() + '-' + Math.floor(100 + Math.random() * 900) + '-' + Math.floor(10 + Math.random() * 90);
        const newVehicle = {
            id: newId,
            ...vehicleData,
            maintenanceHistory: []
        };
        await store.addVehicle(newVehicle);
    }

    document.getElementById('vehicle-form-modal').classList.add('hidden');
    await renderDashboard(true);

    if (window.lastDataManagerTab === 'vehicles') {
        window.openDataManagement();
        switchDataTable('vehicles');
    }

    if (!document.getElementById('vehicle-modal').classList.contains('hidden') && id) {
        window.openVehicleModal(id);
    }
}

window.openVehicleModal = async function (id) {
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
                <div style="position: relative; padding: 1.5rem 1.5rem 0 1.5rem;">
                    <button onclick="document.getElementById('vehicle-modal').classList.add('hidden')" style="position: absolute; top: 1rem; right: 1rem; background: rgba(0,0,0,0.5); border: none; color: white; width: 32px; height: 32px; border-radius: 50%; cursor: pointer; font-size: 1.2rem; display: flex; align-items: center; justify-content: center; z-index: 10;">&times;</button>
                    <div class="status-badge ${statusColorClass}" style="position: relative; top: 0; left: 0; font-size: 1.1rem; padding: 0.6rem 1.2rem; display: inline-block; margin-bottom: 1rem;">
                        ${getStatusLabel(vehicle.status)}
                    </div>
                </div>
                <div style="padding: 1.5rem;">
                    <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 1rem;">
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

                    <div class="form-grid-3" style="margin-bottom: 1rem; background: #f8fafc; padding: 1rem; border-radius: 0.75rem;">
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

                    <div class="form-grid-3" style="margin-bottom: 1rem; background: #f1f5f9; padding: 1rem; border-radius: 0.75rem;">
                        <div>
                            <div style="font-size: 0.75rem; text-transform: uppercase; color: black; font-weight: 600; margin-bottom: 0.25rem;">ID Radio</div>
                            <div style="font-size: 0.95rem; font-weight: 600; color: black;">${vehicle.radio_id || '-'}</div>
                        </div>
                        <div>
                            <div style="font-size: 0.75rem; text-transform: uppercase; color: black; font-weight: 600; margin-bottom: 0.25rem;">Scadenza Revisione</div>
                            <div style="font-size: 0.95rem; font-weight: 600; color: black;">${vehicle.inspection_expiry ? new Date(vehicle.inspection_expiry).toLocaleDateString() : '-'}</div>
                        </div>
                        <div>
                            <div style="font-size: 0.75rem; text-transform: uppercase; color: black; font-weight: 600; margin-bottom: 0.25rem;">Rev. O2</div>
                            <div style="font-size: 0.95rem; font-weight: 600; color: black;">${vehicle.revision_o2 ? new Date(vehicle.revision_o2).toLocaleDateString() : '-'}</div>
                        </div>
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
                                    <td style="padding: 1rem; font-weight: 500;">${record.date ? new Date(record.date).toLocaleDateString() : '-'}</td>
                                    <td style="padding: 1rem; font-weight: 500;">${record.date_out ? new Date(record.date_out).toLocaleDateString() : '-'}</td>
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

    form.reset();
    document.getElementById('maintenance-vehicle-id').value = vehicleId;
    document.getElementById('maintenance-vehicle-sigla').value = vehicleSigla || 'N/A';

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
        workshop: workshop || null,
        description,
        type: 'Routine',
        cost: 0,
        sigla: vehicleSigla // Add sigla to record
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
            vehicle.mileage_month = text;
            await store.updateVehicle(vehicle);
            loadVehicles(); // Refresh the grid to show the new month immediately
        }
    } catch (e) {
        console.error('Error saving mileage month:', e);
        alert('Errore nel salvataggio del mese chilometri');
    }
}

// Note Auto-Save
window.saveVehicleNote = async function (id, text, showFeedback = false) {
    try {
        const vehicle = await store.getVehicleById(id);
        if (vehicle) {
            vehicle.notes = text;
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
        // Hide management modal to let form show (z-index/overlap issues sometimes occur)
        document.getElementById('data-management-modal').classList.add('hidden');
    }
}

window.switchDataTable = async function (type) {
    window.lastDataManagerTab = type; // Track for refresh logic
    // Update tabs
    const buttons = document.querySelectorAll('.filter-btn'); // Reuse existing class for styling
    buttons.forEach(btn => {
        if (btn.onclick && btn.onclick.toString().includes(type)) btn.classList.add('active');
        else if (btn.parentElement && btn.parentElement.style.gap === '1rem') btn.classList.remove('active'); // Only target our specific buttons if possible, or use specific IDs
    });

    const container = document.getElementById('data-table-container');
    container.innerHTML = '<p style="text-align:center;">Caricamento...</p>';

    let data = [];
    let html = '';

    try {
        if (type === 'vehicles') {
            data = await store.getVehicles();
            html = `
                <div style="margin-bottom: 1.5rem; background: #f8fafc; padding: 1rem; border-radius: 0.75rem; border: 1px solid var(--border-color); display: flex; justify-content: space-between; align-items: center;">
                    <h4 style="font-size: 0.9rem;">Elenco Mezzi</h4>
                    <button class="btn btn-primary" onclick="openVehicleForm(); document.getElementById('data-management-modal').classList.add('hidden');" style="padding: 0.5rem 1rem;"><i class="fa-solid fa-plus"></i> Nuovo Mezzo</button>
                </div>
                <div style="overflow-x: auto;">
                    <table style="width: 100%; border-collapse: collapse; min-width: 1200px;">
                        <thead>
                            <tr style="background: #f8fafc; border-bottom: 2px solid var(--border-color);">
                                <th style="padding: 0.75rem; text-align: left;">Targa</th>
                                <th style="padding: 0.75rem; text-align: left;">Modello</th>
                                <th style="padding: 0.75rem; text-align: left;">Sigla</th>
                                <th style="padding: 0.75rem; text-align: left;">Stazione</th>
                                <th style="padding: 0.75rem; text-align: left;">Stato</th>
                                <th style="padding: 0.75rem; text-align: left;">Km</th>
                                <th style="padding: 0.75rem; text-align: left;">Mese Km</th>
                                <th style="padding: 0.75rem; text-align: left;">Note</th>
                                <th style="padding: 0.75rem; text-align: left;">Radio</th>

                                <th style="padding: 0.75rem; text-align: left;">Rev. Scad.</th>
                                <th style="padding: 0.75rem; text-align: left;">Rev. O2</th>
                                <th style="padding: 0.75rem; text-align: right;">Azioni</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${data.map(v => `
                                <tr style="border-bottom: 1px solid var(--border-color);">
                                    <td style="padding: 0.75rem;">${v.plate}</td>
                                    <td style="padding: 0.75rem;">${v.model}</td>
                                    <td style="padding: 0.75rem; font-weight: bold; color: var(--primary-color);">${v.sigla || '-'}</td>
                                    <td style="padding: 0.75rem;">${v.station}</td>
                                    <td style="padding: 0.75rem;">${v.status}</td>
                                    <td style="padding: 0.75rem;">${v.mileage}</td>
                                    <td style="padding: 0.75rem;">${v.mileage_month || '-'}</td>
                                    <td style="padding: 0.75rem; max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${v.notes || ''}">${v.notes || '-'}</td>
                                    <td style="padding: 0.75rem;">${v.radio_id || '-'}</td>

                                    <td style="padding: 0.75rem;">${v.inspection_expiry || '-'}</td>
                                    <td style="padding: 0.75rem;">${v.revision_o2 || '-'}</td>
                                    <td style="padding: 0.75rem; text-align: right;">
                                        <button onclick="openVehicleForm('${v.id}'); document.getElementById('data-management-modal').classList.add('hidden');" style="margin-right:0.5rem; cursor:pointer; background:none; border:none; color:var(--primary-color);"><i class="fa-solid fa-pen"></i></button>
                                        <button onclick="deleteVehicleHandler('${v.id}')" style="cursor:pointer; background:none; border:none; color:var(--status-to-repair);"><i class="fa-solid fa-trash"></i></button>
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>`;
        } else if (type === 'locations') {
            data = await store.getLocations(); // Returns array of strings
            html = `
                <div style="margin-bottom: 1.5rem; background: #f8fafc; padding: 1rem; border-radius: 0.75rem; border: 1px solid var(--border-color);">
                    <h4 style="margin-bottom: 0.75rem; font-size: 0.9rem;">Aggiungi Nuovo Luogo</h4>
                    <form onsubmit="event.preventDefault(); const n = this.querySelector('input').value.trim(); if(n){store.addLocation(n).then(() => switchDataTable('locations'))}" style="display: flex; gap: 0.5rem;">
                        <input type="text" placeholder="Nome luogo..." required style="flex-grow: 1; padding: 0.5rem; border: 1px solid var(--border-color); border-radius: 0.4rem;">
                            <button type="submit" class="btn btn-primary" style="padding: 0.5rem 1rem;"><i class="fa-solid fa-plus"></i> Aggiungi</button>
                    </form>
                </div>
                <table style="width: 100%; border-collapse: collapse;">
                    <thead>
                        <tr style="background: #f8fafc; border-bottom: 2px solid var(--border-color);">
                            <th style="padding: 0.75rem; text-align: left;">Nome Luogo</th>
                            <th style="padding: 0.75rem; text-align: right;">Azioni</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${data.map(l => `
                            <tr style="border-bottom: 1px solid var(--border-color);">
                                <td style="padding: 0.75rem;">${l}</td>
                                <td style="padding: 0.75rem; text-align: right;">
                                    <button onclick="const n = prompt('Modifica nome luogo:', '${l}'); if(n && n !== '${l}'){store.updateLocation('${l}', n).then(() => switchDataTable('locations'))}" style="margin-right:0.5rem; cursor:pointer; background:none; border:none; color:var(--primary-color);"><i class="fa-solid fa-pen"></i></button>
                                    <button onclick="if(confirm('Eliminare questo luogo?')){store.deleteLocation('${l}').then(() => switchDataTable('locations'))}" style="cursor:pointer; background:none; border:none; color:var(--status-to-repair);"><i class="fa-solid fa-trash"></i></button>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>`;
        } else if (type === 'interventions') {
            data = await store.getInterventions();
            html = `
                <div style="overflow-x: auto;">
                    <table style="width: 100%; border-collapse: collapse;">
                        <thead>
                            <tr style="background: #f8fafc; border-bottom: 2px solid var(--border-color);">
                                <th style="padding: 0.75rem; text-align: left;">Data Entrata</th>
                                <th style="padding: 0.75rem; text-align: left;">Data Uscita</th>
                                <th style="padding: 0.75rem; text-align: left;">Mezzo</th>
                                <th style="padding: 0.75rem; text-align: left;">Officina</th>
                                <th style="padding: 0.75rem; text-align: left;">Descrizione</th>
                                <th style="padding: 0.75rem; text-align: right;">Azioni</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${data.map(i => `
                                <tr style="border-bottom: 1px solid var(--border-color);">
                                    <td style="padding: 0.75rem;">${i.date}</td>
                                    <td style="padding: 0.75rem;">${i.date_out || '-'}</td>
                                    <td style="padding: 0.75rem; font-weight: bold; color: var(--primary-color);">${i.sigla || 'N/A'}</td>
                                    <td style="padding: 0.75rem;">${i.workshop || '-'}</td>
                                    <td style="padding: 0.75rem; max-width: 300px;">${i.description}</td>
                                    <td style="padding: 0.75rem; text-align: right;">
                                        <button onclick="editInterventionHandler('${i.id}')" style="margin-right:0.5rem; cursor:pointer; background:none; border:none; color:var(--primary-color);"><i class="fa-solid fa-pen"></i></button>
                                        <button onclick="if(confirm('Eliminare questo intervento?')){store.deleteIntervention('${i.id}').then(() => switchDataTable('interventions'))}" style="cursor:pointer; background:none; border:none; color:var(--status-to-repair);"><i class="fa-solid fa-trash"></i></button>
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
