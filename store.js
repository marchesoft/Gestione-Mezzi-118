
const SUPABASE_URL = 'https://iwpfhxgijqeemvsyjhvy.supabase.co';
const SUPABASE_KEY = 'sb_publishable_y2QOHvnU2SqI03A0i1HHew_ArjXlqDm'; // Publishable Key

class Store {
    constructor() {
        this.supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    }

    // --- Vehicles ---

    async getVehicles() {
        const { data: vehicles, error: vError } = await this.supabase
            .from('vehicles')
            .select('*');

        if (vError) {
            console.error('Error fetching vehicles:', vError);
            return [];
        }

        // Fetch all interventions in one go to avoid N+1 queries
        const { data: allInterventions, error: iError } = await this.supabase
            .from('interventions')
            .select('*')
            .order('date', { ascending: false });

        if (iError) {
            console.error('Error fetching interventions:', iError);
        }

        // Map interventions to vehicles
        const interventionsByVehicle = (allInterventions || []).reduce((acc, curr) => {
            if (!acc[curr.vehicle_id]) acc[curr.vehicle_id] = [];
            acc[curr.vehicle_id].push(curr);
            return acc;
        }, {});

        vehicles.forEach(vehicle => {
            vehicle.maintenanceHistory = interventionsByVehicle[vehicle.id] || [];
        });

        return vehicles;
    }

    async getVehicleById(id) {
        const { data, error } = await this.supabase
            .from('vehicles')
            .select('*')
            .eq('id', id)
            .single();

        if (data) {
            const { data: interventions } = await this.supabase
                .from('interventions')
                .select('*')
                .eq('vehicle_id', id)
                .order('date', { ascending: false });
            data.maintenanceHistory = interventions || [];
        }

        return data;
    }

    async addVehicle(vehicle) {
        // Separate vehicle data from maintenance history
        const { maintenanceHistory, ...vehicleData } = vehicle;

        const { error } = await this.supabase
            .from('vehicles')
            .insert([vehicleData]);

        if (error) {
            console.error('Error adding vehicle:', error);
            alert("Errore salvataggio veicolo: " + error.message);
        }
    }

    async updateVehicle(vehicle) {
        const { maintenanceHistory, ...vehicleData } = vehicle;
        const { error } = await this.supabase
            .from('vehicles')
            .update(vehicleData)
            .eq('id', vehicle.id);

        if (error) {
            console.error('Error updating vehicle:', error);
            alert("Errore aggiornamento veicolo: " + error.message);
        }
    }

    async deleteVehicle(id) {
        const { error } = await this.supabase
            .from('vehicles')
            .delete()
            .eq('id', id);

        if (error) {
            console.error('Error deleting vehicle:', error);
            alert("Errore eliminazione veicolo: " + error.message);
        }
    }

    // --- Locations ---

    async getLocations() {
        const { data, error } = await this.supabase
            .from('locations')
            .select('name, colore');

        if (error) return [];
        // Map name to luogo for consistency with UI expectation
        return data.map(l => ({ luogo: l.name, colore: l.colore }));
    }

    async addLocation(name, colore = '#3b82f6') {
        const { error } = await this.supabase
            .from('locations')
            .insert([{ name, colore }]);
        if (error) console.error('Error adding location:', error);
    }

    async deleteLocation(name) {
        const { error } = await this.supabase
            .from('locations')
            .delete()
            .eq('name', name);
        if (error) console.error('Error deleting location:', error);
    }

    async updateLocation(oldName, newName) {
        // Update location table
        const { error } = await this.supabase
            .from('locations')
            .update({ name: newName })
            .eq('name', oldName);

        if (error) {
            console.error('Error updating location:', error);
            return;
        }

        // Update vehicles (Postgres ON UPDATE CASCADE should handle this if defined in schema, 
        // but if we used loose foreign keys or text fields, we might need manual update.
        // My schema said: station TEXT REFERENCES locations(name) ON UPDATE CASCADE
        // So this should be automatic!)
    }

    // --- Maintenance / Interventions ---

    async getInterventions() {
        const { data, error } = await this.supabase
            .from('interventions')
            .select('*')
            .order('date', { ascending: false });

        if (error) {
            console.error('Error fetching interventions:', error);
            return [];
        }
        return data;
    }

    async deleteIntervention(id) {
        const { error } = await this.supabase
            .from('interventions')
            .delete()
            .eq('id', id);

        if (error) {
            console.error('Error deleting intervention:', error);
            alert("Errore eliminazione intervento: " + error.message);
        }
    }

    async addIntervention(vehicleId, intervention) {
        // Intervention object usually has date, type, description, cost
        const { error } = await this.supabase
            .from('interventions')
            .insert([{
                vehicle_id: vehicleId,
                ...intervention
            }]);
        if (error) {
            console.error('Error adding intervention:', error);
            alert("Errore salvataggio intervento: " + error.message);
            throw error; // Re-throw to catch in app.js
        }
    }

    async updateIntervention(id, intervention) {
        const { error } = await this.supabase
            .from('interventions')
            .update(intervention)
            .eq('id', id);

        if (error) {
            console.error('Error updating intervention:', error);
            alert("Errore aggiornamento intervento: " + error.message);
        }
    }

    // --- Cambi Mezzi ---

    async getCambiMezzi() {
        const { data, error } = await this.supabase
            .from('cambiomezzo')
            .select('*')
            .order('data', { ascending: false });

        if (error) {
            console.error('Error fetching cambi mezzi:', error);
            return [];
        }
        return data;
    }

    async addCambioMezzo(cambio) {
        const { error } = await this.supabase
            .from('cambiomezzo')
            .insert([cambio]);

        if (error) {
            console.error('Error adding cambio mezzo:', error);
            alert("Errore salvataggio cambio mezzo: " + error.message);
            throw error;
        }
    }

    async updateCambioMezzo(id, data) {
        const { error } = await this.supabase
            .from('cambiomezzo')
            .update(data)
            .eq('id', id);

        if (error) throw error;
        return true;
    }

    async deleteCambioMezzo(id) {
        const { error } = await this.supabase
            .from('cambiomezzo')
            .delete()
            .eq('id', id);

        if (error) {
            console.error('Error deleting cambio mezzo:', error);
            alert("Errore eliminazione cambio mezzo: " + error.message);
        }
    }

    // --- Contacts ---

    async getContacts() {
        const { data, error } = await this.supabase
            .from('contacts')
            .select('*')
            .order('category', { ascending: false }) // 'sedi' before 'officine'
            .order('name', { ascending: true });

        if (error) {
            console.error('Error fetching contacts:', error);
            return [];
        }
        return data;
    }

    async addContact(contact) {
        const { error } = await this.supabase
            .from('contacts')
            .insert([contact]);

        if (error) {
            console.error('Error adding contact:', error);
            alert("Errore salvataggio contatto: " + error.message);
            throw error;
        }
    }

    async updateContact(id, data) {
        const { error } = await this.supabase
            .from('contacts')
            .update(data)
            .eq('id', id);

        if (error) {
            console.error('Error updating contact:', error);
            alert("Errore aggiornamento contatto: " + error.message);
            throw error;
        }
    }

    async deleteContact(id) {
        const { error } = await this.supabase
            .from('contacts')
            .delete()
            .eq('id', id);

        if (error) {
            console.error('Error deleting contact:', error);
            alert("Errore eliminazione contatto: " + error.message);
            throw error;
        }
    }
}

const store = new Store();
