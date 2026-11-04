# Gestione Mezzi 118

Web app per la gestione della flotta (ambulanze/mezzi 118): dashboard con card dei veicoli, controlli mensili, appuntamenti, richieste di riparazione in Word, moduli lavaggio, gestione database, report officina. Interfaccia in italiano. Si usa sia da PC sia da telefono.

## Stack
- Nessun build, nessun `package.json`: HTML + JavaScript puro + CSS. File principali: `index.html`, `app.js`, `store.js`, `excel_sync.js`, `style.css`.
- Dati e login: Firebase (Firestore + Auth), config in `firebase-config.js`, regole in `firestore.rules`.
- Documenti Word generati nel browser con `jszip.min.js` e i modelli in `*_template_base64.js` (non modificarli a mano: sono blob base64 dei `.docx`).
- Hosting: Vercel, pubblica da GitHub `marchesoft/Gestione-Mezzi-118`, branch `main` (`vercel.json`: nessuna cache su index/app/style).
- Provare in locale: servire la cartella con un server statico (es. `python -m http.server 8080`) e aprire `http://localhost:8080`. Non aprire `index.html` con doppio clic.

## Le regole dettagliate sono in `.agents/GEMINI.md`
È la specifica funzionale completa (modello dati Firestore, comportamento di ogni modale, regole dei moduli Word/Alea, lavaggio, report). Leggerla prima di toccare una funzione: contiene decisioni prese apposta e bug già risolti (es. `syncHistoricalWashRequest` è disattivata di proposito). Se cambia il comportamento di una funzione, aggiornare anche quel file.

## Regole da rispettare
1. **Versione**: ogni modifica fa salire la versione (ora 3.8.0) in `app.js` (`const APP_VERSION`), nell'header di `index.html` e nei parametri `?v=X.Y.Z` di `store.js`, `excel_sync.js`, `app.js`, `style.css` in `index.html`. Serve a bypassare la cache, soprattutto sui telefoni.
2. **Git**: messaggio di commit nel formato `vX.Y.Z: descrizione` (come la cronologia esistente). Commit e push su `main` solo dopo che l'utente ha approvato la modifica, mai prima.
3. **Segreti**: `nuovo token github.txt` e `info account app.txt` sono ignorati da git e non vanno mai letti, copiati o stampati. Non scrivere token nell'URL del remote.
4. Le cartelle `_VERSIONE_*` e gli zip `_backup_*` sono copie locali di sicurezza (ignorate da git). Non modificarle.
5. Prima di toccare le regole Firestore, ricordare che la scrittura è limitata a due email amministratore e la lettura è pubblica.
