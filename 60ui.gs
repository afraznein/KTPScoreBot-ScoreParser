/*************** MENU UI AND WRAPPERS ***************/
/**
 * Google Sheets onOpen trigger - creates custom menu
 * Automatically runs when spreadsheet opens
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Discord Scores')
    .addItem('Poll Now (Scores Channel)', 'WM_pollNow')
    .addItem('Poll From Message ID… ', 'UI_pollFromIdOnce')
    .addSeparator()
    .addItem('Set Poll Pointer…', 'uiSetPollPointer')
    .addItem('Show Poll Pointer', 'uiShowPollPointerLink')
    .addItem('Jump Pointer to Latest', 'uiJumpPointerToLatest')
    .addSeparator()
    .addItem('Create Banner Trigger', 'createBannerTrigger')
    .addItem('Remove Banner Trigger', 'deleteBannerTrigger')
    .addToUi();
}

/**
 * UI: Prompt user for Discord message ID and poll from that point
 * Asks whether to include the starting message or start after it
 */
function UI_pollFromIdOnce() {
  const ui = SpreadsheetApp.getUi();

  // Prompt for the snowflake ID
  const idResp = ui.prompt(
    'Poll From Message ID',
    'Enter the Discord message ID (snowflake) to start from:',
    ui.ButtonSet.OK_CANCEL
  );
  if (idResp.getSelectedButton() !== ui.Button.OK) return;
  const startId = (idResp.getResponseText() || '').trim();
  if (!startId) { ui.alert('Message ID is required.'); return; }

  // Validate it’s numeric-ish BigInt
  try { void BigInt(startId); } catch (e) {
    ui.alert('That does not look like a valid Discord snowflake (numeric string).');
    return;
  }

  // Ask whether to include the start message
  const incResp = ui.alert(
    'Include the starting message?',
    'Click YES to include the given message ID (≥). Click NO to start strictly after it (>).',
    ui.ButtonSet.YES_NO_CANCEL
  );
  if (incResp === ui.Button.CANCEL) return;
  const includeStart = (incResp === ui.Button.YES);

  // Optional: temporarily disable backfill in this ad-hoc run
  const priorBackfill = (typeof BACKFILL_ENABLED !== 'undefined') ? BACKFILL_ENABLED : true;
  try {
    if (typeof BACKFILL_ENABLED !== 'undefined') BACKFILL_ENABLED = false;
    const processed = WM_pollFromIdOnce(startId, includeStart);
    ui.alert(`Done. Processed ${processed} message(s).`);
  } finally {
    if (typeof BACKFILL_ENABLED !== 'undefined') BACKFILL_ENABLED = priorBackfill;
  }
}

// --- UI: Set the poll pointer (cursor) for the Scores channel ---
function uiSetPollPointer() {
  const ui = SpreadsheetApp.getUi();

  const current = _getScoresCursorSafe_(); // read current (string or '')
  ui.alert('Current Poll Pointer', current ? current : '(none set)', ui.ButtonSet.OK);

  // Prompt for a new message ID (Discord snowflake)
  const resp = ui.prompt(
    'Set Poll Pointer',
    'Enter a Discord message ID to use as the poll cursor.\n' +
    'The next "Poll Now" will only process messages AFTER this ID.\n\n' +
    'Leave blank and click OK to CLEAR the cursor.',
    ui.ButtonSet.OK_CANCEL
  );
  if (resp.getSelectedButton() !== ui.Button.OK) return;

  const raw = (resp.getResponseText() || '').trim();
  if (!raw) {
    // clear
    _clearScoresCursorSafe_();
    ui.alert('Poll pointer cleared.');
    return;
  }

  // Validate that it looks like a snowflake (numeric BigInt)
  try { void BigInt(raw); } catch (e) {
    ui.alert('That does not look like a valid Discord message ID (numeric string). No changes made.');
    return;
  }

  _setScoresCursorSafe_(raw);
  ui.alert('Poll pointer set.', `New cursor: ${raw}`, ui.ButtonSet.OK);
}

// --- UI: Show pointer (handy when debugging) ---
function uiShowPollPointer() {
  const ui = SpreadsheetApp.getUi();
  const current = _getScoresCursorSafe_();
  ui.alert('Current Poll Pointer', current ? current : '(none set)', ui.ButtonSet.OK);
}

function uiShowPollPointerLink() {
  const id = _getScoresCursorSafe_();
  if (!id) {
    SpreadsheetApp.getUi().alert('No poll pointer set yet.');
    return;
  }
  const link = buildDiscordMessageLink_(SCORES_CHANNEL_ID, id);
  if (!link) {
    SpreadsheetApp.getUi().alert('Could not build a link for the current pointer.');
    return;
  }

  // Use a tiny HTML modal so the link is clickable
  const html = HtmlService.createHtmlOutput(
    '<div style="font:14px/1.4 system-ui,sans-serif;padding:12px 16px;">' +
      '<div style="margin-bottom:8px;"><strong>Current Poll Pointer</strong></div>' +
      '<div style="word-break:break-all;margin-bottom:12px;">' + id + '</div>' +
      '<a target="_blank" rel="noopener" href="' + link + '">Open in Discord</a>' +
    '</div>'
  ).setWidth(420).setHeight(140);
  SpreadsheetApp.getUi().showModalDialog(html, 'Poll Pointer Link');
}

// --- (Optional) UI: Jump pointer to latest message to skip history ---
function uiJumpPointerToLatest() {
  const ui = SpreadsheetApp.getUi();
  try {
    const latest = fetchChannelMessages_(SCORES_CHANNEL_ID, null, 1); // newest 1 (your relay should return newest-first)
    if (!latest || !latest.length) {
      ui.alert('No messages returned for this channel.');
      return;
    }
    // If your relay returns newest-first, id is latest. If oldest-first, adjust as needed.
    const newestMsg = latest[0];
    const id = String(newestMsg.id);
    _setScoresCursorSafe_(id);
    ui.alert('Poll pointer moved to latest message.', `Cursor set to: ${id}`, ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('Failed to fetch latest message:\n' + String(e));
  }
}

/**
 * Wrapper: Poll scores channel from current cursor (menu item)
 * Includes error logging and graceful failure
 * @returns {number} Number of messages processed
 */
function WM_pollNow() {
  try {
    return pollScores_();
  } catch (e) {
    log_('ERROR', 'PollNow crashed', { message: String(e), stack: (e && e.stack) ? String(e.stack) : '' });
    throw e; // keep Apps Script line number visible
  }
}

/**
 * Wrapper: Poll from specific message ID (one-time run)
 * @param {string} startId - Discord message snowflake ID
 * @param {boolean} includeStart - Whether to include the starting message
 * @returns {number} Number of messages processed
 */
function WM_pollFromIdOnce(startId, includeStart) {
  try {
    return pollFromIdOnce_(startId, includeStart);
  } catch (e) {
    log_('ERROR', 'pollFromIdOnce crashed', { message: String(e), stack: (e && e.stack) ? String(e.stack) : '' });
    throw e;
  }
}

function createFiveMinuteTrigger() {
  ScriptApp.newTrigger('pollScores_').timeBased().everyMinutes(5).create();
  SpreadsheetApp.getActive().toast('Created 5-minute trigger for score polling.');
}
function deleteAllTriggers() {
  ScriptApp.getProjectTriggers().forEach(ScriptApp.deleteTrigger);
  SpreadsheetApp.getActive().toast('Removed all triggers.');
}