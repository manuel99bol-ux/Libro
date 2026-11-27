# 📖 Lettore di Libri

App per smartphone che legge ad alta voce i libri in PDF e permette di sfogliarli e annotarli.
Funziona tutta nel browser: nessun server, nessun account, nessun dato inviato in rete.
Si può installare sulla schermata Home e funziona anche offline.

## Funzioni

**🎧 Ascolta**
- Lettura con la sintesi vocale del telefono (Web Speech API), voce italiana scelta in automatico.
- Leggi, Pausa, Riprendi, Stop, Pagina precedente e successiva, salto diretto a una pagina.
- Scelta della voce, della velocità e della dimensione del testo.
- La frase in lettura viene evidenziata; toccando una frase la lettura parte da lì.
- Il punto raggiunto viene salvato e alla riapertura l'ultimo libro riparte da lì.

**✨ Voci naturali** (in 🎧 Ascolta → ⚙️ Voce), funzionano sul telefono, senza server e anche offline
- **Paola**: calma e scorrevole, legge subito. Stili: Calma (predefinito), Naturale, Espressiva, Originale. Circa 65 MB.
- **Sara**: la più espressiva, ma più lenta a generare la voce. L'app prepara l'audio delle frasi successive
  mentre ascolti e lo conserva sul telefono. Con **«Prepara in anticipo»** (3–100 pagine) lo prepari prima:
  lascia l'app aperta, meglio in carica. Circa 95 MB.
- Le abbreviazioni (pag., cap., ecc., dott.…), i simboli (%, €, °) e i numeri romani dei capitoli vengono letti per esteso.
- L'audio preparato occupa al massimo circa 350 MB: quello più vecchio viene cancellato da solo.

**☁️ Voce premium (Microsoft Azure)** (in 🎧 Ascolta → ⚙️ Voce), le voci più naturali; serve internet
- Usa una chiave **gratuita** di Azure (piano F0): al limite mensile il servizio si ferma, senza addebiti.
- Come ottenerla: portal.azure.com → crea un account → cerca «Servizi di riconoscimento vocale» (Speech services)
  → Crea → piano **Free F0**, area West Europe → «Chiavi ed endpoint»: copia KEY 1 e la Location/Region.
- Incolla chiave e area nell'app e premi «Collega Azure»; scegli la voce (Isabella, Elsa, Diego…) e «Usa questa voce».
- La chiave resta solo sul dispositivo. L'app chiama Azure direttamente dal browser, senza server intermedi.
- Le frasi già ascoltate restano sul telefono e non consumano di nuovo la quota. Se la quota finisce o la chiave
  non è più valida, l'app passa da sola a Paola (se scaricata) o alla voce del telefono.
- Il testo letto viene inviato a Microsoft per generare l'audio.

