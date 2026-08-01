try {
    class Store {
        constructor() {
            // 'db' is initialized in firebase-config.js
            this.db = db;
        }

        // --- Vehicles ---

        async getVehicles() {
            try {
                const vSnapshot = await this.db.collection('vehicles').get();
                const vehicles = vSnapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }));

                const iSnapshot = await this.db.collection('interventions').orderBy('date', 'desc').get();
                const allInterventions = iSnapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }));

                const interventionsByVehicle = allInterventions.reduce((acc, curr) => {
                    if (!acc[curr.vehicle_id]) acc[curr.vehicle_id] = [];
                    acc[curr.vehicle_id].push(curr);
                    return acc;
                }, {});

                vehicles.forEach(vehicle => {
                    vehicle.maintenanceHistory = interventionsByVehicle[vehicle.id] || [];
                });

                return vehicles;
            } catch (error) {
                console.error('Error fetching vehicles:', error);
                return [];
            }
        }

        async getVehicleById(id) {
            try {
                const doc = await this.db.collection('vehicles').doc(id).get();
                if (!doc.exists) return null;

                const data = { ...doc.data(), id: doc.id };

                // Note: Removed .orderBy from query to avoid composite index requirement.
                // We'll sort in JavaScript.
                const iSnapshot = await this.db.collection('interventions')
                    .where('vehicle_id', '==', id)
                    .get();

                data.maintenanceHistory = iSnapshot.docs
                    .map(iDoc => ({ ...iDoc.data(), id: iDoc.id }))
                    .sort((a, b) => new Date(b.date) - new Date(a.date));

                return data;
            } catch (error) {
                console.error('Error fetching vehicle:', error);
                // Don't just return null, return what we have or rethink
                return null;
            }
        }

        async addVehicle(vehicle) {
            const { maintenanceHistory, ...vehicleData } = vehicle;
            try {
                await this.db.collection('vehicles').add(vehicleData);
            } catch (error) {
                console.error('Error adding vehicle:', error);
                alert("Errore salvataggio veicolo: " + error.message);
            }
        }

        async updateVehicle(vehicle) {
            const { id, maintenanceHistory, ...vehicleData } = vehicle;
            try {
                await this.db.collection('vehicles').doc(id).update(vehicleData);
            } catch (error) {
                console.error('Error updating vehicle:', error);
                alert("Errore aggiornamento veicolo: " + error.message);
            }
        }

        async deleteVehicle(id) {
            try {
                await this.db.collection('vehicles').doc(id).delete();
            } catch (error) {
                console.error('Error deleting vehicle:', error);
                alert("Errore eliminazione veicolo: " + error.message);
            }
        }

        // --- Locations ---

        async getLocations() {
            try {
                const snapshot = await this.db.collection('locations').get();
                return snapshot.docs.map(doc => {
                    const data = doc.data();
                    return { luogo: data.name, colore: data.colore };
                });
            } catch (error) {
                console.error('Error fetching locations:', error);
                return [];
            }
        }

        async addLocation(name, colore = '#3b82f6') {
            try {
                await this.db.collection('locations').add({ name, colore });
            } catch (error) {
                console.error('Error adding location:', error);
            }
        }

        async deleteLocation(name) {
            try {
                const snapshot = await this.db.collection('locations').where('name', '==', name).get();
                const batch = this.db.batch();
                snapshot.forEach(doc => batch.delete(doc.ref));
                await batch.commit();
            } catch (error) {
                console.error('Error deleting location:', error);
            }
        }

        async updateLocation(oldName, newName) {
            try {
                const snapshot = await this.db.collection('locations').where('name', '==', oldName).get();
                const batch = this.db.batch();
                snapshot.forEach(doc => batch.update(doc.ref, { name: newName }));
                await batch.commit();
            } catch (error) {
                console.error('Error updating location:', error);
            }
        }

        // --- Maintenance / Interventions ---

        async getInterventions() {
            try {
                const snapshot = await this.db.collection('interventions').orderBy('date', 'desc').get();
                const interventions = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }));

                // To get sigla, we'd need another fetch or a join. 
                // In Firestore, we usually denormalize or fetch separately.
                const vSnapshot = await this.db.collection('vehicles').get();
                const vehiclesMap = vSnapshot.docs.reduce((acc, doc) => {
                    acc[doc.id] = doc.data().sigla;
                    return acc;
                }, {});

                return interventions.map(i => ({
                    ...i,
                    sigla: vehiclesMap[i.vehicle_id] || 'N/A'
                }));
            } catch (error) {
                console.error('Error fetching interventions:', error);
                return [];
            }
        }

        async deleteIntervention(id) {
            try {
                await this.db.collection('interventions').doc(id).delete();
            } catch (error) {
                console.error('Error deleting intervention:', error);
                alert("Errore eliminazione intervento: " + error.message);
            }
        }

        async addIntervention(vehicleId, intervention) {
            const { sigla, ...cleanIntervention } = intervention;
            try {
                await this.db.collection('interventions').add({
                    vehicle_id: vehicleId,
                    ...cleanIntervention
                });
            } catch (error) {
                console.error('Error adding intervention:', error);
                alert("Errore salvataggio intervento: " + error.message);
                throw error;
            }
        }

        async updateIntervention(id, intervention) {
            const { sigla, vehicle_id, ...cleanIntervention } = intervention;
            try {
                await this.db.collection('interventions').doc(id).update(cleanIntervention);
            } catch (error) {
                console.error('Error updating intervention:', error);
                alert("Errore aggiornamento intervento: " + error.message);
            }
        }

        // --- Cambi Mezzi ---

        async getCambiMezzi() {
            try {
                const snapshot = await this.db.collection('cambiomezzo').orderBy('data', 'desc').get();
                return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            } catch (error) {
                console.error('Error fetching cambi mezzi:', error);
                return [];
            }
        }

        async addCambioMezzo(cambio) {
            try {
                await this.db.collection('cambiomezzo').add(cambio);
            } catch (error) {
                console.error('Error adding cambio mezzo:', error);
                alert("Errore salvataggio cambio mezzo: " + error.message);
                throw error;
            }
        }

        async updateCambioMezzo(id, data) {
            try {
                await this.db.collection('cambiomezzo').doc(id).update(data);
                return true;
            } catch (error) {
                console.error('Error updating cambio mezzo:', error);
                throw error;
            }
        }

        async deleteCambioMezzo(id) {
            try {
                await this.db.collection('cambiomezzo').doc(id).delete();
            } catch (error) {
                console.error('Error deleting cambio mezzo:', error);
                alert("Errore eliminazione cambio mezzo: " + error.message);
            }
        }

        // --- Contacts ---

        async getContacts() {
            try {
                // Firestore doesn't support multiple orderBys easily without indexes, 
                // but we can sort locally or use a single one.
                const snapshot = await this.db.collection('contacts').orderBy('category', 'desc').get();
                let contacts = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                // Secondary sort in JS
                return contacts.sort((a, b) => {
                    if (a.category === b.category) {
                        return (a.name || '').localeCompare(b.name || '');
                    }
                    return 0;
                });
            } catch (error) {
                console.error('Error fetching contacts:', error);
                return [];
            }
        }

        async addContact(contact) {
            try {
                await this.db.collection('contacts').add(contact);
            } catch (error) {
                console.error('Error adding contact:', error);
                alert("Errore salvataggio contatto: " + error.message);
                throw error;
            }
        }

        async updateContact(id, data) {
            try {
                await this.db.collection('contacts').doc(id).update(data);
            } catch (error) {
                console.error('Error updating contact:', error);
                alert("Errore aggiornamento contatto: " + error.message);
                throw error;
            }
        }

        async deleteContact(id) {
            try {
                await this.db.collection('contacts').doc(id).delete();
            } catch (error) {
                console.error('Error deleting contact:', error);
                alert("Errore eliminazione contatto: " + error.message);
                throw error;
            }
        }

        async upsertData(table, rows) {
            try {
                const batch = this.db.batch();
                rows.forEach(row => {
                    const { id, ...data } = row;
                    const docRef = id ? this.db.collection(table).doc(id) : this.db.collection(table).doc();
                    batch.set(docRef, data, { merge: true });
                });
                await batch.commit();
            } catch (error) {
                console.error(`Error upserting data to ${table}:`, error);
                throw error;
            }
        }

        async getOperationalNotes() {
            try {
                const doc = await this.db.collection('operational_notes').doc('current').get();
                if (doc.exists) return doc.data();
                return { da_fare: '', assegnazioni: '' };
            } catch (error) {
                console.error('Error fetching operational notes:', error);
                return { da_fare: '', assegnazioni: '' };
            }
        }

        async saveOperationalNotes(notes) {
            try {
                await this.db.collection('operational_notes').doc('current').set(notes, { merge: true });
            } catch (error) {
                console.error('Error saving operational notes:', error);
                throw error;
            }
        }
    }

    const store = new Store();
    window.store = store;
} catch (e) {
    var msg = 'STORE.JS ERROR: ' + e.message;
    var el = document.createElement('div');
    el.style.cssText = 'background:blue;color:white;z-index:99999;position:fixed;top:180px;left:0;padding:20px;width:100%;font-size:20px;';
    el.innerText = msg;
    document.body.appendChild(el);
}
