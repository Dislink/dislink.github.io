# 结构格式转换器 · 开发注意事项

> 面向后续开发者的坑位清单。核心实现:引擎仓库 `wasm-structure-render` 的 `libs/structure`(C++,emcc 编译为 wasm),站点仓库只含 `index.html + worker.js + core.js/core.wasm`,**JS 侧零格式逻辑**——所有解析/编码都在 wasm 里,排查问题先看引擎仓库。

## 一、mcstructure(基岩版)导出 — tag 类型是载重的

基岩 `StructureTemplate::load` 按 tag **类型**解析,写错类型即使方块全对也会"结构导入失败":

| 字段 | 必须写 | 写错后果 |
|---|---|---|
| 根顺序 | `format_version` → `size` → `structure` → `structure_world_origin` | 顺序错可能被拒 |
| `size` / `structure_world_origin` | **List\<Int\>[3]**(TAG_List) | 写 IntArray ⇒ 导入失败 |
| `block_indices` | List(2 层),每层 **List\<Int\>** | 写 List\<IntArray\> ⇒ 导入失败 |
| 空格子 | **-1**(不是 0,不是 air 的调色板 id) | 调色板无 air 项,0 会指向第一个非 air 方块 |
| 调色板条目 | `{name, states?}`;无属性时**省略** `states` | 写空 compound 或加 `version` 都可能与游戏导出不一致 |
| 状态值类型 | bool 字符串 → **Byte**,纯数字 → **Int**,其余 → String | 数值状态写 String ⇒ 导入失败(见下) |

- **状态值重定型是重中之重**(2026-09-24 修,engine `faa4301`):解析侧把 Byte 读成 `"true"`、Int 读成 `"3"`(全是字符串),导出侧 `bedrock_state_value` 负责写回正确类型。digits 判定曾是 `p != s`——无符号值(绝大多数 `facing_direction`/`direction`/`age`)在跳过符号位前 p 不动,判定恒 false,**正数全部落 String**,只有 `-1` 这种带符号的侥幸写对;`true/false` 分支不受影响所以 Byte 一直是对的,导致问题隐蔽。修法:`digits = *p != '\0'`。
- **roundtrip 测试抓不到这类错**:reader→writer 一圈字符串形态自洽,必须 wire 级断言 tag 类型(`test_export.cpp` 的 `export_mcstructure_state_value_types`)。
- 内存序:Bedrock `x*(sy*sz) + y*sz + z`(z 最快);引擎 IR 是 `y*sx*sz + z*sx + x`(x 最快),导出时重排。
- 输出为未压缩 LE-NBT,大结构膨胀 8~24 倍;体积上限守卫(>0x7FFFFFF0 格)会拒转,wasm 下超大文档也可能 OOM abort——都是文档化的预期路径。

## 二、BDX 解析

- **Place\* 指令不推进光标**,只有坐标指令(8/14/16/15/17/19 等)移动——真实 BDX 的空隙就是空隙,不要"压缩"几何。
- **操作数大端,NBT 载荷小端**(BE 头 + LE NBT 混合)。
- **属性名和值都带引号**:真实 BDX 写 `"k"=v`,解析时(`parse_bdx_block_key`)键和值统一剥引号,canonical 键才对得上 bake 表/Java 拼写(engine `842602c`)。导出侧(`encode_bdx`,export.cpp)按同样引号风格重写后缀(`"k"="v"`),解析时再剥一遍——roundtrip canonical 一致。
- runtime-id 池(31/32/33/34):rid ≥ 7684 → `minecraft:unknown_runtime_N` 兜底;legacy data 走 kLegacyNames/kLegacyStates 二分。
- op 26/27/34/35/36 命令方块数据、op 40/41 NBT 载荷**已保留**(2026-09-24 起):命令块字段合成 `block_entity_data` 形状的 NBT、op41 LE-NBT 解析成 DOM,统一按放置格键入 `Region.block_entities`;导出侧回写(见"二点五")。**op37 箱子内容物仍跳过**——箱子格和格子存在,但容器内的物品栏不保留,这是已知限制。
- op41 载荷带 `{block_entity_data:{…}}` 包装时解析侧**自动解包**(与 mcstructure 解析一致);空 compound 原样保留不丢弃。
- **放置键 id 会超 u16**(2026-09-24 修,engine `b2c7e1f`):真实 BDX 放置次数轻松破 65535,zc.bdx 138 万次放置使 `Placement.key`/`place()` 里的 `u16 id` 回绕,后段全部错指调色板(pal 586→29、nether_brick_fence 整个丢失、后续 id 移位)。解析端两次都是"流本身完美、解析结果烂",gen7 光标走读证明写侧 0 diff 后才定位到这个回绕。**教训:与放置/键索引相关的计数一律 u32。**

