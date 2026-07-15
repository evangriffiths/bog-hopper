import * as THREE from 'three';

/* ============================================================
   BOGHOPPER — an endless runner on a Highland track
   ============================================================ */

// ---------- tunables ----------
const SEG_LEN = 34;          // metres per terrain segment
const NUM_SEGS = 8;          // segments alive at once
const PATH_W = 3.2;          // full width of the double-track
const LANES = [-0.75, 0, 0.75];
const MOOR_W = 64;           // width of moorland each side

const BASE_SPEED = 11;       // m/s at the start
const MAX_SPEED = 26;
const SPEED_RAMP = 750;      // metres to reach ~max speed

const GRAVITY = -32;
const JUMP_V = 10.8;
const BOG_JUMP_MULT = 0.72;
const BOG_FACTOR = 0.4;      // speed multiplier while bogged
const MIDGE_FACTOR = 0.88;
const BOOST_FACTOR = 1.3;
const BOOST_TIME = 4.5;

const CAUGHT_Z = 6.4;        // player drifts back to here => game over
const DRIFT_SCALE = 0.32;    // how fast being slow pushes you toward the sweep
const RECOVER_RATE = 0.7;    // m/s clawed back at full speed — slow; oatcakes recover fast
const BOG_ENTRY_PENALTY = 0.5; // instant sweep-drift when you land in a bog
const BOG_STUCK_TIME = 0.4;  // feet held fast after landing in a bog — no jumping out

// ---------- tiny utils ----------
const rand = (a, b) => a + Math.random() * (b - a);
const randi = (a, b) => Math.floor(rand(a, b + 1));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

// hash-based value noise (deterministic, cheap)
function hash2(x, y) {
  let h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return h - Math.floor(h);
}
function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  return lerp(
    lerp(hash2(xi, yi), hash2(xi + 1, yi), u),
    lerp(hash2(xi, yi + 1), hash2(xi + 1, yi + 1), u), v);
}
function fbm(x, y) {
  return vnoise(x, y) * 0.6 + vnoise(x * 2.7, y * 2.7) * 0.28 + vnoise(x * 6.1, y * 6.1) * 0.12;
}

// ---------- renderer / scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
document.getElementById('wrap').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const FOG_COLOR = new THREE.Color(0xc3cdc8);
scene.fog = new THREE.Fog(FOG_COLOR, 34, 155);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 900);
camera.position.set(0, 3.8, 9.0);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------- light ----------
const hemi = new THREE.HemisphereLight(0xcfd8e8, 0x5a5240, 0.95);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffe3b0, 1.35);
sun.position.set(-40, 38, -60);
scene.add(sun);

// ---------- sky dome ----------
function makeSkyTexture() {
  const c = document.createElement('canvas');
  c.width = 32; c.height = 512;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0.0, '#5f8fc0');
  grad.addColorStop(0.42, '#9db8cd');
  grad.addColorStop(0.62, '#d9cfb4');
  grad.addColorStop(0.72, '#e9d3a0');
  grad.addColorStop(1.0, '#c3cdc8');
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 512);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const sky = new THREE.Mesh(
  new THREE.SphereGeometry(500, 24, 18, 0, Math.PI * 2, 0, Math.PI * 0.62),
  new THREE.MeshBasicMaterial({ map: makeSkyTexture(), side: THREE.BackSide, fog: false, depthWrite: false })
);
sky.position.y = -20;
sky.renderOrder = -10;
scene.add(sky);

// sun glow sprite
function makeGlowTexture(inner, outer) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 64);
  grad.addColorStop(0, inner);
  grad.addColorStop(1, outer);
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}
const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({
  map: makeGlowTexture('rgba(255,240,200,0.95)', 'rgba(255,220,150,0)'),
  fog: false, depthWrite: false, transparent: true,
}));
sunSprite.scale.set(90, 90, 1);
sunSprite.position.set(-130, 48, -320);
scene.add(sunSprite);

// ---------- distant ridges (An Teallach & friends) with parallax ----------
// An Teallach from the south-east: the long pull up Glas Mheall Mor, Bidein
// a' Ghlas Thuill, a deep col, sharp Sgurr Fiona, then the Corrag Bhuidhe
// pinnacles stepping down over Stob Cadha Gobhlach to the rounded Sail Liath.
const AN_TEALLACH = [
  [0.00, 0.08], [0.05, 0.12], [0.10, 0.18], [0.15, 0.28], [0.20, 0.42],
  [0.245, 0.60], [0.265, 0.56],                    // Glas Mheall Mor shoulder
  [0.315, 0.90], [0.335, 0.82],                    // Bidein a' Ghlas Thuill
  [0.375, 0.66], [0.40, 0.70], [0.42, 0.64],       // the col
  [0.455, 1.00],                                   // Sgurr Fiona
  [0.472, 0.80], [0.487, 0.93], [0.50, 0.76],      // Lord Berkeley's Seat
  [0.513, 0.87], [0.527, 0.71],                    // Corrag Bhuidhe I
  [0.54, 0.80], [0.554, 0.65],                     // Corrag Bhuidhe II
  [0.567, 0.72], [0.582, 0.58],                    // Corrag Bhuidhe III
  [0.597, 0.63], [0.617, 0.49],                    // last tooth, easing off
  [0.648, 0.55], [0.672, 0.44],                    // Stob Cadha Gobhlach
  [0.71, 0.50], [0.755, 0.46], [0.79, 0.38],       // Sail Liath, broad and round
  [0.85, 0.24], [0.92, 0.14], [1.00, 0.08],
];
function makeRidgeTexture(colorTop, colorBase, maxH, profile, seed, jag) {
  const c = document.createElement('canvas');
  c.width = 2048; c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 256 - maxH, 0, 256);
  grad.addColorStop(0, colorTop);
  grad.addColorStop(1, colorBase);
  g.fillStyle = grad;
  g.beginPath();
  g.moveTo(0, 256);
  if (profile) {
    // rolling hills, then the hand-drawn profile centred in view, hills after
    for (let x = 0; x < 0.3; x += 0.01) {
      const h = (0.14 + fbm(x * 6 + seed, seed) * 0.2) * maxH;
      g.lineTo(x * 2048, 256 - h - 8);
    }
    for (const [px, ph] of profile) {
      g.lineTo((0.3 + px * 0.45) * 2048, 256 - ph * maxH - 8);
    }
    for (let x = 0.75; x <= 1.001; x += 0.01) {
      const h = (0.14 + fbm(x * 6 + seed, seed) * 0.2) * maxH;
      g.lineTo(x * 2048, 256 - h - 8);
    }
  } else {
    for (let x = 0; x <= 1.001; x += 0.008) {
      // wrap-friendly: blend noise at x and x-1 so ends meet
      const n = lerp(fbm(x * 5 + seed, seed), fbm((x - 1) * 5 + seed, seed), smoothstep(0.85, 1, x));
      const j = jag ? Math.abs(Math.sin(x * 43 + seed)) * 0.15 : 0;
      g.lineTo(x * 2048, 256 - (0.25 + n * 0.6 + j) * maxH - 4);
    }
  }
  g.lineTo(2048, 256);
  g.closePath();
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const ridges = [];
function addRidge(tex, z, y, w, h, drift, sway) {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, fog: false, depthWrite: false })
  );
  m.position.set(0, y, z);
  m.renderOrder = -5;
  scene.add(m);
  ridges.push({ mesh: m, tex, drift, sway, baseY: y });
}
// farthest: An Teallach silhouette, faded blue-grey
addRidge(makeRidgeTexture('#7d8ca0', '#93a0ae', 200, AN_TEALLACH, 3.7, false), -330, 40, 900, 110, 0.00010, 0.010);
// middle ridge, muted slate
addRidge(makeRidgeTexture('#7b8878', '#8f9a8c', 150, null, 9.2, true), -290, 26, 820, 95, 0.00035, 0.022);
// near moor shoulder, heathery brown
addRidge(makeRidgeTexture('#6e6a52', '#7d7a60', 110, null, 17.5, false), -252, 14, 740, 80, 0.00090, 0.045);

// clouds
const cloudTex = makeGlowTexture('rgba(255,255,255,0.85)', 'rgba(255,255,255,0)');
const clouds = [];
for (let i = 0; i < 7; i++) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({
    map: cloudTex, transparent: true, opacity: rand(0.25, 0.5), fog: false, depthWrite: false,
  }));
  s.scale.set(rand(70, 150), rand(16, 30), 1);
  s.position.set(rand(-350, 350), rand(55, 105), rand(-340, -260));
  scene.add(s);
  clouds.push({ sprite: s, speed: rand(0.6, 1.6) });
}

