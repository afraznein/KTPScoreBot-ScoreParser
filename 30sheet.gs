/*************** MAP-FIRST BLOCK SEARCH ***************/
/**
 * Find weekly block in sheet by map token (searches column A)
 * Prefers the block with date closest to today
 *
 * @param {Sheet} sheet - Google Sheets object (Bronze/Silver/Gold)
 * @param {string} targetMapLower - Lowercase map token (e.g., "dod_lennon2")
 * @returns {Object|null} { top: row, weekDate: Date, mapLower: string } or null if not found
 */
function findBlockByMap(sheet, targetMapLower) {
  const start = GRID.startRow, step = GRID.rowsPerBlock, last = sheet.getLastRow(), today = new Date();
  let best = null, bestScore = 1e15;
  for (let top = start; top <= last; top += step) {
    const mapCell = String(sheet.getRange(top, 1).getValue() || '').trim().toLowerCase(); // A[top]
    if (!mapCell || mapCell !== targetMapLower) continue;
    const dateCell = sheet.getRange(top + 1, 1).getValue();                                // A[top+1]
    const weekDate = coerceDate_(dateCell);
    const score = weekDate ? Math.abs(weekDate.getTime() - today.getTime()) : 5e14;       // prefer nearest
    if (score < bestScore) { bestScore = score; best = { top, weekDate, mapLower: mapCell }; }
  }
  return best; // or null
}

/**
 * Find team matchup within a weekly block
 * Searches GRID.matchesPerBlock rows for the two teams (order-agnostic)
 *
 * @param {Sheet} sheet - Google Sheets object
 * @param {number} blockTop - Starting row of weekly block
 * @param {string} teamAUpper - First team name (UPPERCASE)
 * @param {string} teamBUpper - Second team name (UPPERCASE)
 * @returns {Object|null} { rowIndex: number, t1: string, t2: string } or null if not found
 */
function findTeamsInBlock(sheet, blockTop, teamAUpper, teamBUpper) {
  const vals = sheet.getRange(blockTop, 1, GRID.matchesPerBlock, GRID.cols).getValues();
  for (let i = 0; i < vals.length; i++) {
    const row = vals[i];
    const c = String(row[COL_T1_NAME - 1] || '').trim().toUpperCase(); // C
    const g = String(row[COL_T2_NAME - 1] || '').trim().toUpperCase(); // G
    if (!c || !g) continue;
    if ((c === teamAUpper && g === teamBUpper) || (c === teamBUpper && g === teamAUpper)) {
      return { rowIndex: i, t1: c, t2: g };
    }
  }
  return null;
}

/**
 * Autodetect division and sheet row for a team matchup
 * Strategy: Search by map first across all divisions, prefer provided division
 *
 * @param {string} mapRaw - Map token (raw)
 * @param {string} team1Raw - First team name (raw)
 * @param {string} team2Raw - Second team name (raw)
 * @param {string|null} preferredDivision - Optional preferred division to search first
 * @returns {Object|null} { division, sheet, row, map, team1, team2, weekDate } or null
 */
function autodetectDivisionAndRow(mapRaw, team1Raw, team2Raw, preferredDivision) {
  let mapLower = String(mapRaw || '').trim().toLowerCase();
  if (!mapLower) return null;
  if (!mapLower.startsWith('dod_')) mapLower = 'dod_' + mapLower;

  const aU = normalizeTeamName_(team1Raw);
  const bU = normalizeTeamName_(team2Raw);

  const order = [];
  if (preferredDivision && DIVISION_SHEETS.includes(preferredDivision)) order.push(preferredDivision);
  for (const d of DIVISION_SHEETS) if (!order.includes(d)) order.push(d);

  for (const division of order) {
    const sh = getSheetByName_(division);
    if (!sh) continue;
    const block = findBlockByMap(sh, mapLower);
    if (!block) continue;
    const hit = findTeamsInBlock(sh, block.top, aU, bU);
    if (hit) {
      return { division, sheet: sh, row: block.top + hit.rowIndex, map: mapLower, team1: hit.t1, team2: hit.t2, weekDate: block.weekDate };
    }
  }
  return null;
}

