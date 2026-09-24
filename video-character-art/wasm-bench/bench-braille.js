/**
 * bench-braille.js — 盲文转换等价性验证 + 基准(node bench-braille.js)
 *
 * JS 参考实现逐行拷自 braille/index.html convertToBraille。
 * 等价性要求:**所有参数组合(threshold/dither/invert)输出逐字节一致** ——
 * 盲文深度缓冲是 Float32(无 Uint8 回绕 artifact),wasm 与 JS 应完全等价。
 *
 * 基准:JS 完整路径(含 String.fromCharCode 拼串)vs wasm(拷入+核心+拼串)。
 */
'use strict';

const path = require('path');

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

    // ---- 等价性:threshold × dither × invert 全组合 ----
    let combos = 0, fails = 0;
    for (const threshold of [0, 1, 32, 64, 128, 200, 254, 255]) {
        for (const dither of [0, 1]) {
            for (const invert of [0, 1]) {
                combos++;
                const pix = makePixels(W, H, 777 + threshold * 31 + dither * 7 + invert);
                const heap = new Uint8Array(M.HEAPU8.buffer);
                heap.set(pix, pxPtr);
                M._vca_braille_convert(W, H, threshold, dither, invert);
                const heap2 = new Uint8Array(M.HEAPU8.buffer);
                const bitsWasm = heap2.slice(bOutPtr, bOutPtr + (W / 2) * (H / 6));
                const bitsRef = brailleBitsRef(pix, W, H, threshold, dither, invert);
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
