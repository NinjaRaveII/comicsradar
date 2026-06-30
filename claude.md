# Comics Discovery Tool — Documento di Progetto

> **Scopo di questo documento:** fornire a Claude Code il contesto completo del progetto per permettergli di lavorare in modo autonomo e coerente con le decisioni già prese.

---

## 1. Obiettivo del Progetto

Un tool personale per scoprire nuove uscite di fumetti, manga e graphic novel calibrate sui gusti specifici dell'utente (Alberto), con aggiornamento automatico settimanale.

**Il problema risolto:** evitare di riscandagliare manualmente siti e cataloghi; ricevere suggerimenti di nuovi titoli pertinenti senza mai rivedere quelli già incontrati.

---

## 2. Profilo Gusti — Titoli di Riferimento

I seguenti 14 titoli definiscono il profilo di ricerca. Sono la "bussola" per tutte le query AI:

| Titolo | Autore/i | Tradizione |
|---|---|---|
| Daytripper | Fábio Moon & Gabriel Bá | Americana |
| Tekkonkinkreet | Taiyō Matsumoto | Manga |
| Gogo Monster | Taiyō Matsumoto | Manga |
| Death Note | Tsugumi Ohba & Takeshi Obata | Manga |
| Habibi | Craig Thompson | Americana |
| Drome | Lorenzo Mattotti | Italiana |
| Come un brivido | — | Italiana |
| La profezia dell'armadillo | Zerocalcare | Italiana |
| Blast | Manu Larcenet | Bande Dessinée |
| Blacksad | Juan Díaz Canales & Juanjo Guarnido | Bande Dessinée |
| East of West | Jonathan Hickman & Nick Dragotta | Americana |
| Ratman | Ortolani | Italiana |
| Vagabond | Takehiko Inoue | Manga |
| Blade of the Immortal | Hiroaki Samura | Manga |

**Caratteristiche comuni:** narrativa adulta densa, forte identità visiva, nessun supereroe mainstream, ambizioni autoriali, storie complete o ad arco definito.

---

## 3. Architettura Attuale

```
┌─────────────────────────────────────────────────────┐
│                  FRONTEND (Browser)                  │
│         React SPA — accesso via token segreto        │
│                  in URL: ?token=XXX                  │
└───────────────────────┬─────────────────────────────┘
                        │ HTTP
┌───────────────────────▼─────────────────────────────┐
│              BACKEND — Railway (Node.js)              │
│                  Express + SQLite                    │
│                                                      │
│  ┌──────────────────────────────────────────────┐   │
│  │              ENDPOINTS PRINCIPALI             │   │
│  │  POST /api/search   — avvia nuova ricerca     │   │
│  │  GET  /api/results  — legge risultati salvati │   │
│  │  POST /api/favorite — aggiunge ai preferiti   │   │
│  │  POST /api/tobuy    — aggiunge a "da comprare"│   │
│  │  POST /api/exclude  — esclude titolo futuro   │   │
│  │  GET  /api/lists    — legge tutte le liste    │   │
│  └──────────────────────────────────────────────┘   │
│                                                      │
│  ┌──────────────────────────────────────────────┐   │
│  │           AI DISCOVERY MODULE                 │   │
│  │  Anthropic API (claude-sonnet-4-6)            │   │
│  │  Tool: web_search_20250305                    │   │
│  │  Cerca uscite recenti calibrate sul profilo   │   │
│  └──────────────────────────────────────────────┘   │
│                                                      │
│  ┌──────────────────────────────────────────────┐   │
│  │           COVER IMAGE MODULE                  │   │
│  │  Google Books API (server-side, no CORS)      │   │
│  └──────────────────────────────────────────────┘   │
│                                                      │
│  ┌──────────────────────────────────────────────┐   │
│  │           CRON JOB                            │   │
│  │  Settimanale — esegue ricerca automatica      │   │
│  │  e popola il DB con nuovi risultati           │   │
│  └──────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
                        │
┌───────────────────────▼─────────────────────────────┐
│                   DATABASE — SQLite                  │
│                                                      │
│  Tabella: results   (titoli trovati dalle ricerche)  │
│  Tabella: favorites (titoli salvati come preferiti)  │
│  Tabella: tobuy     (lista acquisti)                 │
│  Tabella: excluded  (titoli da non rivedere mai)     │
└─────────────────────────────────────────────────────┘
```

### Stack Tecnologico

| Componente | Tecnologia | Note |
|---|---|---|
| Hosting Backend | Railway | Node.js runtime |
| Server Framework | Express.js | |
| Database | SQLite (via better-sqlite3) | File locale su Railway |
| AI | Anthropic API — claude-sonnet-4-6 | Con web_search_20250305 |
| Cover images | Google Books API | Chiamata server-side |
| Frontend | React (SPA statica) | Servita dall'Express stesso |
| Autenticazione | Token segreto in query string | `?token=SECRET_TOKEN` |
| Cron | node-cron | Settimanale |

---

## 4. Quattro Liste Persistenti

Il sistema mantiene quattro liste separate nel DB:

| Lista | Scopo | Comportamento |
|---|---|---|
| **Search Results** | Tutti i titoli trovati dalle ricerche AI | Popolata automaticamente |
| **Favorites** | Titoli che l'utente ama | Aggiunta manuale |
| **To Buy** | Lista acquisti | Aggiunta manuale |
| **Excluded** | Titoli da non mostrare mai più | Filtrati da ogni ricerca futura |

**Deduplication:** ogni ricerca carica la lista `excluded` + tutti i titoli già visti, e li passa al prompt AI come lista di titoli da escludere.

---

## 5. Modulo AI — Logica di Discovery

### Prompt Strategy

Il prompt inviato a claude-sonnet-4-6 include:
1. I 14 titoli di riferimento con descrizione del pattern comune
2. Lista titoli già visti (esclusi) aggiornata dal DB
3. Istruzione a cercare uscite recenti (ultimi 12-18 mesi) in tutte le tradizioni: manga, BD, americana, italiana
4. Output richiesto: JSON strutturato con campi `title`, `author`, `year`, `publisher`, `description`, `why_matches`

### Web Search Tool

Usato per trovare uscite reali e recenti, non solo dalla knowledge base del modello:
```json
{
  "type": "web_search_20250305",
  "name": "web_search"
}
```

### Response Parsing

La risposta può contenere blocchi misti (text + tool_use). Il parser raccoglie solo i blocchi `type: "text"` e li concatena prima di fare JSON.parse.

---

## 6. Variabili d'Ambiente (Railway)

```
ANTHROPIC_API_KEY=sk-ant-...
GOOGLE_BOOKS_API_KEY=...
SECRET_TOKEN=...          ← token per accesso frontend
PORT=3000                 ← Railway lo sovrascrive automaticamente
```

---

## 7. Struttura File Progetto

```
/
├── server.js             ← Entry point Express + tutti gli endpoint
├── db.js                 ← Setup SQLite, creazione tabelle, query helpers
├── discovery.js          ← Modulo AI: prompt construction + Anthropic API call
├── covers.js             ← Google Books API integration
├── cron.js               ← Scheduled weekly job
├── package.json
├── package-lock.json
└── public/               ← Frontend React (build statica)
    ├── index.html
    ├── app.js            ← Componente React principale
    └── styles.css
```

---

## 8. Vincoli e Decisioni Architetturali

### Perché backend su Railway (e non frontend-only)

- Le API Anthropic bloccano le chiamate dirette da browser (CORS)
- Google Books API funziona da server ma non da browser senza chiave pubblica esposta
- Railway risolve entrambi i problemi senza configurazioni CORS complesse

### Perché SQLite e non Postgres

- Il volume di dati è minimo (centinaia di titoli al massimo)
- Nessuna necessità di accesso concorrente multi-utente
- Semplicità di deploy su Railway senza add-on aggiuntivi

### Perché non usare Gemini

- Gemini free tier non disponibile in Italia (restrizioni EU)
- Anthropic API ha costo trascurabile (~€0.006/ricerca) — confermato prima di acquistare i crediti

### Perché token in URL e non autenticazione completa

- Tool personale, utente singolo
- Semplicità massima: nessun login, nessuna sessione da gestire

---

## 9. Stato Attuale e Prossimi Sviluppi Possibili

### ✅ Funzionalità Completate

- [x] Backend Node.js/Express su Railway
- [x] Database SQLite con 4 tabelle persistenti
- [x] Integrazione Anthropic API con web search
- [x] Fetch cover da Google Books
- [x] Frontend React con visualizzazione risultati
- [x] Gestione 4 liste (results, favorites, to-buy, excluded)
- [x] Deduplication dei titoli già visti
- [x] Cron job settimanale automatico
- [x] Accesso protetto da token

### 🔲 Possibili Miglioramenti Futuri

- [ ] Filtro per tradizione (manga / BD / italiana / americana)
- [ ] Ordinamento risultati per data di uscita
- [ ] Export lista "to buy" (PDF o testo)
- [ ] Notifica push / email settimanale con nuovi titoli trovati
- [ ] Ricerca manuale per autore o titolo specifico
- [ ] Pagine dettaglio titolo con link ad acquisto

---

## 10. Note per Claude Code

- **Non reinventare l'architettura:** le decisioni sopra hanno motivazioni precise (CORS, geo-restriction EU, costi). Proponi variazioni solo se c'è un vantaggio concreto.
- **Il file `discovery.js` è il cuore del sistema:** modifiche al prompt o al parsing della risposta vanno fatte lì.
- **Il DB SQLite è su filesystem Railway:** non è un DB remoto, non serve connection string.
- **Il frontend è una SPA React servita da Express** come file statici dalla cartella `public/`. Non è un progetto Create React App separato — è tutto in un unico repo.
- **Il token di accesso** va sempre validato negli endpoint prima di eseguire qualsiasi operazione.
- **Costo API:** ogni ricerca fa 1 chiamata a claude-sonnet-4-6 con web search abilitato. Stimare l'impatto prima di aggiungere chiamate extra in loop.
