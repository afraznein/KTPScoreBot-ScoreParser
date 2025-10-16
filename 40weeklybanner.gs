/*************** WEEKLY BANNER HELPERS ***************/
function _disp_(a1) {
  var ss = SpreadsheetApp.getActive();
  var t = String(a1||'').trim();
  var sh = ss.getSheetByName(t.includes('!') ? t.split('!')[0] : 'KTP Info');
  var rng = t.includes('!') ? t.split('!')[1] : t;
  if (!sh) return '';
  return String(sh.getRange(rng).getDisplayValue() || '').trim();
}

function _looksLikeMap_(s) {
  s = String(s||'').trim().toLowerCase();
  if (!s) return false;
  if (!s.startsWith('dod_')) s = 'dod_' + s;
  return /^dod_[a-z0-9_]+$/.test(s);
}

function _looksLikeMapDod_(s) {
  s = String(s||'').trim().toLowerCase();
  if (!s) return false;
  if (!s.startsWith('dod_')) s = 'dod_' + s;
  return /^dod_[a-z0-9_]+$/.test(s);
}

// Potentially delete if get getActiveWeekAndMapFromSchedule is removed
// Return [{top,height,map,weekIndex,sheet}] using column A headers (A28,A39,A50…)
function _scanDivisionBlocks_(sheetName) {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(sheetName);
  var out = [];
  if (!sh) return out;

  var last = sh.getLastRow();
  if (last < 1) return out;

  var colVals = sh.getRange(1, MAP_HEADER_COLUMN, last, 1).getValues().map(r => String(r[0]||'').trim());
  var headerRows = [];
  for (var r = 1; r <= last; r++) {
    if (_looksLikeMap_(colVals[r-1])) headerRows.push(r);
  }
  if (!headerRows.length) return out;

  for (var i=0;i<headerRows.length;i++){
    var top = headerRows[i];
    var nextTop = (i+1 < headerRows.length) ? headerRows[i+1] : (top + DEFAULT_BLOCK_HEIGHT);
    var height = Math.max(1, Math.min(last, nextTop - top));
    var raw = colVals[top-1].toLowerCase();
    var canonical = normalizeMapToken_(raw);     // <- use your parser’s normalizer
    if (!canonical) {
      // fallback to strict dod_* if normalizer is strict:
      canonical = raw.startsWith('dod_') ? raw : ('dod_' + raw);
    }
    out.push({ top: top, height: height, map: canonical, weekIndex: (i+1), sheet: sh });
  }
  return out;
}

//Potentially delete if get getActiveWeekAndMapFromSchedule is removed
// True if any match row under this block is unscored
function _blockHasUnscored_(block) {
  var sh = block.sheet;
  var start = block.top + 1;
  var end = Math.min(sh.getLastRow(), block.top + block.height - 1);
  if (end < start) return false;

  var n = end - start + 1;
  // Use your D/H columns (4 and 8)
  var cVals = sh.getRange(start, COL_T1_SC, n, 1).getValues();
  var gVals = sh.getRange(start, COL_T2_SC, n, 1).getValues();

  for (var i = 0; i < n; i++) {
    var s1 = String(cVals[i][0] || '').trim();
    var s2 = String(gVals[i][0] || '').trim();
    if (s1 === '' && s2 === '') return true; // at least one unscored row in this block
  }
  return false;
}

//Potentially delete
function _blockHasAnyScore_(block) {
  var sh = block.sheet;
  var start = block.top + 1;
  var end = Math.min(sh.getLastRow(), block.top + block.height - 1);
  if (end < start) return false;

  var n = end - start + 1;
  var cVals = sh.getRange(start, COL_T1_SC, n, 1).getValues();
  var gVals = sh.getRange(start, COL_T2_SC, n, 1).getValues();
  for (var i = 0; i < n; i++) {
    var s1 = String(cVals[i][0] || '').trim();
    var s2 = String(gVals[i][0] || '').trim();
    if (s1 !== '' || s2 !== '') return true; // any score recorded in this block
  }
  return false;
}