// ---------- ground textures ----------
function makePathTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 512;
  const g = c.getContext('2d');
  // base: worn earthy verge
  g.fillStyle = '#6d6b48';
  g.fillRect(0, 0, 256, 512);
  // mottle the verge
  for (let i = 0; i < 900; i++) {
    g.fillStyle = pick(['#75714b', '#5f5e40', '#7d7550', '#68663f']);
    g.fillRect(Math.random() * 256, Math.random() * 512, rand(2, 7), rand(2, 7));
  }
  // twin gravel ruts (world x = ±0.75, path width 3.2 → uv centres)
  const rutW = 52;
  for (const cx of [128 - 60, 128 + 60]) {
    g.fillStyle = '#8f897a';
    g.fillRect(cx - rutW / 2, 0, rutW, 512);
    for (let i = 0; i < 1400; i++) {
      g.fillStyle = pick(['#9b958a', '#7f7a6c', '#a7a196', '#8a8375', '#6f6a5e']);
      const x = cx - rutW / 2 + Math.random() * rutW;
      g.fillRect(x, Math.random() * 512, rand(1, 4), rand(1, 4));
    }
    // scattered larger stones with a lit top edge, so the surface reads 3D
    for (let i = 0; i < 70; i++) {
      const x = cx - rutW / 2 + 3 + Math.random() * (rutW - 8);
      const y = Math.random() * 508;
      const s = rand(2.5, 6);
      g.fillStyle = pick(['#6a6558', '#75705f', '#5e5a4e']);
      g.fillRect(x, y, s, s);
      g.fillStyle = pick(['#b2ac9e', '#a8a294', '#bdb7a8']);
      g.fillRect(x, y, s - 1, 1.5);
      g.fillRect(x, y, 1.5, s - 1);
    }
    // soft edges
    const e = g.createLinearGradient(cx - rutW / 2 - 8, 0, cx - rutW / 2 + 6, 0);
    e.addColorStop(0, 'rgba(109,107,72,1)'); e.addColorStop(1, 'rgba(109,107,72,0)');
    g.fillStyle = e; g.fillRect(cx - rutW / 2 - 8, 0, 14, 512);
    const e2 = g.createLinearGradient(cx + rutW / 2 + 8, 0, cx + rutW / 2 - 6, 0);
    e2.addColorStop(0, 'rgba(109,107,72,1)'); e2.addColorStop(1, 'rgba(109,107,72,0)');
    g.fillStyle = e2; g.fillRect(cx + rutW / 2 - 6, 0, 14, 512);
  }
  // centre grass strip
  g.fillStyle = '#5c6b38';
  g.fillRect(112, 0, 32, 512);
  for (let i = 0; i < 500; i++) {
    g.fillStyle = pick(['#66753f', '#525f31', '#6f7c46', '#495528']);
    g.fillRect(112 + Math.random() * 32, Math.random() * 512, rand(1, 4), rand(2, 6));
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1, SEG_LEN / 9);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const pathTexture = makePathTexture();

function makeSmidgeTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#f2f4ee';          // white bottle
  g.fillRect(0, 0, 256, 128);
  g.fillStyle = '#4c8a2e';          // green label band
  g.fillRect(0, 34, 256, 60);
  g.fillStyle = '#f2f4ee';
  g.font = 'bold 34px sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('SMIDGE', 128, 62);
  g.fillStyle = '#e8c62e';          // wee yellow accent stripe
  g.fillRect(0, 94, 256, 8);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const smidgeTexture = makeSmidgeTexture();

// ---------- shared geometries / materials ----------
const MAT = {
  path: new THREE.MeshLambertMaterial({ map: pathTexture }),
  moor: new THREE.MeshLambertMaterial({ vertexColors: true }),
  bog: new THREE.MeshStandardMaterial({ color: 0x3a2d17, roughness: 0.4, metalness: 0.12 }),
  bogRim: new THREE.MeshLambertMaterial({ color: 0x565232 }),
  plank: new THREE.MeshLambertMaterial({ color: 0x8a6f4d }),
  rock: new THREE.MeshLambertMaterial({ color: 0x8d8d88 }),
  rockDark: new THREE.MeshLambertMaterial({ color: 0x6f6f6a }),
  heather: new THREE.MeshLambertMaterial({ color: 0xffffff }),
  tuft: new THREE.MeshLambertMaterial({ color: 0xffffff }),
  moss: new THREE.MeshLambertMaterial({ color: 0xffffff }),
  pebble: new THREE.MeshLambertMaterial({ color: 0xffffff }),
  crag: new THREE.MeshLambertMaterial({ color: 0x7d7d76 }),
  cotton: new THREE.MeshLambertMaterial({ color: 0xf5f2e8 }),
  stem: new THREE.MeshLambertMaterial({ color: 0x7a8a4e }),
  lochan: new THREE.MeshBasicMaterial({ color: 0x76909c }),
  can: new THREE.MeshStandardMaterial({ map: smidgeTexture, roughness: 0.45, metalness: 0.1 }),
  canCap: new THREE.MeshLambertMaterial({ color: 0x3f7d2e }),
  cake: new THREE.MeshStandardMaterial({ color: 0xc79b58, roughness: 0.85 }),
  sheepBody: new THREE.MeshLambertMaterial({ color: 0xe8e4d8 }),
  sheepFace: new THREE.MeshLambertMaterial({ color: 0x2e2a26 }),
  cairn: new THREE.MeshLambertMaterial({ color: 0x9a9a94 }),
};
const GEO = {
  bog: new THREE.CircleGeometry(1, 32),
  bogRim: new THREE.RingGeometry(0.97, 1.13, 32),
  heather: new THREE.IcosahedronGeometry(0.5, 1),
  tuft: new THREE.ConeGeometry(0.3, 0.34, 7),
  moss: new THREE.IcosahedronGeometry(0.5, 1),
  pebble: new THREE.DodecahedronGeometry(0.06, 0),
  crag: new THREE.DodecahedronGeometry(1, 0),
  rockSmall: new THREE.DodecahedronGeometry(0.35, 0),
  rockObs: new THREE.DodecahedronGeometry(0.5, 1),
  plank: new THREE.BoxGeometry(0.62, 0.09, 1),
  cottonHead: new THREE.SphereGeometry(0.07, 6, 5),
  cottonStem: new THREE.CylinderGeometry(0.012, 0.018, 0.4, 4),
  canBody: new THREE.CylinderGeometry(0.14, 0.14, 0.42, 12),
  canCap: new THREE.CylinderGeometry(0.09, 0.09, 0.1, 10),
  cake: new THREE.CylinderGeometry(0.26, 0.26, 0.09, 14),
  lochan: new THREE.CircleGeometry(1, 26),
};

// heather / tuft colour palettes (per-instance colours)
const HEATHER_COLS = [0x7a5a7e, 0x6d4f72, 0x86648a, 0x5e6b45, 0x6e5568].map(c => new THREE.Color(c));
const TUFT_COLS = [0xa89f55, 0x8f8c4a, 0xb0a860, 0x7f8a42, 0x9c9450].map(c => new THREE.Color(c));
const MOSS_COLS = [0x6f8f3a, 0x86a33f, 0x5c7d33, 0x9aa851, 0x7a9440].map(c => new THREE.Color(c));
const PEBBLE_COLS = [0x8a857a, 0x9b968a, 0x767065, 0xa39d90].map(c => new THREE.Color(c));

// ---------- terrain segments ----------
const segments = [];
const dummy = new THREE.Object3D();

