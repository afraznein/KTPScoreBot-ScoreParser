/*************** UTILITIES ***************/

/*************** SPREADSHEET ***************/

/**
 * Get sheet by name from active spreadsheet
 * @param {string} name - Sheet name
 * @returns {Sheet} Google Sheets object
 */
function getSheetByName(name) {
  return SpreadsheetApp.getActive().getSheetByName(name);
}

/**
 * Ensure sheet exists, create if missing with optional header
 * @param {string} name - Sheet name
 * @param {Array<string>} header - Optional header row
 * @returns {Sheet} Google Sheets object
 */
function ensureSheet(name, header) {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    if (name.startsWith('_')) sh.hideSheet();
    if (header && header.length) {
      sh.appendRow(header);
      sh.setFrozenRows(1);
    }
  }
  return sh;
}

/*************** TIME AND COOLDOWNS***************/
/**
 * Coerce value to Date object
 * @param {*} val - Value to coerce (Date, string, or other)
 * @returns {Date|null} Date object or null if invalid
 */
function coerceDate(val) {
  if (!val) return null;
  if (Object.prototype.toString.call(val) === '[object Date]') return val;
  const dt = new Date(String(val));
  return isNaN(dt.getTime()) ? null : dt;
}

/**
 * Format current timestamp in DEFAULT_TZ
 * @returns {string} Formatted timestamp (yyyy-MM-dd HH:mm:ss)
 */
function formatTimestamp(){ return Utilities.formatDate(new Date(), DEFAULT_TZ, 'yyyy-MM-dd HH:mm:ss'); }

/**
 * Extract timestamp in milliseconds from Discord message
 * Prefers edited_timestamp over timestamp
 * @param {Object} m - Discord message object
 * @returns {number} Timestamp in milliseconds, or 0 if missing
 */
function getTimestampMs(m) {
  var t = (m && (m.edited_timestamp || m.timestamp)) || 0;
  var n = Date.parse(t);
  return isNaN(n) ? 0 : n;
}

/**
 * Get current time in milliseconds
 * @returns {number} Current timestamp
 */
function getNowMs(){ return Date.now(); }

/**
 * Generate random jitter delay in milliseconds
 * @returns {number} Random ms between FETCH_JITTER_MS_MIN and FETCH_JITTER_MS_MAX
 */
function getJitterMs() {
  return Math.floor(Math.random() * (FETCH_JITTER_MS_MAX - FETCH_JITTER_MS_MIN + 1)) + FETCH_JITTER_MS_MIN;
}

/**
 * Check if relay is in quota cooldown period
 * @returns {boolean} True if in cooldown
 */
function isQuotaCooldown() {
  var props = PropertiesService.getScriptProperties();
  var until = Number(props.getProperty('QUOTA_COOLDOWN_UNTIL') || 0);
  return getNowMs() < until;
}

/**
 * Start quota cooldown period (skip relay calls)
 * @param {number} minutes - Duration of cooldown in minutes
 */
function startQuotaCooldown(minutes) {
  var props = PropertiesService.getScriptProperties();
  var until = getNowMs() + (minutes * 60 * 1000);
  props.setProperty('QUOTA_COOLDOWN_UNTIL', String(until));
}

function bumpPollCounter() {
  var props = PropertiesService.getScriptProperties();
  var n = Number(props.getProperty('POLL_COUNTER') || 0) + 1;
  props.setProperty('POLL_COUNTER', String(n));
  return n;
}

function shouldFetchRecentPage() {
  var n = bumpPollCounter();
  return (n % RECENT_PAGE_EVERY_N) === 0; // every Nth poll
}

/*************** CURSORS***************/
// Use your consolidated helpers if present; otherwise fall back to a simple LAST_ID_* key.
function getScoresCursorSafe() {
  try {
    if (typeof getCursor === 'function') return String(getCursor(SCORES_CHANNEL_ID) || '');
  } catch(_) {}
  const props = PropertiesService.getScriptProperties();
  // Prefer canonical LAST_ID_<channel>, but also check legacy SCORES_LAST_
  return props.getProperty('LAST_ID_' + SCORES_CHANNEL_ID) ||
         props.getProperty('SCORES_LAST_' + SCORES_CHANNEL_ID) || '';
}

