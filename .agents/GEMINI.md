# Regole e Contesto del Progetto (v3.7.4)

Questo file definisce le linee guida e lo stato di salvataggio del progetto per garantire la coerenza con la versione **3.7.4**.

## Stato di Riferimento (v3.7.4)

1. **Gestione Versioni**:
   - La versione attuale di riferimento è **3.7.4**.
   - Qualsiasi modifica futura richiede l'avanzamento della versione (es. `3.7.2` o successive) in `app.js` (`const APP_VERSION = "X.Y.Z";`) e in `index.html` (header).

2. **Bypass della Cache (Cache-Busting)**:
   - I file `app.js` e `style.css` sono importati in `index.html` con il parametro di versione `?v=X.Y.Z` per forzare il caricamento immediato degli aggiornamenti sui dispositivi client (specialmente mobili).
   - Esempio: `<link rel="stylesheet" href="style.css?v=3.7.4">` e `<script src="app.js?v=3.7.4"></script>`.
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
   - **Pallino Controllo e Pallino Bianco Ambulanza Allestita**: L'indicatore di controllo mensile sulla card è giallo fluo (#ffff00) con contorno bianco solido di 2px (classe `.monthly-check-dot` in `style.css`). A sinistra del pallino di controllo è presente il pallino bianco (#ffffff con contorno scuro #0f172a di 2px, classe `.equipped-ambulance-dot`), che indica che l'ambulanza è allestita (`vehicle.is_allestita: true`). Entrambi i pallini sono contenuti nel blocco flex `.status-dots-left` posizionato all'estrema sinistra della barra di stato (`left: 0.45rem`) in modo da non interferire con il testo centrato dello stato. Cliccando sul pallino bianco della card, un utente amministratore può attivare o disattivare rapidamente lo stato allestita.
   - **Gestione Database**: Lo storico di tutti i controlli mensili è visibile, modificabile ed eliminabile esclusivamente nella scheda tab "Controlli" del modal "Gestione Database", provvisto di esportazione in formato Excel/CSV. I controlli sono visualizzati raggruppati cronologicamente per mese ed anno con divisori colorati e mostrano le colonne Esecutore e Posizione Attuale.

7. **Richiesta di Riparazione Word (.docx) ed Esclusività dei Modelli (v3.3.15)**:
   - È presente un pulsante verde **Richiesta Riparazione** (`.btn-repair-request`, colore `#16a34a`) nei dettagli di ciascun veicolo (`openVehicleModal`) per compilare e memorizzare una nuova richiesta.
   - È presente un pulsante azzurro **Storico Richieste** con badge contatore nei dettagli di ciascun veicolo (`openVehicleRepairHistoryModal`) che apre una finestra dedicata con la tabella di tutte le richieste effettuate per quel singolo mezzo, con download Word ed eliminazione per gli amministratori. La finestra dello storico è una vista di sola consultazione/download provvista esclusivamente del pulsante **Chiudi**. (v3.5.4: Finestra modale ampliata a width: 94vw, max-width: 1280px, height: 85vh con tabella estesa, intestazione fissa sticky, colonna descrizione con pieno respiro e rimozione colonna Richiedente per massima leggibilità).
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
   - **Storico Flotta nel Database**: Nella schermata "Gestione Database" è presente la scheda **Riparazioni** che elenca tutte le richieste dell'intera flotta con ricerca, download Word ed esportazione completa in formato Excel/CSV. (v3.5.2: Rimossa la colonna *Richiedente* dalla tabella per dare maggiore respiro alla colonna *Descrizione* dei lavori).

8. **Richiesta Modulo Lavaggio ECHO 22 (FF 837 RS)**:
   - Registrata ed inserita nello storico richieste di riparazione dell'ambulanza Alea **ECHO 22 (targa FF 837 RS)** la richiesta di modulo lavaggio esterno per ricovero veicolo presso officina **CAVAGION** con data **29/01/2026**.
   - La richiesta è visibile sia nello storico richieste del singolo mezzo che nella tabella globale "Riparazioni" del database, ed è scaricabile in formato Word con il modello dedicato Alea.

