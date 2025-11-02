/*************** BYE MATCH AUTO-SCORING ***************/
/**
 * Automatically scores BYE matches with division averages
 *
 * Strategy:
 * 1. Scan all divisions (Bronze/Silver/Gold)
 * 2. For each weekly block, check if all non-BYE matches are complete
 * 3. If complete and week is past/current (not future), calculate average points
 * 4. Award BYE team the rounded average, opponent gets 0
 * 5. Skip if BYE match already has scores (manual or previous auto-fill)
 *
 * Triggered: Daily at 8:00 AM ET + Manual via UI menu
 */

/**
 * Main entry point: Process all divisions and award BYE scores
 * @returns {Object} Summary of processed BYE matches
 */
function processByeScores() {
  const divisions = (typeof DIVISION_SHEETS !== 'undefined' && DIVISION_SHEETS.length)
    ? DIVISION_SHEETS : ['Bronze', 'Silver', 'Gold'];

  const maxWeeks = detectMaxWeeks();
  const summary = {
    processed: [],
    skipped: [],
    errors: []
  };

  for (const division of divisions) {
    const sh = getSheetByName(division);
    if (!sh) {
      summary.errors.push({ division, error: 'Sheet not found' });
      continue;
    }

    for (let weekIndex = 1; weekIndex <= maxWeeks; weekIndex++) {
      try {
        const result = processWeekByeScores(sh, division, weekIndex, maxWeeks);
        if (result.processed) {
          summary.processed.push(...result.processed);
        }
        if (result.skipped) {
          summary.skipped.push(...result.skipped);
        }
      } catch (e) {
        summary.errors.push({
          division,
          week: weekIndex,
          error: String(e.message || e)
        });
        log('ERROR', 'processByeScores: week error', { division, weekIndex, error: String(e) });
      }
    }
  }

  // Log summary to Discord
  if (summary.processed.length > 0) {
    logByeSummaryToDiscord(summary);
  }

  log('INFO', 'processByeScores: complete', summary);
  return summary;
}

/**
 * Process BYE scores for a single week in a division
 * @param {Sheet} sheet - Division sheet
 * @param {string} division - Division name
 * @param {number} weekIndex - Week number (1-based)
 * @param {number} maxWeeks - Total weeks in schedule
 * @returns {Object} { processed: [], skipped: [] }
 */
function processWeekByeScores(sheet, division, weekIndex, maxWeeks) {
  const result = { processed: [], skipped: [] };

  // Check if week is past or current (not future)
  if (!isWeekPastOrCurrent(sheet, weekIndex)) {
    return result; // Skip future weeks silently
  }

  const topRow = getWeekTopRow(weekIndex);
  const mapToken = readWeekMap(sheet, weekIndex);

  if (!mapToken) {
    return result; // No valid map = skip
  }

  // Get all matches in this block
  const matches = getBlockMatches(sheet, topRow, weekIndex, maxWeeks);

  // Check if all non-BYE matches are complete
  const { complete, byeMatches, scoredMatches } = analyzeBlockCompletion(matches);

  if (!complete || byeMatches.length === 0) {
    return result; // Not ready or no BYE matches to process
  }

  // Calculate average points from scored matches
  const averagePoints = calculateAveragePoints(scoredMatches);

  // Process each BYE match
  for (const byeMatch of byeMatches) {
    const processed = scoreByeMatch(
      sheet,
      division,
      byeMatch,
      averagePoints,
      mapToken,
      weekIndex
    );

    if (processed.success) {
      result.processed.push(processed);
    } else {
      result.skipped.push(processed);
    }
  }

  return result;
}

/**
 * Check if a week is in the past or current (not future)
 * Uses week date from A29 (or date row based on index)
 * @param {Sheet} sheet - Division sheet
 * @param {number} weekIndex - Week number (1-based)
 * @returns {boolean} True if week is past or current
 */
function isWeekPastOrCurrent(sheet, weekIndex) {
  const topRow = getWeekTopRow(weekIndex);
  const dateRow = topRow + 1; // A29, A40, A51, etc.

  try {
    const dateValue = sheet.getRange(dateRow, 1).getValue();
    if (!dateValue) return false;

    const weekDate = coerceDate(dateValue);
    if (!weekDate) return false;

    const today = new Date();
    today.setHours(0, 0, 0, 0); // Normalize to midnight

    return weekDate.getTime() <= today.getTime();
  } catch (e) {
    log('WARN', 'isWeekPastOrCurrent: failed', { weekIndex, error: String(e) });
    return false;
  }
}

/**
 * Get all matches in a weekly block
 * @param {Sheet} sheet - Division sheet
 * @param {number} topRow - Block top row (map header row)
 * @param {number} weekIndex - Week number
 * @param {number} maxWeeks - Total weeks
 * @returns {Array<Object>} Match objects with row, team1, team2, score1, score2
 */