// One global noise field for the whole moor so segment edges line up.
// Terrain repeats every NUM_SEGS*SEG_LEN metres; the last few metres blend
// back to the start so the ring wraps without a crack.
const GSEED = rand(0, 100);
function makeMoorField(baseW, lochan) {
  const P = NUM_SEGS * SEG_LEN;
  const blend = (fn, z) => {
    let w = baseW - z;
    w = ((w % P) + P) % P;
    const t = smoothstep(P - 8, P, w);
    return t > 0 ? lerp(fn(w), fn(w - P), t) : fn(w);
  };
  const height = (x, z) => {
    if (Math.abs(x) < PATH_W / 2) return 0;
    const d = Math.abs(x);
    const rise = smoothstep(4, 42, d);
    const n = blend(w => fbm(x * 0.055 + GSEED, w * 0.05 + GSEED * 3), z);
    let h = n * (0.5 + smoothstep(2, 10, d) * 1.4 + rise * 7);
    h += rise * rise * 3.5;           // hills climb away from the glen
    h -= smoothstep(3, 1.6, d) * 0.3; // slight drainage dip at the verge
    if (lochan) {
      const dl = Math.hypot(x - lochan.x, z - lochan.z);
      h = lerp(0.12, h, smoothstep(lochan.r * 0.9, lochan.r * 2.1, dl));
    }
    return h;
  };
  const tint = (x, z) => blend(w => fbm(x * 0.09 + 3.1, w * 0.09 + GSEED), z);
  return { height, tint };
}

function buildMoorGeometry(side, field) {
  // side: -1 left, +1 right
  const geo = new THREE.PlaneGeometry(MOOR_W, SEG_LEN, 44, 22);
  geo.rotateX(-Math.PI / 2);
  geo.translate(side * (MOOR_W / 2 + PATH_W / 2 - 0.1), 0, 0);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const col = new THREE.Color();
  const lowCol = new THREE.Color(0x5e6b3c);   // rushy green low ground
  const midCol = new THREE.Color(0x7c6f4a);   // tawny grass
  const highCol = new THREE.Color(0x6b5a52);  // peaty brown hills
  const heatherTint = new THREE.Color(0x6d5470);
  for (let i = 0; i < pos.count; i++) {
    const lx = pos.getX(i);
    const lz = pos.getZ(i);
    const h = field.height(lx, lz);
    pos.setY(i, h);
    // colour by height + noise: green low, tawny mid, peat high, heather patches
    const hn = field.tint(lx, lz);
    const t1 = clamp(smoothstep(0.3, 4, h) + (hn - 0.4) * 0.9, 0, 1);
    col.copy(lowCol).lerp(midCol, t1).lerp(highCol, smoothstep(3, 9, h));
    if (hn > 0.58) col.lerp(heatherTint, smoothstep(0.58, 0.78, hn) * 0.7);
    col.multiplyScalar(rand(0.93, 1.05));
    colors[i * 3] = col.r; colors[i * 3 + 1] = col.g; colors[i * 3 + 2] = col.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  return geo;
}

function scatterInstances(mesh, count, colors, sizeRange, yOff, squash, moorH) {
  const col = new THREE.Color();
  let placed = 0, guard = 0;
  while (placed < count && guard++ < count * 4) {
    const side = Math.random() < 0.5 ? -1 : 1;
    const x = side * rand(PATH_W / 2 + 0.4, 26);
    const z = rand(-SEG_LEN / 2, SEG_LEN / 2);
    const h = moorH(x, z);
    if (h < 0.02 && Math.abs(x) > 4) continue; // don't plant in a lochan
    const rise = smoothstep(3, 34, Math.abs(x));
    const s = rand(sizeRange[0], sizeRange[1]) * (1 - rise * 0.3);
    dummy.position.set(x, h + yOff * s - 0.04, z);
    dummy.scale.set(s, s * (squash || 1), s);
    dummy.rotation.set(0, rand(0, Math.PI * 2), 0);
    dummy.updateMatrix();
    mesh.setMatrixAt(placed, dummy.matrix);
    if (colors) {
      col.copy(pick(colors)).multiplyScalar(rand(0.85, 1.1));
      mesh.setColorAt(placed, col);
    }
    placed++;
  }
  mesh.count = placed;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}

function makeSheep() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.IcosahedronGeometry(0.42, 1), MAT.sheepBody);
  body.scale.set(1.15, 0.9, 1.4);
  body.position.y = 0.52;
  g.add(body);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.24, 0.3), MAT.sheepFace);
  head.position.set(0, 0.62, 0.55);
  g.add(head);
  for (const [lx, lz] of [[-0.2, 0.28], [0.2, 0.28], [-0.2, -0.28], [0.2, -0.28]]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.34, 5), MAT.sheepFace);
    leg.position.set(lx, 0.17, lz);
    g.add(leg);
  }
  return g;
}

function makeStag() {
  const g = new THREE.Group();
  const hide = new THREE.MeshLambertMaterial({ color: 0x6e4f33 });
  const dark = new THREE.MeshLambertMaterial({ color: 0x4c3623 });
  const antlerMat = new THREE.MeshLambertMaterial({ color: 0x8a7a5c });

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.72, 3, 8), hide);
  body.rotation.x = Math.PI / 2;
  body.position.y = 1.0;
  g.add(body);
  for (const [lx, lz] of [[-0.16, 0.32], [0.16, 0.32], [-0.16, -0.34], [0.16, -0.34]]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.9, 6), dark);
    leg.position.set(lx, 0.45, lz);
    g.add(leg);
  }
  // neck + head + antlers pivot together so the stag can graze
  const headG = new THREE.Group();
  headG.position.set(0, 1.15, 0.35);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 0.55, 7), hide);
  neck.position.set(0, 0.3, 0.1);
  neck.rotation.x = 0.35;
  headG.add(neck);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.16, 0.34), hide);
  head.position.set(0, 0.58, 0.28);
  headG.add(head);
  for (const side of [-1, 1]) {
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.028, 0.55, 5), antlerMat);
    beam.position.set(side * 0.08, 0.85, 0.18);
    beam.rotation.set(-0.35, 0, side * 0.55);
    headG.add(beam);
    for (const [ty, tz, tr] of [[0.78, 0.1, -0.9], [0.98, 0.22, -0.4]]) {
      const tine = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.02, 0.26, 4), antlerMat);
      tine.position.set(side * (0.1 + ty * 0.12), ty, tz);
      tine.rotation.set(tr, 0, side * 0.9);
      headG.add(tine);
    }
  }
  g.add(headG);
  g.userData.headG = headG;
  return g;
}

function makeCairn() {
  const g = new THREE.Group();
  let y = 0;
  for (let i = 0; i < 5; i++) {
    const s = 0.5 - i * 0.08;
    const r = new THREE.Mesh(GEO.rockSmall, MAT.cairn);
    r.scale.set(s * 2, s * 1.4, s * 2);
    r.position.set(rand(-0.05, 0.05), y + s * 0.5, rand(-0.05, 0.05));
    r.rotation.y = rand(0, Math.PI);
    g.add(r);
    y += s * 0.75;
  }
  return g;
}

