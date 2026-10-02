# Regole e Contesto del Progetto (v3.3.15)

Questo file definisce le linee guida e lo stato di salvataggio del progetto per garantire la coerenza con la versione **3.3.15**.

## Stato di Riferimento (v3.3.15)

1. **Gestione Versioni**:
   - La versione attuale di riferimento è **3.3.15**.
   - Qualsiasi modifica futura richiede l'avanzamento della versione (es. `3.3.16` o successive) in `app.js` (`const APP_VERSION = "X.Y.Z";`) e in `index.html` (header).

2. **Bypass della Cache (Cache-Busting)**:
   - I file `app.js` e `style.css` sono importati in `index.html` con il parametro di versione `?v=X.Y.Z` per forzare il caricamento immediato degli aggiornamenti sui dispositivi client (specialmente mobili).
   - Esempio: `<link rel="stylesheet" href="style.css?v=3.3.15">` e `<script src="app.js?v=3.3.15"></script>`.
   - Ad ogni cambio di codice, aggiornare questa stringa con la nuova versione dell'applicazione.

3. **Integrazione Git e GitHub**:
   - Ad ogni modifica completata ed approvata, eseguire la messaggistica di commit con il tag della versione ed effettuare il push immediato sul branch `main` dell'origin.

4. **Architettura Dati Firestore**:
   - I **Controlli Mensili** (`monthly_checks`) sono persistiti come array di oggetti (`{ date: 'YYYY-MM-DD', notes: '...', executor: '...', location: '...' }`) direttamente all'interno dei documenti dei veicoli della collection `vehicles`.
   - Le **Richieste di Riparazione** (`repair_requests`) sono persistite come array di oggetti (`{ id: '...', is_alea: true/false, date: 'DD/MM/YYYY', created_at: '...', driver: '...', dept: '...', phone: '...', targa: '...', station: '...', email: '...', checks: [...], types: [...], description: '...', filename: '...' }`) direttamente all'interno dei documenti dei veicoli della collection `vehicles`.
   - Il flag **Mezzo Alea** (`is_alea: true/false`) è persistito direttamente nei documenti `vehicles` e gestibile dal form amministrativo di modifica mezzo (`vehicle-form-modal`), oltre che salvato automaticamente all'emissione di una richiesta Alea.
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
   - **Badge Flotta Alea**: Nei dettagli del veicolo (`openVehicleModal`), se il mezzo appartiene alla flotta Alea compare un badge dorato `ALEA` ben visibile accanto alla sigla e alla targa.
   - **Segna le cose da fare**: Il testo inserito dall'amministratore (nella textarea diviso da invio) viene convertito in array per riga ed inserito in singoli blocchi con bordo grigio ardesia nella cornice griglia.
   - **Pallino Controllo**: L'indicatore di controllo mensile sulla card è giallo fluo (#ffff00) con contorno bianco solido di 2px (classe .monthly-check-dot in style.css), per essere visibile anche sullo sfondo verde dello stato "disponibile" (#008000).
   - **Gestione Database**: Lo storico di tutti i controlli mensili è visibile, modificabile ed eliminabile esclusivamente nella scheda tab "Controlli" del modal "Gestione Database", provvisto di esportazione in formato Excel/CSV. I controlli sono visualizzati raggruppati cronologicamente per mese ed anno con divisori colorati e mostrano le colonne Esecutore e Posizione Attuale.