function setScoresCursorSafe(id) {
  if (!id) return clearScoresCursorSafe();
  try {
    if (typeof setCursor === 'function') return setCursor(SCORES_CHANNEL_ID, String(id));
  } catch(_) {}
  const props = PropertiesService.getScriptProperties();
  props.setProperty('LAST_ID_' + SCORES_CHANNEL_ID, String(id));
  // clean legacy key to avoid confusion
  props.deleteProperty('SCORES_LAST_' + SCORES_CHANNEL_ID);
}

function clearScoresCursorSafe() {
  try {
    if (typeof ADMIN_ResetCursor === 'function') {
      ADMIN_ResetCursor(SCORES_CHANNEL_ID); // your admin helper, if present
      return;
    }
  } catch(_) {}
  const props = PropertiesService.getScriptProperties();
  props.deleteProperty('LAST_ID_' + SCORES_CHANNEL_ID);
  props.deleteProperty('SCORES_LAST_' + SCORES_CHANNEL_ID);
}

function getCursorKey(channelId) {
  var id = String(channelId || '').trim();
  var base = CURSOR_PREFIX + id;
  return CURSOR_NAMESPACE ? (CURSOR_NAMESPACE + base) : base;
}

function getLegacyCursorKey(channelId) {
  var id = String(channelId || '').trim();
  var base = LEGACY_CURSOR_PREFIX + id;
  return CURSOR_NAMESPACE ? (CURSOR_NAMESPACE + base) : base;
}

// Read cursor with auto-migration from legacy keys
function getCursor(channelId) {
  var props = PropertiesService.getScriptProperties();
  var key   = getCursorKey(channelId);
  var val   = props.getProperty(key);
  if (val) return String(val);

  // try legacy key(s)
  var legacyKey = getLegacyCursorKey(channelId);
  var legacyVal = props.getProperty(legacyKey);
  if (legacyVal) {
    // migrate: copy to canonical and delete legacy
    props.setProperty(key, String(legacyVal));
    props.deleteProperty(legacyKey);
    log('INFO','Migrated legacy cursor', { from: legacyKey, to: key, value: legacyVal });
    return String(legacyVal);
  }

  // also support truly old format LAST_ID_<id> without namespace when namespace now enabled
  var rawFallback = CURSOR_PREFIX + channelId;
  var rawVal = props.getProperty(rawFallback);
  if (rawVal) {
    props.setProperty(key, String(rawVal));
    props.deleteProperty(rawFallback);
    log('INFO','Migrated raw cursor', { from: rawFallback, to: key, value: rawVal });
    return String(rawVal);
  }
  return '';
}

function setCursor(channelId, snowflake) {
  var props = PropertiesService.getScriptProperties();
  var key = getCursorKey(channelId);
  props.setProperty(key, String(snowflake || ''));
}

function listAllCursors() {
  var props = PropertiesService.getScriptProperties();
  var all = props.getProperties();
  var rows = [];
  for (var k in all) {
    if (!Object.prototype.hasOwnProperty.call(all,k)) continue;
    if (k.includes(CURSOR_PREFIX) || k.includes(LEGACY_CURSOR_PREFIX)) {
      rows.push([k, all[k]]);
    }
  }
  rows.sort(function(a,b){ return a[0] < b[0] ? -1 : 1; });
  return rows;
}

function ADMIN_ShowCursors() {
  var rows = listAllCursors();
  log('INFO','Script cursors', { count: rows.length, rows: rows });
  return rows;
}

function ADMIN_ResetCursor(channelId) {
  var props = PropertiesService.getScriptProperties();
  props.deleteProperty(getCursorKey(channelId));
  props.deleteProperty(getLegacyCursorKey(channelId));
  // also nuke un-namespaced variants, just in case
  props.deleteProperty(CURSOR_PREFIX + channelId);
  props.deleteProperty(LEGACY_CURSOR_PREFIX + channelId);
  log('INFO','Cursor(s) cleared for channel', { channelId: String(channelId) });
}


