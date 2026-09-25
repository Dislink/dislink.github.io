// structure-convertor worker.js — 解析与重编码全部在 WASM 内完成。
// 协议:
//   → {type:'convert', seq, bytes, fmt, min6?}  (bytes 被 transfer;
//     fmt: 0=mcstructure 1=litematic 2=schem 3=wsmr 4=bdx 5=schematic 6=mcworld;
//     min6 = {x1,y1,z1,x2,y2,z2} 世界坐标裁剪箱(mcworld 文件名约定),走 core_convert_crop)
//   ← {type:'ready'}
//   ← {type:'progress', stage}            parse / encode
//   ← {type:'result', seq, ok, size, out, error, srcName, srcSize, ms, bbox?}
//     (out: Uint8Array 结果拷贝,transfer;ok=false 时 error 为可读原因;
//      bbox = [x1,y1,z1,x2,y2,z2] 输出区域的世界坐标包围盒,供命名约定使用)
//   ← {type:'worker-error', message}
// 输入格式自动嗅探(BD@ / gzip 1F 8B / LE-NBT),输出格式用整数编码
// (emscripten 导出仅整数编组稳定)。
// 核心更新后浏览器会拿缓存里的旧 core.js/core.wasm(产物落进旧格式的世界
// 文件,游戏端 repair)——每次重新部署核心时同步递增这里的版本号。
const CORE_V = 'v6';
importScripts('./core.js?' + CORE_V);

let Core = null;

postMessage({ type: 'ready' });

async function ensureCore(){
    if (!Core) Core = await createCore({ locateFile: f => './' + f.split('?')[0] + '?' + CORE_V });
    return Core;
}
// 源文件名(@裁剪约定取 @ 前的名称)作为世界/结构名传给核心,mcworld 导出
// 的 level.dat LevelName / levelname.txt 用它。name 为空串时清除覆盖。
function setCoreName(core, name){
    if (!core._core_convert_name) return;
    const bytes = new TextEncoder().encode(name || '');
    const p = core._malloc(bytes.length + 1);
    core.HEAPU8.set(bytes, p);
    core.HEAPU8[p + bytes.length] = 0;
    try { core._core_convert_name(p); }
    finally { core._free(p); }
}
// 上一个大文件仍占着 wasm 堆时再转换可能 OOM abort——重建核心后重试一次。
// withCrop 为真时改走 core_convert_crop(裁剪箱指针在 wasm 堆上,i32×6)。
async function tryConvert(bytes, fmt, min6, name){
    try {
        const core = await ensureCore();
        setCoreName(core, name);
        const p = core._malloc(bytes.length);
        core.HEAPU8.set(bytes, p);
        const c = min6 ? core._malloc(24) : 0;
        if (min6) new Int32Array(core.HEAPU8.buffer, c, 6).set(min6);
        try {
            return min6 ? core._core_convert_crop(p, bytes.length, fmt, c)
                        : core._core_convert(p, bytes.length, fmt);
        }
        finally { core._free(p); if (c) core._free(c); }
    } catch (e){
        Core = await createCore({ locateFile: f => './' + f.split('?')[0] + '?' + CORE_V });
        setCoreName(Core, name);
        const p2 = Core._malloc(bytes.length);
        Core.HEAPU8.set(bytes, p2);
        const c2 = min6 ? Core._malloc(24) : 0;
        if (min6) new Int32Array(Core.HEAPU8.buffer, c2, 6).set(min6);
        try {
            return min6 ? Core._core_convert_crop(p2, bytes.length, fmt, c2)
                        : Core._core_convert(p2, bytes.length, fmt);
        }
        finally { Core._free(p2); if (c2) Core._free(c2); }
    }
}

function readErrorString(core){
    const eptr = core._core_convert_error();
    if (!eptr) return '';
    const H = core.HEAPU8;
    let msg = '';
    for (let i = 0; i < 1000; i++){
        const b = H[eptr + i];
        if (b === 0) break;
        msg += String.fromCharCode(b);
    }
    return msg;
}

self.onmessage = async (ev) => {
    const msg = ev.data;
    try {
        if (msg.type === 'convert'){
            const t0 = Date.now();
            // mcworld 世界名:文件名带 @裁剪约定时取 @ 前的名称,否则取去扩展名的源文件名。
            const m = /^(.*)@\[\s*-?\d+\s*,\s*-?\d+\s*,\s*-?\d+\s*\]~\[\s*-?\d+\s*,\s*-?\d+\s*,\s*-?\d+\s*\]/.exec(msg.name || '');
            const srcName = m ? (m[1].trim() || 'structure')
                              : (msg.name || '').replace(/\.[^.]+$/, '');
            postMessage({ type: 'progress', stage: 'parse' });
            const rc = await tryConvert(msg.bytes, msg.fmt, msg.min6 || null, srcName);
            if (rc === 1){
                postMessage({ type: 'progress', stage: 'encode' });
                const n = Core._core_convert_size();
                const src = Core._core_convert_ptr();
                // 从 wasm 堆拷出立即转移给主线程(wasm 堆随后可被下次转换复用)
                const out = new Uint8Array(Core.HEAPU8.buffer.slice(src, src + n));
                // 输出区域的世界坐标包围盒(核心有此导出时),用于 mcworld 命名约定
                let bbox = null;
                if (Core._core_convert_bbox){
                    const bp = Core._malloc(24);
                    try {
                        if (Core._core_convert_bbox(bp)){
                            bbox = Array.from(new Int32Array(Core.HEAPU8.buffer, bp, 6));
                        }
                    } finally { Core._free(bp); }
                }
                postMessage({ type: 'result', seq: msg.seq, ok: true, size: n, out,
                              srcName: msg.name || '', srcSize: msg.bytes.length,
                              ms: Date.now() - t0, bbox }, [out.buffer]);
            } else {
                postMessage({ type: 'result', seq: msg.seq, ok: false, size: 0, out: null,
                              error: readErrorString(Core) || '转换失败',
                              srcName: msg.name || '', srcSize: msg.bytes.length,
                              ms: Date.now() - t0 });
            }
        }
    } catch (e){
        // abort(RuntimeError) 等:报告重建核心并给出可读信息
        const em = (e && e.message) ? e.message : String(e);
        if (/abort|memory/i.test(em)){
            try { Core = await createCore({ locateFile: f => './' + f.split('?')[0] + '?' + CORE_V }); } catch (_){}
            postMessage({ type: 'result', seq: msg.seq, ok: false, size: 0, out: null,
                          error: 'WASM 内存不足(目标格式可能展开过大,如未压缩 NBT)',
                          srcName: (msg && msg.name) || '', srcSize: (msg && msg.bytes) ? msg.bytes.length : 0,
                          ms: 0 });
        } else {
            postMessage({ type: 'worker-error', message: em });
        }
    }
};