7. **Richiesta di Riparazione Word (.docx) ed Esclusività dei Modelli (v3.3.15)**:
   - È presente un pulsante verde **Richiesta Riparazione** (`.btn-repair-request`, colore `#16a34a`) nei dettagli di ciascun veicolo (`openVehicleModal`) per compilare e memorizzare una nuova richiesta.
   - È presente un pulsante azzurro **Storico Richieste** con badge contatore nei dettagli di ciascun veicolo (`openVehicleRepairHistoryModal`) che apre una finestra dedicata con la tabella di tutte le richieste effettuate per quel singolo mezzo, con download Word ed eliminazione per gli amministratori. La finestra dello storico è una vista di sola consultazione/download provvista esclusivamente del pulsante **Chiudi**.
   - **Tipologia Intervento di Default**: Nel modulo di richiesta riparazione, la casella **Manutenzione Meccanica / Elettrauto** (`repair-chk-meccanica`) è selezionata di default (`checked`), mentre le altre opzioni rimangono deselezionate.
   - **Pulsante Salva (v3.3.15)**: Il pulsante principale nel modale `#repair-request-modal` è denominato **Salva** (`#repair-submit-btn` con icona floppy disk `fa-floppy-disk`), il quale:
     1. Memorizza contestualmente la richiesta nello storico del veicolo su Firestore.
     2. Copia automaticamente negli appunti di sistema (clipboard) il testo della cella/input con i dati del veicolo (`repair-vehicle-display`, es. `ECHO 01 - FX 123 AB - (Fiat Ducato)`), consentendo di incollarlo immediatamente ovunque necessario.
     3. Genera e scarica il file Word (.docx) compilato sul computer e chiude la finestra. Il documento Word (.docx) rimane inoltre sempre scaricabile su richiesta dall'apposito pulsante *Scarica Word* presente nello *Storico Richieste* o dalla sezione *Riparazioni* in Gestione Database.
   - **Esclusività Assoluta dei Modelli Word**:
     - Nei mezzi appartenenti alla flotta **Alea** è presente **ESCLUSIVAMENTE lo stampato ufficiale Alea** (banner ambra dedicato, pulsante *Salva*, nessun selettore standard consentito).
     - In tutti gli altri mezzi non Alea è presente **ESCLUSIVAMENTE lo stampato standard 118** (banner blu dedicato, pulsante *Salva*, nessun selettore Alea consentito).
   - **Nome del File Scaricato**: Il file generato viene salvato includendo **prima la sigla del mezzo e poi la targa** (es. `richiesta riparazione <SIGLA> <TARGA>.docx`), sia al momento della creazione che nei successivi download dallo storico.
   - La generazione avviene interamente client-side tramite `JSZip` e il template incorporato in `repair_template_base64.js` o `alea_template_base64.js`.
   - **Storico Flotta nel Database**: Nella schermata "Gestione Database" è presente la scheda **Riparazioni** che elenca tutte le richieste dell'intera flotta con ricerca, download Word ed esportazione completa in formato Excel/CSV.

8. **Richiesta Modulo Lavaggio ECHO 22 (FF 837 RS)**:
   - Registrata ed inserita nello storico richieste di riparazione dell'ambulanza Alea **ECHO 22 (targa FF 837 RS)** la richiesta di modulo lavaggio esterno per ricovero veicolo presso officina **CAVAGION** con data **29/01/2026**.
   - La richiesta è visibile sia nello storico richieste del singolo mezzo che nella tabella globale "Riparazioni" del database, ed è scaricabile in formato Word con il modello dedicato Alea.

9. **Modulo Lavaggio Esterno - Stampato Ufficiale Parts & Services e Stampa Diretta (v3.3.10)**:
   - Nella scheda dettagli veicolo (`openVehicleModal`) è presente un pulsante dedicato **Modulo Lavaggio** (`.btn-wash-request`, colore azzurrino acqua / cyan `#06b6d4`, hover `#0891b2`), cromaticamente distinto dal pulsante verde prato "Richiesta Riparazione" (`#16a34a`) e dall'azzurro "Storico Richieste" (`#0284c7`).
   - Apre una finestra modale compilabile dedicata (`#wash-modal`) per verificare e modificare i dati prima di inviare lo stampato direttamente alla stampante (o salvare come PDF dal dialogo di stampa).
   - **Campi Compilabili e Precompilati Dinamici**:
     - *Dati Veicolo*: Veicolo (es. `AMBULANZA FF 837 RS ECHO 22`), Km rilevati, Data modulo (preimpostata alla data odierna), Officina convenzionata (*IP VIA CANAPA* di default, oppure *CAVAGION*).
     - *Tipologia di Intervento Esclusiva*: Selezione radio tra `LAVAGGIO ESTERNO` (predefinita) e `LAVAGGIO ESTERNO E INTERNO`.
     - *Dati Richiedente / Consegna e Ritiro*: Nominativi incaricati (`MARSILI PAOLO – GAMBERONI FEDERICO – MARCHESINI LUCA`), Email istituzionale (`logistica118fe@ausl.fe.it`), Cellulare (`3209229345`).
   - **Invio Diretto alla Stampante (`printWashModule`)**:
     - Cliccando sul pulsante **Stampa** (`.btn-wash-request` con icona `fa-print`), il sistema genera ed invia direttamente alla stampante di sistema il layout A4 ufficiale Parts & Services (*Ricovero Veicolo per manutenzione - consegna/Ritiro*).
     - Include l'intestazione grafica con logo Parts & Services estratto al volo dal template incorporato, spaziatura corretta, sezioni speculari di Consegna e Ritiro, data formattata e piè di pagina aziendale.
   - **Regola di Non-Persistenza**: Questo modulo serve esclusivamente come stampato compilabile da mandare in stampa immediata e **NON viene salvato nello storico delle richieste del veicolo né su Firestore**.

