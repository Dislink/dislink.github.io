# WASM 可行性测试 — 彩色视频字符画(video-character-art)

> 分支 `feat/video-wasm-bench`,仅可行性验证,**不推送、不影响 main 上的现有工具**。
> `index.html` 的接入改动保留在工作区未提交(用户要求不提交页面 HTML,保留回退边界)。

## 结论(先行)

**可行,收益明确。** 在 Node(与浏览器同引擎 JIT 特性)上的基准:

| 场景 | JS(现网实现,完整路径) | WASM(完整路径) | 端到端加速 | 纯核心(匹配+抖动)加速 |
|---|---|---|---|---|
| 320×180 无抖动 | 14.2 ms/帧 | 4.9 ms/帧 | **2.93×** | **5.16×** |
| 320×180 FS 抖动 | 24.3 ms/帧 | 8.2 ms/帧 | **2.97×** | 4.11× |
| 512×256 无抖动 | 32.0 ms/帧 | 10.4 ms/帧 | **3.09×** | **5.07×** |
| 512×256 FS 抖动 | 53.3 ms/帧 | 18.7 ms/帧 | **2.85×** | 3.92× |

等价性:none 模式下色码/档位索引表与 JS 参考实现**逐字节一致**;
FS 抖动模式输出**不同属预期**——v2 把旧 JS 的 Uint8 回绕误差修正为浮点误差域
(回绕是旧实现的 artifact,见下文语义坑)。

## v2:多抖动算法 + 质量修正(2026-09-24)

`vca_core.c` 重写为 v2(wasm 侧 `_vca_version() >= 2` 判定,旧产物会被拒绝):
10 种抖动算法,算法 id 与页面 `ditherAlgo` 选项一一对应:

| id | 算法 | ms/帧(320×180) | 8×8 块均值色差↓(none 基线 58.5) |
|---|---|---|---|
| 0 | none(最近色) | 3.1 | 58.5 |
| 1 | Floyd-Steinberg | 4.1 | **28.8** |
| 2 | Atkinson | 4.1 | 30.3 |
| 3 | Jarvis-Judice-Ninke | 4.7 | 34.7 |
| 4 | Sierra 3 | 4.2 | 34.4 |
| 5 | Stucki | 4.4 | 33.4 |
| 6 | Burkes | 4.1 | 31.4 |
| 7 | Bayer 4×4(真 4×4 阵) | 3.0 | 51.5 |
| 8 | Bayer 8×8 | 2.9 | 51.6 |
| 9 | Riemersma(Hilbert) | 5.9 | 59.0 |

JS FS 基线(标准浮点域同实现)8.6 ms/帧 → wasm 误差扩散类约 **2.1×**,全部算法
对 JS 旧实现端到端仍约 **2.8–3.5×**。

质量要点:
- **v1 的 fs 无效果 bug 已修**:误差必须从「量化后调色板色」计算
  (`ferr = base+err - pal[ci]`),之前误用四舍五入整数 `r`,整数化误差被
  round 抵消,误差扩散恒为 0。修正后 2×1 探针 `[240,130]` 得 `15 8`(v1 恒 `15 7`)。
- **Bayer4 不再用 8×8 子阵近似**(旧实现块均值误差 126.8,真 4×4 阵 51.5)。
- 误差缓冲为浮点域(3 行 × (w+4) × 3ch Float32),serpentine 默认开,消除累积条纹。

## 文件

- `vca_core.c` — C 实现:28 色最近色匹配 + 字符档位 + 10 种抖动算法 + 盲文核心。
  彩色输出两张索引表(codes:色码 0..27,shades:档位 0..6);盲文输出每 cell 一字节
  点位 bits。字符串拼接留在 JS(UTF-16/§ 码拼接在 wasm 里做没有优势)。
- `vca_core.js/.wasm` — emcc 产物(MODULARIZE + SIMD128 + ALLOW_MEMORY_GROWTH)。
- `vca_wasm.js` — 浏览器加载桥(SIMD 探测,失败回退 JS;dither 名→id 映射)。
- `bench.js` — 等价性验证 + 基准(node bench.js [--dither],W/H 环境变量改尺寸)。
- `bench2.js` — v2 多算法:不变量自检 + 性能 + 8×8 块均值色差质量度量 + JS FS 对照。
- `probe.js` — 2×1 最小误差扩散探针(回归:fs 必须产出 `15 8`)。

## 编译命令(Kali, emcc 6.0.5 / clang 21)

```sh
emcc vca_core.c -O3 -flto -msimd128 -fno-exceptions \
  -s MODULARIZE=1 -s EXPORT_NAME=createVcaCore -s ALLOW_MEMORY_GROWTH=1 \
  -s ENVIRONMENT=web,worker,node -s DISABLE_EXCEPTION_CATCHING=1 \
  -s EXPORTED_RUNTIME_METHODS=HEAPU8,HEAPF32 \
  -s EXPORTED_FUNCTIONS=_vca_init,_vca_pixels_ptr,_vca_codes_ptr,_vca_shades_ptr,_vca_err_ptr,_vca_convert_frame,_vca_set_palette,_vca_version,_vca_braille_init,_vca_braille_pixels_ptr,_vca_braille_out_ptr,_vca_braille_convert \
  -o vca_core.js
```

