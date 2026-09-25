'use strict';
/* nbt-ui.js — 树视图渲染、选择/编辑、撤销重做、搜索、导入导出接线 */
/* ================= UI 状态 ================= */
let currentRoot = null;      // {type:10,name,value:{children}}
let fileMeta = null;         // {name, size, kind, le}
let selectedNode = null;
let selectedRow = null;
let searchExpand = false;    // 搜索时强制全展开
let collapseState = new WeakMap(); // 节点对象 -> 是否折叠(按标识,增删节点不错位)
const rowElMap = new WeakMap();  // node -> row element

const statusEl = document.getElementById('status');
function setStatus(s, cls){ statusEl.textContent = s; statusEl.className = 'status-bar' + (cls ? ' ' + cls : ''); }

const treeEl = document.getElementById('tree');
const searchBox = document.getElementById('searchBox');
const selInfoEl = document.getElementById('selInfo');
const snbtArea = document.getElementById('snbtArea');

/* 撤销栈 — 用结构化克隆,避免 JSON 无法处理 BigInt(TAG_Long) 与 TypedArray */
const undoStack = [];
const redoStack = [];
function cloneRoot(root){
    if (typeof structuredClone === 'function') return structuredClone(root);
    return deepCopyNode(root); // 回退(part2)
}
function pushUndo(snap){
    undoStack.push(snap);
    if (undoStack.length > 50) undoStack.shift();
    redoStack.length = 0;
}
function snapshot(){
    if (currentRoot) pushUndo(cloneRoot(currentRoot));
}
function doUndo(){
    if (!undoStack.length){ setStatus('没有可撤销的操作', 'info'); return; }
    redoStack.push(cloneRoot(currentRoot));
    currentRoot = undoStack.pop();
    selectedNode = null; selectedRow = null;
    collapseState = new WeakMap();
    renderAll();
    setStatus('已撤销', 'info');
}
function doRedo(){
    if (!redoStack.length){ setStatus('没有可重做的操作', 'info'); return; }
    undoStack.push(cloneRoot(currentRoot));
    currentRoot = redoStack.pop();
    selectedNode = null; selectedRow = null;
    collapseState = new WeakMap();
    renderAll();
    setStatus('已重做', 'info');
}

function renderAll(){
    renderTree();
    renderMeta();
    renderSelInfo();
    updateButtons();
    syncSnbt();
}

function updateButtons(){
    const has = !!currentRoot;
    ['btnExportNbtGz','btnExportNbtRaw','btnExportLe','btnExportMcstructure','btnToSnbt','btnCopySnbt']
        .forEach(id => { document.getElementById(id).disabled = !has; });
    const u = document.getElementById('btnUndo'), r = document.getElementById('btnRedo');
    if (u) u.disabled = !undoStack.length;
    if (r) r.disabled = !redoStack.length;
}

/* ================= 树渲染 ================= */
function typeName(t){ return t === T_BOOL ? 'Boolean' : (TAG_NAMES[t] || '?'); }
function typeNameCn(t){ return t === T_BOOL ? '布尔' : (TAG_CN[t] || '?'); }
function iconCls(t){ return t === T_BOOL ? 'sp-boolean' : (SP_CLASSES[t] || ''); }
function isCollapsible(node){ return node.type === 9 || node.type === 10; }
function childList(node){
    if (node.type === 10) return node.value.children;
    if (node.type === 9) return node.value.items;
    return null;
}
function valuePreview(node){
    switch (node.type){
        case 1: case 13: case 2: case 3: case 4: case 5: case 6:
            return String(node.value);
        case 7: return '[B; ' + node.value.arr.length + ' 项]';
        case 11: return '[I; ' + node.value.arr.length + ' 项]';
        case 12: return '[L; ' + node.value.arr.length + ' 项]';
        case 8: {
            const s = String(node.value);
            return '"' + (s.length > 160 ? s.slice(0, 160) + '…' : s) + '"';
        }
        default: return '';
    }
}
function arrayPreview(node){
    const a = node.value.arr;
    const n = a.length;
    const lim = 40;
    let parts = [];
    for (let i = 0; i < Math.min(n, lim); i++) parts.push(String(a[i]));
    let s = parts.join(', ');
    if (n > lim) s += ', …(共 ' + n + ' 项)';
    return s;
}

function renderTree(){
    treeEl.innerHTML = '';
    if (!currentRoot){
        treeEl.innerHTML = '<div class="tree-empty">尚未载入数据 — 上传文件或点击「载入示例」</div>';
        return;
    }
    buildTreeInto(treeEl, currentRoot, 0, '', true);
    applySearchHighlight();
}

