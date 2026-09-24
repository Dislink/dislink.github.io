# WASM 可行性测试 — 彩色视频字符画(video-character-art)

> 分支 `feat/video-wasm-bench`,仅可行性验证,**不推送、不影响 main 上的现有工具**。
> 页面 `index.html` 本身未改动 —— 本目录与 JS 参考实现并存,切换开关尚未接入。

## 结论(先行)

**可行,收益明确。** 在 Node(与浏览器同引擎 JIT 特性)上的基准:

| 场景 | JS(现网实现,完整路径) | WASM(完整路径) | 端到端加速 | 纯核心(匹配+抖动)加速 |
|---|---|---|---|---|
| 320×180 无抖动 | 14.2 ms/帧 | 4.9 ms/帧 | **2.93×** | **5.16×** |
| 320×180 FS 抖动 | 24.3 ms/帧 | 8.2 ms/帧 | **2.97×** | 4.11× |
| 512×256 无抖动 | 32.0 ms/帧 | 10.4 ms/帧 | **3.09×** | 5.07× |
| 512×256 FS 抖动 | 53.3 ms/帧 | 18.7 ms/帧 | **2.85×** | 3.92× |

等价性:两种尺寸 × 抖动开关共 4 个组合,57600(320×180)/131072(512×256)像素的
色码索引表与字符档位表与 JS 参考实现**逐字节一致**(EQUIVALENT)。

以 30fps 视频为例:512×256 抖动档每帧省 ~35ms,10 秒视频(100 帧)从 ~5.3s 降到 ~1.9s。

## 文件

- `vca_core.c` — C 实现:28 色最近色匹配 + 字符档位 + FS 抖动。输出两张索引表
  (codes:色码 0..27,shades:档位 0..6),字符串拼接留在 JS(UTF-16/§ 码拼接在
  wasm 里做没有优势)。
- `vca_core.js/.wasm` — emcc 产物(MODULARIZE + SIMD128 + ALLOW_MEMORY_GROWTH)。
- `vca_wasm.js` — 浏览器加载桥(SIMD 探测,失败回退 JS)。
- `bench.js` — 等价性验证 + 基准(node bench.js [--dither],W/H 环境变量改尺寸)。

## 编译命令(Kali, emcc 6.0.5 / clang 21)

```sh
emcc vca_core.c -O3 -flto -msimd128 -fno-exceptions \
  -s MODULARIZE=1 -s EXPORT_NAME=createVcaCore -s ALLOW_MEMORY_GROWTH=1 \
  -s ENVIRONMENT=web,worker,node -s DISABLE_EXCEPTION_CATCHING=1 \
  -s EXPORTED_RUNTIME_METHODS=HEAPU8 \
  -s EXPORTED_FUNCTIONS=_vca_init,_vca_pixels_ptr,_vca_codes_ptr,_vca_shades_ptr,_vca_convert_frame \
  -o vca_core.js
```

## 移植时踩到的两个语义坑(重要)

1. **JS `Math.round` vs C `lround` 负半数行为不同**:`Math.round(-1.5) === -1`,
   `lround(-1.5) === -2`。字符档位 `3 - round(v)` 必须用 `floor(v + 0.5)` 复现。
2. **Uint8Array += 负浮点的回绕**:`chunkd[o] += dr * 4/21`(dr 可为负)的语义是
   `ToUint8(trunc(byte + err) mod 256)`,如 `1 + (-3.2) → 254`。
   C 的 `(unsigned char)(负小数)` 是 UB,必须 `trunc → & 0xFF`(见 `js_wrap_u8`)。
   首版用 `(unsigned char)` 直转,dither 开启时 43% 像素不一致;修正后逐字节一致。

## 下一步(若正式接入)

1. 把 `convertFrame` 的核心循环替换为 `VcaWasm.convertFrame`(vca_wasm.js 已备),
   JS 路径保留为回退(SIMD 探测失败/加载失败)。
2. 转换已在宏任务里逐帧执行(见 `javascript/video-frame-capture.js`),wasm 调用
   同步进行即可;若将来上 worker,把 wasm 实例放进 worker 再传 ImageData。
3. braille 页的同构热路径(`convertToBraille`)可按同样方式移植,预期收益相近。
4. SIMD 当前只吃到编译器自动向量化;手写 v128 最近色搜索(28 色 → 用 i16x8 距离)
   预计还能再提,收益递减,视接入后实测再定。
