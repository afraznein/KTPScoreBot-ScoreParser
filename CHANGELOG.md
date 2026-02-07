# Changelog

All notable changes to KTP ScoreBot Score Parser will be documented in this file.

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