function buildTreeInto(container, node, depth, label, canRename){
    const kids = childList(node);
    const collapsible = isCollapsible(node);

    const row = document.createElement('div');
    row.className = 'tree-row';
    if (node === selectedNode) row.classList.add('selected');

    const tw = document.createElement('span');
    tw.className = 'twisty' + (collapsible ? '' : ' leaf');
    row.appendChild(tw);

    const ic = document.createElement('span');
    ic.className = 'nbt-sprite ' + iconCls(node.type);
    ic.title = typeName(node.type);
    row.appendChild(ic);

    const nm = document.createElement('span');
    nm.className = 'tag-name';
    nm.textContent = node.name || label || '""';
    if (canRename){
        nm.title = '双击重命名';
        nm.ondblclick = (e) => { e.stopPropagation(); startEditName(node, nm); };
    } else {
        nm.style.color = 'var(--color-text-secondary)';
        nm.title = '列表元素序号(列表元素没有名字)';
    }
    row.appendChild(nm);

    const tt = document.createElement('span');
    tt.className = 'tag-type';
    tt.textContent = typeName(node.type);
    tt.title = typeNameCn(node.type);
    row.appendChild(tt);

    let childBox = null;
    if (collapsible){
        const cc = document.createElement('span');
        cc.className = 'child-count';
        cc.textContent = (kids ? kids.length : 0) + ' 项';
        if (node.type === 9) cc.textContent += ' · 元素类型 ' + typeName(node.value.elemType || 0);
        row.appendChild(cc);

        childBox = document.createElement('div');
        childBox.className = 'tree-children';
        let collapsed = searchExpand ? false
                     : (collapseState.has(node) ? collapseState.get(node) : depth >= 2); // 默认展开前两层
        const setCollapsed = (c) => {
            childBox.classList.toggle('collapsed', c);
            tw.textContent = c ? '▶' : '▼';
        };
        setCollapsed(collapsed);
        collapseState.set(node, collapsed);

        tw.onclick = (e) => {
            e.stopPropagation();
            const c = !childBox.classList.contains('collapsed');
            setCollapsed(c);
            collapseState.set(node, c);
            if (!c) renderChildren(childBox, node, depth);
        };
        if (!collapsed) renderChildren(childBox, node, depth);
    } else {
        const eq = document.createElement('span');
        eq.className = 'tag-eq';
        eq.textContent = '=';
        row.appendChild(eq);
        const vv = document.createElement('span');
        vv.className = 'tag-value editable';
        vv.textContent = valuePreview(node);
        vv.title = '双击编辑值';
        vv.ondblclick = (e) => { e.stopPropagation(); startEditValue(node, vv); };
        row.appendChild(vv);
    }

    /* 行操作 */
    const acts = document.createElement('span');
    acts.className = 'row-actions';
    acts.appendChild(mkBtn('⧉', '复制此节点', () => { snapshot(); duplicateNode(node); }));
    if (collapsible) acts.appendChild(mkBtn('+', '新增子项', () => { snapshot(); addChildTo(node); }));
    if (node !== currentRoot){
        acts.appendChild(mkBtn('↑', '上移', () => { snapshot(); moveNode(node, -1); }));
        acts.appendChild(mkBtn('↓', '下移', () => { snapshot(); moveNode(node, 1); }));
        const del = mkBtn('✕', '删除', () => { snapshot(); deleteNode(node); });
        del.classList.add('del');
        acts.appendChild(del);
    }
    row.appendChild(acts);

    row.onclick = () => selectNode(node, row);
    container.appendChild(row);
    if (childBox) container.appendChild(childBox);
    rowElMap.set(node, row);

    return { row, childBox };
}
function renderChildren(childBox, node, depth){
    childBox.innerHTML = '';
    const kids = childList(node);
    if (!kids || !kids.length){
        const hint = document.createElement('div');
        hint.className = 'tree-row';
        hint.innerHTML = '<span class="child-count" style="padding-left:1.4rem;">(空 — 悬停此行点「+」添加子项)</span>';
        childBox.appendChild(hint);
        return;
    }
    const isList = node.type === 9;
    for (let i = 0; i < kids.length; i++){
        buildTreeInto(childBox, kids[i], depth + 1, isList ? '[' + i + ']' : '', !isList);
    }
}
function mkBtn(text, title, fn){
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ra-btn';
    b.textContent = text;
    b.title = title;
    b.onclick = (e) => { e.stopPropagation(); fn(); };
    return b;
}

/* 展开/折叠全部 — 状态按节点对象记录,遍历一次即可 */
function setAllCollapsed(c){
    if (!currentRoot) return;
    searchExpand = false;
    collapseState = new WeakMap();
    (function walk(node){
        if (!isCollapsible(node)) return;
        collapseState.set(node, c);
        for (const k of childList(node) || []) walk(k);
    })(currentRoot);
    renderTree();
    setStatus(c ? '已折叠全部节点' : '已展开全部节点', 'info');
}

