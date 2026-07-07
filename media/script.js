// 2048 Game Implementation

// Webview VS Code API
const vscode = acquireVsCodeApi();

// Movement vectors per direction (dr = row delta, dc = col delta)
const VECTORS = {
    up: { dr: -1, dc: 0 },
    down: { dr: 1, dc: 0 },
    left: { dr: 0, dc: -1 },
    right: { dr: 0, dc: 1 }
};

// Each tile carries a stable id so its DOM element can persist across moves
// and animate (slide) instead of being destroyed and recreated every frame.
let tileSeq = 0;

class Tile {
    constructor(value, row, col) {
        this.id = ++tileSeq;
        this.value = value;
        this.row = row;
        this.col = col;
        this.isNew = false;   // just spawned -> "appear" animation
        this.merged = false;  // result of a merge -> "pop" animation
    }
}

class Game2048 {
    constructor() {
        this.bestScore = Number(localStorage.getItem('2048-best')) || 0;
        this.tileEls = new Map(); // tile id -> DOM element (persistent across moves)
        this.removed = [];        // tiles consumed by a merge in the last move
        this.positions = null;    // cached px geometry for each [row][col] slot
        this.init();
    }

    init() {
        this.cells = Array.from({ length: 4 }, () => Array(4).fill(null));
        this.score = 0;
        this.gameOver = false;
        this.won = false;
        this.keepPlaying = false;
        this.removed = [];
        this.clearBoardDom();
        this.addRandomTile();
        this.addRandomTile();
    }

    // True once the game shouldn't accept moves until the player dismisses
    // the game-over or win overlay.
    isInputBlocked() {
        return this.gameOver || (this.won && !this.keepPlaying);
    }

    inBounds(r, c) {
        return r >= 0 && r < 4 && c >= 0 && c < 4;
    }

    forEachTile(fn) {
        for (let r = 0; r < 4; r++) {
            for (let c = 0; c < 4; c++) {
                if (this.cells[r][c]) fn(this.cells[r][c]);
            }
        }
    }

    addRandomTile() {
        const empty = [];
        for (let r = 0; r < 4; r++) {
            for (let c = 0; c < 4; c++) {
                if (!this.cells[r][c]) empty.push({ r, c });
            }
        }
        if (empty.length === 0) return;

        const { r, c } = empty[Math.floor(Math.random() * empty.length)];
        const tile = new Tile(Math.random() < 0.9 ? 2 : 4, r, c);
        tile.isNew = true;
        this.cells[r][c] = tile;
    }

    // Farthest empty slot a tile can slide to, plus the occupied slot beyond it
    // (a merge candidate), following the movement vector.
    findFarthest(r, c, vec) {
        let pr = r, pc = c;
        let nr = r + vec.dr, nc = c + vec.dc;
        while (this.inBounds(nr, nc) && !this.cells[nr][nc]) {
            pr = nr; pc = nc;
            nr += vec.dr; nc += vec.dc;
        }
        return {
            farthest: { r: pr, c: pc },
            next: this.inBounds(nr, nc) ? { r: nr, c: nc } : null
        };
    }

    // Cell traversal order: start from the side the tiles move toward so that
    // tiles pack correctly and each tile merges at most once per move.
    traversalOrder(vec) {
        const rows = [0, 1, 2, 3];
        const cols = [0, 1, 2, 3];
        if (vec.dr > 0) rows.reverse();
        if (vec.dc > 0) cols.reverse();
        return { rows, cols };
    }

