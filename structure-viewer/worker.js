// structure-viewer worker.js — 把解析/网格化/几何拷贝全部移出主线程。
// 协议:
//   → {type:'load', name, bytes, lod, reuse}  (bytes 被 transfer;reuse=1 时忽略 bytes 复用上次转换结果)
//   ← {type:'ready'}
//   ← {type:'progress', stage}          bridge / parse / geometry
//   ← {type:'error', code}              code: -1 解析失败 / -2 超上限
//   ← {type:'worker-error', message}
//   ← {type:'geometry', vc, ic, groups, pos, uv, idx, palRgb, pal, names,
//      info6, blocksTotal, blocksNonair, regions, mn, mx}  (typed arrays transfer)
//   → {type:'slice', level}
//   ← {type:'slice', vc, ic, pos, col, idx}                  (typed arrays transfer)
// 部分 classic 脚本(如 brotli/bdx)在顶层引用 window——worker 环境没有 window,
// 先垫一层再 importScripts。
self.window = self;

importScripts('./core.js', '/javascript/Brotli.decompress.js', '/javascript/brotli.min.js',
              './bdx.js', '/javascript/matrix.js', '/javascript/nbt.js');

let Core = null;
let lastBytes = null;   // 上次载入的字节(转换后),LOD 切换直接复用,免重复 BDX 桥接

// 就绪握手:主线程收到后才开放上传
postMessage({ type: 'ready' });

// -------------------------------------------------- BDX → mcstructure NBT
function matrixToMcstructureNBT(matrix){
    const X = matrix.Xmax, Y = matrix.Ymax, Z = matrix.Zmax;
    const total = X * Y * Z;
    const palette = matrix.palette.map((key) => {
        // palette 键形如 "minecraft:name[state=val,...]@ver" 或 "minecraft:name"
        const m = key.match(/^(?:([a-zA-Z0-9_]*):)?([A-Za-z0-9_]+)(\[.+\])?@?(\d+)?$/);
        if (!m) return { name: { type: 'string', value: key }, states: { type: 'compound', value: {} } };
        const ns = m[1] || 'minecraft';
        let states = { type: 'compound', value: {} };
        if (m[3]) {
            const inner = m[3].slice(1, -1);
            if (inner.trim()) {
                for (const kv of inner.split(',')) {
                    const e = kv.indexOf('=');
                    if (e < 0) continue;
                    const k2 = kv.slice(0, e), v2 = kv.slice(e + 1);
                    let tag, val;
                    if (v2 === 'true' || v2 === 'false') { tag = 'byte'; val = v2 === 'true' ? 1 : 0; }
                    else if (/^-?\d+$/.test(v2)) { tag = 'int'; val = parseInt(v2, 10); }
                    else { tag = 'string'; val = v2.replace(/^"|"$/g, ''); }
                    states.value[k2] = { type: tag, value: val };
                }
            }
        }
        return { name: { type: 'string', value: ns + ':' + m[2] }, states };
    });
    // mcstructure 索引顺序为 y*Z*X + z*X + x(遍历序:x→z→y 每层递增)
    const indices = new Array(total).fill(-1);
    for (const it of matrix.getAllBlocks()){
        const x = it.x, y = it.y, z = it.z;
        if (x < 0 || y < 0 || z < 0 || x >= X || y >= Y || z >= Z) continue;
        indices[y * Z * X + z * X + x] = it.block.Index;
    }
    return {
        name: '',
        value: {
            format_version: { type: 'int', value: 1 },
            size: { type: 'list', value: { type: 'int', value: [X, Y, Z] } },
            structure: {
                type: 'compound',
                value: {
                    block_indices: { type: 'list', value: { type: 'list', value: [
                        { type: 'int', value: indices },
                        { type: 'int', value: new Array(total).fill(-1) }
                    ] } },
                    entities: { type: 'list', value: { type: 'end', value: [] } },
                    palette: { type: 'compound', value: { default: { type: 'compound', value: {
                        block_palette: { type: 'list', value: { type: 'compound', value: palette } },
                        block_position_data: { type: 'compound', value: {} }
                    } } } }
                }
            },
            structure_world_origin: { type: 'list', value: { type: 'int', value: [0, 0, 0] } }
        }
    };
}

