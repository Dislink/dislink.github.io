/**
 * bench-braille.js — 盲文转换等价性验证 + 基准(node bench-braille.js)
 *
 * JS 参考实现逐行拷自 braille/index.html convertToBraille(FS 版)。
 * 等价性要求:**所有参数组合(threshold/dither/invert)输出逐字节一致** ——
 * 盲文深度缓冲是 Float32(无 Uint8 回绕 artifact),wasm 与 JS 应完全等价。
 *
 * v3 多抖动:JS 参考实现按 C 同构实现单通道核(fs/atkinson/jjn/sierra3/stucki/
 * burkes/bayer4/bayer8;盲文无调色板,Riemersma 不适用),wasm 与 JS 逐字节对比。
 *
 * 基准:JS 完整路径(含 String.fromCharCode 拼串)vs wasm(拷入+核心+拼串)。
 */
'use strict';

const path = require('path');

// ---------- 误差扩散核(与 vca_core.c K_* 表一致) ----------
const KERNELS = {
    1: [[1, 0, 7 / 16], [-1, 1, 3 / 16], [0, 1, 5 / 16], [1, 1, 1 / 16]],
    2: [[1, 0, 1 / 8], [2, 0, 1 / 8], [-1, 1, 1 / 8], [0, 1, 1 / 8], [1, 1, 1 / 8], [0, 2, 1 / 8]],
    3: [[1, 0, 7 / 48], [2, 0, 5 / 48],
        [-2, 1, 3 / 48], [-1, 1, 5 / 48], [0, 1, 7 / 48], [1, 1, 5 / 48], [2, 1, 3 / 48],
        [-2, 2, 1 / 48], [-1, 2, 3 / 48], [0, 2, 5 / 48], [1, 2, 3 / 48], [2, 2, 1 / 48]],
    4: [[1, 0, 5 / 32], [2, 0, 3 / 32],
        [-2, 1, 2 / 32], [-1, 1, 4 / 32], [0, 1, 5 / 32], [1, 1, 4 / 32], [2, 1, 2 / 32],
        [-1, 2, 2 / 32], [0, 2, 3 / 32], [1, 2, 2 / 32]],
    5: [[1, 0, 8 / 42], [2, 0, 4 / 42],
        [-2, 1, 2 / 42], [-1, 1, 4 / 42], [0, 1, 8 / 42], [1, 1, 4 / 42], [2, 1, 2 / 42],
        [-2, 2, 1 / 42], [-1, 2, 2 / 42], [0, 2, 4 / 42], [1, 2, 2 / 42], [2, 2, 1 / 42]],
    6: [[1, 0, 8 / 32], [2, 0, 4 / 32],
        [-2, 1, 2 / 32], [-1, 1, 4 / 32], [0, 1, 8 / 32], [1, 1, 4 / 32], [2, 1, 2 / 32]]
};
const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const BAYER8 = [
    0, 32, 8, 40, 2, 34, 10, 42, 48, 16, 56, 24, 50, 18, 58, 26,
    12, 44, 4, 36, 14, 46, 6, 38, 60, 28, 52, 20, 62, 30, 54, 22,
    3, 35, 11, 43, 1, 33, 9, 41, 51, 19, 59, 27, 49, 17, 57, 25,
    15, 47, 7, 39, 13, 45, 5, 37, 63, 31, 55, 23, 61, 29, 53, 21
];

function brailleBitPos(i, j) { return i === 0 ? (j < 3 ? j : 6) : (j < 3 ? 3 + j : 7); }