function createSegment(index) {
  const group = new THREE.Group();

  // maybe a lochan, carved permanently into this segment's moor
  let lochan = null;
  if (Math.random() < 0.3) {
    const side = Math.random() < 0.5 ? -1 : 1;
    lochan = { x: side * rand(7.5, 11.5), z: rand(-6, 6), r: rand(3, 5) };
  }
  const field = makeMoorField(index * SEG_LEN, lochan);
  const moorH = field.height;

  // path
  const pathGeo = new THREE.PlaneGeometry(PATH_W, SEG_LEN);
  pathGeo.rotateX(-Math.PI / 2);
  group.add(new THREE.Mesh(pathGeo, MAT.path));

  // moorland both sides
  group.add(new THREE.Mesh(buildMoorGeometry(-1, field), MAT.moor));
  group.add(new THREE.Mesh(buildMoorGeometry(1, field), MAT.moor));

  if (lochan) {
    const water = new THREE.Mesh(GEO.lochan, MAT.lochan);
    water.rotation.x = -Math.PI / 2;
    water.position.set(lochan.x, 0.3, lochan.z);
    water.scale.set(lochan.r * 0.95, lochan.r * 0.8, 1);
    group.add(water);
  }

  // decorative instancing (randomised once — variety comes from bogs/pickups)
  const heather = new THREE.InstancedMesh(GEO.heather, MAT.heather, 130);
  scatterInstances(heather, 130, HEATHER_COLS, [0.35, 0.9], 0.28, 0.5, moorH);
  group.add(heather);
  const tufts = new THREE.InstancedMesh(GEO.tuft, MAT.tuft, 100);
  scatterInstances(tufts, 100, TUFT_COLS, [0.5, 1.1], 0.3, 0.8, moorH);
  group.add(tufts);
  const rocks = new THREE.InstancedMesh(GEO.rockSmall, MAT.rockDark, 16);
  scatterInstances(rocks, 16, null, [0.4, 1.4], 0.2, 0.7, moorH);
  group.add(rocks);

  // small surface pebbles on the track — purely cosmetic
  const pebbles = new THREE.InstancedMesh(GEO.pebble, MAT.pebble, 60);
  {
    const col = new THREE.Color();
    for (let i = 0; i < 60; i++) {
      const s = rand(0.5, 1.5);
      dummy.position.set(rand(-1.55, 1.55), 0.012, rand(-SEG_LEN / 2, SEG_LEN / 2));
      dummy.scale.set(s, s * 0.4, s);
      dummy.rotation.set(rand(0, 3), rand(0, 3), 0);
      dummy.updateMatrix();
      pebbles.setMatrixAt(i, dummy.matrix);
      col.copy(pick(PEBBLE_COLS)).multiplyScalar(rand(0.85, 1.1));
      pebbles.setColorAt(i, col);
    }
    pebbles.instanceMatrix.needsUpdate = true;
    pebbles.instanceColor.needsUpdate = true;
  }
  group.add(pebbles);

  // rocky crags breaking through the higher slopes
  const crags = new THREE.InstancedMesh(GEO.crag, MAT.crag, 6);
  {
    let placed = 0, guard = 0;
    while (placed < 6 && guard++ < 48) {
      const side = Math.random() < 0.5 ? -1 : 1;
      const x = side * rand(13, 30), z = rand(-SEG_LEN / 2, SEG_LEN / 2);
      const h = moorH(x, z);
      if (h < 3.5) continue;
      dummy.position.set(x, h - rand(0.5, 1.1), z);
      dummy.scale.set(rand(2, 4.5), rand(1.2, 2.6), rand(2, 4.5));
      dummy.rotation.set(rand(-0.3, 0.3), rand(0, Math.PI), rand(-0.25, 0.25));
      dummy.updateMatrix();
      crags.setMatrixAt(placed++, dummy.matrix);
    }
    crags.count = placed;
    crags.instanceMatrix.needsUpdate = true;
  }
  group.add(crags);

  // pools -------------------------------------------------
  const ud = group.userData;
  ud.bogs = [];        // {x, z, rx, rz, plankLane}
  ud.obstacles = [];   // {x, z, r, hit, mesh, kind}
  ud.pickups = [];     // {x, z, kind, mesh, taken}
  ud.sheep = null;

  ud.bogMeshes = [];
  for (let i = 0; i < 6; i++) {
    const b = new THREE.Mesh(GEO.bog, MAT.bog);
    b.rotation.x = -Math.PI / 2;
    b.position.y = 0.015;
    b.visible = false;
    const rim = new THREE.Mesh(GEO.bogRim, MAT.bogRim);
    rim.position.z = 0.002; // local +z is world up after the parent's rotation
    b.add(rim);
    group.add(b);
    ud.bogMeshes.push(b);
  }
  ud.plankMeshes = [];
  for (let i = 0; i < 3; i++) {
    const p = new THREE.Mesh(GEO.plank, MAT.plank);
    p.visible = false;
    group.add(p);
    ud.plankMeshes.push(p);
  }
  ud.rockMeshes = [];
  for (let i = 0; i < 3; i++) {
    const r = new THREE.Mesh(GEO.rockObs, MAT.rock);
    r.visible = false;
    group.add(r);
    ud.rockMeshes.push(r);
  }
  ud.sheepMesh = makeSheep();
  ud.sheepMesh.visible = false;
  group.add(ud.sheepMesh);

  ud.canMeshes = [];
  for (let i = 0; i < 2; i++) {
    const can = new THREE.Group();
    const body = new THREE.Mesh(GEO.canBody, MAT.can);
    const cap = new THREE.Mesh(GEO.canCap, MAT.canCap);
    cap.position.y = 0.26;
    can.add(body, cap);
    can.visible = false;
    group.add(can);
    ud.canMeshes.push(can);
  }
  ud.cakeMeshes = [];
  for (let i = 0; i < 2; i++) {
    const cake = new THREE.Mesh(GEO.cake, MAT.cake);
    cake.rotation.x = 0.5;
    cake.visible = false;
    group.add(cake);
    ud.cakeMeshes.push(cake);
  }
  // cotton grass (near bogs)
  ud.cotton = new THREE.InstancedMesh(GEO.cottonHead, MAT.cotton, 20);
  ud.cottonStems = new THREE.InstancedMesh(GEO.cottonStem, MAT.stem, 20);
  group.add(ud.cotton, ud.cottonStems);

  // moss fringing the bogs — repositioned per recycle so each bog differs
  ud.moss = new THREE.InstancedMesh(GEO.moss, MAT.moss, 30);
  ud.moss.count = 0;
  group.add(ud.moss);

  // a red deer stag out on the moor, some of the time
  ud.stagMesh = makeStag();
  ud.stagMesh.visible = false;
  ud.stagPhase = rand(0, 6.28);
  group.add(ud.stagMesh);

  ud.moorH = moorH;
  ud.cairn = makeCairn();
  ud.cairn.visible = false;
  group.add(ud.cairn);

  group.position.z = -index * SEG_LEN;
  scene.add(group);
  segments.push(group);
  return group;
}

// difficulty knobs as a function of distance travelled
function difficulty(d) {
  return {
    nBogs: clamp(1 + Math.floor(d / 350) + (Math.random() < 0.4 ? 1 : 0), 1, 3),
    bigBogChance: smoothstep(200, 1400, d) * 0.55,
    rockChance: smoothstep(60, 700, d) * 0.8,
    sheepChance: d > 250 ? 0.16 : 0,
    canChance: 0.15,
    cakeChance: 0.22,
  };
}