9. **Modulo Lavaggio - Stampato Ufficiale Parts & Services e Stampa Diretta (v3.3.10, v3.5.5, v3.5.8, v3.5.9)**:
   - Nella scheda dettagli veicolo (`openVehicleModal`) è presente un pulsante dedicato **Modulo Lavaggio** (`.btn-wash-request`, colore azzurrino acqua / cyan `#06b6d4`, hover `#0891b2`), cromaticamente distinto dal pulsante verde prato "Richiesta Riparazione" (`#16a34a`) e dall'azzurro "Storico Richieste" (`#0284c7`).
   - Apre una finestra modale compilabile dedicata (`#wash-modal`) per verificare e modificare i dati prima di inviare lo stampato direttamente alla stampante (o salvare come PDF dal dialogo di stampa).
   - **Campi Compilabili e Precompilati Dinamici**:
     - *Dati Veicolo*: Veicolo (es. `AMBULANZA FF 837 RS ECHO 22`), Km rilevati, Data modulo (preimpostata alla data odierna), Officina convenzionata (*IP VIA CANAPA* di default, oppure *CAVAGION*).
     - *Tipologia di Intervento Fissa*: Impostata automaticamente su **LAVAGGIO ESTERNO E VANO GUIDA** con badge "Automatico" (v3.5.9: allineata la tipologia a *Lavaggio esterno e vano guida*).
     - *Dati Richiedente / Consegna e Ritiro*: Nominativi incaricati (`MARSILI PAOLO – GAMBERONI FEDERICO – MARCHESINI LUCA`), Email istituzionale (`logistica118fe@ausl.fe.it`), Cellulare (`3209229345`).
   - **Invio Diretto alla Stampante (`printWashModule`)**:
     - Cliccando sul pulsante **Stampa** (`.btn-wash-request` con icona `fa-print`), il sistema genera ed invia direttamente alla stampante di sistema il layout A4 ufficiale Parts & Services (*Ricovero Veicolo per manutenzione - consegna/Ritiro*) indicando come intervento `LAVAGGIO ESTERNO E VANO GUIDA`.
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

14. **Opzione Lavaggio nella Richiesta di Riparazione (v3.3.13, v3.5.6, v3.5.7, v3.5.9, v3.6.0, v3.6.1)**:
    - Nella finestra modale della richiesta di riparazione (`#repair-request-modal`), l'opzione di lavaggio è denominata:
      - **Lavaggio esterno e vano guida** (`#repair-chk-lavaggio-esterno`)
      *(v3.5.9: Etichetta aggiornata a "Lavaggio esterno e vano guida", con inserimento e aggiornamento automatico della corrispondente dicitura `LAVAGGIO ESTERNO E VANO GUIDA IP VIA CANAPA` nella descrizione del problema al momento della selezione)*.
    - **Selezione Esclusiva e Descrizione Lavaggio (v3.6.0)**:
      - Alla selezione di *Lavaggio esterno e vano guida*, qualunque altra casella di controllo della tipologia di intervento (*Manutenzione Mecc. / Elettrauto*, *Gommista*, *Carrozzeria*, *Sinistro*, *Soccorso Stradale*) viene automaticamente deselezionata.
      - Il campo della descrizione del problema / lavori da eseguire (`#repair-description`) viene sovrascritto impostando unicamente ed esclusivamente il testo del lavaggio:
        `LAVAGGIO ESTERNO E VANO GUIDA IP VIA CANAPA`
        memorizzando contestualmente il testo pregresso.
    - **Ripristino Note Problematiche Note su Deselezione (v3.6.1)**:
      - Nel caso in cui la casella *Lavaggio esterno e vano guida* venga deselezionata, il testo originale delle problematiche note del veicolo (`vehicle.notes` o le note modificate prima del lavaggio) viene ripristinato automaticamente nel campo della descrizione (`#repair-description`).
      - Inoltre, se nessuna altra casella di controllo risulta selezionata, viene automaticamente riselezionata la *Manutenzione Mecc. / Elettrauto* di default.
    - **Comportamento nel Modulo Word**: Nel documento Word generato, se viene selezionato *Lavaggio esterno e vano guida*, viene spuntata la casella di **Autolavaggio** (riga 3 della tabella tipologie).
    - **Testo nella Descrizione con Indicazione Officina IP Via Canapa**: La selezione inserisce e aggiorna automaticamente nella descrizione dei lavori da eseguire la voce:
      - `LAVAGGIO ESTERNO E VANO GUIDA IP VIA CANAPA`
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

