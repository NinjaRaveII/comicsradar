# ComicsRadar — Documento di Progetto

> **Scopo di questo documento:** dare a Claude Code il contesto completo e accurato del
> progetto per lavorare in modo autonomo e coerente. Riflette lo stato **attuale e
> implementato** del codice (non un piano da fare — quello, quando esiste, va in task/issue
> separate). Va incollato all'inizio di ogni sessione di lavoro.

---

## 1. Obiettivo del Progetto

Tool personale a utente singolo per scoprire nuove uscite di fumetti, manga, bande
dessinée e graphic novel calibrate sui gusti di Alberto. L'utente legge sia in **italiano**
che in **inglese**, quindi le fonti coprono entrambe le lingue.

**Il problema risolto:** ricevere suggerimenti di nuovi titoli pertinenti senza dover
riscandagliare manualmente siti e cataloghi, e senza rivedere titoli già incontrati.

---

## 2. Profilo Gusti — 14 Titoli di Riferimento (seed)

Questi titoli sono la "bussola" per tutte le query AI. Sono il seed iniziale della tabella
`favorites` in `database.js` e vengono inseriti solo se la tabella è vuota al primo avvio.
La tabella `favorites` cresce nel tempo: ogni titolo che l'utente marca come preferito
(dalle card di ricerca, dal form manuale, o spostato dalla lista "Da comprare") entra a
far parte del segnale di gusto **positivo** usato da ogni ricerca successiva.

| Titolo | Autore/i | Tipo | Origine |
|---|---|---|---|
| Daytripper | Bá & Moon | comics | BR |
| Tekkonkinkreet | Taiyo Matsumoto | manga | JP |
| Death Note | Ohba & Obata | manga | JP |
| Habibi | Craig Thompson | comics | US |
| Drome | Jesse Lonergan | comics | US |
| Gogo Monster | Taiyo Matsumoto | manga | JP |
| Come un brivido | Aniss El Hamouri | bd | BE |
| La profezia dell'armadillo | Zerocalcare | comics | IT |
| Blast | Larcenet | bd | FR |
| Blacksad | Canales & Guarnido | bd | ES |
| East of West | Hickman & Dragotta | comics | US |
| Ratman | Leo Ortolani | comics | IT |
| Vagabond | Takehiko Inoue | manga | JP |
| Blade of the Immortal | Hiroaki Samura | manga | JP |

**Caratteristiche comuni del gusto:** narrativa adulta densa, forte identità visiva,
nessun supereroe mainstream, ambizioni autoriali, opere complete o ad arco definito.

---

## 3. Architettura Attuale

```
┌─────────────────────────────────────────────────────┐
│                  FRONTEND (Browser)                  │
│   public/index.html — pagina singola in JS vanilla   │
│   Nessun React, nessun build step, tutto in 1 file   │
│   Accesso via token nell'URL: ?token=XXX             │
└───────────────────────┬─────────────────────────────┘
                        │ HTTP fetch
┌───────────────────────▼─────────────────────────────┐
│              BACKEND — Node.js / Express             │
│                                                      │
│  server.js   → endpoint API + auth + serve frontend  │
│  database.js → setup SQLite, tabelle, query helper   │
│  ai.js       → discovery (fonti gratuite + Mistral)  │
│                + copertine                            │
└───────────────────────┬─────────────────────────────┘
                        │
┌───────────────────────▼─────────────────────────────┐
│              DATABASE — SQLite                       │
│  File: comicsradar.db (path da env DB_PATH)          │
│  Tabelle: favorites, to_buy, excluded,               │
│           releases, settings, seen_titles            │
└─────────────────────────────────────────────────────┘
```

---

## 4. Stack Tecnologico

