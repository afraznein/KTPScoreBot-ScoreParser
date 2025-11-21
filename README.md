# KTP Score Parser

**Automated match score parsing and Google Sheets integration for competitive Day of Defeat leagues**

A Google Apps Script bot that monitors Discord channels for match results, parses scores from natural language messages, updates Google Sheets automatically, and provides comprehensive logging and validation.

---

## 🎯 Purpose

Managing competitive league scores manually is time-consuming and error-prone:
- ❌ Manual data entry into spreadsheets
- ❌ Typos and formatting errors
- ❌ Delayed score updates
- ❌ No audit trail
- ❌ Confusion about which matches were recorded

**KTP Score Parser automates everything:**
- ✅ Players post scores in Discord using natural language
- ✅ Bot parses and validates automatically
- ✅ Google Sheets updated in real-time
- ✅ Complete audit trail with receipts
- ✅ Reactions confirm successful parsing
- ✅ DMs sent for errors or unknown team names

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────┐
│  Discord - Scores Channel                      │
│  Players post: "Gold: dod_flash Wickeds 5 > 3 Avengers" │
└────────────────┬────────────────────────────────┘
                 │ HTTPS
                 ↓
┌─────────────────────────────────────────────────┐
│  KTP Discord Relay (Cloud Run)                 │
│  Proxies requests to/from Discord API          │
└────────────────┬────────────────────────────────┘
                 │ HTTPS + Auth
                 ↓
┌─────────────────────────────────────────────────┐
│  KTP Score Parser (Google Apps Script)         │
│  - Fetches new messages                        │
│  - Parses score format                         │
│  - Validates teams/maps                        │
│  - Updates Google Sheets                       │
│  - Adds reactions (✅, :ktp:)                  │
│  - DMs users on errors                         │
└────────────────┬────────────────────────────────┘
                 │ Google Sheets API
                 ↓
┌─────────────────────────────────────────────────┐
│  Google Sheets - KTP Season Scores             │
│  - Bronze/Silver/Gold division sheets          │
│  - Weekly match blocks by map                  │
│  - W/L and scores automatically filled         │
│  - _ScoreReceipts audit log                    │
└─────────────────────────────────────────────────┘
```

---

## ✨ Key Features

### 📊 Automatic Score Parsing

**Flexible Natural Language Formats:**
```
[Gold]: dod_flash Wickeds 5 > 3 Avengers
Gold: dod_flash 5 Wickeds - Avengers 3
dod_flash Wickeds 5 : Avengers 3
flash Wickeds FF > Avengers 5  (forfeit support)
```

**Smart Parsing:**
- ✅ Optional division prefix (`[Gold]:` or `Gold:`)
- ✅ Auto-detects division from map block + team pair
- ✅ Map aliases (e.g., `flash` → `dod_flash`)
- ✅ Team name normalization (fuzzy matching)
- ✅ Score before or after team name
- ✅ Multiple operators: `>`, `<`, `-`, `:`
- ✅ Forfeit detection (`FF` or `forfeit`)

### 🗓️ Weekly Banner Posting

**Automated Weekly Announcements:**
- Posts banner every Monday at 8:00 AM ET
- Displays current week's map and match schedule
- Formatted with custom emojis and styling
- Pulls week info dynamically from Google Sheets

**Example Banner:**
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎮 KTP SEASON 8 - WEEK 4 - dod_flash 🎮
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
<a:dod:ID> MATCHES THIS WEEK <a:dod:ID>

🥉 BRONZE
  • Team A vs Team B
  • Team C vs Team D
  ...

🥈 SILVER
  • Team E vs Team F
  ...

🥇 GOLD
  • Team G vs Team H
  ...
```

### 📅 BYE Week Auto-Scoring

**Automatic BYE Handling:**
- Runs daily at 8:00 AM ET
- Scans all division sheets for "BYE" opponents
- Calculates team's average points across season
- Awards average points automatically
- Marks cell with "BYE(avg)" notation
- Prevents re-processing with idempotent checks

**Example:**
```
Team X vs BYE  →  Automatically scored with Team X's average: "BYE(5.2)"
```

### 🔍 Division Support

**Three-Tier League System:**
- 🥉 **Bronze** - Entry-level competitive
- 🥈 **Silver** - Intermediate competitive
- 🥇 **Gold** - Advanced competitive

**Auto-Detection:**
- Division inferred from map block + team pair if not specified
- Prevents cross-division score submissions
- Validates team names per division

### 🔁 Idempotent Processing