16. **Intestazione Dashboard Responsive (v3.4.0, v3.4.3)**:
    - **Desktop (> 768px)**: L'intestazione della sezione riporta la dicitura estesa **VEICOLI IN GESTIONE 118 DI FERRARA**, seguita dal badge con la versione del software (`v3.4.5`).
    - **Mobile (<= 768px)**: Mantiene la dicitura compatta **VEICOLI IN GESTIONE**, seguita dal badge della versione del software, ottimizzando lo spazio sui dispositivi mobili.
    - La gestione è implementata tramite le classi utility responsive `.desktop-text` e `.mobile-text` in `index.html` e `style.css`.

17. **Banner di Notifica Salvataggio Richiesta Riparazione (v3.4.1)**:
    - Al salvataggio di una nuova richiesta di riparazione (`generateAndDownloadRepairDocx`) o al riscaricamento di una richiesta dallo storico (`downloadSavedRepairDocx`), compare un banner/toast fluttuante in alto a destra (`.repair-save-banner`).
    - Il banner visualizza:
      - Titolo: *Richiesta Salvata con Successo!* con icona verde di spunta.
      - Nome del file Word generato (es. `richiesta riparazione ECHO 01 FX 123 AB.docx`).
      - Percorso di salvataggio: *Salvata in: Cartella Download* (o cartella predefinita impostata nel browser).
      - Notifica di copia automatica dei dati del veicolo negli appunti di sistema.
    - Dotato di barra di avanzamento animata e chiusura automatica dopo 6,5 secondi, con pulsante per la chiusura immediata.

18. **Posizionamento Distanziato Pallino Controllo Mensile (v3.4.2)**:
    - Il pallino giallo fluo del controllo mensile (`.monthly-check-dot`) posizionato sulla barra di stato della card veicolo è stato spostato maggiormente a sinistra verso il bordo (`left: 0.45rem` anziché `1.2rem`).
    - Questo garantisce una netta separazione visiva rispetto al testo centrato dello stato (es. "IN SERVIZIO", "DISPONIBILE"), evitando qualsiasi sovrapposizione o eccessiva vicinanza sia su desktop che su dispositivi mobili.