| Componente | Tecnologia | Note |
|---|---|---|
| Server framework | Express.js ^4.18 | |
| Database | SQLite via `better-sqlite3` ^12 | File locale, vedi nota versione in §15 |
| AI discovery | **Mistral** (`mistral-small-latest`) | Filtra candidati raccolti da fonti gratuite, vedi §6/§9/§10 |
| Raccolta candidati | `rss-parser` (feed RSS) + GraphQL AniList | Nessuna chiave richiesta |
| Cover images | Google Books API | Chiamata server-side, senza chiave |
| Frontend | HTML + JavaScript vanilla | Un solo file `public/index.html` |
| Tipografia frontend | Fraunces (display) + Manrope (body) + IBM Plex Mono (dati) | Google Fonts |
| Autenticazione | Token in query string | `?token=SECRET_TOKEN` |
| Rate limiting | `express-rate-limit` ^7.2 | 20 req/min su `/api/` |
| HTTP client | `node-fetch` ^2.7 | |

---

## 5. Quattro Liste Persistenti

| Lista | Tabella | Scopo | Popolamento |
|---|---|---|---|
| Search Results | `releases` | Titoli trovati dalla ricerca | Automatico via `POST /api/search` |
| Favorites | `favorites` | Titoli che l'utente ama — segnale di gusto **positivo** | Manuale + 14 seed iniziali + spostati da "Da comprare" |
| To Buy | `to_buy` | Lista acquisti, stato intermedio | Manuale dalle card di ricerca |
| Excluded | `excluded` | Titoli non graditi — segnale di gusto **negativo** | Manuale, filtrati da ricerche future |

La tabella `seen_titles` tiene traccia di tutti i titoli già mostrati per evitare
doppioni nelle ricerche successive (deduplication).

**Flusso "Da comprare" → decisione finale:** non esiste più un bottone "Acquistato" che
si limita a rimuovere il titolo (era un passaggio intermedio senza valore, rimosso
deliberatamente). L'unico modo per uscire dalla lista "Da comprare" è spostare il titolo
in **Preferiti** o in **Non mi interessa** — la decisione, una volta presa, aggiusta le
ricerche successive. Il toggle "🛒 Da comprare" sulla card di ricerca resta invece un
semplice add/remove (per cambiare idea prima di leggere il titolo).

**Esclusi come segnale negativo:** il prompt Mistral tratta `excluded` non solo come lista
di titoli da skippare letteralmente, ma come indicazione esplicita di stile/tono/genere da
evitare nelle proposte future — simmetrico a come `favorites` indica cosa cercare.

**Nota sulla cronologia:** gli id dei risultati sono `r1…r12` e vengono riusati ad ogni
ricerca con INSERT OR REPLACE, quindi ogni ricerca sovrascrive la precedente. Si vede
sempre solo l'ultimo gruppo. Comportamento accettabile per l'MVP.

**Ricerca approfondimento:** cliccando su copertina o titolo di un risultato si apre una
ricerca Google (`titolo + autore`) in una nuova tab, per decidere rapidamente se
aggiungerlo a Preferiti, Da comprare o Esclusi.

---

## 6. Modulo Discovery — `ai.js`

Pipeline a due stadi, implementata e testata end-to-end:

**Stadio 1 — `fetchCandidates(seenTitles)`**: raccoglie in parallelo (`Promise.allSettled`,
nessuna fonte blocca le altre) da Fumettologica e MegaNerd (RSS, IT), The Comics Journal e
The Beat (RSS, EN), AniList (GraphQL, manga). Normalizza in
`{title, author, publisher, type, origin, releaseDate, language, sourceUrl}`, deduplica
contro `seenTitles` e tra loro (titolo normalizzato: lowercase, accenti rimossi,
punteggiatura rimossa), taglia a 40 candidati.

**Stadio 2 — `structureReleases(candidates, favorites, excluded)`**: costruisce un prompt
per Mistral con i preferiti (segnale positivo), gli esclusi (segnale negativo) e i
candidati grezzi. Chiede 12 risultati (4 alta/4 media/4 bassa rilevanza) **esclusivamente**
scelti dalla lista candidati — i preferiti servono solo a definire il gusto, mai a essere
riproposti. Una **guardia anti-hallucination** post-elaborazione scarta qualsiasi titolo
restituito da Mistral che non corrisponda (testualmente, normalizzato) a un candidato
reale: protegge dal fatto che un LLM può comunque "inventare" suggerimenti dalla propria
conoscenza generale anche quando il prompt lo vieta esplicitamente (vedi §15).