**Safe to Re-Run:**
- Tracks processed messages with `:ktp:` reaction
- Skips already-parsed messages
- `REPARSE_FORCE` flag for manual overrides
- Audit trail in `_ScoreReceipts` sheet
- Edit detection with `✏️` reaction

### 📝 Full Audit Trail

**_ScoreReceipts Sheet Logging:**
```
Timestamp | Division | Map | Team1 | Score1 | Team2 | Score2 | User | MessageID | Status
```

**Status Tracking:**
- ✅ `ParsedOK` - Successfully parsed and recorded
- ⚠️ `Unparsable` - Format error
- 🔍 `UnknownTeam` - Team not in roster
- 🗺️ `UnknownMap` - Map not whitelisted
- ♻️ `Reparse` - Manually re-parsed

### 💬 User Feedback

**Discord Reactions:**
- ✅ - Score parsed successfully
- :ktp: - Processed by KTP bot
- ✏️ - Message edited (may need reparse)
- ♻️ - Manually re-parsed by admin

**Direct Messages:**
- Sent to user when team name not recognized
- Includes suggestions for correct team names
- Lists valid team names for division
- Can be toggled with `DM_ENABLED` flag

---

## 🚀 Setup & Installation

### Prerequisites

- Google Account with access to Google Sheets
- Discord bot with appropriate permissions
- KTP Discord Relay deployed (see [KTP Discord Relay](https://github.com/afraznein/DiscordRelay))
- Google Sheets with KTP season structure

### Step 1: Prepare Google Sheet

**Sheet Structure:**

```
Sheets:
├── General          (Map whitelist in J2:J29)
├── Bronze           (Division matches)
├── Silver           (Division matches)
├── Gold             (Division matches)
├── _ScoreReceipts   (Audit log - auto-created)
└── KTP Info         (Weekly banner text in A1)
```

**Division Sheet Format:**
```
Row 3-22: Team roster (Column A - canonical names)
Row 27+:  Weekly blocks (11 rows each)
  - Row 0: Map name (dod_flash)
  - Row 1: Date header
  - Rows 2-11: 10 matches
    - Col B: Team1 W/L
    - Col C: Team1 Name (read-only)
    - Col D: Team1 Score
    - Col F: Team2 W/L
    - Col G: Team2 Name (read-only)
    - Col H: Team2 Score
```

### Step 2: Create Apps Script Project

1. Open your Google Sheet
2. Extensions → Apps Script
3. Delete default `Code.gs`
4. Create new files and paste code:
   - `00config.gs` - Configuration
   - `10util.gs` - Utility functions
   - `20relay.gs` - Discord relay integration
   - `30sheet.gs` - Sheet operations
   - `40weeklybanner.gs` - Weekly banner posting
   - `45byehandler.gs` - BYE week handler
   - `50parsepoll.gs` - Score parsing and polling
   - `60ui.gs` - Custom menu
   - `70debug.gs` - Debug utilities

### Step 3: Configure Settings

Edit `00config.gs`:

```javascript
// Discord Relay
const RELAY_BASE = 'https://your-relay-xxxxx.run.app';
const RELAY_AUTH = 'your-secret-here';

// Discord Channels
const SCORES_CHANNEL_ID = '1234567890123456789';      // Where users post scores
const RESULTS_LOG_CHANNEL = '1234567890123456789';    // Optional: confirmation logs

// Reactions
const REACT_KTP = ':ktp:1002382703020212245';
const REACT_OK = '✅';

// Division Sheets
const DIVISION_SHEETS = ['Bronze', 'Silver', 'Gold'];

// Team roster range
const TEAM_CANON_RANGE = 'A3:A22';

// Weekly blocks (11 rows each, starting row 28)
const GRID = {
  startRow: 28,
  rowsPerBlock: 11,
  matchesPerBlock: 10,
  cols: 8
};
```

### Step 4: Set Up Triggers

**Apps Script → Triggers → Add Trigger:**

1. **Score Polling** (Every 5 minutes)
   - Function: `pollScoresChannel`
   - Event source: Time-driven
   - Type: Minutes timer
   - Interval: Every 5 minutes

2. **Weekly Banner** (Monday 8:00 AM)
   - Function: `postWeeklyBanner`
   - Event source: Time-driven
   - Type: Week timer
   - Day: Monday
   - Time: 8am-9am

3. **BYE Auto-Scoring** (Daily 8:00 AM)
   - Function: `handleAllByeMatches`
   - Event source: Time-driven
   - Type: Day timer
   - Time: 8am-9am

### Step 5: Grant Permissions

1. Run any function manually (e.g., `pollScoresChannel`)
2. Review permissions prompt
3. Click "Advanced" → "Go to [Project Name] (unsafe)"
4. Grant permissions:
   - Read/write Google Sheets
   - Connect to external services (Discord Relay)

### Step 6: Test

**Manual Testing:**
1. Apps Script → Run → `testParseLine`
2. Extensions → KTP ScoreBot → Test Parse
3. Post test score in Discord:
   ```
   [Gold]: dod_flash Test Team 1 5 > 3 Test Team 2
   ```
4. Check for ✅ and :ktp: reactions
5. Verify score in Google Sheet
6. Check `_ScoreReceipts` audit log

---

## 📋 Score Format Reference

### Basic Formats

**With division:**
```
[Gold]: dod_flash Wickeds 5 > 3 Avengers
Gold: dod_flash Wickeds 5 > Avengers 3
```

**Without division** (auto-detected):
```
dod_flash Wickeds 5 > 3 Avengers
flash Wickeds 5 - Avengers 3
```

**Score position flexible:**
```
dod_flash 5 Wickeds > Avengers 3
dod_flash Wickeds 5 : 3 Avengers
```

### Supported Operators

- `>` - Greater than (Team1 wins)
- `<` - Less than (Team2 wins)
- `-` - Dash separator
- `:` - Colon separator

### Forfeit Format

```
dod_flash Wickeds FF > Avengers 5
dod_flash Wickeds forfeit - Avengers 5
```

### Map Aliases

**Supported formats:**
```
dod_flash    (full name)
flash        (alias - dod_ prefix optional)
```

Map whitelist maintained in `General` sheet, column J.

---

## 🎮 Usage

### For Players

**Posting Scores:**

1. Play your match
2. Post result in Discord scores channel:
   ```
   [Gold]: dod_flash My Team 5 > 3 Their Team
   ```
3. Wait for bot reactions:
   - ✅ = Successfully parsed
   - :ktp: = Processed
4. Check Google Sheet to verify

**If Something Goes Wrong:**
- ⚠️ No reactions? Check format
- 📬 Received DM? Team name not recognized
- 📝 Check `_ScoreReceipts` sheet for error details

### For Admins

**Custom Menu (Extensions → KTP ScoreBot):**

- **Poll Now** - Manually trigger score poll
- **Post Weekly Banner** - Manually post banner
- **Process BYE Matches** - Run BYE auto-scoring
- **Test Parse** - Test parsing a sample line
- **View Receipts** - Open audit log sheet
- **Reparse Last 50** - Re-process recent messages

**Manual Reparse:**
1. Set `REPARSE_FORCE = true` in `00config.gs`
2. Run `pollScoresChannel` from Apps Script
3. All messages re-processed (even with :ktp: reaction)
4. Set `REPARSE_FORCE = false` when done

**Debug Mode:**
```javascript
const PARSE_DEBUG_VERBOSE = true;  // Log all parse attempts
const DM_ENABLED = false;          // Suppress DMs during testing
```

---

## 🔧 Configuration Options

### Debug Flags

```javascript
const REPARSE_FORCE = true;              // Force reparse even if already processed
const PARSE_DEBUG_VERBOSE = true;        // Log ParsedOK/Unparsable details
const AUTO_RELOAD_ALIASES = true;        // Reload team aliases each run
const ALLOW_UNKNOWN_DOD_MAPS = true;     // Allow maps not in whitelist
```

### Direct Message Controls

```javascript
var DM_ENABLED = true;                   // Send DMs to users
var ERROR_DMS_ALWAYS = true;             // Send DMs even if DM_ENABLED=false (for errors)
var DM_DEBUG_ECHO_CHANNEL = '...';       // Echo suppressed DMs to debug channel
```

### Weekly Banner Settings

```javascript
var WEEKLY_BANNER_ENABLED = true;
var WEEKLY_BANNER_LEFT_CELL = 'KTP Info!A1';  // Season info cell
var WEEKLY_BANNER_RULE = 111;                 // Underline length
var EMOJI_DOD = '<a:dod:1427741756849655809>';
var EMOJI_KTP = '<:KTP:1002382703020212245>';
```

### Grid Geometry

```javascript
const GRID = {
  startRow: 28,          // First weekly block row
  rowsPerBlock: 11,      // Rows per weekly block
  matchesPerBlock: 10,   // Matches per week
  cols: 8                // Columns A-H
};

const COL_T1_WL = 2;     // Column B - Team1 W/L
const COL_T1_NAME = 3;   // Column C - Team1 Name
const COL_T1_SC = 4;     // Column D - Team1 Score
const COL_T2_WL = 6;     // Column F - Team2 W/L
const COL_T2_NAME = 7;   // Column G - Team2 Name
const COL_T2_SC = 8;     // Column H - Team2 Score
```

---

## 🔗 Related KTP Projects

### **KTP Competitive Infrastructure:**

**🎮 Game Server Layer:**
- **[KTP-ReHLDS](https://github.com/afraznein/KTP-ReHLDS)** - Custom engine with pause system
- **[KTP-ReAPI](https://github.com/afraznein/KTP-ReAPI)** - Custom ReAPI with pause hooks
- **[KTP Match Handler](https://github.com/afraznein/KTPMatchHandler)** - Match management plugin
- **[KTP Cvar Checker](https://github.com/afraznein/KTPCvarChecker)** - Anti-cheat system

**🌐 Supporting Services:**
- **[KTP Discord Relay](https://github.com/afraznein/DiscordRelay)** - HTTP proxy for Discord API
- **[KTP Score Parser](https://github.com/afraznein/KTPScoreBot-ScoreParser)** - This project
- **[KTPScoreBot-WeeklyMatches](https://github.com/afraznein/KTPScoreBot-WeeklyMatches)** - Weekly tracking
- **[KTP HLTV Kicker](https://github.com/afraznein/KTPHLTVKicker)** - HLTV management

---

## 📝 Version History

### v2.1.0 (2025-10-31)
- ✨ Code optimization: camelCase refactor
- 🚀 Batch operations for performance
- 📦 Constants extraction for maintainability

### v2.0.0 (2025-10-14)
- ✨ Added weekly banner posting
- ✨ Added BYE match auto-scoring
- 🔧 Improved parsing flexibility
- 📝 Enhanced audit logging

### v1.0.0 (2025-09-21)
- 🎉 Initial deployment for Season 8
- 📊 Basic score parsing
- ✅ Discord reactions
- 📬 Direct message notifications

---

## 🐛 Troubleshooting

### Scores Not Parsing

**Problem:** No reactions on Discord message

**Solutions:**
- ✅ Check format matches examples above
- ✅ Verify team names exactly match roster (Column A)
- ✅ Ensure map is in whitelist (`General` sheet, J2:J29)
- ✅ Check `_ScoreReceipts` sheet for error details
- ✅ Run `testParseLine` with your message

### Division Not Detected

**Problem:** "UnknownTeam" error even though team exists

**Solutions:**
- ✅ Add division prefix: `[Gold]: ...`
- ✅ Verify team is in correct division sheet
- ✅ Check team name spelling exactly matches roster
- ✅ Look for typos or extra spaces

### Duplicate Scores

**Problem:** Same score recorded multiple times

**Solutions:**
- ✅ Check for :ktp: reaction (should prevent duplicates)
- ✅ Set `REPARSE_FORCE = false`
- ✅ Messages should only be parsed once unless edited

### Weekly Banner Not Posting

**Problem:** Banner doesn't appear on Monday

**Solutions:**
- ✅ Verify trigger exists for `postWeeklyBanner`
- ✅ Check trigger is set for Monday 8am-9am
- ✅ Ensure `WEEKLY_BANNER_ENABLED = true`
- ✅ Check Apps Script execution logs for errors

### BYE Matches Not Scoring

**Problem:** BYE opponents not getting average points

**Solutions:**
- ✅ Verify trigger exists for `handleAllByeMatches`
- ✅ Check "BYE" spelling exactly matches
- ✅ Ensure team has played at least one match (for average)
- ✅ Check Apps Script execution logs

### Permission Errors

**Problem:** "Exception: Permission denied"

**Solutions:**
- ✅ Re-run manual function to re-trigger permissions
- ✅ Check Google account has edit access to sheet
- ✅ Verify script hasn't been disabled by admin

---

## 🙏 Acknowledgments

- **Discord** - API platform
- **Google Apps Script** - Automation platform
- **KTP Discord Relay** - Discord API proxy
- **KTP Community** - Testing, feedback, format suggestions
- **ChatGPT** - Coding assistance during newborn sleep deprivation 😴

---

## 📄 License

MIT License - See [LICENSE](LICENSE) file for details

---

## 👤 Author

**Nein_**
- GitHub: [@afraznein](https://github.com/afraznein)
- Project: KTP Competitive Infrastructure

---

**KTP Score Parser** - Making league management effortless, one Discord message at a time. 📊