let cairnCounter = 0; // distance of next cairn
function regenerateSegment(seg, distAtSegment) {
  const ud = seg.userData;
  ud.bogs.length = 0;
  ud.obstacles.length = 0;
  ud.pickups.length = 0;
  ud.bogMeshes.forEach(m => m.visible = false);
  ud.plankMeshes.forEach(m => m.visible = false);
  ud.rockMeshes.forEach(m => m.visible = false);
  ud.canMeshes.forEach(m => m.visible = false);
  ud.cakeMeshes.forEach(m => m.visible = false);
  ud.sheepMesh.visible = false;
  ud.sheep = null;
  ud.cotton.count = 0;
  ud.cottonStems.count = 0;
  ud.moss.count = 0;
  ud.cairn.visible = false;

  // an ambient stag, grazing well off the track
  ud.stagMesh.visible = false;
  if (Math.random() < 0.2) {
    const side = Math.random() < 0.5 ? -1 : 1;
    const sx = side * rand(13, 25), sz = rand(-13, 13);
    const sh = ud.moorH(sx, sz);
    if (sh > 0.3) {
      ud.stagMesh.visible = true;
      ud.stagMesh.position.set(sx, sh - 0.05, sz);
      ud.stagMesh.rotation.y = rand(0, Math.PI * 2);
      const s = rand(0.85, 1.1);
      ud.stagMesh.scale.setScalar(s);
    }
  }

  if (distAtSegment < 25) return; // brief gentle start

  const D = difficulty(distAtSegment);

  // --- bogs, spaced along the segment ---
  const slots = [];
  for (let z = -SEG_LEN / 2 + 4; z < SEG_LEN / 2 - 3; z += 6) slots.push(z + rand(-1.2, 1.2));
  const nBogs = Math.min(D.nBogs, slots.length, ud.bogMeshes.length);
  const used = slots.slice();
  let plankIdx = 0, cottonIdx = 0, mossIdx = 0;
  const mossCol = new THREE.Color();
  for (let i = 0; i < nBogs; i++) {
    const zi = randi(0, used.length - 1);
    const z = used.splice(zi, 1)[0];
    const big = Math.random() < D.bigBogChance;
    const bog = big
      ? { x: rand(-0.3, 0.3), z, rx: rand(1.5, 1.9), rz: rand(1.6, 3.0), plankLane: -1 }
      : { x: pick(LANES) + rand(-0.15, 0.15), z, rx: rand(0.55, 0.85), rz: rand(0.9, 2.0), plankLane: -1 };
    // full-width bogs sometimes get a plank line across one lane
    if (big && Math.random() < 0.55 && plankIdx < ud.plankMeshes.length) {
      bog.plankLane = randi(0, 2);
      const p = ud.plankMeshes[plankIdx++];
      p.visible = true;
      p.position.set(LANES[bog.plankLane], 0.06, z);
      p.scale.set(1, 1, bog.rz * 2 + 0.8);
      p.rotation.y = rand(-0.04, 0.04);
    }
    ud.bogs.push(bog);
    const m = ud.bogMeshes[i];
    m.visible = true;
    m.position.set(bog.x, 0.015 + i * 0.001, bog.z);
    m.scale.set(bog.rx, bog.rz, 1);
    // moss fringe — count, spread and colour vary per bog
    const nMoss = randi(3, 8);
    const mossSpread = rand(1.05, 1.4);
    const mossBase = pick(MOSS_COLS);
    for (let mi = 0; mi < nMoss && mossIdx < 30; mi++, mossIdx++) {
      const a = rand(0, Math.PI * 2);
      const mx = bog.x + Math.cos(a) * bog.rx * mossSpread * rand(0.9, 1.15);
      const mz = bog.z + Math.sin(a) * bog.rz * mossSpread * rand(0.9, 1.15);
      const s = rand(0.28, 0.7);
      dummy.position.set(mx, 0.02, mz);
      dummy.scale.set(s, s * 0.28, s);
      dummy.rotation.set(0, rand(0, Math.PI * 2), 0);
      dummy.updateMatrix();
      ud.moss.setMatrixAt(mossIdx, dummy.matrix);
      mossCol.copy(mossBase).multiplyScalar(rand(0.8, 1.15));
      ud.moss.setColorAt(mossIdx, mossCol);
    }

    // cotton grass at the rim
    for (let cgi = 0; cgi < 3 && cottonIdx < 20; cgi++, cottonIdx++) {
      const a = rand(0, Math.PI * 2);
      const cx = bog.x + Math.cos(a) * (bog.rx + rand(0.2, 0.5));
      const cz = bog.z + Math.sin(a) * (bog.rz + rand(0.2, 0.5));
      const ground = ud.moorH(cx, cz);
      dummy.position.set(cx, ground + 0.38, cz);
      dummy.scale.setScalar(rand(0.8, 1.3));
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      ud.cotton.setMatrixAt(cottonIdx, dummy.matrix);
      dummy.position.y = ground + 0.18;
      dummy.updateMatrix();
      ud.cottonStems.setMatrixAt(cottonIdx, dummy.matrix);
    }
  }
  ud.cotton.count = cottonIdx;
  ud.cottonStems.count = cottonIdx;
  ud.cotton.instanceMatrix.needsUpdate = true;
  ud.cottonStems.instanceMatrix.needsUpdate = true;
  ud.moss.count = mossIdx;
  ud.moss.instanceMatrix.needsUpdate = true;
  if (ud.moss.instanceColor) ud.moss.instanceColor.needsUpdate = true;

  // --- pickups first, so bogs/rocks never starve them of slots ---
  const placePickup = (mesh, kind) => {
    if (!used.length) return;
    const z = used.splice(randi(0, used.length - 1), 1)[0];
    const lane = pick(LANES);
    mesh.visible = true;
    mesh.position.set(lane, 1.0, z);
    ud.pickups.push({ x: lane, z, kind, mesh, taken: false });
  };
  if (Math.random() < D.canChance) placePickup(ud.canMeshes[0], 'spray');
  if (Math.random() < D.cakeChance) placePickup(ud.cakeMeshes[0], 'cake');

  // --- rock obstacles (jump or dodge) ---
  let rockIdx = 0;
  for (const z of used.slice()) {
    if (rockIdx >= ud.rockMeshes.length) break;
    if (Math.random() < D.rockChance * 0.35) {
      const zi = used.indexOf(z);
      used.splice(zi, 1);
      const lane = pick(LANES);
      const r = ud.rockMeshes[rockIdx++];
      r.visible = true;
      r.position.set(lane, 0.3, z);
      r.rotation.set(rand(0, 3), rand(0, 3), 0);
      r.scale.setScalar(rand(0.85, 1.15));
      ud.obstacles.push({ x: lane, z, r: 0.55, hit: false, mesh: r, kind: 'rock' });
    }
  }

  // --- a sheep on the track ---
  if (Math.random() < D.sheepChance && used.length) {
    const z = used.splice(randi(0, used.length - 1), 1)[0];
    ud.sheepMesh.visible = true;
    ud.sheepMesh.position.set(pick(LANES), 0, z);
    ud.sheepMesh.rotation.y = rand(0, Math.PI * 2);
    ud.sheep = { z, dir: Math.random() < 0.5 ? -1 : 1, hit: false };
    ud.obstacles.push({ x: 0, z, r: 0.62, hit: false, mesh: ud.sheepMesh, kind: 'sheep' });
  }

  // --- a cairn marks every 500 m ---
  if (distAtSegment >= cairnCounter) {
    cairnCounter += 500;
    ud.cairn.visible = true;
    const cx = pick([-2.6, 2.6]), cz = rand(-8, 8);
    ud.cairn.position.set(cx, ud.moorH(cx, cz) - 0.12, cz);
  }
}

for (let i = 0; i < NUM_SEGS; i++) createSegment(i);

// ---------- player ----------
const player = new THREE.Group();
scene.add(player);

// Westerlands CCC kit: yellow singlet, big black W on the back
function makeSingletTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#f0c828';
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#16160f';
  g.font = '900 100px "Arial Black", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('W', 64, 68);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const singlet = new THREE.MeshLambertMaterial({ color: 0xf0c828 });
const singletBack = new THREE.MeshLambertMaterial({ map: makeSingletTexture() });
const shortsMat = new THREE.MeshLambertMaterial({ color: 0x1d1d20 });
const skin = new THREE.MeshLambertMaterial({ color: 0xd9a678 });
const capMat = new THREE.MeshLambertMaterial({ color: 0xc23b2a });
const bagMat = new THREE.MeshLambertMaterial({ color: 0x2e3038 });

// rounded torso; the big W rides a bib plane on the back (local -z faces the
// camera). Grouped so the running lean carries the bib with it.
const torso = new THREE.Group();
torso.position.y = 0.98;
const torsoMesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.3, 4, 12), singlet);
torsoMesh.scale.set(1, 1, 0.62);
torso.add(torsoMesh);
const bib = new THREE.Mesh(new THREE.PlaneGeometry(0.27, 0.3), singletBack);
bib.position.set(0, 0.04, -0.135);
bib.rotation.y = Math.PI;
torso.add(bib);
player.add(torso);

const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 14, 12), skin);
head.position.y = 1.38;
player.add(head);

// running cap: domed crown + brim pointing forward (local +z)
const capCrown = new THREE.Mesh(
  new THREE.SphereGeometry(0.155, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), capMat);
capCrown.scale.set(1, 0.72, 1);
capCrown.position.y = 1.44;
player.add(capCrown);
const capBrim = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.022, 0.14), capMat);
capBrim.position.set(0, 1.455, 0.19);
capBrim.rotation.x = 0.1;
player.add(capBrim);

// bumbag: pouch at the small of the back + a waist strap
const bumbag = new THREE.Mesh(new THREE.BoxGeometry(0.27, 0.12, 0.1), bagMat);
bumbag.position.set(0, 0.68, -0.15);
player.add(bumbag);
const strap = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.045, 0.26), bagMat);
strap.position.y = 0.7;
player.add(strap);

function limb(mat, w, len) {
  const g = new THREE.Group();
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(w * 0.62, len - w, 3, 10), mat);
  m.position.y = -len / 2;
  g.add(m);
  return g;
}
const legL = limb(skin, 0.13, 0.55); legL.position.set(-0.11, 0.68, 0);
const legR = limb(skin, 0.13, 0.55); legR.position.set(0.11, 0.68, 0);

// black running shorts, one loose leg per side so they swing with the stride
for (const leg of [legL, legR]) {
  const shortLeg = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.26, 0.18), shortsMat);
  shortLeg.position.y = -0.12;
  leg.add(shortLeg);
}

// inov-8 fell shoes: red uppers, grippy yellow studded sole
const shoeUpper = new THREE.MeshLambertMaterial({ color: 0xd8262c });
const shoeSole = new THREE.MeshLambertMaterial({ color: 0xf2c230 });
for (const leg of [legL, legR]) {
  const upper = new THREE.Mesh(new THREE.BoxGeometry(0.155, 0.1, 0.3), shoeUpper);
  upper.position.set(0, -0.52, 0.06);
  const sole = new THREE.Mesh(new THREE.BoxGeometry(0.165, 0.045, 0.33), shoeSole);
  sole.position.set(0, -0.585, 0.06);
  leg.add(upper, sole);
}
const armL = limb(skin, 0.1, 0.45); armL.position.set(-0.27, 1.16, 0);
const armR = limb(skin, 0.1, 0.45); armR.position.set(0.27, 1.16, 0);
player.add(legL, legR, armL, armR);