**`fetchReleases(favorites, excluded, seenTitles)`**: firma pubblica invariata, orchestra
i due stadi + `getGoogleBooksCover` (Google Books, invariato, nessuna chiave).

I candidati possono includere sia titoli di uscite vere e proprie sia titoli di articoli
editoriali che le menzionano (es. interviste, recensioni) — è un comportamento accettato,
non un difetto: amplia la copertura senza richiedere parsing più sofisticato per fonte.

---

## 7. Variabili d'Ambiente

```
MISTRAL_API_KEY=...    ← richiesta per la discovery (console.mistral.ai, piano "Experiment")
SECRET_TOKEN=...       ← token accesso frontend
PORT=3000              ← il provider di hosting lo sovrascrive automaticamente
DB_PATH=...            ← path del file SQLite (es. /data/comicsradar.db su hosting)
```

`ANTHROPIC_API_KEY` non è più usata (la discovery è passata a Mistral) e non va più
configurata. `GOOGLE_BOOKS_API_KEY` non è mai servita: Google Books viene chiamato senza
chiave (soggetto a rate limit pubblico condiviso, vedi §15).

Il file `.env` reale non è mai committato (`.gitignore`); `.env.example` documenta le
chiavi richieste senza valori reali.

---

## 8. Struttura File del Progetto

```
/
├── server.js              ← Entry point: endpoint, auth, rate limit, serve frontend
├── database.js            ← SQLite setup, tabelle, seed 14 favoriti, query helper
├── ai.js                  ← Discovery: fonti gratuite + Mistral, copertine
├── package.json
├── package-lock.json
├── .env                   ← chiavi reali, MAI committato (gitignored)
├── .env.example           ← template chiavi richieste
├── .gitignore
├── CLAUDE.md               ← questo file
├── .claude/
│   └── launch.json        ← config server per il tool di preview di Claude Code
└── public/
    └── index.html         ← Tutto il frontend in un unico file (HTML + CSS + JS)
```

### Endpoint API (`server.js`)

| Metodo | Rotta | Scopo |
|---|---|---|
| GET | `/api/data` | Tutte le liste + stato ricerca |
| POST | `/api/search` | Avvia ricerca in background (manuale, nessun cron) |
| GET | `/api/search/status` | Polling stato ricerca |
| POST/DELETE | `/api/favorites` / `/:id` | Aggiungi/rimuovi preferito |
| POST/DELETE | `/api/tobuy` / `/:id` | Aggiungi/rimuovi da comprare |
| POST/DELETE | `/api/excluded` / `/:id` | Aggiungi/rimuovi escluso |

Non esiste più un cron automatico: la ricerca parte solo dal pulsante "Cerca" /
"Aggiorna ricerca" nell'interfaccia, che chiama `POST /api/search`.

---

## 9. Fonti di Discovery (sistema attivo)

### Fonti italiane (edizioni IT) — implementate
| Fonte | Feed | Note |
|---|---|---|
| Fumettologica | `https://fumettologica.it/feed/` | Filtrate sui post con "uscit" nel titolo (es. "uscite", "in uscita" — verificare il wording reale del feed prima di cambiare il filtro, vedi §15) |
| MegaNerd | `https://www.meganerd.it/feed/` | Calendario Panini, Star, J-Pop, BAO… |

### Fonti inglesi (edizioni EN) — implementate
| Fonte | Feed |
|---|---|
| The Comics Journal | `https://www.tcj.com/feed/` |
| The Beat | `https://www.comicsbeat.com/feed/` |

### Catalogo manga — implementato
| API | Endpoint |
|---|---|
| AniList (GraphQL) | `https://graphql.anilist.co` |

### Possibili estensioni future (non implementate)
Star Comics, Panini (calendari ufficiali), SOLRAD, Paste Comics, MangaDex, Jikan
(MyAnimeList) — valide se si vuole ampliare la copertura, da aggiungere come nuove
funzioni `fetch*()` in `ai.js` seguendo lo stesso pattern di normalizzazione.

---

## 10. Filtraggio AI — Mistral

**Perché Mistral:** europeo (server Parigi), piano gratuito "Experiment" senza restrizioni
geografiche in Italia, più che sufficiente per una ricerca a settimana.

