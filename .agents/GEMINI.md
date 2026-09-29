# Regole e Contesto del Progetto (v3.0.9)

Questo file definisce le linee guida e lo stato di salvataggio del progetto per garantire la coerenza con la versione **3.0.9**.

## Stato di Riferimento (v3.0.9)

1. **Gestione Versioni**:
   - La versione attuale di riferimento è **3.0.9**.
   - Qualsiasi modifica futura richiede l'avanzamento della versione (es. `3.1.0` o successive) in `app.js` (`const APP_VERSION = "X.Y.Z";`) e in `index.html` (header).

2. **Bypass della Cache (Cache-Busting)**:
   - I file `app.js` e `style.css` sono importati in `index.html` con il parametro di versione `?v=X.Y.Z` per forzare il caricamento immediato degli aggiornamenti sui dispositivi client (specialmente mobili).
   - Esempio: `<link rel="stylesheet" href="style.css?v=3.0.9">` e `<script src="app.js?v=3.0.9"></script>`.
   - Ad ogni cambio di codice, aggiornare questa stringa con la nuova versione dell'applicazione.

3. **Integrazione Git e GitHub**:
   - Ad ogni modifica completata ed approvata, eseguire la messaggistica di commit con il tag della versione ed effettuare il push immediato sul branch `main` dell'origin.

4. **Architettura Dati Firestore**:
   - I **Controlli Mensili** (`monthly_checks`) sono persistiti come array di oggetti (`{ date: 'YYYY-MM-DD', notes: '...', executor: '...', location: '...' }`) direttamente all'interno dei documenti dei veicoli della collection `vehicles`.
   - Le note **Da Fare** (`todo_notes`) sono persistite come array di stringhe nello stesso documento.
   - Le **Note Interne** (`db_notes`) sono persistite nei documenti `vehicles` e gestibili dalla tabella DB senza apparire sulle card della dashboard.
   - La data di presa visione avviso (`alert_ack_date`) è salvata sul documento veicolo per sincronizzare la presa visione degli alert appuntamento.

5. **Gestione Appuntamenti e Overlay Alert**:
   - Il testo dell'appuntamento (`APPUNTAMENTO: GG/MM/AAAA @ LUOGO`) è sempre mostrato in modo persistente nell'etichetta gialla delle note (`.mobile-notes`) sotto la card.
   - L'indicatore con icona calendario lampeggiante giallo (`.appointment-dot`) è posizionato sulla barra di stato della card quando un appuntamento è programmato.
   - Il popup/overlay giallo di avviso compare per appuntamenti di OGGI o DOMANI; premendo **PRESA VISIONE**, l'avviso viene memorizzato (in `localStorage` e Firestore) e **non ricompare più per l'intera giornata corrente**, nemmeno riavviando o ricaricando la pagina. Si riattiva automaticamente il giorno successivo o se l'amministratore aggiorna l'appuntamento.

6. **Interfaccia Grafica e Layout**:
   - **Dettagli Veicolo (Desktop)**: Le sezioni *Appuntamenti*, *Controllo Mensile* e *Segna le cose da fare* sono allineate orizzontalmente in un layout a tre colonne (`.vehicle-modal-sections-row`) con altezza uniforme su desktop.
   - **Dettagli Veicolo (Mobile)**: Le sezioni si impilano verticalmente per adattarsi allo schermo.
   - **Segna le cose da fare**: Il testo inserito dall'amministratore (nella textarea diviso da invio) viene convertito in array per riga ed inserito in singoli blocchi con bordo grigio ardesia nella cornice griglia.
   - **Pallino Controllo**: L'indicatore di controllo mensile sulla card è giallo fluo (#ffff00) con contorno bianco solido di 2px (classe .monthly-check-dot in style.css), per essere visibile anche sullo sfondo verde dello stato "disponibile" (#008000).
   - **Gestione Database**: Lo storico di tutti i controlli mensili è visibile, modificabile ed eliminabile esclusivamente nella scheda tab "Controlli" del modal "Gestione Database", provvisto di esportazione in formato Excel/CSV. I controlli sono visualizzati raggruppati cronologicamente per mese ed anno con divisori colorati e mostrano le colonne Esecutore e Posizione Attuale.

7. **Richiesta di Riparazione Word (.docx)**:
   - È presente un pulsante blu **Richiesta Riparazione** nei dettagli di ciascun veicolo (`openVehicleModal`).
   - Cliccandolo si apre un modal con i dati del veicolo precompilati (targa, ubicazione, data corrente, richiedente/driver, dipartimento, recapiti), le caselle di controllo per tipologia di intervento (Meccanica/Elettrauto, Gommista, Carrozzeria, Lavaggio, Sinistro, Soccorso Stradale) e un'area di testo per descrivere il guasto o i lavori.
   - Il documento Word (`.docx`) generato e scaricato sul PC è identico al template ufficiale `All.1_Richiesta di Riparazione.docx`, preservando tabelle, loghi, caratteri e formattazione, e viene salvato con il nome del mezzo (es. `<SIGLA_MEZZO>.docx`).
   - La generazione avviene interamente client-side tramite `JSZip` e il template incorporato in `repair_template_base64.js`.