19. **Sincronizzazione Richieste di Riparazione con File Excel Locale (v3.4.4 - v3.5.1)**:
    - File di destinazione sul desktop: `ORGANIZZAZIONE RICHIESTE MEZZI.xlsx`.
    - Implementato il modulo `excel_sync.js` (tramite File System Access API di Chrome/Edge e JSZip).
    - **Pannello di Controllo in Gestione Database (v3.5.1)**: Nella scheda **Riparazioni** del modale "Gestione Database" è integrato un pannello completo di stato e monitoraggio della sincronizzazione locale Desktop:
      - Visualizza lo stato del collegamento (`Collegato e Attivo`, `Non collegato su questo PC` o `In attesa`), il nome del file e il numero di richieste pendenti in coda.
      - Pulsante **Scrivi in Coda**: compare automaticamente se vi sono richieste in sospeso (es. salvate mentre il file era aperto in Excel) per forzare la sincronizzazione manuale immediata.
      - Pulsante **Collega / Cambia File**: permette di collegare o cambiare il file Excel puntando al Desktop con un click preventivo senza dover emettere una nuova richiesta.
      - Pulsante **Verifica Accesso**: esegue un test immediato di lettura e scrittura, visualizzando dimensione del file e data di ultima modifica.
      - Pulsante **Scollega**: rimuove in modo pulito l'handle da IndexedDB con conferma dell'utente.
      - Su dispositivi mobile/tablet mostra un messaggio discreto per chiarire che la sincronizzazione locale è riservata ai PC.
    - **Risoluzione `getFile` NotAllowedError (v3.5.0)**: Nel browser Chromium, qualsiasi chiamata a `handle.getFile()` su un handle memorizzato in IndexedDB fallisce con `NotAllowedError` se eseguita prima di aver verificato e richiesto i permessi di lettura/scrittura con gesto utente. La sequenza verifica e richiede preventivamente i permessi `readwrite` all'inizio del click, invocando `handle.getFile()` unicamente quando l'autorizzazione è stata effettivamente concessa. Se un vecchio handle memorizzato non è più autorizzabile, il sistema esegue un fallback pulito riaprendo `showOpenFilePicker`.
    - **Funzionamento su qualsiasi PC Desktop (v3.4.9, v3.5.0, v3.5.1)**: il sistema è completamente indipendente dal computer, dall'utente Windows e dal percorso su disco (`startIn: 'desktop'`). Quando l'applicazione web viene aperta su un altro computer PC:
      - Al primo salvataggio di una richiesta di riparazione, Windows apre automaticamente la finestra di dialogo posizionata direttamente sulla cartella **Desktop** di quella specifica macchina con pre-evidenziato il file `ORGANIZZAZIONE RICHIESTE MEZZI.xlsx` (`suggestedName`).
      - L'utente seleziona il file e autorizza la modifica una sola volta.
      - L'handle viene memorizzato permanentemente in IndexedDB nel browser di quel computer, rendendo tutte le future aggiunte ed eliminazioni totalmente trasparenti e automatiche su quel desktop.
    - **Esclusione Dispositivi Mobile e Robustezza Touchscreen Desktop**: la sincronizzazione con il file Excel è attiva **esclusivamente su PC Desktop**. La funzione `isMobileDevice()` riconosce sempre i computer desktop Windows e Mac, anche se dotati di display touchscreen. Da smartphone e tablet reali la sincronizzazione Excel è disabilitata (normale salvataggio su Firestore e download Word).
    - **Aggiunta automatica e Priorità Click**: ogni volta che viene salvata una nuova richiesta di riparazione (`generateAndDownloadRepairDocx`), la sincronizzazione Excel viene avviata come primissima operazione asincrona al click su Salva, eliminando qualsiasi perdita di transient activation. Una nuova riga con Sigla, Tipo Intervento, Data Richiesta viene accodata in fondo al foglio Excel preservando stili, bordi, altezze riga e formattazione nativa.
    - **Persistenza Handle IndexedDB**: l'handle memorizzato in IndexedDB non viene mai cancellato in caso di prompt temporaneo. Viene resettato unicamente nel caso in cui il file sia stato rimosso o spostato fisicamente dal desktop (`NotFoundError`) o se il permesso è stato esplicitamente negato (`denied`).
    - **Eliminazione sincronizzata**: quando una richiesta di riparazione viene eliminata dallo storico (`deleteRepairRequest`), la corrispondente riga viene individuata ed eliminata dal foglio Excel con compattazione e scalamento degli indici delle righe successive.
    - **Gestione file bloccato / coda**: se il file Excel risulta aperto in sola lettura/bloccato dall'applicazione Excel, le operazioni restano in sospeso (in `localStorage`) e vengono applicate alla chiusura del file al salvataggio successivo. Lo stato dettagliato viene comunicato direttamente nel banner di notifica di salvataggio.

