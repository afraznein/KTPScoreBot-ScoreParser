/*************** RELAY HELPERS (incl. /dm) ***************/
/**
 * Execute GET request to Discord relay service
 * @param {string} path - API path (e.g., '/messages')
 * @returns {HTTPResponse} UrlFetchApp response object
 */
function relayGet(path) {
  const u = `${RELAY_BASE}${path}`;
  return UrlFetchApp.fetch(u, { method:'get', headers:{ 'X-Relay-Auth': RELAY_AUTH }, muteHttpExceptions:true });
}

/**
 * Execute POST request to Discord relay service
 * @param {string} path - API path (e.g., '/dm')
 * @param {Object} payload - JSON payload
 * @returns {HTTPResponse} UrlFetchApp response object
 */
function relayPost(path, payload) {
  const u = `${RELAY_BASE}${path}`;
  return UrlFetchApp.fetch(u, {
    method:'post',
    contentType:'application/json',
    headers:{ 'X-Relay-Auth': RELAY_AUTH },
    payload: JSON.stringify(payload||{}),
    muteHttpExceptions:true
  });
}

/*************** FETCHERS ***************/
/**
 * Fetch messages from Discord channel via relay service
 * Includes quota cooldown handling, automatic retry on errors, and jitter
 *
 * @param {string} channelId - Discord channel snowflake ID
 * @param {string|null} afterId - Cursor: fetch messages after this ID (null = most recent)
 * @param {number} limitOpt - Max messages to fetch (default: DEFAULT_LIMIT, min: 5)
 * @returns {Array<Object>} Array of Discord message objects, or empty array on error/cooldown
 */
function fetchChannelMessages(channelId, afterId, limitOpt) {
  if (isQuotaCooldown()) return []; // respect cooldown: no relay calls

  var limit = Math.max(5, Number(limitOpt || DEFAULT_LIMIT));
  var qs =
    'channelId=' + encodeURIComponent(channelId) +
    (afterId ? '&after=' + encodeURIComponent(afterId) : '') +
    '&limit=' + encodeURIComponent(limit);

  // small jitter to de-sync concurrent scripts
  Utilities.sleep(getJitterMs());

  try {
    var res = relayGet('/messages?' + qs);
    if (res.getResponseCode && res.getResponseCode() !== 200) {
      var body = (res.getContentText && res.getContentText()) || '';
      if (/Bandwidth quota exceeded/i.test(body)) {
        startQuotaCooldown(QUOTA_BACKOFF_MINUTES);
        return [];
      }
      throw new Error('Relay /messages failed: ' + res.getResponseCode() + ' ' + body);
    }
    return JSON.parse(res.getContentText());
  } catch (e) {
    var msg = String(e);
    if (/Bandwidth quota exceeded/i.test(msg)) {
      startQuotaCooldown(QUOTA_BACKOFF_MINUTES);
      return [];
    }
    // On other errors, try a smaller limit once
    if (limit > 20) {
      try {
        Utilities.sleep(250);
        return fetchChannelMessages(channelId, afterId, Math.floor(limit / 2));
      } catch (_) {}
    }
    throw e;
  }
}

function fetchSingleMessageWithDiag(channelId, messageId) {
  // exact
  let res = relayGet(`/message/${encodeURIComponent(channelId)}/${encodeURIComponent(messageId)}`);
  let code = res.getResponseCode(), body = res.getContentText();
  if (code === 200) {
    try { return { msg: JSON.parse(body), code, body, triedFallback:false }; } catch (_){}
  }
  // around fallback
  res = relayGet(`/messages?channelId=${encodeURIComponent(channelId)}&around=${encodeURIComponent(messageId)}&limit=3`);
  code = res.getResponseCode(); body = res.getContentText();
  if (code === 200) {
    try {
      const arr = JSON.parse(body);
      const msg = (arr||[]).find(x => String(x.id) === String(messageId)) || null;
      if (msg) return { msg, code, body, triedFallback:true };
    } catch(_){}
  }
  return { msg:null, code, body, triedFallback:true };
}

/*************** POSTERS ***************/
function postReaction(channelId, messageId, emoji) {
  const res = relayPost('/react', { channelId:String(channelId), messageId:String(messageId), emoji:String(emoji) });
  if (res.getResponseCode() !== 204) log('WARN','react failed', { code: res.getResponseCode(), body: res.getContentText()?.slice(0,400) });
}

function postDM(userId, content) {
  userId  = String(userId || '').trim();
  content = String(content || '').trim();
  if (!userId || !content) return { ok:false, error:'bad_args' };

  // Suppress DMs during debug runs
  if (DM_ENABLED === false) {
    // Log locally so we can see what *would* have been sent
    log('INFO', 'DM suppressed (debug mode)', { to: userId, content: content.slice(0, 250) });

    // Optional: echo suppressed DM into a debug channel
    if (DM_DEBUG_ECHO_CHANNEL) {
      try {
        relayPost('/reply', {
          channelId: String(DM_DEBUG_ECHO_CHANNEL),
          content: `*(suppressed DM to <@${userId}>)* ${content}`
        });
      } catch (e) {
        log('WARN', 'DM echo failed', { to: userId, err: String(e) });
      }
    }
    return { ok:false, suppressed:true };
  }

  // Normal DM send path (unchanged)
  try {
    const res = relayPost('/dm', { userId: userId, content: content });
    return { ok:true, res: res };
  } catch (e) {
    log('ERROR', 'DM send failed', { to: userId, err: String(e) });
    return { ok:false, error:String(e) };
  }
}

