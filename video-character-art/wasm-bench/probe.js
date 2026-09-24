/**
 * probe.js — 最小化误差扩散探针:2×1 图,FS 应把右侧像素推到不同的调色板项
 * 运行:node probe.js
 */
'use strict';

async function main() {
    const createModule = require('./vca_core.js');
    const M = await createModule();
    console.log('version =', M._vca_version());

    const W = 2, H = 1;
    if (!M._vca_init(W, H)) { console.error('init fail'); process.exit(1); }
    const pxPtr = M._vca_pixels_ptr();
    const codesPtr = M._vca_codes_ptr();
    const shadesPtr = M._vca_shades_ptr();
    const errPtr = M._vca_err_ptr();

    // [240,240,240] 和 [130,130,130]
    const frame = new Uint8Array([
        240, 240, 240, 255,
        130, 130, 130, 255
    ]);
    new Uint8Array(M.HEAPU8.buffer).set(frame, pxPtr);
    M._vca_convert_frame(W, H, 1 /* fs */, 0 /* no serpentine,更直观 */);

    const heap = new Uint8Array(M.HEAPU8.buffer);
    console.log('codes =', heap[codesPtr], heap[codesPtr + 1], '(期望 fs: 15 8;none: 15 7)');
    console.log('shades =', heap[shadesPtr], heap[shadesPtr + 1]);

    // 误差缓冲(3 行 × (W+4) 像素 × 3 通道 float32)
    const errFloats = 3 * (W + 4) * 3;
    const errView = new Float32Array(M.HEAPF32.buffer, errPtr, errFloats);
    console.log('err buffer (转换后,行应已 shift/clear):');
    for (let row = 0; row < 3; row++) {
        const parts = [];
        for (let x = 0; x < W + 4; x++) {
            const base = (row * (W + 4) + x) * 3;
            parts.push(`x${x - 2}=[${errView[base].toFixed(1)},${errView[base + 1].toFixed(1)},${errView[base + 2].toFixed(1)}]`);
        }
        console.log('  row', row, ':', parts.join(' '));
    }

    // none 模式对照
    new Uint8Array(M.HEAPU8.buffer).set(frame, pxPtr);
    M._vca_convert_frame(W, H, 0, 0);
    const heap2 = new Uint8Array(M.HEAPU8.buffer);
    console.log('none codes =', heap2[codesPtr], heap2[codesPtr + 1]);
}
main().catch((e) => { console.error(e); process.exit(1); });
