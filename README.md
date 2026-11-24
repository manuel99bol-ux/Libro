# 📖 Lettore di Libri

Web app che legge ad alta voce i libri in PDF. Funziona tutta nel browser:
nessun server, nessun account, nessun dato inviato in rete.

## Funzioni

- Apertura di un PDF dal computer o dal telefono.
- Estrazione del testo pagina per pagina con [pdf.js](https://mozilla.github.io/pdf.js/) (incluso nella cartella `lib/`, quindi funziona anche offline).
- Lettura con la sintesi vocale del browser (Web Speech API), voce italiana scelta in automatico.
- Pulsanti Leggi, Pausa, Riprendi, Stop, Pagina precedente e Pagina successiva, più il salto diretto a una pagina.
- Scelta della voce, della velocità e della dimensione del testo.
- La frase in lettura viene evidenziata; toccando una frase la lettura parte da lì.
- Il punto raggiunto (pagina e frase) viene salvato da solo. Alla riapertura l'ultimo libro si ricarica e la lettura riprende da lì.
- Pensata anche per lo smartphone. Durante la lettura lo schermo resta acceso, dove il browser lo consente.

## Come avviarla

### Sul computer
1. Scarica la cartella del progetto (su GitHub: *Code → Download ZIP*, poi estrai lo ZIP).
2. Fai doppio clic su `index.html`: si apre nel browser.
3. Premi **Scegli un PDF**, poi **Leggi**.

Consigliati: Chrome, Edge o Safari. Firefox su Linux spesso non ha voci italiane installate.

*(Facoltativo)* Se preferisci servirla in locale, apri un terminale nella cartella ed esegui
`python3 -m http.server 8000`, poi apri <http://localhost:8000>.

### Sul telefono
Il modo più semplice è pubblicarla gratis con GitHub Pages:
*Settings → Pages → Branch: main, cartella / (root) → Save*.
Dopo un minuto apri dal telefono l'indirizzo `https://<utente>.github.io/<repo>/`.
I PDF restano comunque sul telefono, perché la pagina non invia nulla.

## Note
- Le voci disponibili dipendono dal sistema operativo. Su Android puoi installarne altre da
  *Impostazioni → Sintesi vocale*, su iPhone da *Impostazioni → Accessibilità → Contenuti letti ad alta voce → Voci*.
- I PDF scansionati (solo immagini) non contengono testo e non possono essere letti.
- Scorciatoie da tastiera: **Spazio** = leggi/pausa, **Alt+←/→** = pagina precedente/successiva.