**Come ottenere la chiave gratuita:**
1. Crea account su `https://console.mistral.ai`
2. La Plateforme → API Keys → Choose a plan → seleziona **Experiment** (gratuito)
3. Genera la chiave e aggiungila come `MISTRAL_API_KEY`

**Modello in uso:** `mistral-small-latest`

**Endpoint:** `POST https://api.mistral.ai/v1/chat/completions`
Header: `Authorization: Bearer MISTRAL_API_KEY`, `Content-Type: application/json`
Formato richiesta: `{ model, max_tokens, response_format: {type:"json_object"}, messages }`

---

## 11. Hosting — ancora da decidere (storage persistente richiesto)

Il cron automatico è stato rimosso, quindi non serve più un processo sempre acceso h24.
L'hosting finale non è ancora scelto, ma è già stato escluso Render free tier (nessun
volume persistente, il DB SQLite verrebbe azzerato ad ogni redeploy/restart). Il target è
un servizio con **storage persistente garantito** (es. Railway/Fly.io con volume, VPS, o
equivalente).

**Database: resta SQLite locale (`better-sqlite3`)** — niente migrazione a Turso o altri
DB cloud finché l'hosting garantisce un filesystem persistente.

**Nota cold start:** a seconda del provider, se il piano prevede sleep dopo inattività la
prima richiesta potrebbe impiegare diversi secondi a risvegliarsi. Il frontend già gestisce
questo caso: se `/api/data` impiega più di 5s, mostra un messaggio di attesa invece di
sembrare bloccato.

---

## 12. Decisioni Architetturali

**Perché backend e non frontend-only**
Le API Mistral bloccano le chiamate dirette da browser (CORS). Serve un proxy server-side.
Stesso vale per i feed RSS di siti che non hanno CORS abilitato.

**Perché SQLite locale e non un DB cloud**
Volume dati minimo, utente singolo. Va bene finché l'hosting garantisce un filesystem
persistente (vedi §11).

**Perché frontend in JS vanilla**
Nessun build step, un solo file da editare, servito direttamente da Express come statico.

**Perché token in URL**
Tool personale, utente singolo. Compromesso accettabile: il token finisce nella cronologia
del browser, ma per uso personale è irrilevante.

**Perché Mistral e non Gemini/Anthropic**
Gemini free tier ha restrizioni sui termini d'uso per app che servono utenti EU. Anthropic
con web search è a pagamento. Mistral è europeo, gratuito, termini chiari.

---

## 13. Sistema di Design del Frontend

Identità visiva "elegante, fluida, moderna" (non legata letteralmente al mondo del
fumetto — scelta esplicita dell'utente dopo aver scartato una prima direzione a tema
"timbro/passaporto" giudicata fuori target).

**Palette** (sfondo `#080d1a` invariato): `--teal:#1f6f64` e `--teal-soft:#3a9c8c` (ink
primario, sostituisce il blu generico), `--champagne:#d4b483` (accento caldo), `--rose:
#b5546b` (negativo/escludi), `--smoke:#94a3b8` (testo secondario). Il colore dinamico per
card (`accentColor`, generato da Mistral per ogni titolo) resta il punto di forza
differenziante e non va rimosso.

**Tipografia:** Fraunces (display, italic per citazioni/empty state) + Manrope (body) +
IBM Plex Mono (date, codici lingua, metadati) — sostituiscono Playfair Display + DM Sans.

**Firma visiva:** ogni card ha un'**aura cromatica** sfumata e animata ("respira"
lentamente, rispetta `prefers-reduced-motion`) dietro la copertina, nel colore proprio del
titolo. La nav ha una **pillola che scorre fluidamente** tra i tab attivi (calcolo
sincrono di posizione, vedi nota tecnica in §15).

**Mobile-first:** media query sotto i 600px — header a due righe con nav a icone+badge
(le etichette testuali si nascondono, non ci stanno in 4 colonne su 375px), card con
bottoni azione in griglia 2+1, form preferiti in colonna, filtri con scroll orizzontale,
rilevamento cold-start con messaggio di attesa dopo 5s.

