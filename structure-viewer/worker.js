// structure-viewer worker.js — 解析/网格化/几何拷贝全部移出主线程。
// 协议:
//   → {type:'load', name, bytes, lod, reuse, tex, min6?}  (bytes 被 transfer;reuse=1 忽略 bytes;
//     tex=0 走纯色贪心路径,tex=1 走烘焙贴图路径;min6={x1,y1,z1,x2,y2,z2} 走文件名
//     约定裁剪路径,与转换器同规则)
//   ← {type:'ready'}
//   ← {type:'progress', stage}          parse / geometry
//   ← {type:'error', code}              code: -1 解析失败 / -2 超上限 / -3 裁剪框不重叠
//   ← {type:'worker-error', message}
//   ← {type:'geometry', bake:{...} | color:{...}, vc, ic, info6, blocksTotal,
//      blocksNonair, regions, mn, mx}  (typed arrays transfer)
//   → {type:'slice', level}
//   ← {type:'slice', level, vc, ic, pos, col, idx}           (纯色路径,typed arrays)
//   ← {type:'slice', level, bake:true, opaque:{...}, trans:{...}} (贴图路径)
// 贴图路径:wasm 核心内置 bake 表(gen/bake.bin,shulkr 式方块状态→方块面烘焙),
// 每个 (方块,面) 发一个带图集 UV / tile / tint / AO 的四边形;核心在载入/切层后
// 自行完成解交织(UV 映射进图集 rect、tint/AO 换算顶点色、fni 展开轴向法线,
// meta 经 core_bake_meta_load 上传),worker 只按访问器指针拷出 pos/uv/rgb/nrm,
// 主线程拿到"零逐顶点工作"的几何直接包成 BufferAttribute。主线程用两张图集纹理渲染。
// .bdx 由 wasm 核心原生解析(BD@ 头 + brotli + 指令流全部在 C++ 里完成)。
importScripts('./core.js');

// 核心更新后浏览器会拿缓存里的旧 core.js/core.wasm(与结构转换器同坑)——
// 每次重新部署核心时同步递增这里的版本号。
const CORE_V = 'v8';

let Core = null;
let lastBytes = null;   // 上次载入的字节,LOD 切换直接复用,免重复解析
let lastLoadBaked = false; // tryLoad 实际使用的路径(bake 回退可能偏离请求值)

// java 十进制颜色 → 0..1 RGB(tint 表上传给核心前的换算)
const bakeMetaDec = (n) => [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];

// 烘焙表与图集元数据(首次 load 时取一次,之后缓存)
let bakeBin = null;          // Uint8Array(gen/bake.bin)
let bakeMeta = null;         // 解析后的 bake_meta.json
let bakeLoadedOnCore = null; // 当前 Core 实例上 bake 表是否已成功载入(meta 也一并上传)

// 就绪握手:主线程收到后才开放上传
postMessage({ type: 'ready' });