    move(direction) {
        const vec = VECTORS[direction];
        if (!vec) return false;

        // Reset per-move animation state.
        this.forEachTile(t => { t.isNew = false; t.merged = false; });
        this.removed = [];

        const { rows, cols } = this.traversalOrder(vec);
        let moved = false;

        for (const r of rows) {
            for (const c of cols) {
                const tile = this.cells[r][c];
                if (!tile) continue;

                const { farthest, next } = this.findFarthest(r, c, vec);
                const nextTile = next ? this.cells[next.r][next.c] : null;

                if (nextTile && nextTile.value === tile.value && !nextTile.merged) {
                    // Merge: nextTile survives (doubles + pops), tile slides in
                    // and is then removed.
                    this.cells[r][c] = null;
                    this.removed.push({
                        id: tile.id, value: tile.value,
                        toR: next.r, toC: next.c
                    });
                    nextTile.value *= 2;
                    nextTile.merged = true;
                    this.score += nextTile.value;
                    moved = true;
                } else if (farthest.r !== r || farthest.c !== c) {
                    // Slide into the farthest empty slot.
                    this.cells[farthest.r][farthest.c] = tile;
                    this.cells[r][c] = null;
                    tile.row = farthest.r;
                    tile.col = farthest.c;
                    moved = true;
                }
            }
        }

        if (moved) {
            this.updateBestScore();
            this.addRandomTile();
            if (!this.won && this.hasWon()) {
                this.won = true;
            }
            this.checkGameOver();
            try { saveState(); } catch { /* ignore */ }
        }
        return moved;
    }

    updateBestScore() {
        if (this.score > this.bestScore) {
            this.bestScore = this.score;
            localStorage.setItem('2048-best', this.bestScore);
        }
    }

    movesAvailable() {
        for (let r = 0; r < 4; r++) {
            for (let c = 0; c < 4; c++) {
                const tile = this.cells[r][c];
                if (!tile) return true;
                if (c < 3 && this.cells[r][c + 1] && this.cells[r][c + 1].value === tile.value) return true;
                if (r < 3 && this.cells[r + 1][c] && this.cells[r + 1][c].value === tile.value) return true;
            }
        }
        return false;
    }

    checkGameOver() {
        if (!this.movesAvailable()) {
            this.gameOver = true;
            this.updateBestScore();
            try { saveState(); } catch { /* ignore */ }
        }
    }

    hasWon() {
        for (let r = 0; r < 4; r++) {
            for (let c = 0; c < 4; c++) {
                if (this.cells[r][c] && this.cells[r][c].value === 2048) return true;
            }
        }
        return false;
    }

    // Numeric 4x4 grid, used for persistence and state restore.
    valueGrid() {
        return this.cells.map(row => row.map(t => (t ? t.value : 0)));
    }

    // --- Rendering ------------------------------------------------------

    clearBoardDom() {
        const tc = document.getElementById('tileContainer');
        if (tc) tc.innerHTML = '';
        this.tileEls.clear();
    }

    // Measure the px position/size of each grid slot from the static
    // background cells (recomputed on resize so tiles stay aligned).
    measurePositions() {
        const cells = document.querySelectorAll('#gridBackground .grid-cell');
        if (cells.length < 16 || cells[0].offsetWidth === 0) return;

        const pos = Array.from({ length: 4 }, () => Array(4));
        cells.forEach((cell, i) => {
            pos[Math.floor(i / 4)][i % 4] = {
                left: cell.offsetLeft,
                top: cell.offsetTop,
                width: cell.offsetWidth,
                height: cell.offsetHeight
            };
        });
        this.positions = pos;
    }

    ensurePositions() {
        if (!this.positions || this.positions[0][0].width === 0) {
            this.measurePositions();
        }
    }

    setTilePos(el, row, col) {
        if (!this.positions) return;
        const p = this.positions[row][col];
        el.style.width = p.width + 'px';
        el.style.height = p.height + 'px';
        el.style.transform = `translate(${p.left}px, ${p.top}px)`;
    }

    createTileEl(value) {
        const el = document.createElement('div');
        el.className = 'tile';
        el.dataset.value = value;
        const inner = document.createElement('div');
        inner.className = 'tile-inner';
        inner.textContent = value;
        el.appendChild(inner);
        return el;
    }