20. **Integrazione Storico Manutenzione, Sincronizzazione Excel Completa ed Eliminazione Storico Richieste (v3.6.2, v3.6.3, v3.6.4)**:
    - **Sincronizzazione Completa tra Storico Manutenzioni e Foglio Excel (`ORGANIZZAZIONE RICHIESTE MEZZI.xlsx`)**:
      - Lo **Storico Manutenzione** è ora il registro unico e sovrano sia dell'applicazione web che del foglio Excel locale Desktop.
      - **Aggiunta**: sia le richieste di riparazione generate con Word sia le nuove voci create manualmente dal modulo "Aggiungi Manutenzione" vengono scritte/accodate nel foglio Excel Desktop.
      - **Modifica (`excelSyncUpdateMaintenance`)**: qualsiasi modifica apportata nel modulo manutenzione (Data Richiesta, Data Entrata in officina, Data Uscita, Officina/Luogo, Descrizione) aggiorna contestualmente le relative celle (colonne B, C, D, E, F) della riga corrispondente nel file Excel. Se una data di ingresso o uscita viene svuotata, la cella corrispondente sul foglio Excel viene azzerata.
      - **Eliminazione (`excelSyncDeleteMaintenance`)**: eliminando una voce dallo Storico Manutenzioni (tramite icona cestino nella scheda mezzo o nella tabella database), la riga corrispondente viene rimossa fisicamente dal file Excel con compattazione e scalamento degli indici. Se la voce derivava da una richiesta Word, viene rimossa anche la relativa voce dall'array veicolo.
    - **Eliminazione e Centralizzazione di "Storico Richieste"**:
      - Il pulsante "Storico Richieste" è stato eliminato dalla scheda modale del veicolo per evitare duplicazioni: tutte le informazioni sono visibili, consultabili e modificabili direttamente nella sezione **Storico Manutenzione**.
      - Se un intervento deriva da una richiesta di riparazione generata in precedenza, nella colonna "Azioni" dello Storico Manutenzione è presente il pulsante blu con icona Word per riscaricare direttamente il documento .docx compilato.
      - Nella finestra di "Gestione Database", la scheda è stata ridenominata in **Manutenzioni** ed integra il pannello di stato/connessione con il file Excel Desktop (`#excel-sync-mgmt-container`), rimuovendo la scheda ridondante "Riparazioni".
    - **Mappatura Colonne File Excel Locale (`ORGANIZZAZIONE RICHIESTE MEZZI.xlsx`)**:
      - **Colonna 1 (A)**: Sigla / Nome del mezzo (es. `E7`, `E18`, `V74`).
      - **Colonna 2 (B)**: Descrizione del problema / Tipo intervento.
      - **Colonna 3 (C)**: Data della richiesta (formattata `DD MM YY`).
      - **Colonna 4 (D)**: Nome del luogo / officina.
      - **Colonna 5 (E)**: Data di entrata in officina.
      - **Colonna 6 (F)**: Data di uscita dall'officina.
      - **Colonna 7 (G)**: Note.

21. **Ambulanza Allestita e Pallino Bianco sulla Card (v3.6.5)**:
    - **Pallino Bianco (`.equipped-ambulance-dot`)**: per i mezzi contrassegnati come "Ambulanza Allestita", viene visualizzato un indicatore circolare bianco (`#ffffff`, 14x14px, bordo scuro `#0f172a` per contrasto visivo su qualsiasi sfondo di stato) posizionato a sinistra del pallino giallo di controllo mensile.
    - **Contenitore Flex `.status-dots-left`**: alloggia sia il pallino bianco che quello giallo all'estrema sinistra della barra di stato (`left: 0.45rem`) con spaziatura (`gap: 0.35rem`), evitando qualsiasi sovrapposizione con il testo dello stato centrato.
    - **Gestione e Persistenza**:
      - Checkbox `Ambulanza Allestita` (`#vehicle-is-allestita`) nel modulo di aggiunta/modifica veicolo (`vehicle-form-modal`), memorizzato come booleano `is_allestita` nel documento del veicolo.
      - **Toggle Rapido**: gli amministratori possono cliccare direttamente sul pallino bianco della card o sul badge `ALLESTITA` nei dettagli del veicolo per attivare o disattivare rapidamente lo stato allestita.
      - **Badge nei Dettagli Mezzo**: visibile badge `ALLESTITA` con fondo bianco e bordo ardesia nell'intestazione del veicolo accanto all'eventuale badge `ALEA`.
      - **Supporto CSV**: integrata colonna `Allestita` (`is_allestita`) sia nell'esportazione che nell'importazione CSV/Excel della tabella Mezzi.

