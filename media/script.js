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

// ---------------- Theme-derived tile colors ----------------
//
// Four "anchor" colors are chosen from whatever colors the current theme
// exposes (chart palette, terminal ANSI palette, UI accents) by picking the
// four most spread out from each other and from the board. Each anchor owns
// a family of tiles; the larger tiles in a family reuse the anchor's hue in
// a different shade. Everything is computed in OKLab, so lightness steps and
// "how different two colors look" are perceptually uniform.
//   2   -> anchor A
//   4   -> anchor B, 8 a shade of it
//   16  -> anchor C, 32/64 shades of it
//   128 -> anchor D, 256/512/1024 shades of it
// Tiles 2048+ share the "background" look. When two anchors would clash, the
// later one is nudged in lightness only, so it stays within the theme.

function parseColorToRgb(str) {
    str = (str || '').trim();
    let r, g, b, a = 1;
    if (str[0] === '#') {
        const hex = str.slice(1);
        if (hex.length === 3 || hex.length === 4) {
            r = parseInt(hex[0] + hex[0], 16);
            g = parseInt(hex[1] + hex[1], 16);
            b = parseInt(hex[2] + hex[2], 16);
            if (hex.length === 4) a = parseInt(hex[3] + hex[3], 16) / 255;
        } else if (hex.length >= 6) {
            r = parseInt(hex.slice(0, 2), 16);
            g = parseInt(hex.slice(2, 4), 16);
            b = parseInt(hex.slice(4, 6), 16);
            if (hex.length >= 8) a = parseInt(hex.slice(6, 8), 16) / 255;
        }
    } else {
        const m = str.match(/rgba?\(([^)]+)\)/);
        if (m) {
            const p = m[1].split(',').map(x => parseFloat(x));
            [r, g, b] = p;
            if (p[3] !== undefined) a = p[3];
        }
    }
    if (r === undefined || Number.isNaN(r)) return null;
    return { r: r / 255, g: g / 255, b: b / 255, a };
}

function srgbToLinear(v) {
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function linearToSrgb(v) {
    return v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
}

// sRGB (0..1) -> OKLab. OKLab is perceptually uniform: equal steps in L look
// like equal steps in brightness, and Euclidean distance between two OKLab
// colors tracks how different they actually look.
function rgbToOklab(r, g, b) {
    const lr = srgbToLinear(r), lg = srgbToLinear(g), lb = srgbToLinear(b);
    const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
    const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
    const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
    return {
        L: 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
        a: 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
        b: 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s
    };
}

function oklabToRgb(c) {
    const l = c.L + 0.3963377774 * c.a + 0.2158037573 * c.b;
    const m = c.L - 0.1055613458 * c.a - 0.0638541728 * c.b;
    const s = c.L - 0.0894841775 * c.a - 1.2914855480 * c.b;
    const l3 = l * l * l, m3 = m * m * m, s3 = s * s * s;
    return [
        linearToSrgb( 4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3),
        linearToSrgb(-1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3),
        linearToSrgb(-0.0041960863 * l3 - 0.7034186147 * m3 + 1.7076147010 * s3)
    ];
}

function oklabDist(x, y) {
    return Math.hypot(x.L - y.L, x.a - y.a, x.b - y.b);
}

// Chroma is the OKLCH radius: how colorful (vs gray) the color is.
function chroma(c) {
    return Math.hypot(c.a, c.b);
}

function clampL(v) {
    return Math.max(0.3, Math.min(v, 0.92));
}

// WCAG relative luminance of an sRGB triple (0..1 channels).
function relLuminance(rgb) {
    const f = v => {
        v = Math.max(0, Math.min(1, v));
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]);
}

function inGamut(rgb) {
    return rgb.every(v => v >= -0.001 && v <= 1.001);
}