/* 从根到目标节点的祖先链(不含目标自身),按层级从外到内 */
function ancestorNodes(target){
    const out = [];
    const walk = (cur) => {
        if (cur === target) return true;
        if (!isCollapsible(cur)) return false;
        for (const k of childList(cur) || []){
            if (walk(k)){ out.unshift(cur); return true; }
        }
        return false;
    };
    return walk(currentRoot) ? out : null;
}
function expandAncestors(node){
    if (!currentRoot) return;
    const chain = ancestorNodes(node);
    if (!chain) return;
    let changed = false;
    for (const a of chain){ if (collapseState.get(a)){ collapseState.set(a, false); changed = true; } }
    if (changed){ searchExpand = false; renderTree(); }
}

/* 搜索 */
let searchTimer = null;
searchBox.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
        const kw = searchBox.value.trim();
        if (!!kw !== searchExpand){ // 有/无关键词时切换全展开以便看到命中项
            searchExpand = !!kw;
            renderTree();
        } else {
            applySearchHighlight();
        }
    }, 250);
});
function collectMatches(node, kw, out){
    const kids = childList(node);
    if (!kids) return;
    for (const k of kids){
        if (nodeMatches(k, kw)) out.push(k);
        collectMatches(k, kw, out);
    }
}
function nodeMatches(node, kw){
    if (node.name && node.name.toLowerCase().includes(kw)) return true;
    if (node.type === 8 && String(node.value).toLowerCase().includes(kw)) return true;
    if (node.type <= 6 && node.type !== 5 && node.type !== 6 &&
        String(node.value).toLowerCase().includes(kw)) return true;
    return false;
}
function hasMatchDeep(node, kw){
    const kids = childList(node);
    if (!kids) return false;
    for (const k of kids){
        if (nodeMatches(k, kw) || hasMatchDeep(k, kw)) return true;
    }
    return false;
}
function applySearchHighlight(){
    document.querySelectorAll('.search-hit').forEach(el => el.classList.remove('search-hit'));
    const kw = searchBox.value.trim().toLowerCase();
    if (!kw || !currentRoot) return;
    const hits = [];
    collectMatches(currentRoot, kw, hits);
    for (const h of hits){
        const row = rowElMap.get(h);
        if (row) row.classList.add('search-hit');
    }
}

/* ================= 选择 ================= */
function selectNode(node, row){
    if (selectedRow) selectedRow.classList.remove('selected');
    selectedNode = node;
    selectedRow = row || null;
    if (row) row.classList.add('selected');
    renderSelInfo();
}

function findParent(node, root, parent){
    if (root === node) return parent;
    const kids = childList(root);
    if (kids){
        for (const k of kids){
            if (k === node) return root;
            const r = findParent(node, k, root);
            if (r !== null && r !== undefined) return r;
        }
    }
    return null;
}
function indexOfNode(node, parent){
    const kids = childList(parent);
    return kids ? kids.indexOf(node) : -1;
}

function renderSelInfo(){
    if (!selectedNode){
        selInfoEl.innerHTML = '<span style="color:var(--color-text-muted);">未选中 — 点击树中的行查看详情</span>';
        return;
    }
    const n = selectedNode;
    let html = '<div style="display:grid;grid-template-columns:auto 1fr;gap:0.35rem 0.6rem;align-items:center;">';
    html += '<span class="nbt-sprite ' + iconCls(n.type) + '" style="width:20px;height:20px;background-size:80px 80px;"></span>';
    html += '<span><b>' + typeName(n.type) + '</b> <span style="color:var(--color-text-muted);font-size:0.75rem;">(' + typeNameCn(n.type) + ')</span></span>';
    html += '<span style="color:var(--color-text-secondary);">名称</span><span style="font-family:var(--font-mono);word-break:break-all;">' + escapeHtml(n.name || '(根)') + '</span>';
    if (n.type === 8){
        html += '<span style="color:var(--color-text-secondary);">内容</span><div style="font-family:var(--font-mono);font-size:0.75rem;word-break:break-all;background:var(--color-surface-alt);border:1px solid var(--color-border);border-radius:4px;padding:0.3rem 0.5rem;white-space:pre-wrap;max-height:9rem;overflow:auto;">' + escapeHtml(String(n.value)) + '</div>';
    } else if (n.type === 7 || n.type === 11 || n.type === 12){
        html += '<span style="color:var(--color-text-secondary);">长度</span><span>' + n.value.arr.length + ' 个元素</span>';
        html += '<span style="color:var(--color-text-secondary);">内容</span><div style="font-family:var(--font-mono);font-size:0.72rem;word-break:break-all;background:var(--color-surface-alt);border:1px solid var(--color-border);border-radius:4px;padding:0.3rem 0.5rem;max-height:9rem;overflow:auto;">' + escapeHtml(arrayPreview(n)) + '</div>';
        html += '<span></span><button class="tb-btn" onclick="openArrayEditorById()">打开数组编辑器</button>';
    } else if (n.type <= 6 || n.type === T_BOOL){
        html += '<span style="color:var(--color-text-secondary);">值</span><span style="font-family:var(--font-mono);word-break:break-all;">' + escapeHtml(String(n.value)) + '</span>';
    } else {
        const kids = childList(n);
        html += '<span style="color:var(--color-text-secondary);">子项</span><span>' + (kids ? kids.length : 0) + ' 个</span>';
    }
    /* 类型转换 */
    html += '<span style="color:var(--color-text-secondary);">改为</span><span><select id="typeSel" style="font-size:0.78rem;padding:0.25rem 0.4rem;">';
    const order = [1,13,2,3,4,5,6,8,7,11,12,9,10];
    for (const t of order){
        if (t === 13 && n.type !== 13 && n.type !== 1) { /* Boolean 仅在源为 Byte 时可选 */ }
        html += '<option value="' + t + '"' + (t === n.type ? ' selected' : '') + '>' + typeName(t) + '</option>';
    }
    html += '</select></span></div>';
    selInfoEl.innerHTML = html;
    const typeSel = document.getElementById('typeSel');
    typeSel.onchange = () => changeNodeType(selectedNode, Number(typeSel.value));
}

