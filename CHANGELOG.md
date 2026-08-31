# Changelog

All notable changes to this project are documented here.

## [Unreleased]

## [0.3.1] - 2026-08-31

### Fixed

- Isolated content script no longer throws "Extension context invalidated" after you reload the extension on a tab that still has the old script.

## [0.3.0] - 2026-08-31

### Added

- Claude can read a HAR snapshot (`network`) and loaded URLs (`resources`) through DevTools APIs. Confirm still applies only to `eval_js`.
- `claude($0)` and `claude.inspect($0)` send the selected Elements node with the goal.
- Stub re-injects when the inspected tab navigates.

### Changed

- Each tool call logs as one collapsed `Claude → eval_js` / `network` / `resources` group (input and result inside). The separate `Tool result:` line is gone.

## [0.2.1] - 2026-08-31

### Changed

- Toolbar and store icons are a celestial diagram mark (crescent, star, orbit, rays) instead of the placeholder disc.

## [0.2.0] - 2026-08-31

### Added

- Options page links to the GitHub repository and alessandroannini.com.

### Fixed

- Default model is `claude-sonnet-5`. The old id `claude-sonnet-4-20250514` was retired and 404s.
- DevTools page reconnects and heartbeats so a sleeping service worker does not look like "DevTools is closed".
- Error text now says to close and reopen DevTools after reloading the extension.
- `claude('…')` without `await` no longer reports an uncaught rejection on the Edge/Chrome extensions error page.
- Service worker is a single IIFE file so Edge does not fail loading Vite module chunks.
- Closing DevTools no longer leaves `claude()` hanging (`busy` stuck true).
- Opening DevTools no longer reinstalls the console stub over a live session.
- Final answers are logged once (intermediate tool narration still streams).
- `claude.stop()` during an Anthropic fetch reports "Stopped." instead of an abort exception.
- Isolated bridge reports `chrome.runtime.lastError` instead of resolving empty.
- A second `claude()` while a run is in flight is rejected instead of interleaving history.

### Changed

- Repo layout for GitHub: LICENSE, user docs, icons, `npm run pack`, CI.
- Options model field is a select of current Claude API models. Retired ids remap to Sonnet 5.
- After a key is saved, Options shows a Remove key button instead of the password field.
- Options page uses the product visual tokens and explains the console commands.
- Toolbar icon opens Options.
- `npm test` is `vitest run`. `npm run dev` watches all four Vite builds.

## [0.1.0] - 2026-08-28

### Added

- Feature `console-repl` shipped to develop.
