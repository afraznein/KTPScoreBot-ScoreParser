/*************** DEBUG ONE OFF ***************/
/**
 * Debug utility: Seed _Aliases sheet with team variants from division tabs
 * Automatically generates common aliases (with/without "THE", etc.)
 * Skips placeholders and duplicates
 * @returns {Object} { added: number } - Count of aliases added
 */
function seedAliasesFromDivisions() {
  const ss = SpreadsheetApp.getActive();

  // Ensure _Aliases exists and has headers
  const aliasSheet = ensureSheet('_Aliases', ['alias','canonical','scope','notes']);

  // Build a set of existing aliases to prevent duplicates
  const existingAliases = new Set();
  const lastAliasRow = aliasSheet.getLastRow();
  if (lastAliasRow >= 2) {
    const existing = aliasSheet.getRange(2, 1, lastAliasRow - 1, 2).getValues();
    for (const [a] of existing) {
      const aliasUpper = String(a || '').trim().toUpperCase();
      if (aliasUpper) existingAliases.add(aliasUpper);
    }
  }

  const rowsToAppend = [];
  const DIV_TABS = ['BRONZE', 'SILVER', 'GOLD']; // your division sheet names (uppercase)

  function addAliasesForTeam(canonName, scope, note) {
    let canonUpper = String(canonName || '').trim().toUpperCase();
    if (!canonUpper) return;

    // SKIP placeholders like "GOLD A", "SILVER Z", "BRONZE I"
    if (isPlaceholderTeamAnyDiv(canonUpper)) return;

    const variants = makeTeamVariants(canonUpper);
    for (const v of variants) {
      const aliasUpper = String(v || '').trim().toUpperCase();
      if (!aliasUpper) continue;
      if (aliasUpper === canonUpper) continue;            // don't alias to itself
      if (isPlaceholderTeamAnyDiv(aliasUpper)) continue; // never add placeholder tokens as aliases
      if (existingAliases.has(aliasUpper)) continue;      // no dupes
      rowsToAppend.push([aliasUpper, canonUpper, scope, note || 'seed']);
      existingAliases.add(aliasUpper);
    }
  }

  // 1) Division tabs: A3:A22
  for (const div of DIV_TABS) {
    const sh = ss.getSheetByName(div);
    if (!sh) continue;
    const vals = sh.getRange('A3:A22').getValues().flat();
    const teams = Array.from(new Set(
      vals.map(v => String(v || '').trim())
          .filter(Boolean)
          .map(s => s.toUpperCase())
    ));
    for (const t of teams) addAliasesForTeam(t, div, 'seed: division');
  }

  // 2) TEAMS sheet: rows 2,16,30,... (step 14), column A
  const tsh = ss.getSheetByName('TEAMS');
  if (tsh) {
    const lastRow = tsh.getLastRow();
    for (let r = 2; r <= lastRow; r += 14) {
      const val = String(tsh.getRange(r, 1).getValue() || '').trim();
      if (!val) continue;
      addAliasesForTeam(val, 'ANY', 'seed: TEAMS');
    }
  }

  // Only write if we actually have rows to add
  if (rowsToAppend.length > 0) {
    aliasSheet
      .getRange(aliasSheet.getLastRow() + 1, 1, rowsToAppend.length, rowsToAppend[0].length)
      .setValues(rowsToAppend);
  }

  return { added: rowsToAppend.length };
}

