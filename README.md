# KTP Score Parser

**Version 2.1.0** | Automated match score parsing and Google Sheets integration for competitive Day of Defeat leagues

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
- KTP Discord Relay deployed ([Discord Relay](https://github.com/afraznein/DiscordRelay))
- Discord bot with message read + reaction permissions

### Installation
1. Open Google Sheet > Extensions > Apps Script
2. Create files and paste code: `00config.gs` through `70debug.gs`
3. Edit `00config.gs` — set `RELAY_BASE`, `RELAY_AUTH`, `SCORES_CHANNEL_ID`
4. Set up time-driven triggers:
   - `pollScoresChannel` — every 5 minutes
   - `postWeeklyBanner` — Monday 8-9 AM
   - `handleAllByeMatches` — daily 8-9 AM
5. Run any function manually to grant permissions

### Sheet Structure
```
General          — Map whitelist (J2:J29)
Bronze           — Division matches (team roster A3:A22, weekly blocks from row 28)
Silver           — Division matches
Gold             — Division matches
_ScoreReceipts   — Audit log (auto-created)
KTP Info         — Weekly banner text (A1)
```

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
- [Discord Relay](https://github.com/afraznein/DiscordRelay) — HTTP proxy for Discord API (required)
- [KTPScoreBot-WeeklyMatches](https://github.com/afraznein/KTPScoreBot-WeeklyMatches) — Weekly match announcements

See [CHANGELOG.md](CHANGELOG.md) for version history.

---

## License

MIT License — See [LICENSE](LICENSE).