// blob shadow
const blobShadow = new THREE.Mesh(
  new THREE.CircleGeometry(0.42, 16),
  new THREE.MeshBasicMaterial({ color: 0x1a1a12, transparent: true, opacity: 0.35, depthWrite: false })
);
blobShadow.rotation.x = -Math.PI / 2;
blobShadow.position.y = 0.02;
scene.add(blobShadow);

// boost glow
const boostGlow = new THREE.Sprite(new THREE.SpriteMaterial({
  map: makeGlowTexture('rgba(255,200,90,0.9)', 'rgba(255,180,60,0)'),
  transparent: true, opacity: 0, depthWrite: false,
}));
boostGlow.scale.set(2.4, 2.4, 1);
player.add(boostGlow);
boostGlow.position.y = 1.0;

player.rotation.y = Math.PI; // face away from camera

// ---------- midge swarm ----------
const MIDGE_N = 240;
const midgeGeo = new THREE.BufferGeometry();
const midgePos = new Float32Array(MIDGE_N * 3);
midgeGeo.setAttribute('position', new THREE.BufferAttribute(midgePos, 3));
const midgeSeeds = [];
for (let i = 0; i < MIDGE_N; i++) {
  midgeSeeds.push({ a: rand(0, 6.28), b: rand(0, 6.28), r: rand(0.15, 0.85), s: rand(4, 11) });
}
const midges = new THREE.Points(midgeGeo, new THREE.PointsMaterial({
  color: 0x22201c, size: 0.05, transparent: true, opacity: 0.9, sizeAttenuation: true,
}));
midges.visible = false;
midges.frustumCulled = false;
scene.add(midges);

// ---------- particles (splash / spray / crumbs) ----------
const PART_N = 400;
const partGeo = new THREE.BufferGeometry();
const partPos = new Float32Array(PART_N * 3);
partGeo.setAttribute('position', new THREE.BufferAttribute(partPos, 3));
const partData = [];
for (let i = 0; i < PART_N; i++) partData.push({ life: 0, vx: 0, vy: 0, vz: 0 });
const particles = new THREE.Points(partGeo, new THREE.PointsMaterial({
  color: 0x4a3b22, size: 0.09, transparent: true, opacity: 0.9,
}));
particles.frustumCulled = false;
scene.add(particles);
let partCursor = 0;
function spawnParticles(n, x, y, z, spread, vy, color) {
  if (color) particles.material.color.set(color);
  for (let i = 0; i < n; i++) {
    const idx = partCursor = (partCursor + 1) % PART_N;
    const p = partData[idx];
    p.life = rand(0.35, 0.8);
    p.vx = rand(-spread, spread);
    p.vy = rand(vy * 0.5, vy * 1.4);
    p.vz = rand(-spread, spread);
    partPos[idx * 3] = x + rand(-0.2, 0.2);
    partPos[idx * 3 + 1] = y;
    partPos[idx * 3 + 2] = z + rand(-0.2, 0.2);
  }
}
function updateParticles(dt) {
  for (let i = 0; i < PART_N; i++) {
    const p = partData[i];
    if (p.life <= 0) { partPos[i * 3 + 1] = -99; continue; }
    p.life -= dt;
    p.vy += GRAVITY * 0.35 * dt;
    partPos[i * 3] += p.vx * dt;
    partPos[i * 3 + 1] += p.vy * dt;
    partPos[i * 3 + 2] += p.vz * dt;
  }
  partGeo.attributes.position.needsUpdate = true;
}

// ---------- game state ----------
const S = {
  mode: 'menu',          // menu | playing | paused | over
  dist: 0,
  best: Number(localStorage.getItem('boghopper_best') || 0),
  lane: 1,
  px: 0, py: 0, pz: 0, vy: 0,
  grounded: true,
  coyote: 0,
  bogged: false,
  bogSplashT: 0,
  stuck: 0,              // seconds until bogged feet come free
  penalizedBog: null,    // bog that already took its entry toll
  stumble: 0,            // seconds of stumble remaining
  boost: 0,              // seconds of boost remaining
  spray: 1,
  cakes: 0,
  factor: 1,
  time: 0,
  // midges
  midgeState: 'idle',    // idle | warn | incoming | attack | flee
  midgeTimer: 34,        // seconds until next event
  midgeCenter: new THREE.Vector3(),
  shake: 0,
  overCause: '',
};

// ---------- usage beacons (no-op on pure static hosting) ----------
function track(type, dist) {
  try {
    const payload = JSON.stringify(dist == null ? { type } : { type, dist });
    if (navigator.sendBeacon) {
      navigator.sendBeacon('api/event', new Blob([payload], { type: 'application/json' }));
    } else {
      fetch('api/event', { method: 'POST', body: payload, keepalive: true }).catch(() => {});
    }
  } catch { /* analytics must never break the game */ }
}
track('visit');

// expose for debugging / automated tests
window.__bog = S;
window.__bogStep = (dt, n) => {
  for (let i = 0; i < n; i++) { update(dt); updateParticles(dt); }
  renderer.render(scene, camera);
};
window.__bogGL = () => ({
  calls: renderer.info.render.calls,
  tris: renderer.info.render.triangles,
  geometries: renderer.info.memory.geometries,
  textures: renderer.info.memory.textures,
});
window.__bogSegs = segments; // hazard layout, for headless play-testing

// ---------- input ----------
const startScreen = document.getElementById('startScreen');
const overScreen = document.getElementById('overScreen');
const pauseScreen = document.getElementById('pauseScreen');
const hud = document.getElementById('hud');
const msgEl = document.getElementById('msg');
let msgTimer = 0;

function showMsg(text, sub = '', dur = 2.2) {
  msgEl.innerHTML = text + (sub ? `<span class="sub">${sub}</span>` : '');
  msgEl.classList.add('on');
  msgTimer = dur;
}

function tryJump() {
  if (S.mode !== 'playing') return;
  if (S.bogged && S.stuck > 0) {
    // feet held fast — the mire has to let go first
    spawnParticles(4, S.px, 0.08, S.pz, 1.2, 2, 0x3d3018);
    return;
  }
  if (S.grounded || S.coyote > 0) {
    const mult = S.bogged ? BOG_JUMP_MULT : 1;
    S.vy = JUMP_V * mult;
    S.grounded = false;
    S.coyote = 0;
    if (S.bogged) {
      // hopping through the mire claws back a little ground
      S.pz = Math.max(0, S.pz - 0.45);
      spawnParticles(14, S.px, 0.1, S.pz, 2.2, 4.5, 0x3d3018);
    }
  }
}
function useSpray() {
  if (S.mode !== 'playing') return;
  if (S.midgeState === 'attack' || S.midgeState === 'incoming') {
    if (S.spray > 0) {
      S.spray--;
      S.midgeState = 'flee';
      showMsg('Smidged! 💨', 'the cloud lifts', 1.6);
      spawnParticles(30, S.px, 1.3, S.pz, 3.5, 2.0, 0xd8e8d0);
      flashInv('invSpray');
    } else {
      showMsg('Out of Smidge!', 'grab a 🧴 can from the path', 1.6);
    }
  } else if (S.spray > 0) {
    showMsg('Save the Smidge for the midges…', '', 1.2);
  }
}
function eatCake() {
  if (S.mode !== 'playing') return;
  if (S.cakes > 0 && S.boost <= 0) {
    S.cakes--;
    S.boost = BOOST_TIME;
    showMsg('Oatcake power! 🥮', 'Bog-proof and fast', 1.8);
    spawnParticles(16, S.px, 1.2, S.pz, 1.8, 3.0, 0xc79b58);
    flashInv('invCake');
  } else if (S.cakes === 0) {
    showMsg('No oatcakes left', 'Collect 🥮 along the way', 1.4);
  }
}
function flashInv(id) {
  const el = document.getElementById(id);
  el.classList.remove('flash');
  void el.offsetWidth;
  el.classList.add('flash');
}