function alertUnrecognizedTeams(authorId, mapLower, team1U, team2U, unknownList, msgId) {
  const niceList = unknownList.map(t => `\`${t}\``).join(', ');
  const dm = [
    `Hi! I couldn’t match ${niceList} to the official team list (A3:A22).`,
    `Map was \`${mapLower}\`. Please re-submit using the exact team names from the sheet.`,
    `Tip: remove any emojis around the name and extra spaces at the start/end.`
  ].join(' ');

  if (authorId) postDM(String(authorId), dm);

  if (RESULTS_LOG_CHANNEL) {
    const mention = authorId ? `<@${authorId}>` : '';
    const alertLine =
      `⚠️ ${mention} score could not be recorded — unknown team ${unknownList.length>1?'names':'name'}: ${niceList} ` +
      `(map \`${mapLower}\`${msgId ? ` | msg ${msgId}` : ''}).`;
    relayPost('/reply', { channelId:String(RESULTS_LOG_CHANNEL), content: alertLine });
  }

  log('WARN', 'Unknown team(s) in submission', { msgId, map: mapLower, team1: team1U, team2: team2U, unknown: unknownList });
}

// DM errors even if DM_ENABLED=false (controlled by ERROR_DMS_ALWAYS)
function maybeSendErrorDM(userId, content) {
  if (!userId || !content) return;
  if (DM_ENABLED === true) { postDM(userId, content); return; }
  if (ERROR_DMS_ALWAYS) {
    // temporarily bypass: call relay directly
    try { relayPost('/dm', { userId: String(userId), content: String(content) }); }
    catch(e){ log('WARN','error DM send failed', {e:String(e)}); }
  }
}

// Format the scoreboard line (used for channel feed)
function formatScoreLine(division, row, parsed, target, authorId, modeTag, prevScoresOpt) {
  const mapShown = parsed.map; // keep dod_* intact
  const left  = `${parsed.team1} ${parsed.score1}`;
  const right = `${parsed.score2} ${parsed.team2}`;
  const op    = parsed.op || '-';
  const by    = authorId ? ` — reported by <@${authorId}>` : '';
  const link  = parsed.msgId ? buildDiscordMessageLink(SCORES_CHANNEL_ID, parsed.msgId) : '';
  const linkBit = link ? ` [jump](${link})` : '';
  const rowBit  = `row ${target.row}`;
  const prevBit = prevScoresOpt ? ` (was ${prevScoresOpt[0]} ${op} ${prevScoresOpt[1]})` : '';

  // modeTag: 'OK' | 'EDIT' | 'REPARSE_APPLIED' | 'REPARSE_NOCHANGE'
  const tagToEmoji = {
    OK: EMOJI_OK,
    EDIT: EMOJI_EDIT,
    REPARSE_APPLIED: `${EMOJI_RP}${EMOJI_OK}`,
    REPARSE_NOCHANGE: EMOJI_RP
  };
  const tagToText = {
    OK: '',
    EDIT: ' **(EDIT)**',
    REPARSE_APPLIED: ' **(REPARSE: applied)**',
    REPARSE_NOCHANGE: ' **(REPARSE: no change)**'
  };

  const emoji = tagToEmoji[modeTag] || EMOJI_OK;
  const tagTx = tagToText[modeTag] || '';

  return `${emoji} **${division}** • \`${mapShown}\` • ${rowBit} — **${left} ${op} ${right}**${tagTx}${by}${linkBit}`;
}

/*************** DISCORD MESSAGE LINK ***************/
function buildDiscordMessageLink(channelId, messageId) {
  channelId = String(channelId || '').trim();
  messageId = String(messageId || '').trim();
  if (!channelId || !messageId) return '';

  // Ask relay for the channel -> we need guild_id for the link
  try {
    const res = relayGet('/channel/' + encodeURIComponent(channelId));
    if (res.getResponseCode && res.getResponseCode() !== 200) {
      throw new Error('relay /channel failed ' + res.getResponseCode());
    }
    const ch = JSON.parse(res.getContentText());
    const guildId = String(ch.guild_id || '').trim();
    if (!guildId) {
      // Fallback for DMs (not expected for your scores channel)
      return 'https://discord.com/channels/@me/' + channelId + '/' + messageId;
    }
    return 'https://discord.com/channels/' + guildId + '/' + channelId + '/' + messageId;
  } catch (e) {
    log('WARN', 'buildDiscordMessageLink failed', { channelId, messageId, error: String(e) });
    return '';
  }
}
