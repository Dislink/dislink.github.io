/**
 * vca_wasm.js — 彩色视频字符画 WASM 转换桥(可行性测试)
 *
 * 加载 wasm-bench/vca_core.js(emcc MODULARIZE 产物),暴露与页面 JS convertFrame
 * 等价的转换入口。SIMD 不可用时 resolve(null),页面自动回退 JS 路径。
 *
 * 等价性:见 vca_core.c 头注释(误差回绕、档位公式逐字对齐 JS 版)。
 */
(function (global) {
    'use strict';

    var loadingPromise = null;
    var inst = null;   // emscripten Module 实例
    var exports = null;

    // 与页面 colors 对象同序的 28 色 § 码字母(用于 JS 侧拼串)
    var CODES = '0123456789abcdefghijmnpqstu';
    var CHAR_TABLE = ['┃', '┃', '┃', '┋', '┋', '╏', '┇'];

    /** 页面 ditherAlgo 选项值 → C 算法 id(顺序与 index.html select 一致) */
    var DITHER_IDS = {
        none: 0, fs: 1, atkinson: 2, jjn: 3, sierra3: 4,
        stucki: 5, burkes: 6, bayer4: 7, bayer8: 8, riemersma: 9
    };

    function init(baseUrl) {
        if (loadingPromise) return loadingPromise;
        loadingPromise = (function () {
            if (typeof WebAssembly === 'undefined' || !instantiateSimdOk()) {
                return Promise.resolve(null);
            }
            var base = baseUrl || (document.currentScript && document.currentScript.src
                ? document.currentScript.src.replace(/[^/]*$/, '')
                : 'wasm-bench/');
            return fetchScriptAndWasm(base).then(function () {
                if (typeof window.createVcaCore !== 'function') {
                    throw new Error('createVcaCore 未定义');
                }
                return window.createVcaCore({
                    locateFile: function (path) { return base + path; }
                });
            }).then(function (m) {
                inst = m;
                exports = {
                    init: m._vca_init,
                    px: m._vca_pixels_ptr,
                    codes: m._vca_codes_ptr,
                    shades: m._vca_shades_ptr,
                    convert: m._vca_convert_frame
                };
                if (m._vca_version() < 2) {
                    throw new Error('vca_core.wasm 版本过旧(缺少多抖动算法),请重新部署');
                }
                return m;
            }).catch(function (e) {
                console.warn('[vca-wasm] 初始化失败,回退 JS 路径:', e && e.message);
                return null;
            });
        })();
        return loadingPromise;
    }

    function instantiateSimdOk() {
        if (typeof WebAssembly === 'undefined' || !WebAssembly.validate) return false;
        try {
            // (module (func (result v128) v128.const i32x4 0))
            var bytes = new Uint8Array([
                0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
                0x01, 0x06, 0x01, 0x60, 0x00, 0x01, 0x7b,          // type section: () -> v128
                0x03, 0x02, 0x01, 0x00,                            // func section
                0x0a, 0x0b, 0x01, 0x09, 0x00,                      // code section
                0xfd, 0x0c,                                        // v128.const
                0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                0x0b, 0x0b                                         // end, end
            ]);
            return WebAssembly.validate(bytes);
        } catch (e) {
            return false;
        }
    }

    function fetchScriptAndWasm(base) {
        return new Promise(function (resolve, reject) {
            var s = document.createElement('script');
            s.src = base + 'vca_core.js';
            s.onload = resolve;
            s.onerror = function () { reject(new Error('vca_core.js 加载失败')); };
            document.head.appendChild(s);
        });
    }

    function ensureBuffers(w, h) {
        if (!exports.init(w, h)) throw new Error('vca_init 失败');
        if (!pxPtrValid || g_w !== w || g_h !== h) {
            pxPtr = exports.px();
            codesPtr = exports.codes();
            shadesPtr = exports.shades();
            g_w = w; g_h = h;
            pxPtrValid = true;
            heapU8 = null;   // ALLOW_MEMORY_GROWTH 可能换 buffer
        }
    }

    var pxPtr = 0, codesPtr = 0, shadesPtr = 0, g_w = 0, g_h = 0, pxPtrValid = false;
    var heapU8 = null;

    /**
     * 转换一帧,返回 § 字符串。
     * imgData: ImageData(w,h);w/h 与其一致;
     * dither: 0=无 1=FS 2=Atkinson 3=JJN 4=Sierra3 5=Stucki 6=Burkes 7=Bayer4 8=Bayer8 9=Riemersma
     *   (与页面 ditherAlgo select 的选项顺序一致)
     * serpentine: 可选,误差扩散蛇形(默认 true)
     */
    function convertFrame(imgData, w, h, dither, serpentine) {
        ensureBuffers(w, h);
        // 拷贝像素进 wasm 堆(4*w*h 字节;imgData.data.buffer 可能被换过,直接从 data 视图拷)
        var px = new Uint8Array(inst.HEAPU8.buffer, pxPtr, w * h * 4);
        px.set(imgData.data.subarray(0, w * h * 4));

        var id = (typeof dither === 'string') ? (DITHER_IDS[dither] || 0) : (dither | 0);
        exports.convert(w, h, id, serpentine === false ? 0 : 1);

        return buildStringFromTables(w, h);
    }

    /** 从索引表拼 § 字符串(未合并;页面侧用 optimizeColorString 合并) */
    function buildStringFromTables(w, h) {
        var codes = new Uint8Array(inst.HEAPU8.buffer, codesPtr, w * h);
        var shades = new Uint8Array(inst.HEAPU8.buffer, shadesPtr, w * h);
        var out = '';
        for (var y = 0; y < h; y++) {
            var base = y * w;
            for (var x = 0; x < w; x++) {
                var o = base + x;
                out += '§' + CODES[codes[o]] + CHAR_TABLE[shades[o]];
            }
            out += '\n';
        }
        return out;
    }

        window.VcaWasm = {
        init: init,
        ditherId: function (name) {
            var id = DITHER_IDS[name];
            return id === undefined ? 0 : id;
        },
        convertFrame: convertFrame,
        /** 转换但不拼串(高频路径用):返回 {codes, shades} 视图;拼串由页面按需做 */
        convertFrameTables: function (imgData, w, h, dither, serpentine) {
            ensureBuffers(w, h);
            var px = new Uint8Array(inst.HEAPU8.buffer, pxPtr, w * h * 4);
            px.set(imgData.data.subarray(0, w * h * 4));
            var id = (typeof dither === 'string') ? (DITHER_IDS[dither] || 0) : (dither | 0);
            exports.convert(w, h, id, serpentine === false ? 0 : 1);
            return {
                codes: new Uint8Array(inst.HEAPU8.buffer, codesPtr, w * h),
                shades: new Uint8Array(inst.HEAPU8.buffer, shadesPtr, w * h)
            };
        },
        /** 等价性测试用:返回上次转换的 {codes, shades}(拷贝) */
        lastIndexTables: function () {
            if (!inst || !pxPtrValid) return null;
            return {
                codes: new Uint8Array(inst.HEAPU8.buffer, codesPtr, g_w * g_h),
                shades: new Uint8Array(inst.HEAPU8.buffer, shadesPtr, g_w * g_h)
            };
        },
        get instance() { return inst; },
        _resetForTest: function () {
            loadingPromise = null; inst = null; exports = null;
            pxPtrValid = false; heapU8 = null;
        }
    };
})(window);
