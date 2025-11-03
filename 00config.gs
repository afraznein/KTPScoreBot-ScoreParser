/***** SCORE PARSE GOOGLE SCRIPT*****
 * - Reads messages from your Discord scores channel via your relay
 * - Division is supposed to be OPTIONAL but is it really?; autodetect uses MAP block (A[top]) + team pair
 * - Parses: [optional division] + <map token> + side1 (TEAM SCORE | SCORE TEAM) <op> side2
 * - Writes ONLY W/L (B,F) and scores (D,H)
 * - Adds :ktp: and ✅ reactions, logs success/failure, DMs author on unknown team names
 * - Written in conjunction with chat GPT while I have a newborn so this code is janky AF I can only apologize. It works.
 * - Uses a discord relay (See https://github.com/afraznein/KTPDiscordRelay) to bypass Cloudflare issues.
 *
 * Version History:
 *   v1.0 - Deployed at the Start of Season 8 in 2025
 *   v2.0 - Deployed 10/14/2025
 *   v2.1 - Code optimization: camelCase refactor, batch operations, constants extraction (10/31/2025)
 ***********************************************************************/

// Version
const VERSION = '2.1.0';

/*************** DEBUG ***************/
const REPARSE_FORCE = true;
const PARSE_DEBUG_VERBOSE = true;    // log ParsedOK / Unparsable with details
const AUTO_RELOAD_ALIASES = true;
const ALLOW_UNKNOWN_DOD_MAPS = true; // set false to enforce whitelist strictly

// --- Direct Message controls ---
var DM_ENABLED = true;                // you can set false during REPARSE
var ERROR_DMS_ALWAYS = true;           // still DM on problems even if DM_ENABLED=false
var DM_DEBUG_ECHO_CHANNEL = '1427665757675978844'; // optional: channelId to echo suppressed DMs for debugging ('' = no echo)

/*************** CONFIG ***************/
const RELAY_BASE  = 'RELAY_BASE_URL_HIDDEN'; // e.g. https://discord-relay-xxx.a.run.app
//CODE_TO_GENERATE_SECRET = 'node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"';
const RELAY_AUTH  = 'RELAY_AUTH_SECRET_HIDDEN';    // must match RELAY_SHARED_SECRET on relay

// Discord channels
const SCORES_CHANNEL_ID   = '1061813400360988752';    // where users post match results
const RESULTS_LOG_CHANNEL = '1419167645730865173';     // where we post confirmations/status (can be '' to disable)

// Parse/marking reactions
const REACT_KTP  = ':ktp:1002382703020212245';            // will be translated to unicode/custom by relay
const REACT_OK   = '✅';

var EMOJI_OK   = '✅';
var EMOJI_EDIT = '✏️';
var EMOJI_RP   = '♻️';  // reparse
var EMOJI_WARN = '⚠️';

// Sheets / structure
const DIVISION_SHEETS = ['Bronze','Silver','Gold'];
const TEAM_CANON_RANGE = 'A3:A22';  // canonical names
// Weekly blocks: A28 map, A29 date; then 10 rows of matches; next block starts +11 rows
const GRID = { startRow: 28, rowsPerBlock: 11, matchesPerBlock: 10, cols: 8 };

// Column indexes (1-based)
const COL_T1_WL   = 2; // B
const COL_T1_NAME = 3; // C (read-only)
const COL_T1_SC   = 4; // D
const COL_T2_WL   = 6; // F
const COL_T2_NAME = 7; // G (read-only)
const COL_T2_SC   = 8; // H

// Grid geometry for week headers in column A
var MAP_HEADER_FIRST_ROW = 27;  // A27
var MAP_HEADER_ROW_STEP  = 11;  // 27, 38, 49, 60, 71, 82, ...

// Weekly banner (Monday 8:00 AM ET)
var WEEKLY_BANNER_ENABLED = true;

// Where to pull the left-side label from (hard-coded as requested):
var WEEKLY_BANNER_LEFT_CELL = 'KTP Info!A1';

// Length of the underline in the banner
var WEEKLY_BANNER_RULE = 111;

// Optional: how many rows down from the map header a block typically spans.
// If your blocks vary, the code auto-detects until the next map header.
var DEFAULT_BLOCK_HEIGHT = 12;

// Custom emoji must be "<:name:ID>"
var EMOJI_DOD = '<a:dod:1427741756849655809>';   // a is required for animated emojis; ID is pulled from KTP server
var EMOJI_KTP = '<:KTP:1002382703020212245>';    // ID is pulled from KTP server

// If your map headers are always in column A, keep this = 1
var MAP_HEADER_COLUMN = 1;

// Timezone
const DEFAULT_TZ = 'America/New_York';

// Rolling pointer key
// One place to control the key format (per-channel cursor)
var CURSOR_PREFIX = 'LAST_ID_';      // canonical
var LEGACY_CURSOR_PREFIX = 'SCORES_LAST_'; // migrate-from if present
// Optional namespace if this project shares Script Properties with other tools
var CURSOR_NAMESPACE = 'KTP_SCOREBOT:'; // '' to disable
const LAST_ID_KEY = `SCORES_LAST_${SCORES_CHANNEL_ID}`;

const GENERAL_SHEET = 'General';
const GENERAL_MAPS_RANGE = 'J2:J29'; // lower-cased dod_* in sheet preferred, but we’ll normalize anyway.


/*************** LOGGING ***************/
const RECEIPTS_SHEET = '_ScoreReceipts';     // audit log & idempotency
const ALIASES_SHEET  = '_Aliases';           // optional: alias -> canonical (UPPER)
const MAPALIASES_SHEET = '_MapAliases';      // optional: alias -> dod_map (lowercase dod_*)

/*************** CACHE AND TIMEOUT ***************/
var DEFAULT_LIMIT    = 100;   // was 100
var BACKFILL_MINUTES = 120;   // 
var RECENT_LIMIT     = 50;   // cap recent page size
var BACKFILL_MERGE_MAX = 30;  // optional: at most N recent msgs merged per poll

var MAX_MESSAGES_PER_POLL = 120;     // stop after this many processed msgs
var MAX_MS_PER_POLL       = 4 * 60 * 1000; // ~4 minutes budget per run
var RUNTIME_SAFETY_BUFFER = 10 * 1000;     // stop ~10s early to finish cleanly

// --- backoff after quota errors ---
var QUOTA_BACKOFF_MINUTES = 15;   // skip polls for this long after an error
var RECENT_PAGE_EVERY_N    = 1;   // only fetch the "recent page" every N polls

// (optional) jitter so multiple sheets don't all hit the relay at once
var FETCH_JITTER_MS_MIN = 150;
var FETCH_JITTER_MS_MAX = 600;

/*************** MAGIC CONSTANTS ***************/
// Special token prefixes
const PLACEHOLDER_TOKEN = '__PLACEHOLDER__';
const AMBIGUOUS_ALIAS_PREFIX = '__AMBIG_ALIAS__';

// Validation patterns
const SNOWFLAKE_PATTERN = /^\d{17,19}$/;  // Discord snowflake IDs are 17-19 digits
const DOD_MAP_PATTERN = /^dod_[a-z0-9_]+$/;

// Batch operation limits
const MAX_BATCH_WRITE_ROWS = 1000;  // Google Sheets API limit