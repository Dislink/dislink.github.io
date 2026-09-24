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
     * 转换一帧,返回 § 字符串(与 JS convertFrame+optimizeColorString 等价)。
     * imgData: ImageData(w,h);w/h 与其一致;dither: bool
     */
    function convertFrame(imgData, w, h, dither) {
        ensureBuffers(w, h);
        // 拷贝像素进 wasm 堆(4*w*h 字节;imgData.data.buffer 可能被换过,直接从 data 视图拷)
        var px = new Uint8Array(inst.HEAPU8.buffer, pxPtr, w * h * 4);
        px.set(imgData.data.subarray(0, w * h * 4));

        exports.convert(w, h, dither ? 1 : 0);

        // 从索引表拼 § 字符串(与 convertFrame 的 asciiStr 一致),再跑颜色合并优化
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
        return optimizeColorStringStr(out);
    }

    // 页面已有同名函数;桥内独立实现避免依赖页面加载顺序
    function optimizeColorStringStr(text) {
        var result = '';
        var i = 0;
        var len = text.length;
        while (i < len) {
            if (text[i] === '§' && i + 2 < len) {
                var colorCode = text.substr(i, 2);
                var displayChar = text[i + 2];
                result += colorCode + displayChar;
                i += 3;
                while (i < len && text[i] === '§' && text.substr(i, 2) === colorCode && i + 2 < len) {
                    result += text[i + 2];
                    i += 3;
                }
            } else {
                result += text[i];
                i++;
            }
        }
        return result;
    }

    window.VcaWasm = {
        init: init,
        convertFrame: convertFrame,
        /** 等价性测试用:返回 {codes: Uint8Array, shades: Uint8Array}(转换后索引表) */
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
