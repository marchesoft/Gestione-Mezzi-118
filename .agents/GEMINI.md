# Regole e Contesto del Progetto (v3.1.4)

Questo file definisce le linee guida e lo stato di salvataggio del progetto per garantire la coerenza con la versione **3.1.4**.

## Stato di Riferimento (v3.1.4)

1. **Gestione Versioni**:
   - La versione attuale di riferimento è **3.1.4**.
   - Qualsiasi modifica futura richiede l'avanzamento della versione (es. `3.1.5` o successive) in `app.js` (`const APP_VERSION = "X.Y.Z";`) e in `index.html` (header).

2. **Bypass della Cache (Cache-Busting)**:
   - I file `app.js` e `style.css` sono importati in `index.html` con il parametro di versione `?v=X.Y.Z` per forzare il caricamento immediato degli aggiornamenti sui dispositivi client (specialmente mobili).
   - Esempio: `<link rel="stylesheet" href="style.css?v=3.1.4">` e `<script src="app.js?v=3.1.4"></script>`.
   - Ad ogni cambio di codice, aggiornare questa stringa con la nuova versione dell'applicazione.

3. **Integrazione Git e GitHub**:
   - Ad ogni modifica completata ed approvata, eseguire la messaggistica di commit con il tag della versione ed effettuare il push immediato sul branch `main` dell'origin.

4. **Architettura Dati Firestore**:
   - I **Controlli Mensili** (`monthly_checks`) sono persistiti come array di oggetti (`{ date: 'YYYY-MM-DD', notes: '...', executor: '...', location: '...' }`) direttamente all'interno dei documenti dei veicoli della collection `vehicles`.
   - Le **Richieste di Riparazione** (`repair_requests`) sono persistite come array di oggetti (`{ id: '...', date: 'DD/MM/YYYY', created_at: '...', driver: '...', dept: '...', phone: '...', targa: '...', station: '...', email: '...', checks: [...], types: [...], description: '...', filename: '...' }`) direttamente all'interno dei documenti dei veicoli della collection `vehicles`.
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

7. **Richiesta di Riparazione Word (.docx) e Storico Richieste**:
   - È presente un pulsante blu **Richiesta Riparazione** nei dettagli di ciascun veicolo (`openVehicleModal`) per compilare e scaricare una nuova richiesta.
   - È presente un pulsante azzurro **Storico Richieste** con badge contatore nei dettagli di ciascun veicolo (`openVehicleRepairHistoryModal`) che apre una finestra dedicata con la tabella di tutte le richieste effettuate per quel singolo mezzo, con download Word ed eliminazione per gli amministratori.
   - Il modulo di richiesta contiene:
     - Indicazione del mezzo specifico della card corrente (`#repair-vehicle-display`, campo in sola lettura con sigla, targa e modello).
     - Menu a tendina per selezione ubicazione (`#repair-station`) con tutte le sedi/postazioni disponibili, preselezionata sull'ubicazione attuale del mezzo.
     - Calendario nativo a finestra per selezione data richiesta (`<input type="date" id="repair-date">`) preimpostato sulla data odierna e convertito automaticamente in formato `DD/MM/YYYY`.
     - Dati richiedente precompilati (dipartimento, driver, recapiti), caselle di controllo per tipologia di intervento (Meccanica/Elettrauto, Gommista, Carrozzeria, Lavaggio, Sinistro, Soccorso Stradale) e un'area di testo per descrivere il guasto o i lavori.
   - Il documento Word (`.docx`) generato e scaricato sul PC è identico al template ufficiale `All.1_Richiesta di Riparazione.docx`, preservando tabelle, loghi, caratteri e formattazione, e viene salvato con il prefisso predefinito e il nome del mezzo (es. `richiesta riparazione <SIGLA_MEZZO>.docx`).
   - La generazione avviene interamente client-side tramite `JSZip` e il template incorporato in `repair_template_base64.js`.
   - **Storico Flotta nel Database**: Nella schermata "Gestione Database" è presente la scheda **Riparazioni** che elenca tutte le richieste dell'intera flotta con ricerca, download Word ed esportazione completa in formato Excel/CSV.