/** JS 多抖动参考(与 C vca_braille_convert 同构;bits 输出) */
function brailleBitsMulti(data, w, h, threshold, dither, invert) {
    const depth = new Float32Array(w * h);
    const bits = new Uint8Array((w / 2) * (h / 6));
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const idx = (x + y * w) * 4;
            depth[x + y * w] = (data[idx] + data[idx + 1] + data[idx + 2]) * (data[idx + 3] / 255) / 3;
        }
    }
    if (dither === 7 || dither === 8) {
        const m = dither === 7 ? 4 : 8;
        const mat = m === 4 ? BAYER4 : BAYER8;
        const amp = 255 / 8;
        for (let cy = 0; cy < h / 6; cy++) {
            for (let cx = 0; cx < w / 2; cx++) {
                let b = 0;
                for (let i = 0; i < 2; i++) for (let j = 0; j < 4; j++) {
                    const px = cx * 2 + i, py = cy * 6 + j;
                    const off = (mat[(py & (m - 1)) * m + (px & (m - 1))] / (m * m) - 0.5) * amp;
                    let val = depth[px + py * w] + off;
                    if (invert) val = 255 - val;
                    if (val > threshold) b |= 1 << brailleBitPos(i, j);
                }
                bits[cy * (w / 2) + cx] = b;
            }
        }
        return bits;
    }
    const kern = KERNELS[dither] || null;   // null/undefined → 纯阈值
    for (let cy = 0; cy < h / 6; cy++) {
        for (let cx = 0; cx < w / 2; cx++) {
            let b = 0;
            for (let i = 0; i < 2; i++) {
                for (let j = 0; j < 4; j++) {
                    const px = cx * 2 + i, py = cy * 6 + j;
                    let val = depth[px + py * w];
                    if (invert) val = 255 - val;
                    const bit = val > threshold ? 1 : 0;
                    b |= bit << brailleBitPos(i, j);
                    if (kern && px < w - 1 && py < h - 1) {
                        const error = val - (bit ? 255 : 0);
                        for (const [dx, dy, w8] of kern) {
                            const nx = px + dx, ny = py + dy;
                            if (nx < 0 || nx >= w || ny >= h) continue;
                            depth[nx + ny * w] += error * w8;
                        }
                    }
                }
            }
            bits[cy * (w / 2) + cx] = b;
        }
    }
    return bits;
}

// ---------- JS 参考实现(逐行拷自 braille/index.html convertToBraille) ----------
function convertToBraille(imgData, w, h, threshold, enableDither, invertColors) {
    var data = new Uint8Array(imgData.data);
    var depth = new Float32Array(w * h);
    var asciiStr = '';

    for (var y = 0; y < h; y++) {
        for (var x = 0; x < w; x++) {
            var idx = (x + y * w) * 4;
            var r = data[idx];
            var g = data[idx + 1];
            var b = data[idx + 2];
            var a = data[idx + 3];
            depth[x + y * w] = (r + g + b) * (a / 255) / 3;
        }
    }

    for (var y = 0; y < h / 6; y++) {
        for (var x = 0; x < w / 2; x++) {
            var aBits = [[], []];
            for (var i = 0; i < 2; i++) {
                for (var j = 0; j < 4; j++) {
                    var px = x * 2 + i;
                    var py = y * 6 + j;
                    var dIdx = px + py * w;
                    var val = depth[dIdx];
                    if (invertColors) val = 255 - val;
                    var bit = val > threshold ? 1 : 0;
                    aBits[i][j] = bit;

                    if (enableDither && px < w - 1 && py < h - 1) {
                        var error = val - (bit ? 255 : 0);
                        if (px + 1 < w) depth[px + 1 + py * w] += error * 7 / 16;
                        if (px > 0 && py + 1 < h) depth[px - 1 + (py + 1) * w] += error * 3 / 16;
                        if (py + 1 < h) depth[px + (py + 1) * w] += error * 5 / 16;
                        if (px + 1 < w && py + 1 < h) depth[px + 1 + (py + 1) * w] += error * 1 / 16;
                    }
                }
            }
            var code = 0x2800
                + (aBits[0][0] << 0) + (aBits[0][1] << 1) + (aBits[0][2] << 2)
                + (aBits[1][0] << 3) + (aBits[1][1] << 4) + (aBits[1][2] << 5)
                + (aBits[0][3] << 6) + (aBits[1][3] << 7);
            asciiStr += String.fromCharCode(code);
        }
        asciiStr += '\n';
    }
    return asciiStr;
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
    // 半透明像素混入,覆盖 alpha 权重路径;a 取 3 档(0/128/255)
    const rnd = mulberry32(seed);
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < data.length; i += 4) {
        data[i] = Math.floor(rnd() * 256);
        data[i + 1] = Math.floor(rnd() * 256);
        data[i + 2] = Math.floor(rnd() * 256);
        data[i + 3] = [0, 128, 255][Math.floor(rnd() * 3)];
    }
    return data;
}

