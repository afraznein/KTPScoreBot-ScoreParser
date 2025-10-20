/*************** PARSER AND POLLERS***************/
function parseScoreLine_(raw) {
  let s = stripEmojis_((raw || '').trim(), { collapse:false });

  // Optional division
  let division = null;
  const divM = s.match(/^(?:\[\s*(Bronze|Silver|Gold)\s*\]|(Bronze|Silver|Gold))\s*:\s*(.+)$/i);
  if (divM) { division = (divM[1]||divM[2]).trim(); s = divM[3].trim(); }

  // Map first; allow alias; allow missing dod_
  const mapM = s.match(/^([A-Za-z0-9_]+)\s+(.+)$/);
  if (!mapM) return null;
  let mapToken = mapM[1].trim();
  const rest = mapM[2].trim();

  // Map alias normalize
  const mapAliases = loadMapAliases_();
  // old: let mapLower = ...
  const normalized = normalizeMapToken_(mapToken);
  if (!normalized) return null; // unknown map → handled by your existing unknown-flow
  const mapLower = normalized;  // canonical, e.g., "dod_railyard_b6"
  if (mapAliases[mapLower]) mapLower = mapAliases[mapLower];
  else if (!mapLower.startsWith('dod_')) mapLower = 'dod_' + mapLower;

  // Operand split: support >, <, -, :
  const opM = rest.match(/([<>:-])/);
  if (!opM) return null;
  const op = opM[1];
  const idx = rest.indexOf(op);
  const left = rest.slice(0, idx).trim();
  const right = rest.slice(idx + 1).trim();

  // side parsing: score may be before OR after team; “FF/forfeit” allowed
  function parseSide(sideText) {
    const txt = stripEmojis_(sideText, { collapse:false }).replace(/\s+/g,' ').trim();
    // detect FF
    const ff = /\b(ff|forfeit)\b/i.test(txt);
    if (ff) return { team: normalizeTeamName_(txt.replace(/\b(ff|forfeit)\b/ig,'')), score: null, ff:true };

    const m = txt.match(/(\d{1,4})/);
    if (!m) return { team: normalizeTeamName_(txt), score:null, ff:false };
    const score = parseInt(m[1],10);
    const teamRaw = (txt.slice(0,m.index) + txt.slice(m.index + m[1].length)).trim();
    const team = normalizeTeamName_(teamRaw);
    return { team, score, ff:false };
  }

  const L = parseSide(left);
  const R = parseSide(right);
  if (!L || !R) return null;

  // resolve scores with FF: losing team = 0, winner gets the provided score or 1 by default
  let score1 = L.score, score2 = R.score, noteFF = false;
  if (L.ff || R.ff) {
    noteFF = true;
    if (L.ff && !R.ff) { score1 = 0; score2 = Number.isFinite(score2) ? score2 : 1; }
    else if (R.ff && !L.ff) { score2 = 0; score1 = Number.isFinite(score1) ? score1 : 1; }
    else { score1 = 0; score2 = 0; } // both FF? weird; log later
  }

  // fallback if no numeric found and not FF
  if (!Number.isFinite(score1) || !Number.isFinite(score2)) return null;

  return {
    division,
    map: mapLower,
    team1: L.team, score1,
    op,
    team2: R.team, score2,
    noteFF
  };
}

