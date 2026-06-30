const Database = require("better-sqlite3");
const path = require("path");

const DB_PATH = process.env.DB_PATH || path.join(__dirname, "comicsradar.db");
const db = new Database(DB_PATH);

// Enable WAL mode for better performance
db.pragma("journal_mode = WAL");

// ── Schema ────────────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS favorites (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    author TEXT,
    type TEXT,
    origin TEXT,
    created_at INTEGER DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS to_buy (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    author TEXT,
    publisher TEXT,
    type TEXT,
    origin TEXT,
    release_date TEXT,
    created_at INTEGER DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS excluded (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    author TEXT,
    type TEXT,
    origin TEXT,
    created_at INTEGER DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS releases (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    fetched_at INTEGER DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS seen_titles (
    title TEXT PRIMARY KEY,
    seen_at INTEGER DEFAULT (unixepoch())
  );
`);

// Seed initial favorites if table is empty
const favCount = db.prepare("SELECT COUNT(*) as c FROM favorites").get();
if (favCount.c === 0) {
  const insert = db.prepare("INSERT OR IGNORE INTO favorites (id, title, author, type, origin) VALUES (?, ?, ?, ?, ?)");
  const seedFavs = [
    ["f1",  "Daytripper",                 "Bá & Moon",           "comics",  "BR"],
    ["f2",  "Tekkonkinkreet",              "Taiyo Matsumoto",     "manga",   "JP"],
    ["f3",  "Death Note",                  "Ohba & Obata",        "manga",   "JP"],
    ["f4",  "Habibi",                      "Craig Thompson",      "comics",  "US"],
    ["f5",  "Drome",                       "Jesse Lonergan",      "comics",  "US"],
    ["f6",  "Gogo Monster",                "Taiyo Matsumoto",     "manga",   "JP"],
    ["f7",  "Come un brivido",             "Aniss El Hamouri",    "bd",      "BE"],
    ["f8",  "La profezia dell'armadillo",  "Zerocalcare",         "comics",  "IT"],
    ["f9",  "Blast",                       "Larcenet",            "bd",      "FR"],
    ["f10", "Blacksad",                    "Canales & Guarnido",  "bd",      "ES"],
    ["f11", "East of West",                "Hickman & Dragotta",  "comics",  "US"],
    ["f12", "Ratman",                      "Leo Ortolani",        "comics",  "IT"],
    ["f13", "Vagabond",                    "Takehiko Inoue",      "manga",   "JP"],
    ["f14", "Blade of the Immortal",       "Hiroaki Samura",      "manga",   "JP"],
  ];
  const insertMany = db.transaction(() => seedFavs.forEach(f => insert.run(...f)));
  insertMany();
}

// ── Favorites ─────────────────────────────────────────────────────────────────
const getFavorites = () => db.prepare("SELECT * FROM favorites ORDER BY created_at ASC").all();
const addFavorite = (item) => db.prepare("INSERT OR IGNORE INTO favorites (id, title, author, type, origin) VALUES (?, ?, ?, ?, ?)").run(item.id, item.title, item.author, item.type, item.origin);
const removeFavorite = (id) => db.prepare("DELETE FROM favorites WHERE id = ?").run(id);

// ── To Buy ────────────────────────────────────────────────────────────────────
const getToBuy = () => db.prepare("SELECT * FROM to_buy ORDER BY created_at DESC").all();
const addToBuy = (item) => db.prepare("INSERT OR IGNORE INTO to_buy (id, title, author, publisher, type, origin, release_date) VALUES (?, ?, ?, ?, ?, ?, ?)").run(item.id, item.title, item.author, item.publisher, item.type, item.origin, item.releaseDate);
const removeToBuy = (id) => db.prepare("DELETE FROM to_buy WHERE id = ?").run(id);

// ── Excluded ──────────────────────────────────────────────────────────────────
const getExcluded = () => db.prepare("SELECT * FROM excluded ORDER BY created_at DESC").all();
const addExcluded = (item) => db.prepare("INSERT OR IGNORE INTO excluded (id, title, author, type, origin) VALUES (?, ?, ?, ?, ?)").run(item.id, item.title, item.author, item.type, item.origin);
const removeExcluded = (id) => db.prepare("DELETE FROM excluded WHERE id = ?").run(id);

// ── Releases ──────────────────────────────────────────────────────────────────
const getLastReleases = () => {
  const rows = db.prepare("SELECT data, fetched_at FROM releases ORDER BY fetched_at DESC LIMIT 20").all();
  return rows.map(r => ({ ...JSON.parse(r.data), _fetchedAt: r.fetched_at }));
};
const saveRelease = (item) => {
  db.prepare("INSERT OR REPLACE INTO releases (id, data, fetched_at) VALUES (?, ?, unixepoch())").run(item.id, JSON.stringify(item));
};
const clearReleases = () => db.prepare("DELETE FROM releases").run();
const getLastFetchTime = () => {
  const row = db.prepare("SELECT MAX(fetched_at) as t FROM releases").get();
  return row?.t || null;
};

// ── Settings ──────────────────────────────────────────────────────────────────
const getSetting = (key) => db.prepare("SELECT value FROM settings WHERE key = ?").get(key)?.value;
const setSetting = (key, value) => db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(key, value);

// ── Seen titles ───────────────────────────────────────────────────────────────
const getSeenTitles = () => db.prepare("SELECT title FROM seen_titles ORDER BY seen_at DESC").all().map(r => r.title);
const addSeenTitles = (titles) => {
  const insert = db.prepare("INSERT OR IGNORE INTO seen_titles (title) VALUES (?)");
  const insertMany = db.transaction(() => titles.forEach(t => insert.run(t)));
  insertMany();
};
const clearSeenTitles = () => db.prepare("DELETE FROM seen_titles").run();

module.exports = {
  getFavorites, addFavorite, removeFavorite,
  getToBuy, addToBuy, removeToBuy,
  getExcluded, addExcluded, removeExcluded,
  getLastReleases, saveRelease, clearReleases, getLastFetchTime,
  getSetting, setSetting,
  getSeenTitles, addSeenTitles, clearSeenTitles,
};
