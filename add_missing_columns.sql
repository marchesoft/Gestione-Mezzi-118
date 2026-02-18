-- Aggiunge le colonne mancanti alla tabella vehicles

-- Scadenza Revisione
ALTER TABLE public.vehicles 
ADD COLUMN IF NOT EXISTS inspection_expiry date;

-- Scadenza Rev.O2 (ex Collaudo)
ALTER TABLE public.vehicles 
ADD COLUMN IF NOT EXISTS testing_expiry date;

-- Mese Riferimento Km
ALTER TABLE public.vehicles 
ADD COLUMN IF NOT EXISTS mileage_month text;

-- Note
ALTER TABLE public.vehicles 
ADD COLUMN IF NOT EXISTS notes text;

-- Assicurati che tel1 e tel2 ci siano (nel caso)
ALTER TABLE public.vehicles 
ADD COLUMN IF NOT EXISTS tel1 text;

ALTER TABLE public.vehicles 
ADD COLUMN IF NOT EXISTS tel2 text;
