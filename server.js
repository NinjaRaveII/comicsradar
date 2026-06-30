require("dotenv").config();
const express = require("express");
const rateLimit = require("express-rate-limit");
const path = require("path");
const db = require("./database");
const { fetchReleases } = require("./ai");

const app = express();
const PORT = process.env.PORT || 3000;
const SECRET_TOKEN = process.env.SECRET_TOKEN || "changeme";

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ── Rate limiting ─────────────────────────────────────────────────────────────
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: { error: "Troppe richieste, riprova tra un minuto." },
});
app.use("/api/", limiter);

// ── Auth middleware ───────────────────────────────────────────────────────────
function auth(req, res, next) {
  const token = req.headers["x-token"] || req.query.token;
  if (token !== SECRET_TOKEN) return res.status(401).json({ error: "Non autorizzato" });
  next();
}

// ── State for ongoing search ──────────────────────────────────────────────────
let searchInProgress = false;
let lastSearchError = null;

// ── API Routes ────────────────────────────────────────────────────────────────

// Get all data in one call
app.get("/api/data", auth, (req, res) => {
  const lastFetch = db.getLastFetchTime();
  res.json({
    favorites: db.getFavorites(),
    toBuy: db.getToBuy(),
    excluded: db.getExcluded(),
    releases: db.getLastReleases(),
    lastFetchedAt: lastFetch,
    searchInProgress,
    lastSearchError,
  });
});

// Favorites
app.post("/api/favorites", auth, (req, res) => {
  const item = req.body;
  if (!item.id || !item.title) return res.status(400).json({ error: "id e title richiesti" });
  db.addFavorite(item);
  res.json({ ok: true });
});
app.delete("/api/favorites/:id", auth, (req, res) => {
  db.removeFavorite(req.params.id);
  res.json({ ok: true });
});

// To Buy
app.post("/api/tobuy", auth, (req, res) => {
  const item = req.body;
  if (!item.id || !item.title) return res.status(400).json({ error: "id e title richiesti" });
  db.addToBuy(item);
  res.json({ ok: true });
});
app.delete("/api/tobuy/:id", auth, (req, res) => {
  db.removeToBuy(req.params.id);
  res.json({ ok: true });
});

// Excluded
app.post("/api/excluded", auth, (req, res) => {
  const item = req.body;
  if (!item.id || !item.title) return res.status(400).json({ error: "id e title richiesti" });
  db.addExcluded(item);
  res.json({ ok: true });
});
app.delete("/api/excluded/:id", auth, (req, res) => {
  db.removeExcluded(req.params.id);
  res.json({ ok: true });
});

// Trigger search manually
app.post("/api/search", auth, async (req, res) => {
  if (searchInProgress) return res.json({ ok: true, message: "Ricerca già in corso..." });
  res.json({ ok: true, message: "Ricerca avviata..." });
  runSearch();
});

// Search status poll
app.get("/api/search/status", auth, (req, res) => {
  res.json({
    searchInProgress,
    lastSearchError,
    lastFetchedAt: db.getLastFetchTime(),
    count: db.getLastReleases().length,
  });
});

// ── Search runner ─────────────────────────────────────────────────────────────
async function runSearch() {
  if (searchInProgress) return;
  searchInProgress = true;
  lastSearchError = null;
  console.log("[Search] Starting...");
  try {
    const favorites  = db.getFavorites();
    const excluded   = db.getExcluded();
    const seenTitles = db.getSeenTitles();

    const releases = await fetchReleases(favorites, excluded, seenTitles);

    // Save new releases (don't clear old ones — keep history)
    releases.forEach(r => db.saveRelease(r));

    // Mark these titles as seen so future searches skip them
    db.addSeenTitles(releases.map(r => r.title));

    console.log(`[Search] Done — ${releases.length} new releases saved.`);
  } catch (err) {
    lastSearchError = err.message;
    console.error("[Search] Error:", err.message);
  } finally {
    searchInProgress = false;
  }
}

// ── Serve frontend for all non-API routes ─────────────────────────────────────
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`[Server] ComicsRadar running on port ${PORT}`);
  console.log(`[Server] Access at http://localhost:${PORT}?token=${SECRET_TOKEN}`);
});
