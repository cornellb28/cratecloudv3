import Database, { RunResult } from 'better-sqlite3'
import { app } from 'electron'
import { join, basename, dirname, relative, isAbsolute } from 'path'
import { mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { EventEmitter } from 'events'
import { randomUUID } from 'crypto'

// Fires 'changed' whenever ensureFolderTree actually inserts a new folder
// row — import, the watcher, fs:create-folder, and a track move all funnel
// through ensureFolderTree, so subscribing here once (in index.ts, forwarded
// to the renderer as 'folders:changed') covers every write path without
// threading an IpcMainInvokeEvent/mainWindow reference through db.ts.
export const folderEvents = new EventEmitter()

// ─── Setup ───────────────────────────────────────────────
// SQLite lives in the user's app data folder — never in
// the project folder. On Mac: ~/Library/Application Support/cratecloud/
// On Windows: C:\Users\Name\AppData\Roaming\cratecloud\

// Tests run against a throwaway userData dir so they never read or write
// the developer's real library, and so every run starts from a clean DB.
// Keyed by the parent (test runner) pid, not this Electron process's own —
// each test launches a fresh Electron process via beforeEach, and they all
// need to share one DB across a single `playwright test` invocation while
// still starting clean on the next invocation.
if (process.env.NODE_ENV === 'test') {
  app.setPath('userData', join(tmpdir(), `cratecloud-test-${process.ppid}`))
}

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
    file_size_bytes INTEGER,
    format        TEXT,
    waveform      TEXT,
    artwork_path  TEXT,
    artwork_hash  TEXT,
    client_uuid   TEXT,
    partial_hash  TEXT,

    -- App-only columns (never written to ID3 tags)
    board_id      INTEGER NOT NULL DEFAULT 1 REFERENCES boards(id),
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

  -- Seed default genre tags
-- DJ can edit, add, or delete these
INSERT OR IGNORE INTO tags (field, value, color) VALUES
  ('genre', 'Afro House',    '#d85a30'),
  ('genre', 'Amapiano',      '#ba7517'),
  ('genre', 'Bass House',    '#7f77dd'),
  ('genre', 'Breaks',        '#378add'),
  ('genre', 'Deep House',    '#1d9e75'),
  ('genre', 'Drum and Bass', '#d4537e'),
  ('genre', 'Dubstep',       '#534ab7'),
  ('genre', 'Funk',          '#ba7517'),
  ('genre', 'Hip Hop',       '#d85a30'),
  ('genre', 'House',         '#7f77dd'),
  ('genre', 'Jungle',        '#1d9e75'),
  ('genre', 'Latin',         '#d85a30'),
  ('genre', 'Melodic House', '#378add'),
  ('genre', 'Minimal',       '#888780'),
  ('genre', 'Nu Disco',      '#d4537e'),
  ('genre', 'Organic House', '#1d9e75'),
  ('genre', 'R&B',           '#d85a30'),
  ('genre', 'Reggae',        '#1d9e75'),
  ('genre', 'Soul',          '#ba7517'),
  ('genre', 'Tech House',    '#534ab7'),
  ('genre', 'Techno',        '#3a3a3a'),
  ('genre', 'Trance',        '#378add'),
  ('genre', 'UK Garage',     '#7f77dd');
`)

// ─── Migration ───────────────────────────────────────────
// Databases created before the boards system existed have a
// text `board_column` column instead of `board_id`. Add the
// new column and backfill it from the old one by matching
// board names, without touching any other data.

const trackColumns = db.prepare(`PRAGMA table_info(tracks)`).all() as { name: string }[]
const hasBoardId = trackColumns.some((c) => c.name === 'board_id')
const hasBoardColumn = trackColumns.some((c) => c.name === 'board_column')

if (!hasBoardId) {
  db.exec(`ALTER TABLE tracks ADD COLUMN board_id INTEGER NOT NULL DEFAULT 1`)
  if (hasBoardColumn) {
    db.exec(`
      UPDATE tracks
      SET board_id = (SELECT id FROM boards WHERE boards.name = tracks.board_column)
      WHERE board_column IS NOT NULL
        AND EXISTS (SELECT 1 FROM boards WHERE boards.name = tracks.board_column)
    `)
  }
}

// Content-addressed artwork storage — artwork_path (per-track file) is kept
// alongside artwork_hash (shared, content-addressed file) during migration.
// See storeArtwork/migrateArtworkToContentAddressed. artwork_path can be
// dropped in a later pass once the migration is confirmed working.
const hasArtworkHash = trackColumns.some((c) => c.name === 'artwork_hash')
if (!hasArtworkHash) {
  db.exec(`ALTER TABLE tracks ADD COLUMN artwork_hash TEXT`)
}

// folder_id makes `folders` the source of truth for a track's directory,
// written at import time (see ensureFolderTree). Existing rows stay NULL
// until backfillTrackFolderIds runs once at startup.
const hasFolderId = trackColumns.some((c) => c.name === 'folder_id')
if (!hasFolderId) {
  db.exec(
    `ALTER TABLE tracks ADD COLUMN folder_id INTEGER REFERENCES folders(id) ON DELETE SET NULL`
  )
}

// client_uuid: stable per-track identity, nullable — most rows never get
// one (legacy files, formats write_tags doesn't cover). Read-only for now:
// populated from a CRATECLOUD_ID tag if the file already has one, minted
// fresh on insert otherwise (see insertTrack) — nothing writes it back to
// the file yet. The partial index means many NULLs coexist fine; only a
// real, non-null value has to be unique.
const hasClientUuid = trackColumns.some((c) => c.name === 'client_uuid')
if (!hasClientUuid) {
  db.exec(`ALTER TABLE tracks ADD COLUMN client_uuid TEXT`)
}

// A cheap partial-file hash, stored at insert time so it's still available
// once a track goes missing and can no longer be read — see
// computePartialHash/findReconcileMatch in index.ts. Only ever consulted to
// break a tie when client_uuid is absent and size+duration alone matched
// more than one missing track.
const hasPartialHash = trackColumns.some((c) => c.name === 'partial_hash')
if (!hasPartialHash) {
  db.exec(`ALTER TABLE tracks ADD COLUMN partial_hash TEXT`)
}

// file_size_bytes replaces file_size_mb, which every fast-tag-read call
// computed and then silently dropped (buildTrackData never read it) —
// dead since the column was added. Exact bytes instead of a rounded MB
// figure: reconcile's fingerprint fallback (filename + size + duration)
// needs an exact match, not a lossy one.
const hasFileSizeBytes = trackColumns.some((c) => c.name === 'file_size_bytes')
if (!hasFileSizeBytes) {
  db.exec(`ALTER TABLE tracks ADD COLUMN file_size_bytes INTEGER`)
}
const hasFileSizeMb = trackColumns.some((c) => c.name === 'file_size_mb')
if (hasFileSizeMb) {
  db.exec(`ALTER TABLE tracks DROP COLUMN file_size_mb`)
}

// relative_path is the folder's path relative to its library_root (''
// for the root folder itself, 'House/Techno' for a nested one). It's what
// makes ensureFolderTree idempotent — UNIQUE(root_folder_id, relative_path)
// below means a re-scanned directory resolves to its existing row instead
// of inserting a duplicate. Folders created without a registered root
// (root_folder_id NULL) fall outside that constraint — as of this writing
// no code path creates a folder row without one; ensureFolderTree is the
// only writer and always supplies a root_folder_id.
const folderColumns = db.prepare(`PRAGMA table_info(folders)`).all() as { name: string }[]
const hasRelativePath = folderColumns.some((c) => c.name === 'relative_path')
if (!hasRelativePath) {
  db.exec(`ALTER TABLE folders ADD COLUMN relative_path TEXT`)
}

// Mirrors tracks.missing — set when the watcher sees the directory disappear
// (unlinkDir) rather than deleting the row outright, so a folder that comes
// back (recreated, or the DJ was wrong about deleting it) doesn't lose its
// identity/position in the tree. Cleared when ensureFolderTree reuses this
// row for a live directory again (see ensureFolderTree below) — the folder
// container "exists" again; whether its old tracks are the SAME tracks is a
// separate, harder question left to the identity/relink work.
const hasFolderMissing = folderColumns.some((c) => c.name === 'missing')
if (!hasFolderMissing) {
  db.exec(`ALTER TABLE folders ADD COLUMN missing INTEGER NOT NULL DEFAULT 0`)
}

db.exec(`
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

  CREATE TABLE IF NOT EXISTS pending_changes (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  root_id      INTEGER REFERENCES library_roots(id) ON DELETE CASCADE,
  change_type  TEXT    NOT NULL,
  old_path     TEXT,
  new_path     TEXT,
  track_id     INTEGER REFERENCES tracks(id) ON DELETE SET NULL,
  detected_at  INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  status       TEXT    NOT NULL DEFAULT 'pending'
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
  CREATE INDEX IF NOT EXISTS idx_tracks_artwork_hash
    ON tracks(artwork_hash);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_tracks_client_uuid
    ON tracks(client_uuid) WHERE client_uuid IS NOT NULL;
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
  CREATE INDEX IF NOT EXISTS idx_tracks_board_id
    ON tracks(board_id);
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
  CREATE UNIQUE INDEX IF NOT EXISTS idx_folders_root_relpath
    ON folders(root_folder_id, relative_path);
  CREATE INDEX IF NOT EXISTS idx_folders_missing
    ON folders(missing);
  CREATE INDEX IF NOT EXISTS idx_tracks_folder_id
    ON tracks(folder_id);
  CREATE INDEX IF NOT EXISTS idx_pending_changes_status
  ON pending_changes(status);

  CREATE INDEX IF NOT EXISTS idx_pending_changes_root
    ON pending_changes(root_id);
`)

// ─── Prepared statements/Queries ─────────────────────────────────────────────
// Prepared statements are compiled once and run fast
// Think of them as saved SQL commands ready to fire

const stmts = {
  // -- Tracks ------------------------------------

  insertTrack: db.prepare(`
     INSERT INTO tracks (
      filepath, filename, title, artist, album, genre,
      year, remixer, composer, comment, label, grouping,
      bpm, key_camelot, key_full, camelot, openkey,
      duration_sec, duration_str, file_size_bytes, format,
      artwork_path, analyzed_at, board_id, folder_id, client_uuid, partial_hash
     )
      VALUES (
       @filepath, @filename, @title, @artist, @album, @genre,
       @year, @remixer, @composer, @comment, @label, @grouping,
       @bpm, @key_camelot, @key_full, @camelot, @openkey,
       @duration_sec, @duration_str, @file_size_bytes, @format,
       @artwork_path, @analyzed_at, @board_id, @folder_id, @client_uuid, @partial_hash
      )
       ON CONFLICT(filepath) DO UPDATE SET
         title           = excluded.title,
         artist          = excluded.artist,
         album           = excluded.album,
         genre           = excluded.genre,
         bpm             = excluded.bpm,
         key_camelot     = excluded.key_camelot,
         analyzed_at     = excluded.analyzed_at,
         updated_at      = datetime('now'),
         missing         = 0,
         last_seen_at    = datetime('now'),
         folder_id       = COALESCE(excluded.folder_id, folder_id),
         file_size_bytes = excluded.file_size_bytes,
         -- Never clobber a stable id with a fresh mint — same COALESCE
         -- reasoning as folder_id just above.
         client_uuid     = COALESCE(client_uuid, excluded.client_uuid),
         partial_hash    = excluded.partial_hash
    `),
  // COALESCE, not a plain overwrite: importSingleFile always inserts with
  // folder_id null (it doesn't resolve a root), so a plain `= excluded.
  // folder_id` would stomp a good folder_id a prior folder import already
  // set for this filepath. COALESCE also lets the reverse repair itself —
  // a track first added via importSingleFile (folder_id null) picks up
  // the correct folder_id the next time a folder import resolves one for
  // its path, instead of staying null forever.
  getAllTracks: db.prepare(`
      SELECT * FROM tracks
      ORDER BY added_at DESC
    `),
  getTrackById: db.prepare(`
      SELECT * FROM tracks WHERE id = ?
    `),
  getTrackByFilepath: db.prepare(`
      SELECT * FROM tracks WHERE filepath = ?
    `),
  updateTrackMeta: db.prepare(`
    UPDATE tracks SET
      title           = @title,
      artist          = @artist,
      genre           = @genre,
      year            = @year,
      bpm             = @bpm,
      key_camelot     = @key_camelot,
      energy          = @energy,
      comment         = @comment,
      updated_at      = datetime('now'),
      needs_sync      = @needs_sync,
      pending_changes = @pending_changes,
      artwork_path    = @artwork_path
    WHERE id = @id
  `),
  getUnanalyzedTracks: db.prepare(`
  SELECT id, filepath FROM tracks
  WHERE analyzed_at IS NULL
  AND (missing = 0 OR missing IS NULL)
  ORDER BY added_at ASC
`),
  setTrackArtworkHash: db.prepare(`
  UPDATE tracks SET artwork_hash = @artwork_hash
  WHERE id = @id
`),
  getArtworkHashCounts: db.prepare(`
  SELECT DISTINCT artwork_hash FROM tracks WHERE artwork_hash IS NOT NULL
`),
  getTracksWithLegacyArtwork: db.prepare(`
  SELECT id, artwork_path FROM tracks
  WHERE artwork_path IS NOT NULL AND artwork_hash IS NULL
`),
  markMissing: db.prepare(`
    UPDATE tracks SET
      missing    = 1,
      updated_at = datetime('now')
    WHERE filepath = ?
  `),
  markFound: db.prepare(`
    UPDATE tracks SET
      missing      = 0,
      last_seen_at = datetime('now'),
      updated_at   = datetime('now')
    WHERE filepath = ?
  `),

  getNeedsSync: db.prepare(`
    SELECT * FROM tracks WHERE needs_sync = 1
  `),

  clearSync: db.prepare(`
    UPDATE tracks SET
      needs_sync      = 0,
      pending_changes = NULL,
      updated_at      = datetime('now')
    WHERE id = ?
  `),

  updateBoardId: db.prepare(`
    UPDATE tracks SET
      board_id = @board_id,
      updated_at   = datetime('now')
    WHERE id = @id
  `),

  // ── Tags ────────────────────────────────────────────

  insertTag: db.prepare(`
    INSERT OR IGNORE INTO tags (field, value, color)
    VALUES (@field, @value, @color)
  `),

  getTagId: db.prepare(`
    SELECT id FROM tags
    WHERE field = ? AND value = ?
  `),

  findTag: db.prepare(`
    SELECT * FROM tags
    WHERE field = ? AND value = ?
  `),

  getAllTags: db.prepare(`
    SELECT
      tg.*,
      COUNT(tt.track_id) as track_count
    FROM tags tg
    LEFT JOIN track_tags tt ON tt.tag_id = tg.id
    GROUP BY tg.id
    ORDER BY tg.field, tg.value
  `),
  getTagsByField: db.prepare(`
    SELECT
      tg.*,
      COUNT(tt.track_id) as track_count
    FROM tags tg
    LEFT JOIN track_tags tt ON tt.tag_id = tg.id
    WHERE tg.field = ?
    GROUP BY tg.id
    ORDER BY tg.value
  `),

  getMostUsedTags: db.prepare(`
    SELECT
      tg.*,
      COUNT(tt.track_id) as track_count
    FROM tags tg
    LEFT JOIN track_tags tt ON tt.tag_id = tg.id
    GROUP BY tg.id
    ORDER BY track_count DESC, tg.value
    LIMIT ?
  `),

  getTrackTags: db.prepare(`
    SELECT tg.* FROM tags tg
    JOIN track_tags tt ON tt.tag_id = tg.id
    WHERE tt.track_id = ?
    ORDER BY tg.field, tg.value
  `),

  getTagTracks: db.prepare(`
    SELECT t.* FROM tracks t
    JOIN track_tags tt ON tt.track_id = t.id
    WHERE tt.tag_id = ?
    ORDER BY t.artist, t.title
  `),

  linkTag: db.prepare(`
    INSERT OR IGNORE INTO track_tags (track_id, tag_id)
    VALUES (@track_id, @tag_id)
  `),
  unlinkTag: db.prepare(`
    DELETE FROM track_tags
    WHERE track_id = @track_id AND tag_id = @tag_id
  `),

  // ── Pending tag imports ──────────────────────────────

  insertPending: db.prepare(`
    INSERT INTO pending_tag_imports
      (track_id, raw_comment, candidates)
    VALUES
      (@track_id, @raw_comment, @candidates)
  `),

  getPending: db.prepare(`
    SELECT * FROM pending_tag_imports
    ORDER BY created_at ASC
  `),

  deletePending: db.prepare(`
    DELETE FROM pending_tag_imports WHERE id = ?
  `),

  // ── Crates ──────────────────────────────────────────

  insertCrate: db.prepare(`
    INSERT INTO crates (name, color)
    VALUES (@name, @color)
  `),
  getAllCrates: db.prepare(`
    SELECT
      c.*,
      COUNT(ct.track_id) as track_count
    FROM crates c
    LEFT JOIN crate_tracks ct ON ct.crate_id = c.id
    GROUP BY c.id
    ORDER BY c.name
  `),

  addTrackToCrate: db.prepare(`
    INSERT OR IGNORE INTO crate_tracks (crate_id, track_id)
    VALUES (@crate_id, @track_id)
  `),

  removeTrackFromCrate: db.prepare(`
    DELETE FROM crate_tracks
    WHERE crate_id = @crate_id AND track_id = @track_id
  `),

  getCrateTracks: db.prepare(`
    SELECT t.* FROM tracks t
    JOIN crate_tracks ct ON ct.track_id = t.id
    WHERE ct.crate_id = ?
    ORDER BY t.artist, t.title
  `),

  // ── Library roots ─────────────────────────────────────

  getAllRoots: db.prepare(`
    SELECT * FROM library_roots ORDER BY created_at ASC
  `),

  addRoot: db.prepare(`
    INSERT OR IGNORE INTO library_roots (name, path)
    VALUES (@name, @path)
  `),

  removeRoot: db.prepare(`
    DELETE FROM library_roots WHERE id = ?
  `),

  // ── Boards ──────────────────────────────────────────

  getAllBoards: db.prepare(`
    SELECT * FROM boards ORDER BY position ASC
  `),

  getTracksByBoardId: db.prepare(`
    SELECT t.*, b.name as board_name, b.color as board_color
    FROM tracks t
    JOIN boards b ON b.id = t.board_id
    WHERE t.board_id = ?
    ORDER BY t.added_at DESC
  `),

  getTracksByColumn: db.prepare(`
    SELECT * FROM tracks
    WHERE board_id = ?
    ORDER BY added_at DESC
  `),

  markAnalyzed: db.prepare(`
  UPDATE tracks SET
    analyzed_at = datetime('now'),
    updated_at  = datetime('now')
  WHERE id = ?
`),

  // ── File/Folder Moves ───────────────────────────────

  updateFilepath: db.prepare(`
  UPDATE tracks SET
    filepath     = @newPath,
    filename     = @filename,
    folder_id    = @folder_id,
    missing      = 0,
    last_seen_at = datetime('now'),
    updated_at   = datetime('now')
  WHERE filepath = @oldPath
`),

  // ── App settings ────────────────────────────────────

  getSetting: db.prepare(`
    SELECT value FROM app_settings WHERE key = ?
  `),

  setSetting: db.prepare(`
    INSERT INTO app_settings (key, value, updated_at)
    VALUES (@key, @value, strftime('%s','now'))
    ON CONFLICT(key) DO UPDATE SET
      value      = excluded.value,
      updated_at = strftime('%s','now')
  `),
  insertPendingChange: db.prepare(`
    INSERT INTO pending_changes
      (root_id, change_type, old_path, new_path, track_id)
    VALUES
      (@root_id, @change_type, @old_path, @new_path, @track_id)
  `),

  getPendingChanges: db.prepare(`
    SELECT pc.*, t.title, t.artist, t.artwork_hash
    FROM pending_changes pc
    LEFT JOIN tracks t ON t.id = pc.track_id
    WHERE pc.status = 'pending'
    ORDER BY pc.detected_at ASC
  `),

  acceptPendingChange: db.prepare(`
    UPDATE pending_changes SET status = 'accepted' WHERE id = ?
  `),

  ignorePendingChange: db.prepare(`
    UPDATE pending_changes SET status = 'ignored' WHERE id = ?
  `),

  clearPendingChanges: db.prepare(`
    DELETE FROM pending_changes WHERE status != 'pending'
  `)
}

// --- Track Functions ------------------------------------------

export function insertTrack(track: Record<string, unknown>): { lastInsertRowid: number | bigint } {
  // Fill in null for any missing fields so the prepared
  // statement never throws "Missing named parameter"
  const safe = {
    filepath: track.filepath ?? null,
    filename: track.filename ?? null,
    title: track.title ?? null,
    artist: track.artist ?? null,
    album: track.album ?? null,
    genre: track.genre ?? null,
    year: track.year ?? null,
    remixer: track.remixer ?? null,
    composer: track.composer ?? null,
    comment: track.comment ?? null,
    label: track.label ?? null,
    grouping: track.grouping ?? null,
    bpm: track.bpm ?? null,
    key_camelot: track.key_camelot ?? null,
    key_full: track.key_full ?? null,
    camelot: track.camelot ?? null,
    openkey: track.openkey ?? null,
    duration_sec: track.duration_sec ?? null,
    duration_str: track.duration_str ?? null,
    file_size_bytes: track.file_size_bytes ?? null,
    format: track.format ?? null,
    artwork_path: track.artwork_path ?? null,
    analyzed_at: track.analyzed_at ?? null,
    board_id: track.board_id ?? 1, // default to Untagged (id: 1)
    folder_id: track.folder_id ?? null,
    // Minted here, once, for every insert that didn't come with one already
    // (no CRATECLOUD_ID tag on the file) — the ON CONFLICT path's COALESCE
    // means this mint is thrown away harmlessly on a re-scan of a file that
    // already has a row.
    client_uuid: track.client_uuid ?? randomUUID(),
    partial_hash: track.partial_hash ?? null
  }
  stmts.insertTrack.run(safe)

  // better-sqlite3's lastInsertRowid is unreliable here: on the
  // ON CONFLICT DO UPDATE path it is NOT reset to 0 — it holds
  // whatever rowid the connection's last real INSERT produced,
  // which may belong to a completely different track. Always
  // resolve the id by filepath (UNIQUE, indexed) instead of
  // trusting the statement result.
  const existing = stmts.getTrackByFilepath.get(safe.filepath) as { id: number } | undefined
  return { lastInsertRowid: existing?.id ?? 0 }
}

// Batched version of insertTrack — wraps N rows in a single transaction so a
// large folder import commits in chunks instead of one fsync per file.
// Reuses insertTrack's per-row upsert + safe-defaulting so batched and
// single-file inserts stay byte-for-byte identical.
export function insertTracksBatch(
  tracks: Record<string, unknown>[]
): { id: number; filepath: string }[] {
  const insertMany = db.transaction((rows: Record<string, unknown>[]) => {
    return rows.map((track) => {
      const result = insertTrack(track)
      return { id: Number(result.lastInsertRowid), filepath: track.filepath as string }
    })
  })
  return insertMany(tracks)
}

export function getAllTracks(): Track[] {
  return stmts.getAllTracks.all() as Track[]
}

export function getTrackById(id: number): Track | undefined {
  return stmts.getTrackById.get(id) as Track | undefined
}

// Bulk lookup by id — used to refetch just the tracks a move job touched
// instead of the whole library (getAllTracks). Chunked the same way
// getTrackTagsForTracks is, under SQLite's ~999 bound parameter limit.
const TRACK_LOOKUP_CHUNK_SIZE = 900

export function getTracksByIds(ids: number[]): Track[] {
  if (ids.length === 0) return []
  const result: Track[] = []
  for (let i = 0; i < ids.length; i += TRACK_LOOKUP_CHUNK_SIZE) {
    const chunk = ids.slice(i, i + TRACK_LOOKUP_CHUNK_SIZE)
    const placeholders = chunk.map(() => '?').join(',')
    result.push(
      ...(db.prepare(`SELECT * FROM tracks WHERE id IN (${placeholders})`).all(...chunk) as Track[])
    )
  }
  return result
}

export function getTrackByFilepath(filepath: string): Track | undefined {
  return stmts.getTrackByFilepath.get(filepath) as Track | undefined
}

export function updateTrackMeta(data: Record<string, unknown>): RunResult {
  // Merge onto the existing row so callers that only touch a subset of
  // fields (e.g. re-analysis only updating bpm/key) don't need to know
  // every column the statement binds, and don't clear ones they omit.
  const existing = stmts.getTrackById.get(data.id as number) as Record<string, unknown> | undefined
  return stmts.updateTrackMeta.run({ ...existing, ...data })
}

export function markTrackMissing(filepath: string): RunResult {
  return stmts.markMissing.run(filepath)
}

export function markTrackFound(filepath: string): RunResult {
  return stmts.markFound.run(filepath)
}

export function markTrackAnalyzed(id: number): RunResult {
  return stmts.markAnalyzed.run(id)
}

export function getTracksNeedingSync(): Track[] {
  return stmts.getNeedsSync.all() as Track[]
}

export function clearTrackSync(id: number): RunResult {
  return stmts.clearSync.run(id)
}

export function updateBoardId(id: number, boardId: number): RunResult {
  return stmts.updateBoardId.run({ id, board_id: boardId })
}

export function getTracksByBoardId(boardId: number): Track[] {
  return stmts.getTracksByBoardId.all(boardId) as Track[]
}

// ─── Tag functions ────────────────────────────────────────

export function normalizeTagValue(field: string, value: string): string {
  const trimmed = value.trim()
  if (field === 'label' || field === 'custom' || field === 'vibe' || field === 'venue') {
    return trimmed.toUpperCase()
  }
  if (field === 'genre') {
    return trimmed
      .split(' ')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(' ')
  }
  return trimmed
}

// Two statements because OR IGNORE returns 0 on conflict.
// getTagId always returns the correct id whether the tag
// is new or already existed.
export function findOrCreateTag(field: string, value: string, color = '#7f77dd'): number {
  const normalized = normalizeTagValue(field, value)
  stmts.insertTag.run({ field, value: normalized, color })
  const tag = stmts.getTagId.get(field, normalized) as { id: number } | undefined
  if (!tag) {
    throw new Error(`Failed to find or create tag: ${field}/${normalized}`)
  }
  return tag.id
}

export function applyTag(trackId: number, tagId: number): RunResult {
  return stmts.linkTag.run({ track_id: trackId, tag_id: tagId })
}

export function removeTag(trackId: number, tagId: number): RunResult {
  return stmts.unlinkTag.run({ track_id: trackId, tag_id: tagId })
}

export function getTrackTags(trackId: number): Tag[] {
  return stmts.getTrackTags.all(trackId) as Tag[]
}

// Bulk version of getTrackTags — one query (chunked under SQLite's ~999 bound
// parameter limit) instead of one round trip per track. Same tags.* row shape
// as getTrackTags, just grouped by track_id.
const TAG_LOOKUP_CHUNK_SIZE = 900

export function getTrackTagsForTracks(trackIds: number[]): Record<number, Tag[]> {
  const result: Record<number, Tag[]> = {}
  if (trackIds.length === 0) return result

  // Pre-seed every requested id with [] so callers get a complete map back —
  // tracks with no tags never produce a row in the JOIN below.
  for (const id of trackIds) result[id] = []

  for (let i = 0; i < trackIds.length; i += TAG_LOOKUP_CHUNK_SIZE) {
    const chunk = trackIds.slice(i, i + TAG_LOOKUP_CHUNK_SIZE)
    const placeholders = chunk.map(() => '?').join(',')
    const rows = db
      .prepare(
        `
        SELECT tt.track_id as track_id, tg.*
        FROM tags tg
        JOIN track_tags tt ON tt.tag_id = tg.id
        WHERE tt.track_id IN (${placeholders})
        ORDER BY tt.track_id, tg.field, tg.value
      `
      )
      .all(...chunk) as (Tag & { track_id: number })[]

    for (const { track_id, ...tag } of rows) {
      result[track_id].push(tag as Tag)
    }
  }

  return result
}

export function getTagTracks(tagId: number): Track[] {
  return stmts.getTagTracks.all(tagId) as Track[]
}

export function getAllTags(): Tag[] {
  return stmts.getAllTags.all() as Tag[]
}

export function getMostUsedTags(limit = 12): Tag[] {
  return stmts.getMostUsedTags.all(limit) as Tag[]
}

export function getAllRoots(): LibraryRoot[] {
  return stmts.getAllRoots.all() as LibraryRoot[]
}

export function addRoot(name: string, path: string): RunResult {
  return stmts.addRoot.run({ name, path })
}

export function removeRoot(id: number): RunResult {
  return stmts.removeRoot.run(id)
}

// True if `child` is `parent` itself or lives inside it. A plain
// `child.startsWith(parent)` would also match a sibling like "/Music2" or
// "/MusicOld" against root "/Music" since one string prefixes the other —
// relative() respects the path-segment boundary instead.
export function isPathUnder(child: string, parent: string): boolean {
  if (child === parent) return true
  const rel = relative(parent, child)
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

// ─── Folders (source of truth for a track's directory) ────────────────────
// ensureFolderTree is the only writer. getFolderTree/getFolderTrackCounts/
// getTracksByFolder are what the renderer reads instead of deriving
// structure from tracks[].filepath.

// Creates/merges the folder tree for one registered library root.
// relativeDirs are paths relative to the root (e.g. "House/Techno"), deduped,
// including "" for the root itself. Idempotent per root: a relative_path
// already registered under root_folder_id is reused rather than re-inserted
// — enforced by idx_folders_root_relpath, not just this lookup, so a race
// can't slip a duplicate past it either. Parents are inserted before
// children, all in one transaction. Returns relative path -> folder id; ""
// maps to the root folder's own id.
export function ensureFolderTree(rootId: number, relativeDirs: string[]): Map<string, number> {
  const root = db.prepare('SELECT * FROM library_roots WHERE id = ?').get(rootId) as
    LibraryRoot | undefined
  if (!root) throw new Error(`ensureFolderTree: unknown library root ${rootId}`)

  const pathToId = new Map<string, number>()
  // Only rows the caller is actually asking about (root's own '' plus every
  // path in relativeDirs, built below) get revived if they were missing —
  // NOT every missing row that happens to exist under this root. Populated
  // once the existing-rows query below runs.
  const missingByPath = new Map<string, number>()
  let created = 0
  let revived = 0

  const run = db.transaction(() => {
    const existing = db
      .prepare('SELECT id, relative_path, missing FROM folders WHERE root_folder_id = ?')
      .all(rootId) as { id: number; relative_path: string | null; missing: number }[]
    for (const f of existing) {
      if (f.relative_path === null) continue
      pathToId.set(f.relative_path, f.id)
      if (f.missing) missingByPath.set(f.relative_path, f.id)
    }

    // The container exists again at this exact path — a watcher addDir (or
    // a re-scan) found a live directory where we'd previously marked the
    // row missing. Its tracks stay missing; whether they're the SAME files
    // is what the identity/relink work resolves, not this.
    const revive = db.prepare('UPDATE folders SET missing = 0 WHERE id = ?')
    function reviveIfMissing(relPath: string): void {
      const id = missingByPath.get(relPath)
      if (id === undefined) return
      revive.run(id)
      missingByPath.delete(relPath)
      revived++
    }

    if (!pathToId.has('')) {
      const rootRowId = Number(
        db
          .prepare(
            'INSERT INTO folders (name, parent_folder_id, path, root_folder_id, relative_path) VALUES (?, NULL, ?, ?, ?)'
          )
          .run(root.name, root.path, rootId, '').lastInsertRowid
      )
      pathToId.set('', rootRowId)
      created++
    } else {
      reviveIfMissing('')
    }

    const allPaths = new Set<string>()
    for (const dir of relativeDirs) {
      if (!dir) continue
      const parts = dir.split('/')
      for (let i = 1; i <= parts.length; i++) allPaths.add(parts.slice(0, i).join('/'))
    }

    const sorted = [...allPaths].sort((a, b) => a.split('/').length - b.split('/').length)
    const insertChild = db.prepare(
      'INSERT INTO folders (name, parent_folder_id, path, root_folder_id, relative_path) VALUES (?, ?, ?, ?, ?)'
    )

    for (const relPath of sorted) {
      if (pathToId.has(relPath)) {
        reviveIfMissing(relPath)
        continue
      }
      const parts = relPath.split('/')
      const name = parts[parts.length - 1]
      const parentPath = parts.slice(0, -1).join('/')
      const parentId = pathToId.get(parentPath)
      if (parentId === undefined) {
        throw new Error(`ensureFolderTree: missing parent folder for "${relPath}"`)
      }
      const childId = Number(
        insertChild.run(name, parentId, join(root.path, relPath), rootId, relPath).lastInsertRowid
      )
      pathToId.set(relPath, childId)
      created++
    }
  })

  run()
  if (created > 0 || revived > 0) folderEvents.emit('changed')
  return pathToId
}

// missing = 0 only — a folder the watcher saw disappear (unlinkDir) drops
// out of the tree the renderer builds from this, same as a missing track
// already drops out of folder counts. The row itself survives (see
// markFolderMissing) so it revives in place if the directory comes back.
export function getFolderTree(rootId?: number): FolderRow[] {
  if (rootId !== undefined) {
    return db
      .prepare(
        'SELECT * FROM folders WHERE root_folder_id = ? AND missing = 0 ORDER BY parent_folder_id, name'
      )
      .all(rootId) as FolderRow[]
  }
  return db
    .prepare('SELECT * FROM folders WHERE missing = 0 ORDER BY parent_folder_id, name')
    .all() as FolderRow[]
}

// Direct (non-recursive) track counts per folder, tracks currently on disk
// only (missing = 0). The renderer rolls these up the tree itself — using
// folders:tree's parent pointers — to get a folder's recursive count,
// instead of this running once per folder card.
export function getFolderTrackCounts(): { folder_id: number; count: number }[] {
  return db
    .prepare(
      `SELECT folder_id, COUNT(*) as count FROM tracks
       WHERE missing = 0 AND folder_id IS NOT NULL
       GROUP BY folder_id`
    )
    .all() as { folder_id: number; count: number }[]
}

// Looks up a folder row by root + relative path without creating it —
// unlike ensureFolderTree/ensureFolderForDirectory, which always create.
// Used by the watcher's unlinkDir handler: a directory that's gone should
// never cause a folder row to be created.
export function getFolderIdByRelativePath(rootId: number, relativePath: string): number | null {
  const row = db
    .prepare('SELECT id FROM folders WHERE root_folder_id = ? AND relative_path = ?')
    .get(rootId, relativePath) as { id: number } | undefined
  return row?.id ?? null
}

// Marks one folder row missing (never deletes it — see the `missing` column
// comment near its ALTER) and, recursively, every track currently filed
// under it or any of its descendant folders. Safe to call once per
// unlinkDir event even for a whole deleted tree: chokidar emits unlinkDir
// for every directory it previously knew about, not just the top one, so
// each call's recursive UPDATE is redundant-but-idempotent with its
// siblings' rather than the only thing doing the work.
export function markFolderMissing(folderId: number): void {
  const run = db.transaction(() => {
    db.prepare('UPDATE folders SET missing = 1 WHERE id = ?').run(folderId)
    db.prepare(
      `UPDATE tracks SET missing = 1 WHERE folder_id IN (
         WITH RECURSIVE descendants(id) AS (
           SELECT id FROM folders WHERE id = ?
           UNION ALL
           SELECT f.id FROM folders f JOIN descendants d ON f.parent_folder_id = d.id
         )
         SELECT id FROM descendants
       )`
    ).run(folderId)
  })
  run()
  folderEvents.emit('changed')
}

export function getTracksByFolder(folderId: number, recursive: boolean): Track[] {
  if (!recursive) {
    return db
      .prepare('SELECT * FROM tracks WHERE folder_id = ? ORDER BY added_at DESC')
      .all(folderId) as Track[]
  }
  return db
    .prepare(
      `WITH RECURSIVE descendants(id) AS (
         SELECT id FROM folders WHERE id = ?
         UNION ALL
         SELECT f.id FROM folders f JOIN descendants d ON f.parent_folder_id = d.id
       )
       SELECT t.* FROM tracks t
       WHERE t.folder_id IN (SELECT id FROM descendants)
       ORDER BY t.added_at DESC`
    )
    .all(folderId) as Track[]
}

export function updateTrackFolderIds(
  entries: { trackId: number; folderId: number | null }[]
): void {
  if (entries.length === 0) return
  const stmt = db.prepare('UPDATE tracks SET folder_id = ? WHERE id = ?')
  db.transaction(() => {
    for (const { trackId, folderId } of entries) stmt.run(folderId ?? null, trackId)
  })()
}

const FOLDER_BACKFILL_SETTING_KEY = 'folder_id_backfill_v1'

// One-time pass, run once at startup after the schema migration: for every
// non-missing track with no folder_id yet, resolve which registered root (if
// any) it lives under, ensure that directory exists in `folders`, and set
// folder_id. Tracks under no registered root are left NULL for good — there's
// no root to resolve a relative path against. When roots are nested inside
// each other, the longest (most specific) root's path wins. Gated on
// app_settings so it only ever runs once — same pattern as
// migrateArtworkToContentAddressed.
export function backfillTrackFolderIds(): { updated: number; skipped: number } {
  if (getSetting(FOLDER_BACKFILL_SETTING_KEY) === 'done') return { updated: 0, skipped: 0 }

  const roots = (db.prepare('SELECT * FROM library_roots').all() as LibraryRoot[]).sort(
    (a, b) => b.path.length - a.path.length
  )
  const tracks = db
    .prepare('SELECT id, filepath FROM tracks WHERE missing = 0 AND folder_id IS NULL')
    .all() as { id: number; filepath: string }[]

  const claimed = new Set<number>()
  let updated = 0

  for (const root of roots) {
    const dirsForRoot = new Set<string>([''])
    const trackRelDirs = new Map<number, string>()

    for (const track of tracks) {
      if (claimed.has(track.id)) continue
      const rel = relative(root.path, dirname(track.filepath))
      const isUnder = rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
      if (!isUnder) continue
      trackRelDirs.set(track.id, rel)
      dirsForRoot.add(rel)
    }

    if (trackRelDirs.size === 0) continue

    const folderIdByRelPath = ensureFolderTree(root.id, [...dirsForRoot])
    const entries = [...trackRelDirs].map(([trackId, rel]) => ({
      trackId,
      folderId: folderIdByRelPath.get(rel) ?? null
    }))
    updateTrackFolderIds(entries)
    for (const trackId of trackRelDirs.keys()) claimed.add(trackId)
    updated += entries.length
  }

  const skipped = tracks.length - updated
  setSetting(FOLDER_BACKFILL_SETTING_KEY, 'done')
  console.log(
    `[folder backfill] done — ${updated} tracks assigned a folder_id, ${skipped} left NULL (no registered root)`
  )
  return { updated, skipped }
}

export function getUnanalyzedTracks(): unknown[] {
  return stmts.getUnanalyzedTracks.all()
}

export function setTrackArtworkHash(id: number, hash: string): RunResult {
  return stmts.setTrackArtworkHash.run({ id, artwork_hash: hash })
}

// Every hash currently referenced by a track — used by sweepOrphanedArtwork
// to decide which files under the artwork dir are still needed.
export function getArtworkHashesInUse(): Set<string> {
  const rows = stmts.getArtworkHashCounts.all() as { artwork_hash: string }[]
  return new Set(rows.map((r) => r.artwork_hash))
}

// Rows still on the legacy per-track artwork_path with no artwork_hash yet —
// the one-time migration's worklist.
export function getTracksWithLegacyArtwork(): { id: number; artwork_path: string }[] {
  return stmts.getTracksWithLegacyArtwork.all() as { id: number; artwork_path: string }[]
}

export function getTagsByField(field: string): Tag[] {
  return stmts.getTagsByField.all(field) as Tag[]
}

export function parseCommentToCandidates(comment: string): string[] {
  return comment
    .split(' ')
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
    .filter((t) => t.length <= 30)
    .filter((t) => !/^\d{4}$/.test(t))
}

export function checkCandidates(candidates: string[], field = 'label'): TagCandidate[] {
  return candidates.map((value) => {
    const normalized = normalizeTagValue(field, value)
    const existing = stmts.findTag.get(field, normalized) as { id: number } | undefined
    if (!existing) {
      return { value: normalized, exists: false, trackCount: 0 }
    }
    const rows = stmts.getAllTags.all() as { id: number; track_count: number }[]
    const row = rows.find((t) => t.id === existing.id)
    return {
      value: normalized,
      exists: true,
      trackCount: row?.track_count ?? 0
    }
  })
}

export function savePendingImport(
  trackId: number,
  rawComment: string,
  candidates: string[]
): RunResult {
  return stmts.insertPending.run({
    track_id: trackId,
    raw_comment: rawComment,
    candidates: JSON.stringify(candidates)
  })
}

export function getPendingImports(): PendingImport[] {
  const rows = stmts.getPending.all() as {
    id: number
    track_id: number
    raw_comment: string
    candidates: string
    created_at: number
  }[]
  return rows.map((row) => ({
    ...row,
    candidates: JSON.parse(row.candidates) as string[]
  }))
}

export function confirmPendingImport(
  pendingId: number,
  trackId: number,
  approvedTags: string[],
  field = 'label'
): void {
  const apply = db.transaction(() => {
    for (const value of approvedTags) {
      const tagId = findOrCreateTag(field, value)
      applyTag(trackId, tagId)
    }
    stmts.deletePending.run(pendingId)
  })
  return apply()
}

// ─── Crate functions ──────────────────────────────────────

export function insertCrate(name: string, color = '#7f77dd'): RunResult {
  return stmts.insertCrate.run({ name, color })
}

export function getAllCrates(): Crate[] {
  return stmts.getAllCrates.all() as Crate[]
}

export function addTrackToCrate(crateId: number, trackId: number): RunResult {
  return stmts.addTrackToCrate.run({ crate_id: crateId, track_id: trackId })
}

export function removeTrackFromCrate(crateId: number, trackId: number): RunResult {
  return stmts.removeTrackFromCrate.run({ crate_id: crateId, track_id: trackId })
}

export function getCrateTracks(crateId: number): Track[] {
  return stmts.getCrateTracks.all(crateId) as Track[]
}

// ─── Board functions ──────────────────────────────────────

export function getAllBoards(): Board[] {
  return stmts.getAllBoards.all() as Board[]
}

export function getTracksByColumn(column: string): Track[] {
  return stmts.getTracksByColumn.all(column) as Track[]
}

// ─── Move functions ──────────────────────────────────────

// Resolves the folder a directory belongs to, creating that folder row via
// ensureFolderTree if it's new — the longest (most specific) matching
// registered root wins when roots are nested. Returns null when the
// directory isn't under any registered root. Used both by
// resolveFolderIdForPath (below) and directly by fs:create-folder, so a
// freshly mkdir'd directory becomes visible to FolderView the same way a
// moved track's destination does, instead of staying invisible until a
// full re-import walks it.
export function ensureFolderForDirectory(dirPath: string): number | null {
  const roots = (db.prepare('SELECT * FROM library_roots').all() as LibraryRoot[]).sort(
    (a, b) => b.path.length - a.path.length
  )
  for (const root of roots) {
    if (!isPathUnder(dirPath, root.path)) continue
    const relDir = relative(root.path, dirPath)
    return ensureFolderTree(root.id, [relDir]).get(relDir) ?? null
  }
  return null
}

// Resolves the folder a filepath's directory belongs to — see
// ensureFolderForDirectory.
function resolveFolderIdForPath(filepath: string): number | null {
  return ensureFolderForDirectory(dirname(filepath))
}

// folder_id mirrors disk location in v3, so a move/rename recomputes it
// against the file's new path — same idempotent ensureFolderTree used by
// import, just for one directory. Also clears `missing`: a track whose
// filepath is being pointed at a location just confirmed to exist can't
// simultaneously be missing — this matters now that a directory rename can
// race the watcher's own missing-marking (markFolderMissing) against this
// same track via the file-level move heuristic (findMoveCandidate in
// libraryWatcher.ts); whichever lands second must not leave a track stuck
// missing with an otherwise-correct, live filepath.
export function updateTrackFilepath(oldPath: string, newPath: string): RunResult {
  return stmts.updateFilepath.run({
    oldPath,
    newPath,
    filename: basename(newPath),
    folder_id: resolveFolderIdForPath(newPath)
  })
}

// ─── Identity / relink reconciliation ─────────────────────
// A track goes missing (unlinkDir sweeping its folder, or the per-file
// unlink→no-matching-add-within-2s path) without necessarily being gone for
// good — the file may reappear under a new name, a new parent directory, or
// just later than the watcher's own move-detection window. Reconcile is
// the batch-shaped answer: instead of blindly inserting every newly-seen
// file as a new track, check it against the missing pool first.

export interface MissingTrackCandidate {
  id: number
  filepath: string
  filename: string | null
  client_uuid: string | null
  file_size_bytes: number | null
  duration_sec: number | null
  partial_hash: string | null
}

// Scoped to one root when the caller has one (import, live add — both
// always do) — a missing track from a different, unrelated root is never a
// plausible match, and scoping keeps this cheap on a large library. Falls
// back to every missing track when rootId is omitted (importSingleFile has
// no root to scope by — a manually picked or dropped single file).
export function getMissingTracks(rootId?: number): MissingTrackCandidate[] {
  if (rootId === undefined) {
    return db
      .prepare(
        `SELECT id, filepath, filename, client_uuid, file_size_bytes, duration_sec, partial_hash
         FROM tracks WHERE missing = 1`
      )
      .all() as MissingTrackCandidate[]
  }
  return db
    .prepare(
      `SELECT t.id, t.filepath, t.filename, t.client_uuid, t.file_size_bytes, t.duration_sec,
              t.partial_hash
       FROM tracks t
       JOIN folders f ON f.id = t.folder_id
       WHERE t.missing = 1 AND f.root_folder_id = ?`
    )
    .all(rootId) as MissingTrackCandidate[]
}

// A relink is never the ON CONFLICT(filepath) upsert path — the new
// filepath was never seen before, so that constraint can't fire for it.
// Deliberately narrow: only what identifies WHERE the file is now. Tags,
// board_id, energy, analyzed_at, artwork_hash all survive untouched, which
// is the entire point versus letting it insert as a duplicate row.
export function relinkTrack(trackId: number, newPath: string): RunResult {
  return db
    .prepare(
      `UPDATE tracks SET
         filepath     = @newPath,
         filename     = @filename,
         folder_id    = @folder_id,
         missing      = 0,
         last_seen_at = datetime('now'),
         updated_at   = datetime('now')
       WHERE id = @id`
    )
    .run({
      id: trackId,
      newPath,
      filename: basename(newPath),
      folder_id: resolveFolderIdForPath(newPath)
    })
}

export function insertPendingChange(data: {
  root_id: number
  change_type: string
  old_path: string | null
  new_path: string | null
  track_id: number | null
}): RunResult {
  return stmts.insertPendingChange.run(data)
}

export function getPendingChanges(): unknown[] {
  return stmts.getPendingChanges.all()
}

export function acceptPendingChange(id: number): RunResult {
  return stmts.acceptPendingChange.run(id)
}

export function ignorePendingChange(id: number): RunResult {
  return stmts.ignorePendingChange.run(id)
}

// ─── Settings functions ───────────────────────────────────

export function getSetting(key: string): string | null {
  const row = stmts.getSetting.get(key) as { value: string } | undefined
  return row?.value ?? null
}

export function setSetting(key: string, value: string): RunResult {
  return stmts.setSetting.run({ key, value })
}

export function getArtworkPath(trackId: number): string | null {
  const row = db.prepare('SELECT artwork_path FROM tracks WHERE id = ?').get(trackId) as
    { artwork_path: string | null } | undefined
  return row?.artwork_path ?? null
}