/* 编辑:名称 */
function startEditName(node, nameEl){
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'tag-name-input';
    input.value = node.name || '';
    nameEl.replaceWith(input);
    input.focus();
    input.select();
    let done = false;
    const commit = () => {
        if (done) return;
        done = true;
        snapshot();
        node.name = input.value;
        renderAll();
    };
    input.onkeydown = (e) => {
        if (e.key === 'Enter') commit();
        else if (e.key === 'Escape'){ done = true; renderAll(); }
        e.stopPropagation();
    };
    input.onblur = commit;
}

/* 编辑:值 */
function startEditValue(node, valEl){
    if (node.type === 9 || node.type === 10) return;
    if (node.type === 7 || node.type === 11 || node.type === 12){
        openArrayEditorFor(node);
        return;
    }
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'tag-value-input';
    input.value = node.type === 8 ? String(node.value) : String(node.value);
    valEl.replaceWith(input);
    input.focus();
    input.select();
    let done = false;
    const commit = () => {
        if (done) return;
        done = true;
        try {
            let v;
            if (node.type === 8) v = input.value;
            else if (node.type === T_BOOL){
                const t = input.value.trim().toLowerCase();
                if (t === '0' || t === 'false' || t === 'no' || t === '') v = 0;
                else if (t === '1' || t === 'true' || t === 'yes') v = 1;
                else {
                    const num = Number(t.replace(/_/g, ''));
                    if (Number.isNaN(num)) throw new Error('布尔值应为 0/1 或 true/false');
                    v = num ? 1 : 0;
                }
            }
            else if (node.type === 4) v = clampInt(parseIntBig(input.value), -(2n**63n), 2n**63n - 1n, 'Long');
            else if (node.type === 5 || node.type === 6) v = Number(parseNumber(input.value));
            else if (node.type === 2) v = Number(clampInt(parseIntBig(input.value), -0x8000n, 0x7fffn, 'Short'));
            else if (node.type === 3) v = Number(clampInt(parseIntBig(input.value), -0x80000000n, 0x7fffffffn, 'Int'));
            else if (node.type === 1) v = Number(clampInt(parseIntBig(input.value), -128n, 127n, 'Byte'));
            else return;
            snapshot();
            node.value = v;
            renderAll();
        } catch (e){
            done = false;
            setStatus('值无效: ' + e.message, 'error');
            input.focus();
        }
    };
    input.onkeydown = (e) => {
        if (e.key === 'Enter') commit();
        else if (e.key === 'Escape'){ done = true; renderAll(); }
        e.stopPropagation();
    };
    input.onblur = commit;
}

