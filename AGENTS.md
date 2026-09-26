# dislink.github.io 站点 — 仓库结构与发布流程

> 本文档写给后续接手的 agent / 开发者。**改动站点代码前必读。**

## 两个仓库

| | 开发仓库（源码） | 旧目录（本地镜像） |
|---|---|---|
| 路径 | `C:\Users\Disli\Desktop\dislink-src` | `C:\Users\Disli\Desktop\dislink.github.io` |
| 内容 | 未压缩、带注释的源码 + 构建脚本 | 2026-09-26 迁移前的旧工作副本 |
| 推送 | **从不直接推送**；通过 publish 管线推压缩快照 | 不再推送 |
| remote | `git@github.com:Dislink/dislink.github.io.git` | 同左 |
| 杂物 | `.claude-scratch/`（会话探针）、`node_modules/`、`build/` 均已 gitignore | 有 `.claude-scratch/`（108 个探针）等杂物，勿提交 |

**规则：所有站点改动一律在 `dislink-src` 进行。** 旧目录只作参考/对照，不要在那边开发（两边会分叉）。

## 发布流程（唯一正确的推送方式）

```bash
cd C:\Users\Disli\Desktop\dislink-src
# 1. 改代码 → 正常 git commit（中文提交信息，风格同现有历史）

# 2. 构建：源码 → build/（terser + clean-css + html-minifier-terser 最高压缩）
npm run build

# 3. 发布：把 build/ 快照成独立 commit 推 origin/main
npm run publish          # 内部会先 build，可加 --skip-build 跳过
```

- **远程 main = 压缩产物**。任何情况下不要 `git push origin main` 直接推源码分支。
- `npm run build -- --check`：只校验构建（临时目录，不落盘），适合验证压缩不破坏语法。
- 验证产物：起本地服务看 `build/`（如 `python -m http.server -d build`），页面功能过一遍再 publish。

## 构建管线细节（scripts/build.mjs）

- **压缩**：39 个 JS（terser `minify` API，css/style.css 走 clean-css level 2）、20 个 HTML（html-minifier-terser，内联 script/css 一并压）。
- ⚠️ **terser 语义铁律**：除 `ES_MODULES` 白名单（`structure-viewer/three/OrbitControls.js` 两份，真 ES module）外，**所有 js 一律 `module:false`（classic script 语义）压缩**。terser `module:true` 会把没有 export 的顶层 class/function/var 当死代码删光——`javascript/*.js` 是 classic `<script>` 全局库，顶层声明（`Matrix`/`Block`/`MIDIEvents`/`saveAs`/…）就是页面依赖的 API。曾有版本用 `importScripts` 启发式误判，线上 img2block/MIDI 页/全部下载按钮集体 `undefined`。新增真 ES module 的 js 才需要加白名单。
- **原样复制**：图片/字体/音频/wasm/pdata/bake.bin/图集/tiles/three 等二进制与数据。
- **JS_SKIP**（跳过压缩，原样复制）：
  - `javascript/brotli.min.js`、`javascript/jszip.min.js`、`javascript/zlib.min.js`、`javascript/Brotli.decompress.js`（第三方已压缩）
  - `structure-viewer/core.js`、`structure-convertor/core.js`、`neteaseRegex/g79.js`（emscripten 产物，已压缩；动源码在 wasm-structure-render 仓库）
  - `structure-viewer/three/three.module.min.js`
- **不进产物**：`SKIP_DIRS`（`.git`/`.claude`/`.claude-scratch`/`node_modules`/`build`/`scripts`）+ `SKIP_FILES`（`.gitignore`/`package.json`/`package-lock.json`）。
- build/ **每次清空重建**（防改名工具页残留成死链）。
- 体积参考：41.8MB → 35.4MB（-15.5%；大头是 `blockNamespace2blockState.js` 等纯数据映射表，压不动是正常的）。

## 发布机制（scripts/publish.mjs）

`GIT_WORK_TREE=build` + 独立临时 index（`GIT_INDEX_FILE`）→ `git add -A :/` → `write-tree` → `commit-tree -p origin/main` → push 到 `refs/heads/main`。源码仓库工作区/index 零污染。

⚠️ 坑：`git -C build add -A` 会落到整个上层仓库（快照变成源码树），必须用 `GIT_WORK_TREE` + `add -A :/`。

## 约定速查（从旧目录会话沿用）

- 绝不 `git add -A`（源码仓库正常提交时也一样，明确指定文件）；不提交 `classes.jar`、`debug/`、`.claude-scratch/`、`structure-viewer/gen/_misses.json`、`_stage2.json`、截图杂物。
- **CORE_V 穿透**：wasm 核心重新部署时，`structure-viewer/worker.js` 和 `structure-convertor/worker.js` 的 `CORE_V` 必须同步递增（当前 `'v12'`），否则浏览器拿缓存旧 core。
- 查看器页保留 Mojang 材质版权声明；页面 UI 全中文；工具页公共 head（GA G-HJVLPQTQE6 / 百度统计 hm.js?34e9d302... / AdSense / error-handler.js）、标题后缀 `| By Dislink`、页脚骨架统一（见 `css/style.css` 与任一工具页）。
- 广告授权：根目录 `ads.txt`（pub-7210376314498048）。
- 站点静态无构建产物依赖——除 `build/` 生成物外不要引入需要 npm 构建的运行时代码。

## 引擎 / WASM 核心（另仓库）

`C:\Users\Disli\Desktop\wasm-structure-render`（C++ 解析/网格化引擎）：

- Windows 编辑 → commit（中文）→ `.\scripts\kali_test.ps1 -Mode both`（推送 Kali 跑 native+wasm ctest）→ `ssh root@192.168.169.132 'cmake --build /root/build/wasm-structure-render/build-wasm --target core -j4'` → `scp core.{js,wasm}` 回 **两个** 站点目录（structure-viewer/ 与 structure-convertor/）。
- 每次重新部署 core：两个 worker.js 的 `CORE_V` 同步递增（防浏览器缓存旧 core）。
- 详细坑位见该仓库 goal.md / pitfalls 文档与站点记忆索引。

## fetch 新克隆的坑

整包 fetch 会断（`unexpected disconnect while reading sideband packet`），用：
```bash
git fetch --depth=50 origin main && git fetch --unshallow
```
