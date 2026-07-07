# lets-play-2048

Play a full game of 2048 right inside VS Code — in the sidebar or in an editor panel — without ever leaving your workspace.

## Features

- **Play from the sidebar or a panel.** Open the game from the activity bar view or launch it beside your editor with a command/keybinding.
- **Classic 2048 rules.** Slide tiles with arrow keys, WASD, or Vim-style HJKL; merge matching tiles; reach 2048 to win.
- **Game state persistence.** Your board, score, and game status are saved automatically and restored the next time you open VS Code.
- **Theme-aware styling.** The board and controls adapt to your current VS Code color theme.
- **AI Mode.** You can even watch how AI plays the game.

## Getting Started

- Open the **2048** view from the activity bar (look for the game icon), or
- Run the **Play 2048** command from the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`), or
- Use the keybinding `Ctrl+Alt+2` to toggle the game panel.

### Controls

| Action | Keys |
|---|---|
| Move up | `↑`, `W`, `K` |
| Move down | `↓`, `S`, `J` |
| Move left | `←`, `A`, `H` |
| Move right | `→`, `D`, `L` |

You can also use the on-screen arrow buttons, or click **New Game** to start over at any time.

## Requirements

None. The extension has no external dependencies and works out of the box.

## Extension Settings

This extension does not currently contribute any VS Code settings.

## Known Issues

- Game state is stored per VS Code installation (via global storage), not synced across machines.

## Release Notes

See [CHANGELOG.md](CHANGELOG.md) for details on each release.

**Enjoy!**