/* 数组编辑器(模态) */
function openArrayEditorFor(node){
    const isLong = node.type === 12;
    const lines = Array.from(node.value.arr).join('\n');
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,0.45);display:flex;align-items:center;justify-content:center;z-index:1000;padding:1rem;';
    const box = document.createElement('div');
    box.style.cssText = 'background:var(--color-surface);border-radius:var(--radius-lg);box-shadow:var(--shadow-lg);width:min(560px,100%);max-height:85vh;display:flex;flex-direction:column;overflow:hidden;';
    box.innerHTML =
        '<div class="card-header">' + typeName(node.type) + ' 编辑器（' + node.value.arr.length + ' 个元素,每行一个）</div>' +
        '<div style="padding:0.75rem 1rem;overflow:auto;flex:1;">' +
        '<textarea class="snbt-area" style="min-height:280px;" id="arrEdit">' + escapeHtml(lines) + '</textarea>' +
        '<div class="notice">每行一个' + (isLong ? ' 64 位整数' : node.type === 7 ? ' 8 位整数(-128~127)' : ' 32 位整数') + ',空行忽略。</div></div>' +
        '<div style="display:flex;gap:0.5rem;padding:0.75rem 1rem;border-top:1px solid var(--color-border);">' +
        '<button class="btn btn-primary" style="flex:1;" id="arrOk">保存</button>' +
        '<button class="btn" style="flex:1;border:1px solid var(--color-border-strong);background:var(--color-surface);" id="arrCancel">取消</button></div>';
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    box.querySelector('#arrCancel').onclick = () => overlay.remove();
    box.querySelector('#arrOk').onclick = () => {
        try {
            const rows = box.querySelector('#arrEdit').value.split('\n').map(s => s.trim()).filter(s => s.length);
            let arr;
            if (isLong) arr = BigInt64Array.from(rows.map(r => clampInt(parseIntBig(r), -(2n**63n), 2n**63n - 1n, 'Long')));
            else if (node.type === 7) arr = Int8Array.from(rows.map(r => Number(clampInt(parseIntBig(r), -128n, 127n, 'Byte'))));
            else arr = Int32Array.from(rows.map(r => Number(clampInt(parseIntBig(r), -0x80000000n, 0x7fffffffn, 'Int'))));
            snapshot();
            node.value = { arr };
            overlay.remove();
            renderAll();
            setStatus('数组已更新(' + rows.length + ' 个元素)', 'info');
        } catch (e){
            setStatus('数组编辑失败: ' + e.message, 'error');
        }
    };
}
window.openArrayEditorById = () => { if (selectedNode && (selectedNode.type === 7 || selectedNode.type === 11 || selectedNode.type === 12)) openArrayEditorFor(selectedNode); };

/* 节点操作 */
function duplicateNode(node){
    if (node === currentRoot){ setStatus('根节点无法复制', 'error'); return; }
    const parent = findParent(node, currentRoot, null);
    if (!parent){ setStatus('未找到父节点', 'error'); return; }
    const kids = childList(parent);
    kids.splice(indexOfNode(node, parent) + 1, 0, deepCopyNode(node));
    renderAll();
}
function deleteNode(node){
    if (node === currentRoot){ setStatus('根节点无法删除', 'error'); return; }
    const parent = findParent(node, currentRoot, null);
    if (!parent){ setStatus('未找到父节点', 'error'); return; }
    const kids = childList(parent);
    kids.splice(indexOfNode(node, parent), 1);
    if (selectedNode === node){ selectedNode = null; selectedRow = null; }
    renderAll();
}
function moveNode(node, dir){
    const parent = findParent(node, currentRoot, null);
    if (!parent) return;
    const kids = childList(parent);
    const idx = indexOfNode(node, parent);
    const ni = idx + dir;
    if (ni < 0 || ni >= kids.length) return;
    const t = kids[idx]; kids[idx] = kids[ni]; kids[ni] = t;
    renderAll();
}
function addChildTo(node){
    if (node.type === 9){
        let et = node.value.elemType;
        if (node.value.items.length) et = node.value.items[0].type === T_BOOL ? 1 : node.value.items[0].type;
        if (!et) et = 1;
        const child = defaultValueNode(et, '');
        node.value.items.push(child);
        node.value.elemType = et;
    } else if (node.type === 10){
        // 避免重名
        let base = '新标签', name = base, i = 1;
        while (node.value.children.some(c => c.name === name)) name = base + '_' + (i++);
        node.value.children.push(defaultValueNode(8, name));
    } else {
        setStatus('只有复合 / 列表可以添加子项', 'error');
        return;
    }
    collapseState.set(node, false); // 展开目标,让新子项可见
    expandAncestors(node);
    renderAll();
}
function defaultValueNode(type, name){
    const n = { type, name: name !== undefined ? name : ('新' + typeName(type)), value: null };
    switch (type){
        case 1: case 13: case 2: case 3: case 5: case 6: n.value = 0; break;
        case 4: n.value = 0n; break;
        case 7: n.value = { arr: new Int8Array(0) }; break;
        case 8: n.value = '文本'; break;
        case 9: n.value = { items: [], elemType: 0 }; break;
        case 10: n.value = { children: [] }; break;
        case 11: n.value = { arr: new Int32Array(0) }; break;
        case 12: n.value = { arr: new BigInt64Array(0) }; break;
        default: n.value = 0;
    }
    return n;
}
function changeNodeType(node, newType){
    if (newType === node.type) return;
    const isContainer = node.type === 7 || node.type === 9 || node.type === 10 || node.type === 11 || node.type === 12;
    try {
        if (newType === T_BOOL && isContainer) throw new Error('Boolean 只能由标量转换');
        if (isContainer && newType !== 7 && newType !== 9 && newType !== 10 && newType !== 11 && newType !== 12 &&
            !confirm('把 ' + typeName(node.type) + ' 转换为 ' + typeName(newType) + ' 会丢弃其内容,继续?')){
            return;
        }
        snapshot();
        if (newType === 10) node.value = { children: [] };
        else if (newType === 9) node.value = { items: [], elemType: 0 };
        else if (newType === 7 || newType === 11 || newType === 12){
            let arr;
            if (newType === 7) arr = new Int8Array(0);
            else if (newType === 11) arr = new Int32Array(0);
            else arr = new BigInt64Array(0);
            node.value = { arr };
        }
        else if (newType === 8) node.value = String(node.value ?? '');
        else if (newType === 4){
            const v = node.value;
            node.value = typeof v === 'bigint' ? v : BigInt(Math.trunc(Number(v) || 0));
        }
        else {
            const raw = node.value;
            const v = typeof raw === 'bigint' ? raw : Number(raw);
            if (newType === T_BOOL) node.value = (typeof v === 'bigint' ? v !== 0n : (Number(v) || 0) !== 0) ? 1 : 0;
            else if (newType === 1) node.value = Number(truncTo(v, 8));   // 保留低位,不丢字节数据
            else if (newType === 2) node.value = Number(truncTo(v, 16));
            else if (newType === 3) node.value = Number(truncTo(v, 32));
            else node.value = Number(v) || 0;                            // Float / Double
        }
        node.type = newType;
        selectedNode = null; selectedRow = null;
        renderAll();
        setStatus('已转换为 ' + typeName(newType), 'info');
    } catch (e){
        setStatus('类型转换失败: ' + e.message, 'error');
    }
}

