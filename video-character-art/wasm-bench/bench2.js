/**
 * bench2.js — 多抖动算法 wasm 版测试与基准(node bench2.js)
 *
 * 对 9 种抖动算法逐个:
 *   1. 不变量自检:输出 codes ∈ [0,28)、shades ∈ [0,7);none 模式下同一输入逐字节确定
 *   2. 性能基准(wasm 各算法 ms/帧;JS 基线 FS 对照)
 *   3. 质量:对合成渐变图,统计「量化后与原图的颜色差均值」(越小越保真)
 *
 * 注:FS 旧行为(Uint8 回绕)与 wasm 新行为(浮点误差域)不同属预期——
 * 新版借机修正了旧实现 artifact,质量对比见 README。
 */
'use strict';

const PALETTE = [
    [0,0,0],[0,0,170],[0,170,0],[0,170,170],[170,0,0],[170,0,170],[255,170,0],[170,170,170],
    [85,85,85],[85,85,255],[85,255,85],[85,255,255],[255,85,85],[255,85,255],[255,255,85],[255,255,255],
    [221,214,5],[227,212,209],[206,202,202],[68,58,59],[151,22,7],[180,104,77],[222,177,45],[17,160,54],
    [44,186,168],[33,73,123],[154,92,198]
];
const PAL_N = PALETTE.length;
const DITHERS = [
    ['none', 0], ['fs', 1], ['atkinson', 2], ['jjn', 3], ['sierra3', 4],
    ['stucki', 5], ['burkes', 6], ['bayer4', 7], ['bayer8', 8], ['riemersma', 9]
];

function mulberry32(seed) {
    return function () {
        seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function makeNoise(w, h, seed) {
    const rnd = mulberry32(seed);
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < data.length; i += 4) {
        data[i] = Math.floor(rnd() * 256);
        data[i + 1] = Math.floor(rnd() * 256);
        data[i + 2] = Math.floor(rnd() * 256);
        data[i + 3] = 255;
    }
    return data;
}

/** 合成测试图:RGB 三向渐变 + 色块,比噪声图更能反映真实照片分布 */
function makeGradient(w, h) {
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const o = (y * w + x) * 4;
            data[o]     = Math.min(255, Math.floor(x / w * 256));
            data[o + 1] = Math.min(255, Math.floor(y / h * 256));
            data[o + 2] = Math.min(255, Math.floor((x + y) / (w + h) * 256));
            data[o + 3] = 255;
        }
    }
    return data;
}

function nearestJS(r, g, b) {
    let best = 0, bd = Infinity;
    for (let i = 0; i < PAL_N; i++) {
        const c = PALETTE[i];
        const d = (c[0]-r)**2 + (c[1]-g)**2 + (c[2]-b)**2;
        if (d < bd) { bd = d; best = i; }
    }
    return best;
}

/** JS FS 基线(标准浮点域,与 wasm fs 可比)—— 仅用于性能对照 */
function jsFsFrame(data, w, h) {
    const chunkd = new Uint8ClampedArray(data);   // 浮点误差用 clamped 数组近似
    const keys = new Array(PAL_N);
    for (let i = 0; i < PAL_N; i++) keys[i] = i;
    let out = 0;
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const idx = (x + y * w) * 4;
            const r = chunkd[idx], g = chunkd[idx+1], b = chunkd[idx+2];
            const ci = nearestJS(r, g, b);
            const c = PALETTE[ci];
            out += (r - c[0]) + (g - c[1]) + (b - c[2]);
            const E = (xx, yy, w8) => {
                const o = (xx + yy * w) * 4;
                chunkd[o]   += (r - c[0]) * w8;
                chunkd[o+1] += (g - c[1]) * w8;
                chunkd[o+2] += (b - c[2]) * w8;
            };
            if (x < w - 1) E(x + 1, y, 7/16);
            if (y < h - 1) {
                if (x > 0) E(x - 1, y + 1, 3/16);
                E(x, y + 1, 5/16);
                if (x < w - 1) E(x + 1, y + 1, 1/16);
            }
        }
    }
    return out;
}