22. **Richieste di Riparazione e Km nello Storico Manutenzione (v3.6.6)**:
    - Alla creazione di una nuova richiesta di riparazione (`generateAndDownloadRepairDocx`), la registrazione automatica inserita nello **Storico Manutenzione** mantiene il campo chilometri vuoto (`km: null`) anziché inserire automaticamente i chilometri del mese del veicolo (`vehicle.mileage`).
    - Il valore dei chilometri effettivi potrà essere inserito successivamente e puntualmente dall'amministratore (es. al ritiro o al rientro dall'officina).

23. **Immutabilità della Data Richiesta (v3.6.7)**:
    - Il campo **Data Richiesta** (`repair-date` nel modulo Word e `maintenance-request-date` nel modulo manutenzione) è impostato come fisso e non modificabile (`readonly`, sfondo grigio `#f1f5f9`, cursore `not-allowed`, `pointer-events: none`).
    - Nelle nuove richieste e nelle nuove manutenzioni viene impostata automaticamente alla data odierna e rimane bloccata.
    - Nelle modifiche dei record esistenti nello Storico Manutenzioni, la Data Richiesta rimane fissa al valore originariamente registrato, garantendo l'integrità dello storico e la perfetta corrispondenza con la colonna C del foglio Excel sincronizzato.

24. **Sincronizzazione Automatica Cloud da Cellulare a File Excel Desktop (v3.6.8 - v3.6.9)**:
    - **Ponte Cloud Firebase (`excel_sync_queue`)**: Quando una manutenzione viene modificata o inserita (o una richiesta creata o eliminata) da smartphone o da qualsiasi dispositivo mobile, l'operazione viene registrata sia nella collezione principale di Firestore sia nella coda cloud `excel_sync_queue`.
    - **Sincronizzazione 100% Automatica (Zero Tasti da Premere)**:
      - Il PC Desktop esegue un listener in tempo reale su `excel_sync_queue`.
      - Non appena riceve la modifica inviata dal cellulare, apre e aggiorna automaticamente in background il file `ORGANIZZAZIONE RICHIESTE MEZZI.xlsx` sul Desktop del PC, segnando l'operazione come completata.
      - Se il gestionale sul PC viene aperto successivamente, all'avvio elabora e scrive all'istante tutte le modifiche pendenti senza richiedere la pressione di alcun tasto.
      - Un toast verde non invasivo a scomparsa (`showExcelAutoSyncToast`) notifica la corretta sincronizzazione avvenuta.

25. **Aggiornamento Real-Time Istantaneo Zero-Latenza PC & Cellulare (v3.6.9)**:
    - **Risoluzione Latenza tra Cellulare e PC**:
      - Riscaldamento automatico dei permessi File System Access (`warmUpExcelHandlePermission`): memorizza lo stato autorizzato per tutta la sessione del browser al primo tocco o click sulla finestra, consentendo al listener background di scrivere sul file Excel all'istante senza attendere gesture o click successivi.
      - Passaggio diretto dello snapshot: quando il cellulare invia una modifica, il listener Firestore sul PC passa direttamente i documenti ricevuti a `excelSyncProcessCloudQueue`, eliminando query di rete ridondanti e azzerando i tempi di attesa.
      - Accodamento `syncQueued` e debounce a 100ms: le modifiche concomitanti su Firestore (`interventions` e `vehicles`) non vengono più scartate dal flag `isSyncing`, ma accodate ed elaborate istantaneamente in un unico ciclo pulito.
      - Ricaricamento real-time delle schermate aperte: quando arriva una modifica dal cellulare, il PC aggiorna istantaneamente non solo la dashboard mezzi, ma anche la tabella attiva in *Gestione Dati* (es. *Storico Manutenzioni*) o la scheda dettagli del veicolo se aperta.
      - Polling rapido di sicurezza (3.5s) e gestione file bloccato: se il file Excel è aperto nel programma Microsoft Excel sul PC, viene mostrato un avviso discreto e, non appena l'utente chiude Excel, la scrittura si completa automaticamente entro 3 secondi.