/* ================= 元信息 / 统计 ================= */
function countTags(node, stats){
    const kids = childList(node);
    if (node !== currentRoot){
        stats.total++;
        const t = node.type;
        stats.byType[t] = (stats.byType[t] || 0) + 1;
        if (t === 7 || t === 11 || t === 12){
            const unit = t === 7 ? 1 : (t === 11 ? 4 : 8);
            stats.bytes += node.value.arr.length * unit;
        }
    }
    if (kids) for (const k of kids) countTags(k, stats);
}
function renderMeta(){
    const list = document.getElementById('metaList');
    const chips = document.getElementById('statChips');
    if (!currentRoot || !fileMeta){
        list.innerHTML = '<dt>—</dt><dd>无</dd>';
        chips.innerHTML = '';
        return;
    }
    const kindNames = { gzip: 'GZip 压缩', zlib: 'Zlib 压缩', 'raw-be': '原始大端', 'raw-le': '原始小端', leveldat: '基岩版 level.dat', snbt: 'SNBT 文本', sample: '内置示例' };
    let html = '';
    html += '<dt>文件名</dt><dd>' + escapeHtml(fileMeta.name || '(无)') + '</dd>';
    html += '<dt>文件大小</dt><dd>' + fmtBytes(fileMeta.size) + '</dd>';
    html += '<dt>编码</dt><dd>' + (fileMeta.le ? '小端 (Bedrock)' : '大端 (Java)') + '</dd>';
    html += '<dt>格式</dt><dd>' + (kindNames[fileMeta.kind] || fileMeta.kind) + '</dd>';
    html += '<dt>根名称</dt><dd>' + escapeHtml(currentRoot.name || '(空)') + '</dd>';
    list.innerHTML = html;

    const stats = { total: 0, byType: {}, bytes: 0 };
    countTags(currentRoot, stats);
    let ch = '<span class="stat-chip">标签总数 <b>' + stats.total + '</b></span>';
    for (let t = 1; t <= 12; t++){
        if (stats.byType[t]) ch += '<span class="stat-chip"><span class="nbt-sprite ' + SP_CLASSES[t] + '"></span>' + TAG_NAMES[t] + ' <b>' + stats.byType[t] + '</b></span>';
    }
    if (stats.byType[T_BOOL]) ch += '<span class="stat-chip"><span class="nbt-sprite sp-boolean"></span>Boolean <b>' + stats.byType[T_BOOL] + '</b></span>';
    if (stats.bytes) ch += '<span class="stat-chip">数组字节 <b>' + fmtBytes(stats.bytes) + '</b></span>';
    chips.innerHTML = ch;

    /* 图例 */
    const lg = document.getElementById('legendChips');
    if (!lg.dataset.done){
        let l = '';
        for (let t = 1; t <= 12; t++){
            l += '<span class="stat-chip"><span class="nbt-sprite ' + SP_CLASSES[t] + '"></span>' + TAG_NAMES[t] + '</span>';
        }
        l += '<span class="stat-chip"><span class="nbt-sprite sp-boolean"></span>Boolean(Byte 0/1)</span>';
        lg.innerHTML = l;
        lg.dataset.done = '1';
    }
}