/*************** SCORES HELPERS ***************/
/**
 * Check if sheet scores already match target scores (for idempotency)
 *
 * @param {Sheet} sheet - Google Sheets object
 * @param {number} row - Row number
 * @param {number} scoreC - Target score for column C team
 * @param {number} scoreG - Target score for column G team
 * @returns {boolean} True if current values match target
 */
function scoresAlreadyMatch(sheet, row, scoreC, scoreG) {
  const curC = String(sheet.getRange(row, COL_T1_SC).getDisplayValue() || '').trim();
  const curG = String(sheet.getRange(row, COL_T2_SC).getDisplayValue() || '').trim();
  const cNum = curC === '' ? null : Number(curC);
  const gNum = curG === '' ? null : Number(curG);
  return (cNum === scoreC) && (gNum === scoreG);
}

/**
 * Apply parsed scores to sheet row with full validation
 * Handles: team matching, placeholders, protected ranges, W/L calculation, receipts
 *
 * @param {Sheet} sheet - Google Sheets object
 * @param {number} row - Row number to write to
 * @param {string} sheetT1Upper - Team1 name from sheet (UPPERCASE)
 * @param {string} sheetT2Upper - Team2 name from sheet (UPPERCASE)
 * @param {Object} parsed - Parsed score object from parseScoreLine_
 * @returns {Object} { ok: boolean, reason?: string, prev?: Object, prevScores?: Array, noChange?: boolean }
 */