**🎧 Audiolibro** (scheda in basso)
- Crea la registrazione del libro (tutto o da una pagina a un'altra) con **Paola**, **Sara** o una voce **Azure**.
  Le voci del telefono e quella di Claude non si possono registrare.
- L'audio viene salvato sul telefono in MP3 (circa 20 MB per ora di ascolto), pagina per pagina: se la creazione
  si interrompe, con «Continua creazione» riparte da dove era arrivata.
- Si ascolta **offline**, anche a schermo spento: frase corrente a schermo, ±15/30 s, pagina precedente/successiva,
  velocità da 0,8× a 2×, posizione ricordata, comandi nel blocco schermo e nel Centro di controllo.
- Pagine: scegli un intervallo qualsiasi (da … a …) o usa «Questa pagina», «Da qui alla fine», «Tutto il libro».
- Con una voce **Azure** l'app mostra la quota rimasta nel mese, quanti caratteri servono per le pagine scelte e
  fino a quale pagina basta (con il pulsante «Crea solo fino a pagina …»). Le frasi già scaricate non consumano di
  nuovo quota; se il limite arriva durante la creazione, l'app si ferma e il mese dopo «Continua creazione».
  Il conteggio è fatto dall'app su questo dispositivo (Azure non lo rende leggibile con la chiave): il dato
  ufficiale resta quello del portale Azure. Il limite mensile si può cambiare nel pannello Azure.
- **⬇️ Scarica** salva il file MP3 (su iPhone: Condividi → Salva su File) per ascoltarlo anche con altre app.
- Durante la creazione l'app deve restare aperta (meglio in carica): lo schermo resta acceso finché non ha finito.

**📄 Pagine**
- Il PDF completo, pagina per pagina, così com'è (immagini comprese).
- Zoom con ➖ ➕ o col pizzico a due dita.
- 🔊 «Leggi» su ogni pagina per far partire la voce da lì; il mini-lettore in basso mette in pausa.

**✏️ Modifica** (dalla scheda Pagine) — un editor con barra multifunzione in stile elaboratore di testi
- **Barra del titolo**: Fine, Annulla, Ripeti, nome del documento, «Salva PDF».
- **File**: salva come PDF, condividi, apri, annulla tutte le modifiche.
- **Home**: incolla, taglia, copia, duplica; carattere (Arial, Times New Roman, Courier New), dimensione,
  A▲ A▼, **G**rassetto, *C*orsivo, <u>S</u>ottolineato, evidenziazione, colore; allineamento
  (sinistra, centro, destra, giustificato); seleziona, elimina.
- **Inserisci**: casella di testo, immagine (dal telefono o dalla fotocamera), forme (rettangolo, ovale,
  linea, freccia) con contorno e riempimento, pagina vuota, duplica pagina.
- **Disegno**: penna, evidenziatore, gomma, colori e spessori.
- **Layout**: ruota a sinistra/destra, sposta su/giù, pagina vuota, duplica, elimina pagina.
- **Visualizza**: zoom, larghezza pagina, pagina intera, passa all'ascolto.
- **Barra di stato**: «Pagina X di Y», suggerimenti e cursore dello zoom.

**Modificare il testo del PDF**: con «Seleziona» tocca una riga del documento. Diventa modificabile sul posto,
con carattere, dimensione e colore simili all'originale. Il testo originale viene coperto con il colore di
sfondo della pagina e il nuovo testo è scritto sopra. Tocca fuori per confermare; se non cambi nulla
la pagina resta com'era.

Gli elementi aggiunti si toccano per selezionarli, si trascinano per spostarli e si ridimensionano con
la maniglia rotonda. Un secondo tocco su una casella di testo la rimette in modifica. Con due dita si
scorre e si ingrandisce anche mentre si disegna. Le modifiche si salvano da sole sul telefono.

**Salva PDF** crea «… (modificato).pdf» con tutte le modifiche (anche ordine, rotazione ed eliminazione
delle pagine), da salvare o condividere. L'originale non viene toccato. Con **«Continua con la versione
modificata»** l'app apre subito il nuovo PDF al posto dell'originale e lo ricorda alla prossima apertura.
Anche senza salvare, le modifiche restano nell'app e la lettura ad alta voce legge già il testo nuovo.

## Come avviarla

### Sul telefono (consigliato)
1. Pubblica la cartella gratis con GitHub Pages: nel repository *Settings → Pages → Branch: main,
   cartella / (root) → Save*.
2. Dopo un minuto apri `https://<utente>.github.io/<repo>/` dal telefono.
3. Installala:
   - **Android (Chrome)**: menu ⋮ → «Installa app» (o il pulsante «📲 Installa come app»).
   - **iPhone (Safari)**: Condividi ⬆️ → «Aggiungi alla schermata Home».

### Sul computer
Fai doppio clic su `index.html`. Oppure, in un terminale nella cartella:
`python3 -m http.server 8000` e apri <http://localhost:8000>.

## Note
- Le voci dipendono dal sistema. Su Android se ne installano altre da *Impostazioni → Sintesi vocale*,
  su iPhone da *Impostazioni → Accessibilità → Contenuti letti ad alta voce → Voci*.
- I PDF scansionati (solo immagini) si vedono e si annotano, ma non si possono leggere ad alta voce.
- Nel PDF salvato il testo originale delle righe modificate viene tolto davvero e quello nuovo è scritto nello
  stesso punto, così anche la lettura ad alta voce e il «copia e incolla» trovano il testo nuovo. Se in una pagina
  il testo è dentro elementi complessi (per esempio moduli incorporati), l'app torna a coprirlo e scriverci sopra.
- La riga modificata usa uno dei tre caratteri standard (simili ad Arial, Times New Roman e Courier New):
  se il libro usa un carattere diverso, la differenza può notarsi leggermente.
- Se una riga è su uno sfondo sfumato o su un'immagine, la copertura usa un solo colore e può notarsi.
- I caratteri disponibili sono i tre standard del PDF (simili ad Arial, Times New Roman e Courier New).
- Nei testi aggiunti si possono usare lettere accentate e la punteggiatura comune; simboli speciali
  ed emoji diventano «?» nel PDF salvato.

Voci naturali: Piper «it_IT-paola-medium» (dataset CC0), Kokoro-82M (Apache-2.0), onnxruntime-web (MIT) ed espeak-ng (GPL-3.0); dettagli in `lib/piper/NOTICE.txt`.

Audiolibro: codifica MP3 con lamejs (LGPL-3.0, `lib/lame/`).

Librerie incluse in `lib/`: [pdf.js](https://mozilla.github.io/pdf.js/) (Apache 2.0) e [pdf-lib](https://pdf-lib.js.org/) (MIT).
