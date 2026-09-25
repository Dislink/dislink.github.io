'use strict';
/* nbt-core.js — NBT 二进制读写(大端/小端)、SNBT 解析与序列化、gzip/zlib 流处理
   所有解析均在浏览器本地完成,不上传任何数据。 */
/* ================= UTF-8 编解码 ================= */
const _td = new TextDecoder('utf-8');
const _te = new TextEncoder();
function utf8Decode(bytes){ return _td.decode(bytes); }
function utf8Encode(s){ return _te.encode(s); }

/* ================= 通用小工具 ================= */
function escapeHtml(s){
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function fmtBytes(n){
    n = Number(n) || 0;
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1024 / 1024).toFixed(2) + ' MB';
}
/* 把任意整数按目标位宽截断(保留低位,符号扩展) */
function truncTo(v, bits){
    let n = typeof v === 'bigint' ? v : BigInt(Math.trunc(Number(v) || 0));
    const mod = 1n << BigInt(bits);
    n = ((n % mod) + mod) % mod;
    if (n >= mod >> 1n) n -= mod;
    return n;
}

/* ================= NBT 常量与数据模型 =================
   节点: { type:1-12, name:string, value }
   Byte/Short/Int/Float/Double -> number; Long -> BigInt
   String -> string
   ByteArray/IntArray/LongArray -> { arr: TypedArray }
   List -> { items:[node...], elemType }
   Compound -> { children:[node...] }
   T_BOOL(13) 为内部布尔类型(值 0/1),导出时按 Byte 处理
================================================== */
const TAG_NAMES = ['End','Byte','Short','Int','Long','Float','Double','ByteArray','String','List','Compound','IntArray','LongArray'];
const TAG_CN = {1:'字节',2:'短整型',3:'整型',4:'长整型',5:'浮点',6:'双精度',7:'字节数组',8:'字符串',9:'列表',10:'复合',11:'整型数组',12:'长整型数组'};
const SP_CLASSES = {1:'sp-byte',2:'sp-short',3:'sp-int',4:'sp-long',5:'sp-float',6:'sp-double',7:'sp-bytearray',8:'sp-string',9:'sp-list',10:'sp-compound',11:'sp-intarray',12:'sp-longarray'};
const T_BOOL = 13; // 内部类型:布尔(Byte 的 0/1)

function deepCopyNode(n){
    const c = { type: n.type, name: n.name };
    if (n.type === T_BOOL || (n.type >= 1 && n.type <= 6) || n.type === 8) c.value = n.value;
    else if (n.type === 7 || n.type === 11 || n.type === 12){
        const a = n.value.arr;
        c.value = { arr: n.type === 12 ? BigInt64Array.from(a) : (n.type === 11 ? Int32Array.from(a) : Int8Array.from(a)) };
    }
    else if (n.type === 9) c.value = { items: n.value.items.map(deepCopyNode), elemType: n.value.elemType };
    else if (n.type === 10) c.value = { children: n.value.children.map(deepCopyNode) };
    return c;
}

