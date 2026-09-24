// bench-braille-algos.js — 盲文各抖动算法核心性能(node bench-braille-algos.js)
'use strict';

async function main() {
    const createModule = require('./vca_core.js');
    const M = await createModule();
    const W = parseInt(process.env.W || 256), H = parseInt(process.env.H || 102);
    M._vca_init(W, H);
    M._vca_braille_init(W, H);
    const pxPtr = M._vca_pixels_ptr();
    const px = new Uint8ClampedArray(W * H * 4);
    let s = 999;
    const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
    for (let i = 0; i < px.length; i++) px[i] = Math.floor(rnd() * 256);
    new Uint8Array(M.HEAPU8.buffer).set(px, pxPtr);
    const names = ['none', 'fs', 'atkinson', 'jjn', 'sierra3', 'stucki', 'burkes', 'bayer4', 'bayer8'];
    console.log(`尺寸 ${W}x${H}(盲文 ${W / 2}x${H / 6}),核心 ms/帧:`);
    for (let d = 0; d <= 8; d++) {
        for (let i = 0; i < 5; i++) M._vca_braille_convert(W, H, 128, d, 0);   // 预热
        const t0 = process.hrtime.bigint();
        for (let i = 0; i < 100; i++) M._vca_braille_convert(W, H, 128, d, 0);
        const ms = Number(process.hrtime.bigint() - t0) / 1e6 / 100;
        console.log(`  ${d} ${names[d].padEnd(9)} ${ms.toFixed(3)}`);
    }
}
main().catch(e => { console.error(e); process.exit(1); });
