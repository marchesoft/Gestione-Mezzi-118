-- Abilita RLS su vehicles (se non lo è già)
ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;

-- Crea una policy che permette TUTTO a TUTTI (lettura, scrittura, modifica, eliminazione)
-- Nota: In un'app reale dovresti restringere questi permessi.
CREATE POLICY "Enable all access for all users" ON public.vehicles
FOR ALL USING (true) WITH CHECK (true);

-- Abilita RLS su interventions (già che ci siamo, per evitare problemi futuri)
ALTER TABLE public.interventions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable all access for all users" ON public.interventions
FOR ALL USING (true) WITH CHECK (true);