/* ================= 二进制读取 ================= */
class NbtReader {
    constructor(bytes, le){
        this.b = bytes;
        this.p = 0;
        this.le = le;
    }
    _need(n){
        if (this.p + n > this.b.length) throw new Error('数据提前结束(偏移 ' + this.p + ',需要 ' + n + ' 字节)');
    }
    u8(){
        this._need(1);
        return this.b[this.p++];
    }
    u16(){
        this._need(2);
        const v = this.le ? (this.b[this.p] | (this.b[this.p+1] << 8))
                          : ((this.b[this.p] << 8) | this.b[this.p+1]);
        this.p += 2;
        return v;
    }
    i16(){
        const v = this.u16();
        return v >= 0x8000 ? v - 0x10000 : v;
    }
    u32(){
        this._need(4);
        let v;
        if (this.le) v = (this.b[this.p] | (this.b[this.p+1] << 8) | (this.b[this.p+2] << 16)) + this.b[this.p+3] * 0x1000000;
        else         v = (this.b[this.p+3] | (this.b[this.p+2] << 8) | (this.b[this.p+1] << 16)) + this.b[this.p] * 0x1000000;
        this.p += 4;
        return v;
    }
    i32(){
        const v = this.u32();
        return v >= 0x80000000 ? v - 0x100000000 : v;
    }
    i64(){
        this._need(8);
        const b = this.b, p = this.p;
        let v = 0n;
        if (this.le){
            for (let i = 7; i >= 0; i--) v = (v << 8n) | BigInt(b[p + i]);
        } else {
            for (let i = 0; i < 8; i++) v = (v << 8n) | BigInt(b[p + i]);
        }
        this.p += 8;
        if (v >= 0x8000000000000000n) v -= 0x10000000000000000n;
        return v;
    }
    f32(){
        this._need(4);
        const v = new DataView(this.b.buffer, this.b.byteOffset + this.p, 4).getFloat32(0, this.le);
        this.p += 4;
        return v;
    }
    f64(){
        this._need(8);
        const v = new DataView(this.b.buffer, this.b.byteOffset + this.p, 8).getFloat64(0, this.le);
        this.p += 8;
        return v;
    }
    string(){
        const len = this.u16();
        this._need(len);
        const raw = this.b.subarray(this.p, this.p + len);
        this.p += len;
        return utf8Decode(raw);
    }
    payload(type, depth){
        if (depth > 512) throw new Error('嵌套深度超过 512');
        switch (type){
            case 1: {
                const v = this.b[this.p++];
                return v >= 0x80 ? v - 0x100 : v; // 有符号字节,保留真实数据(0/1 不特殊化)
            }
            case 2: return this.i16();
            case 3: return this.i32();
            case 4: return this.i64();
            case 5: return this.f32();
            case 6: return this.f64();
            case 7: {
                const len = this.i32();
                if (len < 0) throw new Error('负长度的字节数组');
                this._need(len);
                const raw = this.b.subarray(this.p, this.p + len);
                this.p += len;
                return { arr: new Int8Array(raw.slice().buffer) };
            }
            case 8: return this.string();
            case 9: {
                const elemType = this.u8();
                const count = this.i32();
                if (count < 0) throw new Error('负长度的列表');
                const items = [];
                for (let i = 0; i < count; i++) items.push({ type: elemType, name: '', value: this.payload(elemType, depth + 1) });
                return { items, elemType };
            }
            case 10: {
                const children = [];
                for (;;){
                    const t = this.u8();
                    if (t === 0) break;
                    const name = this.string();
                    children.push({ type: t, name, value: this.payload(t, depth + 1) });
                }
                return { children };
            }
            case 11: {
                const len = this.i32();
                if (len < 0) throw new Error('负长度的整型数组');
                this._need(len * 4);
                const out = new Int32Array(len);
                for (let i = 0; i < len; i++) out[i] = this.i32();
                return { arr: out };
            }
            case 12: {
                const len = this.i32();
                if (len < 0) throw new Error('负长度的长整型数组');
                this._need(len * 8);
                const out = new BigInt64Array(len);
                for (let i = 0; i < len; i++) out[i] = this.i64();
                return { arr: out };
            }
            default: throw new Error('未知标签类型 ' + type);
        }
    }
}

function parseNbt(bytes, le){
    const r = new NbtReader(bytes, le);
    const t = r.u8();
    if (t !== 10) throw new Error('根标签必须是 Compound(实际为 ' + (TAG_NAMES[t] || t) + ')');
    const rootName = r.string();
    const value = r.payload(10, 0);
    return { type: 10, name: rootName, value };
}

