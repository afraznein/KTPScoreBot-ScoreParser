# KTP Score Parser

**Version 2.2.0** | Automated match score parsing and Google Sheets integration for competitive Day of Defeat leagues

A Google Apps Script bot that monitors a Discord channel for match results, parses scores from natural language messages, updates Google Sheets automatically, and provides validation and audit logging.

Part of the [KTP Competitive Infrastructure](https://github.com/afraznein).

---

## Purpose

Managing competitive league scores manually is error-prone. KTP Score Parser automates the workflow:

1. Players post scores in Discord using natural language
2. Bot parses, validates team names and maps, detects division
3. Google Sheets updated automatically (W/L + scores)
4. Reactions confirm success; DMs sent for errors
5. Complete audit trail in `_ScoreReceipts` sheet

---

## Architecture

```
Discord - Scores Channel
  Players post: "Gold: dod_flash Wickeds 5 > 3 Avengers"
     | HTTPS (polling every 5 min)
     v
KTP Discord Relay (Cloud Run)
  Proxies requests to/from Discord API
     | HTTPS + X-Relay-Auth
     v
KTP Score Parser (Google Apps Script)
  - Fetches new messages via cursor-based polling
  - Parses score format (flexible natural language)
  - Validates teams/maps against sheet rosters
  - Auto-detects division from map block + team pair
  - Writes W/L and scores to division sheets
  - Adds reactions, DMs users on errors
     | Google Sheets API
     v
Google Sheets - KTP Season Scores
  - Bronze/Silver/Gold division sheets
  - Weekly match blocks by map
  - _ScoreReceipts audit log
```

---

## Score Format

**With division prefix:**
```
[Gold]: dod_flash Wickeds 5 > 3 Avengers
Gold: dod_flash Wickeds 5 > Avengers 3
```

**Without division (auto-detected):**
```
dod_flash Wickeds 5 > 3 Avengers
flash Wickeds 5 - Avengers 3
```

**Supported operators:** `>`, `<`, `-`, `:`

**Forfeit:** `dod_flash Wickeds FF > Avengers 5`

**Features:** Map aliases (`flash` -> `dod_flash`), team name normalization, score before or after team name.

---

## Key Features

| Feature | Description |
|---------|-------------|
| **Score Parsing** | Flexible natural language with division auto-detection |
| **Weekly Banner** | Monday 8 AM ET — posts map schedule and matchups |
| **BYE Auto-Scoring** | Daily 8 AM ET — awards team average points for BYE weeks |
| **Idempotent Processing** | `:ktp:` reaction marks processed; content hash detects edits |
| **Audit Trail** | `_ScoreReceipts` sheet logs every parse attempt with status |
| **User Feedback** | Reactions (checkmark, :ktp:, edit, reparse) + DMs for errors |

---

## Setup

### Prerequisites
- Google Sheet with KTP season structure (Bronze/Silver/Gold division sheets)
- KTP Discord Relay deployed ([Discord Relay](https://github.com/afraznein/KTPDiscordRelay))
- Discord bot with message read + reaction permissions

### Installation
1. Open Google Sheet > Extensions > Apps Script
2. Create files and paste code: `00config.gs` through `70debug.gs`
3. Edit `00config.gs` — set `RELAY_BASE`, `RELAY_AUTH`, `SCORES_CHANNEL_ID`; optionally
   `RESULTS_LOG_CHANNEL` (where confirmations and status posts land — `''` disables)
4. Set up time-driven triggers (function names must match exactly):
   - `pollScores` — every 5 minutes
   - `postWeeklyScoresBanner` — Monday 8-9 AM
   - `processByeScores` — daily 8-9 AM

   The KTP menu can create these for you rather than doing it by hand — see the
   `newTrigger` helpers in `60ui.gs` and `45byehandler.gs`.
5. Run any function manually to grant permissions

### Sheet Structure
```
General          — Map whitelist (J2:J29)
Bronze           — Division matches (team roster A3:A22, weekly blocks from row 28)
Silver           — Division matches
Gold             — Division matches
_ScoreReceipts   — Audit log (auto-created)
KTP Info         — Weekly banner text (A1)
_Aliases         — Team name alias -> canonical (optional)
_MapAliases      — Map alias -> dod_map (optional)
```

`_Aliases` and `_MapAliases` are optional, but they are what backs team-name fuzzy
matching and the `flash` -> `dod_flash` map shorthand. A sheet without them parses
only exact names.

### Operator Menu

`onOpen` installs a **Discord Scores** menu on the spreadsheet — the primary way to
drive the bot by hand (`60ui.gs`):

| Item | Does |
|------|------|
| Poll Now (Scores Channel) | One immediate poll from the current pointer |
| Poll From Message ID… | Re-poll starting at a specific Discord message |
| Set Poll Pointer… | Move the pointer manually |
| Show Poll Pointer | Print the pointer as a clickable Discord link |
| Jump Pointer to Latest | Skip everything unread |
| Create / Remove Banner Trigger | Install or remove the Monday banner trigger |
| Process BYE Scores Now | Run BYE auto-scoring immediately |
| Create / Remove BYE Scoring Trigger | Install or remove the daily BYE trigger |

---

## File Structure

| File | Lines | Purpose |
|------|-------|---------|
| `00config.gs` | 133 | Constants, relay config, grid geometry, debug flags |
| `10util.gs` | 746 | Utility functions (sheets, caching, hashing, timing) |
| `20relay.gs` | 226 | Discord relay HTTP integration |
| `30sheet.gs` | 229 | Google Sheets read/write operations |
| `40weeklybanner.gs` | 329 | Weekly banner posting automation |
| `45byehandler.gs` | 618 | BYE week auto-scoring with average calculation |
| `50parsepoll.gs` | 411 | Score parsing engine + polling loop |
| `60ui.gs` | 187 | Custom menu UI + trigger management |
| `70debug.gs` | 259 | Debug utilities + data seeding |

Files numbered for load order (Apps Script loads alphabetically).

---

## Related Projects

**KTP Stack:**
- [Discord Relay](https://github.com/afraznein/KTPDiscordRelay) — HTTP proxy for Discord API (required)
- [KTPScoreBot-WeeklyMatches](https://github.com/afraznein/KTPScoreBot-WeeklyMatches) — Weekly match announcements

See [CHANGELOG.md](CHANGELOG.md) for version history.

---

## License

MIT License — See [LICENSE](LICENSE).