26. **Chiusura Automatica della Scheda Dettagli dopo la Conferma di Modifica (v3.7.0)**:
    - Quando l'utente modifica i dati di un veicolo, una manutenzione, le note o un appuntamento a partire dalla scheda dettagli (`vehicle-modal`):
      - Viene mostrato il messaggio/alert di conferma (es. *Modifiche salvate con successo!*, *Manutenzione modificata con successo!*).
      - Alla pressione del tasto **OK** da parte dell'utente, la scheda dettagli (`vehicle-modal`) si chiude automaticamente tramite `closeVehicleModal()`, azzerando `currentOpenedVehicleId` e riportando la visualizzazione sulla schermata principale con i dati già aggiornati.

27. **Chiusura Scheda Dettagli su Aggiunta Richiesta Riparazione e Aggiornamento Manutenzione (v3.7.1)**:
    - **Aggiunta Richiesta di Riparazione (`generateAndDownloadRepairDocx`)**: al salvataggio di una nuova richiesta di riparazione (`#repair-submit-btn`), oltre alla chiusura del modale della richiesta (`closeRepairRequestModal()`) e alla visualizzazione del banner toast, viene contestualmente chiusa la scheda dettagli del veicolo (`closeVehicleModal()`) senza più mantenerla o ricaricarla a video.
    - **Aggiornamento Manutenzione (`saveMaintenanceRecord`)**: alla modifica o salvataggio di un record di manutenzione, la scheda dettagli del veicolo viene chiusa immediatamente (`closeVehicleModal()`) prima dell'elaborazione di `renderDashboard()` e dell'alert di conferma, azzerando `currentOpenedVehicleId` e prevenendo che le sottoscrizioni in tempo reale Firestore (o eventuali ritardi asincroni) possano riaprire o mantenere visibile la scheda dettagli a schermo.
    - **Protezione Concorrenza su `openVehicleModal`**: se la modale dettagli viene chiusa mentre è in corso il caricamento asincrono del veicolo (`store.getVehicleById`), la procedura abortisce immediatamente senza rimuovere la classe `hidden`.

