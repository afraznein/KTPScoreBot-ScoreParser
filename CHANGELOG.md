# Changelog

All notable changes to KTP ScoreBot Score Parser will be documented in this file.

## [Unreleased]

### Documentation

All three trigger function names in the install steps were wrong, so following
them verbatim produced a bot with no working triggers. Corrected against the
actual `newTrigger()` registrations:

| README said | Actually registered |
|---|---|
| `pollScoresChannel` | `pollScores` (`60ui.gs:182`) |
| `postWeeklyBanner` | `postWeeklyScoresBanner` (`40weeklybanner.gs:258`) |
| `handleAllByeMatches` | `processByeScores` (`45byehandler.gs:568`) |

The schedules attached to each were correct. Also pointed at the KTP menu
helpers, which create these triggers without hand-entering names.

Also documented:

- The **Discord Scores** operator menu (`60ui.gs`) — 10 items, and the primary way
  the bot is driven by hand. The README previously described no UI surface at all.
- `_Aliases` and `_MapAliases`, both read by `00config.gs:103-104` and both missing
  from the documented sheet structure. They back two features the README already
  advertises (team-name fuzzy matching, `flash` -> `dod_flash`), so a fresh
  deployment that skipped them silently lost alias resolution.
- `RESULTS_LOG_CHANNEL` in the config step — it controls where every confirmation
  post lands.
- Fixed the Discord Relay repo link in both places: `afraznein/DiscordRelay` 404s,
  the repo is `afraznein/KTPDiscordRelay` (the name `00config.gs:8` already used).

### Not yet released — shipped code with no changelog entry

`45byehandler.gs` (the whole 618-line BYE auto-scoring implementation, added
2025-11-02) and a substantial `50parsepoll.gs` polling/parse rework landed after the
2.1.0 release commit and were never logged. `git diff a1467f0 HEAD` is +1017/-200
across 12 files, most of it user-visible behavior.

The `VERSION` const in `00config.gs` still reads 2.1.0. Whether this becomes 2.2.0
or the const moves is an operator call — deliberately not decided here.

## [2.1.0] - 2025-10-31

### Changed
- Code optimization: camelCase refactor across all files
- Batch operations for Google Sheets reads/writes (performance improvement)
- Constants extraction for maintainability

---

## [2.0.0] - 2025-10-14

### Added
- Weekly banner posting (Monday 8 AM ET) with map schedule and division matchups
- BYE week auto-scoring with team average point calculation
  *(Misattributed — `45byehandler.gs` was first committed 2025-11-02 in `cbd3ddd`,
  after the 2.1.0 release. Recorded under [Unreleased] instead. Entry left in place
  rather than deleted so the record of the mistake survives.)*
- Map alias support (e.g., `flash` resolves to `dod_flash`)
- Team alias support with fuzzy matching
- Edit detection with content hashing (re-parses edited messages)

### Changed
- Improved score parsing flexibility (score before or after team name)
- Enhanced audit logging in `_ScoreReceipts` sheet

---

## [1.0.0] - 2025-09-21

### Added
- Initial deployment for KTP Season 8
- Score parsing from natural language Discord messages
- Division auto-detection from map block + team pair
- Google Sheets integration (W/L and score columns)
- Discord reactions for parse status (`:ktp:`, checkmark)
- Direct messages to users on unknown team names
- Cursor-based polling (every 5 minutes)
- `_ScoreReceipts` audit log sheet