/* ================= 二进制写入 ================= */
class NbtWriter {
    constructor(){ this.chunks = []; this.len = 0; }
    push(b){ const u = b instanceof Uint8Array ? b : new Uint8Array(b); this.chunks.push(u); this.len += u.length; }
    u8(v){ this.push([v & 0xff]); }
    i16(v){ v = v < 0 ? v + 0x10000 : v|0; this.push([(v >> 8) & 0xff, v & 0xff]); }
    i32(v){ v = v < 0 ? v + 0x100000000 : (v >>> 0); this.push([(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff]); }
    i64(v){
        let x = BigInt(v);
        if (x < 0n) x += 0x10000000000000000n;
        const hi = Number(x >> 32n) >>> 0, lo = Number(x & 0xffffffffn) >>> 0;
        this.push([(hi >>> 24) & 0xff, (hi >>> 16) & 0xff, (hi >>> 8) & 0xff, hi & 0xff,
                   (lo >>> 24) & 0xff, (lo >>> 16) & 0xff, (lo >>> 8) & 0xff, lo & 0xff]);
    }
    f32(v){
        const buf = new ArrayBuffer(4);
        new DataView(buf).setFloat32(0, v, false);
        this.push(new Uint8Array(buf));
    }
    f64(v){
        const buf = new ArrayBuffer(8);
        new DataView(buf).setFloat64(0, v, false);
        this.push(new Uint8Array(buf));
    }
    str(s){
        const u = utf8Encode(s);
        this.push([(u.length >> 8) & 0xff, u.length & 0xff]);
        this.push(u);
    }
    shortStrLen(n){ this.push([(n >> 8) & 0xff, n & 0xff]); }
    bytes(){
        const out = new Uint8Array(this.len);
        let o = 0;
        for (const c of this.chunks){ out.set(c, o); o += c.length; }
        return out;
    }
}

class NbtWriterLE {
    constructor(){ this.chunks = []; this.len = 0; }
    push(b){ b = b instanceof Uint8Array ? b : new Uint8Array(b); this.chunks.push(b); this.len += b.length; }
    u8(v){ this.push([v & 0xff]); }
    i16(v){ v = v < 0 ? v + 0x10000 : v|0; this.push([v & 0xff, (v >> 8) & 0xff]); }
    i32(v){ v = v < 0 ? v + 0x100000000 : (v >>> 0); this.push([v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff]); }
    i64(v){
        let x = BigInt(v);
        if (x < 0n) x += 0x10000000000000000n;
        const lo = Number(x & 0xffffffffn) >>> 0, hi = Number(x >> 32n) >>> 0;
        this.push([lo & 0xff, (lo >>> 8) & 0xff, (lo >>> 16) & 0xff, (lo >>> 24) & 0xff,
                   hi & 0xff, (hi >>> 8) & 0xff, (hi >>> 16) & 0xff, (hi >>> 24) & 0xff]);
    }
    f32(v){
        const buf = new ArrayBuffer(4);
        new DataView(buf).setFloat32(0, v, true);
        this.push(new Uint8Array(buf));
    }
    f64(v){
        const buf = new ArrayBuffer(8);
        new DataView(buf).setFloat64(0, v, true);
        this.push(new Uint8Array(buf));
    }
    str(s){
        const u = utf8Encode(s);
        this.push([u.length & 0xff, (u.length >> 8) & 0xff]);
        this.push(u);
    }
    shortStrLen(n){ this.push([n & 0xff, (n >> 8) & 0xff]); }
    bytes(){
        const out = new Uint8Array(this.len);
        let o = 0;
        for (const c of this.chunks){ out.set(c, o); o += c.length; }
        return out;
    }
}

/* 数值解析与范围钳制(编辑输入用) */
function parseIntBig(s){
    s = String(s).trim().replace(/_/g, '');
    if (!s) throw new Error('空值');
    // 允许类型后缀(b/s/i/l/L…),但剩余部分必须本身是完整整数,避免误吃 0xAB 的 B
    const m = s.match(/^([-+]?(?:0[xX][0-9a-fA-F]+|0[bB][01]+|[0-9]+))([bBsSiIlL])?$/);
    if (!m) throw new Error('无法解析为整数: "' + s + '"');
    const body = m[1];
    const neg = body[0] === '-';
    const d = body.replace(/^[-+]/, '');
    const v = BigInt(d); // BigInt 支持 0x / 0b 前缀
    return neg ? -v : v;
}
function parseNumber(s){
    s = String(s).trim().replace(/_/g, '');
    if (!s) throw new Error('空值');
    let m;
    if ((m = s.match(/^([-+]?)(0[xX][0-9a-fA-F]+|0[bB][01]+)$/))){
        const v = m[2].toLowerCase().startsWith('0x') ? parseInt(m[2], 16) : parseInt(m[2].slice(2), 2);
        return m[1] === '-' ? -v : v;
    }
    const v = Number(s);
    if (Number.isNaN(v)) throw new Error('无法解析为数字: "' + s + '"');
    return v;
}
function clampInt(v, lo, hi, label){
    v = BigInt(v);
    if (v < lo || v > hi) throw new Error(label + ' 超出范围 [' + lo + ', ' + hi + ']: ' + v);
    return v;
}
/* 把节点值(可能是 BigInt/number/字符串)转为受范围约束的整数 */
function intOf(node, lo, hi, label){
    let v;
    try { v = parseIntBig(node.value); }
    catch(e){ v = BigInt(Math.trunc(Number(parseNumber(node.value))) || 0); }
    return clampInt(v, lo, hi, label);
}

function writePayload(w, node, le){
    switch (node.type){
        case 1: // Byte — 保留完整 8 位有符号值
            w.u8(Number(intOf(node, -128n, 127n, 'Byte')) & 0xff);
            break;
        case 13: // Boolean — 导出为 Byte 的 0/1
            w.u8(Number(node.value) ? 1 : 0);
            break;
        case 2: w.i16(Number(intOf(node, -0x8000n, 0x7fffn, 'Short'))); break;
        case 3: w.i32(Number(intOf(node, -0x80000000n, 0x7fffffffn, 'Int'))); break;
        case 4: w.i64(intOf(node, -(2n**63n), 2n**63n - 1n, 'Long')); break;
        case 5: w.f32(Number(node.value) || 0); break;
        case 6: w.f64(Number(node.value) || 0); break;
        case 7: {
            const a = node.value.arr;
            w.i32(a.length);
            const u = new Uint8Array(a.length);
            for (let i = 0; i < a.length; i++) u[i] = a[i] & 0xff;
            w.push(u);
            break;
        }
        case 8: {
            const u = utf8Encode(String(node.value));
            w.shortStrLen(u.length); // 按各自字节序写 2 字节长度
            w.push(u);
            break;
        }
        case 9: {
            const items = node.value.items;
            let et = node.value.elemType;
            if (!items.length) et = 0;
            else if (!et) et = items[0].type === T_BOOL ? 1 : items[0].type;
            w.u8(et);
            w.i32(items.length);
            for (const it of items) writePayload(w, { type: et, value: it.value }, le);
            break;
        }
        case 10: {
            for (const c of node.value.children){
                w.u8(c.type === T_BOOL ? 1 : c.type);
                w.str(c.name);
                writePayload(w, c, le);
            }
            w.u8(0);
            break;
        }
        case 11: {
            const a = node.value.arr;
            w.i32(a.length);
            for (let i = 0; i < a.length; i++){
                let v;
                try { v = clampInt(BigInt(a[i]), -0x80000000n, 0x7fffffffn, 'IntArray 元素'); }
                catch(e){ v = BigInt(Math.trunc(Number(a[i]))|0); }
                w.i32(Number(v));
            }
            break;
        }
        case 12: {
            const a = node.value.arr;
            w.i32(a.length);
            for (let i = 0; i < a.length; i++){
                let v;
                try { v = clampInt(BigInt(a[i]), -(2n**63n), 2n**63n - 1n, 'LongArray 元素'); }
                catch(e){ v = BigInt(Math.trunc(Number(a[i]))|0); }
                w.i64(v);
            }
            break;
        }
        default: throw new Error('未知类型 ' + node.type);
    }
}

/* 写入器分派:str 方法在两个 writer 中均按各自字节序写长度 */
function writeNbt(root, le){
    const w = le ? new NbtWriterLE() : new NbtWriter();
    w.u8(10);
    w.str(root.name || '');
    writePayload(w, root, le);
    return w.bytes();
}

function writeMcstructure(root){
    // .mcstructure = 未压缩小端 NBT
    return writeNbt(root, true);
}

/* ================= SNBT 解析器 =================
   支持:类型后缀 b/B s/S l/L f/F d/D、true/false、0x/0b、下划线分隔、
   引号字符串(双/单引号,转义)、无引号字符串、[B;...] [I;...] [L;...] 数组、
   列表尾逗号、{}/{[]} 嵌套。
================================================== */
class SnbtParser {
    constructor(text){
        this.s = text;
        this.i = 0;
        this.n = text.length;
    }
    error(msg){
        const line = this.s.slice(0, this.i).split('\n').length;
        const col = this.i - this.s.lastIndexOf('\n', this.i - 1);
        throw new Error('SNBT 解析错误(行 ' + line + ',列 ' + col + '): ' + msg);
    }
    skipWs(){
        while (this.i < this.n && /\s/.test(this.s[this.i])) this.i++;
    }
    peek(){ return this.i < this.n ? this.s[this.i] : ''; }
    eof(){ return this.i >= this.n; }
    expect(c){
        this.skipWs();
        if (this.peek() !== c) this.error('期望 "' + c + '" 但得到 "' + this.peek() + '"');
        this.i++;
    }
    parseRoot(){
        this.skipWs();
        const v = this.parseValue(0);
        this.skipWs();
        if (!this.eof()) this.error('SNBT 结尾有多余内容: "' + this.s.slice(this.i, this.i + 20) + '…"');
        return v;
    }
    parseValue(depth){
        if (depth > 512) this.error('嵌套过深');
        this.skipWs();
        const c = this.peek();
        if (c === '{') return this.parseCompound(depth);
        if (c === '[') return this.parseArrayOrList(depth);
        if (c === '"' || c === "'") return { type: 8, value: this.parseQuoted() };
        return this.parseUnquoted();
    }
    parseCompound(depth){
        this.expect('{');
        const children = [];
        this.skipWs();
        if (this.peek() === '}'){ this.i++; return { type: 10, value: { children } }; }
        for (;;){
            this.skipWs();
            let name;
            const c = this.peek();
            if (c === '"' || c === "'") name = this.parseQuoted();
            else {
                name = this.readUnquoted();
                if (!name) this.error('复合标签缺少键名');
            }
            this.skipWs();
            if (this.peek() === ':'){ this.i++; }
            else this.error('键名 "' + name + '" 后缺少 ":"');
            const v = this.parseValue(depth + 1);
            children.push({ type: v.type, name, value: v.value });
            this.skipWs();
            const d = this.peek();
            if (d === ','){ this.i++; continue; }
            if (d === '}'){ this.i++; break; }
            this.error('复合标签中缺少 "," 或 "}"(得到 "' + d + '")');
        }
        return { type: 10, value: { children } };
    }
    parseArrayOrList(depth){
        this.expect('[');
        this.skipWs();
        // 数组前缀 [B; [I; [L;
        let arrType = 0;
        if (this.peek() === 'B' && this.s[this.i + 1] === ';'){ arrType = 1; this.i += 2; }
        else if (this.peek() === 'I' && this.s[this.i + 1] === ';'){ arrType = 3; this.i += 2; }
        else if (this.peek() === 'L' && this.s[this.i + 1] === ';'){ arrType = 4; this.i += 2; }
        if (arrType){
            const vals = [];
            this.skipWs();
            if (this.peek() === ']'){ this.i++; return { type: arrType === 1 ? 7 : arrType === 3 ? 11 : 12, value: { arr: vals } }; }
            for (;;){
                this.skipWs();
                const t = this.parseNumberToken();
                vals.push(t);
                this.skipWs();
                const d = this.peek();
                if (d === ','){ this.i++; continue; }
                if (d === ']'){ this.i++; break; }
                this.error('数组中缺少 "," 或 "]"(得到 "' + d + '")');
            }
            let arr;
            if (arrType === 1) arr = Int8Array.from(vals.map(Number));
            else if (arrType === 3) arr = Int32Array.from(vals.map(Number));
            else arr = BigInt64Array.from(vals.map(BigInt));
            return { type: arrType === 1 ? 7 : arrType === 3 ? 11 : 12, value: { arr } };
        }
        // 列表
        const items = [];
        let elemType = 0;
        this.skipWs();
        if (this.peek() === ']'){ this.i++; return { type: 9, value: { items, elemType: 0 } }; }
        for (;;){
            const v = this.parseValue(depth + 1);
            if (items.length === 0) elemType = v.type;
            else if (elemType !== v.type && !(elemType <= 6 && v.type <= 6 && elemType !== 5 && v.type !== 5)){
                // 允许整数族混用(Java 版 SNBT 行为);浮点混入整数则升级为浮点
                if (elemType !== 5 && v.type === 5) elemType = 5;
                else if (elemType === 5 && v.type <= 6) { /* 保持浮点 */ }
                else if (elemType <= 4 && v.type <= 4) { /* 整数族:保持 */ }
                else this.error('列表元素类型不一致(' + TAG_NAMES[elemType] + ' vs ' + TAG_NAMES[v.type] + ')');
            }
            else if (elemType <= 4 && v.type <= 4){ /* 整数族混用 */ }
            items.push({ type: v.type, name: '', value: v.value });
            this.skipWs();
            const d = this.peek();
            if (d === ','){ this.i++; continue; }
            if (d === ']'){ this.i++; break; }
            this.error('列表中缺少 "," 或 "]"(得到 "' + d + '")');
        }
        // 列表里全部是复合/列表时 elemType 正确;整数族混用时统一
        if (items.length && items.every(it => it.type === elemType)){
            // 保持
        } else if (items.length && items.every(it => it.type <= 4 && it.type >= 1)){
            // 统一升级为 Int(与 Java 一致的做法是保留为 Int 列表;这里保守取最大宽度)
            elemType = Math.max(...items.map(it => it.type === T_BOOL ? 1 : it.type));
            if (elemType < 1) elemType = 1;
        }
        return { type: 9, value: { items, elemType: elemType || 1 } };
    }
    parseQuoted(){
        const q = this.s[this.i++];
        let out = '';
        for (;;){
            if (this.i >= this.n) this.error('字符串未闭合');
            const c = this.s[this.i++];
            if (c === q) break;
            if (c === '\\'){
                if (this.i >= this.n) this.error('转义符后缺少字符');
                const e = this.s[this.i++];
                switch (e){
                    case 'b': out += '\b'; break;
                    case 'f': out += '\f'; break;
                    case 'n': out += '\n'; break;
                    case 'r': out += '\r'; break;
                    case 's': out += ' '; break;
                    case 't': out += '\t'; break;
                    case '\\': out += '\\'; break;
                    case "'": out += "'"; break;
                    case '"': out += '"'; break;
                    case 'x': {
                        const h = this.s.slice(this.i, this.i + 2);
                        if (!/^[0-9a-fA-F]{2}$/.test(h)) this.error('\\x 后需要两位十六进制');
                        out += String.fromCharCode(parseInt(h, 16));
                        this.i += 2;
                        break;
                    }
                    case 'u': {
                        const h = this.s.slice(this.i, this.i + 4);
                        if (!/^[0-9a-fA-F]{4}$/.test(h)) this.error('\\u 后需要四位十六进制');
                        out += String.fromCharCode(parseInt(h, 16));
                        this.i += 4;
                        break;
                    }
                    case 'U': {
                        const h = this.s.slice(this.i, this.i + 8);
                        if (!/^[0-9a-fA-F]{8}$/.test(h)) this.error('\\U 后需要八位十六进制');
                        out += String.fromCodePoint(parseInt(h, 16));
                        this.i += 8;
                        break;
                    }
                    case 'N': {
                        // \N{name} — 不支持 named lookup,原样保留
                        if (this.s[this.i] === '{'){
                            const end = this.s.indexOf('}', this.i);
                            if (end < 0) this.error('\\N 格式错误');
                            out += this.s.slice(this.i - 2, end + 1);
                            this.i = end + 1;
                        } else out += '\\N';
                        break;
                    }
                    default: this.error('未知转义 "\\' + e + '"');
                }
            } else out += c;
        }
        return out;
    }
    readUnquoted(){
        let start = this.i;
        while (this.i < this.n && /[0-9A-Za-z_.+\-\u0080-￿]/.test(this.s[this.i])) this.i++;
        return this.s.slice(start, this.i);
    }
    parseUnquoted(){
        const tok = this.readUnquoted();
        if (!tok) this.error('意外的字符 "' + this.peek() + '"');
        return this.coerceToken(tok);
    }
    coerceToken(tok){
        // true/false
        if (tok === 'true') return { type: 13, value: 1 };
        if (tok === 'false') return { type: 13, value: 0 };
        // 类型后缀
        let m;
        // 16/2 进制整数(带或不带类型后缀)
        if ((m = tok.match(/^([-+]?)(0[xX][0-9a-fA-F]+|0[bB][01]+)([bBsSiIlL])?$/))){
            const body = m[2].replace(/_/g, '');
            const v = m[2].toLowerCase().startsWith('0x') ? BigInt(body) : BigInt('0b' + body.slice(2));
            if (m[1] === '-') v = -v;
            if (m[3]){
                const t = { b: 1, s: 2, i: 3, l: 4 }[m[3].toLowerCase()];
                return { type: t, value: v };
            }
            // 无后缀:能放进 int 就是 Int,否则 Long
            return { type: (v >= -2147483648n && v <= 2147483647n) ? 3 : 4, value: v };
        }
        if ((m = tok.match(/^([-+]?(?:[0-9][0-9_]*))([bBsSiIlL])$/))){
            const v = this.parseNumLiteral(m[1]);
            const t = { b: 1, s: 2, i: 3, l: 4 }[m[2].toLowerCase()];
            return { type: t, value: v };
        }
        if ((m = tok.match(/^([-+]?[0-9][0-9_]*)$/))){
            return { type: 3, value: this.parseNumLiteral(m[1]) };
        }
        if ((m = tok.match(/^([-+]?[0-9][0-9_]*\.[0-9_]*(?:[eE][-+]?[0-9]+)?)([fFdD])$/i)) ||
            (m = tok.match(/^([-+]?[0-9][0-9_]*\.[0-9_]*)$/))){
            const t = m[2] ? (m[2].toLowerCase() === 'f' ? 5 : 6) : 6;
            const v = Number(m[1].replace(/_/g, ''));
            if (Number.isNaN(v)) this.error('无法解析数字 "' + tok + '"');
            return { type: t, value: v };
        }
        if ((m = tok.match(/^([-+]?[0-9][0-9_]*(?:\.[0-9_]*)?(?:[eE][-+]?[0-9]+)?[fF])$/))){
            const v = Number(tok.slice(0, -1).replace(/_/g, ''));
            if (Number.isNaN(v)) this.error('无法解析数字 "' + tok + '"');
            return { type: 5, value: v };
        }
        if ((m = tok.match(/^([-+]?[0-9][0-9_]*(?:\.[0-9_]*)?(?:[eE][-+]?[0-9]+)[dD])$/))){
            const v = Number(tok.slice(0, -1).replace(/_/g, ''));
            if (Number.isNaN(v)) this.error('无法解析数字 "' + tok + '"');
            return { type: 6, value: v };
        }
        if ((m = tok.match(/^([-+]?[0-9][0-9_]*)\.([0-9_]*)$/)) || (m = tok.match(/^([-+]?[0-9][0-9_]*)(?=\.)/))){
            // "1." 或 ".5" 形式 → double(由下方通用小数分支处理)
        }
        if (/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(tok.replace(/_/g, ''))){
            const clean = tok.replace(/_/g, '');
            const v = Number(clean);
            if (Number.isNaN(v)) this.error('无法解析数字 "' + tok + '"');
            return { type: clean.includes('.') || /[eE]/.test(clean) ? 6 : 3, value: v };
        }
        // 无引号字符串
        return { type: 8, value: tok };
    }
    parseNumLiteral(s){
        s = s.replace(/_/g, '');
        if (/^[-+]?0x/i.test(s)) return BigInt(s);
        return BigInt(s);
    }
    parseNumberToken(){
        // 数组中的数字 token(允许带类型后缀)
        const start = this.i;
        while (this.i < this.n && /[0-9A-Za-z_.+\-]/.test(this.s[this.i])) this.i++;
        const tok = this.s.slice(start, this.i);
        if (!tok) this.error('数组元素缺失');
        const r = this.coerceToken(tok);
        return r.value;
    }
}

function parseSnbt(text){
    const p = new SnbtParser(text);
    const v = p.parseRoot();
    // 根需要是复合:包一层名字
    if (v.type !== 10){
        // 允许裸值 → 包成 { value: ... }? 规范要求根为复合,但宽容处理
        return { type: 10, name: '', value: { children: [{ type: v.type, name: 'value', value: v.value }] } };
    }
    return { type: 10, name: '', value: v.value };
}

/* ================= SNBT 序列化 ================= */
function snbtNeedsQuote(s){
    return !(/^[0-9A-Za-z_.+\-]*$/.test(s)) || /^[0-9.+\-]/.test(s) || s === '' ||
           s === 'true' || s === 'false';
}
function snbtQuoteString(s){
    if (!snbtNeedsQuote(s)) return s;
    let out = '"';
    for (const ch of String(s)){
        if (ch === '"' || ch === '\\') out += '\\' + ch;
        else if (ch === '\n') out += '\\n';
        else if (ch === '\r') out += '\\r';
        else if (ch === '\t') out += '\\t';
        else out += ch;
    }
    return out + '"';
}
function snbtNumber(v, type){
    switch (type){
        case 1: case 13: return v + 'b';
        case 2: return v + 's';
        case 3: return String(v);
        case 4: return v + 'L';
        case 5: {
            let s = String(v);
            if (!/[.eE]/.test(s)) s += '.0f'; else s += 'f';
            if (/e/i.test(s) && !/\./.test(s.split(/[eE]/)[0])) s = s.replace(/e/i, '.0e');
            return s;
        }
        case 6: {
            let s = String(v);
            if (!/[.eE]/.test(s)) s += '.0';
            return s;
        }
        default: return String(v);
    }
}
/* 单行 / 分行包裹数组或列表;typedOpen 形如 "[B; " */
function snbtJoined(items, open, close, nl, pad, padIn, forceFlat){
    if (!items.length) return open + close;
    const oneLine = forceFlat || !nl || items.length <= 8;
    if (oneLine) return open + items.join(', ') + close;
    return open.trimEnd() + nl + items.map(s => padIn + s).join(',' + nl) + nl + pad + close;
}
function snbtValue(node, indent, depth, flat){
    const multi = !!indent && !flat;
    const pad = multi ? '  '.repeat(depth) : '';
    const padIn = multi ? '  '.repeat(depth + 1) : '';
    const nl = multi ? '\n' : '';
    const kids = (arr, d) => arr.map(x => snbtValue(x, indent, d, true)); // 单行容器:子项一律紧凑
    switch (node.type){
        case 1: return Number(node.value) + 'b';
        case 13: return Number(node.value) ? 'true' : 'false'; // 布尔保持布尔
        case 2: case 3: case 4: case 5: case 6: return snbtNumber(node.value, node.type);
        case 7: {
            const a = node.value.arr;
            if (!a.length) return '[B;]';
            return snbtJoined(Array.from(a, x => Number(x) + 'b'), '[B; ', ']', nl, pad, padIn, flat);
        }
        case 11: {
            const a = node.value.arr;
            if (!a.length) return '[I;]';
            return snbtJoined(Array.from(a, String), '[I; ', ']', nl, pad, padIn, flat);
        }
        case 12: {
            const a = node.value.arr;
            if (!a.length) return '[L;]';
            return snbtJoined(Array.from(a, x => x + 'L'), '[L; ', ']', nl, pad, padIn, flat);
        }
        case 8: return snbtQuoteString(node.value);
        case 9: {
            const items = node.value.items;
            if (!items.length) return '[]';
            return snbtJoined(kids(items, depth + 1), '[', ']', nl, pad, padIn, flat);
        }
        case 10: {
            const ch = node.value.children;
            if (!ch.length) return '{}';
            if (!multi) return '{' + ch.map(c => snbtQuoteString(c.name) + ': ' + snbtValue(c, indent, depth + 1, true)).join(', ') + '}';
            const lines = ch.map(c => padIn + snbtQuoteString(c.name) + ': ' + snbtValue(c, indent, depth + 1, false));
            return '{' + nl + lines.join(',' + nl) + nl + pad + '}';
        }
        default: return '?';
    }
}
function toSnbt(root, indent){
    return snbtValue(root, indent, 0);
}

/* ================= 文件格式检测 ================= */
async function decompressStream(bytes, format){
    const ds = new DecompressionStream(format);
    const stream = new Blob([bytes]).stream().pipeThrough(ds);
    const buf = await new Response(stream).arrayBuffer();
    return new Uint8Array(buf);
}
async function compressStream(bytes, format){
    const cs = new CompressionStream(format);
    const stream = new Blob([bytes]).stream().pipeThrough(cs);
    const buf = await new Response(stream).arrayBuffer();
    return new Uint8Array(buf);
}

/* 嗅探输入:返回 {kind:'gzip'|'zlib'|'raw-be'|'raw-le'|'leveldat', bytes} */
function detectNbtFormat(bytes){
    if (bytes.length < 4) throw new Error('文件太小,无法识别');
    if (bytes[0] === 0x1f && bytes[1] === 0x8b) return { kind: 'gzip', bytes };
    if (bytes[0] === 0x78 && [0x01,0x5e,0x9c,0xda,0x20,0x7d,0xbb,0xf9].includes(bytes[1])) return { kind: 'zlib', bytes };
    // level.dat 基岩版头:version(int LE) + length(int LE)
    if (bytes.length > 12){
        const ver = bytes[0] | (bytes[1] << 8) | (bytes[2] << 16) | bytes[3] * 0x1000000;
        const ln = bytes[4] | (bytes[5] << 8) | (bytes[6] << 16) | bytes[7] * 0x1000000;
        if (ver === 8 || ver === 9 || ver === 10 || (bytes[8] === 0x0a && ln + 8 === bytes.length)){
            return { kind: 'leveldat', bytes: bytes.subarray(8) };
        }
    }
    if (bytes[0] === 0x0a){ // 大端 Compound
        return { kind: 'raw-be', bytes };
    }
    if (bytes[0] === 0x0a && false){} // unreachable
    // 小端:首个字节 0x0a,名字长度低字节在前;或根名为空时第 2 字节为类型
    if (bytes.length > 4){
        // BE compound + 空 root name: 0A 00 00 ...
        if (bytes[0] === 0x0a && bytes[1] === 0x00) return { kind: 'raw-be', bytes };
    }
    // 常见 LE:类型 0x0a,名字长度 LE(高字节通常 0)
    if (bytes[0] === 0x0a && bytes.length > 8 && bytes[3] === 0x00){
        return { kind: 'raw-le', bytes };
    }
    // mcstructure/leveldat LE:有时类型字节不是 0x0a(嵌套根)? 根必须是 compound,所以 0x0a
    // 尝试按小端解析
    return { kind: 'raw-le', bytes };
}

async function loadNbtFromBytes(bytes){
    const det = detectNbtFormat(bytes);
    let payload = det.bytes;
    if (det.kind === 'gzip') payload = await decompressStream(det.bytes, 'gzip');
    else if (det.kind === 'zlib') payload = await decompressStream(det.bytes, 'deflate');
    const tryParse = (le) => {
        try {
            const r = new NbtReader(payload, le);
            const t = r.u8();
            if (t !== 10) throw new Error('根标签必须是 Compound(实际为 ' + (TAG_NAMES[t] || t) + ')');
            const name = r.string();
            const value = r.payload(10, 0);
            return { root: { type: 10, name, value }, left: payload.length - r.p };
        } catch (e){ return { err: e }; }
    };
    /* 根 Compound + 空名时大小端前 3 字节完全相同(0A 00 00),sniff 无法区分,
       只能按「能否解析」以及「是否刚好读完整个缓冲区」来判定字节序 */
    const be = tryParse(false), le = tryParse(true);
    const score = (r) => r.err ? 0 : (r.left === 0 ? 2 : 1);
    const prefLe = det.kind === 'raw-le';
    const leWins = score(le) !== score(be) ? score(le) > score(be) : prefLe;
    const win = leWins ? le : be;
    if (win.err){
        throw new Error('NBT 解析失败 — 大端: ' + be.err.message + ' / 小端: ' + le.err.message);
    }
    const ambiguous = det.kind === 'raw-be' || det.kind === 'raw-le';
    return { root: win.root, kind: ambiguous ? (leWins ? 'raw-le' : 'raw-be') : det.kind, le: leWins };
}
