// structure-viewer worker.js — 解析/网格化/几何拷贝全部移出主线程。
// 协议:
//   → {type:'load', name, bytes, lod, reuse, tex}  (bytes 被 transfer;reuse=1 忽略 bytes;
//     tex=0 走纯色贪心路径,tex=1 走烘焙贴图路径)
//   ← {type:'ready'}
//   ← {type:'progress', stage}          parse / geometry
//   ← {type:'error', code}              code: -1 解析失败 / -2 超上限
//   ← {type:'worker-error', message}
//   ← {type:'geometry', bake:{...} | color:{...}, vc, ic, info6, blocksTotal,
//      blocksNonair, regions, mn, mx}  (typed arrays transfer)
//   → {type:'slice', level}
//   ← {type:'slice', vc, ic, pos, col, idx}                  (typed arrays transfer)
// 贴图路径:wasm 核心内置 bake 表(gen/bake.bin,shulkr 式方块状态→方块面烘焙),
// 每个 (方块,面) 发一个带图集 UV / tile / tint / AO 的四边形;worker 在解交织时把
// UV 直接映射进图集 rect、把 tint/AO 换算成顶点色(bake_meta 派生 tint 查表)、
// 按核心打包的 fni 展开轴向法线,主线程拿到"零逐顶点工作"的 pos/uv/rgb/nrm,
// 直接包成 BufferAttribute。主线程用两张图集纹理渲染。
// .bdx 由 wasm 核心原生解析(BD@ 头 + brotli + 指令流全部在 C++ 里完成)。
importScripts('./core.js');

let Core = null;
let lastBytes = null;   // 上次载入的字节,LOD 切换直接复用,免重复解析
let lastLoadBaked = false; // tryLoad 实际使用的路径(bake 回退可能偏离请求值)

// 烘焙表与图集元数据(首次 load 时取一次,之后缓存)
let bakeBin = null;          // Uint8Array(gen/bake.bin)
let bakeMeta = null;         // 解析后的 bake_meta.json
let bakeTints = null;        // tint id -> [r,g,b](0..1),由 bake_meta 派生
let bakeLoadedOnCore = null; // 当前 Core 实例上 bake 是否已成功载入

// 就绪握手:主线程收到后才开放上传
postMessage({ type: 'ready' });

