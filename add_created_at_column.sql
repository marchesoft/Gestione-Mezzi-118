-- Aggiunge la colonna created_at alla tabella vehicles
ALTER TABLE public.vehicles 
ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL;
