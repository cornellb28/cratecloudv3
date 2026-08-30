import Database, { RunResult } from 'better-sqlite3'
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
      duration_sec, duration_str, file_size_mb, format,
      artwork_path, analyzed_at
     )
      VALUES (
       @filepath, @filename, @title, @artist, @album, @genre,
       @year, @remixer, @composer, @comment, @label, @grouping,
       @bpm, @key_camelot, @key_full, @camelot, @openkey,
       @duration_sec, @duration_str, @file_size_mb, @format,
       @artwork_path, @analyzed_at
      )
       ON CONFLICT(filepath) DO UPDATE SET
         title        = excluded.title,
         artist       = excluded.artist,
         album        = excluded.album,
         genre        = excluded.genre,
         bpm          = excluded.bpm,
         key_camelot  = excluded.key_camelot,
         analyzed_at  = excluded.analyzed_at,
         updated_at   = datetime('now'),
         missing      = 0,
         last_seen_at = datetime('now')
    `),
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
      bpm             = @bpm,
      key_camelot     = @key_camelot,
      energy          = @energy,
      comment         = @comment,
      updated_at      = datetime('now'),
      needs_sync      = @needs_sync,
      pending_changes = @pending_changes
    WHERE id = @id
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

  updateBoardColumn: db.prepare(`
    UPDATE tracks SET
      board_column = @board_column,
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

  // ── Boards ──────────────────────────────────────────

  getAllBoards: db.prepare(`
    SELECT * FROM boards ORDER BY position ASC
  `),

  getTracksByColumn: db.prepare(`
    SELECT * FROM tracks
    WHERE board_column = ?
    ORDER BY added_at DESC
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
    file_size_mb: track.file_size_mb ?? null,
    format: track.format ?? null,
    artwork_path: track.artwork_path ?? null,
    analyzed_at: track.analyzed_at ?? null
  }
  const result = stmts.insertTrack.run(safe)

  // ON CONFLICT returns lastInsertRowid 0 — fetch the real id
  if (result.lastInsertRowid === 0n || result.lastInsertRowid === 0) {
    const existing = stmts.getTrackByFilepath.get(safe.filepath) as { id: number } | undefined
    return { lastInsertRowid: existing?.id ?? 0 }
  }

  return result
}

export function getAllTracks(): Track[] {
  return stmts.getAllTracks.all() as Track[]
}

export function getTrackById(id: number): Track | undefined {
  return stmts.getTrackById.get(id) as Track | undefined
}

export function getTrackByFilepath(filepath: string): Track | undefined {
  return stmts.getTrackByFilepath.get(filepath) as Track | undefined
}

export function updateTrackMeta(data: Record<string, unknown>): RunResult {
  return stmts.updateTrackMeta.run(data)
}

export function markTrackMissing(filepath: string): RunResult {
  return stmts.markMissing.run(filepath)
}

export function markTrackFound(filepath: string): RunResult {
  return stmts.markFound.run(filepath)
}

export function getTracksNeedingSync(): Track[] {
  return stmts.getNeedsSync.all() as Track[]
}

export function clearTrackSync(id: number): RunResult {
  return stmts.clearSync.run(id)
}

export function updateBoardColumn(id: number, column: string): RunResult {
  return stmts.updateBoardColumn.run({ id, board_column: column })
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

export function getTagTracks(tagId: number): Track[] {
  return stmts.getTagTracks.all(tagId) as Track[]
}

export function getAllTags(): Tag[] {
  return stmts.getAllTags.all() as Tag[]
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

// ─── Settings functions ───────────────────────────────────

export function getSetting(key: string): string | null {
  const row = stmts.getSetting.get(key) as { value: string } | undefined
  return row?.value ?? null
}

export function setSetting(key: string, value: string): RunResult {
  return stmts.setSetting.run({ key, value })
}
