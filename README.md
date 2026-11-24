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

**✨ Voce naturale «Paola»** (in 🎧 Ascolta → ⚙️ Voce)
- Voce italiana neurale (Piper), molto meno robotica delle voci di base del telefono.
- Funziona direttamente sul telefono, senza server; si scarica una volta (circa 65 MB) e poi va anche offline.
- Ogni frase viene generata mentre si ascolta la precedente, quindi non ci sono pause.
- Sui telefoni più vecchi la prima frase può richiedere qualche secondo.

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
delle pagine), da scaricare o condividere. L'originale non viene toccato e il file esportato si può
riaprire nell'app e modificare di nuovo.

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
- Il testo originale modificato viene coperto, non cancellato: nel PDF esportato non si vede più, ma un
  programma che estrae il testo (o un «copia e incolla» da quella zona) può ancora trovarlo.
- Se una riga è su uno sfondo sfumato o su un'immagine, la copertura usa un solo colore e può notarsi.
- I caratteri disponibili sono i tre standard del PDF (simili ad Arial, Times New Roman e Courier New).
- Nei testi aggiunti si possono usare lettere accentate e la punteggiatura comune; simboli speciali
  ed emoji diventano «?» nel PDF salvato.

Voce naturale: modello Piper «it_IT-paola-medium» (dataset CC0), onnxruntime-web (MIT) ed espeak-ng (GPL-3.0); dettagli in `lib/piper/NOTICE.txt`.

Librerie incluse in `lib/`: [pdf.js](https://mozilla.github.io/pdf.js/) (Apache 2.0) e [pdf-lib](https://pdf-lib.js.org/) (MIT).