10. **Report Tempo di Permanenza in Officina per Mezzo (v3.2.8)**:
    - Accessibile direttamente dalla finestra **Gestione Database** tramite:
      1. Il pulsante tab dedicato **Report Officina** (`switchDataTable('report_officina')`) nella barra superiore delle sezioni.
      2. Il pulsante in evidenza **Report Tempi Officina** all'interno della scheda *Interventi*.
    - **Metriche e KPI Flotta**: Schede riassuntive che mostrano i *Giorni Totali Fermo Flotta*, i *Ricoveri Complessivi* e i *Mezzi Attualmente in Officina*.
    - **Analisi Snellita per Singola Ambulanza**:
      - Tabella a 5 colonne pulita ed essenziale: *Mezzo (Sigla e Targa, con eventuale badge Alea)*, *Modello*, *Ultimi Km Rilevati*, *Giorni in Officina* e *N° Ricoveri*.
      - **Ultimi Km Rilevati**: Colonna posizionata subito dopo *Modello*, mostra il chilometraggio rilevato con separatore di migliaia e il mese di riferimento sotto (es. `AGOSTO`).
      - Rimossi i dettagli espandibili a fisarmonica, la colonna media giorni, la colonna *Sede Attuale* e la colonna *Stato Attuale*.
    - **Filtri e Ricerca**:
      - Ricerca istantanea testuale (per Sigla, Targa, Officina).
      - Filtro dinamico per Anno (solo anni specifici disponibili, senza opzione "Tutti gli anni"). Al primo caricamento viene selezionato automaticamente l'anno più recente con dati.
      - Selettore "Mostra solo con ricoveri" per escludere i mezzi senza passaggi in officina.
    - **Esportazione Excel (CSV con BOM UTF-8)**:
      - *Esporta Riepilogo Excel*: Scarica il foglio aggregato con Sigla, Targa, Modello, Sede, Km Mensili Sede, Ultimi Km Rilevati, Mese Riferimento Km, Stima Km Fine Dicembre, Totale Giorni, Numero Ricoveri.
      - (v3.3.12) Rimosso il pulsante "Esporta Dettaglio Singoli Ricoveri" per mantenere la barra degli strumenti essenziale e focalizzata sul riepilogo flotta.

11. **Correzione Eliminazione Richieste di Lavaggio dalla Tabella Riparazioni (v3.2.7)**:
    - Risolto il bug per cui le richieste di lavaggio esterno (tipologia `Autolavaggio`) non potevano essere eliminate dalla scheda **Riparazioni** della Gestione Database né dallo storico del singolo mezzo.
    - **Causa Radice**: La funzione `syncHistoricalWashRequest` rilevava se la richiesta ECHO 22 era stata eliminata e la ricreava automaticamente su Firestore ad ogni apertura del modale veicolo, del modale storico richieste e al caricamento della dashboard. Questo creava un ciclo in cui la cancellazione veniva subito annullata.
    - **Soluzione**:
      - `syncHistoricalWashRequest` è stata disabilitata (restituisce `return` immediato) — la richiesta storica ECHO 22 rimane su Firestore così com'è e può essere eliminata liberamente dall'amministratore.
      - Rimossi tutti i punti di chiamata a `syncHistoricalWashRequest` in `renderDashboard`, `openVehicleModal` e `openVehicleRepairHistoryModal`.
      - `deleteRepairRequest` è stata riscritta per ricercare la richiesta **prima per ID univoco** (`req.id`) e solo in fallback per posizione nell'array (`reqIndex`), evitando eliminazioni errate in caso di riordino dell'array.
      - `downloadSavedRepairDocx` aggiornato con la stessa logica doppia ID + indice.
      - Tutti i pulsanti Elimina e Scarica Word (in `openVehicleModal`, `openVehicleRepairHistoryModal` e `switchDataTable('riparazioni')`) trasmettono ora sia l'ID della richiesta che il suo indice posizionale.