- `bench-braille.js` — 盲文等价性(32 组参数逐字节)+ 盲文基准。
- `smoke-bridge.js` — vca_wasm.js 桥接层 Node 冒烟(模拟浏览器 script 注入)。

## 移植时踩到的语义坑(重要)

1. **JS `Math.round` vs C `lround` 负半数行为不同**:`Math.round(-1.5) === -1`,
   `lround(-1.5) === -2`。字符档位 `3 - round(v)` 必须用 `floor(v + 0.5)` 复现。
2. **Uint8Array += 负浮点的回绕**:`chunkd[o] += dr * 4/21`(dr 可为负)的语义是
   `ToUint8(trunc(byte + err) mod 256)`,如 `1 + (-3.2) → 254`。
   C 的 `(unsigned char)(负小数)` 是 UB。v2 不再复现该语义(改为浮点误差缓冲),
   但若要字节级复现旧 JS 输出,必须 `trunc → & 0xFF`。
3. **误差扩散的误差定义**:必须用「量化前值 − 调色板色」;若用「量化前值 − round
   整数」,round 的偏差与整数化误差几乎抵消,扩散近似无效(v1 踩坑)。

## 下一步(若正式接入)

1. 页面 `index.html` 已在工作区接入(未提交):`ditherAlgo` select 驱动
   `VcaWasm.convertFrameTables`,JS `convertFrame` 保留为回退(SIMD 探测失败/加载失败)。
2. 转换已在宏任务里逐帧执行(见 `javascript/video-frame-capture.js`),wasm 调用
   同步进行即可;若将来上 worker,把 wasm 实例放进 worker 再传 ImageData。
3. ~~braille 页的同构热路径(`convertToBraille`)可按同样方式移植~~ → 已移植,见下节。
4. SIMD 当前只吃到编译器自动向量化;手写 v128 最近色搜索(28 色 → 用 i16x8 距离)
   预计还能再提,收益递减,视接入后实测再定。

## 盲文字符画(braille 页)移植(2026-09-24)

`vca_core.c` 新增盲文核心(`_vca_braille_init/_vca_braille_convert/...`),完整接管
`braille/index.html convertToBraille`:深度图 `(r+g+b)*(a/255)/3`、误差扩散进
同一 Float32 深度缓冲、invert、2×4 点位打包(每 cell 一字节 bits,U+2800 组码留 JS 拼)。

**v3 盲文多抖动**:与彩色路径共用误差核表(KERN/Bayer 阵),支持
none/fs/atkinson/jjn/sierra3/stucki/burkes/bayer4/bayer8 共 9 种
(盲文是单通道二值输出、无调色板,Riemersma 不适用)。页面 `ditherAlgo` select
驱动(原 FS 复选框移除,选项语义与彩色页一致)。

**等价性:`bench-braille.js` 8 档 threshold × 9 算法 × 反色共 144 组参数全部
逐字节一致**,最终盲文字符串也逐字符一致(盲文深度是 Float32,无彩色路径的
回绕 artifact,所以要求全参数严格等价;也确实做到了)。

| 场景(256×102 默认) | JS | WASM | 端到端 | 纯核心 |
|---|---|---|---|---|
| FS 抖动 | 0.47 ms/帧 | 0.11 ms/帧 | **4.45×** | **5.72×** |
| 无抖动 | 0.28 ms/帧 | 0.04 ms/帧 | **7.19×** | — |

512×288(盲文 256×48 字符):FS 3.30×(2.30→0.70 ms),无抖动 6.16×(1.48→0.24 ms)。

v3 各算法核心耗时(256×102,wasm):none 0.044 / fs 0.122 / atkinson 0.151 /
jjn 0.224 / sierra3 0.213 / stucki 0.214 / burkes 0.160 / bayer4 0.043 /
bayer8 0.042 ms/帧。

页面接入(工作区未提交):`braille/index.html` 引入 `vca_wasm.js`,6 处
`convertToBraille` 调用点全部改走 `convertBrailleAuto`(wasm 失败回退 JS 实现,
原函数原样保留;JS 回退只有 FS,其他算法降级 FS 并 console.warn)。

**顺带修复**:`vca_wasm.js` 的 SIMD 探针字节码原本编码错误(type section 尺寸、
缺 function section、结尾多一个 end),任何引擎都会 validate 失败 → 一直走 JS
回退。已修正;修复前所有 wasm 基准数据实际测的是"emcc JS 后备 + 拼串"路径
(仍然有效,但 wasm 未真正参与——本文件上方的彩色性能数字需要在浏览器里重测)。
