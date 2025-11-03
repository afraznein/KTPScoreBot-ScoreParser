/*************** WEEKLY BANNER HELPERS ***************/
/**
 * Get display value from A1 notation
 * Supports both "A1" (defaults to 'KTP Info' sheet) and "SheetName!A1" format
 *
 * @param {string} a1 - A1 notation (e.g., "B5" or "BRONZE!A28")
 * @returns {string} Display value from the specified cell, or empty string if sheet/range invalid
 *
 * @example
 * getDisplayValue("KTP Info!B5")  // "Keep the Practice"
 * getDisplayValue("A1")           // Value from 'KTP Info' sheet A1
 */
function getDisplayValue(a1) {
  var ss = SpreadsheetApp.getActive();
  var t = String(a1||'').trim();
  var sh = ss.getSheetByName(t.includes('!') ? t.split('!')[0] : 'KTP Info');
  var rng = t.includes('!') ? t.split('!')[1] : t;
  if (!sh) return '';
  return String(sh.getRange(rng).getDisplayValue() || '').trim();
}

/**
 * Validate if string looks like a DoD map token
 * Automatically prepends "dod_" if missing
 *
 * @param {string} s - Potential map token (e.g., "lennon2" or "dod_railyard_b6")
 * @returns {boolean} True if matches DoD map pattern (dod_[alphanumeric_])
 *
 * @example
 * looksLikeMap("lennon2")         // true (becomes "dod_lennon2")
 * looksLikeMap("dod_railyard_b6") // true
 * looksLikeMap("invalid!")        // false
 */
function looksLikeMap(s) {
  s = String(s||'').trim().toLowerCase();
  if (!s) return false;
  if (!s.startsWith('dod_')) s = 'dod_' + s;
  return DOD_MAP_PATTERN.test(s);
}

/**
 * Validate if string looks like a DoD map token (alias of looksLikeMap)
 * @param {string} s - Potential map token
 * @returns {boolean} True if matches DoD map pattern
 */
function looksLikeMapDod(s) {
  s = String(s||'').trim().toLowerCase();
  if (!s) return false;
  if (!s.startsWith('dod_')) s = 'dod_' + s;
  return DOD_MAP_PATTERN.test(s);
}

/**
 * Determine next week number and map from division schedules
 * Strategy: Find highest week with any scores across all divisions, then next week = maxScored + 1
 * Map is chosen by plurality voting across divisions for that week
 *
 * Algorithm:
 * 1. Scan all divisions to find highest week index with any score
 * 2. Next week = min(maxWeeks, maxScored + 1) [defaults to week 1 if nothing scored]
 * 3. Read map headers from column A for that week across divisions
 * 4. Pick most common map (plurality vote); skip divisions lacking that many weeks
 *
 * @returns {Object|null} { weekNumber, map, sourceSheetName } or null if no usable data
 *
 * @example
 * getNextWeekAndMapFromSchedule()
 * // Returns: { weekNumber: 3, map: "dod_railyard_b6", sourceSheetName: "SILVER" }
 */
function getNextWeekAndMapFromSchedule() {
  var ss = SpreadsheetApp.getActive();
  var divs = (typeof DIVISION_SHEETS !== 'undefined' && DIVISION_SHEETS.length)
    ? DIVISION_SHEETS : ['BRONZE','SILVER','GOLD'];

  var maxWeeks = detectMaxWeeks();

  // 1) find highest week with ANY score across any division
  var maxScored = 0;
  for (var d of divs) {
    var sh = ss.getSheetByName(d);
    if (!sh) continue;
    var localMax = 0;
    for (var w = 1; w <= maxWeeks; w++) {
      if (weekHasAnyScore(sh, w, maxWeeks)) localMax = w;
    }
    maxScored = Math.max(maxScored, localMax);
  }

  var nextWeek = Math.min(maxWeeks, Math.max(1, maxScored + 1));

  // 2) pull maps for that week from each division; vote plurality
  var mapCounts = {};
  var candidates = [];
  for (var d of divs) {
    var sh = ss.getSheetByName(d);
    if (!sh) continue;

    // if this division doesn't have that many weeks, skip
    var divMax = detectMaxWeeksForSheet(sh);
    if (nextWeek > divMax) continue;

    var m = readWeekMap(sh, nextWeek);
    if (looksLikeMapDod(m)) {
      candidates.push({ sheet: d, map: m });
      mapCounts[m] = (mapCounts[m] || 0) + 1;
    }
  }

  if (!candidates.length) return null; // nothing usable

  var bestMap = Object.keys(mapCounts).sort((a,b)=> mapCounts[b]-mapCounts[a])[0];
  var src = candidates.find(x => x.map === bestMap) || candidates[0];

  return {
  weekNumber: nextWeek,
  map: bestMap,
  sourceSheetName: src.sheet   // <-- string like "SILVER"
  };
}