function applyScoresToRow(sheet, row, sheetT1Upper, sheetT2Upper, parsed) {
  const leftTeam   = String(parsed.team1 || '');
  const rightTeam  = String(parsed.team2 || '');
  const leftScore  = Number(parsed.score1);
  const rightScore = Number(parsed.score2);

  // Ambiguous alias guard
  if (leftTeam.startsWith(AMBIGUOUS_ALIAS_PREFIX) || rightTeam.startsWith(AMBIGUOUS_ALIAS_PREFIX)) {
    log('WARN','Ambiguous alias used', { row, leftTeam, rightTeam });
    return { ok:false, reason:'ambiguous_alias' };
  }

  // Resolve which side maps to sheet columns (C/G = t1/t2 on sheet)
  let scoreC, scoreG;
  if (leftTeam === sheetT1Upper && rightTeam === sheetT2Upper) { scoreC = leftScore; scoreG = rightScore; }
  else if (leftTeam === sheetT2Upper && rightTeam === sheetT1Upper) { scoreC = rightScore; scoreG = leftScore; }
  else {
    log('WARN','applyScoresToRow: team mismatch against sheet row', { row, sheet: sheet.getName(), sheetT1Upper, sheetT2Upper, leftTeam, rightTeam });
    return { ok:false, reason:'row_team_mismatch' };
  }

  // Skip if either side is a placeholder for this sheet's division
  const divisionUpper = sheet.getName().toUpperCase();
  if (leftTeam === PLACEHOLDER_TOKEN || rightTeam === PLACEHOLDER_TOKEN ||
      isPlaceholderTeamForDiv(leftTeam, divisionUpper) ||
      isPlaceholderTeamForDiv(rightTeam, divisionUpper)) {
    log('INFO','Skip placeholder team', { row, division: divisionUpper, leftTeam, rightTeam });
    return { ok:false, reason:'placeholder_token' };
  }

  // Compute W/L flags
  let t1WL = '', t2WL = '';
  if (scoreC > scoreG) { t1WL = 'W'; t2WL = 'L'; }
  else if (scoreG > scoreC) { t1WL = 'L'; t2WL = 'W'; }

  // Check existing receipt (to know if this is an EDIT vs NEW)
  const division = sheet.getName();
  const prevReceipt = findExistingReceipt(division, row);

  // Read existing sheet scores BEFORE any write (for logging and "was …" text)
  // BATCH READ: Get both scores in one API call (columns D and H)
  const prevScores = sheet.getRange(row, COL_T1_SC, 1, COL_T2_SC - COL_T1_SC + 1).getDisplayValues()[0];
  const prevC = String(prevScores[0] || '').trim();
  const prevG = String(prevScores[COL_T2_SC - COL_T1_SC] || '').trim();
  const prevCnum = prevC === '' ? null : Number(prevC);
  const prevGnum = prevG === '' ? null : Number(prevG);
  const scoresEqual = (prevCnum === scoreC) && (prevGnum === scoreG);

  // Guard protected ranges
  const prot = sheet.getProtections(SpreadsheetApp.ProtectionType.RANGE) || [];
  const blocked = prot.some(p => {
    const r = p.getRange();
    return r.getSheet().getName() === sheet.getName() &&
           r.getRow() <= row && r.getLastRow() >= row &&
           ((r.getColumn() <= COL_T1_WL && r.getLastColumn() >= COL_T1_WL) ||
            (r.getColumn() <= COL_T1_SC && r.getLastColumn() >= COL_T1_SC) ||
            (r.getColumn() <= COL_T2_WL && r.getLastColumn() >= COL_T2_WL) ||
            (r.getColumn() <= COL_T2_SC && r.getLastColumn() >= COL_T2_SC));
  });
  if (blocked) return { ok:false, reason:'protected' };

  // REPARSE: if sheet already has the same numbers, do NOT touch cells; just receipt NOCHANGE
  if (REPARSE_FORCE && scoresAlreadyMatch(sheet, row, scoreC, scoreG)) {
    writeReceipt(sheet.getName(), row, parsed.map, sheetT1Upper, sheetT2Upper,
                  scoreC, scoreG, parsed.__msgId || '', parsed.__authorId || '',
                  'REPARSE_NOCHANGE', parsed.__contentHash || '', parsed.__editedTs || '');
    return {
      ok: true,
      prev: prevReceipt,
      prevScores: [prevC === '' ? '' : prevCnum, prevG === '' ? '' : prevGnum],
      noChange: true
    };
  }

  // If not reparse and scoresEqual, we still allow a lightweight "no-change" path:
  // touch nothing, but still write an EDIT receipt if there was an earlier receipt
  if (!REPARSE_FORCE && scoresEqual && prevReceipt) {
    writeReceipt(division, row, parsed.map, sheetT1Upper, sheetT2Upper,
                  scoreC, scoreG, parsed.__msgId || '', parsed.__authorId || '',
                  'EDIT_NOCHANGE', parsed.__contentHash || '', parsed.__editedTs || '');
    return {
      ok: true,
      prev: prevReceipt,
      prevScores: [prevC === '' ? '' : prevCnum, prevG === '' ? '' : prevGnum],
      noChange: true
    };
  }

  // Write new values
  // BATCH WRITE: Set all 4 values (W/L and scores for both teams) in one API call
  // Row format: [t1WL (B), t1Name (C), t1Score (D), space (E), t2WL (F), t2Name (G), t2Score (H)]
  // We write columns B, D, F, H but need to preserve C, E, G
  const currentRow = sheet.getRange(row, COL_T1_WL, 1, COL_T2_SC - COL_T1_WL + 1).getValues()[0];
  currentRow[0] = t1WL;                        // Column B (COL_T1_WL - COL_T1_WL = 0)
  currentRow[COL_T1_SC - COL_T1_WL] = scoreC;  // Column D
  currentRow[COL_T2_WL - COL_T1_WL] = t2WL;    // Column F
  currentRow[COL_T2_SC - COL_T1_WL] = scoreG;  // Column H
  sheet.getRange(row, COL_T1_WL, 1, COL_T2_SC - COL_T1_WL + 1).setValues([currentRow]);

  // Audit trail
  const note = parsed.noteFF ? 'FF' : (prevReceipt ? 'EDIT' : 'NEW');
  writeReceipt(division, row, parsed.map, sheetT1Upper, sheetT2Upper,
                scoreC, scoreG, parsed.__msgId || '', parsed.__authorId || '',
                note, parsed.__contentHash || '', parsed.__editedTs || '');

  // Operand sanity logs (unchanged)
  if (parsed.op === '>' && !(parsed.score1 > parsed.score2)) {
    log('INFO','Operand/scores mismatch (>)', { msgLeft: parsed.score1, msgRight: parsed.score2, resolvedC: scoreC, resolvedG: scoreG });
  }
  if (parsed.op === '<' && !(parsed.score1 < parsed.score2)) {
    log('INFO','Operand/scores mismatch (<)', { msgLeft: parsed.score1, msgRight: parsed.score2, resolvedC: scoreC, resolvedG: scoreG });
  }

  return {
    ok: true,
    prev: prevReceipt,
    prevScores: [prevC === '' ? '' : prevCnum, prevG === '' ? '' : prevGnum]
  };
}