// -------------------------------------------------- wasm 核心
async function ensureCore(){
    if (!Core) Core = await createCore({ locateFile: f => './' + f });
    return Core;
}
// 上一个大文件仍占着 wasm 堆时再载入可能 OOM abort——重建核心后重试一次。
// 重建后 bake 表丢失,需重新 core_bake_load。
async function loadBake(core){
    if (bakeLoadedOnCore === core && bakeLoadedOnCore) return true;
    if (!bakeBin || !bakeMeta) return false;
    const p = core._malloc(bakeBin.length);
    core.HEAPU8.set(bakeBin, p);
    try { bakeLoadedOnCore = core._core_bake_load(p, bakeBin.length, bakeMeta.solidTiles) ? core : null; }
    finally { core._free(p); }
    return !!bakeLoadedOnCore;
}
// 返回实际使用的路径:true = bake 贴图路径,false = 纯色路径。onmessage 据此选
// collectBake / collectGeometry —— tryLoad 内部的回退可能改变路径,不能只看 msg.tex。
async function tryLoad(bytes, lod, useBake){
    const attempt = async (core, withBake) => {
        if (withBake) await loadBake(core);
        const p = core._malloc(bytes.length);
        core.HEAPU8.set(bytes, p);
        try {
            const rc = core._core_load_lod(p, bytes.length, lod);
            if (rc > 0) lastLoadBaked = withBake && bakeLoadedOnCore === core;
            return rc;
        }
        finally { core._free(p); }
    };
    // 新建一个从未载入 bake 表的干净核心(g_bake_loaded 一旦为真,同一实例上
    // core_load_lod 永远走 bake 路径,退不回纯色)。
    const freshCore = async () => {
        Core = await createCore({ locateFile: f => './' + f });
        bakeLoadedOnCore = null;
        return Core;
    };
    try {
        const core = await ensureCore();
        // 贴图关但该核心已载过 bake 表 → 换干净核心,否则 load_impl 仍走 bake 路径。
        if (!useBake && bakeLoadedOnCore === core){
            await freshCore();
            return await attempt(Core, false);
        }
        return await attempt(core, useBake);
    } catch (e){
        // 上一次载入残留占满 wasm 堆 → 重建核心再试一次;重建后 bake 表丢失需重载。
        try {
            await freshCore();
            return await attempt(Core, useBake);
        } catch (e2){
            // bake soup(stride-8 float)比纯色贪心 soup 占内存高得多,满细节 LOD
            // 下可能 OOM。退纯色路径(几何小一个量级)再试,贴图会缺但不至于失败。
            if (useBake){
                useBake = false;
                try {
                    // Core 上 bake 表还在 → 仍会走 bake 路径,必须换干净核心。
                    await freshCore();
                    return await attempt(Core, false);
                } catch (e3){
                    await freshCore();
                    return await attempt(Core, false);
                }
            }
            throw e2;
        }
    }
}
// 返回 bake soup:解交织后 [x,y,z,u,v,r,g,b](UV 已映射进图集 rect,颜色=AO×tint,
// 法线=四边形面法线,由核心打包进 tile 的 fni 高位解出),拷贝出 wasm 堆成独立
// typed arrays。
function collectBake(core){
    const F32 = core.HEAPF32, U32 = core.HEAPU32;
    const ovc = core._core_bake_opaque_vertex_count(),
          oic = core._core_bake_opaque_index_count();
    const tvc = core._core_bake_trans_vertex_count(),
          tic = core._core_bake_trans_index_count();
    const solidTiles = bakeMeta ? bakeMeta.solidTiles : 0;
    const rects = bakeMeta ? bakeMeta.rects : [], rectsT = bakeMeta ? bakeMeta.rectsT : [];
    const tints = bakeTints || { 0: [1, 1, 1] };
    // ZEA 面法线(与 bake_mesh.cpp kFaceTuple 的 normalAxis/sign 对应);
    // ZEA: 0=down(0,-1,0) 1=up(0,1,0) 2=north(0,0,-1) 3=south(0,0,1)
    //      4=west(-1,0,0) 5=east(1,0,0)。倾斜面(元素旋转/楼梯等)仍按其主
    // fni 取轴向法线:四边形共面,棱线略硬但与 computeVertexNormals 的
    // 面内插值差异在正常光照下不可辨。
    const NRM = [[0,-1,0],[0,1,0],[0,0,-1],[0,0,1],[-1,0,0],[1,0,0]];
    const soup = (vc, ic, dataP, idxP) => {
        if (vc <= 0 || ic <= 0) return { vc: 0, ic: 0, pos: new Float32Array(0), uv: new Float32Array(0), rgb: new Float32Array(0), nrm: new Float32Array(0), idx: new Uint32Array(0) };
        // 顶点属性解交织 + UV/tint 预变换:pos(3) / uv(2) / rgb(3) / nrm(3)
        const pos = new Float32Array(vc * 3), uv = new Float32Array(vc * 2),
              rgb = new Float32Array(vc * 3), nrm = new Float32Array(vc * 3);
        const raw = F32.subarray(dataP >> 2, (dataP >> 2) + vc * 8);
        for (let q = 0; q < vc; q += 4){
            // 每 4 顶点一个四边形:tile/tint 在四边形内恒定;面法线按 fni 取轴向。
            // 核心把 fni 打包进 tile 字段的高 3 位(低 13 位是 tile id,最大
            // 1085 远小于 8192,安全)。
            const s0 = q * 8;
            const packed = raw[s0 + 5];
            const tile = packed & 8191;
            const fni = (packed / 8192) | 0;
            const n = NRM[fni] || NRM[1];
            const tintId = raw[s0 + 6] | 0, ao0 = raw[s0 + 7], ao1 = raw[s0 + 15],
                  ao2 = raw[s0 + 23], ao3 = raw[s0 + 31];
            const isT = tile > solidTiles;
            const r = (isT ? rectsT : rects)[tile] || [0, 0, 1, 1];
            const tc = tints[tintId] || tints[0];
            for (let i = 0; i < 4; ++i){
                const s = (q + i) * 8, d3 = (q + i) * 3;
                pos[d3] = raw[s]; pos[d3+1] = raw[s+1]; pos[d3+2] = raw[s+2];
                uv[d3]   = r[0] + raw[s+3] * r[2];
                uv[d3+1] = r[1] + raw[s+4] * r[3];
                const ao = i === 0 ? ao0 : i === 1 ? ao1 : i === 2 ? ao2 : ao3;
                rgb[d3] = tc[0] * ao; rgb[d3+1] = tc[1] * ao; rgb[d3+2] = tc[2] * ao;
                nrm[d3] = n[0]; nrm[d3+1] = n[1]; nrm[d3+2] = n[2];
            }
        }
        const idx = new Uint32Array(U32.buffer.slice(idxP, idxP + ic * 4));
        return { vc, ic, pos, uv, rgb, nrm, idx };
    };
    return {
        opaque: soup(ovc, oic, core._core_bake_opaque_data_ptr(), core._core_bake_opaque_idx_ptr()),
        trans:  soup(tvc, tic, core._core_bake_trans_data_ptr(), core._core_bake_trans_idx_ptr()),
    };
}
// 旧纯色路径(贴图关):贪心 (mid,face) 分组 soup + 调色板,协议保持兼容。
function collectGeometry(core){
    const vc = core._core_vertex_count(), ic = core._core_index_count();
    const F32 = core.HEAPF32, U32 = core.HEAPU32;
    const posP = core._core_positions_ptr(), uvP = core._core_uvs_ptr(),
          idxP = core._core_indices_ptr(), rgbP = core._core_palette_rgb_ptr();
    const gc = core._core_group_count();
    const groups = new Int32Array(gc * 6);
    const gi = core._malloc(24);
    const giArr = new Int32Array(core.HEAPU32.buffer, gi, 6);
    for (let i = 0; i < gc; i++){
        core._core_group_info(i, gi);
        for (let k = 0; k < 6; k++) groups[i*6+k] = giArr[k];
    }
    core._free(gi);
    const pos = F32.slice(posP>>2, (posP>>2) + vc*3);
    const uv  = F32.slice(uvP>>2, (uvP>>2) + vc*2);
    const idx = new Uint32Array(U32.buffer.slice(idxP, idxP + ic*4));
    const pal = core._core_palette_size();
    const palRgb = F32.slice(rgbP>>2, (rgbP>>2) + pal*3);
    const keys = new Map();   // key = mid*16+face -> {m, face, icount}
    for (let i = 0; i < groups.length; i += 6){
        const icount = groups[i+5];
        if (icount <= 0) continue;
        const key = groups[i] * 16 + groups[i+1];
        let g = keys.get(key);
        if (!g) keys.set(key, g = { m: groups[i], face: groups[i+1], icount: 0 });
        g.icount += icount;
    }
    const merged = new Map();
    for (const [key, g] of keys) merged.set(key, { g, ix: new Uint32Array(g.icount), off: 0 });
    for (let i = 0; i < groups.length; i += 6){
        const icount = groups[i+5];
        if (icount <= 0) continue;
        const e = merged.get(groups[i] * 16 + groups[i+1]);
        e.ix.set(idx.subarray(groups[i+4], groups[i+4] + icount), e.off);
        e.off += icount;
    }
    const names = [];
    const keyPtr = core._malloc(256);
    const keyBuf = new Uint8Array(core.HEAPU8.buffer, keyPtr, 256);
    for (let i = 0; i < pal; i++){
        keyBuf.fill(0);
        core._core_palette_key(i, keyPtr, 256);
        let nm = '';
        for (let j = 0; j < 256 && keyBuf[j]; j++) nm += String.fromCharCode(keyBuf[j]);
        names.push(nm);
    }
    core._free(keyPtr);
    return { vc, ic, pos, uv, palRgb, pal, names, merged };
}
// 通用信息(两种路径共用)
function collectInfo(core){
    const info = core._malloc(24);
    core._core_region_info(info);
    const info6 = new Int32Array(core.HEAPU32.buffer, info, 6).slice();
    core._free(info);
    const bb = core._malloc(24);
    core._core_bbox(bb);
    const bbox6 = new Float32Array(core.HEAPF32.buffer, bb, 6).slice();
    core._free(bb);
    return { info6, mn: [bbox6[0], bbox6[1], bbox6[2]], mx: [bbox6[3], bbox6[4], bbox6[5]],
             blocksTotal: core._core_blocks_total(), blocksNonair: core._core_blocks_nonair(),
             regions: core._core_region_count(), paletteSize: core._core_palette_size() };
}
async function fetchBake(){
    if (!bakeBin){
        const [bin, meta] = await Promise.all([
            fetch('./gen/bake.bin').then(r => { if (!r.ok) throw new Error('bake.bin HTTP ' + r.status); return r.arrayBuffer(); }),
            fetch('./gen/bake_meta.json').then(r => { if (!r.ok) throw new Error('bake_meta HTTP ' + r.status); return r.json(); }),
        ]);
        bakeBin = new Uint8Array(bin);
        bakeMeta = meta;
        // tint 查表从 bake_meta 派生(0..8 与图元 tint id 对应;java 十进制色 → 0..1 RGB)
        const dec = (n) => [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
        bakeTints = { 0: [1, 1, 1] };
        for (const [id, n] of Object.entries(bakeMeta.fixedTints || {})) bakeTints[id | 0] = dec(n);
        const cls = bakeMeta.defaultTints || {};
        if (cls.grass) bakeTints[1] = dec(cls.grass);
        if (cls.foliage) bakeTints[2] = dec(cls.foliage);
        if (cls.dryFoliage) bakeTints[4] = dec(cls.dryFoliage);
        // 3(水)/5(作物茎)在 fixedTints;6/7/8 也在 fixedTints(云杉/白桦/睡莲)。
        // defaultTints 同名条目不覆盖 fixedTints(fixed 优先)。
    }
}

self.onmessage = async (ev) => {
    const msg = ev.data;
    try {
        if (msg.type === 'load'){
            postMessage({ type: 'progress', stage: 'parse' });
            let useBake = !!msg.tex;
            if (useBake){
                try { await fetchBake(); } catch (e){ useBake = false; }   // gen 缺失时静默回退纯色
            }
            const bytes = msg.reuse ? lastBytes : msg.bytes;
            lastBytes = bytes;
            const rc = await tryLoad(bytes, msg.lod, useBake);
            if (rc === undefined || rc === -1 || rc === -2){
                postMessage({ type: 'error', code: rc === -2 ? -2 : -1, seq: msg.seq });
                return;
            }
            postMessage({ type: 'progress', stage: 'geometry' });
            const info = collectInfo(Core);
            if (lastLoadBaked){
                const b = collectBake(Core);
                const vc = b.opaque.vc + b.trans.vc, ic = b.opaque.ic + b.trans.ic;
                const transfers = [b.opaque.pos.buffer, b.opaque.uv.buffer, b.opaque.rgb.buffer, b.opaque.nrm.buffer, b.opaque.idx.buffer,
                                   b.trans.pos.buffer, b.trans.uv.buffer, b.trans.rgb.buffer, b.trans.nrm.buffer, b.trans.idx.buffer]
                                  .filter(bb => bb && bb.byteLength > 0);
                postMessage({ type: 'geometry', seq: msg.seq, bake: true, vc, ic,
                              opaque: { vc: b.opaque.vc, ic: b.opaque.ic, pos: b.opaque.pos,
                                        uv: b.opaque.uv, rgb: b.opaque.rgb, nrm: b.opaque.nrm, idx: b.opaque.idx },
                              trans:  { vc: b.trans.vc, ic: b.trans.ic, pos: b.trans.pos,
                                        uv: b.trans.uv, rgb: b.trans.rgb, nrm: b.trans.nrm, idx: b.trans.idx },
                              meta: { solidTiles: bakeMeta.solidTiles,
                                      atlas: bakeMeta.atlas, atlasT: bakeMeta.atlas_t },
                              ...info },
                            transfers);
            } else {
                const g = collectGeometry(Core);
                const transfers = [g.pos.buffer, g.uv.buffer, g.palRgb.buffer];
                const mergedArr = [];
                for (const [, e] of g.merged){ mergedArr.push([e.g.m, e.g.face, e.ix]); transfers.push(e.ix.buffer); }
                postMessage({ type: 'geometry', seq: msg.seq, bake: false, vc: g.vc, ic: g.ic,
                              pos: g.pos, uv: g.uv, palRgb: g.palRgb, pal: g.pal, names: g.names,
                              merged: mergedArr, ...info }, transfers);
            }
        } else if (msg.type === 'slice'){
            if (!Core){ postMessage({ type: 'slice', level: msg.level, vc: 0, ic: 0 }); return; }
            const vc = Core._core_slice(msg.level);
            const F32 = Core.HEAPF32, U32 = Core.HEAPU32;
            const ic = Core._core_slice_index_count();
            const pp = Core._core_slice_pos_ptr(), cp = Core._core_slice_col_ptr(), ip = Core._core_slice_idx_ptr();
            const pos = new Float32Array(F32.buffer.slice(pp, pp + vc*3*4));
            const col = new Float32Array(F32.buffer.slice(cp, cp + vc*3*4));
            const idx = new Uint32Array(U32.buffer.slice(ip, ip + ic*4));
            postMessage({ type: 'slice', level: msg.level, vc, ic, pos, col, idx }, [pos.buffer, col.buffer, idx.buffer]);
        }
    } catch (e){
        postMessage({ type: 'worker-error', message: (e && e.message) ? e.message : String(e) });
    }
};