/* ================= SNBT 同步 ================= */
let snbtDirty = false;
function syncSnbt(force){
    if (!currentRoot){ snbtArea.value = ''; return; }
    if (snbtDirty && !force) return; // 用户编辑中不打断
    snbtArea.value = toSnbt(currentRoot, false);
    snbtDirty = false;
}
snbtArea.addEventListener('input', () => { snbtDirty = true; });
snbtArea.addEventListener('blur', () => { snbtDirty = false; });

/* ================= 载入 / 导出 / 事件接线 ================= */
/* 换了一份数据:清空选择、折叠状态、撤销栈与搜索词,避免上一份文件的筛选条件
   把新数据强制全展开或误高亮 */
function adoptRoot(root, meta){
    currentRoot = root;
    fileMeta = meta;
    collapseState = new WeakMap();
    selectedNode = null; selectedRow = null;
    undoStack.length = 0; redoStack.length = 0;
    searchBox.value = '';
    searchExpand = false;
    document.getElementById('editorCard').classList.add('on');
    document.getElementById('snbtCard').classList.add('on');
    snbtDirty = false;
    renderAll();
}

async function loadNbtBytes(bytes, name, size){
    const res = await loadNbtFromBytes(bytes); // part4: 嗅探+解压+解析
    adoptRoot(res.root, { name, size, kind: res.kind, le: res.le });
    const kinds = { gzip: 'gzip 压缩', zlib: 'zlib 压缩', 'raw-be': '未压缩大端', 'raw-le': '未压缩小端', leveldat: '基岩版 level.dat(8字节头)' };
    setStatus('解析成功 — ' + name + ' · ' + (kinds[res.kind] || res.kind) + ' · ' + (res.le ? '小端 (Bedrock)' : '大端 (Java)'), 'info');
}

function loadSnbtText(text, name){
    const root = parseSnbt(text);
    adoptRoot(root, { name, size: new Blob([text]).size, kind: 'snbt', le: false });
    setStatus('SNBT 解析成功 — ' + name, 'info');
}

async function onFile(file){
    try {
        setStatus('正在读取 ' + file.name + ' …', 'info');
        const buf = await file.arrayBuffer();
        const bytes = new Uint8Array(buf);
        const lower = file.name.toLowerCase();
        // 明确文本
        if (lower.endsWith('.snbt')){
            loadSnbtText(new TextDecoder().decode(bytes), file.name);
            return;
        }
        // gzip/zlib 头 → 二进制 NBT
        const gz = bytes[0] === 0x1f && bytes[1] === 0x8b;
        const zl = bytes[0] === 0x78;
        if (!gz && !zl && looksLikeText(bytes)){
            try {
                loadSnbtText(new TextDecoder().decode(bytes), file.name);
                return;
            } catch (e){ /* 落回二进制 */ }
        }
        await loadNbtBytes(bytes, file.name, file.size);
    } catch (err){
        console.error(err);
        setStatus('载入失败: ' + (err && err.message ? err.message : err), 'error');
        window.reportError && window.reportError(err);
    }
}
function looksLikeText(bytes){
    const n = Math.min(bytes.length, 512);
    if (!n) return false;
    for (let i = 0; i < n; i++){
        const b = bytes[i];
        if (b === 0) return false;
    }
    return true;
}

/* 内置示例 */
function loadSample(){
    const snbt = [
        '{',
        '    TestCompound: {',
        '        byteVal: 1b,',
        '        boolFlag: true,',
        '        shortVal: 300s,',
        '        intVal: 123456,',
        '        longVal: 9007199254740993L,',
        '        floatVal: 3.14f,',
        '        doubleVal: 2.718281828459045,',
        '        hexVal: 0xFF,',
        '        stringVal: "你好, NBT! 引号\\"与\\\\",',
        '        emptyString: "",',
        '        byteArray: [B; 1, -2, 3, 127, -128],',
        '        intArray: [I; 10, 20, 30],',
        '        longArray: [L; 1L, -2L, 123456789012345L],',
        '        simpleList: [1, 2, 3],',
        '        stringList: ["a", "bc", "def"],',
        '        emptyList: [],',
        '        nestedList: [[1b, 0b], [1b, 1b]],',
        '        items: [',
        '            { Id: "minecraft:diamond", Count: 3b, tag: { display: { Name: "\\"钻石\\"" }, HideFlags: 0 } },',
        '            { Id: "minecraft:stick", Count: 64b }',
        '        ],',
        '        posList: [{ x: 1.5d, y: 64.0d, z: -3.25d }, { x: 0.0d, y: 0.0d, z: 0.0d }]',
        '    },',
        '    topLevel: 42',
        '}'
    ].join('\n');
    loadSnbtText(snbt, '示例.snbt');
    setStatus('已载入示例 SNBT — 可编辑 / 展开折叠 / 导出各种格式', 'info');
}