## 二点五、BDX 导出(encode_bdx)

- 线格式:`BD@` + Brotli;载荷 = u32be `BDX\0` + 作者 cstr + op 流;**全部操作数大端**;op 1 常量串池(ids 从 0),op 5 {u16be nameId, u16be statesId} → key = pool[b]+pool[s](suffix 为 `["k"="v"]` 引号风格,无属性时为空串);放置前显式坐标增量(y→z→x 走查,air 跳过),窄化:±1→14..19,|d|≤127→i8 28..30,≤32767→i16be 20/22/24,否则 i32be 21/23/25;88+69 收尾。
- **origin 丢失是格式固有**:BDX 无 origin 槽位,重解析基点恒 (0,0,0),包围盒 = 已放置块 min/max(空边界层收缩)。`export_bdx_roundtrip` 测试因此单独断言 rb.origin == Vec3i(),不与其他格式共用 check_documents_equal。
- **方块实体经 op41 保留**(2026-09-24 起):`Region.block_entities` 每格发射一条 op41(0x0a + u16le 根名长 + 空根名 + compound 体,即 `write_named` 空名——与 JS 桥写法同形),内容为 `{block_entity_data:{…}}` 包装;解析侧见到该包装自动解包。**Skipper 必须跳过根名**:NbtSkipper 曾只读根名长度不 skip 字节,根名非空时全盘错位报 "bad cmd-41 NBT";发射端用 `write_payload` 会漏掉自身 0x0a+名字头,两端曾同时错又恰好互相掩盖——wire 级断言(`export_bdx_wire_envelope`,47 字节手验序列)是唯一能同时抓住两端的方法。
- mcstructure 导出**回写 block_position_data**:`Region.block_entities` 键 = Bedrock mem 序十进制串(`lx*sz*sy + ly*sz + lz`,z 最快),值 = `{block_entity_data:{…}}` 包装 compound,挂在 `palette.default` 下。**这是 Skyscape 问题的修复**:此前 BDX→mcstructure 不写该字段,游戏导入直接失败(4867 个命令块全丢)。
- 调色板去重:名字与状态后缀拆成两个常量串池 id,同串复用;调色板中**未被放置的条目不会出现在输出里**(daisy_bell pal 18→7,canonical 逐格全等,属预期)。

## 三、Java ↔ 基岩转换

- Java 方块属性落到基岩:布尔型写 Byte(`in_wall_bit=true`),枚举数字写 Int(`facing_direction=5`),文本枚举写 String(`stone_type=diorite_smooth`/`color=white`)。已在 ma.bdx、mcworld、litematic 三个来源验证属性名干净(无 waterlogged/axis 泄漏)。
- legacy data(数字元数据)→ 基岩属性:走 data2bck 表,例 rt 412/413 → `birch_fence_gate[direction=0/1,...]`,rt 500 → `blackstone_wall[...]`。
- `.schematic`(MCEdit 旧版)**不支持**,页面文案"旧版 .schematic 暂不支持"是预期行为;`.schem`、`.litematic`、`.mcstructure`、`.bdx`、`.wsmr`、`mcworld/mcpack/mcaddon/zip/.mca` 都支持。
- 多区域文档:litematic 保留全部区域;mcstructure/schem/wsmr/bdx 只取**第一个区域**。
- 世界容器(mcworld/db)只作解析输入:按全部区块包围盒展开,取第 1 个区域。文件名带 `名称@[x1,y1,z1]~[x2,y2,z2]` 约定时(index.html 的 CROP_RE)只转该包围盒、输出名取 `@` 前部分。**裁剪坐标一律向外对齐到 16 的区块边界**(min 三轴向下取整、max 三轴取到块尾 15,`parseCropName` 里做),如 `[-280,-64,-250]~[250,200,250]` 实际裁 [-288,-64,-256]~[255,207,255]——世界按 16³ 子区块存取,箱子边切在子区块中间会因展开取整丢边(最顶层缺一截就是 y=200 落在子区块 12 中间)。这不是可选优化:子区块是 db/ 的最小存取粒度,不对齐就必然丢边。