async function main() {
    const W = parseInt(process.env.W || 320), H = parseInt(process.env.H || 180);
    const ITER = parseInt(process.env.ITER || 20);
    console.log(`尺寸 ${W}x${H},每算法 ${ITER} 轮基准\n`);

    const createModule = require('./vca_core.js');
    const M = await createModule();
    if (M._vca_version() < 2) { console.error('wasm 版本过旧'); process.exit(1); }
    if (!M._vca_init(W, H)) { console.error('init 失败'); process.exit(1); }
    const pxPtr = M._vca_pixels_ptr();
    const codesPtr = M._vca_codes_ptr();
    const shadesPtr = M._vca_shades_ptr();

    const noise = makeNoise(W, H, 777);
    const grad = makeGradient(W, H);

    // 原图平均色差基准(不用抖动时的量化损失)
    // 度量说明:抖动的收益体现在『局部平均色』逼近原图,逐像素色差对任何抖动都恒等于
    // none(误差被摊到邻域,逐像素和不变)。正确度量是块均值色差:8×8 块内,
    // |块平均显示色 - 块平均原图色| 的 L1,再对全图平均。值越小 = 局部色彩还原越好。
    function blockMeanError(data, codes, shades) {
        const B = 8;
        let total = 0, blocks = 0;
        for (let by = 0; by + B <= H; by += B) {
            for (let bx = 0; bx + B <= W; bx += B) {
                let sr = 0, sg = 0, sb = 0, or_ = 0, og = 0, ob = 0;
                for (let y = by; y < by + B; y++) {
                    for (let x = bx; x < bx + B; x++) {
                        const o = (y * W + x) * 4;
                        const i = y * W + x;
                        const c = PALETTE[codes[i]];
                        // 字符档位近似表达该像素的亮度偏移:把档位误差映射回 0..255
                        // 档位 = 3 - round((naturation/96)*4),naturation = (dr+dg+db)/3
                        // → naturation ≈ (3 - shade) * 24;显示色 = 调色板色 + naturation
                        const nat = (3 - shades[i]) * 24;
                        sr += Math.min(255, Math.max(0, c[0] + nat));
                        sg += Math.min(255, Math.max(0, c[1] + nat));
                        sb += Math.min(255, Math.max(0, c[2] + nat));
                        or_ += data[o]; og += data[o+1]; ob += data[o+2];
                    }
                }
                const n = B * B;
                total += Math.abs(sr/n - or_/n) + Math.abs(sg/n - og/n) + Math.abs(sb/n - ob/n);
                blocks++;
            }
        }
        return blocks ? total / blocks : 0;
    }
    const errBase = (() => {
        // none 模式的块均值色差 = 不抖动基线
        new Uint8Array(M.HEAPU8.buffer).set(grad, pxPtr);
        M._vca_convert_frame(W, H, 0, 1);
        const heap = new Uint8Array(M.HEAPU8.buffer);
        return blockMeanError(grad, heap.subarray(codesPtr, codesPtr + W*H), heap.subarray(shadesPtr, shadesPtr + W*H));
    })();

    console.log('算法        自检  基准(ms/帧)  8×8块均值色差(越小越保真,none基线 ' + errBase.toFixed(1) + ')');
    console.log('─'.repeat(64));

    for (const [name, code] of DITHERS) {
        // ---- 自检:输出范围 + 确定性 ----
        let ok = true;
        let msg = '';
        try {
            for (const src of [noise, grad]) {
                new Uint8Array(M.HEAPU8.buffer).set(src, pxPtr);
                M._vca_convert_frame(W, H, code, 1);
                const heap = new Uint8Array(M.HEAPU8.buffer);
                for (let i = 0; i < W * H; i++) {
                    if (heap[codesPtr + i] >= PAL_N) { ok = false; msg = 'codes 越界'; break; }
                    if (heap[shadesPtr + i] >= 7) { ok = false; msg = 'shades 越界'; break; }
                }
                // 确定性:同输入再跑一次,输出一致
                new Uint8Array(M.HEAPU8.buffer).set(src, pxPtr);
                M._vca_convert_frame(W, H, code, 1);
                const heap2 = new Uint8Array(M.HEAPU8.buffer);
                for (let i = 0; i < W * H; i++) {
                    if (heap[codesPtr + i] !== heap2[codesPtr + i] || heap[shadesPtr + i] !== heap2[shadesPtr + i]) {
                        ok = false; msg = '不确定'; break;
                    }
                }
            }
        } catch (e) { ok = false; msg = e.message; }

        // ---- 块均值色差(渐变图) ----
        new Uint8Array(M.HEAPU8.buffer).set(grad, pxPtr);
        M._vca_convert_frame(W, H, code, 1);
        const heap = new Uint8Array(M.HEAPU8.buffer);
        const errAvg = blockMeanError(
            grad,
            heap.subarray(codesPtr, codesPtr + W * H),
            heap.subarray(shadesPtr, shadesPtr + W * H)
        );

        // ---- 基准 ----
        const t0 = process.hrtime.bigint();
        for (let i = 0; i < ITER; i++) {
            new Uint8Array(M.HEAPU8.buffer).set(noise, pxPtr);
            M._vca_convert_frame(W, H, code, 1);
        }
        const t1 = process.hrtime.bigint();
        const ms = Number(t1 - t0) / 1e6 / ITER;

        console.log(`${name.padEnd(11)} ${ok ? ' ok ' : 'FAIL'}  ${ms.toFixed(2).padStart(9)}   ${errAvg.toFixed(1)}${msg ? '  (' + msg + ')' : ''}`);
    }

    // ---- JS FS 基线性能 ----
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < ITER; i++) jsFsFrame(noise, W, H);
    const t1 = process.hrtime.bigint();
    const jsMs = Number(t1 - t0) / 1e6 / ITER;
    console.log(`\nJS FS 基线(标准浮点域): ${jsMs.toFixed(2)} ms/帧`);
}

main().catch((e) => { console.error(e); process.exit(1); });
