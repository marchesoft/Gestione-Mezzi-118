# Regole e Contesto del Progetto (v2.3.0)

Questo file definisce le linee guida e lo stato di salvataggio del progetto per garantire la coerenza con la versione **2.3.0**.

## Stato di Riferimento (v2.3.0)

1. **Gestione Versioni**:
   - La versione attuale di riferimento è **2.3.0**.
   - Qualsiasi modifica futura richiede l'avanzamento della versione (es. `2.3.1` o successive) in `app.js` (`const APP_VERSION = "X.Y.Z";`) e in `index.html` (header).

2. **Bypass della Cache (Cache-Busting)**:
   - I file `app.js` e `style.css` sono importati in `index.html` con il parametro di versione `?v=X.Y.Z` per forzare il caricamento immediato degli aggiornamenti sui dispositivi client (specialmente mobili).
   - Esempio: `<link rel="stylesheet" href="style.css?v=2.3.0">` and `<script src="app.js?v=2.3.0"></script>`.
   - Ad ogni cambio di codice, aggiornare questa stringa con la nuova versione dell'applicazione.

3. **Integrazione Git e GitHub**:
   - Ad ogni modifica completata ed approvata, eseguire la messaggistica di commit con il tag della versione ed effettuare il push immediato sul branch `main` dell'origin.

4. **Architettura Dati Firestore**:
   - I **Controlli Mensili** (`monthly_checks`) sono persistiti come array di oggetti (`{ date: 'YYYY-MM-DD', notes: '...' }`) direttamente all'interno dei documenti dei veicoli della collection `vehicles`.
   - Le note **Da Fare** (`todo_notes`) sono persistite come array di stringhe nello stesso documento.

5. **Interfaccia Grafica e Layout**:
   - **Dettagli Veicolo (Desktop)**: Le sezioni *Appuntamenti*, *Controllo Mensile* e *Segna le cose da fare* sono allineate orizzontalmente in un layout a tre colonne (`.vehicle-modal-sections-row`) con altezza uniforme su desktop.
   - **Dettagli Veicolo (Mobile)**: Le sezioni si impilano verticalmente per adattarsi allo schermo.
   - **Segna le cose da fare**: Il testo inserito dall'amministratore (nella textarea diviso da invio) viene convertito in array per riga ed inserito in singoli blocchi con bordo grigio ardesia nella cornice griglia.
   - **Pallino Controllo**: L'indicatore di controllo mensile sulla card è verde lime piatto (`#a3e635`) con contorno bianco solido di 2px (classe `.monthly-check-dot` in `style.css`), per essere visibile anche sullo sfondo verde dello stato "disponibile" (#008000).
   - **Gestione Database**: Lo storico di tutti i controlli mensili è visibile, modificabile ed eliminabile esclusivamente nella scheda tab "Controlli" del modal "Gestione Database", provvisto di esportazione in formato Excel/CSV.
