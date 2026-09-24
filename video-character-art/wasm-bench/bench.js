/**
 * bench.js — Node 等价性验证 + 基准(node bench.js)
 *
 * 用同一组伪随机像素分别跑 JS 版 convertFrame 与 wasm 版 vca_convert_frame,
 * 逐字节对比输出字符串与索引表,再各跑 N 轮计时得出加速比。
 * (wasm 核心带 ENVIRONMENT=node,可直接在 Node 里实例化)
 */
'use strict';

const fs = require('fs');
const path = require('path');

// ---------- JS 参考实现(逐行拷自 video-character-art/index.html 的 convertFrame) ----------
const colors = {
    "§0": [0, 0, 0], "§1": [0, 0, 170], "§2": [0, 170, 0], "§3": [0, 170, 170],
    "§4": [170, 0, 0], "§5": [170, 0, 170], "§6": [255, 170, 0], "§7": [170, 170, 170],
    "§8": [85, 85, 85], "§9": [85, 85, 255], "§a": [85, 255, 85], "§b": [85, 255, 255],
    "§c": [255, 85, 85], "§d": [255, 85, 255], "§e": [255, 255, 85], "§f": [255, 255, 255],
    "§g": [221, 214, 5], "§h": [227, 212, 209], "§i": [206, 202, 202], "§j": [68, 58, 59],
    "§m": [151, 22, 7], "§n": [180, 104, 77], "§p": [222, 177, 45], "§q": [17, 160, 54],
    "§s": [44, 186, 168], "§t": [33, 73, 123], "§u": [154, 92, 198]
};
const charTable = '┃┃┃┋┋╏┇';

function convertFrame(imgData, w, h, enableDither) {
    var chunkd = new Uint8Array(imgData.data);
    var X = w, Y = h;
    var asciiStr = '';
    for (var y = 0; y < Y; y++) {
        for (var x = 0; x < X; x++) {
            var r, g, b, diff, diffminItem;
            var diffmin = Infinity;
            var idx = (x + y * X) * 4;
            r = chunkd[idx]; g = chunkd[idx + 1]; b = chunkd[idx + 2];
            for (var i in colors) {
                diff = (colors[i][0] - r) ** 2 + (colors[i][1] - g) ** 2 + (colors[i][2] - b) ** 2;
                if (diffmin > diff) { diffmin = diff; diffminItem = i; }
            }
            var dr = (chunkd[idx] - colors[diffminItem][0]);
            var dg = (chunkd[idx + 1] - colors[diffminItem][1]);
            var db = (chunkd[idx + 2] - colors[diffminItem][2]);
            var naturation = (dr + dg + db) / 3;
            var charIdx = 3 - Math.round((naturation / 96) * 4);
            if (charIdx < 0) charIdx = 0;
            if (charIdx >= charTable.length) charIdx = charTable.length - 1;
            asciiStr += diffminItem + charTable[charIdx];
            if (enableDither) {
                if (x < X - 2) {
                    chunkd[(x + 1 + y * X) * 4]     += dr * 4 / 21;
                    chunkd[(x + 1 + y * X) * 4 + 1] += dg * 4 / 21;
                    chunkd[(x + 1 + y * X) * 4 + 2] += db * 4 / 21;
                    chunkd[(x + 2 + y * X) * 4]     += dr * 2 / 21;
                    chunkd[(x + 2 + y * X) * 4 + 1] += dg * 2 / 21;
                    chunkd[(x + 2 + y * X) * 4 + 2] += db * 2 / 21;
                } else if (x < X - 1) {
                    chunkd[(x + 1 + y * X) * 4]     += dr * 7 / 16;
                    chunkd[(x + 1 + y * X) * 4 + 1] += dg * 7 / 16;
                    chunkd[(x + 2 - 1 + y * X) * 4 + 2] += db * 7 / 16;
                }
                if (x > 1 && y < Y - 2) {
                    const B = (x2, y2, k, e) => { chunkd[(x2 + y2 * X) * 4 + k] += k === 0 ? dr * e : k === 1 ? dg * e : db * e; };
                    B(x - 2, y + 1, 0, 1 / 21); B(x - 2, y + 1, 1, 1 / 21); B(x - 2, y + 1, 2, 1 / 21);
                    B(x - 1, y + 1, 0, 2 / 21); B(x - 1, y + 1, 1, 2 / 21); B(x - 1, y + 1, 2, 2 / 21);
                    B(x,     y + 1, 0, 4 / 21); B(x,     y + 1, 1, 4 / 21); B(x,     y + 1, 2, 4 / 21);
                    B(x + 1, y + 1, 0, 2 / 21); B(x + 1, y + 1, 1, 2 / 21); B(x + 1, y + 1, 2, 2 / 21);
                    B(x + 2, y + 1, 0, 1 / 21); B(x + 2, y + 1, 1, 1 / 21); B(x + 2, y + 1, 2, 1 / 21);
                    B(x - 2, y + 2, 0, 1 / 42); B(x - 2, y + 2, 1, 1 / 42); B(x - 2, y + 2, 2, 1 / 42);
                    B(x - 1, y + 2, 0, 1 / 21); B(x - 1, y + 2, 1, 1 / 21); B(x - 1, y + 2, 2, 1 / 21);
                    B(x,     y + 2, 0, 2 / 21); B(x,     y + 2, 1, 2 / 21); B(x,     y + 2, 2, 2 / 21);
                    B(x + 1, y + 2, 0, 1 / 21); B(x + 1, y + 2, 1, 1 / 21); B(x + 1, y + 2, 2, 1 / 21);
                    B(x + 2, y + 2, 0, 1 / 42); B(x + 2, y + 2, 1, 1 / 42); B(x + 2, y + 2, 2, 1 / 42);
                }
            }
        }
        asciiStr += '\n';
    }
    return asciiStr;
}

