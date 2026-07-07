# Change Log

All notable changes to the "lets-play-2048" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]

## [0.1.0]

### Added
- "AI Take Over" button: an expectimax AI plays the game automatically until no moves remain. Toggle it off anytime to resume playing yourself. The best score is not affected while the AI is (or has been) in control of a game.

### Changed
- Reaching 2048 no longer pauses the game. A brief congratulations toast appears and play continues until the board is full with no moves left. The "Keep going" win overlay has been removed.

## [0.0.4]

### Fixed
- Game Over screen is now in front of the blocks.

## [0.0.3] - accidental version (no changes)

## [0.0.2] - 2026-07-07

### Added
- Smooth tile animations: tiles slide to their new positions, newly spawned tiles pop in, and merged tiles bounce.

### Fixed
- Best score now updates live during play, so it is preserved when starting a new game before the board fills up.

## [0.0.1] - 2026-07-06

### Added
- Playable 2048 game in a VS Code webview, available from the activity bar view and via the "Play 2048" command (`Ctrl+Alt+2`).
- Keyboard controls: arrow keys, WASD, and Vim-style HJKL.
- On-screen arrow buttons and a "New Game" button.
- Score and best-score tracking.
- Win overlay at 2048 with a "Keep going" option, and a game-over overlay when no moves remain.
- Automatic save/restore of game state across VS Code sessions via extension global storage.
- Theme-aware styling that follows the user's VS Code color theme.