    updateTileEl(el, value) {
        if (el.dataset.value !== String(value)) {
            el.dataset.value = value;
            el.querySelector('.tile-inner').textContent = value;
        }
    }

    render() {
        this.ensurePositions();
        const tc = document.getElementById('tileContainer');

        if (this.positions) {
            // Tiles consumed by a merge: reuse their existing element so it
            // slides from where it currently sits into the merge slot, then
            // remove it once the slide finishes.
            for (const g of this.removed) {
                let el = this.tileEls.get(g.id);
                if (!el) {
                    el = this.createTileEl(g.value);
                    tc.appendChild(el);
                    this.setTilePos(el, g.toR, g.toC);
                }
                this.tileEls.delete(g.id);
                el.style.zIndex = '1';
                this.setTilePos(el, g.toR, g.toC);
                const dead = el;
                setTimeout(() => dead.remove(), 160);
            }

            // Surviving tiles: persistent elements animate via CSS transition
            // when their transform changes.
            const survivors = new Set();
            this.forEachTile(t => {
                survivors.add(t.id);
                let el = this.tileEls.get(t.id);
                if (!el) {
                    el = this.createTileEl(t.value);
                    tc.appendChild(el);
                    this.tileEls.set(t.id, el);
                    this.setTilePos(el, t.row, t.col);
                    if (t.isNew) el.classList.add('tile-new');
                } else {
                    this.updateTileEl(el, t.value);
                    this.setTilePos(el, t.row, t.col);
                }
                el.style.zIndex = t.merged ? '20' : '10';
                if (t.merged) {
                    this.updateTileEl(el, t.value);
                    // restart the pop animation
                    el.classList.remove('tile-merged');
                    void el.offsetWidth;
                    el.classList.add('tile-merged');
                }
                t.isNew = false;
                t.merged = false;
            });
            this.removed = [];

            // Drop any leftover elements no longer on the board.
            for (const [id, el] of this.tileEls) {
                if (!survivors.has(id)) {
                    el.remove();
                    this.tileEls.delete(id);
                }
            }
        }

        this.renderScore();
        this.renderMessage();
    }

    // Reposition tiles without animating (used on container resize).
    relayout() {
        this.measurePositions();
        if (!this.positions) return;
        const tc = document.getElementById('tileContainer');
        tc.classList.add('no-anim');
        this.forEachTile(t => {
            const el = this.tileEls.get(t.id);
            if (el) this.setTilePos(el, t.row, t.col);
        });
        void tc.offsetWidth;
        tc.classList.remove('no-anim');
    }

    renderScore() {
        document.getElementById('score').textContent = this.score;
        document.getElementById('bestScore').textContent = this.bestScore;
    }

    renderMessage() {
        const messageEl = document.getElementById('gameMessage');
        const messageText = document.getElementById('gameMessageText');
        const keepPlayingBtn = document.getElementById('keepPlayingBtn');

        if (this.gameOver) {
            messageText.textContent = '🎮 Game Over!';
            messageEl.className = 'game-message game-over show';
            keepPlayingBtn.style.display = 'none';
            document.getElementById('gameStatus').textContent = 'Click "Try Again" to start a new game.';
        } else if (this.won && !this.keepPlaying) {
            messageText.textContent = '🎉 You Win!';
            messageEl.className = 'game-message game-won show';
            keepPlayingBtn.style.display = '';
            document.getElementById('gameStatus').textContent = 'You reached 2048!';
        } else {
            messageEl.className = 'game-message';
            document.getElementById('gameStatus').textContent = this.won
                ? '🎉 Keep going for a higher score!'
                : 'Tip: Use WASD or HJKL or arrow keys to play';
        }
    }