12. **Snellimento Modale Dettagli Veicolo (v3.3.2)**:
    - Rimossa la tabella duplicata dello "Storico Richieste di Riparazione" posizionata in fondo al modal dei dettagli del veicolo (`openVehicleModal`) dopo lo "Storico Manutenzione".
    - Lo storico delle richieste di riparazione del singolo mezzo rimane comodamente consultabile e gestibile tramite il pulsante dedicato in alto **Storico Richieste** (con badge numerico) che apre la finestra modale dedicata `#vehicle-repair-history-modal`, oltre che dalla scheda globale **Riparazioni** in "Gestione Database".

13. **Gestione Km Mensili nella Tabella Luoghi / Sedi (v3.3.4)**:
    - Nella schermata **Gestione Database** alla scheda **Luoghi** (`switchDataTable('locations')`) è stata introdotta la colonna dedicata **Km Mensili Sede**.
    - Gli amministratori possono inserire e modificare sia il *Nome del Luogo/Sede* che i *Km Mensili Previsti* tramite l'apposita finestra modale dedicata `#location-form-modal` (apribile con i pulsanti *Nuovo Luogo* e l'icona di modifica su ciascuna riga).
    - I chilometri mensili sono salvati su Firestore nel campo `monthly_km` di ciascun documento della collection `locations`.
    - La colonna è completamente integrata nelle funzioni di **Esporta Excel** e **Importa Excel** (con mappatura per le intestazioni `Km Mensili`, `monthly_km`, `km_mensili`).

14. **Opzioni di Autolavaggio nella Richiesta di Riparazione Standard (v3.3.13)**:
    - Nella finestra modale della richiesta di riparazione standard (`#repair-request-modal`), sono presenti le due opzioni dedicate di autolavaggio:
      1. **Autolavaggio Esterno** (`#repair-chk-lavaggio-esterno`)
      2. **Autolavaggio Interno ed Esterno** (`#repair-chk-lavaggio-completo`)
    - **Comportamento nel Modulo Word**: Nel documento Word generato, se viene selezionata una delle due opzioni, viene spuntata unicamente la casella originale di **Autolavaggio** (riga 3 della tabella tipologie).
    - **Testo nella Descrizione con Indicazione Sede IP Via Canapa**: La selezione inserisce e aggiorna automaticamente nella descrizione dei lavori da eseguire l'indicazione con officina convenzionata:
      - `AUTOLAVAGGIO ESTERNO IP VIA CANAPA`
      - `AUTOLAVAGGIO INTERNO ED ESTERNO IP VIA CANAPA`
      garantendo che il testo sia chiaramente riportato sia nel file Word generato che nello storico del veicolo.

15. **Sede e Proiezione Km a Fine Dicembre nel Report Officina (v3.3.9)**:
    - Nella tabella **Report Tempo di Permanenza in Officina** (`switchDataTable('report_officina')`) in "Gestione Database":
      - Aggiunta la colonna **Sede** con visualizzazione della sede assegnata al veicolo e il relativo tasso di percorrenza mensile (`km/mese` configurato nella scheda *Luoghi*).
      - Aggiunta la colonna **Stima Fine Dicembre** che proietta i chilometri che il veicolo raggiungerà al 31 dicembre, calcolati a partire dagli *Ultimi Km Rilevati* e scalando i giorni già trascorsi nel mese corrente:
        - I giorni rimanenti nel mese corrente sono calcolati come: `giorni_rimanenti = giorni_totali_mese - giorno_corrente`.
        - Frazione mese corrente: `giorni_rimanenti / giorni_totali_mese`.
        - Mesi successivi interi: `12 - mese_corrente`.
        - Incremento stimato: `(frazione_mese_corrente + mesi_successivi) * km_mensili_sede`.
      - Mostrato sotto alla stima il dettaglio dell'incremento previsto con i mesi e giorni effettivi (es. `+9.200 km (2 mesi e 16 gg)`).
      - Integrazione completa nell'esportazione Excel (*Esporta Riepilogo Excel*) con le nuove colonne `Sede`, `Km Mensili Sede` e `Stima Km Fine Dicembre`.
      - La barra di ricerca istantanea (`filterWorkshopReport`) supporta anche il filtro per nome della sede.



