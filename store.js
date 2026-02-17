
const SUPABASE_URL = 'https://iwpfhxgijqeemvsyjhvy.supabase.co';
const SUPABASE_KEY = 'sb_publishable_y2QOHvnU2SqI03A0i1HHew_ArjXlqDm'; // Publishable Key

class Store {
    constructor() {
        this.supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    }

    // --- Vehicles ---

    async getVehicles() {
        const { data, error } = await this.supabase
            .from('vehicles')
            .select('*');
        if (error) {
            console.error('Error fetching vehicles:', error);
            return [];
        }

        // Fetch maintenance history for each vehicle (approximated for now)
        // Ideally we would join, but for compatibility with existing app structure 
        // we might handle it differently. 
        // For now, let's just get the vehicles. The app expects a 'maintenanceHistory' array property.
        // We will fetch interventions separately or join.
        // Let's do a simple join or separate fetch.
        // To keep it simple for this step, let's attach interventions.

        for (let vehicle of data) {
            const { data: interventions } = await this.supabase
                .from('interventions')
                .select('*')
                .eq('vehicle_id', vehicle.id)
                .order('date', { ascending: false });
            vehicle.maintenanceHistory = interventions || [];
        }

        return data || [];
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
            .select('name');

        if (error) return [];
        return data.map(l => l.name);
    }

    async addLocation(name) {
        const { error } = await this.supabase
            .from('locations')
            .insert([{ name }]);
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
}

const store = new Store();