## 三点五、mcworld db/(LevelDB)——journal 不读就丢一整条竖带(2026-09-24 修)

- **症状**:zhucheng.mcworld 转出的 bdx X 方向被裁掉一段(376 格 vs 预期 ~531),但游戏直接导入同一 mcworld 结构完整。
- **根因**:基岩世界的 db/ 是 LevelDB,结构方块数据按 SubChunkPrefix(tag 47)键存;**未刷盘的 memtable 在 `db/*.log`(write-ahead journal)里**,游戏导入时会重放。引擎此前只走查 `db/*.ldb`,zhucheng 世界 x 子区 6..15(世界 x 96..255)的全部 8750 条子区块**只存在于 000002.log**——不重放 journal,这整条竖带就无声消失,且包围盒裁剪后"看起来只是小了一圈",非常隐蔽。
- **journal 格式三层**:32KiB 块 + 记录头(crc u32 + len u16 + type u8;FULL/FIRST/MIDDLE/LAST 分片重组)→ WriteBatch `[8B seq][4B count]` + 条目;**删除条目 type=0 没有 vlen**(只有 `[type][varint klen][key]`),put 才有 `[varint vlen][value]`——按 put 形状解析 delete 会把后面的批次全部错位。
- **journal 键是 10 字节** `[x i32le][z i32le][tag 47@8][y i8@9]`(无维度、无 revision 后缀),与 .ldb 里的 14/18 字节键都不同;解析 Y 必须**跳过偏移 8 的 tag 字节**——曾直接 `read_u8` 把 tag(47)读成 Y,墓碑键 (0,0,47) 永远匹配不上 (0,0,0),删除重放失效且无任何报错。
- **重放语义**:journal 编号升序逐个重放;put 覆盖同键 .ldb 记录(memtable 更新),delete 抹掉同键 .ldb 子区块。MANIFEST(编号最大的)的 VersionEdit(Tag7/Tag6)决定活表集,MANIFEST 不可读退化为全表。
- **分片重组的坑(同日二修)**:读完 journal 后仍缺带,这次是 walk 的分片重组用 `pending.empty()` 判断"是否有进行中的分片链"——真实世界在 32KiB 块边界出现**零长度 FIRST 片**(payload len=0,记录体全在后续块),`pending.assign(空)` 后向量仍为 empty,下个块的 LAST 被误判 `LAST without FIRST`,**walk 直接 return,断点之后的 ~8198 条(x 子区 6..15)全部无声丢弃**。修法:独立 `in_fragment` 布尔跟踪链状态。教训:分片/状态机类循环,状态标志不要复用容器非空语义。
- **教训**:"游戏能读而引擎不能"的输入,优先怀疑引擎少读了某类文件(db/*.log、嵌套容器条目),而不是文件本身有问题;`.ldb` 键覆盖范围只是下界。

## 四、wasm 核心 C ABI

- `core_convert(data,size,int out_fmt)`:格式码 **0=mcstructure 1=litematic 2=schem 3=wsmr 4=bdx**;`char*` 形参编组不稳,必须 int。
- `core_convert_crop(data,size,out_fmt,const int32_t* min6)`:min6 = {x1,y1,z1,x2,y2,z2} **世界坐标**含端点裁剪箱;解析后取第 1 个区域裁剪、重定 origin 到箱角,再编码;>220M 格拒转。配合 mcworld 文件名约定(worker.js 传 min6,裁剪箱指针 malloc 在 wasm 堆上、i32×6)。
- `mcstruct_region_info(..., palette_size*, block_count*)`:**block_count = r.blocks.size() = 体积**(含 air),不是非空数——`core_wasm.cpp` 的 OOM 守卫依赖这个语义,测试和调用方都别想当然改成非空数。
- `_core_convert` **不设置** g_region/g_have(那是 `_core_load`/查看器路径的事),两个入口不要混用假设。
- 错误串:worker 里手动扫 `HEAPU8` 的 C 字符串。
- **C++ 语法坑:`using nbt = mcstruct::nbt;` 无效**(2026-09-24 修)——using 别名不能指向 namespace,gcc/clang 都拒;必须写 `namespace nbt = mcstruct::nbt;`。报错信息(`NbtTag`/`TagType` 找不到)完全不指向语法本身,别怀疑工具链。
- **place_nbt 与 place 必须严格同步**:`place()` lambda 内 `emplace_back()` 一格一节点,声明必须在 lambda **之前**(lambda 捕获引用);op26 修饰的是"光标处上一次放置",靠 `placements.back()` 坐标比对。
- **op41 wire 形状(两端必须一致)**:载荷 = **完整命名标签**(空根名):`0x0a + u16le 根名长 + 根名 + compound 体 + 0x00`。导出端用 `write_named(slot, nw, /*little_endian=*/true)`(slot 名为空)——`write_payload` 只写子项、缺自身 0x0a+名字头;解析端 NbtSkipper 的 `compound_total` **必须 skip 根名字节**(曾只读长度不 skip,空根名时侥幸通过、非空根名全盘错位报 "bad cmd-41 NBT")。两端曾同时错又恰好互相"抵消"成能跑的样子,wire 级断言(`export_bdx_wire_envelope`,47 字节手验序列)才能同时抓住。
- `core_wasm.cpp` **没有** `mcstruct::` 的 i32/u32 短别名(那是 libs/structure 的 core types),该 TU 里写 `i32` 会 wasm 构建挂(engine `3635734`)——用 `int32_t/uint32_t`。

## 五、构建与测试

- 本地 MSVC:`build-win\libs\structure\tests\mcstruct_tests.vcxproj`(MSBuild),exe 在 `build-win\libs\structure\tests\Debug\`。**直接跑 exe 必须 `BDX_SAMPLE_DIR=$(pwd)/samples`**,否则 3 个 BDX fixture 测试误报 `!bytes.empty()`;ctest 会自动设。
- Kali(root@192.168.169.132,emcc 环境):`scripts/kali_test.ps1 -Mode both`(push 到 bare 仓库 `/root/wasm-render.git` 并重建 `/root/build/wasm-structure-render`)。产物 `build-wasm/src/app/core.js+core.wasm`,部署 = 拷进站点 `structure-convertor/` 与 `structure-viewer/` **两处**。
- BDX fixture 由 `tools/gen_bdx_fixtures.py` 生成(python + brotli 模块,本地可跑);`--dump` 只读不写。
- **Kali 上改源码后必须确认 TU 真的重编了**:`git pull` 后 mtime 竞态可能让 ctest 跑旧二进制,`touch` 相关 .cpp 再 build 一次。

## 六、排查方法论(这次 ma.bdx 的教训)

1. 先拿游戏自己导出的文件做字节级参照(根序/tag 类型/空格表示),再逐字段 diff。
2. 怀疑 wasm 行为不对时,**先确认站点部署的核心和引擎 HEAD 一致**(比对 wasm 字节 hash),stale 部署会把引擎已修的问题重新"复现"出来。
3. 最小化复现:手工构造 3 指令 BDX(op1 const + op5/7 place + op88 term)比反复转大文件快得多。
4. 类型错误在"解析→再编码"往返里不可见,断言要落在 wire 字节上。