// OKLab -> CSS color. If the color falls outside sRGB, its chroma is scaled
// down (hue and lightness kept) until it fits, so a shade stays on the same
// hue instead of clipping toward a different one.
function oklabToCss(c) {
    let rgb = oklabToRgb(c);
    if (!inGamut(rgb)) {
        let lo = 0, hi = 1;
        for (let i = 0; i < 14; i++) {
            const mid = (lo + hi) / 2;
            if (inGamut(oklabToRgb({ L: c.L, a: c.a * mid, b: c.b * mid }))) lo = mid;
            else hi = mid;
        }
        rgb = oklabToRgb({ L: c.L, a: c.a * lo, b: c.b * lo });
    }
    const ch = v => Math.round(Math.max(0, Math.min(1, v)) * 255);
    return { css: `rgb(${ch(rgb[0])}, ${ch(rgb[1])}, ${ch(rgb[2])})`, rgb };
}

// Black or white text, whichever contrasts better with the tile color.
function bestTextFor(rgb) {
    const L = relLuminance(rgb);
    const withWhite = 1.05 / (L + 0.05);
    const withBlack = (L + 0.05) / 0.05;
    return withBlack >= withWhite ? 'rgba(0, 0, 0, 0.85)' : '#ffffff';
}

// Distance below which two tile colors read as "the same" (OKLab deltaE).
// Anchors and the board use the larger gap; shades within a family are let
// closer, so they still look like the same color, lighter or darker.
const MIN_OK = 0.10;
const SHADE_MIN = 0.055;

// A theme color usable as a tile background: mid lightness with at least a
// little chroma, so tiles don't come out looking like the (near-gray) board.
function usableAnchor(c) {
    return c.L >= 0.35 && c.L <= 0.85 && chroma(c) >= 0.03;
}

function isDistinct(c, used, min) {
    return used.every(t => oklabDist(c, t) >= min);
}

// Keep hue and chroma; step lightness until the color clears everything in
// `used`. Preferred direction is lighter on dark themes, darker on light.
function ensureDistinct(c, used, dark, min) {
    if (isDistinct(c, used, min)) return c;
    const dir = dark ? 1 : -1;
    for (let step = 1; step <= 10; step++) {
        for (const s of [dir, -dir]) {
            const L = c.L + s * step * 0.045;
            if (L < 0.3 || L > 0.92) continue;
            const cand = { L, a: c.a, b: c.b };
            if (isDistinct(cand, used, min)) return cand;
        }
    }
    return c;
}

// Farthest-point sampling: repeatedly take the candidate whose nearest
// already-chosen color (or board color) is furthest away, so the picks are
// spread across whatever colors the theme actually provides.
function pickAnchors(candidates, taken, n) {
    const pool = candidates.slice();
    const picked = [];
    while (picked.length < n && pool.length) {
        const refs = picked.concat(taken);
        let best = 0, bestScore = -Infinity;
        for (let i = 0; i < pool.length; i++) {
            const score = refs.length
                ? Math.min(...refs.map(t => oklabDist(pool[i], t)))
                : chroma(pool[i]);
            if (score > bestScore) { bestScore = score; best = i; }
        }
        picked.push(pool.splice(best, 1)[0]);
    }
    return picked;
}

// Themes with fewer than four usable colors (e.g. monochrome) get the rest
// synthesized from the accent: same chroma, hues fanned out by the golden
// angle so the invented anchors stay distinct and in the theme's spirit.
function fillAnchors(existing, taken, accent, dark, n) {
    const out = existing.slice();
    const baseHue = Math.atan2(accent.b, accent.a);
    const c = Math.max(0.06, chroma(accent));
    const L0 = dark ? 0.62 : 0.58;
    for (let i = 0; out.length < n && i < 60; i++) {
        const h = baseHue + i * 2.399963;
        const cand = {
            L: clampL(L0 + (i % 2 ? -0.08 : 0.08)),
            a: Math.cos(h) * c,
            b: Math.sin(h) * c
        };
        if (isDistinct(cand, out.concat(taken), MIN_OK)) out.push(cand);
    }
    return out;
}