/*************** SAFE VALUES ***************/
// Safe batch writer: no-ops if rows is empty
function safeSetValues(sheet, startRow, startCol, rows, labelOpt) {
  var label = String(labelOpt || 'batch');
  if (!rows || !rows.length) {
    log('INFO', 'safeSetValues no-op (empty rows)', { label: label, sheet: sheet.getName() });
    return 0;
  }
  var width = (rows[0] && rows[0].length) || 0;
  if (!width) {
    log('INFO', 'safeSetValues no-op (zero width)', { label: label, sheet: sheet.getName() });
    return 0;
  }
  sheet.getRange(startRow, startCol, rows.length, width).setValues(rows);
  return rows.length;
}

/*************** LOGGING ***************/
function log(level, msg, data) {
  try {
    const ss = SpreadsheetApp.getActive();
    let sh = ss.getSheetByName('_DiscordScoresLog');
    if (!sh) {
      sh = ss.insertSheet('_DiscordScoresLog');
      sh.hideSheet();
      sh.appendRow(['Time','Level','Message','Data']);
      sh.setFrozenRows(1);
    }
    sh.appendRow([new Date(), level, msg, data ? JSON.stringify(data).slice(0,50000) : '']);
  } catch (_){}
}

function makeCounters() {
  return {
    seen: 0,               // messages iterated this run
    parsedOK: 0,           // messages that parsed into a score object
    applied: 0,            // wrote new values (NEW or EDIT)
    edits: 0,              // subset: edits (write.prev && !REPARSE_FORCE)
    reparseApplied: 0,     // reparse changed cells
    reparseNoChange: 0,    // reparse skipped because cells already matched
    skipSameHash: 0,       // identical content already handled
    placeholders: 0,       // skipped due to placeholder teams
    unknownTeams: 0,       // skipped due to unknown team(s)
    targetMissing: 0,      // couldn’t locate division/row
    writeBlocked: 0,       // protected range or guard prevented write
    banners: 0,            // skipped weekly banner
    unparsable: 0          // parseScoreLine_ returned null
  };
}

function postRunSummary(whereChannelId, ctx, cnt) {
  // Build a compact, readable line for Discord
  const secs = Math.round((ctx.durationMs || 0)/1000);
  const head = (ctx.kind === 'pollFromId')
    ? `🧾 Poll summary (fromId ${ctx.startId}${ctx.includeStart ? ' incl' : ''})`
    : `🧾 Poll summary`;

  const cursorBit = (ctx.kind === 'pollScores' && ctx.cursorBefore)
    ? ` • cursor ${ctx.cursorBefore} → ${ctx.cursorAfter || ctx.cursorBefore}`
    : '';

  const windowBit = (ctx.kind === 'pollFromId' && ctx.rangeMin && ctx.rangeMax)
    ? ` • id ${ctx.rangeMin} → ${ctx.rangeMax}`
    : '';

  const parts = [
    `seen ${cnt.seen}`,
    `parsed ${cnt.parsedOK}`,
    `applied ${cnt.applied}`,
    (cnt.edits ? `edits ${cnt.edits}` : ''),
    (cnt.reparseApplied ? `♻️✅ ${cnt.reparseApplied}` : ''),
    (cnt.reparseNoChange ? `♻️ ${cnt.reparseNoChange}` : ''),
    (cnt.skipSameHash ? `same ${cnt.skipSameHash}` : ''),
    (cnt.placeholders ? `placeholders ${cnt.placeholders}` : ''),
    (cnt.unknownTeams ? `unknown ${cnt.unknownTeams}` : ''),
    (cnt.targetMissing ? `no-target ${cnt.targetMissing}` : ''),
    (cnt.writeBlocked ? `blocked ${cnt.writeBlocked}` : ''),
    (cnt.banners ? `banners ${cnt.banners}` : ''),
    (cnt.unparsable ? `unparsable ${cnt.unparsable}` : '')
  ].filter(Boolean);

  const line = `${head}${cursorBit}${windowBit} • ${parts.join(' • ')} • ${secs}s`;

  // Log to Google Sheets logs
  log('INFO','PollSummary', { ctx, cnt, line });
}


/*************** TEXT MANIPULATION AND COMPARISON ***************/
/**
 * Strip Discord emojis from text (custom, shortcodes, unicode)
 * @param {string} text - Input text with emojis
 * @param {Object} opts - Options: { collapse: boolean }
 * @returns {string} Text with emojis removed
 */