/**
 * Calculate sheet row number for week block start (week label row)
 * Structure:
 *   - topRow: Week label (column A only - true header)
 *   - topRow+1: Map name (col A) + Match 1 data (cols B-H)
 *   - topRow+2: Date (col A) + Match 2 data (cols B-H)
 *   - topRow+3 to topRow+10: Matches 3-10 data (cols B-H)
 * Uses constants: MAP_HEADER_FIRST_ROW and MAP_HEADER_ROW_STEP
 *
 * @param {number} weekIndex - Week number (1-based)
 * @returns {number} Row number for this week's label (top of block)
 *
 * @example
 * getWeekTopRow(1)  // 27 (week 1 label row)
 * getWeekTopRow(2)  // 38 (week 2 label row)
 * getWeekTopRow(6)  // 82 (week 6 label row)
 */
function getWeekTopRow(weekIndex) {
  return MAP_HEADER_FIRST_ROW + (weekIndex - 1) * MAP_HEADER_ROW_STEP;
}

/**
 * Count consecutive week headers in column A for a single sheet
 * Stops at first non-map header or when row exceeds sheet bounds
 *
 * @param {Sheet} sheet - Google Sheets object (Bronze/Silver/Gold)
 * @returns {number} Count of consecutive valid week headers (0 if none found)
 *
 * @example
 * detectMaxWeeksForSheet(bronzeSheet)  // 8 (if 8 consecutive dod_* headers found)
 */
function detectMaxWeeksForSheet(sheet) {
  var last = sheet.getLastRow();
  var count = 0;
  for (var w = 1; ; w++) {
    var top = getWeekTopRow(w);
    var mapRow = top + 1; // Map is one row after week label
    if (mapRow > last) break;
    var v = String(sheet.getRange(mapRow, 1).getDisplayValue() || '').trim().toLowerCase();
    var m = v.startsWith('dod_') ? v : ('dod_' + v);
    if (!looksLikeMapDod(m)) break;      // stop at first non-map header
    count++;
  }
  return count; // 0 if none
}

/**
 * Detect maximum weeks across all division sheets (dynamic count)
 * Returns the highest week count found in any division
 *
 * @returns {number} Maximum weeks across Bronze/Silver/Gold divisions (minimum 1)
 *
 * @example
 * detectMaxWeeks()  // 8 (if GOLD has 8 weeks, BRONZE has 6, SILVER has 7)
 */
function detectMaxWeeks() {
  var ss = SpreadsheetApp.getActive();
  var divs = (typeof DIVISION_SHEETS !== 'undefined' && DIVISION_SHEETS.length)
    ? DIVISION_SHEETS : ['BRONZE','SILVER','GOLD'];

  var maxW = 0;
  for (var d of divs) {
    var sh = ss.getSheetByName(d);
    if (!sh) continue;
    maxW = Math.max(maxW, detectMaxWeeksForSheet(sh));
  }
  return Math.max(1, maxW); // never less than 1
}

/**
 * Read map token from column A header for specific week
 * Returns empty string if invalid or missing
 *
 * @param {Sheet} sheet - Google Sheets object
 * @param {number} weekIndex - Week number (1-based)
 * @returns {string} Canonical map name (e.g., "dod_railyard_b6") or empty string if invalid
 */
function readWeekMap(sheet, weekIndex) {
  var top = getWeekTopRow(weekIndex);
  var mapRow = top + 1; // Map is one row after week label (A28, A39, A50, etc.)
  var v = String(sheet.getRange(mapRow, 1).getDisplayValue() || '').trim().toLowerCase();
  if (!v) return '';
  var m = v.startsWith('dod_') ? v : ('dod_' + v);
  return looksLikeMapDod(m) ? m : '';
}

/**
 * Check if weekly block has any scores recorded
 * Examines match rows between this week's header and next week's header
 *
 * @param {Sheet} sheet - Google Sheets object
 * @param {number} weekIndex - Week number (1-based)
 * @param {number} maxWeeks - Total weeks in schedule (for boundary calculation)
 * @returns {boolean} True if at least one match has scores in columns D or H
 */