// Colors gathered from the theme to choose four anchors from. Chart colors
// come first (they are designed to be mutually distinct), then the terminal
// palette and a few UI accents.
const CANDIDATE_VARS = [
    '--vscode-charts-red', '--vscode-charts-blue', '--vscode-charts-yellow',
    '--vscode-charts-orange', '--vscode-charts-green', '--vscode-charts-purple',
    '--vscode-terminal-ansiRed', '--vscode-terminal-ansiGreen',
    '--vscode-terminal-ansiYellow', '--vscode-terminal-ansiBlue',
    '--vscode-terminal-ansiMagenta', '--vscode-terminal-ansiCyan',
    '--vscode-terminal-ansiBrightRed', '--vscode-terminal-ansiBrightGreen',
    '--vscode-terminal-ansiBrightYellow', '--vscode-terminal-ansiBrightBlue',
    '--vscode-terminal-ansiBrightMagenta', '--vscode-terminal-ansiBrightCyan',
    '--vscode-textLink-foreground', '--vscode-notificationLink-foreground',
    '--vscode-button-background', '--vscode-button-hoverBackground'
];

// Each family shares one anchor color; the rest are the same hue in a
// different shade. 2 stands alone; 4->8; 16->32,64; 128->256,512,1024.
const TILE_FAMILIES = [
    [2],
    [4, 8],
    [16, 32, 64],
    [128, 256, 512, 1024]
];

function computeTileColors() {
    const cs = getComputedStyle(document.body);
    const parseLab = name => {
        const rgb = parseColorToRgb(cs.getPropertyValue(name));
        return rgb && rgb.a > 0.5 ? rgbToOklab(rgb.r, rgb.g, rgb.b) : null;
    };

    const editorLab = parseLab('--vscode-editor-background') || { L: 0.15, a: 0, b: 0 };
    const dark = editorLab.L < 0.5;
    const accent = parseLab('--vscode-textLink-foreground') || { L: 0.6, a: -0.03, b: -0.13 };

    // Board colors the tiles must not resemble, or a tile looks like a hole.
    const taken = [];
    for (const name of ['--vscode-editor-background', '--vscode-sideBar-background', '--vscode-input-background']) {
        const c = parseLab(name);
        if (c) taken.push(c);
    }

    // Distinct, tile-usable colors offered by the theme.
    const candidates = [];
    for (const name of CANDIDATE_VARS) {
        const c = parseLab(name);
        if (!c || !usableAnchor(c)) continue;
        if (!isDistinct(c, taken, MIN_OK)) continue;      // too close to the board
        if (!isDistinct(c, candidates, MIN_OK)) continue; // duplicate of one taken
        candidates.push(c);
    }

    let anchors = pickAnchors(candidates, taken, 4);
    if (anchors.length < 4) anchors = fillAnchors(anchors, taken, accent, dark, 4);
    anchors.sort((x, y) => chroma(x) - chroma(y)); // calm -> vivid as value grows

    const colors = new Map();
    const used = taken.slice();
    const place = (value, lab) => {
        const out = oklabToCss(lab);
        colors.set(value, { bg: out.css, fg: bestTextFor(out.rgb) });
    };

    const dir = dark ? 1 : -1;
    const offsets = [dir * 0.085, -dir * 0.085, dir * 0.17, -dir * 0.17, dir * 0.255];

    TILE_FAMILIES.forEach((family, i) => {
        const anchor = ensureDistinct(anchors[i], used, dark, MIN_OK);
        used.push(anchor);
        place(family[0], anchor);

        // Shades keep the anchor's hue/chroma and only move in lightness.
        let oi = 0;
        for (let k = 1; k < family.length; k++) {
            let shade = null;
            for (; oi < offsets.length && !shade; oi++) {
                const L = anchor.L + offsets[oi];
                if (L < 0.32 || L > 0.9) continue;
                const cand = { L, a: anchor.a, b: anchor.b };
                if (isDistinct(cand, used, SHADE_MIN)) shade = cand;
            }
            if (!shade) {
                shade = ensureDistinct(
                    { L: clampL(anchor.L + dir * 0.085 * k), a: anchor.a, b: anchor.b },
                    used, dark, SHADE_MIN
                );
            }
            used.push(shade);
            place(family[k], shade);
        }
    });
    return colors;
}

