/*************** UTILITIES ***************/

/*************** SPREADSHEET ***************/

function getSheetByName_(name){ return SpreadsheetApp.getActive().getSheetByName(name); }

function ensureSheet_(name, header) {
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
function coerceDate_(val) {
  if (!val) return null;
  if (Object.prototype.toString.call(val) === '[object Date]') return val;
  const dt = new Date(String(val));
  return isNaN(dt.getTime()) ? null : dt;
}

function fmtTs_(){ return Utilities.formatDate(new Date(), DEFAULT_TZ, 'yyyy-MM-dd HH:mm:ss'); }

function tsMs_(m) {
  // Prefer edited_timestamp, fall back to timestamp; 0 if missing
  var t = (m && (m.edited_timestamp || m.timestamp)) || 0;
  var n = Date.parse(t);
  return isNaN(n) ? 0 : n;
}

function nowMs_(){ return Date.now(); }

function jitterMs_() {
  return Math.floor(Math.random() * (FETCH_JITTER_MS_MAX - FETCH_JITTER_MS_MIN + 1)) + FETCH_JITTER_MS_MIN;
}

function isQuotaCooldown_() {
  var props = PropertiesService.getScriptProperties();
  var until = Number(props.getProperty('QUOTA_COOLDOWN_UNTIL') || 0);
  return nowMs_() < until;
}

function startQuotaCooldown_(minutes) {
  var props = PropertiesService.getScriptProperties();
  var until = nowMs_() + (minutes * 60 * 1000);
  props.setProperty('QUOTA_COOLDOWN_UNTIL', String(until));
}

function bumpPollCounter_() {
  var props = PropertiesService.getScriptProperties();
  var n = Number(props.getProperty('POLL_COUNTER') || 0) + 1;
  props.setProperty('POLL_COUNTER', String(n));
  return n;
}

function shouldFetchRecentPage_() {
  var n = bumpPollCounter_();
  return (n % RECENT_PAGE_EVERY_N) === 0; // every Nth poll
}

/*************** CURSORS***************/
// Use your consolidated helpers if present; otherwise fall back to a simple LAST_ID_* key.
function _getScoresCursorSafe_() {
  try {
    if (typeof getCursor_ === 'function') return String(getCursor_(SCORES_CHANNEL_ID) || '');
  } catch(_) {}
  const props = PropertiesService.getScriptProperties();
  // Prefer canonical LAST_ID_<channel>, but also check legacy SCORES_LAST_
  return props.getProperty('LAST_ID_' + SCORES_CHANNEL_ID) ||
         props.getProperty('SCORES_LAST_' + SCORES_CHANNEL_ID) || '';
}

function _setScoresCursorSafe_(id) {
  if (!id) return _clearScoresCursorSafe_();
  try {
    if (typeof setCursor_ === 'function') return setCursor_(SCORES_CHANNEL_ID, String(id));
  } catch(_) {}
  const props = PropertiesService.getScriptProperties();
  props.setProperty('LAST_ID_' + SCORES_CHANNEL_ID, String(id));
  // clean legacy key to avoid confusion
  props.deleteProperty('SCORES_LAST_' + SCORES_CHANNEL_ID);
}

function _clearScoresCursorSafe_() {
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

function cursorKey_(channelId) {
  var id = String(channelId || '').trim();
  var base = CURSOR_PREFIX + id;
  return CURSOR_NAMESPACE ? (CURSOR_NAMESPACE + base) : base;
}

function legacyCursorKey_(channelId) {
  var id = String(channelId || '').trim();
  var base = LEGACY_CURSOR_PREFIX + id;
  return CURSOR_NAMESPACE ? (CURSOR_NAMESPACE + base) : base;
}

// Read cursor with auto-migration from legacy keys
function getCursor_(channelId) {
  var props = PropertiesService.getScriptProperties();
  var key   = cursorKey_(channelId);
  var val   = props.getProperty(key);
  if (val) return String(val);

  // try legacy key(s)
  var legacyKey = legacyCursorKey_(channelId);
  var legacyVal = props.getProperty(legacyKey);
  if (legacyVal) {
    // migrate: copy to canonical and delete legacy
    props.setProperty(key, String(legacyVal));
    props.deleteProperty(legacyKey);
    log_('INFO','Migrated legacy cursor', { from: legacyKey, to: key, value: legacyVal });
    return String(legacyVal);
  }

  // also support truly old format LAST_ID_<id> without namespace when namespace now enabled
  var rawFallback = CURSOR_PREFIX + channelId;
  var rawVal = props.getProperty(rawFallback);
  if (rawVal) {
    props.setProperty(key, String(rawVal));
    props.deleteProperty(rawFallback);
    log_('INFO','Migrated raw cursor', { from: rawFallback, to: key, value: rawVal });
    return String(rawVal);
  }
  return '';
}

function setCursor_(channelId, snowflake) {
  var props = PropertiesService.getScriptProperties();
  var key = cursorKey_(channelId);
  props.setProperty(key, String(snowflake || ''));
}

function listAllCursors_() {
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
  var rows = listAllCursors_();
  log_('INFO','Script cursors', { count: rows.length, rows: rows });
  return rows;
}

function ADMIN_ResetCursor(channelId) {
  var props = PropertiesService.getScriptProperties();
  props.deleteProperty(cursorKey_(channelId));
  props.deleteProperty(legacyCursorKey_(channelId));
  // also nuke un-namespaced variants, just in case
  props.deleteProperty(CURSOR_PREFIX + channelId);
  props.deleteProperty(LEGACY_CURSOR_PREFIX + channelId);
  log_('INFO','Cursor(s) cleared for channel', { channelId: String(channelId) });
}


/*************** SAFE VALUES ***************/
// Safe batch writer: no-ops if rows is empty
function safeSetValues_(sheet, startRow, startCol, rows, labelOpt) {
  var label = String(labelOpt || 'batch');
  if (!rows || !rows.length) {
    log_('INFO', 'safeSetValues_ no-op (empty rows)', { label: label, sheet: sheet.getName() });
    return 0;
  }
  var width = (rows[0] && rows[0].length) || 0;
  if (!width) {
    log_('INFO', 'safeSetValues_ no-op (zero width)', { label: label, sheet: sheet.getName() });
    return 0;
  }
  sheet.getRange(startRow, startCol, rows.length, width).setValues(rows);
  return rows.length;
}

/*************** LOGGING ***************/
function log_(level, msg, data) {
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

/*************** TEXT MANIPULATION AND COMPARISON ***************/
function stripEmojis_(text, opts) {
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

// Trim BOTH ends, preserve inner spaces; also remove invisible spaces, return UPPERCASE
function sanitizeTeamToken_(raw) {
  if (!raw) return '';
  let t = stripEmojis_(String(raw), { collapse:false });
  t = t.replace(/[\u00A0\u1680\u180E\u2000-\u200A\u202F\u205F\u3000\u200B-\u200D\uFEFF]/g, ' ');
  t = t.replace(/^\s+|\s+$/g, ''); // both ends
  return t.toUpperCase();
}

function normalizeMapToken_(raw) {
  if (!raw) return '';
  const token = String(raw).trim().toLowerCase().replace(/^dod_/, ''); // accept dod_ optional
  const aliases = buildCanonMapAliases_();

  // Try alias table with/without dod_
  const direct = aliases[token] || aliases['dod_' + token];
  if (direct) return direct;

  // Reparse/debug fallback (optional)
  if (ALLOW_UNKNOWN_DOD_MAPS) {
    const guess = token.startsWith('dod_') ? token : ('dod_' + token);
    if (/^dod_[a-z0-9_]+$/.test(guess)) return guess;
  }
  return '';
}

function normalizeTeamName_(raw) {
  let cleanedUpper = sanitizeTeamToken_(raw).toUpperCase();
  if (!cleanedUpper) return '';

  // NEW: treat placeholder teams as a special token (they will be skipped later)
  if (isPlaceholderTeamAnyDiv_(cleanedUpper)) return '__PLACEHOLDER__';

  // NEW: accept "THE WICKEDS" as "WICKEDS" (still falls back to aliases/canon)
  if (cleanedUpper.startsWith('THE ')) {
    const noThe = cleanedUpper.replace(/^THE\s+/, '');
    cleanedUpper = noThe || cleanedUpper; // prefer without THE if non-empty
  }

  // Canonical exact match?
  const canon = getCanonicalTeamMap_();
  if (canon[cleanedUpper]) return cleanedUpper;

  // Alias lookup
  const aliases = loadAliases_(); // alias -> [canon...]
  const ali = aliases[cleanedUpper];
  if (ali && ali.length === 1) return ali[0];
  if (ali && ali.length > 1)   return '__AMBIG_ALIAS__:' + cleanedUpper;

  return cleanedUpper; // fallback: will be validated later
}

function isPlaceholderTeamAnyDiv_(teamUpper) {
  // Matches: "GOLD A", "SILVER Z", "BRONZE I" — any case in input, already uppercased here.
  return /^\s*(BRONZE|SILVER|GOLD)\s+[A-Z]\s*$/.test(String(teamUpper || '').toUpperCase());
}

function isPlaceholderTeamForDiv_(teamUpper, divisionUpper) {
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
function computeContentHash_(content) {
  return Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(
      Utilities.DigestAlgorithm.SHA_256,
      String(content || '')
    ).map(function(b){ return String.fromCharCode(b); }).join('')
  );
}

let __TEAM_CANON_CACHE = null;

function getCanonicalTeamMap_() {
  if (__TEAM_CANON_CACHE) return __TEAM_CANON_CACHE;
  const map = {};
  for (const sheetName of DIVISION_SHEETS) {
    const sh = getSheetByName_(sheetName);
    if (!sh) continue;
    const vals = sh.getRange(TEAM_CANON_RANGE).getValues().flat();
    for (const v of vals) {
      const name = String(v || '').trim();
      if (!name) continue;
      map[name.toUpperCase()] = name.toUpperCase();
    }
  }
  __TEAM_CANON_CACHE = map;
  return map;
}

// ---- Division-first canonical maps -----------------------------------------
let __DIV_CANON_MAPS = null; // Set<string> lowercased "dod_*" from BRONZE/SILVER/GOLD col A

function loadDivisionCanonicalMaps_() {
  if (__DIV_CANON_MAPS) return __DIV_CANON_MAPS;

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

  __DIV_CANON_MAPS = out;
  return out;
}

let __TEAM_ALIAS_CACHE = null;

function loadAliases_() {
  if (__TEAM_ALIAS_CACHE) return __TEAM_ALIAS_CACHE;

  const mapMulti = {}; // ALIAS (UPPER) -> Set of CANON (UPPER)
  const sh = SpreadsheetApp.getActive().getSheetByName('_Aliases');

  if (!sh) { __TEAM_ALIAS_CACHE = {}; return __TEAM_ALIAS_CACHE; }

  const lastRow = sh.getLastRow();
  const lastCol = sh.getLastColumn();
  if (lastRow < 2) { __TEAM_ALIAS_CACHE = {}; return __TEAM_ALIAS_CACHE; }

  const width = Math.min(3, lastCol); // alias | canonical | scope (scope optional)
  const numRows = lastRow - 1;
  if (numRows <= 0) { __TEAM_ALIAS_CACHE = {}; return __TEAM_ALIAS_CACHE; }

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
  __TEAM_ALIAS_CACHE = out;
  return out;
}

let __MAP_ALIAS_CACHE = null;

function loadMapAliases_() {
  if (__MAP_ALIAS_CACHE) return __MAP_ALIAS_CACHE;

  const out = {}; // alias(lower) -> dod_* (lower)
  const sh = SpreadsheetApp.getActive().getSheetByName('_MapAliases');

  // If the sheet is missing or has only a header (or fewer), return empty cache
  if (!sh) { __MAP_ALIAS_CACHE = out; return out; }

  const lastRow = sh.getLastRow();
  const lastCol = sh.getLastColumn();
  if (lastRow < 2) { __MAP_ALIAS_CACHE = out; return out; } // nothing to read

  const width = Math.min(2, lastCol); // tolerate extra columns
  const numRows = lastRow - 1;
  if (numRows <= 0) { __MAP_ALIAS_CACHE = out; return out; }

  const rows = sh.getRange(2, 1, numRows, width).getValues();
  for (const [alias, canon] of rows) {
    let a = String(alias || '').trim().toLowerCase();
    let c = String(canon || '').trim().toLowerCase();
    if (!a || !c) continue;
    if (!c.startsWith('dod_')) c = 'dod_' + c;
    out[a] = c;
  }

  __MAP_ALIAS_CACHE = out;
  return out;
}

function isCanonTeam_(upperName) {
  const canon = getCanonicalTeamMap_();
  return !!canon[String(upperName || '')];
}

let __CANON_MAPS = null;

function loadCanonicalMaps_() {
  if (__CANON_MAPS) return __CANON_MAPS;
  const sh = SpreadsheetApp.getActive().getSheetByName(GENERAL_SHEET);
  if (!sh) return (__CANON_MAPS = new Set());
  const vals = sh.getRange(GENERAL_MAPS_RANGE).getValues().flat();
  const out = new Set();
  for (let raw of vals) {
    if (!raw) continue;
    let m = String(raw).trim().toLowerCase();
    if (!m.startsWith('dod_')) m = 'dod_' + m;
    out.add(m);
  }
  return (__CANON_MAPS = out);
}

let __CANON_MAP_ALIASES = null;
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
function buildCanonMapAliases_() {
  if (__CANON_MAP_ALIASES) return __CANON_MAP_ALIASES;

  const table = {}; // alias(lower) -> canonical(lower)

  function addAlias(a, c) {
    if (!a || !c) return;
    a = a.toLowerCase(); c = c.toLowerCase();
    if (!c.startsWith('dod_')) c = 'dod_' + c;
    // don't overwrite once set, except when we explicitly override later
    if (!table[a]) table[a] = c;
  }

  // 1) Division-derived canonicals (primary)
  const divSet = loadDivisionCanonicalMaps_();
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
  const admin = loadMapAliases_(); // alias -> canonical (may be empty)
  for (const [a, c] of Object.entries(admin)) {
    const canon = c.toLowerCase().startsWith('dod_') ? c.toLowerCase() : 'dod_' + c.toLowerCase();
    table[a.toLowerCase()] = canon; // explicit override
  }

  // 3) Fallback to General list only for missing aliases
  const gen = (function loadCanonicalMaps_() {
    if (typeof __CANON_MAPS !== 'undefined' && __CANON_MAPS) return __CANON_MAPS;
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
    __CANON_MAPS = out;
    return out;
  })();

  for (const c of Array.from(gen)) {
    const noDod = c.replace(/^dod_/, '');
    const base = noDod.split('_')[0];
    if (!table[c])     addAlias(c, c);
    if (!table[noDod]) addAlias(noDod, c);
    if (!table[base])  addAlias(base, c);
  }

  __CANON_MAP_ALIASES = table;
  return table;
}

/*************** RECEIPTS HELPERS ***************/
function receiptsSheet_() {
  const sh = ensureSheet_(RECEIPTS_SHEET, [
    'Time','Division','Row','Map','TeamC','TeamG','ScoreC','ScoreG','MsgId','AuthorId','Note','ContentHash','EditedTS'
  ]);
  // If an older sheet exists with fewer columns, do nothing; appendRow can still write extra cols.
  return sh;
}

function receiptKey_(division, row) { return `${division}|${row}`; }

function findExistingReceipt_(division, row) {
  const sh = receiptsSheet_();
  const last = sh.getLastRow();
  if (last < 2) return null;
  const data = sh.getRange(2,1,last-1,11).getValues();
  for (let i = data.length-1; i>=0; i--) {
    const [time, div, r, map, tC, tG, sC, sG, msgId, authorId, note] = data[i];
    if (String(div) === String(division) && Number(r) === Number(row)) {
      return { time, division:div, row:r, map, tC, tG, sC:Number(sC), sG:Number(sG), msgId:String(msgId||''), authorId:String(authorId||''), note:String(note||'') };
    }
  }
  return null;
}

function writeReceipt_(division, row, map, tC, tG, sC, sG, msgId, authorId, note, contentHash, editedTs) {
  var sh = receiptsSheet_();
  sh.appendRow([new Date(), division, row, map, tC, tG, sC, sG, msgId, authorId, note||'', contentHash||'', editedTs||'']);
}

function findReceiptByMsgId_(msgId) {
  const sh = receiptsSheet_();
  const last = sh.getLastRow();
  if (last < 2) return null;
  // Assuming receipts header: Time,Division,Row,Map,TeamC,TeamG,ScoreC,ScoreG,MsgId,AuthorId,Note,ContentHash,EditedTS
  const w = Math.min(sh.getLastColumn(), 13); // tolerate older sheets
  const rows = sh.getRange(2,1,last-1,w).getValues();
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i];
    if (String(r[8]) === String(msgId)) { // MsgId is column 9 (0-based index 8)
      return {
        division: String(r[1]||''),
        row: Number(r[2]||0),
        contentHash: String(r[11]||''),
        editedTs: String(r[12]||'')
      };
    }
  }
  return null;
}