---

## 14. Note per Claude Code

- **Non reinventare l'architettura** — le decisioni hanno motivazioni precise documentate.
  Proponi varianti solo con un vantaggio concreto e spiegalo.
- **La firma `fetchReleases(favorites, excluded, seenTitles)` non cambia** senza una buona
  ragione — `server.js` la chiama direttamente.
- **Il frontend è un solo file** `public/index.html` in JS vanilla. Modifiche CSS e UI
  vanno tutte lì, con media query per il mobile.
- **Il token va sempre validato** negli endpoint prima di qualsiasi operazione.
- **Leggere prima di scrivere** — se un file non è nel contesto, aprirlo e leggerlo prima
  di modificarlo per non perdere logica già implementata.
- **Verificare i path reali prima di fidarsi della documentazione** — vedi §15, è già
  successo che `index.html` fosse fuori posto rispetto a quanto descritto qui.

---

## 15. Lezioni Apprese

Note tecniche concrete emerse durante l'implementazione, utili per evitare di rifare gli
stessi errori in sessioni future.

- **La documentazione può disallinearsi dal codice silenziosamente.** A inizio sessione
  `index.html` era nella root mentre questo file e `server.js` si aspettavano
  `public/index.html` — il server serviva 404 su ogni richiesta non-API. Verificare sempre
  lo stato reale dei file (non solo la documentazione) prima di assumere che qualcosa
  funzioni.
- **Case-sensitivity dei nomi file su Windows vs Git/Linux.** `claude.md` e `CLAUDE.md`
  erano lo stesso file su Windows (case-insensitive) ma rappresentavano un'ambiguità reale
  per qualunque hosting Linux. Un solo nome canonico (`CLAUDE.md`) elimina il rischio.
- **`better-sqlite3` e versioni Node recenti.** Su Node 24, la versione `^9.4` del progetto
  non aveva binari precompilati e richiedeva una build nativa con Visual Studio Build
  Tools (pesante, non installato). Aggiornare a `^12` ha risolto perché quella versione
  pubblica prebuilt binaries compatibili. Prima di assumere che serva un intero toolchain
  di compilazione, provare un aggiornamento della dipendenza.
- **I filtri su contenuti reali vanno verificati contro il contenuto reale, non assunto.**
  Il filtro RSS di Fumettologica cercava "uscite" nel titolo ma i titoli reali dicono "in
  **uscita**" — zero risultati silenziosi finché non si è ispezionato il feed live.
- **Un LLM può "allucinare" anche quando il prompt lo vieta esplicitamente.** Mistral
  riproponeva occasionalmente titoli identici ai preferiti dell'utente (dalla propria
  conoscenza generale) nonostante il prompt dicesse esplicitamente di non farlo. Soluzione
  a due livelli: istruzione esplicita nel prompt + **guardia programmatica post-hoc** che
  scarta ogni risultato il cui titolo non corrisponda a un candidato reale fornito. Non
  fidarsi delle sole istruzioni testuali per garanzie di correttezza.
- **`requestAnimationFrame` non scatta se la tab non è in foreground.** Un bug nel
  posizionamento dell'indicatore di navigazione (basato su `rAF`) causava un blocco
  silenzioso quando la pagina di anteprima non era a fuoco — lo stesso vale per utenti
  reali con tab in background. Per logica UI che deve eseguire subito dopo un
  aggiornamento del DOM, preferire una lettura di layout sincrona (`offsetLeft` ecc. dopo
  `innerHTML`) invece di rimandarla a un frame di animazione.
- **Layout mobile va testato con contenuto testuale reale, non ipotetico.** Le 4 etichette
  dei tab di navigazione ("Cerca", "Preferiti", "Da comprare", "Esclusi") non entravano su
  una riga a 375px nonostante il calcolo teorico sembrasse corretto — risolto passando a
  icona+badge su mobile, testo completo su desktop.
- **Google Books API senza chiave ha quota condivisa/anonima limitata** — può restituire
  429 in ambienti di sviluppo condivisi. Il codice gestisce già il fallback a `coverUrl:
  null`, comportamento atteso e non un bug da correggere.