function getBlockMatches(sheet, topRow, weekIndex, maxWeeks) {
  const matches = [];
  const startRow = topRow + 1; // First match row after header
  const nextTop = (weekIndex < maxWeeks) ? getWeekTopRow(weekIndex + 1) : (topRow + MAP_HEADER_ROW_STEP);
  const endRow = Math.min(sheet.getLastRow(), nextTop - 1);
  const numRows = endRow - startRow + 1;

  if (numRows <= 0) return matches;

  // Read team names and scores in batch
  const teamData = sheet.getRange(startRow, COL_T1_NAME, numRows, 1).getDisplayValues();
  const team2Data = sheet.getRange(startRow, COL_T2_NAME, numRows, 1).getDisplayValues();
  const score1Data = sheet.getRange(startRow, COL_T1_SC, numRows, 1).getDisplayValues();
  const score2Data = sheet.getRange(startRow, COL_T2_SC, numRows, 1).getDisplayValues();

  for (let i = 0; i < numRows; i++) {
    const row = startRow + i;
    const team1 = String(teamData[i][0] || '').trim().toUpperCase();
    const team2 = String(team2Data[i][0] || '').trim().toUpperCase();
    const score1Str = String(score1Data[i][0] || '').trim();
    const score2Str = String(score2Data[i][0] || '').trim();

    if (!team1 && !team2) continue; // Empty row

    const score1 = score1Str === '' ? null : Number(score1Str);
    const score2 = score2Str === '' ? null : Number(score2Str);

    matches.push({
      row,
      team1,
      team2,
      score1,
      score2,
      isBye: isByeMatch(team1, team2)
    });
  }

  return matches;
}

/**
 * Check if a match involves BYE
 * @param {string} team1 - Team 1 name (uppercase)
 * @param {string} team2 - Team 2 name (uppercase)
 * @returns {boolean} True if either team is BYE
 */
function isByeMatch(team1, team2) {
  return /^BYE$/i.test(team1) || /^BYE$/i.test(team2);
}

/**
 * Analyze block completion status
 * @param {Array<Object>} matches - All matches in block
 * @returns {Object} { complete: boolean, byeMatches: [], scoredMatches: [] }
 */
function analyzeBlockCompletion(matches) {
  const byeMatches = [];
  const scoredMatches = [];
  const unscoredNonBye = [];

  for (const match of matches) {
    if (match.isBye) {
      byeMatches.push(match);
    } else {
      // Non-BYE match must have both scores
      if (match.score1 !== null && match.score2 !== null &&
          !isNaN(match.score1) && !isNaN(match.score2)) {
        scoredMatches.push(match);
      } else {
        unscoredNonBye.push(match);
      }
    }
  }

  const complete = (unscoredNonBye.length === 0) && (scoredMatches.length > 0);

  return { complete, byeMatches, scoredMatches };
}

/**
 * Calculate average points from scored matches
 * @param {Array<Object>} scoredMatches - Matches with scores
 * @returns {number} Rounded average points (0 if no matches)
 */
function calculateAveragePoints(scoredMatches) {
  if (scoredMatches.length === 0) return 0;

  let totalPoints = 0;
  let count = 0;

  for (const match of scoredMatches) {
    totalPoints += match.score1;
    totalPoints += match.score2;
    count += 2;
  }

  const average = totalPoints / count;
  return Math.round(average);
}

/**
 * Score a single BYE match
 * @param {Sheet} sheet - Division sheet
 * @param {string} division - Division name
 * @param {Object} byeMatch - Match object
 * @param {number} averagePoints - Calculated average
 * @param {string} mapToken - Map name
 * @param {number} weekIndex - Week number
 * @returns {Object} Processing result
 */