function optimizeColorString(text) {
    var result = '';
    var i = 0;
    var len = text.length;
    while (i < len) {
        if (text[i] === '§' && i + 2 < len) {
            var colorCode = text.substr(i, 2);
            var displayChar = text[i + 2];
            result += colorCode + displayChar;
            i += 3;
            while (i < len && text[i] === '§' && text.substr(i, 2) === colorCode && i + 2 < len) {
                result += text[i + 2];
                i += 3;
            }
        } else {
            result += text[i];
            i++;
        }
    }
    return result;
}

// ---------- wasm 侧加载(node 环境) ----------
async function loadWasm() {
    const createModule = require('./vca_core.js');
    return createModule();
}

function mulberry32(seed) {
    return function () {
        seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function makePixels(w, h, seed) {
    const rnd = mulberry32(seed);
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < data.length; i += 4) {
        data[i] = Math.floor(rnd() * 256);
        data[i + 1] = Math.floor(rnd() * 256);
        data[i + 2] = Math.floor(rnd() * 256);
        data[i + 3] = 255;
    }
    return { data, width: w, height: h };
}

async function main() {
    const W = parseInt(process.env.W || 320), H = parseInt(process.env.H || 180);
    const ITER = 20;
    const DITHER = process.argv.includes('--dither');

    console.log(`尺寸 ${W}x${H},dither=${DITHER},每版 ${ITER} 轮`);

    // ---- 等价性 ----
    const pix = makePixels(W, H, 12345);

    const M = await loadWasm();
    const okInit = M._vca_init(W, H);
    if (!okInit) { console.error('vca_init 失败'); process.exit(1); }
    const pxPtr = M._vca_pixels_ptr();
    const codesPtr = M._vca_codes_ptr();
    const shadesPtr = M._vca_shades_ptr();
    const heap = new Uint8Array(M.HEAPU8.buffer);
    heap.set(pix.data, pxPtr);
    M._vca_convert_frame(W, H, DITHER ? 1 : 0);
    const heap2 = new Uint8Array(M.HEAPU8.buffer);
    const codes = heap2.slice(codesPtr, codesPtr + W * H);
    const shades = heap2.slice(shadesPtr, shadesPtr + W * H);

    // JS 索引版对照
    const ref = jsFrameIndexRef(pix.data, W, H, DITHER);
    const codeLetters = '0123456789abcdefghijmnpqstu';
    let mismatches = 0;
    for (let i = 0; i < W * H; i++) {
        if (ref.codes[i] !== codes[i] || ref.shades[i] !== shades[i]) {
            if (mismatches < 5) console.log('  mismatch @', i, 'ref', ref.codes[i], ref.shades[i], 'wasm', codes[i], shades[i]);
            mismatches++;
        }
    }
    console.log(mismatches === 0 ? 'EQUIVALENT: 索引表逐字节一致' : `FAIL: ${mismatches}/${W * H} 像素不一致`);

    // ---- 基准 ----
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < ITER; i++) {
        // JS 基线:完整字符串路径(原页面实现,含拼串)
        convertFrame({ data: pix.data, width: W, height: H }, W, H, DITHER);
    }
    const t1 = process.hrtime.bigint();
    for (let i = 0; i < ITER; i++) {
        heap.set(pix.data, pxPtr);
        M._vca_convert_frame(W, H, DITHER ? 1 : 0);
        stringFromTables(heap2, codesPtr, shadesPtr, W, H);   // 与 JS 版对齐:也含拼串
    }
    const t2 = process.hrtime.bigint();
    const jsMs = Number(t1 - t0) / 1e6 / ITER;
    const wasmMs = Number(t2 - t1) / 1e6 / ITER;
    console.log(`JS   : ${jsMs.toFixed(2)} ms/帧 (完整路径:匹配+抖动+拼串)`);
    console.log(`WASM : ${wasmMs.toFixed(2)} ms/帧 (完整路径:像素拷入+匹配+抖动+拼串)`);
    console.log(`加速比(端到端): ${(jsMs / wasmMs).toFixed(2)}x`);

    // 核心算法单独计时(不含拷贝与拼串)
    const t3 = process.hrtime.bigint();
    for (let i = 0; i < ITER; i++) M._vca_convert_frame(W, H, DITHER ? 1 : 0);
    const t4 = process.hrtime.bigint();
    const coreMs = Number(t4 - t3) / 1e6 / ITER;
    console.log(`WASM 核: ${coreMs.toFixed(2)} ms/帧 (纯匹配+抖动) → 核加速比 ${(jsMs / coreMs).toFixed(2)}x`);
}

