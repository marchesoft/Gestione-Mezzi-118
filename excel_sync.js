// =====================================================================
// Sincronizzazione Richieste di Riparazione -> file Excel locale (v3.5.4)
// File di destinazione: "ORGANIZZAZIONE RICHIESTE MEZZI.xlsx" (Desktop)
//
// Usa la File System Access API (Chrome / Edge desktop): al salvataggio
// su PC il file viene selezionato automaticamente sul Desktop se non ancora
// collegato, l'handle viene memorizzato permanentemente in IndexedDB per
// quel computer e ogni nuova richiesta di riparazione viene sincronizzata.
// Il file viene modificato direttamente a livello XML (JSZip) per preservare
// formattazione, larghezze colonne, stili e impostazioni di stampa.
// Se il file non è scrivibile (es. aperto in Excel) la riga resta in coda
// (localStorage) e viene scritta al salvataggio successivo.
// =====================================================================
(function () {
    const DB_NAME = 'gm118_excel_sync';
    const STORE_NAME = 'handles';
    const HANDLE_KEY = 'organizzazione_richieste';
    const PENDING_KEY = 'gm118_excel_pending_rows';
    const SHEET_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
    const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
    const COLS = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];

    // Rileva se il dispositivo è mobile / tablet (la sincronizzazione Excel è attiva SOLO su PC Desktop)
    window.isMobileDevice = function () {
        const ua = (navigator.userAgent || navigator.vendor || window.opera || '').toLowerCase();
        // Dispositivi desktop certi (Windows, Mac non-iPad, Linux PC): MAI considerare mobile anche se con touchscreen!
        if (ua.includes('windows') || ua.includes('win32') || ua.includes('win64')) return false;
        if (ua.includes('macintosh') && !('ontouchend' in document)) return false;
        if ((ua.includes('x11') || ua.includes('linux')) && !ua.includes('android')) return false;

        const isMobileUA = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini|mobile|tablet/i.test(ua);
        return Boolean(isMobileUA);
    };

    window.excelSyncSupported = function () {
        // Solo per PC (non mobile) e browser con File System Access API
        if (window.isMobileDevice()) return false;
        return typeof window.showOpenFilePicker === 'function' && typeof indexedDB !== 'undefined';
    };

    // ---------- IndexedDB (memorizzazione handle del file) ----------
    function openDb() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(DB_NAME, 1);
            req.onupgradeneeded = () => req.result.createObjectStore(STORE_NAME);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }
    async function idbGet(key) {
        const db = await openDb();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const r = tx.objectStore(STORE_NAME).get(key);
            r.onsuccess = () => resolve(r.result || null);
            r.onerror = () => reject(r.error);
        });
    }
    async function idbSet(key, value) {
        const db = await openDb();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            if (value === null || value === undefined) {
                tx.objectStore(STORE_NAME).delete(key);
            } else {
                tx.objectStore(STORE_NAME).put(value, key);
            }
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }

    window.excelSyncGetHandle = async function () {
        if (!window.excelSyncSupported()) return null;
        try { return await idbGet(HANDLE_KEY); } catch (e) { return null; }
    };

    // Helper per resettare completamente il collegamento al file Excel (utile da console o recovery)
    window.excelSyncReset = async function () {
        try {
            await idbSet(HANDLE_KEY, null);
            console.log('Collegamento Excel rimosso da IndexedDB');
        } catch (e) {
            console.warn('Errore reset collegamento Excel:', e);
        }
    };

    // ---------- Cloud Firestore Queue Bridge (Mobile -> PC Desktop) ----------
    function getFirestore() {
        if (typeof db !== 'undefined' && db && typeof db.collection === 'function') return db;
        if (window.db && typeof window.db.collection === 'function') return window.db;
        if (typeof firebase !== 'undefined' && firebase.apps && firebase.apps.length) return firebase.firestore();
        return null;
    }

    window.excelSyncEnqueueCloud = async function (action, vehicle, data) {
        const firestore = getFirestore();
        if (!firestore) {
            console.warn('[Excel Cloud Sync] Database Firestore non disponibile per accodamento.');
            return { ok: false, error: 'Database Firestore non disponibile' };
        }
        try {
            const siglaVal = (vehicle && (vehicle.sigla || vehicle.plate)) ? (vehicle.sigla || vehicle.plate) : (data.sigla || '');
            const item = {
                action: action,
                sigla: siglaVal,
                vehicle_id: vehicle ? (vehicle.id || '') : (data.vehicle_id || ''),
                data: data || {},
                status: 'pending',
                created_at: new Date().toISOString(),
                device: window.isMobileDevice() ? 'mobile' : 'pc'
            };
            const docRef = await firestore.collection('excel_sync_queue').add(item);
            console.log(`[Excel Cloud Sync] Inserita operazione "${action}" per ${siglaVal} (ID: ${docRef.id})`);
            return { ok: true, queued_cloud: true, id: docRef.id };
        } catch (err) {
            console.error('[Excel Cloud Sync] Errore inserimento in coda:', err);
            return { ok: false, error: err.message };
        }
    };

    // ---------- Coda righe in attesa ----------
    function getPending() {
        try { return JSON.parse(localStorage.getItem(PENDING_KEY) || '[]'); } catch (e) { return []; }
    }
    function setPending(list) {
        localStorage.setItem(PENDING_KEY, JSON.stringify(list || []));
    }
    window.excelSyncPendingCount = function () { return getPending().length; };

    // ---------- Conversione richiesta -> riga Excel ----------
    function shortSigla(sigla) {
        const s = (sigla || '').toString().toUpperCase().trim();
        const m = s.match(/^([A-Z]+)\s*-?\s*0*(\d+)$/);
        if (m) return m[1].charAt(0) + m[2];
        return s;
    }
    function excelDate(dateStr) {
        const p = (dateStr || '').split(/[\/\-.]/);
        if (p.length === 3) {
            let [d, m, y] = p;
            if (d.length === 4) { const t = d; d = y; y = t; }
            return `${d.padStart(2, '0')} ${m.padStart(2, '0')} ${y.slice(-2)}`;
        }
        return dateStr || '';
    }
    function findLocationInText(text, locations = []) {
        if (!text) return '';
        const upperText = text.toUpperCase();
        const locList = (locations && locations.length > 0) ? locations : (window.cachedLocations || []);
        if (!locList || locList.length === 0) return '';

        // Ordina per lunghezza decrescente per dare priorità a nomi composti (es. "IP VIA CANAPA" prima di "IP")
        const sorted = [...locList]
            .map(loc => (loc.luogo || loc.name || '').trim())
            .filter(name => name.length >= 2)
            .sort((a, b) => b.length - a.length);

        for (const locName of sorted) {
            const upperLoc = locName.toUpperCase();
            const escaped = upperLoc.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const rx = new RegExp('(^|[^A-Z0-9])' + escaped + '([^A-Z0-9]|$)', 'i');
            if (rx.test(upperText)) {
                return upperLoc;
            }
        }
        return '';
    }
    window.findLocationInText = findLocationInText;

    window.buildExcelRowFromRepairRequest = function (vehicle, req, locations = []) {
        let tipo = (req.description || '').toString()
            .split(/\r?\n/).map(s => s.trim()).filter(Boolean).join(', ');
        if (!tipo) tipo = (req.types || []).join(', ');

        const locList = (locations && locations.length > 0) ? locations : (window.cachedLocations || []);
        const matchingLuogo = findLocationInText(tipo, locList);

        return {
            id: req.id,
            cells: [
                shortSigla(vehicle ? (vehicle.sigla || vehicle.plate) : ''), // Colonna 1: Nome mezzo
                tipo.toUpperCase(),                                            // Colonna 2: Descrizione problema
                excelDate(req.date),                                           // Colonna 3: Data richiesta
                matchingLuogo.toUpperCase(),                                   // Colonna 4: Luogo se presente nella descrizione
                '',                                                            // Colonna 5: Data entrata
                '',                                                            // Colonna 6: Data uscita
                ''                                                             // Colonna 7: Note
            ]
        };
    };

    // ---------- Permessi e Acquisizione Automatica Handle ----------
    async function requestWritePermission(handle) {
        if (!handle) return false;
        try {
            const status = await handle.queryPermission({ mode: 'readwrite' });
            if (status === 'granted') return true;
            if (status === 'denied') return false;
            const req = await handle.requestPermission({ mode: 'readwrite' });
            return req === 'granted';
        } catch (e) {
            console.warn('Errore richiesta permessi scrittura:', e);
            return false;
        }
    }

    // Assicura l'acquisizione di un handle valido con permesso di scrittura.
    // L'handle memorizzato in IndexedDB viene verificato chiedendo prima i permessi
    // prima di qualsiasi chiamata a getFile(), evitando l'errore NotAllowedError del browser.
    window.excelSyncEnsureHandle = async function (interactive = true) {
        if (!window.excelSyncSupported()) return null;
        let handle = await window.excelSyncGetHandle();

        if (handle) {
            try {
                // 1. Verifichiamo prima lo stato dei permessi readwrite
                let q = 'prompt';
                try {
                    q = await handle.queryPermission({ mode: 'readwrite' });
                } catch (qpErr) {
                    console.warn('Errore queryPermission su handle salvato:', qpErr);
                }

                // 2. Se siamo in interazione utente (click) e il permesso non è ancora granted, lo richiediamo subito
                if (q !== 'granted' && interactive) {
                    try {
                        q = await handle.requestPermission({ mode: 'readwrite' });
                    } catch (rpErr) {
                        console.warn('Errore requestPermission su handle salvato:', rpErr);
                    }
                }

                // 3. Se il permesso è concesso, verifichiamo che il file esista ancora sul disco
                if (q === 'granted') {
                    try {
                        await handle.getFile();
                        return handle;
                    } catch (fErr) {
                        if (fErr && (fErr.name === 'NotFoundError' || /not found/i.test(fErr.message || ''))) {
                            console.warn('File Excel non trovato o spostato sul disco: resetto handle memorizzato.', fErr);
                            try { await idbSet(HANDLE_KEY, null); } catch (e) {}
                            handle = null;
                        } else {
                            throw fErr;
                        }
                    }
                } else {
                    // Se il permesso non è stato accordato o l'handle è obsoleto/invalido,
                    // consentiamo il fallback a showOpenFilePicker
                    console.warn('Handle esistente non autorizzato (stato: ' + q + ')');
                    if (q === 'denied') {
                        try { await idbSet(HANDLE_KEY, null); } catch (e) {}
                    }
                    handle = null;
                }
            } catch (err) {
                console.warn('Errore verifica handle salvato:', err);
                try { await idbSet(HANDLE_KEY, null); } catch (e) {}
                handle = null;
            }
        }

        // Se non abbiamo un handle memorizzato e siamo in modalità interattiva (click utente):
        if (!handle && interactive) {
            try {
                const [newHandle] = await window.showOpenFilePicker({
                    id: 'gm118-excel',
                    startIn: 'desktop',
                    suggestedName: 'ORGANIZZAZIONE RICHIESTE MEZZI.xlsx',
                    multiple: false,
                    types: [{
                        description: 'Cartella di lavoro Excel (ORGANIZZAZIONE RICHIESTE MEZZI.xlsx)',
                        accept: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'] }
                    }]
                });
                if (newHandle) {
                    try {
                        let q = await newHandle.queryPermission({ mode: 'readwrite' });
                        if (q !== 'granted') {
                            await newHandle.requestPermission({ mode: 'readwrite' });
                        }
                    } catch (pErr) {
                        console.warn('Richiesta permessi su nuovo handle:', pErr);
                    }

                    // Memorizziamo l'handle selezionato dall'utente
                    await idbSet(HANDLE_KEY, newHandle);
                    return newHandle;
                }
            } catch (e) {
                if (e && e.name === 'AbortError') {
                    console.log('Selezione file Excel annullata dall\'utente.');
                } else {
                    console.warn('Errore apertura selettore file Excel:', e);
                }
            }
        }

        return handle || null;
    };

    window.excelSyncPrepare = async function () {
        return await window.excelSyncEnsureHandle(true);
    };

    // ---------- Accodamento + scrittura ----------
    window.excelSyncAppendRequest = async function (vehicle, req, locations = []) {
        if (!window.excelSyncSupported()) {
            return await window.excelSyncEnqueueCloud('append_request', vehicle, {
                id: req.id,
                description: req.description || '',
                date: req.date || '',
                types: req.types || [],
                station: req.station || '',
                workshop: (window.findLocationInText ? window.findLocationInText(req.description, locations) : '') || req.station || ''
            });
        }
        let handle = await window.excelSyncEnsureHandle(true);
        if (!handle) return { ok: false, notLinked: true };
        const pending = getPending();
        if (!pending.some(p => p.id === req.id)) {
            pending.push(window.buildExcelRowFromRepairRequest(vehicle, req, locations));
            setPending(pending);
        }
        return window.excelSyncFlush(handle);
    };

    window.excelSyncFlush = async function (handleOpt) {
        const pending = getPending();
        if (pending.length === 0) return { ok: true, written: 0 };
        let handle = handleOpt || (await window.excelSyncGetHandle());
        if (!handle) {
            handle = await window.excelSyncEnsureHandle(true);
        }
        if (!handle) return { ok: false, notLinked: true, pending: pending.length };

        try {
            // Verifichiamo i permessi prima di accedere al file
            let q = await handle.queryPermission({ mode: 'readwrite' });
            if (q !== 'granted') {
                q = await handle.requestPermission({ mode: 'readwrite' });
                if (q !== 'granted') {
                    throw new Error('permesso di lettura/scrittura non autorizzato dal browser (autorizza la modifica quando richiesto)');
                }
            }

            const file = await handle.getFile();
            const zip = await JSZip.loadAsync(await file.arrayBuffer());
            const sheetPath = await resolveFirstSheetPath(zip);
            const sheetXml = await zip.file(sheetPath).async('string');
            const newXml = appendRowsToSheetXml(sheetXml, pending.map(p => p.cells));
            zip.file(sheetPath, newXml);
            const blob = await zip.generateAsync({
                type: 'blob',
                compression: 'DEFLATE',
                mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            });

            // Scrittura diretta tramite createWritable
            const writable = await handle.createWritable();
            await writable.write(blob);
            await writable.close();
            setPending([]);
            return { ok: true, written: pending.length, fileName: handle.name };
        } catch (e) {
            console.error('Errore scrittura file Excel:', e);
            const locked = e && (e.name === 'NoModificationAllowedError' || e.name === 'InvalidStateError' || /lock|in use|utilizzo/i.test(e.message || ''));
            return {
                ok: false,
                error: locked ? 'il file è aperto in Microsoft Excel: chiudilo per completare la scrittura' : (e && e.message ? e.message : String(e)),
                pending: pending.length
            };
        }
    };

    // ---------- Manipolazione XML del foglio ----------
    async function resolveFirstSheetPath(zip) {
        try {
            const wb = new DOMParser().parseFromString(await zip.file('xl/workbook.xml').async('string'), 'application/xml');
            const sheet = wb.getElementsByTagNameNS(SHEET_NS, 'sheet')[0];
            const rid = sheet.getAttributeNS(REL_NS, 'id') || sheet.getAttribute('r:id');
            const rels = new DOMParser().parseFromString(await zip.file('xl/_rels/workbook.xml.rels').async('string'), 'application/xml');
            const relNodes = rels.getElementsByTagName('Relationship');
            for (let i = 0; i < relNodes.length; i++) {
                if (relNodes[i].getAttribute('Id') === rid) {
                    let target = relNodes[i].getAttribute('Target');
                    if (target.startsWith('/')) return target.slice(1);
                    return 'xl/' + target;
                }
            }
        } catch (e) { /* fallback */ }
        return 'xl/worksheets/sheet1.xml';
    }

    async function loadSharedStrings(zip) {
        try {
            const entry = zip.file('xl/sharedStrings.xml');
            if (!entry) return [];
            const xml = await entry.async('string');
            const doc = new DOMParser().parseFromString(xml, 'application/xml');
            const sst = doc.getElementsByTagNameNS(SHEET_NS, 'sst')[0];
            if (!sst) return [];
            const siNodes = Array.from(sst.getElementsByTagNameNS(SHEET_NS, 'si'));
            return siNodes.map(si => (si.textContent || '').trim());
        } catch (e) {
            return [];
        }
    }

    function cellHasValue(c) {
        const v = c.getElementsByTagNameNS(SHEET_NS, 'v')[0];
        if (v && v.textContent.trim() !== '') return true;
        const t = c.getElementsByTagNameNS(SHEET_NS, 't')[0];
        return !!(t && t.textContent.trim() !== '');
    }

    function getCellText(c, sharedStrings = []) {
        if (!c) return '';
        const tAttr = c.getAttribute('t');
        if (tAttr === 'inlineStr') {
            const isNode = c.getElementsByTagNameNS(SHEET_NS, 'is')[0];
            return isNode ? (isNode.textContent || '').trim() : '';
        }
        if (tAttr === 's') {
            const v = c.getElementsByTagNameNS(SHEET_NS, 'v')[0];
            if (v && v.textContent !== '') {
                const idx = parseInt(v.textContent, 10);
                if (!isNaN(idx) && sharedStrings[idx] !== undefined) {
                    return (sharedStrings[idx] || '').trim();
                }
            }
            return '';
        }
        const vNode = c.getElementsByTagNameNS(SHEET_NS, 'v')[0];
        return vNode ? (vNode.textContent || '').trim() : '';
    }

    function appendRowsToSheetXml(xml, rowsData) {
        const doc = new DOMParser().parseFromString(xml, 'application/xml');
        const sheetData = doc.getElementsByTagNameNS(SHEET_NS, 'sheetData')[0];
        const rows = Array.from(sheetData.getElementsByTagNameNS(SHEET_NS, 'row'));

        // Ultima riga con dati nelle colonne A..G
        let lastDataRow = null;
        rows.forEach(r => {
            const cells = Array.from(r.getElementsByTagNameNS(SHEET_NS, 'c'));
            const has = cells.some(c => COLS.includes((c.getAttribute('r') || '').replace(/\d+/g, '')) && cellHasValue(c));
            if (has) lastDataRow = r;
        });
        let nextIdx = lastDataRow ? parseInt(lastDataRow.getAttribute('r'), 10) + 1 : 3;

        // Stili da copiare dall'ultima riga compilata
        const colStyles = {};
        if (lastDataRow) {
            Array.from(lastDataRow.getElementsByTagNameNS(SHEET_NS, 'c')).forEach(c => {
                const col = (c.getAttribute('r') || '').replace(/\d+/g, '');
                if (c.getAttribute('s')) colStyles[col] = c.getAttribute('s');
            });
        }
        const rowAttrsToCopy = ['spans', 's', 'customFormat', 'ht', 'customHeight'];

        rowsData.forEach(values => {
            const rIdx = nextIdx++;
            let row = rows.find(r => parseInt(r.getAttribute('r'), 10) === rIdx);
            let extraCells = [];
            if (row) {
                extraCells = Array.from(row.getElementsByTagNameNS(SHEET_NS, 'c'))
                    .filter(c => !COLS.includes((c.getAttribute('r') || '').replace(/\d+/g, '')));
                while (row.firstChild) row.removeChild(row.firstChild);
            } else {
                row = doc.createElementNS(SHEET_NS, 'row');
                row.setAttribute('r', String(rIdx));
                const after = rows.find(r => parseInt(r.getAttribute('r'), 10) > rIdx);
                sheetData.insertBefore(row, after || null);
                rows.push(row);
            }
            if (lastDataRow) {
                rowAttrsToCopy.forEach(a => {
                    const val = lastDataRow.getAttribute(a);
                    if (val !== null) row.setAttribute(a, val); else row.removeAttribute(a);
                });
            }
            COLS.forEach((col, i) => {
                const c = doc.createElementNS(SHEET_NS, 'c');
                c.setAttribute('r', col + rIdx);
                if (colStyles[col]) c.setAttribute('s', colStyles[col]);
                const val = (values[i] || '').toString();
                if (val) {
                    c.setAttribute('t', 'inlineStr');
                    const is = doc.createElementNS(SHEET_NS, 'is');
                    const t = doc.createElementNS(SHEET_NS, 't');
                    t.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve');
                    t.textContent = val;
                    is.appendChild(t);
                    c.appendChild(is);
                }
                row.appendChild(c);
            });
        });

        // Aggiorna l'area dati del foglio
        const dim = doc.getElementsByTagNameNS(SHEET_NS, 'dimension')[0];
        if (dim) {
            const ref = dim.getAttribute('ref') || 'A1:G1';
            const m = ref.match(/^([A-Z]+\d+):([A-Z]+)(\d+)$/);
            const lastRow = nextIdx - 1;
            if (m && parseInt(m[3], 10) < lastRow) dim.setAttribute('ref', `${m[1]}:${m[2]}${lastRow}`);
        }

        let out = new XMLSerializer().serializeToString(doc);
        if (!out.startsWith('<?xml')) {
            out = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n' + out;
        }
        return out;
    }

    function removeRowFromSheetXml(xml, targetData, sharedStrings = []) {
        const doc = new DOMParser().parseFromString(xml, 'application/xml');
        const sheetData = doc.getElementsByTagNameNS(SHEET_NS, 'sheetData')[0];
        if (!sheetData) return { newXml: xml, found: false };

        const rows = Array.from(sheetData.getElementsByTagNameNS(SHEET_NS, 'row'));
        const targetSigla = (targetData.sigla || '').toString().trim().toUpperCase();
        const targetDate = (targetData.date || '').toString().trim().replace(/[\/\-\.]/g, ' ');
        const targetDesc = (targetData.description || '').toString().trim().toUpperCase();

        let foundRowIndex = -1;
        // Cerca partendo dal fondo per trovare la corrispondenza più recente
        for (let i = rows.length - 1; i >= 0; i--) {
            const r = rows[i];
            const rIdx = parseInt(r.getAttribute('r'), 10);
            if (isNaN(rIdx) || rIdx <= 2) continue; // Salta intestazioni (righe 1 e 2)

            const cells = Array.from(r.getElementsByTagNameNS(SHEET_NS, 'c'));
            const cellMap = {};
            cells.forEach(c => {
                const col = (c.getAttribute('r') || '').replace(/\d+/g, '');
                cellMap[col] = getCellText(c, sharedStrings);
            });

            const rowSigla = (cellMap['A'] || '').toUpperCase().trim();
            const rowDesc = (cellMap['B'] || '').toUpperCase().trim();
            const rowDate = (cellMap['C'] || '').replace(/[\/\-\.]/g, ' ').trim();

            const siglaMatch = targetSigla ? (rowSigla === targetSigla || rowSigla.replace(/\s+/g, '') === targetSigla.replace(/\s+/g, '')) : true;
            const dateMatch = targetDate ? (rowDate === targetDate) : true;
            
            let descMatch = true;
            if (targetDesc && rowDesc) {
                // Confronta le descrizioni in modo tollerante
                const cleanT = targetDesc.replace(/[^A-Z0-9]/g, ' ').trim();
                const cleanR = rowDesc.replace(/[^A-Z0-9]/g, ' ').trim();
                descMatch = cleanT.includes(cleanR) || cleanR.includes(cleanT) || cleanT.split(' ')[0] === cleanR.split(' ')[0];
            }

            if (siglaMatch && dateMatch && descMatch) {
                foundRowIndex = i;
                break;
            }
        }

        if (foundRowIndex === -1) {
            return { newXml: xml, found: false };
        }

        const removedRow = rows[foundRowIndex];
        const removedRowNumber = parseInt(removedRow.getAttribute('r'), 10);
        sheetData.removeChild(removedRow);
        rows.splice(foundRowIndex, 1);

        // Scala le righe successive per non lasciare buchi negli indici
        for (let i = foundRowIndex; i < rows.length; i++) {
            const r = rows[i];
            const oldR = parseInt(r.getAttribute('r'), 10);
            const newR = oldR - 1;
            r.setAttribute('r', String(newR));
            const cells = Array.from(r.getElementsByTagNameNS(SHEET_NS, 'c'));
            cells.forEach(c => {
                const col = (c.getAttribute('r') || '').replace(/\d+/g, '');
                c.setAttribute('r', col + newR);
            });
        }

        // Aggiorna l'area dimension
        const dim = doc.getElementsByTagNameNS(SHEET_NS, 'dimension')[0];
        if (dim) {
            const ref = dim.getAttribute('ref') || 'A1:G1';
            const m = ref.match(/^([A-Z]+\d+):([A-Z]+)(\d+)$/);
            if (m) {
                const lastRow = Math.max(1, parseInt(m[3], 10) - 1);
                dim.setAttribute('ref', `${m[1]}:${m[2]}${lastRow}`);
            }
        }

        let out = new XMLSerializer().serializeToString(doc);
        if (!out.startsWith('<?xml')) {
            out = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n' + out;
        }
        return { newXml: out, found: true, removedRowNumber };
    }

    // ---------- Eliminazione richiesta dal file Excel ----------
    window.excelSyncDeleteRequest = async function (vehicle, req) {
        if (!window.excelSyncSupported()) {
            return await window.excelSyncEnqueueCloud('delete_request', vehicle, req);
        }
        let handle = await window.excelSyncGetHandle();
        if (!handle) {
            handle = await window.excelSyncEnsureHandle(true);
        }
        if (!handle) return { ok: false, notLinked: true };

        // 1. Rimuovi da eventuali pending locali
        const pending = getPending();
        const initialLen = pending.length;
        const filteredPending = pending.filter(p => p.id !== req.id);
        if (filteredPending.length !== initialLen) {
            setPending(filteredPending);
        }

        try {
            // Verifichiamo i permessi prima di accedere al file
            let q = await handle.queryPermission({ mode: 'readwrite' });
            if (q !== 'granted') {
                q = await handle.requestPermission({ mode: 'readwrite' });
                if (q !== 'granted') {
                    throw new Error('permesso di lettura/scrittura non autorizzato dal browser');
                }
            }

            const file = await handle.getFile();
            const zip = await JSZip.loadAsync(await file.arrayBuffer());
            const sheetPath = await resolveFirstSheetPath(zip);
            const sheetXml = await zip.file(sheetPath).async('string');
            const sharedStrings = await loadSharedStrings(zip);

            const targetData = {
                sigla: shortSigla(vehicle ? vehicle.sigla : ''),
                date: excelDate(req.date),
                description: (req.description || (req.types || []).join(', ')).toUpperCase()
            };

            const delRes = removeRowFromSheetXml(sheetXml, targetData, sharedStrings);
            if (!delRes.found) {
                return { ok: true, notFound: true, fileName: handle.name };
            }

            zip.file(sheetPath, delRes.newXml);
            const blob = await zip.generateAsync({
                type: 'blob',
                compression: 'DEFLATE',
                mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            });

            const writable = await handle.createWritable();
            await writable.write(blob);
            await writable.close();
            return { ok: true, removed: true, rowNumber: delRes.removedRowNumber, fileName: handle.name };
        } catch (e) {
            console.error('Errore rimozione riga Excel:', e);
            const locked = e && (e.name === 'NoModificationAllowedError' || e.name === 'InvalidStateError' || /lock|in use|utilizzo/i.test(e.message || ''));
            return {
                ok: false,
                error: locked ? 'il file è aperto in Microsoft Excel: chiudilo per aggiornarlo' : (e && e.message ? e.message : String(e))
            };
        }
    };

    // ---------- Aggiornamento manutenzione nel file Excel (v3.6.4) ----------
    function updateRowMaintenanceInSheetXml(xml, targetData, sharedStrings = []) {
        const doc = new DOMParser().parseFromString(xml, 'application/xml');
        const sheetData = doc.getElementsByTagNameNS(SHEET_NS, 'sheetData')[0];
        if (!sheetData) return { newXml: xml, found: false };

        const rows = Array.from(sheetData.getElementsByTagNameNS(SHEET_NS, 'row'));
        const searchSigla = (targetData.search_sigla || targetData.sigla || '').toString().trim().toUpperCase();
        const searchDesc = (targetData.search_desc || targetData.old_description || targetData.description || '').toString().trim().toUpperCase();
        const searchReqDate = (targetData.search_req_date || targetData.old_request_date || targetData.request_date) 
            ? excelDate(targetData.search_req_date || targetData.old_request_date || targetData.request_date) : '';
        const searchDateIn = (targetData.search_date_in || targetData.old_date_in || targetData.date_in) 
            ? excelDate(targetData.search_date_in || targetData.old_date_in || targetData.date_in) : '';

        const newSigla = (targetData.sigla || searchSigla || '').toString().trim().toUpperCase();
        const newDesc = (targetData.description !== undefined ? targetData.description : searchDesc).toString().trim().toUpperCase();
        const newReqDate = targetData.request_date ? excelDate(targetData.request_date) : (searchReqDate || '');
        const newWorkshop = (targetData.workshop !== undefined ? targetData.workshop : (targetData.old_workshop || '')).toString().trim().toUpperCase();
        const newDateIn = targetData.date_in ? excelDate(targetData.date_in) : '';
        const newDateOut = targetData.date_out ? excelDate(targetData.date_out) : '';

        const colStyles = {};
        rows.forEach(r => {
            Array.from(r.getElementsByTagNameNS(SHEET_NS, 'c')).forEach(c => {
                const col = (c.getAttribute('r') || '').replace(/\d+/g, '');
                if (c.getAttribute('s') && !colStyles[col]) colStyles[col] = c.getAttribute('s');
            });
        });

        let foundRowIndex = -1;
        // Cerca partendo dal fondo (dalla riga più recente)
        for (let i = rows.length - 1; i >= 0; i--) {
            const r = rows[i];
            const rIdx = parseInt(r.getAttribute('r'), 10);
            if (isNaN(rIdx) || rIdx <= 2) continue; // Salta intestazioni

            const cells = Array.from(r.getElementsByTagNameNS(SHEET_NS, 'c'));
            const cellMap = {};
            cells.forEach(c => {
                const col = (c.getAttribute('r') || '').replace(/\d+/g, '');
                cellMap[col] = getCellText(c, sharedStrings);
            });

            const rowSigla = (cellMap['A'] || '').toUpperCase().trim();
            const rowDesc = (cellMap['B'] || '').toUpperCase().trim();
            const rowReqDate = (cellMap['C'] || '').replace(/[\/\-\.]/g, ' ').trim();

            const siglaMatch = searchSigla ? (
                rowSigla === searchSigla || 
                rowSigla.replace(/\s+/g, '') === searchSigla.replace(/\s+/g, '')
            ) : true;

            if (!siglaMatch) continue;

            const reqDateMatch = searchReqDate ? (rowReqDate === searchReqDate) : true;

            let descMatch = false;
            if (searchDesc && rowDesc) {
                const cleanT = searchDesc.replace(/[^A-Z0-9]/g, ' ').trim();
                const cleanR = rowDesc.replace(/[^A-Z0-9]/g, ' ').trim();
                const tWords = cleanT.split(/\s+/).filter(w => w.length > 2);
                const rWords = cleanR.split(/\s+/).filter(w => w.length > 2);
                const commonWords = tWords.filter(w => rWords.includes(w));
                descMatch = cleanT.includes(cleanR) || cleanR.includes(cleanT) || (commonWords.length >= 2) || (tWords.length === 1 && rWords.includes(tWords[0]));
            } else {
                descMatch = true;
            }

            if (reqDateMatch && descMatch) {
                foundRowIndex = i;
                break;
            }
        }

        // Fallback 1: cerca per sola sigla + data richiesta
        if (foundRowIndex === -1 && searchSigla && searchReqDate) {
            for (let i = rows.length - 1; i >= 0; i--) {
                const r = rows[i];
                const rIdx = parseInt(r.getAttribute('r'), 10);
                if (isNaN(rIdx) || rIdx <= 2) continue;

                const cells = Array.from(r.getElementsByTagNameNS(SHEET_NS, 'c'));
                const cellMap = {};
                cells.forEach(c => {
                    const col = (c.getAttribute('r') || '').replace(/\d+/g, '');
                    cellMap[col] = getCellText(c, sharedStrings);
                });

                const rowSigla = (cellMap['A'] || '').toUpperCase().trim();
                const rowReqDate = (cellMap['C'] || '').replace(/[\/\-\.]/g, ' ').trim();

                if ((rowSigla === searchSigla || rowSigla.replace(/\s+/g, '') === searchSigla.replace(/\s+/g, '')) && rowReqDate === searchReqDate) {
                    foundRowIndex = i;
                    break;
                }
            }
        }

        // Fallback 2: cerca per sigla e descrizione simile
        if (foundRowIndex === -1 && searchSigla && searchDesc) {
            for (let i = rows.length - 1; i >= 0; i--) {
                const r = rows[i];
                const rIdx = parseInt(r.getAttribute('r'), 10);
                if (isNaN(rIdx) || rIdx <= 2) continue;

                const cells = Array.from(r.getElementsByTagNameNS(SHEET_NS, 'c'));
                const cellMap = {};
                cells.forEach(c => {
                    const col = (c.getAttribute('r') || '').replace(/\d+/g, '');
                    cellMap[col] = getCellText(c, sharedStrings);
                });

                const rowSigla = (cellMap['A'] || '').toUpperCase().trim();
                const rowDesc = (cellMap['B'] || '').toUpperCase().trim();

                if (rowSigla === searchSigla || rowSigla.replace(/\s+/g, '') === searchSigla.replace(/\s+/g, '')) {
                    const cleanT = searchDesc.replace(/[^A-Z0-9]/g, ' ').trim();
                    const cleanR = rowDesc.replace(/[^A-Z0-9]/g, ' ').trim();
                    if (cleanT.includes(cleanR) || cleanR.includes(cleanT)) {
                        foundRowIndex = i;
                        break;
                    }
                }
            }
        }

        // Se non ancora trovata, aggiungi come nuova riga sul foglio per garantire sincronizzazione completa
        if (foundRowIndex === -1) {
            const newRowCells = [
                newSigla,
                newDesc,
                newReqDate,
                newWorkshop,
                newDateIn,
                newDateOut,
                ''
            ];
            const appendedXml = appendRowsToSheetXml(xml, [newRowCells]);
            return { newXml: appendedXml, found: false, appended: true };
        }

        const targetRow = rows[foundRowIndex];
        const rIdx = parseInt(targetRow.getAttribute('r'), 10);

        function setCellVal(colLetter, textVal) {
            const cellRef = colLetter + rIdx;
            const cells = Array.from(targetRow.getElementsByTagNameNS(SHEET_NS, 'c'));
            let c = cells.find(cell => (cell.getAttribute('r') || '') === cellRef);
            if (!c) {
                if (!textVal) return;
                c = doc.createElementNS(SHEET_NS, 'c');
                c.setAttribute('r', cellRef);
                if (colStyles[colLetter]) c.setAttribute('s', colStyles[colLetter]);
                const colOrder = COLS;
                const targetOrderIdx = colOrder.indexOf(colLetter);
                const after = cells.find(cell => {
                    const l = (cell.getAttribute('r') || '').replace(/\d+/g, '');
                    const idx = colOrder.indexOf(l);
                    return idx > targetOrderIdx || (idx === -1 && l > colLetter);
                });
                targetRow.insertBefore(c, after || null);
            }
            while (c.firstChild) c.removeChild(c.firstChild);
            if (textVal) {
                c.setAttribute('t', 'inlineStr');
                const is = doc.createElementNS(SHEET_NS, 'is');
                const t = doc.createElementNS(SHEET_NS, 't');
                t.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve');
                t.textContent = textVal;
                is.appendChild(t);
                c.appendChild(is);
            } else {
                c.removeAttribute('t');
            }
        }

        // Colonna 1 (A): Sigla
        if (newSigla) setCellVal('A', newSigla);
        // Colonna 2 (B): Descrizione
        if (newDesc !== undefined) setCellVal('B', newDesc);
        // Colonna 3 (C): Data Richiesta
        if (newReqDate !== undefined) setCellVal('C', newReqDate);
        // Colonna 4 (D): Officina / Luogo
        if (newWorkshop !== undefined) setCellVal('D', newWorkshop);
        // Colonna 5 (E): DATA ENTRATA IN OFFICINA
        setCellVal('E', newDateIn);
        // Colonna 6 (F): DATA USCITA
        setCellVal('F', newDateOut);

        let out = new XMLSerializer().serializeToString(doc);
        if (!out.startsWith('<?xml')) {
            out = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n' + out;
        }
        return { newXml: out, found: true, rowNumber: rIdx };
    }

    window.excelSyncUpdateMaintenance = async function (vehicle, recordData) {
        if (!window.excelSyncSupported()) {
            return await window.excelSyncEnqueueCloud('update_maintenance', vehicle, recordData);
        }
        let handle = await window.excelSyncEnsureHandle(false);
        if (!handle) handle = await window.excelSyncEnsureHandle(true);
        if (!handle) return { ok: false, notLinked: true };

        const targetData = {
            sigla: shortSigla(vehicle ? (vehicle.sigla || vehicle.plate) : ''),
            search_sigla: shortSigla(vehicle ? (vehicle.sigla || vehicle.plate) : ''),
            search_desc: (recordData.old_description || recordData.description || '').toString().trim().toUpperCase(),
            search_req_date: recordData.old_request_date || recordData.request_date || '',
            search_date_in: recordData.old_date_in || recordData.date || '',
            description: recordData.description || '',
            request_date: recordData.request_date || '',
            date_in: recordData.date || '',
            date_out: recordData.date_out || '',
            workshop: recordData.workshop || ''
        };

        try {
            let q = await handle.queryPermission({ mode: 'readwrite' });
            if (q !== 'granted') {
                q = await handle.requestPermission({ mode: 'readwrite' });
                if (q !== 'granted') {
                    throw new Error('permesso di lettura/scrittura non autorizzato dal browser');
                }
            }

            const file = await handle.getFile();
            const zip = await JSZip.loadAsync(await file.arrayBuffer());
            const sheetPath = await resolveFirstSheetPath(zip);
            const sheetXml = await zip.file(sheetPath).async('string');
            const sharedStrings = await loadSharedStrings(zip);

            const updateRes = updateRowMaintenanceInSheetXml(sheetXml, targetData, sharedStrings);

            zip.file(sheetPath, updateRes.newXml);
            const blob = await zip.generateAsync({
                type: 'blob',
                compression: 'DEFLATE',
                mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            });

            const writable = await handle.createWritable();
            await writable.write(blob);
            await writable.close();
            if (updateRes.found) {
                console.log(`Excel: aggiornata riga ${updateRes.rowNumber} (${targetData.sigla}) -> Entrata: ${targetData.date_in}, Uscita: ${targetData.date_out}`);
                return { ok: true, updated: true, rowNumber: updateRes.rowNumber, fileName: handle.name };
            } else {
                console.log(`Excel: riga non trovata, accodata nuova riga per ${targetData.sigla}`);
                return { ok: true, appended: true, fileName: handle.name };
            }
        } catch (e) {
            console.error('Errore aggiornamento manutenzione Excel:', e);
            const locked = e && (e.name === 'NoModificationAllowedError' || e.name === 'InvalidStateError' || /lock|in use|utilizzo/i.test(e.message || ''));
            return {
                ok: false,
                error: locked ? 'il file è aperto in Microsoft Excel: chiudilo per aggiornarlo' : (e && e.message ? e.message : String(e))
            };
        }
    };
    window.excelSyncUpdateMaintenanceDates = window.excelSyncUpdateMaintenance;

    // ---------- Eliminazione manutenzione dal file Excel (v3.6.4) ----------
    window.excelSyncDeleteMaintenance = async function (vehicle, record) {
        if (!window.excelSyncSupported()) {
            return await window.excelSyncEnqueueCloud('delete_maintenance', vehicle, record);
        }
        let handle = await window.excelSyncGetHandle();
        if (!handle) handle = await window.excelSyncEnsureHandle(true);
        if (!handle) return { ok: false, notLinked: true };

        try {
            let q = await handle.queryPermission({ mode: 'readwrite' });
            if (q !== 'granted') {
                q = await handle.requestPermission({ mode: 'readwrite' });
                if (q !== 'granted') {
                    throw new Error('permesso di lettura/scrittura non autorizzato dal browser');
                }
            }

            const file = await handle.getFile();
            const zip = await JSZip.loadAsync(await file.arrayBuffer());
            const sheetPath = await resolveFirstSheetPath(zip);
            const sheetXml = await zip.file(sheetPath).async('string');
            const sharedStrings = await loadSharedStrings(zip);

            const targetData = {
                sigla: shortSigla(vehicle ? (vehicle.sigla || vehicle.plate) : ''),
                date: record.request_date ? excelDate(record.request_date) : (record.date ? excelDate(record.date) : ''),
                description: (record.description || '').toUpperCase()
            };

            const delRes = removeRowFromSheetXml(sheetXml, targetData, sharedStrings);
            if (!delRes.found) {
                return { ok: true, notFound: true, fileName: handle.name };
            }

            zip.file(sheetPath, delRes.newXml);
            const blob = await zip.generateAsync({
                type: 'blob',
                compression: 'DEFLATE',
                mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            });

            const writable = await handle.createWritable();
            await writable.write(blob);
            await writable.close();
            return { ok: true, removed: true, rowNumber: delRes.removedRowNumber, fileName: handle.name };
        } catch (e) {
            console.error('Errore rimozione riga manutenzione Excel:', e);
            const locked = e && (e.name === 'NoModificationAllowedError' || e.name === 'InvalidStateError' || /lock|in use|utilizzo/i.test(e.message || ''));
            return {
                ok: false,
                error: locked ? 'il file è aperto in Microsoft Excel: chiudilo per aggiornarlo' : (e && e.message ? e.message : String(e))
            };
        }
    };

    // ---------- Elaborazione Automatica Coda Cloud (PC Desktop) ----------
    window._isProcessingExcelCloudQueue = false;

    window.excelSyncProcessCloudQueue = async function (forceInteractive = false) {
        if (!window.excelSyncSupported()) return;
        if (window._isProcessingExcelCloudQueue) return;

        const firestore = getFirestore();
        if (!firestore) return;

        try {
            const snap = await firestore.collection('excel_sync_queue')
                .where('status', '==', 'pending')
                .get();

            if (snap.empty) return;

            // Ordina cronologicamente in memoria
            const docs = snap.docs.sort((a, b) => {
                const ta = a.data().created_at || '';
                const tb = b.data().created_at || '';
                return ta.localeCompare(tb);
            });

            // Recupera l'handle del file Excel sul Desktop (false = senza prompt se non richiesto)
            let handle = await window.excelSyncEnsureHandle(false);
            if (!handle && forceInteractive) {
                handle = await window.excelSyncEnsureHandle(true);
            }
            if (!handle) return;

            let q = await handle.queryPermission({ mode: 'readwrite' });
            if (q !== 'granted') {
                if (forceInteractive) {
                    q = await handle.requestPermission({ mode: 'readwrite' });
                }
                if (q !== 'granted') return;
            }

            window._isProcessingExcelCloudQueue = true;

            const file = await handle.getFile();
            const zip = await JSZip.loadAsync(await file.arrayBuffer());
            const sheetPath = await resolveFirstSheetPath(zip);
            let sheetXml = await zip.file(sheetPath).async('string');
            const sharedStrings = await loadSharedStrings(zip);

            let modifiedCount = 0;
            const completedDocIds = [];

            for (const docSnap of docs) {
                const item = docSnap.data();
                const action = item.action;
                const d = item.data || {};
                const sigla = item.sigla || '';

                if (action === 'update_maintenance') {
                    const targetData = {
                        sigla: shortSigla(sigla),
                        search_sigla: shortSigla(sigla),
                        search_desc: (d.old_description || d.description || '').toString().trim().toUpperCase(),
                        search_req_date: d.old_request_date || d.request_date || '',
                        search_date_in: d.old_date_in || d.date || '',
                        description: d.description || '',
                        request_date: d.request_date || '',
                        date_in: d.date || '',
                        date_out: d.date_out || '',
                        workshop: d.workshop || ''
                    };
                    const res = updateRowMaintenanceInSheetXml(sheetXml, targetData, sharedStrings);
                    sheetXml = res.newXml;
                    modifiedCount++;
                    completedDocIds.push(docSnap.id);
                } else if (action === 'append_request') {
                    const matchingLuogo = d.workshop || findLocationInText(d.description, window.cachedLocations || []);
                    const row = [
                        shortSigla(sigla),
                        (d.description || '').toUpperCase().trim(),
                        d.date ? excelDate(d.date) : '',
                        matchingLuogo.toUpperCase(),
                        d.date_in ? excelDate(d.date_in) : '',
                        d.date_out ? excelDate(d.date_out) : '',
                        ''
                    ];
                    sheetXml = appendRowsToSheetXml(sheetXml, [row]);
                    modifiedCount++;
                    completedDocIds.push(docSnap.id);
                } else if (action === 'delete_maintenance' || action === 'delete_request') {
                    const targetData = {
                        sigla: shortSigla(sigla),
                        date: d.request_date ? excelDate(d.request_date) : (d.date ? excelDate(d.date) : ''),
                        description: (d.description || '').toUpperCase()
                    };
                    const res = removeRowFromSheetXml(sheetXml, targetData, sharedStrings);
                    if (res.found) {
                        sheetXml = res.newXml;
                    }
                    modifiedCount++;
                    completedDocIds.push(docSnap.id);
                }
            }

            if (modifiedCount > 0) {
                zip.file(sheetPath, sheetXml);
                const blob = await zip.generateAsync({
                    type: 'blob',
                    compression: 'DEFLATE',
                    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
                });
                const writable = await handle.createWritable();
                await writable.write(blob);
                await writable.close();
                console.log(`[Excel Cloud Queue] Sincronizzate con successo ${modifiedCount} modifiche da cellulare nel file ${handle.name}!`);

                window.showExcelAutoSyncToast && window.showExcelAutoSyncToast(modifiedCount);
            }

            // Segna come completati i record elaborati su Firestore
            if (completedDocIds.length > 0) {
                const batch = firestore.batch();
                completedDocIds.forEach(id => {
                    batch.update(firestore.collection('excel_sync_queue').doc(id), {
                        status: 'completed',
                        processed_at: new Date().toISOString()
                    });
                });
                await batch.commit();
            }

        } catch (err) {
            console.warn('[Excel Cloud Queue] Errore elaborazione coda automatica:', err);
        } finally {
            window._isProcessingExcelCloudQueue = false;
        }
    };

    window.showExcelAutoSyncToast = function (count) {
        let toast = document.getElementById('excel-cloud-sync-toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'excel-cloud-sync-toast';
            toast.style.position = 'fixed';
            toast.style.bottom = '24px';
            toast.style.right = '24px';
            toast.style.zIndex = '99999';
            toast.style.backgroundColor = '#065f46';
            toast.style.color = '#ffffff';
            toast.style.padding = '0.75rem 1.25rem';
            toast.style.borderRadius = '10px';
            toast.style.boxShadow = '0 6px 20px rgba(0, 0, 0, 0.25)';
            toast.style.display = 'flex';
            toast.style.alignItems = 'center';
            toast.style.gap = '0.65rem';
            toast.style.fontSize = '0.88rem';
            toast.style.fontWeight = '600';
            toast.style.transition = 'opacity 0.4s ease, transform 0.4s ease';
            toast.style.pointerEvents = 'none';
            document.body.appendChild(toast);
        }
        toast.innerHTML = `<i class="fa-solid fa-cloud-arrow-down" style="color: #6ee7b7; font-size: 1.15rem;"></i> Sincronizzato con il file Excel del Desktop (${count} ${count === 1 ? 'modifica dal cellulare' : 'modifiche dal cellulare'})`;
        toast.style.opacity = '1';
        toast.style.transform = 'translateY(0)';
        clearTimeout(window._excelCloudSyncToastTimer);
        window._excelCloudSyncToastTimer = setTimeout(() => {
            if (toast) {
                toast.style.opacity = '0';
                toast.style.transform = 'translateY(10px)';
            }
        }, 4500);
    };

    function initCloudQueueAutoSync() {
        if (!window.excelSyncSupported()) return;
        const firestore = getFirestore();
        if (!firestore) return;

        // 1. Elaborazione automatica dopo avvio (senza gesture se permesso già memorizzato)
        setTimeout(() => {
            window.excelSyncProcessCloudQueue(false);
        }, 1500);

        // 2. Listener real-time Firestore per aggiornamenti istantanei mentre la pagina PC è aperta
        try {
            firestore.collection('excel_sync_queue')
                .where('status', '==', 'pending')
                .onSnapshot(snap => {
                    if (snap && !snap.empty) {
                        window.excelSyncProcessCloudQueue(false);
                    }
                }, err => {
                    console.warn('[Excel Cloud Sync] Snapshot listener:', err);
                });
        } catch (e) {
            console.warn('[Excel Cloud Sync] Impossibile avviare listener realtime:', e);
        }

        // 3. Elaborazione al ritorno del focus o cambio scheda
        window.addEventListener('focus', () => {
            window.excelSyncProcessCloudQueue(false);
        });

        // 4. Se Chrome richiede una gesture dell'utente dopo un riavvio completo,
        // al primissimo click o tasto premuto ovunque nella finestra si sincronizza in background
        const passiveRun = () => {
            window.excelSyncProcessCloudQueue(true);
        };
        document.addEventListener('click', passiveRun, { capture: true, once: true, passive: true });
        document.addEventListener('keydown', passiveRun, { capture: true, once: true, passive: true });
    }

    // ---------- UI ----------
    window._excelSyncInternals = { appendRowsToSheetXml, removeRowFromSheetXml, resolveFirstSheetPath, loadSharedStrings };

    window.excelSyncRefreshButton = async function () {
        const btn = document.getElementById('repair-excel-sync-btn');
        if (!btn) return;
        if (!window.excelSyncSupported()) { btn.style.display = 'none'; return; }
        btn.style.display = 'flex';
        const handle = await window.excelSyncGetHandle();
        const pending = getPending().length;
        if (!handle) {
            btn.innerHTML = '<i class="fa-solid fa-file-excel"></i> Excel Desktop (auto al salvataggio)';
            btn.title = 'ORGANIZZAZIONE RICHIESTE MEZZI.xlsx sul Desktop verrà collegato automaticamente al salvataggio (oppure clicca qui per collegarlo subito)';
            btn.style.background = '#f8fafc';
            btn.style.color = '#047857';
            btn.style.borderColor = '#cbd5e1';
        } else if (pending > 0) {
            btn.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> Excel (${pending} in sospeso)`;
            btn.title = 'Clicca per scrivere le righe in sospeso nel file ' + handle.name;
            btn.style.background = '#fef3c7';
            btn.style.color = '#92400e';
            btn.style.borderColor = '#fde68a';
        } else {
            btn.innerHTML = '<i class="fa-solid fa-circle-check"></i> ' + handle.name;
            btn.title = 'Sincronizzazione attiva con ' + handle.name + ' sul Desktop. Clicca per verificare o ricollegare.';
            btn.style.background = '#dcfce7';
            btn.style.color = '#166534';
            btn.style.borderColor = '#86efac';
        }
    };

    window.excelSyncNotify = function (res) {
        if (!res || res.skipped || res.notLinked) return;
        if (res.ok) {
            if (res.written > 0) console.log(`Excel: aggiunte ${res.written} righe a ${res.fileName}`);
        } else {
            console.warn(`Excel non aggiornato: ${res.error}. La riga resta in sospeso.`);
        }
    };

    // ---------- Pannello di Gestione Sincronizzazione in Gestione Database (v3.5.1) ----------
    window.renderExcelSyncPanel = async function () {
        const box = document.getElementById('excel-sync-mgmt-container');
        if (!box) return;

        if (!window.excelSyncSupported || !window.excelSyncSupported()) {
            const isMob = window.isMobileDevice && window.isMobileDevice();
            box.innerHTML = `
                <div style="background: #f0fdf4; border: 1px solid #86efac; border-radius: 0.65rem; padding: 0.85rem 1.15rem; display: flex; align-items: center; gap: 0.85rem; font-size: 0.85rem; color: #166534;">
                    <i class="fa-solid fa-cloud-arrow-up" style="color: #059669; font-size: 1.4rem; flex-shrink: 0;"></i>
                    <div>
                        <div style="font-weight: 700; font-size: 0.92rem; color: #14532d;">Sincronizzazione Automatica Cloud Attiva</div>
                        <div style="font-size: 0.8rem; color: #15803d; margin-top: 0.2rem;">${isMob ? 'Tutte le modifiche alle manutenzioni e le richieste inserite dal cellulare vengono trasmesse a Firebase e scritte automaticamente nel file Excel <strong>ORGANIZZAZIONE RICHIESTE MEZZI.xlsx</strong> sul PC Desktop senza bisogno di premere alcun tasto.' : 'Browser non compatibile con la scrittura diretta: le modifiche vengono sincronizzate via cloud.'}</div>
                    </div>
                </div>
            `;
            return;
        }

        const handle = await window.excelSyncGetHandle();
        const pendingCount = window.excelSyncPendingCount ? window.excelSyncPendingCount() : 0;

        let statusBadge = '';
        let statusDesc = '';
        let statusBorder = '#cbd5e1';
        let statusBg = '#ffffff';

        if (handle) {
            statusBorder = pendingCount > 0 ? '#fde68a' : '#86efac';
            statusBg = pendingCount > 0 ? '#fffbeb' : '#f0fdf4';
            statusBadge = pendingCount > 0
                ? `<span style="background: #fef3c7; color: #92400e; font-size: 0.75rem; font-weight: 700; padding: 0.2rem 0.6rem; border-radius: 9999px; border: 1px solid #fde68a; display: inline-flex; align-items: center; gap: 0.35rem;"><i class="fa-solid fa-triangle-exclamation"></i> ${pendingCount} in attesa</span>`
                : `<span style="background: #dcfce7; color: #166534; font-size: 0.75rem; font-weight: 700; padding: 0.2rem 0.6rem; border-radius: 9999px; border: 1px solid #86efac; display: inline-flex; align-items: center; gap: 0.35rem;"><i class="fa-solid fa-circle-check"></i> Collegato e Attivo</span>`;
            statusDesc = `File collegato: <strong style="color: #0f172a;">${handle.name}</strong> sul Desktop di questo PC. ${pendingCount > 0 ? `<span style="color: #b45309; font-weight: 600;">(${pendingCount} richiesta/e salvate non ancora scritte nel file Excel).</span>` : 'Tutte le richieste sono allineate regolarmente.'}`;
        } else {
            statusBorder = '#e2e8f0';
            statusBg = '#f8fafc';
            statusBadge = `<span style="background: #f1f5f9; color: #475569; font-size: 0.75rem; font-weight: 700; padding: 0.2rem 0.6rem; border-radius: 9999px; border: 1px solid #cbd5e1; display: inline-flex; align-items: center; gap: 0.35rem;"><i class="fa-solid fa-link-slash"></i> Non collegato su questo PC</span>`;
            statusDesc = `Nessun file Excel collegato sul Desktop di questa postazione. Verrà collegato in automatico al primo salvataggio di una riparazione, oppure puoi collegarlo subito qui a fianco.`;
        }

        box.innerHTML = `
            <div style="background: ${statusBg}; border: 1px solid ${statusBorder}; border-radius: 0.75rem; padding: 0.85rem 1.15rem; display: flex; justify-content: space-between; align-items: center; gap: 1rem; flex-wrap: wrap;">
                <div style="display: flex; align-items: center; gap: 0.85rem; min-width: 260px; flex: 1;">
                    <div style="width: 40px; height: 40px; border-radius: 8px; background: #ecfdf5; border: 1px solid #a7f3d0; display: flex; align-items: center; justify-content: center; color: #059669; font-size: 1.3rem; flex-shrink: 0;">
                        <i class="fa-solid fa-file-excel"></i>
                    </div>
                    <div>
                        <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
                            <span style="font-weight: 700; font-size: 0.92rem; color: #1e293b;">Sincronizzazione Desktop: ORGANIZZAZIONE RICHIESTE MEZZI.xlsx</span>
                            ${statusBadge}
                        </div>
                        <div style="font-size: 0.8rem; color: #64748b; margin-top: 0.2rem;">
                            ${statusDesc}
                        </div>
                    </div>
                </div>
                <div style="display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap;">
                    ${pendingCount > 0 ? `
                    <button type="button" class="btn" onclick="excelSyncFlushManual()" style="background: #d97706; color: white; padding: 0.45rem 0.85rem; font-size: 0.82rem; border: none; border-radius: 0.4rem; cursor: pointer; display: flex; align-items: center; gap: 0.4rem; font-weight: 600;" title="Scrive le righe in coda nel foglio Excel">
                        <i class="fa-solid fa-rotate"></i> Scrivi ${pendingCount} in Coda
                    </button>` : ''}
                    <button type="button" class="btn" onclick="excelSyncConnectManual()" style="background: #059669; color: white; padding: 0.45rem 0.85rem; font-size: 0.82rem; border: none; border-radius: 0.4rem; cursor: pointer; display: flex; align-items: center; gap: 0.4rem; font-weight: 600;">
                        <i class="fa-solid fa-folder-open"></i> ${handle ? 'Cambia / Ricollega File' : 'Collega File Excel'}
                    </button>
                    ${handle ? `
                    <button type="button" class="btn" onclick="excelSyncTestAccess()" style="background: #ffffff; color: #334155; border: 1px solid #cbd5e1; padding: 0.45rem 0.8rem; font-size: 0.82rem; border-radius: 0.4rem; cursor: pointer; display: flex; align-items: center; gap: 0.4rem;" title="Verifica permessi e accessibilità del file">
                        <i class="fa-solid fa-check-double"></i> Verifica Accesso
                    </button>
                    <button type="button" class="btn" onclick="excelSyncDisconnectManual()" style="background: #fff1f2; color: #be123c; border: 1px solid #fecdd3; padding: 0.45rem 0.8rem; font-size: 0.82rem; border-radius: 0.4rem; cursor: pointer; display: flex; align-items: center; gap: 0.4rem;" title="Rimuove il collegamento memorizzato in questo browser">
                        <i class="fa-solid fa-link-slash"></i> Scollega
                    </button>` : ''}
                </div>
            </div>
        `;
    };

    window.excelSyncConnectManual = async function () {
        try {
            const handle = await window.excelSyncEnsureHandle(true);
            if (handle) {
                if (window.renderExcelSyncPanel) await window.renderExcelSyncPanel();
                alert(`File "${handle.name}" collegato con successo su questo computer!`);
            }
        } catch (e) {
            console.error('Errore collegamento manuale Excel:', e);
            alert('Errore durante il collegamento: ' + (e && e.message ? e.message : e));
        }
    };

    window.excelSyncFlushManual = async function () {
        try {
            const res = await window.excelSyncFlush();
            if (window.renderExcelSyncPanel) await window.renderExcelSyncPanel();
            if (res && res.ok) {
                alert(`Sincronizzazione completata! Scritte ${res.written} richiesta/e nel file ${res.fileName || 'Excel'}.`);
            } else if (res) {
                alert(`Attenzione: ${res.error || 'impossibile aggiornare il file'}`);
            }
        } catch (e) {
            console.error('Errore sincronizzazione manuale:', e);
            alert('Errore sincronizzazione: ' + (e && e.message ? e.message : e));
        }
    };

    window.excelSyncTestAccess = async function () {
        try {
            const handle = await window.excelSyncGetHandle();
            if (!handle) {
                alert('Nessun file Excel collegato.');
                return;
            }
            let q = await handle.queryPermission({ mode: 'readwrite' });
            if (q !== 'granted') {
                q = await handle.requestPermission({ mode: 'readwrite' });
            }
            if (q === 'granted') {
                const file = await handle.getFile();
                alert(`Collegamento funzionante!\n\nFile: ${handle.name}\nDimensione: ${(file.size / 1024).toFixed(1)} KB\nUltima modifica: ${new Date(file.lastModified).toLocaleString('it-IT')}\nPermesso scrittura: Concesso.`);
            } else {
                alert(`Permesso di scrittura non concesso (stato: ${q}).`);
            }
            if (window.renderExcelSyncPanel) await window.renderExcelSyncPanel();
        } catch (e) {
            console.error('Errore test accesso Excel:', e);
            alert('Errore durante la verifica del file: ' + (e && e.message ? e.message : e));
        }
    };

    window.excelSyncDisconnectManual = async function () {
        if (!confirm('Sei sicuro di voler scollegare il file Excel da questo computer? Potrai ricollegarlo in qualsiasi momento.')) return;
        try {
            await window.excelSyncReset();
            if (window.renderExcelSyncPanel) await window.renderExcelSyncPanel();
            alert('Collegamento rimosso. Il file sul disco non è stato modificato.');
        } catch (e) {
            console.error('Errore scollegamento Excel:', e);
            alert('Errore durante lo scollegamento: ' + e.message);
        }
    };

    // Avvia il listener di sincronizzazione cloud automatica (PC Desktop)
    initCloudQueueAutoSync();
})();
