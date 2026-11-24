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

**📄 Pagine**
- Il PDF completo, pagina per pagina, così com'è (immagini comprese).
- Zoom con ➖ ➕ o col pizzico a due dita.
- 🔊 «Leggi» su ogni pagina per far partire la voce da lì; il mini-lettore in basso mette in pausa.

**✏️ Modifica** (dalla scheda Pagine)
- 🖊️ Penna, 🖍️ Evidenziatore, 🔤 Testo (tocca la pagina per scrivere, tocca un testo per cambiarlo o eliminarlo), 🧽 Gomma.
- ↻ Ruota ed 🗑 Elimina pagina (si possono ripristinare), ↶ Annulla.
- Le modifiche si salvano da sole sul telefono.
- 💾 crea un nuovo PDF «… (modificato).pdf» da scaricare o condividere. L'originale non viene toccato.

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
- Il testo già presente nel PDF non si può riscrivere: si possono aggiungere testi, disegni ed evidenziazioni.
- Nei testi aggiunti si possono usare lettere accentate e la punteggiatura comune; simboli speciali
  ed emoji diventano «?» nel PDF salvato.

Librerie incluse in `lib/`: [pdf.js](https://mozilla.github.io/pdf.js/) (Apache 2.0) e [pdf-lib](https://pdf-lib.js.org/) (MIT).
