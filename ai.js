const fetch = require("node-fetch");
const Parser = require("rss-parser");

const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY;
const MISTRAL_URL = "https://api.mistral.ai/v1/chat/completions";
const MISTRAL_MODEL = "mistral-small-latest";

const rssParser = new Parser({ timeout: 10000 });

// ── Helpers ──────────────────────────────────────────────────────────────────
function normalizeTitle(title) {
  return (title || "")
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^\w\s]/g, "")
    .trim();
}

function extractJSON(text) {
  const clean = text.replace(/```json|```/gi, "").trim();
  const s = clean.indexOf("[");
  if (s === -1) throw new Error(`JSON array non trovato. Risposta: ${clean.slice(0, 200)}`);
  let jsonStr = clean.slice(s);
  const lastBrace = jsonStr.lastIndexOf("}");
  if (!jsonStr.trimEnd().endsWith("]") && lastBrace !== -1) {
    jsonStr = jsonStr.slice(0, lastBrace + 1) + "]";
  }
  return JSON.parse(jsonStr);
}

// ── Stadio 1: raccolta candidati da fonti gratuite ──────────────────────────

async function fetchFumettologica() {
  const feed = await rssParser.parseURL("https://fumettologica.it/feed/");
  return feed.items
    .filter(i => /uscit/i.test(i.title || ""))
    .map(i => ({
      title: i.title,
      author: null,
      publisher: null,
      type: "comics",
      origin: "IT",
      releaseDate: null,
      language: "IT",
      sourceUrl: i.link || null,
    }));
}

async function fetchMegaNerd() {
  const feed = await rssParser.parseURL("https://www.meganerd.it/feed/");
  return feed.items.map(i => ({
    title: i.title,
    author: null,
    publisher: null,
    type: "comics",
    origin: "IT",
    releaseDate: null,
    language: "IT",
    sourceUrl: i.link || null,
  }));
}

async function fetchTheComicsJournal() {
  const feed = await rssParser.parseURL("https://www.tcj.com/feed/");
  return feed.items.map(i => ({
    title: i.title,
    author: null,
    publisher: null,
    type: "comics",
    origin: "US",
    releaseDate: null,
    language: "EN",
    sourceUrl: i.link || null,
  }));
}

async function fetchTheBeat() {
  const feed = await rssParser.parseURL("https://www.comicsbeat.com/feed/");
  return feed.items
    .filter(i => {
      const cats = (i.categories || []).join(" ").toLowerCase();
      return /comic|indie/.test(cats) || /comic|indie/i.test(i.title || "");
    })
    .map(i => ({
      title: i.title,
      author: null,
      publisher: null,
      type: "comics",
      origin: "US",
      releaseDate: null,
      language: "EN",
      sourceUrl: i.link || null,
    }));
}