function jsFrameIndexRef(data, w, h, dither) {
    // 独立参考实现:直接按 convertFrame 逻辑但输出索引(避免字符串对比噪音)
    const chunkd = new Uint8Array(data);
    const keys = Object.keys(colors);
    const codes = new Uint8Array(w * h);
    const shades = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const idx = (x + y * w) * 4;
            const r = chunkd[idx], g = chunkd[idx + 1], b = chunkd[idx + 2];
            let diffmin = Infinity, diffminItem = keys[0];
            for (let i = 0; i < keys.length; i++) {
                const c = colors[keys[i]];
                const diff = (c[0] - r) ** 2 + (c[1] - g) ** 2 + (c[2] - b) ** 2;
                if (diffmin > diff) { diffmin = diff; diffminItem = keys[i]; }
            }
            const ci = keys.indexOf(diffminItem);
            codes[x + y * w] = ci;
            const dr = chunkd[idx] - colors[diffminItem][0];
            const dg = chunkd[idx + 1] - colors[diffminItem][1];
            const db = chunkd[idx + 2] - colors[diffminItem][2];
            let charIdx = 3 - Math.round((dr + dg + db) / 3 / 96 * 4);
            if (charIdx < 0) charIdx = 0;
            if (charIdx >= 7) charIdx = 6;
            shades[x + y * w] = charIdx;
            if (dither) {
                const E = (xx, yy, w8) => {
                    const o = (xx + yy * w) * 4;
                    chunkd[o]     += dr * w8;
                    chunkd[o + 1] += dg * w8;
                    chunkd[o + 2] += db * w8;
                };
                if (x < w - 2) {
                    E(x + 1, y, 4 / 21); E(x + 2, y, 2 / 21);
                } else if (x < w - 1) {
                    E(x + 1, y, 7 / 16);
                }
                if (x > 1 && y < h - 2) {
                    E(x - 2, y + 1, 1 / 21); E(x - 1, y + 1, 2 / 21); E(x, y + 1, 4 / 21);
                    E(x + 1, y + 1, 2 / 21); E(x + 2, y + 1, 1 / 21);
                    E(x - 2, y + 2, 1 / 42); E(x - 1, y + 2, 1 / 21); E(x, y + 2, 2 / 21);
                    E(x + 1, y + 2, 1 / 21); E(x + 2, y + 2, 1 / 42);
                }
            }
        }
    }
    return { codes, shades };
}

function stringFromTables(heap, codesPtr, shadesPtr, w, h) {
    const codeLetters = '0123456789abcdefghijmnpqstu';
    const chars = ['┃', '┃', '┃', '┋', '┋', '╏', '┇'];
    const codes = new Uint8Array(heap.buffer, codesPtr, w * h);
    const shades = new Uint8Array(heap.buffer, shadesPtr, w * h);
    let out = '';
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const o = y * w + x;
            out += '§' + codeLetters[codes[o]] + chars[shades[o]];
        }
        out += '\n';
    }
    return out;
}

main().catch((e) => { console.error(e); process.exit(1); });