/** JS bits 参考版:同 convertToBraille 但输出每 cell 字节(与 wasm 对比用) */
function brailleBitsRef(data, w, h, threshold, dither, invert) {
    const depth = new Float32Array(w * h);
    const bits = new Uint8Array((w / 2) * (h / 6));
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const idx = (x + y * w) * 4;
            depth[x + y * w] = (data[idx] + data[idx + 1] + data[idx + 2]) * (data[idx + 3] / 255) / 3;
        }
    }
    for (let cy = 0; cy < h / 6; cy++) {
        for (let cx = 0; cx < w / 2; cx++) {
            const aBits = [[0, 0, 0, 0], [0, 0, 0, 0]];
            for (let i = 0; i < 2; i++) {
                for (let j = 0; j < 4; j++) {
                    const px = cx * 2 + i, py = cy * 6 + j;
                    let val = depth[px + py * w];
                    if (invert) val = 255 - val;
                    const bit = val > threshold ? 1 : 0;
                    aBits[i][j] = bit;
                    if (dither && px < w - 1 && py < h - 1) {
                        const error = val - (bit ? 255 : 0);
                        if (px + 1 < w) depth[px + 1 + py * w] += error * 7 / 16;
                        if (px > 0 && py + 1 < h) depth[px - 1 + (py + 1) * w] += error * 3 / 16;
                        if (py + 1 < h) depth[px + (py + 1) * w] += error * 5 / 16;
                        if (px + 1 < w && py + 1 < h) depth[px + 1 + (py + 1) * w] += error * 1 / 16;
                    }
                }
            }
            bits[cy * (w / 2) + cx] = (aBits[0][0] << 0) + (aBits[0][1] << 1) + (aBits[0][2] << 2)
                + (aBits[1][0] << 3) + (aBits[1][1] << 4) + (aBits[1][2] << 5)
                + (aBits[0][3] << 6) + (aBits[1][3] << 7);
        }
    }
    return bits;
}

/** 从 bits 表拼盲文串(与 JS 版输出完全一致的最终形态) */
function brailleStringFromBits(bitsTable, cols, rows) {
    let out = '';
    for (let y = 0; y < rows; y++) {
        const base = y * cols;
        for (let x = 0; x < cols; x++) {
            out += String.fromCharCode(0x2800 + bitsTable[base + x]);
        }
        out += '\n';
    }
    return out;
}