/*************** POLLING ***************/
function pollScores_() {
  if (AUTO_RELOAD_ALIASES) reloadAliasCaches_();  // cheap + deterministic
  if (isQuotaCooldown_()) {
    SpreadsheetApp.getActive().toast('Poll skipped (relay in cooldown).');
    return 0;
  }

  const startMs = nowMs_();

  // --- ALWAYS use the per-channel cursor
  const cursorBefore = getCursor_(SCORES_CHANNEL_ID) || '';

  // main page after cursor (smaller limit)
  const msgs = fetchChannelMessages_(SCORES_CHANNEL_ID, cursorBefore, DEFAULT_LIMIT); // after=cursorBefore
  let merged = msgs || [];

  if (shouldFetchRecentPage_()) {
    const recentRaw = fetchChannelMessages_(SCORES_CHANNEL_ID, null, RECENT_LIMIT);

    const cutoff = Date.now() - BACKFILL_MINUTES * 60 * 1000;

    // Keep anything created or edited within the window (edits to older IDs included)
    const recent = (recentRaw || [])
      .filter(m => {
        const t = m && (m.edited_timestamp || m.timestamp);
        const n = t ? Date.parse(t) : 0;
        return n >= cutoff;
      })
      .sort((a,b)=>compareSnowflakes(a.id,b.id)); // oldest → newest

    // Dedupe against the main "after cursor" page and cap
    const seen = new Set((merged||[]).map(m => String(m.id)));
    const add  = recent.filter(r => !seen.has(String(r.id))).slice(-BACKFILL_MERGE_MAX);

    merged = merged.concat(add);
  }

  if (!merged.length) return 0;
  merged.sort((a,b)=>compareSnowflakes(a.id,b.id)); // oldest → newest

  // Track the furthest ID we actually saw this run
  let cursorAfter = cursorBefore;
  let processed = 0;

  for (const m of merged) {
    if (processed >= MAX_MESSAGES_PER_POLL) break;
    if (nowMs_() - startMs > (MAX_MS_PER_POLL - RUNTIME_SAFETY_BUFFER)) break;

    const msgId = String(m.id);
    // advance our local “after” pointer as we see messages
    cursorAfter = maxSnowflake(cursorAfter, msgId);

    const authorId= String(m.author?.id || '');
    const content = String(m.content || '').trim();
    if (!content) continue;
    if (isWeeklyScoresBanner_(content)) {
      if (PARSE_DEBUG_VERBOSE) log_('INFO','SkipWeeklyBanner', { msgId });
      continue;
    }

    const contentHash = computeContentHash_(content);
    const editedTs    = String(m.edited_timestamp || '');

    const prevByMsg = findReceiptByMsgId_(msgId);
    if (!REPARSE_FORCE && prevByMsg && prevByMsg.contentHash === contentHash) {
      if (PARSE_DEBUG_VERBOSE) log_('INFO','SkipSameHash', { msgId });
      continue;
    }

    const parsed = parseScoreLine_(content);
    if (!parsed) {
      if (PARSE_DEBUG_VERBOSE) log_('INFO','Unparsable message', { msgId, content });
      continue;
    }

    if (PARSE_DEBUG_VERBOSE) {
      log_('INFO','ParsedOK', {
        msgId,
        divisionHint: parsed.division || '',
        map: parsed.map,
        t1: parsed.team1, s1: parsed.score1,
        op: parsed.op,
        t2: parsed.team2, s2: parsed.score2,
        noteFF: !!parsed.noteFF
      });
    }

    parsed.__contentHash = contentHash;
    parsed.__editedTs    = editedTs;
    parsed.__msgId       = msgId;
    parsed.__authorId    = authorId;

    if (parsed.team1 === '__PLACEHOLDER__' || parsed.team2 === '__PLACEHOLDER__') {
      log_('INFO','Skip placeholder team (pre-unknown-check)', { msgId, team1: parsed.team1, team2: parsed.team2 });
      continue;
    }

    const unknown = [];
    if (!isCanonTeam_(parsed.team1)) unknown.push(parsed.team1);
    if (!isCanonTeam_(parsed.team2)) unknown.push(parsed.team2);
    if (unknown.length) {
      alertUnrecognizedTeams_(authorId, parsed.map, parsed.team1, parsed.team2, unknown, msgId);
      maybeSendErrorDM_(authorId,
        `I couldn’t match those team name(s): ${unknown.join(', ')} on \`${parsed.map}\`. ` +
        `Please use exact names from the sheet or add aliases.`
      );
      continue;
    }

    const target = autodetectDivisionAndRow_(parsed.map, parsed.team1, parsed.team2, parsed.division);
    if (!target) {
      const diag = {};
      for (const d of DIVISION_SHEETS) {
        const sh = getSheetByName_(d); if (!sh) continue;
        const b = findBlockByMap_(sh, parsed.map);
        diag[d] = b ? { top:b.top, date:b.weekDate } : null;
      }
      log_('WARN','Could not determine division/row', { msgId, map: parsed.map, t1: parsed.team1, t2: parsed.team2, diag });

      maybeSendErrorDM_(authorId,
        `I couldn’t find your matchup \`${parsed.team1}\` vs \`${parsed.team2}\` on \`${parsed.map}\`. ` +
        `Please ensure team names match the sheet (A3:A22) and the map token is first (e.g., \`dod_lennon2\`).`
      );
      continue;
    }

    const write = applyScoresToRow_(target.sheet, target.row, target.team1, target.team2, parsed);
    if (!write.ok) {
      log_('WARN','Update blocked/failed', { reason: write.reason, sheet: target.sheet.getName(), row: target.row, msgId });
      continue;
    }

    if (write.prev && parsed.__authorId && DM_ENABLED && !REPARSE_FORCE) {
      postDM_(parsed.__authorId, `Update applied: ${target.sheet.getName()} row ${target.row} on ${parsed.map} is now ${parsed.team1} ${parsed.score1} ${parsed.op} ${parsed.score2} ${parsed.team2}.`);
    }

    if (PARSE_DEBUG_VERBOSE) {
      log_('INFO','AppliedOK', {
        msgId,
        division: target.sheet.getName(),
        row: target.row,
        map: parsed.map,
        t1: parsed.team1, s1: parsed.score1,
        t2: parsed.team2, s2: parsed.score2
      });
    }

    try { postReaction_(SCORES_CHANNEL_ID, msgId, REACT_KTP); postReaction_(SCORES_CHANNEL_ID, msgId, REACT_OK); }
    catch (e) { log_('WARN','react exceptions', { msgId, error:String(e) }); }

    // Channel feed line with the new formatter
    if (RESULTS_LOG_CHANNEL) {
      let modeTag = 'OK';
      if (REPARSE_FORCE) {
        modeTag = write.noChange ? 'REPARSE_NOCHANGE' : 'REPARSE_APPLIED';
      } else if (write.prev) {
        modeTag = 'EDIT';
      }
      const prevScoresOpt = write.prevScores || null;
      const line = formatScoreLine_(target.sheet.getName(), target.row, parsed, target, authorId, modeTag, prevScoresOpt);
      relayPost_('/reply', { channelId:String(RESULTS_LOG_CHANNEL), content: line });
    }

    processed++;
  }

  // --- Only persist if we truly advanced
  if (cursorAfter && compareSnowflakes(cursorAfter, cursorBefore) > 0) {
    setCursor_(SCORES_CHANNEL_ID, cursorAfter);
    if (PARSE_DEBUG_VERBOSE) log_('INFO','CursorAdvanced', { from: cursorBefore, to: cursorAfter });
  } else if (PARSE_DEBUG_VERBOSE) {
    log_('INFO','CursorUnchanged', { at: cursorBefore });
  }

  SpreadsheetApp.getActive().toast(`Poll complete: ${processed} msg(s) at ${fmtTs_()}.`);
  return processed;
}