async function fetchAniList() {
  const query = `
    query {
      Page(perPage: 25) {
        media(type: MANGA, status: RELEASING, sort: START_DATE_DESC) {
          title { english romaji }
          staff { nodes { name { full } } }
          startDate { year month day }
          siteUrl
        }
      }
    }
  `;
  const res = await fetch("https://graphql.anilist.co", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const data = await res.json();
  const media = data?.data?.Page?.media || [];
  return media.map(m => ({
    title: m.title.english || m.title.romaji,
    author: m.staff?.nodes?.[0]?.name?.full || null,
    publisher: null,
    type: "manga",
    origin: "JP",
    releaseDate: m.startDate?.month && m.startDate?.year
      ? `${String(m.startDate.month).padStart(2, "0")}/${m.startDate.year}`
      : null,
    language: "EN",
    sourceUrl: m.siteUrl || null,
  }));
}

async function fetchCandidates(seenTitles) {
  const results = await Promise.allSettled([
    fetchFumettologica(),
    fetchMegaNerd(),
    fetchTheComicsJournal(),
    fetchTheBeat(),
    fetchAniList(),
  ]);

  const sourceNames = ["Fumettologica", "MegaNerd", "The Comics Journal", "The Beat", "AniList"];
  let candidates = [];
  results.forEach((r, idx) => {
    if (r.status === "fulfilled") {
      console.log(`[AI] ${sourceNames[idx]}: ${r.value.length} candidati`);
      candidates = candidates.concat(r.value);
    } else {
      console.warn(`[AI] ${sourceNames[idx]} fallita: ${r.reason?.message || r.reason}`);
    }
  });

  const seenNormalized = new Set(seenTitles.map(normalizeTitle));
  candidates = candidates.filter(c => c.title && !seenNormalized.has(normalizeTitle(c.title)));

  // Deduplica candidati tra loro (stesso titolo da fonti diverse)
  const seenInBatch = new Set();
  candidates = candidates.filter(c => {
    const key = normalizeTitle(c.title);
    if (seenInBatch.has(key)) return false;
    seenInBatch.add(key);
    return true;
  });

  return candidates.slice(0, 40);
}

// ── Chiamata Mistral ─────────────────────────────────────────────────────────
async function callMistral(prompt) {
  const res = await fetch(MISTRAL_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${MISTRAL_API_KEY}`,
    },
    body: JSON.stringify({
      model: MISTRAL_MODEL,
      max_tokens: 2000,
      response_format: { type: "json_object" },
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const data = await res.json();
  if (data.error) throw new Error(`Mistral: ${data.error.message}`);
  return data.choices[0].message.content;
}

// ── Stadio 2: filtraggio e strutturazione con Mistral ───────────────────────
async function structureReleases(candidates, favorites, excluded) {
  const favList = favorites.map(f => `- ${f.title} (${f.author})`).join("\n");
  const excludedList = excluded.map(e => `${e.title}${e.author ? ` (${e.author})` : ""}`).join(", ") || "nessuno";
  const candidatesList = candidates
    .map(c => `- ${c.title} · ${c.author || "?"} · ${c.publisher || "?"} · ${c.type} · ${c.language}`)
    .join("\n");

  const prompt = `Sei un esperto di fumetti, manga e graphic novel d'autore. Il tuo compito è SELEZIONARE e STRUTTURARE alcuni dei candidati elencati sotto, NON inventare o suggerire altri titoli dalla tua conoscenza generale.

REGOLA VINCOLANTE: ogni titolo che restituisci deve essere uno dei titoli presenti nella lista CANDIDATI qui sotto, testualmente. Non includere MAI un titolo solo perché simile o collegato ai preferiti dell'utente: i preferiti servono solo per capire il gusto, non sono fonti di nuovi suggerimenti. Se nessun candidato è abbastanza pertinente, restituisci comunque solo candidati reali (anche con rilevanza "bassa"), mai titoli al di fuori della lista CANDIDATI.

TITOLI PREFERITI UTENTE (segnale di gusto POSITIVO — orientano lo stile, il tono e i temi da privilegiare; NON da riproporre):
${favList}

GUSTO: narrativa adulta densa, forte identità visiva, nessun supereroe mainstream, ambizioni autoriali, opere complete o ad arco definito.

TITOLI NON GRADITI (segnale di gusto NEGATIVO — usali per capire quale stile, tono o genere evitare, oltre a escluderli letteralmente se ricompaiono tra i candidati): ${excludedList}

CANDIDATI (unica fonte ammessa per i titoli da restituire):
${candidatesList}

Se lo stesso titolo appare in più candidati IT e EN, unificalo in una sola scheda indicando entrambe le lingue disponibili nel campo "language" come "IT+EN".

OUTPUT: rispondi SOLO con un oggetto JSON con chiave "releases" contenente un array, zero markdown.
12 oggetti scelti ESCLUSIVAMENTE dalla lista CANDIDATI sopra (4 alta, 4 media, 4 bassa rilevanza), con id sequenziali "r1".."r12". Campi brevi (plot max 120 car, whyYouLikeIt max 90 car):
{"id":"r1","title":"","author":"","publisher":"","type":"manga|comics|bd|manhwa|gn","origin":"JP|US|FR|BE|IT|ES|KR|CN|GB|DE|AR|BR","releaseDate":"MM/YYYY","language":"IT|EN|IT+EN","plot":"max 120 caratteri","whyYouLikeIt":"max 90 caratteri citando titoli preferiti specifici","relevance":"alta|media|bassa","accentColor":"#RRGGBB","sourceUrl":"URL o null"}`;

  const text = await callMistral(prompt);
  let releases;
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) releases = parsed;
    else if (Array.isArray(parsed.releases)) releases = parsed.releases;
    else throw new Error("Formato JSON inatteso da Mistral");
  } catch {
    releases = extractJSON(text);
  }

  // Difesa in profondità: scarta qualsiasi titolo non presente tra i candidati reali,
  // per evitare che il modello "allucini" suggerimenti dalla sua conoscenza generale
  // (es. riproponendo titoli già nei preferiti dell'utente).
  const candidateTitles = new Set(candidates.map(c => normalizeTitle(c.title)));
  const filtered = releases.filter(r => candidateTitles.has(normalizeTitle(r.title)));
  if (filtered.length < releases.length) {
    console.warn(`[AI] Scartati ${releases.length - filtered.length} titoli non presenti tra i candidati (possibile hallucination)`);
  }
  return filtered;
}

// ── Google Books cover (free, no key needed) ──────────────────────────────────
async function getGoogleBooksCover(title, author) {
  try {
    const q = encodeURIComponent(`${title} ${author} comic manga`);
    const res = await fetch(`https://www.googleapis.com/books/v1/volumes?q=${q}&maxResults=3&fields=items(volumeInfo(imageLinks))`);
    const data = await res.json();
    const item = data.items?.find(i => i.volumeInfo?.imageLinks);
    if (!item) return null;
    const url = item.volumeInfo.imageLinks.thumbnail || item.volumeInfo.imageLinks.smallThumbnail;
    if (!url) return null;
    return url.replace("http://", "https://").replace("zoom=1", "zoom=2");
  } catch { return null; }
}

// ── Main search function ──────────────────────────────────────────────────────
async function fetchReleases(favorites, excluded, seenTitles) {
  console.log("[AI] Starting release search with free sources + Mistral...");
  console.log(`[AI] Excluding ${seenTitles.length} already seen titles`);

  const candidates = await fetchCandidates(seenTitles);
  console.log(`[AI] Got ${candidates.length} candidates after dedup, structuring with Mistral...`);

  const releases = await structureReleases(candidates, favorites, excluded);
  console.log(`[AI] Got ${releases.length} releases, fetching covers...`);

  const withCovers = await Promise.all(releases.map(async (item) => {
    const coverUrl = await getGoogleBooksCover(item.title, item.author);
    return { ...item, coverUrl: coverUrl || null };
  }));

  console.log("[AI] All done.");
  return withCovers;
}

module.exports = { fetchReleases };
