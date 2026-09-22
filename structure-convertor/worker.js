// structure-convertor worker.js — 解析与重编码全部在 WASM 内完成。
// 协议:
//   → {type:'convert', seq, bytes, fmt}   (bytes 被 transfer;fmt: 0=mcstructure 1=litematic 2=schem 3=wsmr)
//   ← {type:'ready'}
//   ← {type:'progress', stage}            parse / encode
//   ← {type:'result', seq, ok, size, out, error, srcName, srcSize, ms}
//     (out: Uint8Array 结果拷贝,transfer;ok=false 时 error 为可读原因)
//   ← {type:'worker-error', message}
// 输入格式自动嗅探(BD@ / gzip 1F 8B / LE-NBT),输出格式用整数编码
// (emscripten 导出仅整数编组稳定)。
importScripts('./core.js');

let Core = null;

postMessage({ type: 'ready' });

async function ensureCore(){
    if (!Core) Core = await createCore({ locateFile: f => './' + f });
    return Core;
}
// 上一个大文件仍占着 wasm 堆时再转换可能 OOM abort——重建核心后重试一次
async function tryConvert(bytes, fmt){
    try {
        const core = await ensureCore();
        const p = core._malloc(bytes.length);
        core.HEAPU8.set(bytes, p);
        try { return core._core_convert(p, bytes.length, fmt); }
        finally { core._free(p); }
    } catch (e){
        Core = await createCore({ locateFile: f => './' + f });
        const p2 = Core._malloc(bytes.length);
        Core.HEAPU8.set(bytes, p2);
        try { return Core._core_convert(p2, bytes.length, fmt); }
        finally { Core._free(p2); }
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
            postMessage({ type: 'progress', stage: 'parse' });
            const rc = await tryConvert(msg.bytes, msg.fmt);
            if (rc === 1){
                postMessage({ type: 'progress', stage: 'encode' });
                const n = Core._core_convert_size();
                const src = Core._core_convert_ptr();
                // 从 wasm 堆拷出立即转移给主线程(wasm 堆随后可被下次转换复用)
                const out = new Uint8Array(Core.HEAPU8.buffer.slice(src, src + n));
                postMessage({ type: 'result', seq: msg.seq, ok: true, size: n, out,
                              srcName: msg.name || '', srcSize: msg.bytes.length,
                              ms: Date.now() - t0 }, [out.buffer]);
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
            try { Core = await createCore({ locateFile: f => './' + f }); } catch (_){}
            postMessage({ type: 'result', seq: msg.seq, ok: false, size: 0, out: null,
                          error: 'WASM 内存不足(目标格式可能展开过大,如未压缩 NBT)',
                          srcName: (msg && msg.name) || '', srcSize: (msg && msg.bytes) ? msg.bytes.length : 0,
                          ms: 0 });
        } else {
            postMessage({ type: 'worker-error', message: em });
        }
    }
};
