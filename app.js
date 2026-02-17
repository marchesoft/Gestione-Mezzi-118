
document.addEventListener('DOMContentLoaded', () => {
    initApp();
});

async function initApp() {
    await renderDashboard();
    setupEventListeners();
}

async function renderDashboard() {
    const vehicles = await store.getVehicles();
    updateStats(vehicles);
    renderVehicleGrid(vehicles);
}

function updateStats(vehicles) {
    const operative = vehicles.filter(v => v.status === 'operative').length;
    const available = vehicles.filter(v => v.status === 'available').length;
    const maintenance = vehicles.filter(v => v.status === 'maintenance').length;
    const toRepair = vehicles.filter(v => v.status === 'to-repair').length;

    document.getElementById('stat-operative').textContent = operative;
    document.getElementById('stat-available').textContent = available;
    document.getElementById('stat-maintenance').textContent = maintenance;
    document.getElementById('stat-to-repair').textContent = toRepair;
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
    grid.innerHTML = '';

    const savedLocations = await store.getLocations();

    vehicles.forEach(vehicle => {
        const card = document.createElement('div');
        card.className = 'vehicle-card';

        // Status select dropdown
        const statusSelect = `
            <select class="status-full-bar status-${vehicle.status}" onchange="quickUpdateStatus(event, '${vehicle.id}')" onclick="event.stopPropagation()">
                <option value="operative" ${vehicle.status === 'operative' ? 'selected' : ''}>In Servizio</option>
                <option value="available" ${vehicle.status === 'available' ? 'selected' : ''}>Disponibile</option>
                <option value="maintenance" ${vehicle.status === 'maintenance' ? 'selected' : ''}>In Officina</option>
                <option value="to-repair" ${vehicle.status === 'to-repair' ? 'selected' : ''}>Da Riparare</option>
            </select>
        `;

        // Location Select Dropdown
        const locationOptions = savedLocations.map(loc =>
            `<option value="${loc}" ${vehicle.station === loc ? 'selected' : ''}>${loc}</option>`
        ).join('');

        const locationSelect = `
            <div class="location-select-container" onclick="event.stopPropagation()">
                <i class="fa-solid fa-location-dot location-icon"></i>
                <select class="location-select" onchange="quickUpdateStationSelect(event, '${vehicle.id}')">
                    ${locationOptions}
                    <option value="" disabled>──────────</option>
                    <option value="MANAGE_LOCATIONS">⚙️ Gestisci Elenco...</option>
                </select>
            </div>
        `;

        card.innerHTML = `
            <div class="card-header">
                <img src="${vehicle.image}" alt="${vehicle.model}" onerror="this.src='https://placehold.co/600x400?text=No+Immagine'">
            </div>
            ${statusSelect}
            <div class="card-body">
                <div class="vehicle-id" style="text-align: center; margin-bottom: 1.5rem;">
                    ${vehicle.sigla ? `<div style="font-size: 1.5rem; font-weight: 900; color: #1e3a8a; margin-bottom: 0px;">${vehicle.sigla}</div>` : ''}
                    <h4 style="font-size: 1rem; color: var(--text-secondary); margin-bottom: 0px; font-weight: 500;">${vehicle.model}</h4>
                    <span class="plate-number" style="font-size: 1.5rem; color: var(--text-primary); font-weight: 800;">${vehicle.plate}</span>
                </div>
                <div class="vehicle-details">
                    <div class="detail-item">
                        <span class="detail-label">Chilometri</span>
                        <span class="detail-value">
                            ${parseInt(vehicle.mileage).toLocaleString()} km
                            ${vehicle.mileage_month ? `<span style="font-size: 0.8rem; color: var(--text-secondary); font-weight: 400; margin-left: 0.25rem;">(${vehicle.mileage_month})</span>` : ''}
                        </span>
                    </div>
                </div>
                <div class="card-actions">
                    ${locationSelect}
                    <a href="#" class="view-btn" onclick="openVehicleModal('${vehicle.id}')">
                        Dettagli <i class="fa-solid fa-arrow-right"></i>
                    </a>
                </div>
            </div>
        `;
        grid.appendChild(card);
    });
}

