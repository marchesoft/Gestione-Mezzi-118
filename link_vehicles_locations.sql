-- Aggiunge la colonna foreign key per collegare i veicoli ai luoghi
ALTER TABLE public.vehicles 
ADD COLUMN location_id bigint REFERENCES public.luoghi(id);

-- Opzionale: Indice per performance
CREATE INDEX idx_vehicles_location ON public.vehicles(location_id);
