# Changelog

All notable changes to KTP ScoreBot Score Parser will be documented in this file.

## [1.0.0] - 2025-11-02

### Added
- Initial release
- Score parsing from match screenshots using OCR/image processing
- Discord relay integration for parsed scores
- Google Sheets integration for score storage
- Weekly banner generation
- Bye handler for scheduling gaps
- Poll parsing for match predictions
- Debug utilities for development

### Components
- `00config.gs` - Configuration and settings
- `10util.gs` - Utility functions
- `20relay.gs` - Discord relay integration
- `30sheet.gs` - Google Sheets interface
- `40weeklybanner.gs` - Banner image generation
- `45byehandler.gs` - Bye week handling
- `50parsepoll.gs` - Poll parsing
- `60ui.gs` - User interface components
- `70debug.gs` - Debug utilities