// Quick Actions
window.quickUpdateStatus = async function (event, id) {
    event.stopPropagation();
    const newStatus = event.target.value;
    const vehicle = await store.getVehicleById(id);
    if (vehicle && vehicle.status !== newStatus) {
        vehicle.status = newStatus;
        await store.updateVehicle(vehicle);
        await renderDashboard();

        if (!document.getElementById('vehicle-modal').classList.contains('hidden')) {
            openVehicleModal(id);
        }
    }
}

window.quickUpdateStationSelect = async function (event, id) {
    event.stopPropagation();
    let newStation = event.target.value;

    if (newStation === 'MANAGE_LOCATIONS') {
        openLocationModal();
        renderDashboard();
        return;
    }

    const vehicle = await store.getVehicleById(id);
    if (vehicle && vehicle.station !== newStation) {
        vehicle.station = newStation;
        await store.updateVehicle(vehicle);
        await renderDashboard();

        if (!document.getElementById('vehicle-modal').classList.contains('hidden')) {
            openVehicleModal(id);
        }
    }
}

// Location Management Logic
window.openLocationModal = async function () {
    await renderLocationList();
    document.getElementById('location-modal').classList.remove('hidden');
}

async function renderLocationList() {
    const list = document.getElementById('location-list');
    list.innerHTML = '';
    const locations = await store.getLocations();

    locations.forEach(loc => {
        const li = document.createElement('li');
        li.style.cssText = 'display: flex; justify-content: space-between; align-items: center; padding: 0.75rem; background: #f8fafc; margin-bottom: 0.5rem; border-radius: 0.5rem; border: 1px solid var(--border-color);';

        li.innerHTML = `
            <span style="font-weight: 500;">${loc}</span>
            <div style="display: flex; gap: 0.5rem;">
                <button class="btn" style="padding: 0.25rem 0.5rem; font-size: 0.8rem;" onclick="editLocation('${loc}')">
                    <i class="fa-solid fa-pen"></i>
                </button>
                 <button class="btn" style="padding: 0.25rem 0.5rem; font-size: 0.8rem; color: var(--status-to-repair);" onclick="deleteLocation('${loc}')">
                    <i class="fa-solid fa-trash"></i>
                </button>
            </div>
        `;
        list.appendChild(li);
    });
}

window.addLocationHandler = async function (e) {
    e.preventDefault();
    const input = document.getElementById('new-location-input');
    const newLoc = input.value.trim();
    if (newLoc) {
        await store.addLocation(newLoc);
        input.value = '';
        await renderLocationList();
        await renderDashboard();

        // If vehicle form is open, refresh its dropdown
        const vehicleFormModal = document.getElementById('vehicle-form-modal');
        if (!vehicleFormModal.classList.contains('hidden')) {
            const stationSelect = document.getElementById('vehicle-station');
            const currentVal = stationSelect.value;

            stationSelect.innerHTML = '<option value="" disabled selected>Seleziona Stazione...</option>';
            const locations = await store.getLocations();
            locations.forEach(loc => {
                const option = document.createElement('option');
                option.value = loc;
                option.textContent = loc;
                stationSelect.appendChild(option);
            });

            // If the new location was just added, select it (optional but nice)
            // Or restore previous selection
            if (currentVal) stationSelect.value = currentVal;
        }
    }
}

window.deleteLocation = async function (loc) {
    if (confirm(`Sei sicuro di voler eliminare "${loc}"?`)) {
        await store.deleteLocation(loc);
        await renderLocationList();
        await renderDashboard();
    }
}

window.editLocation = async function (oldName) {
    const newName = prompt("Modifica nome luogo:", oldName);
    if (newName && newName !== oldName) {
        await store.updateLocation(oldName, newName);
        await renderLocationList();
        await renderDashboard();
    }
}

