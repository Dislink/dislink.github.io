/**
 * vca_wasm.js — 彩色视频字符画 + 盲文字符画 WASM 转换桥(可行性测试)
 *
 * 加载 wasm-bench/vca_core.js(emcc MODULARIZE 产物),暴露与页面 JS convertFrame /
 * convertToBraille 等价的转换入口。SIMD 不可用时 resolve(null),页面自动回退 JS 路径。
 *
 * 等价性:见 vca_core.c 头注释(误差回绕、档位公式、盲文深度/点位语义逐字对齐 JS 版)。
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
                    convert: m._vca_convert_frame,
                    brailleInit: m._vca_braille_init,
                    brailleOut: m._vca_braille_out_ptr,
                    brailleConvert: m._vca_braille_convert
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
            // (module (type () -> v128) (func v128.const i32x4 0))
            // 模块字节内联构造(无依赖);浏览器同样通过
            var bytes = new Uint8Array([
                0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
                0x01, 0x05, 0x01, 0x60, 0x00, 0x01, 0x7b,          // type: () -> v128
                0x03, 0x02, 0x01, 0x00,                            // func: 1 个,type 0
                0x0a, 0x16, 0x01, 0x14,                            // code: size 0x16,1 个 body(size 0x14)
                0x00,                                              //   locals: 0
                0xfd, 0x0c,                                        //   v128.const
                0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                0x0b                                               //   end(函数体结束;模块结束由字节流自然收尾)
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
    var bOutPtr = 0, bW = 0, bH = 0, bValid = false;

    function ensureBrailleBuffers(w, h) {
        if (!exports.brailleInit(w, h)) throw new Error('vca_braille_init 失败');
        if (!exports.init(w, h)) throw new Error('vca_init 失败');
        if (!bValid || bW !== w || bH !== h) {
            bOutPtr = exports.brailleOut();
            bW = w; bH = h;
            bValid = true;
            heapU8 = null;   // ALLOW_MEMORY_GROWTH 可能换 buffer
        }
    }

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
        /** 转换一帧盲文,返回 Uint8Array bits 视图(每 cell 一字节点位;拼串留页面)。
         * threshold: 0..255;dither: 非零启用 FS(与页面 ditheringCheck 一致);
         * invert: 非零反色。像素语义与 braille 页 convertToBraille 逐字对齐。 */
        convertBrailleTables: function (imgData, w, h, threshold, dither, invert) {
            ensureBrailleBuffers(w, h);
            var px = new Uint8Array(inst.HEAPU8.buffer, exports.px(), w * h * 4);
            px.set(imgData.data.subarray(0, w * h * 4));
            var n = exports.brailleConvert(w, h, threshold | 0, dither ? 1 : 0, invert ? 1 : 0);
            return {
                bits: new Uint8Array(inst.HEAPU8.buffer, bOutPtr, n),
                cols: w / 2, rows: h / 6
            };
        },
        /** 等价性测试用:返回上次盲文转换的 bits(拷贝) */
        lastBrailleBits: function () {
            if (!inst || !bValid) return null;
            return new Uint8Array(inst.HEAPU8.buffer, bOutPtr, (bW / 2) * (bH / 6)).slice();
        },
        get instance() { return inst; },
        _resetForTest: function () {
            loadingPromise = null; inst = null; exports = null;
            pxPtrValid = false; heapU8 = null; bValid = false;
        }
    };
})(window);