let TILE_COLORS = computeTileColors();

// Colors are applied per element (the webview CSP blocks injected <style>
// tags, but programmatic style properties are fine).
function applyTileColor(innerEl, value) {
    if (value >= 2048) {
        innerEl.style.backgroundColor = 'var(--vscode-input-background)';
        innerEl.style.color = 'var(--vscode-textLink-foreground)';
    } else {
        const c = TILE_COLORS.get(value);
        if (c) {
            innerEl.style.backgroundColor = c.bg;
            innerEl.style.color = c.fg;
        }
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
        this.justWon = false;
        this.aiTainted = false; // AI played this game: best score is frozen
        this.removed = [];
        this.clearBoardDom();
        this.addRandomTile();
        this.addRandomTile();
    }

    // True once the game shouldn't accept moves (board is dead).
    isInputBlocked() {
        return this.gameOver;
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
                this.justWon = true;
            }
            this.checkGameOver();
            try { saveState(); } catch { /* ignore */ }
        }
        return moved;
    }

    updateBestScore() {
        if (this.aiTainted) return;
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
        applyTileColor(inner, value);
        el.appendChild(inner);
        return el;
    }

    updateTileEl(el, value) {
        if (el.dataset.value !== String(value)) {
            el.dataset.value = value;
            const inner = el.querySelector('.tile-inner');
            inner.textContent = value;
            applyTileColor(inner, value);
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

            // The glow follows the current highest tile(s), but only once the
            // player has actually reached 2048.
            let maxVal = 0;
            this.forEachTile(t => { if (t.value > maxVal) maxVal = t.value; });
            this.forEachTile(t => {
                const el = this.tileEls.get(t.id);
                if (el) el.classList.toggle('tile-max', maxVal >= 2048 && t.value === maxVal);
            });
        }

        this.renderScore();
        this.renderMessage();

        if (this.justWon) {
            this.justWon = false;
            this.showCongrats();
        }
    }

    // Non-blocking congrats toast shown when 2048 is first reached.
    showCongrats() {
        const toast = document.getElementById('congratsToast');
        if (!toast) return;
        toast.classList.add('show');
        clearTimeout(this.congratsTimer);
        this.congratsTimer = setTimeout(() => toast.classList.remove('show'), 4000);
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

        if (this.gameOver) {
            messageText.textContent = this.won ? '🎉 Game Over — you made 2048!' : '🎮 Game Over!';
            messageEl.className = 'game-message game-over show';
            document.getElementById('gameStatus').textContent = 'Click "Try Again" to start a new game.';
        } else {
            messageEl.className = 'game-message';
            document.getElementById('gameStatus').textContent = aiActive
                ? '🤖 AI is playing… (best score is not affected)'
                : this.won
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
        this.justWon = false;
        this.aiTainted = !!s.aiTainted;
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
                aiTainted: game.aiTainted
            }
        });
        localStorage.setItem('2048-best', game.bestScore);
    } catch {
        // ignore if postMessage not available
    }
}