window.addEventListener('keydown', (e) => {
  const k = e.code;
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space'].includes(k)) e.preventDefault();
  if (S.mode === 'menu' && (k === 'Space' || k === 'Enter')) { startGame(); return; }
  if (S.mode === 'over' && (k === 'KeyR' || k === 'Enter' || k === 'Space')) { startGame(); return; }
  switch (k) {
    case 'ArrowLeft': case 'KeyA': if (S.mode === 'playing') S.lane = Math.max(0, S.lane - 1); break;
    case 'ArrowRight': case 'KeyD': if (S.mode === 'playing') S.lane = Math.min(2, S.lane + 1); break;
    case 'ArrowUp': case 'KeyW': case 'Space': tryJump(); break;
    case 'KeyS': case 'ArrowDown': useSpray(); break;
    case 'KeyE': eatCake(); break;
    case 'KeyR': if (S.mode === 'playing') startGame(); break;
    case 'Escape': case 'KeyP':
      if (S.mode === 'playing') pauseGame();
      else if (S.mode === 'paused') resumeGame();
      break;
  }
});
document.getElementById('startBtn').addEventListener('click', startGame);
document.getElementById('againBtn').addEventListener('click', startGame);
document.getElementById('resumeBtn').addEventListener('click', resumeGame);
document.getElementById('quitBtn').addEventListener('click', quitToMenu);
window.addEventListener('blur', () => {
  if (S.mode === 'playing') pauseGame();
});

function pauseGame() {
  S.mode = 'paused';
  pauseScreen.classList.remove('hidden');
}
function resumeGame() {
  S.mode = 'playing';
  pauseScreen.classList.add('hidden');
}
function quitToMenu() {
  S.mode = 'menu';
  pauseScreen.classList.add('hidden');
  overScreen.classList.add('hidden');
  hud.classList.remove('on');
  msgTimer = 0; msgEl.classList.remove('on');
  startScreen.classList.remove('hidden');
}

// ---------- game flow ----------
function startGame() {
  S.mode = 'playing';
  S.dist = 0; S.lane = 1;
  S.px = 0; S.py = 0; S.pz = 0; S.vy = 0;
  S.grounded = true; S.bogged = false;
  S.stuck = 0; S.penalizedBog = null;
  S.stumble = 0; S.boost = 0;
  S.spray = 1; S.cakes = 0;
  S.midgeState = 'idle'; S.midgeTimer = rand(30, 42);
  S.time = 0; S.shake = 0;
  cairnCounter = 500;
  midges.visible = false;
  msgTimer = 0; msgEl.classList.remove('on');
  // reset track — each segment populated for the distance it sits at, so the
  // first obstacles appear within a few seconds rather than after 250 m
  segments.forEach((seg, i) => {
    seg.position.z = -i * SEG_LEN;
    regenerateSegment(seg, i * SEG_LEN);
  });
  startScreen.classList.add('hidden');
  overScreen.classList.add('hidden');
  hud.classList.add('on');
  updateHud(true);
  track('start');
}

function gameOver(cause) {
  S.mode = 'over';
  S.overCause = cause;
  const m = Math.floor(S.dist);
  const isBest = m > S.best;
  if (isBest) {
    S.best = m;
    localStorage.setItem('boghopper_best', String(m));
  }
  document.getElementById('overCause').textContent = cause;
  document.getElementById('overStats').innerHTML =
    `You made it <b>${m} m</b> along the glen` +
    (isBest ? `<div class="newBest">NEW BEST!</div>` : `<div>Best: ${S.best} m</div>`);
  overScreen.classList.remove('hidden');
  hud.classList.remove('on');
  track('over', m);
}

// ---------- HUD ----------
const distEl = document.getElementById('dist');
const bestEl = document.getElementById('best');
const sprayEl = document.getElementById('sprayN');
const cakeEl = document.getElementById('cakeN');
const sweepFill = document.getElementById('sweepFill');
const mistEl = document.getElementById('mist');

function updateHud(force) {
  distEl.innerHTML = `${Math.floor(S.dist)}<small>m</small>`;
  bestEl.textContent = `BEST ${S.best} m`;
  sprayEl.textContent = S.spray;
  cakeEl.textContent = S.cakes;
  const danger = clamp(S.pz / CAUGHT_Z, 0, 1);
  sweepFill.style.width = `${danger * 100}%`;
  mistEl.style.opacity = danger > 0.25 ? (danger - 0.25) * 1.2 : 0;
}

// ---------- core update ----------
function nominalSpeed() {
  return BASE_SPEED + (MAX_SPEED - BASE_SPEED) * smoothstep(0, SPEED_RAMP, S.dist);
}

function playerInBog() {
  if (S.py > 0.12) return null;
  for (const seg of segments) {
    const zBase = seg.position.z;
    for (const bog of seg.userData.bogs) {
      const wz = zBase + bog.z;
      const dz = S.pz - wz;
      const dx = S.px - bog.x;
      if (Math.abs(dz) < bog.rz && Math.abs(dx) < bog.rx) {
        // safe if on the plank lane
        if (bog.plankLane >= 0 && Math.abs(S.px - LANES[bog.plankLane]) < 0.34) continue;
        // elliptical-ish check
        if ((dx * dx) / (bog.rx * bog.rx) + (dz * dz) / (bog.rz * bog.rz) < 1) return bog;
      }
    }
  }
  return null;
}

function checkObstacles() {
  if (S.py > 0.55) return; // sailed over
  for (const seg of segments) {
    const zBase = seg.position.z;
    for (const ob of seg.userData.obstacles) {
      if (ob.hit) continue;
      const ox = ob.kind === 'sheep' ? ob.mesh.position.x : ob.x;
      const wz = zBase + ob.z;
      if (Math.abs(S.pz - wz) < ob.r && Math.abs(S.px - ox) < ob.r) {
        ob.hit = true;
        S.stumble = ob.kind === 'sheep' ? 1.0 : 0.7;
        S.shake = 0.35;
        S.pz = Math.min(CAUGHT_Z, S.pz + (ob.kind === 'sheep' ? 0.9 : 0.6));
        showMsg(ob.kind === 'sheep' ? 'Baaa! 🐑' : 'Stubbed a boulder!', '', 1.2);
        spawnParticles(10, S.px, 0.4, S.pz, 2.5, 3, 0x8d8d88);
      }
    }
  }
}

function checkPickups() {
  for (const seg of segments) {
    const zBase = seg.position.z;
    for (const pu of seg.userData.pickups) {
      if (pu.taken) continue;
      const wz = zBase + pu.z;
      const dy = (S.py + 0.9) - pu.mesh.position.y;
      if (Math.abs(S.pz - wz) < 0.85 && Math.abs(S.px - pu.x) < 0.6 && Math.abs(dy) < 1.2) {
        pu.taken = true;
        pu.mesh.visible = false;
        if (pu.kind === 'spray') {
          S.spray++;
          showMsg('+1 can of Smidge® 🧴', '', 1.2);
          flashInv('invSpray');
        } else {
          S.cakes++;
          showMsg('+1 oatcake 🥮', 'press E for a boost', 1.2);
          flashInv('invCake');
        }
      }
    }
  }
}

function updateMidges(dt) {
  const head = new THREE.Vector3(S.px, S.py + 1.35, S.pz);
  switch (S.midgeState) {
    case 'idle':
      S.midgeTimer -= dt;
      if (S.midgeTimer <= 0) {
        S.midgeState = 'warn';
        S.midgeTimer = 3;
        showMsg('You hear a faint whine…', 'midges incoming — ready the Smidge (S)', 2.6);
      }
      break;
    case 'warn':
      S.midgeTimer -= dt;
      if (S.midgeTimer <= 0) {
        S.midgeState = 'incoming';
        S.midgeCenter.set(S.px + pick([-4, 4]), 2.5, S.pz - 14);
        midges.visible = true;
      }
      break;
    case 'incoming':
      S.midgeCenter.lerp(head, 1 - Math.pow(0.25, dt));
      if (S.midgeCenter.distanceTo(head) < 0.5) {
        S.midgeState = 'attack';
        S.midgeTimer = 8;
        showMsg('Midge swarm! 🦟', 'S to Smidge them off', 2);
      }
      break;
    case 'attack':
      S.midgeCenter.copy(head);
      S.midgeTimer -= dt;
      if (S.midgeTimer <= 0) {
        S.midgeState = 'flee';
        showMsg('The midges lose interest…', '', 1.5);
      }
      break;
    case 'flee':
      S.midgeCenter.y += 4 * dt;
      S.midgeCenter.z -= 10 * dt;
      if (S.midgeCenter.y > 8) {
        S.midgeState = 'idle';
        S.midgeTimer = rand(24, 44);
        midges.visible = false;
      }
      break;
  }
  if (midges.visible) {
    const t = S.time;
    for (let i = 0; i < MIDGE_N; i++) {
      const m = midgeSeeds[i];
      midgePos[i * 3] = S.midgeCenter.x + Math.sin(t * m.s + m.a) * m.r + Math.sin(t * 2.3 + m.b) * 0.12;
      midgePos[i * 3 + 1] = S.midgeCenter.y + Math.sin(t * m.s * 0.8 + m.b) * m.r * 0.7;
      midgePos[i * 3 + 2] = S.midgeCenter.z + Math.cos(t * m.s + m.b) * m.r + Math.cos(t * 1.9 + m.a) * 0.12;
    }
    midgeGeo.attributes.position.needsUpdate = true;
  }
}