function makeTeamVariants(canonUpper) {
  const raw = String(canonUpper || '').trim().toUpperCase();
  if (!raw) return [];

  const noThe = raw.replace(/^THE\s+/, '');
  const deNoise = noThe
    .replace(/\b(ESPORTS|GAMING|TEAM)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  const words = deNoise.split(/\s+/).filter(Boolean);
  const acronym = words.length >= 2 ? words.map(w => w[0]).join('') : '';
  const compact = deNoise.replace(/[^A-Z0-9]+/g, '');

  const out = new Set([
    raw,                // original (canonical)
    noThe,              // without THE
    deNoise,            // without suffixes
    compact,            // compressed
    acronym,            // acronym (e.g., WKS for WICKED SQUAD)
    ('THE ' + deNoise)  // explicitly add "THE ..." so captains typing it still match
  ]);

  // Final filter: drop empties/placeholders just in case
  return Array.from(out)
    .map(s => s.trim())
    .filter(Boolean)
    .filter(s => !isPlaceholderTeamAnyDiv(s));
}

function ensureMapAlias() {
  return ensureSheet('_MapAlias', ['token_raw','last_seen','count','example_msgId','authorId']);
}

function appendMapAliasRows(rows) {
  var sh = ensureMapAlias();
  safeSetValues(sh, sh.getLastRow() + 1, 1, rows, '_MapAlias');
}

function seedMapAliasesFromGeneral() {
  const ss = SpreadsheetApp.getActive();

  // --- Load canonical maps from General!J2:J29 and normalize to lower "dod_*"
  const general = ss.getSheetByName('General');
  if (!general) throw new Error('Missing "General" sheet');
  const raw = general.getRange('J2:J29').getValues().flat();
  const canonicals = Array.from(
    new Set(
      raw
        .map(v => String(v || '').trim().toLowerCase())
        .filter(Boolean)
        .map(m => (m.startsWith('dod_') ? m : 'dod_' + m))
    )
  );

  // --- Ensure _MapAliases with header
  const mapAliasSheet = ensureSheet('_MapAliases', ['alias', 'canonical']);

  // Build a set of existing alias->canonical so we don’t re-add
  const existing = new Map();           // alias -> canonical
  const existingAliases = new Set();    // alias only
  const last = mapAliasSheet.getLastRow();
  if (last >= 2) {
    const rows = mapAliasSheet.getRange(2, 1, last - 1, Math.min(2, mapAliasSheet.getLastColumn())).getValues();
    for (const [a, c] of rows) {
      const alias = String(a || '').trim().toLowerCase();
      const canon = String(c || '').trim().toLowerCase();
      if (!alias || !canon) continue;
      existing.set(alias, canon);
      existingAliases.add(alias);
    }
  }

  // We’ll collect new rows here; also track collisions to avoid ambiguous aliases
  const toWrite = [];
  const proposed = new Map();  // alias -> canonical (for this run)
  const collisions = new Set(); // aliases that map to multiple canonicals in this pass

  // Helper: generate alias variants for a canonical "dod_*"
  function makeMapVariants(canonicalDodLower) {
    const noDod = canonicalDodLower.replace(/^dod_/, '');    // e.g., "railyard_b6"
    const parts = noDod.split('_');                          // ["railyard","b6"]
    const out = new Set();
    out.add(noDod);               // "railyard_b6" (or "anzio")
    out.add(parts[0]);            // "railyard" (or "anzio")
    if (parts.length >= 2) {
      out.add(parts[0] + '_' + parts[1]); // "railyard_b6"
    }
    // You can add more patterns here if needed (e.g., drop minor suffixes)
    return Array.from(out).filter(Boolean);
  }

  // Build proposals
  for (const c of canonicals) {
    const variants = makeMapVariants(c);
    for (const alias of variants) {
      if (!alias) continue;
      const a = alias.toLowerCase();
      const canon = c.toLowerCase();

      // Skip if alias exactly equals canonical (we don’t need self-maps here)
      if (a === canon || a === canon.replace(/^dod_/, '')) {
        // Keeping self-map out to reduce noise in the sheet
        continue;
      }

      // If already exists and points to same canonical, skip (no work)
      if (existingAliases.has(a) && existing.get(a) === canon) continue;

      // If exists but to a different canonical, mark collision and skip adding
      if (existingAliases.has(a) && existing.get(a) !== canon) {
        collisions.add(a);
        continue;
      }

      // Check collisions within this run
      if (proposed.has(a) && proposed.get(a) !== canon) {
        collisions.add(a);
        continue;
      }

      // Tentatively accept
      proposed.set(a, canon);
    }
  }

  // Materialize toWrite, skipping collisions
  for (const [a, c] of proposed.entries()) {
    if (collisions.has(a)) continue;          // avoid ambiguous alias
    if (existingAliases.has(a) && existing.get(a) === c) continue;
    toWrite.push([a, c]);
  }

  // Batch write
  if (toWrite.length > 0) {
    const startRow = mapAliasSheet.getLastRow() + 1;
    // Use your safe batch writer (no-op on empty)
    safeSetValues(mapAliasSheet, startRow, 1, toWrite);
  }

  return {
    canonicalCount: canonicals.length,
    added: toWrite.length,
    collisions: Array.from(collisions)
  };
}

function clearAliasCaches() {
  __TEAM_ALIAS_CACHE = null;
  __MAP_ALIAS_CACHE = null;
  __CANON_MAPS = null;            // General fallback cache
  __CANON_MAP_ALIASES = null;
  __DIV_CANON_MAPS = null;        // NEW
  //log('INFO','Alias/map caches cleared');
}

function reloadAliasCaches() {
  clearAliasCaches();
  try { loadAliases(); } catch(e){ log('WARN','loadAliases failed', String(e)); }
  try { loadMapAliases(); } catch(e){ log('WARN','loadMapAliases failed', String(e)); }
  try { loadDivisionCanonicalMaps(); buildCanonMapAliases(); } catch(e){ log('WARN','map alias build failed', String(e)); }
  /*log('INFO', 'Alias/map caches reloaded', {
    teamAliases: __TEAM_ALIAS_CACHE ? Object.keys(__TEAM_ALIAS_CACHE).length : 0,
    mapAliases: __CANON_MAP_ALIASES ? Object.keys(__CANON_MAP_ALIASES).length : 0,
    divCanon: __DIV_CANON_MAPS ? __DIV_CANON_MAPS.size : 0
  });*/
}

function seedMapAlias(){
  seedMapAliasesFromGeneral();
}

function seedTeamAlias(){
  seedAliasesFromDivisions();
}

function ADMIN_ResetPollCursor() {
  PropertiesService.getScriptProperties().deleteProperty(LAST_ID_KEY);
  log('INFO','LAST_ID_KEY cleared');
}