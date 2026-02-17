const MOCK_VEHICLES = [
    {
        id: "VEH-1",
        plate: "AB-123-CD",
        model: "Fiat Ducato",
        type: "Ambulanza",
        status: "available",
        station: "Piazzale Logistica", // Default starting location
        image: "https://images.unsplash.com/photo-1588611910609-0d535eb7b376?auto=format&fit=crop&q=80&w=800",
        mileage: 10000,
        maintenanceHistory: []
    }
];

// If localstorage is empty or has old data structure (check if array has length > 1 if we want strict reset? No, let's just use the key check)
// Actually, to force the update for the user, we might want to clear existing data, but that's risky. 
// BUT the user asked to "start with one vehicle". 
// I will check if localStorage exists. If it does, I will NOT overwrite it automatically unless I add a reset flag.
// However, effectively for this "demo" to work as requested, maybe I should just use the mock data if the user hasn't made changes?
// Let's implement a 'reset' logic in app.js or simply instruct user to clear cache?
// Better: Check a version flag or just rely on manual reset.
// For now, I'll update the initial seed. If the user already ran the app, they have data. 
// I will add a "Reset App" button in settings or just rely on them clearing.
// Actually, I can force a reset by changing the key name or checking.
// Let's just update the seed.

if (!localStorage.getItem('fleet_vehicles_v2')) { // Changed key to force new data
    localStorage.setItem('fleet_vehicles_v2', JSON.stringify(MOCK_VEHICLES));
}

// Migration for existing users (optional, but good practice)
// If old key exists and new one doesn't, we could migrate.
// but user said "start with one vehicle", implying a fresh start.
// So using a new key 'fleet_vehicles_v2' is a good way to give them a fresh state without destroying the old key if they needed it.
