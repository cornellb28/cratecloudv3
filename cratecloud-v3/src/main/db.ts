import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'
import { mkdirSync } from 'fs'

// ─── Setup ───────────────────────────────────────────────
// SQLite lives in the user's app data folder — never in
// the project folder. On Mac: ~/Library/Application Support/cratecloud/
// On Windows: C:\Users\Name\AppData\Roaming\cratecloud\

// gives access to system paths (like "where should this app store its data").
const dbDir = join(app.getPath('userData'), 'cratecloud') // It appends a cratecloud subfolder to that path.
mkdirSync(dbDir, { recursive: true }) // mkdirSync(..., { recursive: true }) creates that folder if it doesn't exist yet — recursive: true means it won't throw an error if the folder is already there, and it'll create any missing parent folders too.

const dbPath = join(dbDir, 'library.db')
const db = new Database(dbPath)

// WAL mode makes reads and writes faster and safer
// It means reads never block writes and vice versa
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

// ─── Schema ──────────────────────────────────────────────

db.exec(`

  -- ─────────────────────────────────────────────────────
  -- TRACKS
  -- Core table. Every audio file gets one row.
  -- Two kinds of columns:
  --   Mirror columns  → copied from the file's ID3 tags
  --   App-only columns → only exist in CrateCloud
  -- ─────────────────────────────────────────────────────

  CREATE TABLE IF NOT EXISTS tracks (

    -- Identity
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    filepath      TEXT    NOT NULL UNIQUE,
    filename      TEXT,

    -- Mirror columns (ID3 tags — kept in sync with the file)
    title         TEXT  NOT NULL DEFAULT '',
    artist        TEXT DEFAULT '',
    album         TEXT,
    genre         TEXT,
    key_val       TEXT DEFAULT '',
    year          TEXT,
    remixer       TEXT,
    grouping      TEXT,
    composer      TEXT,
    comment       TEXT,
    label         TEXT,
    created_at    INTEGER,

    -- Analysis results (written back to file after analysis)
    bpm           REAL,
    key_camelot   TEXT,
    key_full      TEXT,
    camelot       TEXT,
    openkey       TEXT,
    duration_sec  REAL,
    duration_str  TEXT,
    file_size_mb  REAL,
    format        TEXT,
    waveform      TEXT,
    artwork_path  TEXT,

    -- App-only columns (never written to ID3 tags)
    -- TODO: refactor to board_id INTEGER REFERENCES boards(id)
    -- After board ui is built in phase 5.
    -- When remaining a column, run:
    -- UPDATE tracks SET board_column = 'NewName' WHERE board_column = 'OldName'
    board_column  TEXT    NOT NULL DEFAULT 'Untagged',
    energy        INTEGER,
    analyzed_at   TEXT,
    added_at      TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT    NOT NULL DEFAULT (datetime('now')),
    last_modified INTEGER,

    -- Sync tracking (your conflict resolution system)
    missing          INTEGER NOT NULL DEFAULT 0,
    needs_sync       INTEGER NOT NULL DEFAULT 0,
    pending_changes  TEXT,
    last_seen_at     TEXT
  );

  -- ─────────────────────────────────────────────────────
  -- FILESYSTEM MIRROR
  -- Mirrors the real folder structure on disk.
  -- One row per real directory.
  -- ─────────────────────────────────────────────────────

  CREATE TABLE IF NOT EXISTS library_roots (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT    NOT NULL,
    path            TEXT    NOT NULL UNIQUE,
    created_at      INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    last_scanned_at INTEGER,
    status          TEXT    NOT NULL DEFAULT 'online'
  );

  CREATE TABLE IF NOT EXISTS folders (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    name             TEXT    NOT NULL,
    path             TEXT,
    parent_folder_id INTEGER REFERENCES folders(id) ON DELETE CASCADE,
    root_folder_id   INTEGER REFERENCES library_roots(id) ON DELETE SET NULL,
    created_at       INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    updated_at       INTEGER
  );

  -- ─────────────────────────────────────────────────────
  -- TAG SYSTEM
  -- The core of the label / badge feature.
  --
  -- tags        — every unique label in the library
  -- track_tags  — which tracks have which labels (pivot)
  --
  -- One tag can belong to many tracks.
  -- One track can have many tags.
  -- A tag is created once and reused forever.
  --
  -- field separates tag categories:
  --   'label'   → DJ badges: FTW, CLASSIC, HEADZ
  --   'genre'   → Tech House, Afro House
  --   'artist'  → Kenji Rō, Femke V
  --   'vibe'    → DARK, PEAK, WARM
  --   'venue'   → WAREHOUSE, FESTIVAL, CLUB
  --   'custom'  → anything the DJ invents
  --
  -- value is always normalized before insert:
  --   label/custom/vibe/venue → UPPERCASE
  --   genre                   → Title Case
  --   artist                  → preserved as typed
  --
  -- UNIQUE(field, value) prevents duplicates at the DB level.
  -- Normalization prevents case variants at the app level.
  -- Together: one tag row per concept, forever.
  -- ─────────────────────────────────────────────────────

  CREATE TABLE IF NOT EXISTS tags (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    field      TEXT    NOT NULL,
    value      TEXT    NOT NULL,
    color      TEXT    NOT NULL DEFAULT '#7f77dd',
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    UNIQUE(field, value)
  );

  -- Pivot table: many tracks ↔ many tags
  -- track_id + tag_id together are the primary key
  -- so the same tag can never be applied to the same
  -- track twice — the database enforces uniqueness

  CREATE TABLE IF NOT EXISTS track_tags (
    track_id   INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
    tag_id     INTEGER NOT NULL REFERENCES tags(id)   ON DELETE CASCADE,
    applied_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    PRIMARY KEY (track_id, tag_id)
  );

  -- ─────────────────────────────────────────────────────
  -- OPTION C — PENDING TAG IMPORT CONFIRMATION
  -- When a file is imported with an existing comment field,
  -- we parse it into candidate tags and store them here.
  -- The DJ reviews and confirms before anything is saved.
  --
  -- candidates is a JSON array of strings:
  --   '["FTW", "CLASSIC", "HEADZ"]'
  -- ─────────────────────────────────────────────────────

  CREATE TABLE IF NOT EXISTS pending_tag_imports (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    track_id    INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
    raw_comment TEXT    NOT NULL,
    candidates  TEXT    NOT NULL,
    created_at  INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );

  -- ─────────────────────────────────────────────────────
  -- CRATES
  -- DJ-curated groupings. Independent of folder location.
  -- A track can be in many crates.
  -- A crate can have many tracks.
  -- ─────────────────────────────────────────────────────

  CREATE TABLE IF NOT EXISTS crates (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT    NOT NULL,
    color      TEXT    NOT NULL DEFAULT '#7f77dd',
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );

  CREATE TABLE IF NOT EXISTS crate_tracks (
    crate_id INTEGER NOT NULL REFERENCES crates(id)  ON DELETE CASCADE,
    track_id INTEGER NOT NULL REFERENCES tracks(id)  ON DELETE CASCADE,
    added_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    PRIMARY KEY (crate_id, track_id)
  );

  -- ─────────────────────────────────────────────────────
  -- SETLISTS
  -- Ordered track lists for gig prep.
  -- Position column preserves the DJ's track order.
  -- ─────────────────────────────────────────────────────

  CREATE TABLE IF NOT EXISTS setlists (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT    NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );

  CREATE TABLE IF NOT EXISTS setlist_tracks (
    setlist_id INTEGER NOT NULL REFERENCES setlists(id)  ON DELETE CASCADE,
    track_id   INTEGER NOT NULL REFERENCES tracks(id)    ON DELETE CASCADE,
    position   INTEGER NOT NULL DEFAULT 0,
    UNIQUE(setlist_id, track_id)
  );

  -- ─────────────────────────────────────────────────────
  -- BOARDS
  -- The Kanban columns: Untagged, Tagged, Crate ready,
  -- Gig ready. Stored here so the DJ can rename or
  -- reorder columns without a code change.
  -- ─────────────────────────────────────────────────────

  CREATE TABLE IF NOT EXISTS boards (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT    NOT NULL UNIQUE,
    color      TEXT    NOT NULL DEFAULT '#888888',
    position   INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );

  -- Seed the default board columns on first launch
  INSERT OR IGNORE INTO boards (name, color, position) VALUES
    ('Untagged',    '#888780', 0),
    ('Tagged',      '#378ADD', 1),
    ('Crate ready', '#1D9E75', 2),
    ('Gig ready',   '#7F77DD', 3);

  -- ─────────────────────────────────────────────────────
  -- APP SETTINGS
  -- Key/value store for user preferences.
  -- Examples:
  --   key: 'match_weight_key',    value: '50'
  --   key: 'match_weight_bpm',    value: '30'
  --   key: 'sidebar_genres_open', value: 'true'
  -- ─────────────────────────────────────────────────────

  CREATE TABLE IF NOT EXISTS app_settings (
    key   TEXT PRIMARY KEY,
    value TEXT,
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );

  -- ─────────────────────────────────────────────────────
  -- DUPLICATE DETECTION
  -- Tracks pairs the DJ has already reviewed and dismissed.
  -- Prevents the same pair from surfacing again.
  -- ─────────────────────────────────────────────────────

  CREATE TABLE IF NOT EXISTS dismissed_duplicate_pairs (
    track_id_a   INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
    track_id_b   INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
    dismissed_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    PRIMARY KEY (track_id_a, track_id_b)
  );

  -- ─────────────────────────────────────────────────────
  -- INDEXES
  -- These make queries fast. Without them SQLite reads
  -- every row to find matches. With them it jumps
  -- directly to the right rows.
  --
  -- Rule: index every column you filter or sort by.
  -- ─────────────────────────────────────────────────────

  CREATE INDEX IF NOT EXISTS idx_tracks_filepath
    ON tracks(filepath);
  CREATE INDEX IF NOT EXISTS idx_tracks_missing
    ON tracks(missing);
  CREATE INDEX IF NOT EXISTS idx_tracks_needs_sync
    ON tracks(needs_sync);
  CREATE INDEX IF NOT EXISTS idx_tracks_bpm
    ON tracks(bpm);
  CREATE INDEX IF NOT EXISTS idx_tracks_genre
    ON tracks(genre);
  CREATE INDEX IF NOT EXISTS idx_tracks_artist
    ON tracks(artist);
  CREATE INDEX IF NOT EXISTS idx_tags_field
    ON tags(field);
    CREATE INDEX IF NOT EXISTS idx_tracks_key_camelot
    ON tracks(key_camelot);
  CREATE INDEX IF NOT EXISTS idx_tracks_board_column
    ON tracks(board_column);
  CREATE INDEX IF NOT EXISTS idx_tags_value
    ON tags(value);
  CREATE INDEX IF NOT EXISTS idx_tags_field_value
    ON tags(field, value);
  CREATE INDEX IF NOT EXISTS idx_track_tags_track_id
    ON track_tags(track_id);
  CREATE INDEX IF NOT EXISTS idx_track_tags_tag_id
    ON track_tags(tag_id);
  CREATE INDEX IF NOT EXISTS idx_crate_tracks_crate_id
    ON crate_tracks(crate_id);
  CREATE INDEX IF NOT EXISTS idx_setlist_tracks_setlist_id
    ON setlist_tracks(setlist_id);
  CREATE INDEX IF NOT EXISTS idx_folders_path
    ON folders(path);
  CREATE INDEX IF NOT EXISTS idx_folders_parent
    ON folders(parent_folder_id);
`)

// ─── Queries ─────────────────────────────────────────────
// Prepared statements are compiled once and run fast
// Think of them as saved SQL commands ready to fire