function setupEventListeners() {
    // Filter Buttons
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');

            const filter = e.target.dataset.filter;
            const vehicles = await store.getVehicles();

            if (filter === 'all') {
                renderVehicleGrid(vehicles);
            } else {
                const filtered = vehicles.filter(v => v.status === filter);
                renderVehicleGrid(filtered);
            }
        });
    });

    // Modal Close handlers, same as before...
    const closeDetailModal = document.querySelector('.close-modal');
    if (closeDetailModal) {
        closeDetailModal.addEventListener('click', () => {
            document.getElementById('vehicle-modal').classList.add('hidden');
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

        if (event.target === modal) modal.classList.add('hidden');
        if (event.target === formModal) formModal.classList.add('hidden');
        if (event.target === maintModal) maintModal.classList.add('hidden');
        if (event.target === locModal) locModal.classList.add('hidden');
    }
}

// Global functions attached to window for HTML event handlers

window.openVehicleForm = async function (vehicleId = null) {
    const modal = document.getElementById('vehicle-form-modal');
    const title = document.getElementById('form-modal-title');
    const form = document.getElementById('vehicle-form');
    const stationSelect = document.getElementById('vehicle-station');

    // Populate Station Dropdown
    stationSelect.innerHTML = '<option value="" disabled selected>Seleziona Stazione...</option>';
    const locations = await store.getLocations();
    locations.forEach(loc => {
        const option = document.createElement('option');
        option.value = loc;
        option.textContent = loc;
        stationSelect.appendChild(option);
    });

    form.reset();
    document.getElementById('vehicle-id').value = '';
    document.getElementById('vehicle-image-upload').value = '';

    if (vehicleId) {
        title.textContent = 'Modifica Mezzo';
        const vehicle = await store.getVehicleById(vehicleId);
        if (vehicle) {
            document.getElementById('vehicle-id').value = vehicle.id;
            document.getElementById('vehicle-model').value = vehicle.model;
            document.getElementById('vehicle-plate').value = vehicle.plate;
            document.getElementById('vehicle-sigla').value = vehicle.sigla || '';
            // Type preserved automagically on backend/store if strictly using model
            document.getElementById('vehicle-status').value = vehicle.status;
            document.getElementById('vehicle-station').value = vehicle.station;
            document.getElementById('vehicle-mileage').value = vehicle.mileage;
            document.getElementById('vehicle-image').value = vehicle.image;

            // Extended Fields
            document.getElementById('vehicle-mileage-month').value = vehicle.mileage_month || ''; // Populate new field
            document.getElementById('vehicle-barella').value = vehicle.barella_data || '';
            document.getElementById('vehicle-radio').value = vehicle.radio_id || '';
            document.getElementById('vehicle-aspirator').value = vehicle.aspirator_id || '';
            document.getElementById('vehicle-inspection').value = vehicle.inspection_expiry || '';
            document.getElementById('vehicle-testing').value = vehicle.testing_expiry || '';
            document.getElementById('vehicle-notes').value = vehicle.notes || '';
        }
    } else {
        title.textContent = 'Aggiungi Nuovo Mezzo';
        document.getElementById('vehicle-mileage-month').value = ''; // Reset
    }

    modal.classList.remove('hidden');
}

window.saveVehicleForm = async function () {
    const id = document.getElementById('vehicle-id').value;
    const model = document.getElementById('vehicle-model').value;
    const plate = document.getElementById('vehicle-plate').value;
    const status = document.getElementById('vehicle-status').value;
    const station = document.getElementById('vehicle-station').value;
    const mileage = document.getElementById('vehicle-mileage').value;
    const sigla = (document.getElementById('vehicle-sigla').value || '').trim();

    let image = document.getElementById('vehicle-image').value;
    const imageFile = document.getElementById('vehicle-image-upload').files[0];

    if (imageFile) {
        try {
            image = await convertToBase64(imageFile);
        } catch (error) {
            console.error(error);
            alert("Errore immagine");
            return;
        }
    }

    if (!image) {
        image = 'https://placehold.co/600x400?text=No+Immagine';
    }

    const vehicleData = {
        model,
        plate,
        sigla,
        status,
        station,
        mileage: parseInt(mileage),
        mileage_month: document.getElementById('vehicle-mileage-month').value, // Save new field
        image,
        // Extended fields
        barella_data: document.getElementById('vehicle-barella').value,
        radio_id: document.getElementById('vehicle-radio').value,
        aspirator_id: document.getElementById('vehicle-aspirator').value,
        inspection_expiry: document.getElementById('vehicle-inspection').value || null,
        testing_expiry: document.getElementById('vehicle-testing').value || null,
        notes: document.getElementById('vehicle-notes').value
    };

    if (id) {
        // Update
        // Preserve type logic or fetch existing
        const existing = await store.getVehicleById(id);
        const updated = { ...existing, ...vehicleData };
        await store.updateVehicle(updated);
    } else {
        // Create
        const type = "Ambulanza"; // Default
        const newId = type.substring(0, 3).toUpperCase() + '-' + Math.floor(100 + Math.random() * 900) + '-' + Math.floor(10 + Math.random() * 90);
        const newVehicle = {
            id: newId,
            type,
            ...vehicleData,
            maintenanceHistory: []
        };
        await store.addVehicle(newVehicle);
    }

    document.getElementById('vehicle-form-modal').classList.add('hidden');
    await renderDashboard();

    // Refresh modal if open
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
        <div style="position: relative;">
            <button onclick="document.getElementById('vehicle-modal').classList.add('hidden')" style="position: absolute; top: 1rem; right: 1rem; background: rgba(0,0,0,0.5); border: none; color: white; width: 32px; height: 32px; border-radius: 50%; cursor: pointer; font-size: 1.2rem; display: flex; align-items: center; justify-content: center; z-index: 10;">&times;</button>
            <img src="${vehicle.image}" style="width: 100%; height: 300px; object-fit: cover; border-top-left-radius: 1rem; border-top-right-radius: 1rem;" onerror="this.src='https://placehold.co/600x400?text=No+Immagine'">
             <div class="status-badge ${statusColorClass}" style="top: 20px; left: 20px; font-size: 1rem; padding: 0.5rem 1rem; right: auto;"> <!-- Moved badge to left to avoid conflict -->
                ${getStatusLabel(vehicle.status)}
            </div>
        </div>
        <div style="padding: 1.5rem;">
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 1rem;">
                <div>
                    <div style="display: flex; flex-direction: column; gap: 0.1rem;">
                        ${vehicle.sigla ? `<h1 style="font-size: 2.25rem; font-weight: 800; color: var(--primary-color); margin: 0;">${vehicle.sigla}</h1>` : ''}
                        <h2 style="font-size: 1.25rem; margin-bottom: 0.25rem; color: var(--text-primary);">${vehicle.model}</h2>
                    </div>
                    <div style="display: flex; gap: 0.75rem; align-items: center;">
                        <span class="plate-number" style="font-size: 1rem; padding: 0.2rem 0.6rem;">${vehicle.plate}</span>
                        <span style="color: var(--text-secondary); font-weight: 500; font-size: 0.9rem;">${vehicle.type}</span>
                    </div>
                </div>
                <div style="text-align: right; display: flex; gap: 0.5rem;">
                     <button class="btn" style="border: 1px solid var(--status-to-repair); color: var(--status-to-repair); background: white; padding: 0.4rem 0.8rem; font-size: 0.85rem;" onclick="deleteVehicleHandler('${vehicle.id}')"><i class="fa-solid fa-trash"></i> Elimina</button>
                    <button class="btn btn-primary" style="padding: 0.4rem 0.8rem; font-size: 0.85rem;" onclick="openVehicleForm('${vehicle.id}')"><i class="fa-solid fa-pen"></i> Modifica</button>
                </div>
            </div>

            <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem; margin-bottom: 1rem; background: #f8fafc; padding: 1rem; border-radius: 0.75rem;">
                <div>
                    <div style="font-size: 0.75rem; text-transform: uppercase; color: black; font-weight: 600; margin-bottom: 0.25rem;">Stazione Attuale</div>
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

            <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem; margin-bottom: 1rem; background: #f1f5f9; padding: 1rem; border-radius: 0.75rem;">
                <div>
                    <div style="font-size: 0.75rem; text-transform: uppercase; color: black; font-weight: 600; margin-bottom: 0.25rem;">Barella</div>
                    <div style="font-size: 0.95rem; font-weight: 600; color: black;">${vehicle.barella_data || '-'}</div>
                </div>
                <div>
                    <div style="font-size: 0.75rem; text-transform: uppercase; color: black; font-weight: 600; margin-bottom: 0.25rem;">ID Radio</div>
                    <div style="font-size: 0.95rem; font-weight: 600; color: black;">${vehicle.radio_id || '-'}</div>
                </div>
                <div>
                    <div style="font-size: 0.75rem; text-transform: uppercase; color: black; font-weight: 600; margin-bottom: 0.25rem;">ID Aspiratore</div>
                    <div style="font-size: 0.95rem; font-weight: 600; color: black;">${vehicle.aspirator_id || '-'}</div>
                </div>
                <div>
                    <div style="font-size: 0.75rem; text-transform: uppercase; color: black; font-weight: 600; margin-bottom: 0.25rem;">Scadenza Revisione</div>
                    <div style="font-size: 0.95rem; font-weight: 600; color: black;">${vehicle.inspection_expiry ? new Date(vehicle.inspection_expiry).toLocaleDateString() : '-'}</div>
                </div>
                <div>
                    <div style="font-size: 0.75rem; text-transform: uppercase; color: black; font-weight: 600; margin-bottom: 0.25rem;">Ultimo Collaudo O2</div>
                    <div style="font-size: 0.95rem; font-weight: 600; color: black;">${vehicle.testing_expiry ? new Date(vehicle.testing_expiry).toLocaleDateString() : '-'}</div>
                </div>
            </div>

            <div style="margin-bottom: 1.5rem;">
                <label style="font-size: 0.75rem; text-transform: uppercase; color: black; font-weight: 600; margin-bottom: 0.25rem; display: block;">Note</label>
                <textarea 
                    style="width: 100%; padding: 0.75rem; border: 1px solid var(--border-color); border-radius: 0.5rem; font-family: inherit; font-size: 0.95rem; resize: vertical; min-height: 80px; color: black;"
                    placeholder="Scrivi qui le note del mezzo..."
                    onblur="saveVehicleNote('${vehicle.id}', this.value)"
                >${vehicle.notes || ''}</textarea>
            </div>

            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
                <h3 style="font-size: 1.5rem; margin: 0; color: black;">Storico Manutenzione</h3>
                <button class="btn btn-primary" style="font-size: 0.9rem; padding: 0.5rem 1rem;" onclick="openMaintenanceForm('${vehicle.id}', '${vehicle.sigla || vehicle.plate}')">
                    <i class="fa-solid fa-plus"></i> Aggiungi Record
                </button>
            </div>
            
            <div style="background: white; border: 1px solid var(--border-color); border-radius: 1rem; overflow: hidden;">
                ${vehicle.maintenanceHistory && vehicle.maintenanceHistory.length > 0 ? `
                    <table style="width: 100%; border-collapse: collapse;">
                        <thead style="background: #f8fafc; border-bottom: 1px solid var(--border-color);">
                            <tr>
                                <th style="text-align: left; padding: 1rem; font-size: 0.85rem; color: var(--text-secondary);">Data Entrata</th>
                                <th style="text-align: left; padding: 1rem; font-size: 0.85rem; color: var(--text-secondary);">Data Uscita</th>
                                <th style="text-align: left; padding: 1rem; font-size: 0.85rem; color: var(--text-secondary);">Descrizione</th>
                                <th style="text-align: right; padding: 1rem; font-size: 0.85rem; color: var(--text-secondary);">Azioni</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${vehicle.maintenanceHistory.map(record => `
                                <tr style="border-bottom: 1px solid var(--border-color);">
                                    <td style="padding: 1rem; font-weight: 500;">${record.date ? new Date(record.date).toLocaleDateString() : '-'}</td>
                                    <td style="padding: 1rem; font-weight: 500;">${record.date_out ? new Date(record.date_out).toLocaleDateString() : '-'}</td>
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
        document.querySelector('#maintenance-form-modal h3').textContent = 'Modifica Record';
        document.getElementById('maintenance-id').value = record.id;
        document.getElementById('maintenance-date').value = record.date;
        document.getElementById('maintenance-date-out').value = record.date_out || '';
        document.getElementById('maintenance-description').value = record.description;
    } else {
        // Add Mode
        document.querySelector('#maintenance-form-modal h3').textContent = 'Aggiungi Record Manutenzione';
        document.getElementById('maintenance-id').value = '';
        document.getElementById('maintenance-date').valueAsDate = new Date();
        document.getElementById('maintenance-date-out').value = '';
    }

    modal.classList.remove('hidden');
}

window.saveMaintenanceRecord = async function (e) {
    if (e) e.preventDefault(); // Handle form submit event

    const vehicleId = document.getElementById('maintenance-vehicle-id').value;
    const id = document.getElementById('maintenance-id').value;
    const date = document.getElementById('maintenance-date').value;
    const date_out = document.getElementById('maintenance-date-out').value;
    const description = document.getElementById('maintenance-description').value;

    // Fetch vehicle to get sigla
    const vehicle = await store.getVehicleById(vehicleId);
    const vehicleSigla = vehicle ? (vehicle.sigla || vehicle.plate) : 'N/A';

    const record = {
        date,
        date_out: date_out || null,
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
        await openVehicleModal(vehicleId);
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
            console.log('Mileage month saved');
            loadVehicles(); // Refresh the grid to show the new month immediately
        }
    } catch (e) {
        console.error('Error saving mileage month:', e);
        alert('Errore nel salvataggio del mese chilometri');
    }
}

