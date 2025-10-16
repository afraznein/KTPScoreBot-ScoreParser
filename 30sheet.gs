/*************** MAP-FIRST BLOCK SEARCH ***************/
function findBlockByMap_(sheet, targetMapLower) {
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

function findTeamsInBlock_(sheet, blockTop, teamAUpper, teamBUpper) {
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

/** Autodetect division/row by map first; prefer provided division if given. */
function autodetectDivisionAndRow_(mapRaw, team1Raw, team2Raw, preferredDivision) {
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
    const block = findBlockByMap_(sh, mapLower);
    if (!block) continue;
    const hit = findTeamsInBlock_(sh, block.top, aU, bU);
    if (hit) {
      return { division, sheet: sh, row: block.top + hit.rowIndex, map: mapLower, team1: hit.t1, team2: hit.t2, weekDate: block.weekDate };
    }
  }
  return null;
}

/*************** SCORES HELPERS ***************/
function scoresAlreadyMatch_(sheet, row, scoreC, scoreG) {
  const curC = String(sheet.getRange(row, COL_T1_SC).getDisplayValue() || '').trim();
  const curG = String(sheet.getRange(row, COL_T2_SC).getDisplayValue() || '').trim();
  const cNum = curC === '' ? null : Number(curC);
  const gNum = curG === '' ? null : Number(curG);
  return (cNum === scoreC) && (gNum === scoreG);
}


function applyScoresToRow_(sheet, row, sheetT1Upper, sheetT2Upper, parsed) {
  const leftTeam   = String(parsed.team1 || '');
  const rightTeam  = String(parsed.team2 || '');
  const leftScore  = Number(parsed.score1);
  const rightScore = Number(parsed.score2);

  // Ambiguous alias guard
  if (leftTeam.startsWith('__AMBIG_ALIAS__') || rightTeam.startsWith('__AMBIG_ALIAS__')) {
    log_('WARN','Ambiguous alias used', { row, leftTeam, rightTeam });
    return { ok:false, reason:'ambiguous_alias' };
  }

  // Resolve which side maps to sheet columns (C/G = t1/t2 on sheet)
  let scoreC, scoreG;
  if (leftTeam === sheetT1Upper && rightTeam === sheetT2Upper) { scoreC = leftScore; scoreG = rightScore; }
  else if (leftTeam === sheetT2Upper && rightTeam === sheetT1Upper) { scoreC = rightScore; scoreG = leftScore; }
  else {
    log_('WARN','applyScoresToRow_: team mismatch against sheet row', { row, sheet: sheet.getName(), sheetT1Upper, sheetT2Upper, leftTeam, rightTeam });
    return { ok:false, reason:'row_team_mismatch' };
  }

  // Skip if either side is a placeholder for this sheet's division
  const divisionUpper = sheet.getName().toUpperCase();
  if (leftTeam === '__PLACEHOLDER__' || rightTeam === '__PLACEHOLDER__' ||
      isPlaceholderTeamForDiv_(leftTeam, divisionUpper) ||
      isPlaceholderTeamForDiv_(rightTeam, divisionUpper)) {
    log_('INFO','Skip placeholder team', { row, division: divisionUpper, leftTeam, rightTeam });
    return { ok:false, reason:'placeholder_team' };
  }

  // Compute W/L flags
  let t1WL = '', t2WL = '';
  if (scoreC > scoreG) { t1WL = 'W'; t2WL = 'L'; }
  else if (scoreG > scoreC) { t1WL = 'L'; t2WL = 'W'; }

  // Check existing receipt (to know if this is an EDIT vs NEW)
  const division = sheet.getName();
  const prevReceipt = findExistingReceipt_(division, row);

  // Read existing sheet scores BEFORE any write (for logging and “was …” text)
  const prevC = String(sheet.getRange(row, COL_T1_SC).getDisplayValue() || '').trim();
  const prevG = String(sheet.getRange(row, COL_T2_SC).getDisplayValue() || '').trim();
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
  if (REPARSE_FORCE && scoresAlreadyMatch_(sheet, row, scoreC, scoreG)) {
    writeReceipt_(sheet.getName(), row, parsed.map, sheetT1Upper, sheetT2Upper,
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
    writeReceipt_(division, row, parsed.map, sheetT1Upper, sheetT2Upper,
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
  sheet.getRange(row, COL_T1_WL).setValue(t1WL);
  sheet.getRange(row, COL_T1_SC).setValue(scoreC);
  sheet.getRange(row, COL_T2_WL).setValue(t2WL);
  sheet.getRange(row, COL_T2_SC).setValue(scoreG);

  // Audit trail
  const note = parsed.noteFF ? 'FF' : (prevReceipt ? 'EDIT' : 'NEW');
  writeReceipt_(division, row, parsed.map, sheetT1Upper, sheetT2Upper,
                scoreC, scoreG, parsed.__msgId || '', parsed.__authorId || '',
                note, parsed.__contentHash || '', parsed.__editedTs || '');

  // Operand sanity logs (unchanged)
  if (parsed.op === '>' && !(parsed.score1 > parsed.score2)) {
    log_('INFO','Operand/scores mismatch (>)', { msgLeft: parsed.score1, msgRight: parsed.score2, resolvedC: scoreC, resolvedG: scoreG });
  }
  if (parsed.op === '<' && !(parsed.score1 < parsed.score2)) {
    log_('INFO','Operand/scores mismatch (<)', { msgLeft: parsed.score1, msgRight: parsed.score2, resolvedC: scoreC, resolvedG: scoreG });
  }

  return {
    ok: true,
    prev: prevReceipt,
    prevScores: [prevC === '' ? '' : prevCnum, prevG === '' ? '' : prevGnum]
  };
}