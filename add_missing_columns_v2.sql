-- Aggiunge altre colonne mancanti alla tabella vehicles

-- Tipo veicolo (es. Ambulanza, Automedica...)
ALTER TABLE public.vehicles 
ADD COLUMN IF NOT EXISTS type text DEFAULT 'Ambulanza';

-- ID Radio
ALTER TABLE public.vehicles 
ADD COLUMN IF NOT EXISTS radio_id text;