function scoreByeMatch(sheet, division, byeMatch, averagePoints, mapToken, weekIndex) {
  const { row, team1, team2, score1, score2 } = byeMatch;

  // Skip if already scored
  if (score1 !== null || score2 !== null) {
    return {
      success: false,
      reason: 'already_scored',
      division,
      week: weekIndex,
      row,
      team1,
      team2
    };
  }

  // Determine which team gets average (non-BYE team) and which gets 0 (BYE)
  const byeIsTeam1 = /^BYE$/i.test(team1);
  const activeTeam = byeIsTeam1 ? team2 : team1;
  const scoreActive = averagePoints;
  const scoreBye = 0;

  // Determine W/L
  const wlActive = 'W';
  const wlBye = 'L';

  // Check for protected ranges
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

  if (blocked) {
    return {
      success: false,
      reason: 'protected',
      division,
      week: weekIndex,
      row,
      team1,
      team2
    };
  }

  // Write scores (batch write)
  const currentRow = sheet.getRange(row, COL_T1_WL, 1, COL_T2_SC - COL_T1_WL + 1).getValues()[0];

  if (byeIsTeam1) {
    // BYE is team1, active is team2
    currentRow[0] = wlBye;                        // Column B (team1 W/L)
    currentRow[COL_T1_SC - COL_T1_WL] = scoreBye; // Column D (team1 score)
    currentRow[COL_T2_WL - COL_T1_WL] = wlActive; // Column F (team2 W/L)
    currentRow[COL_T2_SC - COL_T1_WL] = scoreActive; // Column H (team2 score)
  } else {
    // Active is team1, BYE is team2
    currentRow[0] = wlActive;                        // Column B (team1 W/L)
    currentRow[COL_T1_SC - COL_T1_WL] = scoreActive; // Column D (team1 score)
    currentRow[COL_T2_WL - COL_T1_WL] = wlBye;       // Column F (team2 W/L)
    currentRow[COL_T2_SC - COL_T1_WL] = scoreBye;    // Column H (team2 score)
  }

  sheet.getRange(row, COL_T1_WL, 1, COL_T2_SC - COL_T1_WL + 1).setValues([currentRow]);

  // Write receipt
  const scoreC = byeIsTeam1 ? scoreBye : scoreActive;
  const scoreG = byeIsTeam1 ? scoreActive : scoreBye;

  writeReceipt(
    division,
    row,
    mapToken,
    team1,
    team2,
    scoreC,
    scoreG,
    '', // no messageId
    '', // no authorId
    'BYE_AUTO',
    '', // no contentHash
    ''  // no editedTs
  );

  log('INFO', 'scoreByeMatch: success', {
    division,
    week: weekIndex,
    row,
    activeTeam,
    averagePoints
  });

  return {
    success: true,
    division,
    week: weekIndex,
    row,
    team1,
    team2,
    activeTeam,
    averagePoints
  };
}

/**
 * Log BYE scoring summary to Discord
 * @param {Object} summary - Processing summary
 */
function logByeSummaryToDiscord(summary) {
  if (!RESULTS_LOG_CHANNEL || summary.processed.length === 0) return;

  const lines = [];
  lines.push('✅ **BYE Matches Auto-Scored**');

  // Group by division
  const byDiv = {};
  for (const item of summary.processed) {
    if (!byDiv[item.division]) byDiv[item.division] = [];
    byDiv[item.division].push(item);
  }

  for (const div in byDiv) {
    const items = byDiv[div];
    lines.push(`\n**${div}:**`);
    for (const item of items) {
      lines.push(`• Week ${item.week}: ${item.activeTeam} awarded ${item.averagePoints} pts`);
    }
  }

  const content = lines.join('\n');

  try {
    relayPost('/reply', {
      channelId: String(RESULTS_LOG_CHANNEL),
      content: content
    });
  } catch (e) {
    log('ERROR', 'logByeSummaryToDiscord: failed', { error: String(e) });
  }
}

/**
 * Helper: coerce various date formats to Date object
 * @param {*} dateValue - Date value from sheet
 * @returns {Date|null} Date object or null
 */
function coerceDate(dateValue) {
  if (dateValue instanceof Date) return dateValue;
  if (typeof dateValue === 'number') return new Date(dateValue);
  if (typeof dateValue === 'string') {
    const d = new Date(dateValue);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/*************** TIME-BASED TRIGGER MANAGEMENT ***************/

/**
 * Create daily trigger for BYE scoring (8:00 AM ET)
 * Requires project timezone = America/New_York
 */
function createByeScoringTrigger() {
  ScriptApp.newTrigger('processByeScores')
    .timeBased()
    .everyDays(1)
    .atHour(8)
    .nearMinute(0)
    .create();

  log('INFO', 'createByeScoringTrigger: created');
}

/**
 * Delete all triggers for BYE scoring
 */
function deleteByeScoringTriggers() {
  const all = ScriptApp.getProjectTriggers();
  let count = 0;
  for (const t of all) {
    if (t.getHandlerFunction() === 'processByeScores') {
      ScriptApp.deleteTrigger(t);
      count++;
    }
  }
  log('INFO', 'deleteByeScoringTriggers: deleted', { count });
}

/*************** UI MENU WRAPPERS ***************/

/**
 * UI wrapper: Manually process BYE scores
 */
function manualProcessByeScores() {
  const result = processByeScores();
  const msg = `BYE Scoring Complete!\n\nProcessed: ${result.processed.length}\nSkipped: ${result.skipped.length}\nErrors: ${result.errors.length}`;
  SpreadsheetApp.getUi().alert(msg);
}

/**
 * UI wrapper: Create BYE scoring trigger
 */
function uiCreateByeTrigger() {
  createByeScoringTrigger();
  SpreadsheetApp.getUi().alert('BYE scoring trigger created (Daily at 8:00 AM ET)');
}

/**
 * UI wrapper: Delete BYE scoring triggers
 */
function uiDeleteByeTrigger() {
  deleteByeScoringTriggers();
  SpreadsheetApp.getUi().alert('BYE scoring triggers deleted');
}