function stripEmojis(text, opts) {
  if (!text) return '';
  let s = String(text);
  s = s.replace(/<a?:[A-Za-z0-9_]+:\d+>/g, '');                    // <:name:id> / <a:name:id>
  s = s.replace(/(^|\s):[A-Za-z0-9_+-]+:(?=\s|$)/g, '$1');         // :shortcode:
  s = s.replace(/[\u{1F1E6}-\u{1F1FF}\u{1F300}-\u{1FAD6}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '');
  if (opts && opts.collapse) {
    s = s.replace(/[ \t\f\v]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
  }
  return s;
}

/**
 * Sanitize team name token: strip emojis, remove invisible spaces, uppercase
 * @param {string} raw - Raw team name from Discord
 * @returns {string} Sanitized UPPERCASE team token
 */
function sanitizeTeamToken(raw) {
  if (!raw) return '';
  let t = stripEmojis(String(raw), { collapse:false });
  t = t.replace(/[\u00A0\u1680\u180E\u2000-\u200A\u202F\u205F\u3000\u200B-\u200D\uFEFF]/g, ' ');
  t = t.replace(/^\s+|\s+$/g, ''); // both ends
  return t.toUpperCase();
}

/**
 * Normalize map token to canonical dod_* format using aliases
 * @param {string} raw - Raw map token (may include or omit dod_ prefix)
 * @returns {string} Canonical map name (e.g., "dod_railyard_b6") or empty string
 */
function normalizeMapToken(raw) {
  if (!raw) return '';
  const token = String(raw).trim().toLowerCase().replace(/^dod_/, ''); // accept dod_ optional
  const aliases = buildCanonMapAliases();

  // Try alias table with/without dod_
  const direct = aliases[token] || aliases['dod_' + token];
  if (direct) return direct;

  // Reparse/debug fallback (optional)
  if (ALLOW_UNKNOWN_DOD_MAPS) {
    const guess = token.startsWith('dod_') ? token : ('dod_' + token);
    if (DOD_MAP_PATTERN.test(guess)) return guess;
  }
  return '';
}

/**
 * Normalize team name: handle aliases, "THE" prefix, placeholders
 * @param {string} raw - Raw team name from Discord
 * @returns {string} Canonical UPPERCASE team name, 'PLACEHOLDER', or 'AMBIG_ALIAS:...'
 */
function normalizeTeamName(raw) {
  let cleanedUpper = sanitizeTeamToken(raw).toUpperCase();
  if (!cleanedUpper) return '';

  // Treat placeholder teams as special token (skipped later)
  if (isPlaceholderTeamAnyDiv(cleanedUpper)) return PLACEHOLDER_TOKEN;

  // Accept "THE WICKEDS" as "WICKEDS"
  if (cleanedUpper.startsWith('THE ')) {
    const noThe = cleanedUpper.replace(/^THE\s+/, '');
    cleanedUpper = noThe || cleanedUpper;
  }

  // Canonical exact match?
  const canon = getCanonicalTeamMap();
  if (canon[cleanedUpper]) return cleanedUpper;

  // Alias lookup
  const aliases = loadAliases();
  const ali = aliases[cleanedUpper];
  if (ali && ali.length === 1) return ali[0];
  if (ali && ali.length > 1)   return AMBIGUOUS_ALIAS_PREFIX + ':' + cleanedUpper;

  return cleanedUpper; // fallback: validated later
}

function isPlaceholderTeamAnyDiv(teamUpper) {
  // Matches: "GOLD A", "SILVER Z", "BRONZE I" — any case in input, already uppercased here.
  return /^\s*(BRONZE|SILVER|GOLD)\s+[A-Z]\s*$/.test(String(teamUpper || '').toUpperCase());
}

function isPlaceholderTeamForDiv(teamUpper, divisionUpper) {
  // Use when you know the division (e.g., inside applyScoresToRow_)
  const d = String(divisionUpper || '').toUpperCase();
  const t = String(teamUpper || '').toUpperCase();
  return new RegExp('^\\s*' + d + '\\s+[A-Z]\\s*$').test(t);
}

function compareSnowflakes(a, b) {
  const A = BigInt(String(a));
  const B = BigInt(String(b));
  return A < B ? -1 : (A > B ? 1 : 0);
}

function maxSnowflake(a, b) {
  if (!a) return String(b || '');
  if (!b) return String(a || '');
  return compareSnowflakes(a, b) < 0 ? String(b) : String(a);
}

/*************** HASHING AND CACHING ***************/
function computeContentHash(content) {
  return Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(
      Utilities.DigestAlgorithm.SHA_256,
      String(content || '')
    ).map(function(b){ return String.fromCharCode(b); }).join('')
  );
}

let TEAM_CANON_CACHE = null;

function getCanonicalTeamMap() {
  if (TEAM_CANON_CACHE) return TEAM_CANON_CACHE;
  const map = {};
  for (const sheetName of DIVISION_SHEETS) {
    const sh = getSheetByName(sheetName);
    if (!sh) continue;
    const vals = sh.getRange(TEAM_CANON_RANGE).getValues().flat();
    for (const v of vals) {
      const name = String(v || '').trim();
      if (!name) continue;
      map[name.toUpperCase()] = name.toUpperCase();
    }
  }
  TEAM_CANON_CACHE = map;
  return map;
}

// ---- Division-first canonical maps -----------------------------------------
let DIV_CANON_MAPS = null; // Set<string> lowercased "dod_*" from BRONZE/SILVER/GOLD col A

function loadDivisionCanonicalMaps() {
  if (DIV_CANON_MAPS) return DIV_CANON_MAPS;

  const ss = SpreadsheetApp.getActive();
  const divs = (typeof DIVISION_SHEETS !== 'undefined' && DIVISION_SHEETS.length)
    ? DIVISION_SHEETS : ['BRONZE','SILVER','GOLD'];

  const out = new Set();

  for (const d of divs) {
    const sh = ss.getSheetByName(d);
    if (!sh) continue;
    const last = sh.getLastRow();
    if (last < 1) continue;

    // Read column A broadly and accept any cell that looks like a map token.
    // This is robust to different week starting rows (A28, A39, A50, …).
    const vals = sh.getRange(1, 1, last, 1).getValues().flat();
    for (let raw of vals) {
      raw = String(raw || '').trim().toLowerCase();
      if (!raw) continue;
      let m = raw.startsWith('dod_') ? raw : ('dod_' + raw);
      if (/^dod_[a-z0-9_]+$/.test(m)) out.add(m);
    }
  }

  DIV_CANON_MAPS = out;
  return out;
}

let TEAM_ALIAS_CACHE = null;

function loadAliases() {
  if (TEAM_ALIAS_CACHE) return TEAM_ALIAS_CACHE;

  const mapMulti = {}; // ALIAS (UPPER) -> Set of CANON (UPPER)
  const sh = SpreadsheetApp.getActive().getSheetByName('_Aliases');

  if (!sh) { TEAM_ALIAS_CACHE = {}; return TEAM_ALIAS_CACHE; }

  const lastRow = sh.getLastRow();
  const lastCol = sh.getLastColumn();
  if (lastRow < 2) { TEAM_ALIAS_CACHE = {}; return TEAM_ALIAS_CACHE; }

  const width = Math.min(3, lastCol); // alias | canonical | scope (scope optional)
  const numRows = lastRow - 1;
  if (numRows <= 0) { TEAM_ALIAS_CACHE = {}; return TEAM_ALIAS_CACHE; }

  const rows = sh.getRange(2, 1, numRows, width).getValues();
  for (const [alias, canon/*, scope*/] of rows) {
    const a = String(alias || '').trim().toUpperCase();
    const c = String(canon || '').trim().toUpperCase();
    if (!a || !c) continue;
    if (!mapMulti[a]) mapMulti[a] = new Set();
    mapMulti[a].add(c);
  }

  const out = {};
  for (const [a, set] of Object.entries(mapMulti)) {
    out[a] = Array.from(set);
  }
  TEAM_ALIAS_CACHE = out;
  return out;
}

let MAP_ALIAS_CACHE = null;

function loadMapAliases() {
  if (MAP_ALIAS_CACHE) return MAP_ALIAS_CACHE;

  const out = {}; // alias(lower) -> dod_* (lower)
  const sh = SpreadsheetApp.getActive().getSheetByName('_MapAliases');

  // If the sheet is missing or has only a header (or fewer), return empty cache
  if (!sh) { MAP_ALIAS_CACHE = out; return out; }

  const lastRow = sh.getLastRow();
  const lastCol = sh.getLastColumn();
  if (lastRow < 2) { MAP_ALIAS_CACHE = out; return out; } // nothing to read

  const width = Math.min(2, lastCol); // tolerate extra columns
  const numRows = lastRow - 1;
  if (numRows <= 0) { MAP_ALIAS_CACHE = out; return out; }

  const rows = sh.getRange(2, 1, numRows, width).getValues();
  for (const [alias, canon] of rows) {
    let a = String(alias || '').trim().toLowerCase();
    let c = String(canon || '').trim().toLowerCase();
    if (!a || !c) continue;
    if (!c.startsWith('dod_')) c = 'dod_' + c;
    out[a] = c;
  }

  MAP_ALIAS_CACHE = out;
  return out;
}

function isCanonTeam(upperName) {
  const canon = getCanonicalTeamMap();
  return !!canon[String(upperName || '')];
}

let CANON_MAPS = null;

function loadCanonicalMaps() {
  if (CANON_MAPS) return CANON_MAPS;
  const sh = SpreadsheetApp.getActive().getSheetByName(GENERAL_SHEET);
  if (!sh) return (CANON_MAPS = new Set());
  const vals = sh.getRange(GENERAL_MAPS_RANGE).getValues().flat();
  const out = new Set();
  for (let raw of vals) {
    if (!raw) continue;
    let m = String(raw).trim().toLowerCase();
    if (!m.startsWith('dod_')) m = 'dod_' + m;
    out.add(m);
  }
  return (CANON_MAPS = out);
}

let CANON_MAP_ALIASES = null;
/**
 * Build alias -> canonical table with priority:
 *   1) Division sheets (BRONZE/SILVER/GOLD col A)    <-- primary source
 *   2) _MapAliases (admin overrides)                  <-- overrides WIN
 *   3) General!J2:J29 (fallback only)                 <-- only if missing
 *
 * Aliases produced:
 *   - exact "dod_*"
 *   - strip "dod_" (e.g., "lennon2")
 *   - if suffix exists (e.g., "_b6"), also "base" (e.g., "lennon2")
 * Preference rule: if both base (dod_lennon2) and suffixed (dod_lennon2_b1)
 * exist, we prefer the base as the canonical.
 */
function buildCanonMapAliases() {
  if (CANON_MAP_ALIASES) return CANON_MAP_ALIASES;

  const table = {}; // alias(lower) -> canonical(lower)

  function addAlias(a, c) {
    if (!a || !c) return;
    a = a.toLowerCase(); c = c.toLowerCase();
    if (!c.startsWith('dod_')) c = 'dod_' + c;
    // don't overwrite once set, except when we explicitly override later
    if (!table[a]) table[a] = c;
  }

  // 1) Division-derived canonicals (primary)
  const divSet = loadDivisionCanonicalMaps();
  const divCanon = Array.from(divSet);

  // Prefer base over suffixed: if a base and a suffixed with same base exist, keep base canonical
  const preferBase = new Set(divCanon.map(c => c.replace(/^dod_/, '').split('_')[0]));
  for (const c of divCanon) {
    addAlias(c, c); // exact
    const noDod = c.replace(/^dod_/, '');       // "lennon2" or "railyard_b6"
    addAlias(noDod, c);
    const base = noDod.split('_')[0];          // "lennon2" or "railyard"
    addAlias(base, c);
  }

  // 2) Admin overrides (_MapAliases) — these WIN
  const admin = loadMapAliases(); // alias -> canonical (may be empty)
  for (const [a, c] of Object.entries(admin)) {
    const canon = c.toLowerCase().startsWith('dod_') ? c.toLowerCase() : 'dod_' + c.toLowerCase();
    table[a.toLowerCase()] = canon; // explicit override
  }

  // 3) Fallback to General list only for missing aliases
  const gen = (function loadCanonicalMaps() {
    if (typeof CANON_MAPS !== 'undefined' && CANON_MAPS) return CANON_MAPS;
    const sh = SpreadsheetApp.getActive().getSheetByName('General');
    const out = new Set();
    if (sh) {
      const vals = sh.getRange('J2:J29').getValues().flat();
      for (let raw of vals) {
        if (!raw) continue;
        let m = String(raw).trim().toLowerCase();
        if (!m.startsWith('dod_')) m = 'dod_' + m;
        if (/^dod_[a-z0-9_]+$/.test(m)) out.add(m);
      }
    }
    CANON_MAPS = out;
    return out;
  })();

  for (const c of Array.from(gen)) {
    const noDod = c.replace(/^dod_/, '');
    const base = noDod.split('_')[0];
    if (!table[c])     addAlias(c, c);
    if (!table[noDod]) addAlias(noDod, c);
    if (!table[base])  addAlias(base, c);
  }

  CANON_MAP_ALIASES = table;
  return table;
}

/*************** RECEIPTS HELPERS ***************/
// Receipt cache for performance optimization
let RECEIPT_CACHE = null;
let RECEIPT_MSGID_CACHE = null;

function getReceiptsSheet() {
  const sh = ensureSheet(RECEIPTS_SHEET, [
    'Time','Division','Row','Map','TeamC','TeamG','ScoreC','ScoreG','MsgId','AuthorId','Note','ContentHash','EditedTS'
  ]);
  // If an older sheet exists with fewer columns, do nothing; appendRow can still write extra cols.
  return sh;
}

function getReceiptKey(division, row) { return `${division}|${row}`; }

/**
 * Load receipt cache from sheet (optimizes repeated lookups)
 * @returns {Map<string, Object>} Map of receipt key to receipt data
 */
function loadReceiptCache() {
  if (RECEIPT_CACHE) return RECEIPT_CACHE;

  const sh = getReceiptsSheet();
  const last = sh.getLastRow();
  if (last < 2) {
    RECEIPT_CACHE = new Map();
    RECEIPT_MSGID_CACHE = new Map();
    return RECEIPT_CACHE;
  }

  const data = sh.getRange(2, 1, last - 1, 13).getValues();
  const divRowCache = new Map();
  const msgIdCache = new Map();

  for (const row of data) {
    const [time, div, r, map, tC, tG, sC, sG, msgId, authorId, note, contentHash, editedTs] = row;
    const key = `${div}|${r}`;
    const receipt = {
      time,
      division: String(div),
      row: Number(r),
      map,
      tC,
      tG,
      sC: Number(sC),
      sG: Number(sG),
      msgId: String(msgId || ''),
      authorId: String(authorId || ''),
      note: String(note || ''),
      contentHash: String(contentHash || ''),
      editedTs: String(editedTs || '')
    };
    divRowCache.set(key, receipt);
    if (msgId) msgIdCache.set(String(msgId), receipt);
  }

  RECEIPT_CACHE = divRowCache;
  RECEIPT_MSGID_CACHE = msgIdCache;
  return divRowCache;
}

/**
 * Invalidate receipt cache (call after writing new receipts)
 */
function invalidateReceiptCache() {
  RECEIPT_CACHE = null;
  RECEIPT_MSGID_CACHE = null;
}

function findExistingReceipt(division, row) {
  const cache = loadReceiptCache();
  const key = getReceiptKey(division, row);
  return cache.get(key) || null;
}

function writeReceipt(division, row, map, tC, tG, sC, sG, msgId, authorId, note, contentHash, editedTs) {
  var sh = getReceiptsSheet();
  sh.appendRow([new Date(), division, row, map, tC, tG, sC, sG, msgId, authorId, note||'', contentHash||'', editedTs||'']);
  // Invalidate cache after write
  invalidateReceiptCache();
}

function findReceiptByMsgId(msgId) {
  // Use cache for fast lookup
  loadReceiptCache(); // ensure both caches are populated
  if (!RECEIPT_MSGID_CACHE) return null;

  const receipt = RECEIPT_MSGID_CACHE.get(String(msgId));
  if (!receipt) return null;

  return {
    division: receipt.division,
    row: receipt.row,
    contentHash: receipt.contentHash,
    editedTs: receipt.editedTs
  };
}