function pollFromIdOnce_(startId, includeStart) {
  if (AUTO_RELOAD_ALIASES) reloadAliasCaches_();

  // normalize startId
  startId = startId ? String(startId) : '';
  if (PARSE_DEBUG_VERBOSE) log_('INFO','PollFromId params', { startId, includeStart: !!includeStart });

  const startMs = nowMs_();
  let batch = [];

  if (includeStart && startId) {
    const one = fetchSingleMessageWithDiag_(SCORES_CHANNEL_ID, startId);
    if (one && one.msg) batch.push(one.msg);
  }

  // fetch strictly "after" startId from relay (client cap)
  const newer = fetchChannelMessages_(SCORES_CHANNEL_ID, startId, DEFAULT_LIMIT);
  if (newer && newer.length) batch = batch.concat(newer);
  if (!batch.length) return 0;

  // oldest → newest, then forward-only clamp
  batch.sort((a,b)=>compareSnowflakes(a.id,b.id));
  if (startId) {
    const keepEq = !!includeStart;
    batch = batch.filter(m => {
      const cmp = compareSnowflakes(m.id, startId);
      return keepEq ? (cmp >= 0) : (cmp > 0);
    });
  }
  if (!batch.length) return 0;

  // monotonic guard baseline
  let lastProcessedId = startId || '';
  let processed = 0;

  for (const m of batch) {
    if (processed >= MAX_MESSAGES_PER_POLL) break;
    if (nowMs_() - startMs > (MAX_MS_PER_POLL - RUNTIME_SAFETY_BUFFER)) break;

    const msgId    = String(m.id);
    if (lastProcessedId && compareSnowflakes(msgId, lastProcessedId) <= 0) {
      if (PARSE_DEBUG_VERBOSE) log_('INFO','SkipNonMonotonic', { msgId, lastProcessedId });
      continue;
    }

    const authorId = String(m.author?.id || '');
    const content  = String(m.content || '').trim();
    if (!content) { lastProcessedId = msgId; continue; }
    if (isWeeklyScoresBanner_(content)) {
      if (PARSE_DEBUG_VERBOSE) log_('INFO','SkipWeeklyBanner', { msgId });
      lastProcessedId = msgId;
      continue;
    }

    const contentHash = computeContentHash_(content);
    const editedTs    = String(m.edited_timestamp || '');

    const prevByMsg = findReceiptByMsgId_(msgId);
    if (!REPARSE_FORCE && prevByMsg && prevByMsg.contentHash === contentHash) {
      if (PARSE_DEBUG_VERBOSE) log_('INFO','SkipSameHash', { msgId });
      lastProcessedId = msgId;   // keep advancing the monotonic pointer
      continue;
    }

    const parsed = parseScoreLine_(content);
    if (!parsed) {
      if (PARSE_DEBUG_VERBOSE) log_('INFO','Unparsable message', { msgId, content });
      lastProcessedId = msgId;
      continue;
    }

    if (PARSE_DEBUG_VERBOSE) {
      log_('INFO','ParsedOK', {
        msgId,
        divisionHint: parsed.division || '',
        map: parsed.map,
        t1: parsed.team1, s1: parsed.score1,
        op: parsed.op,
        t2: parsed.team2, s2: parsed.score2,
        noteFF: !!parsed.noteFF
      });
    }

    // annotate after we know we’ll process
    parsed.__contentHash = contentHash;
    parsed.__editedTs    = editedTs;
    parsed.__msgId       = msgId;
    parsed.__authorId    = authorId;

    // placeholders → skip
    if (parsed.team1 === '__PLACEHOLDER__' || parsed.team2 === '__PLACEHOLDER__') {
      log_('INFO','Skip placeholder team (pollFromIdOnce_)', { msgId, t1: parsed.team1, t2: parsed.team2 });
      lastProcessedId = msgId;
      continue;
    }

    // unknown team(s) → DM + skip
    const unknown = [];
    if (!isCanonTeam_(parsed.team1)) unknown.push(parsed.team1);
    if (!isCanonTeam_(parsed.team2)) unknown.push(parsed.team2);
    if (unknown.length) {
      alertUnrecognizedTeams_(authorId, parsed.map, parsed.team1, parsed.team2, unknown, msgId);
      maybeSendErrorDM_(authorId,
        `I couldn’t match those team name(s): ${unknown.join(', ')} on \`${parsed.map}\`. ` +
        `Please use exact names from the sheet or add aliases.`
      );
      lastProcessedId = msgId;
      continue;
    }

    // locate target row
    const target = autodetectDivisionAndRow_(parsed.map, parsed.team1, parsed.team2, parsed.division);
    if (!target) {
      maybeSendErrorDM_(authorId,
        `I couldn’t find the matchup \`${parsed.team1}\` vs \`${parsed.team2}\` on \`${parsed.map}\`. ` +
        `Please check team names (A3:A22) and that the map token is first (e.g., \`dod_lennon2\`).`
      );
      lastProcessedId = msgId;
      continue;
    }

    // write scores (now returns prevScores + noChange flags)
    const write = applyScoresToRow_(target.sheet, target.row, target.team1, target.team2, parsed);
    if (!write.ok) {
      log_('WARN','Update blocked/failed', { reason: write.reason, sheet: target.sheet.getName(), row: target.row, msgId });
      lastProcessedId = msgId;
      continue;
    }

    // optional success DM on edits; obey your DM toggle if you prefer
    if (write.prev && parsed.__authorId && DM_ENABLED) {
      postDM_(parsed.__authorId,
        `Update applied: ${target.sheet.getName()} row ${target.row} on ${parsed.map} is now ` +
        `${parsed.team1} ${parsed.score1} ${parsed.op} ${parsed.score2} ${parsed.team2}.`
      );
    }

    if (PARSE_DEBUG_VERBOSE) {
      log_('INFO','AppliedOK', {
        msgId,
        division: target.sheet.getName(),
        row: target.row,
        map: parsed.map,
        t1: parsed.team1, s1: parsed.score1,
        t2: parsed.team2, s2: parsed.score2
      });
    }

    // React (best-effort)
    try {
      postReaction_(SCORES_CHANNEL_ID, msgId, REACT_KTP);
      postReaction_(SCORES_CHANNEL_ID, msgId, REACT_OK);
    } catch (e) {
      log_('WARN','react exceptions', { msgId, error:String(e) });
    }

    // channel feed line (same formatter as pollScores_)
    if (RESULTS_LOG_CHANNEL) {
      let modeTag = 'OK';
      if (REPARSE_FORCE) {
        modeTag = write.noChange ? 'REPARSE_NOCHANGE' : 'REPARSE_APPLIED';
      } else if (write.prev) {
        modeTag = 'EDIT';
      }
      const prevScoresOpt = write.prevScores || null;
      const line = formatScoreLine_(target.sheet.getName(), target.row, parsed, target, authorId, modeTag, prevScoresOpt);
      relayPost_('/reply', { channelId:String(RESULTS_LOG_CHANNEL), content: line });
    }

    lastProcessedId = msgId; // monotonic advance
    processed++;
  }

  return processed;
}