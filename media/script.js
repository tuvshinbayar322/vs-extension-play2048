// 2048 Game Implementation

// Webview VS Code API
const vscode = acquireVsCodeApi();

class Game2048 {
    constructor() {
        this.grid = Array(4).fill().map(() => Array(4).fill(0));
        this.score = 0;
        this.bestScore = localStorage.getItem('2048-best') || 0;
        this.gameOver = false;
        this.won = false;
        this.keepPlaying = false;
        this.init();
    }

    init() {
        this.grid = Array(4).fill().map(() => Array(4).fill(0));
        this.score = 0;
        this.gameOver = false;
        this.won = false;
        this.keepPlaying = false;
        this.addNewTile();
        this.addNewTile();
        this.render();
    }

    // True once the game shouldn't accept moves until the player dismisses
    // the game-over or win overlay.
    isInputBlocked() {
        return this.gameOver || (this.won && !this.keepPlaying);
    }

    addNewTile() {
        const empty = [];
        for (let i = 0; i < 4; i++) {
            for (let j = 0; j < 4; j++) {
                if (this.grid[i][j] === 0) {
                    empty.push({ x: i, y: j });
                }
            }
        }

        if (empty.length > 0) {
            const { x, y } = empty[Math.floor(Math.random() * empty.length)];
            this.grid[x][y] = Math.random() < 0.9 ? 2 : 4;
        }
    }

    canMove(direction) {
        // Probe the move on a throwaway grid/score so that checking whether a
        // move is possible never mutates real game state (move() has side
        // effects: it changes the score, adds a tile, and saves state).
        const originalGrid = this.grid;
        const originalScore = this.score;
        const gridBefore = JSON.stringify(originalGrid);

        this.grid = originalGrid.map(row => [...row]);

        if (direction === 'left') {
            this.moveLeft();
        } else if (direction === 'right') {
            this.moveRight();
        } else if (direction === 'up') {
            this.moveUp();
        } else if (direction === 'down') {
            this.moveDown();
        }

        const gridAfter = JSON.stringify(this.grid);
        this.grid = originalGrid;
        this.score = originalScore;
        return gridBefore !== gridAfter;
    }

    move(direction) {
        const gridBefore = JSON.stringify(this.grid);

        if (direction === 'left') {
            this.moveLeft();
        } else if (direction === 'right') {
            this.moveRight();
        } else if (direction === 'up') {
            this.moveUp();
        } else if (direction === 'down') {
            this.moveDown();
        }

        const gridAfter = JSON.stringify(this.grid);
        if (gridBefore !== gridAfter) {
            this.addNewTile();
            if (!this.won && this.hasWon()) {
                this.won = true;
            }
            this.checkGameOver();
            try { saveState(); } catch { /* ignore */ }
        }
    }

    moveLeft() {
        for (let i = 0; i < 4; i++) {
            this.grid[i] = this.slideAndMerge(this.grid[i]);
        }
    }

    moveRight() {
        for (let i = 0; i < 4; i++) {
            this.grid[i] = this.slideAndMerge(this.grid[i].reverse()).reverse();
        }
    }

    moveUp() {
        const transposed = this.transpose(this.grid);
        for (let i = 0; i < 4; i++) {
            transposed[i] = this.slideAndMerge(transposed[i]);
        }
        this.grid = this.transpose(transposed);
    }

    moveDown() {
        const transposed = this.transpose(this.grid);
        for (let i = 0; i < 4; i++) {
            transposed[i] = this.slideAndMerge(transposed[i].reverse()).reverse();
        }
        this.grid = this.transpose(transposed);
    }

    slideAndMerge(line) {
        // Remove zeros
        let newLine = line.filter(val => val !== 0);

        // Merge
        for (let i = 0; i < newLine.length - 1; i++) {
            if (newLine[i] === newLine[i + 1]) {
                newLine[i] *= 2;
                this.score += newLine[i];
                newLine.splice(i + 1, 1);
            }
        }

        // Add zeros
        while (newLine.length < 4) {
            newLine.push(0);
        }

        return newLine;
    }

    transpose(matrix) {
        return matrix[0].map((_, i) => matrix.map(row => row[i]));
    }

    checkGameOver() {
        // Check if there are empty cells
        for (let i = 0; i < 4; i++) {
            for (let j = 0; j < 4; j++) {
                if (this.grid[i][j] === 0) {
                    return;
                }
            }
        }

        // Check if any move is possible
        for (let dir of ['left', 'right', 'up', 'down']) {
            if (this.canMove(dir)) {
                return;
            }
        }

        this.gameOver = true;
        if (this.score > this.bestScore) {
            this.bestScore = this.score;
            localStorage.setItem('2048-best', this.bestScore);
        }
        try { saveState(); } catch { /* ignore */ }
    }

    render() {
        const gameBoard = document.getElementById('gameBoard');
        gameBoard.innerHTML = '';

        for (let i = 0; i < 4; i++) {
            for (let j = 0; j < 4; j++) {
                const value = this.grid[i][j];
                const tile = document.createElement('div');
                tile.className = 'tile ' + (value === 0 ? 'empty' : '');
                tile.textContent = value === 0 ? '' : value;
                tile.dataset.value = value;
                gameBoard.appendChild(tile);
            }
        }

        document.getElementById('score').textContent = this.score;
        document.getElementById('bestScore').textContent = this.bestScore;

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

    hasWon() {
        for (let i = 0; i < 4; i++) {
            for (let j = 0; j < 4; j++) {
                if (this.grid[i][j] === 2048) {
                    return true;
                }
            }
        }
        return false;
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
                grid: game.grid,
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
        const s = message.state;
        try {
            game.grid = s.grid || game.grid;
            game.score = s.score || 0;
            game.bestScore = s.bestScore || game.bestScore;
            game.gameOver = !!s.gameOver;
            game.won = !!s.won;
            game.keepPlaying = !!s.keepPlaying;
            localStorage.setItem('2048-best', game.bestScore);
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

// Button event listeners
upBtn.addEventListener('click', () => {
    if (!game.isInputBlocked()) {
        game.move('up');
        game.render();
    }
});

downBtn.addEventListener('click', () => {
    if (!game.isInputBlocked()) {
        game.move('down');
        game.render();
    }
});

leftBtn.addEventListener('click', () => {
    if (!game.isInputBlocked()) {
        game.move('left');
        game.render();
    }
});

rightBtn.addEventListener('click', () => {
    if (!game.isInputBlocked()) {
        game.move('right');
        game.render();
    }
});

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
        'arrowup','arrowdown','arrowleft','arrowright',
        'w','a','s','d',
        'h','j','k','l'
    ];

    if (!handled.includes(key)) return;

    e.preventDefault();

    // Map keys to moves: Arrow/WASD/Vim(HJKL)
    if (key === 'arrowup' || key === 'w' || key === 'k') {
        upBtn.click();
    } else if (key === 'arrowdown' || key === 's' || key === 'j') {
        downBtn.click();
    } else if (key === 'arrowleft' || key === 'a' || key === 'h') {
        leftBtn.click();
    } else if (key === 'arrowright' || key === 'd' || key === 'l') {
        rightBtn.click();
    }
});

// Ensure the webview can receive keyboard events immediately
window.addEventListener('load', () => {
    try {
        document.body.tabIndex = -1;
        document.body.focus();
    } catch {
        // ignore
    }
});

// Initial render
game.render();