// -------------------------------------------------- wasm 核心
async function ensureCore(){
    if (!Core) Core = await createCore({ locateFile: f => './' + f.split('?')[0] + '?' + CORE_V });
    return Core;
}
// 上一个大文件仍占着 wasm 堆时再载入可能 OOM abort——重建核心后重试一次。
// 重建后 bake 表丢失,需重新 core_bake_load + core_bake_meta_load。
async function loadBake(core){
    if (bakeLoadedOnCore === core && bakeLoadedOnCore) return true;
    if (!bakeBin || !bakeMeta) return false;
    const p = core._malloc(bakeBin.length);
    core.HEAPU8.set(bakeBin, p);
    try { bakeLoadedOnCore = core._core_bake_load(p, bakeBin.length, bakeMeta.solidTiles) ? core : null; }
    finally { core._free(p); }
    if (!bakeLoadedOnCore) return false;
    // 渲染 meta(rects/rectsT/tint 表)也进核心:解交织在核心内做。
    // 注意 bake_meta.json 的 tiles 是 tile 名字数组不是数量,rect 数量取 rects.length
    // (误传数组 → Float32Array(NaN·4) 空 → rect_count=0 → 核心整图集回退 → 花屏)。
    const tileCount = bakeMeta.rects.length, dec = bakeMetaDec;
    // 稀疏数组(JSON null 洞)→ 稠密 tile×4,洞补全图集 (0,0,1,1)
    const mk = (src) => {
        const f = new Float32Array(tileCount * 4);
        for (let t = 0; t < tileCount; ++t){
            const r = src && src[t];
            if (r) { f[t*4] = r[0]; f[t*4+1] = r[1]; f[t*4+2] = r[2]; f[t*4+3] = r[3]; }
            else   { f[t*4] = 0;   f[t*4+1] = 0;   f[t*4+2] = 1;   f[t*4+3] = 1; }
        }
        return f;
    };
    const rects = mk(bakeMeta.rects), rectsT = mk(bakeMeta.rectsT);
    // tint 表:id 0 白 + fixedTints + defaultTints(fixed 优先,与旧 worker 派生一致;
    // 未知 tint id 核心内回退白)
    const tintTable = { 0: [1, 1, 1] };
    for (const [id, n] of Object.entries(bakeMeta.fixedTints || {})) tintTable[id | 0] = dec(n);
    const cls = bakeMeta.defaultTints || {};
    if (cls.grass && tintTable[1] === undefined) tintTable[1] = dec(cls.grass);
    if (cls.foliage && tintTable[2] === undefined) tintTable[2] = dec(cls.foliage);
    if (cls.dryFoliage && tintTable[4] === undefined) tintTable[4] = dec(cls.dryFoliage);
    const tintCount = Math.max(...Object.keys(tintTable).map(Number)) + 1;
    const tints = new Float32Array(tintCount * 3);
    for (let i = 0; i < tintCount; ++i){
        const c = tintTable[i] || [1, 1, 1];
        tints[i*3] = c[0]; tints[i*3+1] = c[1]; tints[i*3+2] = c[2];
    }
    const rp = core._malloc(rects.byteLength), rt = core._malloc(rectsT.byteLength),
          tp = core._malloc(tints.byteLength);
    try {
        new Uint8Array(core.HEAPU8.buffer, rp, rects.byteLength).set(new Uint8Array(rects.buffer));
        new Uint8Array(core.HEAPU8.buffer, rt, rectsT.byteLength).set(new Uint8Array(rectsT.buffer));
        new Uint8Array(core.HEAPU8.buffer, tp, tints.byteLength).set(new Uint8Array(tints.buffer));
        core._core_bake_meta_load(rp, rt, tileCount, tp, tintCount);
    } finally { core._free(rp); core._free(rt); core._free(tp); }
    return true;
}
// 返回实际使用的路径:true = bake 贴图路径,false = 纯色路径。onmessage 据此选
// collectBake / collectGeometry —— tryLoad 内部的回退可能改变路径,不能只看 msg.tex。
async function tryLoad(bytes, lod, useBake, min6){
    const attempt = async (core, withBake) => {
        if (withBake) await loadBake(core);
        const p = core._malloc(bytes.length);
        core.HEAPU8.set(bytes, p);
        try {
            // 文件名约定裁剪(与转换器同规则):min6 在时走 core_load_lod_crop,
            // 裁剪先行 → 只网格化请求范围,大世界载入更快更省内存。
            let rc;
            if (min6){
                const cp = core._malloc(24);
                new Int32Array(core.HEAPU32.buffer, cp, 6).set(min6);
                try { rc = core._core_load_lod_crop(p, bytes.length, lod, cp); }
                finally { core._free(cp); }
            } else {
                rc = core._core_load_lod(p, bytes.length, lod);
            }
            if (rc > 0) lastLoadBaked = withBake && bakeLoadedOnCore === core;
            return rc;
        }
        finally { core._free(p); }
    };
    // 新建一个从未载入 bake 表的干净核心(g_bake_loaded 一旦为真,同一实例上
    // core_load_lod 永远走 bake 路径,退不回纯色)。
    const freshCore = async () => {
        Core = await createCore({ locateFile: f => './' + f.split('?')[0] + '?' + CORE_V });
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
        // 注意:-3(裁剪框不重叠)/-2(超上限)是同步返回码不是异常,不会进这里。
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
// 返回 bake soup:核心已完成解交织(pos/uv/rgb/nrm + u32 索引,UV 已映射进图集
// rect、rgb=tint×AO、法线=面轴向),worker 按访问器指针拷出 wasm 堆成独立
// typed arrays。
function collectBake(core){
    const grab = (vc, ic, posP, uvP, rgbP, nrmP, idxP) => {
        if (vc <= 0 || ic <= 0) return { vc: 0, ic: 0, pos: new Float32Array(0), uv: new Float32Array(0), rgb: new Float32Array(0), nrm: new Float32Array(0), idx: new Uint32Array(0) };
        const F32 = core.HEAPF32, U32 = core.HEAPU32;
        return {
            vc, ic,
            pos: F32.slice(posP >> 2, (posP >> 2) + vc * 3),
            uv:  F32.slice(uvP  >> 2, (uvP  >> 2) + vc * 2),
            rgb: F32.slice(rgbP >> 2, (rgbP >> 2) + vc * 3),
            nrm: F32.slice(nrmP >> 2, (nrmP >> 2) + vc * 3),
            idx: new Uint32Array(U32.buffer.slice(idxP, idxP + ic * 4)),
        };
    };
    return {
        opaque: grab(core._core_bake_opaque_geometry_vertex_count(),
                     core._core_bake_opaque_geometry_index_count(),
                     core._core_bake_opaque_geometry_pos_ptr(),
                     core._core_bake_opaque_geometry_uv_ptr(),
                     core._core_bake_opaque_geometry_rgb_ptr(),
                     core._core_bake_opaque_geometry_nrm_ptr(),
                     core._core_bake_opaque_geometry_idx_ptr()),
        trans:  grab(core._core_bake_trans_geometry_vertex_count(),
                     core._core_bake_trans_geometry_index_count(),
                     core._core_bake_trans_geometry_pos_ptr(),
                     core._core_bake_trans_geometry_uv_ptr(),
                     core._core_bake_trans_geometry_rgb_ptr(),
                     core._core_bake_trans_geometry_nrm_ptr(),
                     core._core_bake_trans_geometry_idx_ptr()),
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
            const rc = await tryLoad(bytes, msg.lod, useBake, msg.min6 || null);
            if (rc === undefined || rc < 0){
                postMessage({ type: 'error', code: rc, seq: msg.seq });
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
            // 分层切片:该核心走过 bake 表 → 贴图平面(核心 core_bake_plan 出
            // 合并 stride-8 soup 后自行分箱/重排/解交织,worker 只拷访问器);
            // 否则纯色 core_slice。
            if (!Core){ postMessage({ type: 'slice', level: msg.level, vc: 0, ic: 0 }); return; }
            if (bakeLoadedOnCore === Core){
                const vc = Core._core_bake_plan(msg.level);
                const empty = () => ({ vc: 0, ic: 0, pos: new Float32Array(0), uv: new Float32Array(0),
                                       rgb: new Float32Array(0), nrm: new Float32Array(0), idx: new Uint32Array(0) });
                if (vc > 0){
                    const grab = (vc, ic, posP, uvP, rgbP, nrmP, idxP) => {
                        if (vc <= 0 || ic <= 0) return empty();
                        const F32 = Core.HEAPF32, U32 = Core.HEAPU32;
                        return {
                            vc, ic,
                            pos: F32.slice(posP >> 2, (posP >> 2) + vc * 3),
                            uv:  F32.slice(uvP  >> 2, (uvP  >> 2) + vc * 2),
                            rgb: F32.slice(rgbP >> 2, (rgbP >> 2) + vc * 3),
                            nrm: F32.slice(nrmP >> 2, (nrmP >> 2) + vc * 3),
                            idx: new Uint32Array(U32.buffer.slice(idxP, idxP + ic * 4)),
                        };
                    };
                    const op = grab(Core._core_bake_plan_opaque_vertex_count(),
                                    Core._core_bake_plan_opaque_index_count(),
                                    Core._core_bake_plan_opaque_pos_ptr(), Core._core_bake_plan_opaque_uv_ptr(),
                                    Core._core_bake_plan_opaque_rgb_ptr(), Core._core_bake_plan_opaque_nrm_ptr(),
                                    Core._core_bake_plan_opaque_idx_ptr());
                    const tr = grab(Core._core_bake_plan_trans_vertex_count(),
                                    Core._core_bake_plan_trans_index_count(),
                                    Core._core_bake_plan_trans_pos_ptr(), Core._core_bake_plan_trans_uv_ptr(),
                                    Core._core_bake_plan_trans_rgb_ptr(), Core._core_bake_plan_trans_nrm_ptr(),
                                    Core._core_bake_plan_trans_idx_ptr());
                    const transfers = [op.pos.buffer, op.uv.buffer, op.rgb.buffer, op.nrm.buffer, op.idx.buffer,
                                       tr.pos.buffer, tr.uv.buffer, tr.rgb.buffer, tr.nrm.buffer, tr.idx.buffer]
                                      .filter(bb => bb && bb.byteLength > 0);
                    postMessage({ type: 'slice', level: msg.level, bake: true,
                                  opaque: op, trans: tr }, transfers);
                    return;
                }
                postMessage({ type: 'slice', level: msg.level, bake: true,
                              opaque: empty(), trans: empty() });
                return;
            }
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
