const fetch = require("node-fetch");

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-4-6";

// ── Anthropic API call ────────────────────────────────────────────────────────
async function callClaude(prompt, useSearch = false) {
  const body = {
    model: MODEL,
    max_tokens: 4000,
    messages: [{ role: "user", content: prompt }],
  };
  if (useSearch) body.tools = [{ type: "web_search_20250305", name: "web_search" }];

  const res = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  if (data.error) throw new Error(`Claude API [${data.error.type}]: ${data.error.message}`);
  return (data.content || []).map(b => b.text || "").filter(Boolean).join("\n");
}

// ── Extract JSON array robustly ───────────────────────────────────────────────
function extractJSON(text) {
  const clean = text.replace(/```json|```/gi, "").trim();
  const s = clean.indexOf("[");
  if (s === -1) throw new Error(`JSON array non trovato. Risposta: ${clean.slice(0, 200)}`);
  let jsonStr = clean.slice(s);
  // Fix truncation: close array if missing
  const lastBrace = jsonStr.lastIndexOf("}");
  if (!jsonStr.trimEnd().endsWith("]") && lastBrace !== -1) {
    jsonStr = jsonStr.slice(0, lastBrace + 1) + "]";
  }
  return JSON.parse(jsonStr);
}

// ── Step 1: web search for real recent releases ───────────────────────────────
async function searchRecentReleases(favorites, seenTitles) {
  const favTitles = favorites.slice(0, 6).map(f => f.title).join(", ");
  const today = new Date().toLocaleDateString("it-IT", { month: "long", year: "numeric" });
  const seenList = seenTitles.length ? `NON includere questi titoli già mostrati in precedenza: ${seenTitles.slice(0, 30).join(", ")}.` : "";

  const prompt = `Cerca sul web le uscite REALI di fumetti, manga, bande dessinée e graphic novel degli ultimi 30 giorni (oggi: ${today}).
Concentrati su opere adatte a un lettore che ama: ${favTitles}.
Cerca presso: BAO Publishing, Coconino, J-Pop, Panini, Star Comics (Italia); Image, Fantagraphics, Drawn & Quarterly, First Second (USA); Casterman, Dargaud, Dupuis (Francia/Belgio); Kodansha, Viz, Shogakukan (Giappone). Solo edizioni in italiano o inglese.
${seenList}
Per ogni titolo trovato includi anche l'URL della pagina prodotto dell'editore o dell'articolo di annuncio.
Restituisci un elenco testuale di 15 titoli reali con: titolo, autore, editore, data uscita, paese, descrizione breve, URL fonte.`;

  return await callClaude(prompt, true);
}

// ── Step 2: structure as JSON (no tools) ─────────────────────────────────────
async function structureReleases(rawText, favorites, excluded, seenTitles) {
  const favList = favorites.map(f => `- ${f.title} (${f.author})`).join("\n");
  const skipList = [
    ...excluded.map(e => e.title),
    ...seenTitles.slice(0, 30),
  ];
  const skipStr = skipList.length ? skipList.join(", ") : "nessuno";

  const prompt = `Struttura queste uscite recenti di fumetti come JSON.

TITOLI PREFERITI UTENTE:
${favList}

GUSTO: opere autoriali, identità visiva forte, narrativa adulta densa. Niente supereroi mainstream.
ESCLUDI (già visti o non interessano): ${skipStr}

USCITE TROVATE:
${rawText}

OUTPUT: SOLO array JSON valido, zero markdown, inizia [ finisce ].
10 oggetti (3 alta, 4 media, 3 bassa rilevanza). Campi brevi (plot max 120 car, whyYouLikeIt max 90 car):
{"id":"r1","title":"","author":"","publisher":"","type":"manga|comics|bd|manhwa|manhua|gn","origin":"JP|US|FR|BE|IT|ES|KR|CN|GB|DE|AR|BR","releaseDate":"MM/YYYY","language":"IT|EN","plot":"max 120 caratteri","whyYouLikeIt":"max 90 caratteri citando titoli preferiti specifici","relevance":"alta|media|bassa","accentColor":"#RRGGBB","sourceUrl":"URL pagina editore o articolo annuncio, null se non disponibile"}`;

  const text = await callClaude(prompt, false);
  return extractJSON(text);
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
  console.log("[AI] Starting release search with Anthropic...");
  console.log(`[AI] Excluding ${seenTitles.length} already seen titles`);

  // Step 1: web search
  const rawText = await searchRecentReleases(favorites, seenTitles);
  console.log("[AI] Web search done, structuring JSON...");

  // Step 2: structure as JSON
  const releases = await structureReleases(rawText, favorites, excluded, seenTitles);
  console.log(`[AI] Got ${releases.length} releases, fetching covers...`);

  // Step 3: fetch covers in parallel (Google Books, free)
  const withCovers = await Promise.all(releases.map(async (item) => {
    const coverUrl = await getGoogleBooksCover(item.title, item.author);
    return { ...item, coverUrl: coverUrl || null };
  }));

  console.log("[AI] All done.");
  return withCovers;
}

module.exports = { fetchReleases };