    // Rebuild the board from a saved numeric grid (no move animations).
    loadFromState(s) {
        this.clearBoardDom();
        this.cells = Array.from({ length: 4 }, () => Array(4).fill(null));
        const grid = s.grid;
        if (Array.isArray(grid)) {
            for (let r = 0; r < 4; r++) {
                for (let c = 0; c < 4; c++) {
                    const v = grid[r] && grid[r][c];
                    if (v) this.cells[r][c] = new Tile(v, r, c);
                }
            }
        }
        this.score = s.score || 0;
        this.bestScore = s.bestScore || this.bestScore;
        this.gameOver = !!s.gameOver;
        this.won = !!s.won;
        this.keepPlaying = !!s.keepPlaying;
        localStorage.setItem('2048-best', this.bestScore);
    }
}

// Initialize game
let game = new Game2048();

// Save current game state to extension
function saveState() {
    if (!game) return;
    try {
        vscode.postMessage({
            command: 'saveState',
            state: {
                grid: game.valueGrid(),
                score: game.score,
                bestScore: game.bestScore,
                gameOver: game.gameOver,
                won: game.won,
                keepPlaying: game.keepPlaying
            }
        });
        localStorage.setItem('2048-best', game.bestScore);
    } catch {
        // ignore if postMessage not available
    }
}

// Handle incoming messages from the extension (e.g., load saved state)
window.addEventListener('message', event => {
    const message = event.data;
    if (message.command === 'loadState' && message.state) {
        try {
            game.loadFromState(message.state);
            game.render();
        } catch {
            // ignore malformed state
        }
    }
});

// Get button references
const upBtn = document.getElementById('upBtn');
const downBtn = document.getElementById('downBtn');
const leftBtn = document.getElementById('leftBtn');
const rightBtn = document.getElementById('rightBtn');
const newGameBtn = document.getElementById('newGameBtn');
const tryAgainBtn = document.getElementById('tryAgainBtn');
const keepPlayingBtn = document.getElementById('keepPlayingBtn');

function doMove(direction) {
    if (game.isInputBlocked()) return;
    game.move(direction);
    game.render();
}

// Button event listeners
upBtn.addEventListener('click', () => doMove('up'));
downBtn.addEventListener('click', () => doMove('down'));
leftBtn.addEventListener('click', () => doMove('left'));
rightBtn.addEventListener('click', () => doMove('right'));

newGameBtn.addEventListener('click', () => {
    game.init();
    game.render();
    try { saveState(); } catch { /* ignore */ }
});

tryAgainBtn.addEventListener('click', () => {
    game.init();
    game.render();
    try { saveState(); } catch { /* ignore */ }
});

keepPlayingBtn.addEventListener('click', () => {
    game.keepPlaying = true;
    game.render();
    try { saveState(); } catch { /* ignore */ }
});

// Keyboard support: Arrow keys, WASD and HJKL (vim)
document.addEventListener('keydown', (e) => {
    const key = (e.key || '').toLowerCase();

    const handled = [
        'arrowup', 'arrowdown', 'arrowleft', 'arrowright',
        'w', 'a', 's', 'd',
        'h', 'j', 'k', 'l'
    ];

    if (!handled.includes(key)) return;

    e.preventDefault();

    if (key === 'arrowup' || key === 'w' || key === 'k') {
        doMove('up');
    } else if (key === 'arrowdown' || key === 's' || key === 'j') {
        doMove('down');
    } else if (key === 'arrowleft' || key === 'a' || key === 'h') {
        doMove('left');
    } else if (key === 'arrowright' || key === 'd' || key === 'l') {
        doMove('right');
    }
});

// Keep tiles aligned when the panel resizes.
if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(() => game.relayout());
    const board = document.getElementById('gameBoard');
    if (board) ro.observe(board);
}

// Ensure the webview can receive keyboard events immediately
window.addEventListener('load', () => {
    try {
        document.body.tabIndex = -1;
        document.body.focus();
    } catch {
        // ignore
    }
    // Re-measure once layout is fully settled, then paint.
    game.relayout();
    game.render();
});

// Initial render
game.render();