28. **Sincronizzazione Completa Excel su Aggiunta e Modifica Manutenzioni (v3.7.2)**:
    - **Aggiunta Nuova Manutenzione (`excelSyncAppendMaintenance`)**:
      - Quando l'utente aggiunge una nuova manutenzione (sia dalla scheda dettagli del veicolo che da Gestione Database), il record viene non solo salvato su Firestore, ma contestualmente accodato come nuova riga nel file Excel Desktop (`ORGANIZZAZIONE RICHIESTE MEZZI.xlsx`).
      - Popola in modo coerente tutte le colonne: Colonna A (Sigla normalizzata con `shortSigla`), Colonna B (Descrizione problema), Colonna C (Data richiesta `DD MM YY`), Colonna D (Officina / Luogo), Colonna E (Data entrata se indicata), Colonna F (Data uscita se indicata), Colonna G (Note).
      - Se l'operazione avviene da cellulare, viene accodata in `excel_sync_queue` con azione `append_maintenance` ed elaborata in tempo reale dal listener del PC.
    - **Modifica di Qualsiasi Voce nello Storico Manutenzioni (`excelSyncUpdateMaintenance`)**:
      - Qualsiasi modifica apportata a una voce nello Storico Manutenzioni (Data Entrata, Data Uscita, Officina, Descrizione, ecc.) aggiorna all'istante la riga corrispondente nel file Excel Desktop.
      - Se per qualsiasi motivo la riga non è ancora presente nel file Excel, viene accodata automaticamente per garantire la completa integrità dei dati.
    - **Risoluzione Decadimento User Activation**:
      - In `saveMaintenanceRecord`, il riscaldamento e la verifica dei permessi dell'handle File System Access (`excelSyncEnsureHandle(true)`) vengono eseguiti subito all'inizio della funzione nel contesto diretto del click utente, prevenendo il blocco dei permessi da parte del browser Chromium.
    - **Corrispondenza Resiliente delle Righe**:
      - Introdotta la funzione `normalizeDateStr` per confrontare le date in modo indipendente dal formato (supporta slash, trattini, spazi, anni a 2 o 4 cifre e seriali numerici Excel).
      - La corrispondenza della sigla include il matching flessibile `shortSigla` (es. `E1` / `ECHO 01`).
    - **Feedback Visivo di Sincronizzazione**:
      - L'avviso di conferma notifica all'utente l'esito puntuale della sincronizzazione Excel (es. riga aggiornata con numero di riga, nuova riga aggiunta, accodamento cloud o avviso file aperto in Microsoft Excel).

29. **Modificabilità della Data Richiesta nella Manutenzione (v3.7.3)**:
    - Il campo **Data Richiesta** (`maintenance-request-date`) nel modulo di inserimento e modifica manutenzione (`#maintenance-form-modal`) è ora completamente modificabile dall'utente (`readOnly = false`, interattivo e con selettore calendario nativo).
    - All'apertura del modulo per l'inserimento di una nuova manutenzione viene preimpostata la data odierna come valore predefinito, consentendo all'utente di modificarla liberamente per registrare manutenzioni con data di richiesta antecedente o personalizzata.
    - Il valore della Data Richiesta viene memorizzato sul database Firestore e sincronizzato con la colonna C del file Excel Desktop (`ORGANIZZAZIONE RICHIESTE MEZZI.xlsx`).

30. **Sincronizzazione Multi-Postazione PC Casa -> PC Lavoro e Allineamento Database (v3.7.4)**:
    - **Sincronizzazione Trasparente da PC Remoto / Casa**: Se una richiesta o una manutenzione viene creata, aggiornata o eliminata da una postazione dove il file Excel non è collegato in locale (es. PC di casa, computer portatile, cellulare o tablet), l'operazione non genera errori né richiede l'apertura di file locali, ma viene accodata istantaneamente su Firestore (`excel_sync_queue`).
    - **Aggiornamento Automatico all'Avvio del PC del Lavoro**:
      - All'accensione del PC di lavoro e all'apertura dell'applicazione, il listener Firestore intercetta le modifiche pendenti. Se i permessi sul file Desktop sono già concessi nella sessione, il foglio `ORGANIZZAZIONE RICHIESTE MEZZI.xlsx` viene aggiornato all'istante in background con toast di conferma.
      - Se il browser Chromium richiede l'autorizzazione di sicurezza, compare un banner in evidenza: `⚡ Rilevate modifiche inviate da casa / cellulare: [ Sincronizza Ora su Desktop ]`. Con un solo click l'utente autorizza la scrittura e sincronizza tutto.
    - **Funzione di Allineamento Completo con Database (`excelSyncReconcileWithDatabase`)**:
      - Introdotto nel pannello di sincronizzazione di Gestione Database il pulsante blu **Allinea con Database**. Scansiona l'intero archivio di manutenzioni e richieste salvate su Firestore, verifica le righe già presenti nel foglio Excel Desktop e accoda in automatico qualsiasi voce mancante (compresa quella già inserita da casa prima dell'aggiornamento).