// Next week = min( max weekIndex that HAS ANY score + 1, dynamic maxWeeks ).
// Map = plurality of column-A headers at that week across BRONZE/SILVER/GOLD.
// If nothing scored yet → nextWeek = 1. If a division lacks that week header, we skip it.
function getNextWeekAndMapFromSchedule_() {
  var ss = SpreadsheetApp.getActive();
  var divs = (typeof DIVISION_SHEETS !== 'undefined' && DIVISION_SHEETS.length)
    ? DIVISION_SHEETS : ['BRONZE','SILVER','GOLD'];

  var maxWeeks = detectMaxWeeks_();

  // 1) find highest week with ANY score across any division
  var maxScored = 0;
  for (var d of divs) {
    var sh = ss.getSheetByName(d);
    if (!sh) continue;
    var localMax = 0;
    for (var w = 1; w <= maxWeeks; w++) {
      if (_weekHasAnyScore_(sh, w, maxWeeks)) localMax = w;
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
    var divMax = _detectMaxWeeksForSheet_(sh);
    if (nextWeek > divMax) continue;

    var m = _readWeekMap_(sh, nextWeek);
    if (_looksLikeMapDod_(m)) {
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

//Potentially delete
function _cellDisplay_(a1) {
  var ss = SpreadsheetApp.getActive();
  var s = String(a1||'').trim();
  var shName, rng = s;
  if (s.includes('!')) { shName = s.split('!')[0]; rng = s.split('!')[1]; }
  var sh = ss.getSheetByName(shName || 'KTP Info');
  if (!sh) return '';
  return String(sh.getRange(rng).getDisplayValue() || '').trim();
}

// Aggregate the first "active" (has unscored) block across divisions.
// If multiple divisions disagree, pick the minimum weekIndex and majority map.
function getActiveWeekAndMapFromSchedule_() {
  var seen = []; // {sheet, top, map, weekIndex, hasUnscored}
  for (var d of DIVISION_SHEETS) {
    var blocks = _scanDivisionBlocks_(d);
    for (var b of blocks) {
      b.hasUnscored = _blockHasUnscored_(b);
      seen.push({ sheet:d, top:b.top, map:b.map, weekIndex:b.weekIndex, hasUnscored:b.hasUnscored });
      if (b.hasUnscored) break; // take the first active block per sheet
    }
  }
  if (!seen.length) return null;

  // Filter to candidates that are active
  var act = seen.filter(x=>x.hasUnscored);
  if (!act.length) {
    // fallback: take the highest weekIndex across sheets (latest header)
    var all = seen.sort((a,b)=>a.weekIndex - b.weekIndex);
    var last = all[all.length-1];
    return { weekNumber: last.weekIndex, map: last.map, sourceSheet: last.sheet };
  }

  // Pick the minimum week index among active, then the most common map among those
  var minWeek = Math.min.apply(null, act.map(x=>x.weekIndex));
  var cand = act.filter(x=>x.weekIndex === minWeek);

  // majority map
  var countByMap = {};
  for (var c of cand) countByMap[c.map] = (countByMap[c.map]||0)+1;
  var bestMap = Object.keys(countByMap).sort((a,b)=>countByMap[b]-countByMap[a])[0];
  var src = cand.find(x=>x.map===bestMap) || cand[0];

  return { weekNumber: minWeek, map: bestMap, sourceSheet: src.sheet };
}

function _weekTopRow_(weekIndex) {
  return MAP_HEADER_FIRST_ROW + (weekIndex - 1) * MAP_HEADER_ROW_STEP;
}

// Count how many **consecutive** week headers exist in column A for a sheet
function _detectMaxWeeksForSheet_(sheet) {
  var last = sheet.getLastRow();
  var count = 0;
  for (var w = 1; ; w++) {
    var top = _weekTopRow_(w);
    if (top > last) break;
    var v = String(sheet.getRange(top, 1).getDisplayValue() || '').trim().toLowerCase();
    var m = v.startsWith('dod_') ? v : ('dod_' + v);
    if (!_looksLikeMapDod_(m)) break;      // stop at first non-map header
    count++;
  }
  return count; // 0 if none
}

// Max weeks across all divisions (dynamic each run)
function detectMaxWeeks_() {
  var ss = SpreadsheetApp.getActive();
  var divs = (typeof DIVISION_SHEETS !== 'undefined' && DIVISION_SHEETS.length)
    ? DIVISION_SHEETS : ['BRONZE','SILVER','GOLD'];

  var maxW = 0;
  for (var d of divs) {
    var sh = ss.getSheetByName(d);
    if (!sh) continue;
    maxW = Math.max(maxW, _detectMaxWeeksForSheet_(sh));
  }
  return Math.max(1, maxW); // never less than 1
}

// Read the map token at the header row for (sheet, weekIndex); '' if invalid/missing
function _readWeekMap_(sheet, weekIndex) {
  var top = _weekTopRow_(weekIndex);
  var v = String(sheet.getRange(top, 1).getDisplayValue() || '').trim().toLowerCase();
  if (!v) return '';
  var m = v.startsWith('dod_') ? v : ('dod_' + v);
  return _looksLikeMapDod_(m) ? m : '';
}

// Does the block (week) have **any** score recorded?
function _weekHasAnyScore_(sheet, weekIndex, maxWeeks) {
  var top = _weekTopRow_(weekIndex);
  // end row is the row before the next header; if last week, use step as height
  var nextTop = (weekIndex < maxWeeks) ? _weekTopRow_(weekIndex + 1) : (top + MAP_HEADER_ROW_STEP);
  var end = Math.min(sheet.getLastRow(), nextTop - 1);
  if (end <= top) return false;

  var n = end - top; // rows below header
  var start = top + 1;
  var cVals = sheet.getRange(start, COL_T1_SC, n, 1).getValues();
  var gVals = sheet.getRange(start, COL_T2_SC, n, 1).getValues();
  for (var i = 0; i < n; i++) {
    var s1 = String(cVals[i][0] || '').trim();
    var s2 = String(gVals[i][0] || '').trim();
    if (s1 !== '' || s2 !== '') return true;
  }
  return false;
}

//Used in pollers / parsers
function isWeeklyScoresBanner_(s) {
  s = String(s||'').trim();
  return /:KTP:/i.test(s) && /\bWeek\s+\d+\b/i.test(s) && /Matches\s*-\s*/i.test(s) && /={8,}/.test(s);
}

function createWeeklyBannerTrigger_() {
  ScriptApp.newTrigger('postWeeklyScoresBanner_')
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.MONDAY)
    .atHour(8)         // Project must be set to America/New_York
    .nearMinute(0)
    .create();
}

function deleteWeeklyBannerTriggers_() {
  var all = ScriptApp.getProjectTriggers();
  for (var t of all) if (t.getHandlerFunction() === 'postWeeklyScoresBanner_') ScriptApp.deleteTrigger(t);
}

function createBannerTrigger(){
  createWeeklyBannerTrigger_();
}

function deleteBannerTrigger(){
  deleteWeeklyBannerTriggers_();
}

function manuallyPostWeeklyScoresBanner(){
  postWeeklyScoresBanner_();
}

function postWeeklyScoresBanner_() {
  if (!WEEKLY_BANNER_ENABLED) return { ok:false, reason:'disabled' };

  var left = _disp_(WEEKLY_BANNER_LEFT_CELL);
  var next = getNextWeekAndMapFromSchedule_();

  var weeknum   = next ? String(next.weekNumber) : '?';
  var prettyMap = next ? String(next.map || '') : 'TBD';

  var rule = Array(Math.max(1, WEEKLY_BANNER_RULE)).fill('=').join('');
  var header = `${EMOJI_DOD}      ${EMOJI_KTP}    **${left} Week ${weeknum} Matches - ${prettyMap}**    ${EMOJI_KTP}      ${EMOJI_DOD}\n`;
  header += `\`${rule}\``;

  relayPost_('/reply', { channelId:String(SCORES_CHANNEL_ID), content: header });

  // new: use sourceSheetName (string) in the return, no .getName()
  return { ok: !!next, posted: header, source: next ? next.sourceSheetName : '(none)' };
}