function update(dt) {
  S.time += dt;

  if (msgTimer > 0) {
    msgTimer -= dt;
    if (msgTimer <= 0) msgEl.classList.remove('on');
  }

  if (S.mode !== 'playing') return;

  // ----- speed factor -----
  S.stumble = Math.max(0, S.stumble - dt);
  S.boost = Math.max(0, S.boost - dt);
  const curBog = S.boost <= 0 ? playerInBog() : null;
  const wasBogged = S.bogged;
  S.bogged = !!curBog;
  S.stuck = Math.max(0, S.stuck - dt);
  if (S.bogged && !wasBogged) {
    spawnParticles(22, S.px, 0.1, S.pz, 2.8, 5, 0x3d3018);
    S.shake = Math.max(S.shake, 0.25);
    // each distinct bog grabs your feet: instant lost ground + a beat where
    // you can't jump out — blind jump-hammering pays the toll every landing
    if (curBog !== S.penalizedBog) {
      S.penalizedBog = curBog;
      S.pz += BOG_ENTRY_PENALTY;
      S.stuck = BOG_STUCK_TIME;
      showMsg('Bogged down! 💦', 'mash jump to hop free', 1.6);
    }
  }

  let factor = 1;
  if (S.boost > 0) factor = BOOST_FACTOR;
  else {
    if (S.bogged) factor *= BOG_FACTOR;
    if (S.midgeState === 'attack') factor *= MIDGE_FACTOR;
    if (S.stumble > 0) factor *= 0.6;
  }
  S.factor = factor;

  const spd = nominalSpeed();
  const scroll = spd * factor;
  S.dist += scroll * dt;

  // ----- the sweep: being slow pushes you toward the bottom of the screen -----
  if (S.boost > 0) {
    // an oatcake actively pulls you clear of the mist
    S.pz = Math.max(0, S.pz + (1 - factor) * spd * DRIFT_SCALE * dt);
  } else {
    S.pz += (1 - factor) * spd * DRIFT_SCALE * dt;
    if (factor >= 1) S.pz = Math.max(0, S.pz - RECOVER_RATE * dt);
  }
  if (S.pz >= CAUGHT_Z) {
    gameOver(S.bogged
      ? 'Bogged down, soaked through and swallowed by the mist.'
      : 'Too slow — the mist rolled in and took you.');
    return;
  }

  // ----- player lateral + vertical -----
  const targetX = LANES[S.lane];
  S.px = lerp(S.px, targetX, 1 - Math.pow(0.00025, dt));

  if (!S.grounded) {
    S.vy += GRAVITY * dt;
    S.py += S.vy * dt;
    if (S.py <= 0) {
      S.py = 0; S.vy = 0; S.grounded = true;
      if (playerInBog() && S.boost <= 0) {
        spawnParticles(18, S.px, 0.1, S.pz, 2.5, 5, 0x3d3018);
      } else {
        spawnParticles(6, S.px, 0.05, S.pz, 1.2, 1.5, 0x8f897a);
      }
    }
  } else {
    S.coyote = 0.09;
  }
  if (S.grounded) S.coyote = 0.09; else S.coyote -= dt;

  // ----- world scroll & recycling -----
  const dz = scroll * dt;
  for (const seg of segments) {
    seg.position.z += dz;
    if (seg.position.z - SEG_LEN / 2 > 26) {
      seg.position.z -= NUM_SEGS * SEG_LEN;
      regenerateSegment(seg, S.dist + NUM_SEGS * SEG_LEN * 0.5);
    }
    // sheep wander
    const ud = seg.userData;
    if (ud.sheep) {
      const sm = ud.sheepMesh;
      sm.position.x += ud.sheep.dir * 0.45 * dt;
      if (Math.abs(sm.position.x) > PATH_W / 2 - 0.3) ud.sheep.dir *= -1;
      sm.rotation.y = ud.sheep.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
      sm.position.y = Math.abs(Math.sin(S.time * 7)) * 0.03;
    }
    // stag grazing: slow head dips
    if (ud.stagMesh.visible) {
      ud.stagMesh.userData.headG.rotation.x =
        Math.max(0, Math.sin(S.time * 0.5 + ud.stagPhase)) * 0.55;
    }
    // pickup spin/bob
    for (const pu of ud.pickups) {
      if (pu.taken) continue;
      pu.mesh.rotation.y += 2.2 * dt;
      pu.mesh.position.y = 1.0 + Math.sin(S.time * 2.5 + pu.z) * 0.12;
    }
  }

  // ----- collisions -----
  checkObstacles();
  checkPickups();
  updateMidges(dt);

  // ----- player visuals -----
  const sink = S.bogged ? -0.14 : 0;
  player.position.set(S.px, S.py + sink, S.pz);
  blobShadow.position.set(S.px, 0.02, S.pz);
  blobShadow.material.opacity = clamp(0.38 - S.py * 0.12, 0.1, 0.38);
  blobShadow.scale.setScalar(clamp(1 - S.py * 0.15, 0.6, 1));

  const runRate = 9 + scroll * 0.35;
  if (S.grounded) {
    const sw = Math.sin(S.time * runRate) * (S.bogged ? 0.45 : 0.8);
    legL.rotation.x = sw;
    legR.rotation.x = -sw;
    armL.rotation.x = -sw * 0.8;
    armR.rotation.x = sw * 0.8;
    torso.rotation.x = 0.12 + Math.sin(S.time * runRate * 2) * 0.02;
    player.position.y += Math.abs(Math.sin(S.time * runRate)) * 0.05;
  } else {
    legL.rotation.x = 0.5; legR.rotation.x = -0.35;
    armL.rotation.x = -0.7; armR.rotation.x = 0.6;
    torso.rotation.x = 0.18;
  }
  player.rotation.z = (S.px - targetX) * 0.25;

  boostGlow.material.opacity = S.boost > 0 ? 0.35 + Math.sin(S.time * 12) * 0.15 : 0;

  // bogged: periodic splashes
  if (S.bogged) {
    S.bogSplashT -= dt;
    if (S.bogSplashT <= 0) {
      S.bogSplashT = 0.22;
      spawnParticles(5, S.px, 0.08, S.pz, 1.6, 3, 0x3d3018);
    }
  }

  // ----- camera -----
  S.shake = Math.max(0, S.shake - dt);
  const shx = S.shake > 0 ? rand(-1, 1) * S.shake * 0.12 : 0;
  const shy = S.shake > 0 ? rand(-1, 1) * S.shake * 0.1 : 0;
  camera.position.x = lerp(camera.position.x, S.px * 0.45 + shx, 1 - Math.pow(0.001, dt));
  camera.position.y = 3.8 + shy;
  camera.lookAt(S.px * 0.65, 1.05, S.pz - 2.5);

  // ----- background parallax -----
  for (const r of ridges) {
    r.tex.offset.x = S.dist * r.drift;
    r.mesh.position.x = -S.px * r.sway * 30;
  }
  for (const c of clouds) {
    c.sprite.position.x += c.speed * dt;
    if (c.sprite.position.x > 380) c.sprite.position.x = -380;
  }

  updateHud();
}

// ---------- main loop ----------
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  update(dt);
  updateParticles(dt);
  renderer.render(scene, camera);
}
requestAnimationFrame(frame);

// menu idle: slow scroll for ambience
setInterval(() => {
  if (S.mode === 'menu') {
    for (const seg of segments) {
      seg.position.z += 0.06;
      if (seg.position.z - SEG_LEN / 2 > 26) {
        seg.position.z -= NUM_SEGS * SEG_LEN;
        regenerateSegment(seg, 0);
      }
    }
  }
}, 16);