// Note Auto-Save
window.saveVehicleNote = async function (id, text) {
    try {
        const vehicle = await store.getVehicleById(id);
        if (vehicle) {
            vehicle.notes = text;
            await store.updateVehicle(vehicle);
            // Optional: show a small "Saved" toast or indicator, but for now silent is fine
            console.log('Note saved');
            // loadVehicles(); // Notes are not shown on card, so strictly not needed, but good for consistency if we add an indicator later
        }
    } catch (e) {
        console.error('Error saving note:', e);
        alert('Errore nel salvataggio della nota');
    }
}

// --- Data Management System ---

window.openDataManagement = function () {
    document.getElementById('data-management-modal').classList.remove('hidden');
    switchDataTable('vehicles');
}

window.switchDataTable = async function (type) {
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
                <div style="overflow-x: auto;">
                    <table style="width: 100%; border-collapse: collapse; min-width: 1200px;">
                        <thead>
                            <tr style="background: #f8fafc; border-bottom: 2px solid var(--border-color);">
                                <th style="padding: 0.75rem; text-align: left;">IMG</th>
                                <th style="padding: 0.75rem; text-align: left;">Targa</th>
                                <th style="padding: 0.75rem; text-align: left;">Modello</th>
                                <th style="padding: 0.75rem; text-align: left;">Sigla</th>
                                <th style="padding: 0.75rem; text-align: left;">Stazione</th>
                                <th style="padding: 0.75rem; text-align: left;">Stato</th>
                                <th style="padding: 0.75rem; text-align: left;">Km</th>
                                <th style="padding: 0.75rem; text-align: left;">Mese Km</th>
                                <th style="padding: 0.75rem; text-align: left;">Note</th>
                                <th style="padding: 0.75rem; text-align: left;">Barella</th>
                                <th style="padding: 0.75rem; text-align: left;">Radio</th>
                                <th style="padding: 0.75rem; text-align: left;">Aspiratore</th>
                                <th style="padding: 0.75rem; text-align: left;">Rev. Scad.</th>
                                <th style="padding: 0.75rem; text-align: left;">Coll. Scad.</th>
                                <th style="padding: 0.75rem; text-align: right;">Azioni</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${data.map(v => `
                                <tr style="border-bottom: 1px solid var(--border-color);">
                                    <td style="padding: 0.75rem;"><img src="${v.image}" style="width: 40px; height: 30px; object-fit: cover; border-radius: 4px;" onerror="this.src='https://placehold.co/40?text=NA'"></td>
                                    <td style="padding: 0.75rem;">${v.plate}</td>
                                    <td style="padding: 0.75rem;">${v.model}</td>
                                    <td style="padding: 0.75rem; font-weight: bold; color: var(--primary-color);">${v.sigla || '-'}</td>
                                    <td style="padding: 0.75rem;">${v.station}</td>
                                    <td style="padding: 0.75rem;">${v.status}</td>
                                    <td style="padding: 0.75rem;">${v.mileage}</td>
                                    <td style="padding: 0.75rem;">${v.mileage_month || '-'}</td>
                                    <td style="padding: 0.75rem; max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${v.notes || ''}">${v.notes || '-'}</td>
                                    <td style="padding: 0.75rem;">${v.barella_data || '-'}</td>
                                    <td style="padding: 0.75rem;">${v.radio_id || '-'}</td>
                                    <td style="padding: 0.75rem;">${v.aspirator_id || '-'}</td>
                                    <td style="padding: 0.75rem;">${v.inspection_expiry || '-'}</td>
                                    <td style="padding: 0.75rem;">${v.testing_expiry || '-'}</td>
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
                <div style="margin-bottom: 1rem;">
                    <button class="btn btn-primary" onclick="document.getElementById('location-modal').classList.remove('hidden')">
                         <i class="fa-solid fa-plus"></i> Gestisci da Menu Luoghi
                    </button>
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
                                    <button onclick="store.deleteLocation('${l}').then(() => switchDataTable('locations'))" style="cursor:pointer; background:none; border:none; color:var(--status-to-repair);"><i class="fa-solid fa-trash"></i></button>
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
                                <th style="padding: 0.75rem; text-align: left;">Sigla Mezzo</th>
                                <th style="padding: 0.75rem; text-align: left;">Data Entrata</th>
                                <th style="padding: 0.75rem; text-align: left;">Data Uscita</th>
                                <th style="padding: 0.75rem; text-align: left;">Tipo (DB)</th>
                                <th style="padding: 0.75rem; text-align: left;">Descrizione</th>
                                <th style="padding: 0.75rem; text-align: right;">Costo (DB)</th>
                                <th style="padding: 0.75rem; text-align: right;">Azioni</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${data.map(i => `
                                <tr style="border-bottom: 1px solid var(--border-color);">
                                    <td style="padding: 0.75rem; font-weight: bold;">${i.sigla || '-'}</td>
                                    <td style="padding: 0.75rem;">${i.date}</td>
                                    <td style="padding: 0.75rem;">${i.date_out || '-'}</td>
                                    <td style="padding: 0.75rem; font-family:monospace; font-size:0.8rem;">${i.type}</td>
                                    <td style="padding: 0.75rem;">${i.description}</td>
                                    <td style="padding: 0.75rem; text-align: right; font-family:monospace;">€${i.cost}</td>
                                    <td style="padding: 0.75rem; text-align: right;">
                                        <button onclick="store.deleteIntervention('${i.id}').then(() => switchDataTable('interventions'))" style="cursor:pointer; background:none; border:none; color:var(--status-to-repair);"><i class="fa-solid fa-trash"></i></button>
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
