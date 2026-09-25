// 行为冒烟:修复后的 buildFromGeometry(stub DOM/three,跑真实函数体)
const fs = require('fs');
const html = fs.readFileSync('structure-viewer/index.html', 'utf8');
const src = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
const i = src.indexOf('function buildFromGeometry');
const j = src.indexOf('// 载入完成收尾', i);
const body = src.slice(i, j);

const THREE = {
  Vector3: function (x, y, z) { this.x = x; this.y = y; this.z = z; },
  Sphere: function (center, radius) { this.center = center; this.radius = radius; },
  Color: function (r, g, b) { return { r, g, b }; },
  MeshLambertMaterial: function (o) { return o; },
  BufferAttribute: function (arr, n) { this.array = arr; this.itemSize = n; this.count = arr.length / n; },
  BufferGeometry: function () {
    this.attributes = {}; this.boundingSphere = null;
    this.setAttribute = (k, v) => { this.attributes[k] = v; };
    this.setIndex = (i) => { this.index = i; };
    this.computeBoundingSphere = function () { this._computed = (this.attributes.position.array.length / 3); };
  },
  Mesh: function (g, m) { this.geometry = g; this.material = m; },
  Group: function () { this.children = []; this.add = (m) => this.children.push(m); },
};
const sceneObj = { remove: () => {}, add: () => {} };
let clipCalls = 0, finishCalls = 0, disposed = 0;
const deps = {
  THREE, scene: sceneObj,
  meshGroup: null,
  removeSlice: () => {},
  disposeGroup: () => { disposed++; },
  applyClip: () => { clipCalls++; },
  finishLoad: (m, vc, ic) => { finishCalls++; },
  clipYEl: { value: '', max: '' },
  clipPlane: { constant: Infinity },
};
const fn = new Function('THREE', 'scene', 'meshGroup', 'removeSlice', 'disposeGroup', 'applyClip', 'finishLoad', 'clipYEl', 'clipPlane',
  'let captured=null;' + body.replace(/^function buildFromGeometry\(m\)\{/, 'function buildFromGeometry(m){') + '; return buildFromGeometry;');
const buildFromGeometry = fn(deps.THREE, deps.scene, deps.meshGroup, deps.removeSlice, deps.disposeGroup, deps.applyClip, deps.finishLoad, deps.clipYEl, deps.clipPlane);

// 构造 50 组共享 attr 的 m
const N = 100000;
const pos = new Float32Array(N * 3), uv = new Float32Array(N * 2), pal = new Float32Array(30);
const merged = [];
let off = 0;
for (let g = 0; g < 50; ++g) {
  const ix = new Uint32Array(600);
  for (let k = 0; k < 600; ++k) ix[k] = (off + k) % N;
  off += 600;
  merged.push([g % 10, g % 6, ix]);
}
const m = {
  vc: N, ic: 30000, pos, uv, palRgb: pal, pal: 10,
  names: Array.from({ length: 10 }, (_, k) => k === 0 ? 'minecraft:air' : 'minecraft:stone'),
  merged, mn: [0, 0, 0], mx: [756, 148, 826], info6: [0, 0, 0, 756, 148, 826],
  blocksTotal: 1, blocksNonair: 1, regions: 1, paletteSize: 10,
};
let capturedGroup = null;
const origGroup = THREE.Group;
THREE.Group = function () { capturedGroup = new origGroup(); return capturedGroup; };
buildFromGeometry(m);
THREE.Group = origGroup;

let ok = true;
const assert = (name, cond) => { console.log((cond ? 'PASS' : 'FAIL') + '  ' + name); if (!cond) ok = false; };
assert('meshGroup 加入 50 个 mesh', capturedGroup.children.length === 50);
assert('每组 geometry 都预设 boundingSphere(未走 computeBoundingSphere)',
  capturedGroup.children.every(m => m.geometry.boundingSphere && !m.geometry._computed));
assert('包围盒半径覆盖结构对角线一半', Math.abs(capturedGroup.children[0].geometry.boundingSphere.radius - Math.hypot(756, 148, 826) / 2) < 1e-6);
assert('applyClip 调用 1 次', clipCalls === 1);
assert('finishLoad 调用 1 次', finishCalls === 1);
process.exit(ok ? 0 : 1);
