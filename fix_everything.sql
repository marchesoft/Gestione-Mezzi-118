-- SCRIPT DI RIPARAZIONE TOTALE
-- Esegui tutto questo blocco per assicurarti che tutto sia configurato correttamente.

-- 1. Assicurati che le tabelle abbiano RLS abilitato
ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.luoghi ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.interventions ENABLE ROW LEVEL SECURITY;

-- 2. Elimina le policy vecchie per evitare duplicati/conflitti
DROP POLICY IF EXISTS "Enable all access for all users" ON public.vehicles;
DROP POLICY IF EXISTS "Enable all access for vehicles" ON public.vehicles;
DROP POLICY IF EXISTS "Enable all access for all users" ON public.luoghi;
DROP POLICY IF EXISTS "Enable all access for all users" ON public.interventions;
DROP POLICY IF EXISTS "Enable all access for interventions" ON public.interventions;

-- 3. Ricrea le policy PERMISSIVE per tutte le tabelle
CREATE POLICY "Public Access Vehicles" ON public.vehicles FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public Access Luoghi" ON public.luoghi FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public Access Interventions" ON public.interventions FOR ALL USING (true) WITH CHECK (true);

-- 4. Verifica/Aggiunta Foreign Key
-- Tentiamo di aggiungere la FK solo se non esiste (approccio semplice: droppiamo e ricreiamo la constraint se necessario, ma qui facciamo semplice)
-- Se ti da errore che la relazione non esiste, questo la aggiungerà.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'vehicles_location_id_fkey') THEN
        ALTER TABLE public.vehicles 
        ADD CONSTRAINT vehicles_location_id_fkey 
        FOREIGN KEY (location_id) 
        REFERENCES public.luoghi(id);
    END IF;
END $$;