/* ================= 导出 ================= */
function download(name, data, mime){
    const blob = new Blob([data], { type: mime || 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
}
function baseName(){
    let n = (fileMeta && fileMeta.name || 'nbt').replace(/\.[^.]+$/, '');
    return n || 'nbt';
}

async function exportNbt(le, gz, mcstructure){
    if (!currentRoot) return;
    try {
        setStatus('正在生成 NBT…', 'info');
        const raw = writeNbt(currentRoot, le);
        let out = raw, name;
        if (gz){
            out = await compressStream(raw, 'gzip');
            name = baseName() + '.nbt';
        } else if (mcstructure){
            name = baseName() + '.mcstructure';
        } else {
            name = baseName() + (le ? '_le.nbt' : '_be.dat');
        }
        download(name, out);
        setStatus('已导出 ' + name + '(' + fmtBytes(out.length) + (gz ? ', gzip 压缩' : '') + ')', 'info');
    } catch (e){
        console.error(e);
        setStatus('导出失败: ' + e.message, 'error');
        window.reportError && window.reportError(e);
    }
}

/* ================= 事件接线 ================= */
const fileInput = document.getElementById('file');
document.getElementById('uploadWrapper').addEventListener('click', () => fileInput.click());
fileInput.onchange = () => { if (fileInput.files[0]) onFile(fileInput.files[0]); };
addEventListener('dragover', e => e.preventDefault());
addEventListener('drop', e => {
    e.preventDefault();
    const f = (e.dataTransfer.files || [])[0];
    if (f) onFile(f);
});

document.getElementById('btnSample').onclick = loadSample;
document.getElementById('btnUndo').onclick = doUndo;
document.getElementById('btnRedo').onclick = doRedo;
document.getElementById('btnExpandAll').onclick = () => setAllCollapsed(false);
document.getElementById('btnCollapseAll').onclick = () => setAllCollapsed(true);
document.getElementById('btnExportNbtGz').onclick = () => exportNbt(false, true, false);
document.getElementById('btnExportNbtRaw').onclick = () => exportNbt(false, false, false);
document.getElementById('btnExportLe').onclick = () => exportNbt(true, false, false);
document.getElementById('btnExportMcstructure').onclick = () => exportNbt(true, false, true);
document.getElementById('btnToSnbt').onclick = () => {
    if (currentRoot){
        snbtArea.value = toSnbt(currentRoot, true);
        snbtDirty = false;
    }
};
document.getElementById('btnSnbtToTree').onclick = () => {
    const t = snbtArea.value.trim();
    if (!t){ setStatus('SNBT 文本为空', 'error'); return; }
    try {
        loadSnbtText(t, fileMeta ? fileMeta.name : '粘贴的 SNBT');
    } catch (e){
        setStatus('SNBT 解析失败: ' + e.message, 'error');
    }
};
document.getElementById('btnCopySnbt').onclick = async () => {
    if (!currentRoot) return;
    try {
        await navigator.clipboard.writeText(toSnbt(currentRoot, false));
        setStatus('SNBT 已复制到剪贴板', 'info');
    } catch (e){
        snbtArea.focus();
        snbtArea.select();
        setStatus('已全选 SNBT 文本 — 请按 Ctrl+C 复制', 'info');
    }
};

/* 调试快照 */
window.__nbtDebug = () => ({
    loaded: !!currentRoot,
    meta: fileMeta,
    selected: selectedNode ? (selectedNode.name || '(root)') : null,
    undo: undoStack.length,
    redo: redoStack.length,
    tags: currentRoot ? (function count(n){
        let c = 0;
        const kids = childList(n);
        if (kids) for (const k of kids){ c++; c += count(k); }
        return c;
    })(currentRoot) : 0
});

/* 快捷键:Ctrl+Z 撤销 / Ctrl+Y 或 Ctrl+Shift+Z 重做(编辑框中不拦截) */
addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    const tag = (e.target && e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea') return;
    const k = e.key.toLowerCase();
    if (k === 'z' && !e.shiftKey){ e.preventDefault(); doUndo(); }
    else if (k === 'y' || (k === 'z' && e.shiftKey)){ e.preventDefault(); doRedo(); }
});

setStatus('就绪 — 上传文件或点击「载入示例」开始', 'info');
