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
  const { complete, byeMatches, scoredMatches, unscoredNonBye } = analyzeBlockCompletion(matches);

  if (!complete) {
    // Log why we're skipping (helps debug premature/late scoring issues)
    if (unscoredNonBye.length > 0) {
      log('DEBUG', 'BYE scoring skipped: incomplete week', {
        division,
        week: weekIndex,
        map: mapToken,
        totalMatches: matches.length,
        scored: scoredMatches.length,
        unscored: unscoredNonBye.length,
        bye: byeMatches.length,
        unscoredRows: unscoredNonBye.map(m => m.row)
      });
    }
    return result;
  }

  if (byeMatches.length === 0) {
    return result; // No BYE matches to process
  }

  // Verify at least one match has numeric scores (not just W/L flags)
  const hasNumericScores = scoredMatches.some(m =>
    (m.score1 !== null && !isNaN(m.score1)) || (m.score2 !== null && !isNaN(m.score2))
  );

  if (!hasNumericScores) {
    log('WARN', 'BYE scoring skipped: no numeric scores available for averaging', {
      division,
      week: weekIndex,
      map: mapToken,
      scoredMatchCount: scoredMatches.length
    });
    return result;
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
 * @returns {Array<Object>} Match objects with row, team1, team2, score1, score2, wl1, wl2
 */
function getBlockMatches(sheet, topRow, weekIndex, maxWeeks) {
  const matches = [];
  const startRow = topRow + 1; // First match row after header
  const nextTop = (weekIndex < maxWeeks) ? getWeekTopRow(weekIndex + 1) : (topRow + MAP_HEADER_ROW_STEP);
  const endRow = Math.min(sheet.getLastRow(), nextTop - 1);
  const numRows = endRow - startRow + 1;

  if (numRows <= 0) return matches;

  // Read team names, W/L flags, and scores in batch
  const wl1Data = sheet.getRange(startRow, COL_T1_WL, numRows, 1).getDisplayValues();
  const teamData = sheet.getRange(startRow, COL_T1_NAME, numRows, 1).getDisplayValues();
  const score1Data = sheet.getRange(startRow, COL_T1_SC, numRows, 1).getDisplayValues();
  const wl2Data = sheet.getRange(startRow, COL_T2_WL, numRows, 1).getDisplayValues();
  const team2Data = sheet.getRange(startRow, COL_T2_NAME, numRows, 1).getDisplayValues();
  const score2Data = sheet.getRange(startRow, COL_T2_SC, numRows, 1).getDisplayValues();

  for (let i = 0; i < numRows; i++) {
    const row = startRow + i;
    const team1 = String(teamData[i][0] || '').trim().toUpperCase();
    const team2 = String(team2Data[i][0] || '').trim().toUpperCase();
    const wl1Str = String(wl1Data[i][0] || '').trim();
    const wl2Str = String(wl2Data[i][0] || '').trim();
    const score1Str = String(score1Data[i][0] || '').trim();
    const score2Str = String(score2Data[i][0] || '').trim();

    if (!team1 && !team2) continue; // Empty row

    const score1 = score1Str === '' ? null : Number(score1Str);
    const score2 = score2Str === '' ? null : Number(score2Str);
    const wl1 = wl1Str === '' ? null : wl1Str;
    const wl2 = wl2Str === '' ? null : wl2Str;

    matches.push({
      row,
      team1,
      team2,
      score1,
      score2,
      wl1,
      wl2,
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
 *
 * A match is considered "scored" if it has EITHER:
 * - Valid scores in both columns D and H, OR
 * - W/L flags in both columns B and F
 *
 * @param {Array<Object>} matches - All matches in block (with wl1, wl2, score1, score2)
 * @returns {Object} { complete: boolean, byeMatches: [], scoredMatches: [], unscoredNonBye: [] }
 */
function analyzeBlockCompletion(matches) {
  const byeMatches = [];
  const scoredMatches = [];
  const unscoredNonBye = [];

  for (const match of matches) {
    if (match.isBye) {
      byeMatches.push(match);
    } else {
      // Check if match has scores (D and H)
      const hasScores = (match.score1 !== null && match.score2 !== null &&
                        !isNaN(match.score1) && !isNaN(match.score2));

      // Check if match has W/L flags (B and F)
      const hasWL = (match.wl1 !== null && match.wl2 !== null);

      // Match is scored if it has EITHER scores OR W/L flags
      if (hasScores || hasWL) {
        scoredMatches.push(match);
      } else {
        // Has team names but missing both scores AND W/L flags
        unscoredNonBye.push(match);
      }
    }
  }

  // Verify accounting (defensive check - should always be true)
  const totalAccounted = byeMatches.length + scoredMatches.length + unscoredNonBye.length;
  if (totalAccounted !== matches.length) {
    log('ERROR', 'Block completion accounting mismatch', {
      total: matches.length,
      accounted: totalAccounted,
      byeCount: byeMatches.length,
      scoredCount: scoredMatches.length,
      unscoredCount: unscoredNonBye.length
    });
  }

  // Block is complete only if ALL of these conditions are met:
  // 1. NO unscored non-BYE matches remain (no matches with teams but no scores/WL)
  // 2. At least one non-BYE match has been scored (needed to calculate average)
  // 3. We have at least 2 total scheduled matches (scored + bye) to avoid premature scoring
  //    of sparsely populated weeks that may have more matches added later
  const minTotalMatches = 2;
  const totalScheduled = scoredMatches.length + byeMatches.length;

  const complete = (unscoredNonBye.length === 0) &&
                   (scoredMatches.length > 0) &&
                   (totalScheduled >= minTotalMatches);

  return { complete, byeMatches, scoredMatches, unscoredNonBye };
}

/**
 * Calculate average points from scored matches
 * Only uses matches with valid numeric scores (ignores matches with only W/L flags)
 * @param {Array<Object>} scoredMatches - Matches considered scored
 * @returns {number} Rounded average points (0 if no matches with numeric scores)
 */
function calculateAveragePoints(scoredMatches) {
  if (scoredMatches.length === 0) return 0;

  let totalPoints = 0;
  let count = 0;

  for (const match of scoredMatches) {
    // Only include matches with valid numeric scores
    const hasValidScore1 = (match.score1 !== null && !isNaN(match.score1));
    const hasValidScore2 = (match.score2 !== null && !isNaN(match.score2));

    if (hasValidScore1) {
      totalPoints += match.score1;
      count++;
    }
    if (hasValidScore2) {
      totalPoints += match.score2;
      count++;
    }
  }

  if (count === 0) return 0; // No valid scores to average

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
  const { row, team1, team2, score1, score2, wl1, wl2 } = byeMatch;

  // Skip if already scored (has scores OR W/L flags)
  const hasScores = (score1 !== null || score2 !== null);
  const hasWL = (wl1 !== null || wl2 !== null);

  if (hasScores || hasWL) {
    return {
      success: false,
      reason: 'already_scored',
      division,
      week: weekIndex,
      row,
      team1,
      team2,
      hadScores: hasScores,
      hadWL: hasWL
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