// Handle incoming messages from the extension: initial state restore and
// live sync updates mirrored from the game in another view.
window.addEventListener('message', event => {
    const message = event.data;
    if (message.command === 'loadState' && message.state) {
        try {
            game.loadFromState(message.state);
            game.render();
            if (game.gameOver) stopAI();
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

function doMove(direction) {
    if (aiActive || game.isInputBlocked()) return;
    clearHint();
    game.move(direction);
    game.render();
}

// ---------------- AI (expectimax over precomputed row tables) ----------------
//
// Each row is encoded as a 16-bit int (4 cells x 4-bit tile exponents), so
// the slide result and heuristic score of every possible row is precomputed
// once into lookup tables. A board is 4 such rows; vertical moves go through
// a transpose. This makes search nodes cheap enough for deep lookahead.

const AI_DIRECTIONS = ['up', 'down', 'left', 'right'];

const ROW_LEFT = new Uint16Array(65536);
const ROW_RIGHT = new Uint16Array(65536);
const ROW_HEUR = new Float64Array(65536);

{
    const reverseRow = r =>
        ((r & 0xf) << 12) | (((r >> 4) & 0xf) << 8) | (((r >> 8) & 0xf) << 4) | ((r >> 12) & 0xf);

    const POW35 = [];
    const POW4 = [];
    for (let i = 0; i < 16; i++) {
        POW35[i] = Math.pow(i, 3.5);
        POW4[i] = Math.pow(i, 4);
    }

    for (let row = 0; row < 65536; row++) {
        const cells = [row & 0xf, (row >> 4) & 0xf, (row >> 8) & 0xf, (row >> 12) & 0xf];

        // Slide + merge toward index 0 (exponents; merging bumps the rank).
        const tiles = cells.filter(v => v);
        const out = [];
        for (let i = 0; i < tiles.length; i++) {
            if (i + 1 < tiles.length && tiles[i] === tiles[i + 1] && tiles[i] < 15) {
                out.push(tiles[i] + 1);
                i++;
            } else {
                out.push(tiles[i]);
            }
        }
        while (out.length < 4) out.push(0);
        const slid = out[0] | (out[1] << 4) | (out[2] << 8) | (out[3] << 12);

        ROW_LEFT[row] = slid;
        ROW_RIGHT[reverseRow(row)] = reverseRow(slid);

        // Row heuristic: reward empty cells and adjacent merge opportunities,
        // punish broken monotonicity and large scattered ranks.
        let sum = 0, empty = 0, merges = 0, prev = 0, run = 0;
        for (let i = 0; i < 4; i++) {
            const rank = cells[i];
            sum += POW35[rank];
            if (rank === 0) { empty++; continue; }
            if (prev === rank) {
                run++;
            } else {
                if (run) merges += 1 + run;
                run = 0;
            }
            prev = rank;
        }
        if (run) merges += 1 + run;

        let monoLeft = 0, monoRight = 0;
        for (let i = 1; i < 4; i++) {
            if (cells[i - 1] > cells[i]) monoLeft += POW4[cells[i - 1]] - POW4[cells[i]];
            else monoRight += POW4[cells[i]] - POW4[cells[i - 1]];
        }

        ROW_HEUR[row] = 200000
            + 270 * empty
            + 700 * merges
            - 47 * Math.min(monoLeft, monoRight)
            - 11 * sum;
    }
}

// 4x4 value grid -> array of 4 row codes (tile exponents).
function aiBoardFromGrid(grid) {
    const rows = [0, 0, 0, 0];
    for (let r = 0; r < 4; r++) {
        for (let c = 0; c < 4; c++) {
            const v = grid[r][c];
            if (v) rows[r] |= Math.round(Math.log2(v)) << (c * 4);
        }
    }
    return rows;
}

function aiTranspose(b) {
    const t = [0, 0, 0, 0];
    for (let r = 0; r < 4; r++) {
        for (let c = 0; c < 4; c++) {
            t[c] |= ((b[r] >> (c * 4)) & 0xf) << (r * 4);
        }
    }
    return t;
}

// Apply a move via the row tables. Returns the new board, or null if
// nothing moved.
function aiApplyMove(b, direction) {
    let res;
    if (direction === 'left') {
        res = [ROW_LEFT[b[0]], ROW_LEFT[b[1]], ROW_LEFT[b[2]], ROW_LEFT[b[3]]];
    } else if (direction === 'right') {
        res = [ROW_RIGHT[b[0]], ROW_RIGHT[b[1]], ROW_RIGHT[b[2]], ROW_RIGHT[b[3]]];
    } else {
        const t = aiTranspose(b);
        const table = direction === 'up' ? ROW_LEFT : ROW_RIGHT;
        res = aiTranspose([table[t[0]], table[t[1]], table[t[2]], table[t[3]]]);
    }
    return (res[0] === b[0] && res[1] === b[1] && res[2] === b[2] && res[3] === b[3])
        ? null
        : res;
}

// Board quality = row heuristics + column heuristics (via transpose).
function aiEvaluate(b) {
    const t = aiTranspose(b);
    return ROW_HEUR[b[0]] + ROW_HEUR[b[1]] + ROW_HEUR[b[2]] + ROW_HEUR[b[3]]
        + ROW_HEUR[t[0]] + ROW_HEUR[t[1]] + ROW_HEUR[t[2]] + ROW_HEUR[t[3]];
}

// Transposition cache for the current search (board key -> value at depth).
let aiCache = new Map();

// Player node: best value over all legal moves. A dead board returns 0,
// which is a massive penalty against the heuristic's per-row constant.
function aiMaxNode(b, depth, cprob) {
    let best = 0;
    for (const dir of AI_DIRECTIONS) {
        const next = aiApplyMove(b, dir);
        if (next) {
            const val = aiChanceNode(next, depth, cprob);
            if (val > best) best = val;
        }
    }
    return best;
}

// Chance node: expected value over every possible tile spawn (2 with 90%,
// 4 with 10%). Branches whose cumulative probability is negligible are
// cut off at the heuristic.
function aiChanceNode(b, depth, cprob) {
    if (depth <= 0 || cprob < 0.0001) return aiEvaluate(b);

    const key = b[0] + ',' + b[1] + ',' + b[2] + ',' + b[3];
    const hit = aiCache.get(key);
    if (hit !== undefined && hit.depth >= depth) return hit.value;

    const spots = [];
    for (let r = 0; r < 4; r++) {
        for (let shift = 0; shift < 16; shift += 4) {
            if (((b[r] >> shift) & 0xf) === 0) spots.push(r * 16 + shift);
        }
    }
    cprob /= spots.length;

    let total = 0;
    for (const spot of spots) {
        const r = (spot / 16) | 0;
        const shift = spot % 16;
        const spawned = b.slice();
        spawned[r] = b[r] | (1 << shift);
        total += 0.9 * aiMaxNode(spawned, depth - 1, cprob * 0.9);
        spawned[r] = b[r] | (2 << shift);
        total += 0.1 * aiMaxNode(spawned, depth - 1, cprob * 0.1);
    }
    total /= spots.length;

    aiCache.set(key, { depth, value: total });
    return total;
}

// Time budget per AI decision. Deeper search = stronger play; this bounds
// how long the UI thread is blocked per move.
const AI_TIME_BUDGET_MS = 80;

// Find the best move for the current position: iterative deepening until
// the time budget says the next depth won't fit.
function findBestMove(grid, budget = AI_TIME_BUDGET_MS) {
    const board = aiBoardFromGrid(grid);
    const start = performance.now();
    let bestDir = null;

    for (let depth = 2; depth <= 8; depth++) {
        const iterStart = performance.now();
        aiCache = new Map();

        let dir = null;
        let bestVal = -Infinity;
        for (const d of AI_DIRECTIONS) {
            const next = aiApplyMove(board, d);
            if (!next) continue;
            const val = aiChanceNode(next, depth - 1, 1);
            if (val > bestVal) {
                bestVal = val;
                dir = d;
            }
        }
        if (!dir) break; // no legal moves
        bestDir = dir;

        // Each extra ply costs roughly an order of magnitude more; only
        // start the next depth if that plausibly fits the budget.
        const now = performance.now();
        if ((now - start) + (now - iterStart) * 8 > budget) break;
    }
    return bestDir;
}

// ---------------- AI takeover mode ----------------

const aiBtn = document.getElementById('aiBtn');
const stopAiBtn = document.getElementById('stopAiBtn');
const actionButtons = document.getElementById('actionButtons');
const aiControls = document.getElementById('aiControls');
const aiSpeedSlider = document.getElementById('aiSpeedSlider');

// Slider notch (1-10) -> ms between AI moves.
const AI_SPEEDS = [500, 380, 280, 200, 140, 100, 70, 50, 35, 25];

let aiActive = false;
let aiTimer = null;
let aiDelay = AI_SPEEDS[4];

// Restore last used speed.
{
    const savedSpeed = Number(localStorage.getItem('2048-ai-speed'));
    if (savedSpeed >= 1 && savedSpeed <= 10) {
        aiSpeedSlider.value = savedSpeed;
        aiDelay = AI_SPEEDS[savedSpeed - 1];
    }
}

aiSpeedSlider.addEventListener('input', () => {
    aiDelay = AI_SPEEDS[aiSpeedSlider.value - 1];
    localStorage.setItem('2048-ai-speed', aiSpeedSlider.value);
});

// While the AI plays, the hint/take-over buttons give way to the
// stop + speed-slider row.
function updateAiUi() {
    actionButtons.hidden = aiActive;
    aiControls.hidden = !aiActive;
}

function stopAI() {
    if (aiTimer) clearTimeout(aiTimer);
    aiTimer = null;
    if (!aiActive) return;
    aiActive = false;
    updateAiUi();
    game.renderMessage();
}

function aiStep() {
    if (!aiActive || game.gameOver) { stopAI(); return; }
    const dir = findBestMove(game.valueGrid());
    if (!dir || !game.move(dir)) { stopAI(); game.render(); return; }
    game.render();
    if (game.gameOver) { stopAI(); return; }
    aiTimer = setTimeout(aiStep, aiDelay);
}

aiBtn.addEventListener('click', () => {
    if (aiActive || game.gameOver) return;
    aiActive = true;
    game.aiTainted = true; // AI plays for score, not for the record books
    clearHint();
    updateAiUi();
    game.renderMessage();
    try { saveState(); } catch { /* ignore */ }
    aiStep();
});

stopAiBtn.addEventListener('click', stopAI);

// ---------------- Hint (AI-suggested move, costs 10% of score) ----------------

const hintBtn = document.getElementById('hintBtn');
const DIRECTION_BUTTONS = { up: upBtn, down: downBtn, left: leftBtn, right: rightBtn };
const DIRECTION_ARROWS = { up: '↑', down: '↓', left: '←', right: '→' };
let hintTimer = null;

function clearHint() {
    clearTimeout(hintTimer);
    hintTimer = null;
    for (const el of Object.values(DIRECTION_BUTTONS)) el.classList.remove('hint-suggest');
}

hintBtn.addEventListener('click', () => {
    if (aiActive || game.isInputBlocked()) return;
    const dir = findBestMove(game.valueGrid());
    if (!dir) return;

    const penalty = Math.floor(game.score * 0.1);
    game.score -= penalty;
    game.renderScore();
    try { saveState(); } catch { /* ignore */ }

    clearHint();
    DIRECTION_BUTTONS[dir].classList.add('hint-suggest');
    hintTimer = setTimeout(clearHint, 2000);
    document.getElementById('gameStatus').textContent =
        `💡 Hint: move ${DIRECTION_ARROWS[dir]} ${dir}` + (penalty ? ` (−${penalty} points)` : '');
});

// Button event listeners
upBtn.addEventListener('click', () => doMove('up'));
downBtn.addEventListener('click', () => doMove('down'));
leftBtn.addEventListener('click', () => doMove('left'));
rightBtn.addEventListener('click', () => doMove('right'));

newGameBtn.addEventListener('click', () => {
    stopAI();
    game.init();
    game.render();
    try { saveState(); } catch { /* ignore */ }
});

tryAgainBtn.addEventListener('click', () => {
    stopAI();
    game.init();
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

// Re-derive tile colors when the VS Code theme changes (the webview gets
// new CSS variables and updated attributes on <html>/<body>).
{
    const themeObserver = new MutationObserver(() => {
        TILE_COLORS = computeTileColors();
        game.forEachTile(t => {
            const el = game.tileEls.get(t.id);
            if (el) applyTileColor(el.querySelector('.tile-inner'), t.value);
        });
    });
    themeObserver.observe(document.documentElement, { attributes: true });
    themeObserver.observe(document.body, { attributes: true });
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

// Ask the extension for the latest saved state. Sent from the script (rather
// than pushed on a timer by the extension) so it also covers this webview
// being re-created after its view was hidden.
try {
    vscode.postMessage({ command: 'requestState' });
} catch {
    // ignore if postMessage not available
}