function weekHasAnyScore(sheet, weekIndex, maxWeeks) {
  var top = getWeekTopRow(weekIndex);
  // Structure: top = week label (header only in col A)
  // top+1 = map in col A + match 1 in cols B-H
  // top+2 = date in col A + match 2 in cols B-H
  // Matches are in cols B-H starting at top+1
  var start = top + 1; // First match row
  var nextTop = (weekIndex < maxWeeks) ? getWeekTopRow(weekIndex + 1) : (top + MAP_HEADER_ROW_STEP);
  var end = Math.min(sheet.getLastRow(), nextTop - 1);
  if (end < start) return false;

  var n = end - start + 1; // number of match rows
  var cVals = sheet.getRange(start, COL_T1_SC, n, 1).getValues();
  var gVals = sheet.getRange(start, COL_T2_SC, n, 1).getValues();
  for (var i = 0; i < n; i++) {
    var s1 = String(cVals[i][0] || '').trim();
    var s2 = String(gVals[i][0] || '').trim();
    if (s1 !== '' || s2 !== '') return true;
  }
  return false;
}

/**
 * Detect if message content is a weekly scores banner (for deduplication in parsers)
 * Checks for signature patterns: ":KTP:", "Week N", "Matches -", and rule line (===)
 *
 * @param {string} s - Message content to check
 * @returns {boolean} True if message matches weekly banner signature
 *
 * @example
 * isWeeklyScoresBanner(":KTP: Week 3 Matches - dod_lennon2\n======")  // true
 */
function isWeeklyScoresBanner(s) {
  s = String(s||'').trim();
  return /:KTP:/i.test(s) && /\bWeek\s+\d+\b/i.test(s) && /Matches\s*-\s*/i.test(s) && /={8,}/.test(s);
}

/**
 * Create time-based trigger for weekly banner posting
 * Fires every Monday at 8:00 AM (requires project timezone = America/New_York)
 */
function createWeeklyBannerTrigger() {
  ScriptApp.newTrigger('postWeeklyScoresBanner')
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.MONDAY)
    .atHour(8)         // Project must be set to America/New_York
    .nearMinute(0)
    .create();
}

/**
 * Delete all time-based triggers for weekly banner posting
 * Removes all triggers with handler function 'postWeeklyScoresBanner'
 */
function deleteWeeklyBannerTriggers() {
  var all = ScriptApp.getProjectTriggers();
  for (var t of all) if (t.getHandlerFunction() === 'postWeeklyScoresBanner') ScriptApp.deleteTrigger(t);
}

/**
 * UI wrapper: Create weekly banner trigger (menu item)
 */
function createBannerTrigger(){
  createWeeklyBannerTrigger();
}

/**
 * UI wrapper: Delete weekly banner triggers (menu item)
 */
function deleteBannerTrigger(){
  deleteWeeklyBannerTriggers();
}

/**
 * UI wrapper: Manually post weekly banner (for testing/debugging)
 */
function manuallyPostWeeklyScoresBanner(){
  postWeeklyScoresBanner();
}

/**
 * Post weekly scores banner to Discord scores channel
 * Called by time-based trigger every Monday at 8:00 AM ET
 *
 * Flow:
 * 1. Check if WEEKLY_BANNER_ENABLED flag is true
 * 2. Fetch header text from WEEKLY_BANNER_LEFT_CELL (e.g., "Keep the Practice")
 * 3. Detect next week number and map using getNextWeekAndMapFromSchedule()
 * 4. Format banner with emojis and rule line
 * 5. Post to SCORES_CHANNEL_ID via relay
 *
 * Format example:
 *   🎖️      :KTP:    **Keep the Practice Week 3 Matches - dod_railyard_b6**    :KTP:      🎖️
 *   `========================================`
 *
 * @returns {Object} { ok, posted, source } - ok=true if banner posted, source=sheet name used
 */
function postWeeklyScoresBanner() {
  if (!WEEKLY_BANNER_ENABLED) return { ok:false, reason:'disabled' };

  var left = getDisplayValue(WEEKLY_BANNER_LEFT_CELL);
  var next = getNextWeekAndMapFromSchedule();

  var weeknum   = next ? String(next.weekNumber) : '?';
  var prettyMap = next ? String(next.map || '') : 'TBD';

  var rule = Array(Math.max(1, WEEKLY_BANNER_RULE)).fill('=').join('');
  var header = `${EMOJI_DOD}      ${EMOJI_KTP}    **${left} Week ${weeknum} Matches - ${prettyMap}**    ${EMOJI_KTP}      ${EMOJI_DOD}\n`;
  header += `\`${rule}\``;

  relayPost('/reply', { channelId:String(SCORES_CHANNEL_ID), content: header });

  // new: use sourceSheetName (string) in the return, no .getName()
  return { ok: !!next, posted: header, source: next ? next.sourceSheetName : '(none)' };
}