async function main() {
    const W = parseInt(process.env.W || 256), H = parseInt(process.env.H || 102);
    const ITER = 50;

    console.log(`尺寸 ${W}x${H}(盲文 ${W / 2}x${H / 6} 字符),每版 ${ITER} 轮`);

    const M = await loadWasm();
    const bInit = M._vca_braille_init(W, H);
    if (!bInit) { console.error('vca_braille_init 失败'); process.exit(1); }
    const vInit = M._vca_init(W, H);
    if (!vInit) { console.error('vca_init 失败'); process.exit(1); }
    const pxPtr = M._vca_pixels_ptr();
    const bOutPtr = M._vca_braille_out_ptr();

    // ---- 等价性:threshold × dither(全算法) × invert 全组合 ----
    let combos = 0, fails = 0;
    for (const threshold of [0, 1, 32, 64, 128, 200, 254, 255]) {
        for (const dither of [0, 1, 2, 3, 4, 5, 6, 7, 8]) {
            for (const invert of [0, 1]) {
                combos++;
                const pix = makePixels(W, H, 777 + threshold * 31 + dither * 7 + invert);
                const heap = new Uint8Array(M.HEAPU8.buffer);
                heap.set(pix, pxPtr);
                M._vca_braille_convert(W, H, threshold, dither, invert);
                const heap2 = new Uint8Array(M.HEAPU8.buffer);
                const bitsWasm = heap2.slice(bOutPtr, bOutPtr + (W / 2) * (H / 6));
                const bitsRef = brailleBitsMulti(pix, W, H, threshold, dither, invert);
                let mm = 0;
                for (let i = 0; i < bitsWasm.length; i++) {
                    if (bitsWasm[i] !== bitsRef[i]) {
                        if (mm < 3) console.log(`  mismatch th=${threshold} d=${dither} inv=${invert} @cell ${i}: js=${bitsRef[i]} wasm=${bitsWasm[i]}`);
                        mm++;
                    }
                }
                if (mm > 0) { fails++; console.log(`  FAIL th=${threshold} dither=${dither} invert=${invert}: ${mm} cells 不一致`); }
            }
        }
    }
    console.log(fails === 0
        ? `EQUIVALENT: ${combos} 组参数全部逐字节一致(bits 表)`
        : `FAIL: ${fails}/${combos} 组参数不一致`);
    if (fails > 0) process.exit(1);

    // 字符串级复核(一轮):JS 版整串 vs wasm bits 拼串
    {
        const pix = makePixels(W, H, 4242);
        const jsStr = convertToBraille({ data: pix, width: W, height: H }, W, H, 128, true, false);
        const heap = new Uint8Array(M.HEAPU8.buffer);
        heap.set(pix, pxPtr);
        M._vca_braille_convert(W, H, 128, 1, 0);
        const heap2 = new Uint8Array(M.HEAPU8.buffer);
        const bits = heap2.slice(bOutPtr, bOutPtr + (W / 2) * (H / 6));
        const wasmStr = brailleStringFromBits(bits, W / 2, H / 6);
        console.log(wasmStr === jsStr
            ? 'EQUIVALENT: 最终盲文字符串逐字符一致'
            : 'FAIL: 字符串不一致!');
        if (wasmStr !== jsStr) process.exit(1);
    }

    // ---- 基准 ----
    const pix = makePixels(W, H, 999);
    const heap = new Uint8Array(M.HEAPU8.buffer);
    const heap2 = new Uint8Array(M.HEAPU8.buffer);

    const t0 = process.hrtime.bigint();
    for (let i = 0; i < ITER; i++) {
        convertToBraille({ data: pix, width: W, height: H }, W, H, 128, true, false);
    }
    const t1 = process.hrtime.bigint();
    for (let i = 0; i < ITER; i++) {
        heap.set(pix, pxPtr);
        M._vca_braille_convert(W, H, 128, 1, 0);
        brailleStringFromBits(new Uint8Array(heap2.buffer, bOutPtr, (W / 2) * (H / 6)), W / 2, H / 6);
    }
    const t2 = process.hrtime.bigint();
    const jsMs = Number(t1 - t0) / 1e6 / ITER;
    const wasmMs = Number(t2 - t1) / 1e6 / ITER;
    console.log(`JS   : ${jsMs.toFixed(2)} ms/帧 (完整路径:深度+抖动+组码+拼串)`);
    console.log(`WASM : ${wasmMs.toFixed(2)} ms/帧 (完整路径:像素拷入+深度+抖动+组码+拼串)`);
    console.log(`加速比(端到端): ${(jsMs / wasmMs).toFixed(2)}x`);

    const t3 = process.hrtime.bigint();
    for (let i = 0; i < ITER; i++) M._vca_braille_convert(W, H, 128, 1, 0);
    const t4 = process.hrtime.bigint();
    const coreMs = Number(t4 - t3) / 1e6 / ITER;
    console.log(`WASM 核: ${coreMs.toFixed(2)} ms/帧 (纯深度+抖动+组码) → 核加速比 ${(jsMs / coreMs).toFixed(2)}x`);

    // 无抖动基准
    const t5 = process.hrtime.bigint();
    for (let i = 0; i < ITER; i++) convertToBraille({ data: pix, width: W, height: H }, W, H, 128, false, false);
    const t6 = process.hrtime.bigint();
    for (let i = 0; i < ITER; i++) {
        heap.set(pix, pxPtr);
        M._vca_braille_convert(W, H, 128, 0, 0);
    }
    const t6b = process.hrtime.bigint();
    const jsNone = Number(t6 - t5) / 1e6 / ITER;
    const wasmNone = Number(t6b - t6) / 1e6 / ITER;
    console.log(`无抖动: JS ${jsMs.toFixed(2)} → ${jsNone.toFixed(2)} ms/帧 | wasm ${wasmMs.toFixed(2)} → ${wasmNone.toFixed(2)} ms/帧 (端到端 ${(jsNone / wasmNone).toFixed(2)}x)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
