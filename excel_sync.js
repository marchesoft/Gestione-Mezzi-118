// =====================================================================
// Sincronizzazione Richieste di Riparazione -> file Excel locale (v3.4.4)
// File di destinazione: "ORGANIZZAZIONE RICHIESTE MEZZI.xlsx" (Desktop)
//
// Usa la File System Access API (Chrome / Edge desktop): l'utente collega
// il file una sola volta, l'handle viene memorizzato in IndexedDB e ad ogni
// nuova richiesta di riparazione viene aggiunta una riga in fondo al foglio.
// Il file viene modificato direttamente a livello XML (JSZip) per preservare
// formattazione, larghezze colonne, stili e impostazioni di stampa.
// Se il file non è scrivibile (es. aperto in Excel) la riga resta in coda
// (localStorage) e viene scritta al salvataggio successivo o premendo
// il pulsante "Excel" nella finestra della richiesta.
// =====================================================================
(function () {
    const DB_NAME = 'gm118_excel_sync';
    const STORE_NAME = 'handles';
    const HANDLE_KEY = 'organizzazione_richieste';
    const PENDING_KEY = 'gm118_excel_pending_rows';
    const SHEET_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
    const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
    const COLS = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];

    window.excelSyncSupported = function () {
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
            tx.objectStore(STORE_NAME).put(value, key);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }

    window.excelSyncGetHandle = async function () {
        if (!window.excelSyncSupported()) return null;
        try { return await idbGet(HANDLE_KEY); } catch (e) { return null; }
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
        // DD/MM/YYYY -> "DD MM YY" (formato usato nel foglio)
        const p = (dateStr || '').split(/[\/\-.]/);
        if (p.length === 3) {
            let [d, m, y] = p;
            if (d.length === 4) { const t = d; d = y; y = t; } // YYYY-MM-DD
            return `${d.padStart(2, '0')} ${m.padStart(2, '0')} ${y.slice(-2)}`;
        }
        return dateStr || '';
    }
    window.buildExcelRowFromRepairRequest = function (vehicle, req) {
        let tipo = (req.description || '').toString()
            .split(/\r?\n/).map(s => s.trim()).filter(Boolean).join(', ');
        if (!tipo) tipo = (req.types || []).join(', ');
        return {
            id: req.id,
            cells: [
                shortSigla(vehicle ? vehicle.sigla : ''), // SIGLA
                tipo.toUpperCase(),                         // TIPO INTERVENTO
                excelDate(req.date),                        // DATA RICHIESTA
                '',                                         // OFFICINA ASSEGNATA
                '',                                         // DATA ENTRATA
                '',                                         // DATA USCITA
                ''                                          // NOTE
            ]
        };
    };

    // ---------- Permessi ----------
    async function ensurePermission(handle, interactive) {
        const opts = { mode: 'readwrite' };
        if ((await handle.queryPermission(opts)) === 'granted') return true;
        if (!interactive) return false;
        try {
            return (await handle.requestPermission(opts)) === 'granted';
        } catch (e) {
            return false;
        }
    }

    // Da chiamare come PRIMA istruzione nel click (serve il gesto utente)
    window.excelSyncPrepare = async function () {
        const handle = await window.excelSyncGetHandle();
        if (!handle) return false;
        return ensurePermission(handle, true);
    };

    // ---------- Collegamento del file ----------
    window.linkExcelSyncFile = async function () {
        if (!window.excelSyncSupported()) {
            alert('La sincronizzazione con il file Excel è disponibile solo su computer con Google Chrome o Microsoft Edge.');
            return;
        }
        try {
            const existing = await window.excelSyncGetHandle();
            if (existing && getPending().length > 0) {
                // File già collegato: prova a scrivere le righe in sospeso
                if (await ensurePermission(existing, true)) {
                    const res = await window.excelSyncFlush();
                    window.excelSyncNotify(res);
                    window.excelSyncRefreshButton();
                    return;
                }
            }
            const [handle] = await window.showOpenFilePicker({
                id: 'gm118-excel',
                startIn: 'desktop',
                multiple: false,
                types: [{
                    description: 'Cartella di lavoro Excel',
                    accept: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'] }
                }]
            });
            if (!handle) return;
            if (!(await ensurePermission(handle, true))) {
                alert('Permesso di scrittura sul file non concesso.');
                return;
            }
            await idbSet(HANDLE_KEY, handle);
            let msg = `File collegato: ${handle.name}\nDa ora ogni nuova richiesta di riparazione verrà aggiunta in fondo al foglio.`;
            if (getPending().length > 0) {
                const res = await window.excelSyncFlush();
                if (res.ok) msg += `\n\nScritte ${res.written} righe in sospeso.`;
                else msg += `\n\nRighe in sospeso non scritte: ${res.error}`;
            }
            alert(msg);
        } catch (e) {
            if (e && e.name === 'AbortError') return;
            console.error('Errore collegamento file Excel:', e);
            alert('Impossibile collegare il file Excel: ' + (e && e.message ? e.message : e));
        }
        window.excelSyncRefreshButton();
    };

    // ---------- Accodamento + scrittura ----------
    window.excelSyncAppendRequest = async function (vehicle, req) {
        if (!window.excelSyncSupported()) return { ok: false, skipped: true };
        const handle = await window.excelSyncGetHandle();
        if (!handle) return { ok: false, notLinked: true };
        const pending = getPending();
        if (!pending.some(p => p.id === req.id)) {
            pending.push(window.buildExcelRowFromRepairRequest(vehicle, req));
            setPending(pending);
        }
        return window.excelSyncFlush();
    };

    window.excelSyncFlush = async function () {
        const pending = getPending();
        if (pending.length === 0) return { ok: true, written: 0 };
        const handle = await window.excelSyncGetHandle();
        if (!handle) return { ok: false, notLinked: true, pending: pending.length };
        if (!(await ensurePermission(handle, false))) {
            return { ok: false, error: 'permesso di scrittura non concesso', pending: pending.length };
        }
        try {
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
                error: locked ? 'il file è aperto in Excel: chiudilo e premi il pulsante "Excel"' : (e && e.message ? e.message : String(e)),
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
        if (!window.excelSyncSupported()) return { ok: false, skipped: true };
        const handle = await window.excelSyncGetHandle();
        if (!handle) return { ok: false, notLinked: true };

        // 1. Rimuovi da eventuali pending locali
        const pending = getPending();
        const initialLen = pending.length;
        const filteredPending = pending.filter(p => p.id !== req.id);
        if (filteredPending.length !== initialLen) {
            setPending(filteredPending);
        }

        // 2. Se non abbiamo il permesso o il file non è modificabile
        if (!(await ensurePermission(handle, false))) {
            return { ok: false, error: 'permesso di scrittura non concesso' };
        }

        try {
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
                error: locked ? 'il file è aperto in Excel: chiudilo per aggiornarlo' : (e && e.message ? e.message : String(e))
            };
        }
    };

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
            btn.innerHTML = '<i class="fa-solid fa-file-excel"></i> Collega Excel';
            btn.title = 'Collega il file ORGANIZZAZIONE RICHIESTE MEZZI.xlsx per aggiungere automaticamente ogni richiesta';
            btn.style.background = '#f1f5f9';
            btn.style.color = '#166534';
        } else if (pending > 0) {
            btn.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> Excel (${pending} in sospeso)`;
            btn.title = 'Clicca per scrivere le righe in sospeso nel file ' + handle.name;
            btn.style.background = '#fef3c7';
            btn.style.color = '#92400e';
        } else {
            btn.innerHTML = '<i class="fa-solid fa-file-excel"></i> Excel collegato';
            btn.title = 'Sincronizzato con ' + handle.name + ' (clicca per cambiare file)';
            btn.style.background = '#dcfce7';
            btn.style.color = '#166534';
        }
    };

    window.excelSyncNotify = function (res) {
        if (!res || res.skipped || res.notLinked) return;
        if (res.ok) {
            if (res.written > 0) console.log(`Excel: aggiunte ${res.written} righe a ${res.fileName}`);
        } else {
            alert(`Richiesta salvata, ma NON ancora aggiunta al file Excel: ${res.error}.\nLa riga resta in sospeso e verrà scritta al prossimo salvataggio o premendo il pulsante "Excel".`);
        }
    };
})();