function fileToCoreBytes(name, bytes){
    if (name.toLowerCase().endsWith('.bdx')){
        if (new TextDecoder().decode(bytes.slice(0,3)) !== 'BD@') throw new Error('不是有效的 BDX 文件(BD@ 头缺失)');
        const nbtBuf = brotli.decompress(new Uint8Array(bytes.slice(3))).buffer;
        const matrix = new bdx.Reader(nbtBuf).Matrixify();
        return new Uint8Array(nbt.writeUncompressed(matrixToMcstructureNBT(matrix), true));
    }
    return bytes;
}

// -------------------------------------------------- wasm 核心
async function ensureCore(){
    if (!Core) Core = await createCore({ locateFile: f => './' + f });
    return Core;
}
// 上一个大文件仍占着 wasm 堆时再载入可能 OOM abort——重建核心后重试一次
async function tryLoad(bytes, lod){
    try {
        const core = await ensureCore();
        const p = core._malloc(bytes.length);
        core.HEAPU8.set(bytes, p);
        try { return core._core_load_lod(p, bytes.length, lod); }
        finally { core._free(p); }
    } catch (e){
        Core = await createCore({ locateFile: f => './' + f });
        const p2 = Core._malloc(bytes.length);
        Core.HEAPU8.set(bytes, p2);
        try { return Core._core_load_lod(p2, bytes.length, lod); }
        finally { Core._free(p2); }
    }
}

function collectGeometry(core){
    const vc = core._core_vertex_count(), ic = core._core_index_count();
    const F32 = core.HEAPF32, U32 = core.HEAPU32;
    const posP = core._core_positions_ptr(), uvP = core._core_uvs_ptr(),
          idxP = core._core_indices_ptr(), rgbP = core._core_palette_rgb_ptr();
    // 每个分组是一段连续的顶点/索引区间,主线程用 subarray 直接建几何
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
    // 包围盒(C++ 侧坐标已平移到 0 基,这里直接扫一遍)
    const mn = [1e9,1e9,1e9], mx = [-1e9,-1e9,-1e9];
    for (let v = 0; v < vc; v++){
        const x = pos[v*3], y = pos[v*3+1], z = pos[v*3+2];
        if (x < mn[0]) mn[0]=x; if (x > mx[0]) mx[0]=x;
        if (y < mn[1]) mn[1]=y; if (y > mx[1]) mx[1]=y;
        if (z < mn[2]) mn[2]=z; if (z > mx[2]) mx[2]=z;
    }
    const info = core._malloc(24);
    core._core_region_info(info);
    const info6 = new Int32Array(core.HEAPU32.buffer, info, 6).slice();
    core._free(info);
    // 调色板名
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
    return { vc, ic, groups, pos, uv, idx, palRgb, pal, names, info6,
             blocksTotal: core._core_blocks_total(), blocksNonair: core._core_blocks_nonair(),
             regions: core._core_region_count(), mn, mx };
}

self.onmessage = async (ev) => {
    const msg = ev.data;
    try {
        if (msg.type === 'load'){
            postMessage({ type: 'progress', stage: 'bridge' });
            const bytes = msg.reuse ? lastBytes : fileToCoreBytes(msg.name, msg.bytes);
            lastBytes = bytes;
            postMessage({ type: 'progress', stage: 'parse' });
            const rc = await tryLoad(bytes, msg.lod);
            if (rc === undefined || rc === -1 || rc === -2){
                postMessage({ type: 'error', code: rc === -2 ? -2 : -1 });
                return;
            }
            postMessage({ type: 'progress', stage: 'geometry' });
            const g = collectGeometry(Core);
            postMessage({ type: 'geometry', ...g }, [
                g.pos.buffer, g.uv.buffer, g.idx.buffer, g.palRgb.buffer, g.groups.buffer,
            ]);
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
