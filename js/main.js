import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { PROJECTS } from './projects.js';

/* =========================================================
   CONSTANTS & HELPERS
   ========================================================= */
const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

const COLOR = {
  ivory: 0xf3eee4,
  beige: 0xd8c9b0,
  sand: 0xe9dfcd,
  charcoal: 0x2a2a2d,
  gold: 0xc8a45d,
  white: 0xfaf8f3
};

const WALL_H = 5;
const WALL_T = 0.4;
const PLAYER_RADIUS = 0.42;
const MOVE_SPEED = 4.2;
const INTERACT_RANGE = 3.8;

/* =========================================================
   STATE
   ========================================================= */
let renderer, scene, camera, clock, sun;
let maxAniso = 1;
let started = false;

const colliders = [];      // {minX,maxX,minZ,maxZ}
const camBlockers = [];    // meshes the camera must not pass through
const displays = [];       // exhibition displays
const spinners = [];       // slowly rotating decorative meshes
const keys = new Set();

let character;             // {group, parts}
const playerPos = new THREE.Vector3(0, 0, 7);
let playerHeading = Math.PI;   // facing -Z (towards the hall)
let moveAmount = 0;
let walkPhase = 0;

let camYaw = 0;
let camPitch = 0.34;
let camDist = 5.2;
let camDistCurrent = 5.2;
const camLook = new THREE.Vector3(0, 1.45, 7);
const raycaster = new THREE.Raycaster();

let panelOpen = false;
let activeDisplay = null;
let lastFocus = null;

/* =========================================================
   UI: WELCOME, PANEL, TOAST
   ========================================================= */
$('enterBtn').addEventListener('click', enterExhibition);

async function enterExhibition() {
  if (started) return;
  started = true;
  const loading = $('loading');
  loading.classList.add('show');
  $('welcome').classList.add('fade-out');

  // let the loading screen paint before heavy work
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

  try {
    initThree();
    buildMuseum();
    buildPlayer();
    setupInput();
    onResize();
    updateCamera(0, true);
    clock = new THREE.Clock();
    tick();

    setTimeout(() => {
      loading.classList.add('fade-out');
      $('hint').classList.add('show');
      setTimeout(() => loading.classList.remove('show'), 700);
      setTimeout(() => $('hint').classList.remove('show'), 10000);
    }, 400);
  } catch (err) {
    console.error(err);
    $('loadingText').textContent = 'Sorry, the exhibition could not start. Please use a modern browser with WebGL enabled.';
    $('loading').querySelector('.spinner').style.display = 'none';
    started = false;
  }
}

let toastTimer;
function showToast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
}

const galleryCache = new Map();
function getGallery(project) {
  if (galleryCache.has(project.id)) return galleryCache.get(project.id);
  const urls = [0, 1, 2].map((v) => {
    const c = document.createElement('canvas');
    c.width = 960;
    c.height = 540;
    drawArt(c, project, v, v === 0);
    return c.toDataURL('image/jpeg', 0.88);
  });
  galleryCache.set(project.id, urls);
  return urls;
}

function openPanel(project) {
  panelOpen = true;
  keys.clear();
  lastFocus = document.activeElement;
  hidePrompt();

  $('pTitle').textContent = project.title;
  $('pCreator').textContent = project.creator;
  $('pCategory').textContent = project.category;
  $('pDesc').textContent = project.description;
  $('pDate').textContent = new Date(project.date).toLocaleDateString(undefined, {
    year: 'numeric', month: 'long', day: 'numeric'
  });

  const chips = $('pTech');
  chips.innerHTML = '';
  project.technologies.forEach((t) => {
    const s = document.createElement('span');
    s.textContent = t;
    chips.appendChild(s);
  });

  const link = $('pLink');
  if (project.link) {
    link.href = project.link;
    link.style.display = '';
  } else {
    link.style.display = 'none';
  }

  const imgs = getGallery(project);
  const main = $('pMain');
  main.src = imgs[0];
  main.alt = project.title + ' — image 1';
  const thumbs = $('pThumbs');
  thumbs.innerHTML = '';
  imgs.forEach((src, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('aria-label', 'Show image ' + (i + 1));
    if (i === 0) b.classList.add('active');
    const im = document.createElement('img');
    im.src = src;
    im.alt = '';
    b.appendChild(im);
    b.addEventListener('click', () => {
      main.src = src;
      main.alt = project.title + ' — image ' + (i + 1);
      thumbs.querySelectorAll('button').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
    });
    thumbs.appendChild(b);
  });

  $('panel').classList.add('open');
  $('panelClose').focus();
}

function closePanel() {
  if (!panelOpen) return;
  panelOpen = false;
  $('panel').classList.remove('open');
  if (lastFocus && lastFocus.focus) lastFocus.blur();
}

$('panelClose').addEventListener('click', closePanel);
$('panel').addEventListener('pointerdown', (e) => {
  if (e.target === $('panel')) closePanel();
});
$('pAsk').addEventListener('click', () => {
  showToast('Questions to creators will be enabled in Phase 4 (after Firebase login).');
});
$('prompt').addEventListener('click', () => {
  if (activeDisplay && !panelOpen) openPanel(activeDisplay.project);
});

function showPrompt(text) {
  $('promptText').textContent = text;
  $('prompt').classList.add('show');
}
function hidePrompt() {
  $('prompt').classList.remove('show');
}

/* =========================================================
   THREE.JS SETUP
   ========================================================= */
function initThree() {
  const canvas = $('scene');
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0xd9d0bf);

  // Soft reflections for the polished floor and gold
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.55;
  pmrem.dispose();

  camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 120);

  window.addEventListener('resize', onResize);
}

function onResize() {
  if (!renderer) return;
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
}

/* =========================================================
   MATERIAL / MESH HELPERS
   ========================================================= */
function std(color, rough = 0.8, metal = 0, extra = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, ...extra });
}

function addBox(parent, w, h, d, mat, x, y, z, opts = {}) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = opts.cast !== false;
  m.receiveShadow = opts.receive !== false;
  parent.add(m);
  return m;
}

function textTexture(text, w, h, { font, color, bg = null, spacing = null }) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (bg) {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
  }
  ctx.fillStyle = color;
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (spacing && 'letterSpacing' in ctx) ctx.letterSpacing = spacing;
  ctx.fillText(text, w / 2, h / 2 + h * 0.03);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAniso;
  return tex;
}

function textPlane(text, pw, ph, opts, px = 1024) {
  const tex = textTexture(text, px, Math.round((px * ph) / pw), opts);
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false });
  return new THREE.Mesh(new THREE.PlaneGeometry(pw, ph), mat);
}

/* ----- seeded random + generated artwork (placeholder images) ----- */
function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function rng(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function drawArt(canvas, project, variant, withText) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  const rand = rng(hashStr(project.id) + variant * 977);

  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, '#1c1c1f');
  g.addColorStop(0.6, '#2c2a2e');
  g.addColorStop(1, project.accent);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  for (let i = 0; i < 16; i++) {
    const x = rand() * w;
    const y = rand() * h;
    const r = (0.06 + rand() * 0.22) * h;
    ctx.globalAlpha = 0.08 + rand() * 0.22;
    const pick = rand();
    ctx.fillStyle = pick > 0.66 ? '#f3eee4' : pick > 0.33 ? '#c8a45d' : project.accent;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.globalAlpha = 0.22;
  ctx.strokeStyle = '#f3eee4';
  ctx.lineWidth = Math.max(1, w / 640);
  if (variant === 1) {
    for (let x = 0; x <= w; x += w / 16) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    }
    for (let y = 0; y <= h; y += w / 16) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }
  } else if (variant === 2) {
    for (let i = -h; i < w; i += w / 22) {
      ctx.beginPath(); ctx.moveTo(i, h); ctx.lineTo(i + h, 0); ctx.stroke();
    }
  } else {
    for (let i = 1; i < 9; i++) {
      ctx.beginPath();
      ctx.arc(w * 0.75, h * 0.35, i * h * 0.1, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;

  if (!withText) return;

  const shade = ctx.createLinearGradient(0, h * 0.45, 0, h);
  shade.addColorStop(0, 'rgba(10,10,12,0)');
  shade.addColorStop(1, 'rgba(10,10,12,0.78)');
  ctx.fillStyle = shade;
  ctx.fillRect(0, h * 0.45, w, h * 0.55);

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#c8a45d';
  ctx.font = `500 ${Math.round(w * 0.019)}px Arial, sans-serif`;
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${Math.round(w * 0.004)}px`;
  ctx.fillText(project.category.toUpperCase(), w * 0.05, h * 0.72);

  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  ctx.fillStyle = '#faf8f3';
  ctx.font = `600 ${Math.round(w * 0.06)}px Georgia, serif`;
  ctx.fillText(project.title, w * 0.05, h * 0.86);

  ctx.fillStyle = 'rgba(250,248,243,0.75)';
  ctx.font = `300 ${Math.round(w * 0.02)}px Arial, sans-serif`;
  ctx.fillText('by ' + project.creator, w * 0.05, h * 0.93);
}

/* =========================================================
   MUSEUM
   ========================================================= */
function floorTexture(w, d) {
  const size = 512;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const tiles = 2;
  const ts = size / tiles;
  const base = ['#e6dac5', '#e0d3bb', '#eadfcb', '#ddd0b8'];
  for (let i = 0; i < tiles; i++) {
    for (let j = 0; j < tiles; j++) {
      ctx.fillStyle = base[(i * 2 + j) % base.length];
      ctx.fillRect(i * ts, j * ts, ts, ts);
      // subtle marble veining
      ctx.strokeStyle = 'rgba(160,140,110,0.10)';
      ctx.lineWidth = 1.5;
      for (let k = 0; k < 4; k++) {
        ctx.beginPath();
        const sx = i * ts + Math.random() * ts;
        const sy = j * ts + Math.random() * ts;
        ctx.moveTo(sx, sy);
        ctx.bezierCurveTo(sx + 40, sy + 20, sx + 20, sy + 70, sx + 80, sy + 100);
        ctx.stroke();
      }
    }
  }
  ctx.strokeStyle = 'rgba(120,100,70,0.35)';
  ctx.lineWidth = 2;
  for (let i = 0; i <= tiles; i++) {
    ctx.beginPath(); ctx.moveTo(i * ts, 0); ctx.lineTo(i * ts, size); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i * ts); ctx.lineTo(size, i * ts); ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(w / 4, d / 4);
  tex.anisotropy = maxAniso;
  return tex;
}

function addRoomShell(cx, cz, w, d) {
  // polished floor
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(w, d),
    std(0xffffff, 0.2, 0.12, { map: floorTexture(w, d) })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(cx, 0, cz);
  floor.receiveShadow = true;
  scene.add(floor);

  // ceiling (faces downward)
  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(w, d), std(COLOR.ivory, 0.95));
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.set(cx, WALL_H, cz);
  scene.add(ceiling);
  camBlockers.push(ceiling);

  // glowing ceiling light strips
  const stripMat = new THREE.MeshBasicMaterial({ color: 0xfff1d2, toneMapped: false });
  const count = Math.max(2, Math.round(w / 8));
  for (let i = 0; i < count; i++) {
    const x = cx - w / 2 + (w / count) * (i + 0.5);
    addBox(scene, 0.14, 0.05, d - 3, stripMat, x, WALL_H - 0.03, cz, { cast: false, receive: false });
  }
}

const wallMat = std(COLOR.ivory, 0.92);
const skirtMat = std(COLOR.charcoal, 0.6, 0.1);
const goldMat = std(COLOR.gold, 0.3, 0.9);

function wall(x1, z1, x2, z2) {
  const vertical = x1 === x2;
  const len = (vertical ? Math.abs(z2 - z1) : Math.abs(x2 - x1)) + WALL_T; // overlap corners
  const cx = (x1 + x2) / 2;
  const cz = (z1 + z2) / 2;
  const w = vertical ? WALL_T : len;
  const d = vertical ? len : WALL_T;

  const m = addBox(scene, w, WALL_H, d, wallMat, cx, WALL_H / 2, cz);
  camBlockers.push(m);
  addBox(scene, w + (vertical ? 0.05 : 0), 0.18, d + (vertical ? 0 : 0.05), skirtMat, cx, 0.09, cz, { cast: false });

  colliders.push({ minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2 });
}

function addCollider(cx, cz, hx, hz) {
  colliders.push({ minX: cx - hx, maxX: cx + hx, minZ: cz - hz, maxZ: cz + hz });
}

function addFramedArt(x, y, z, rotY, w, h, seed, accent) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.y = rotY;
  scene.add(g);

  addBox(g, w + 0.16, h + 0.16, 0.06, goldMat, 0, 0, 0.03, { cast: false });
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = Math.round((512 * h) / w);
  drawArt(c, { id: seed, accent, title: '', creator: '', category: '' }, 1, false);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAniso;
  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 })
  );
  plane.position.z = 0.07;
  g.add(plane);
}

function buildMuseum() {
  /* ----- lighting ----- */
  scene.add(new THREE.HemisphereLight(0xfff6e8, 0xcdbfa6, 0.5));

  sun = new THREE.DirectionalLight(0xfff2dc, 1.3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -12; sc.right = 12; sc.top = 12; sc.bottom = -12; sc.near = 1; sc.far = 45;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);

  [[-7, 4.3, 0], [7, 4.3, 0], [0, 4.3, 6], [0, 4.3, -17]].forEach(([x, y, z]) => {
    const p = new THREE.PointLight(0xffe6bd, 22, 20, 2);
    p.position.set(x, y, z);
    scene.add(p);
  });

  /* ----- room shells ----- */
  addRoomShell(0, 0, 28, 20);       // main hall:  x -14..14, z -10..10
  addRoomShell(0, -17, 16, 14);     // room 02:    x  -8..8,  z -24..-10

  /* ----- walls ----- */
  wall(-14, 10, 14, 10);            // south (entrance side)
  wall(-14, -10, -14, 10);          // west
  wall(14, -10, 14, 10);            // east
  wall(-14, -10, -2, -10);          // north-left  (doorway between)
  wall(2, -10, 14, -10);            // north-right
  wall(-8, -24, -8, -10);           // room 2 west
  wall(8, -24, 8, -10);             // room 2 east
  wall(-8, -24, 8, -24);            // room 2 north

  /* ----- doorway frame (hall -> room 02) ----- */
  const lintel = addBox(scene, 4.6, 1.4, WALL_T, wallMat, 0, WALL_H - 0.7, -10);
  camBlockers.push(lintel);
  addBox(scene, 3.7, 0.08, WALL_T + 0.08, goldMat, 0, 3.6, -10, { cast: false });
  addBox(scene, 0.08, 3.6, WALL_T + 0.08, goldMat, -1.84, 1.8, -10, { cast: false });
  addBox(scene, 0.08, 3.6, WALL_T + 0.08, goldMat, 1.84, 1.8, -10, { cast: false });

  /* ----- signs ----- */
  const logoSign = textPlane('PIXELVERSE', 6, 0.9, {
    font: '600 130px Georgia, serif', color: '#2a2a2d', spacing: '30px'
  });
  logoSign.position.set(0, 3.4, 9.77);
  logoSign.rotation.y = Math.PI;
  scene.add(logoSign);

  const tag = textPlane('WALK IN · EXPLORE · DISCOVER · CONNECT', 6, 0.35, {
    font: '400 52px Arial, sans-serif', color: '#a8853f', spacing: '12px'
  });
  tag.position.set(0, 2.7, 9.77);
  tag.rotation.y = Math.PI;
  scene.add(tag);

  const roomSign = textPlane('ROOM 02 · DIGITAL ARTS', 4, 0.4, {
    font: '500 70px Arial, sans-serif', color: '#2a2a2d', spacing: '8px'
  });
  roomSign.position.set(0, 4.3, -9.77);
  scene.add(roomSign);

  /* ----- decorative framed art ----- */
  addFramedArt(-8, 2.5, -9.77, 0, 3, 2, 'deco-a', '#8a6f4d');
  addFramedArt(8, 2.5, -9.77, 0, 3, 2, 'deco-b', '#4f6d7a');
  addFramedArt(-8, 2.5, 9.77, Math.PI, 3, 2, 'deco-c', '#7a5c5c');
  addFramedArt(8, 2.5, 9.77, Math.PI, 3, 2, 'deco-d', '#5c7a63');
  addFramedArt(-7.77, 2.5, -16, Math.PI / 2, 3.4, 2.2, 'deco-e', '#6a5c8e');
  addFramedArt(7.77, 2.5, -16, -Math.PI / 2, 3.4, 2.2, 'deco-f', '#8e6a5c');

  /* ----- floor inlay (gold guide line) ----- */
  const inlay = new THREE.Mesh(new THREE.PlaneGeometry(0.07, 20), new THREE.MeshStandardMaterial({
    color: COLOR.gold, roughness: 0.3, metalness: 0.9
  }));
  inlay.rotation.x = -Math.PI / 2;
  inlay.position.set(0, 0.006, 0);
  scene.add(inlay);

  /* ----- central sculpture ----- */
  const plinth = new THREE.Mesh(
    new THREE.CylinderGeometry(0.9, 1.0, 0.8, 40),
    std(COLOR.charcoal, 0.35, 0.2)
  );
  plinth.position.set(0, 0.4, -1);
  plinth.castShadow = plinth.receiveShadow = true;
  scene.add(plinth);
  addBox(scene, 1.9, 0.05, 1.9, goldMat, 0, 0.82, -1, { cast: false });
  scene.remove(scene.children[scene.children.length - 1]); // keep plinth a clean round top
  const knot = new THREE.Mesh(new THREE.TorusKnotGeometry(0.42, 0.12, 140, 20), goldMat);
  knot.position.set(0, 1.65, -1);
  knot.castShadow = true;
  scene.add(knot);
  spinners.push({ mesh: knot, speed: 0.5 });
  addCollider(0, -1, 1.0, 1.0);

  /* ----- benches ----- */
  [[-7, 3.5], [7, 3.5]].forEach(([x, z]) => {
    addBox(scene, 3.2, 0.12, 0.9, std(COLOR.sand, 0.5), x, 0.46, z);
    addBox(scene, 0.15, 0.4, 0.7, skirtMat, x - 1.3, 0.2, z);
    addBox(scene, 0.15, 0.4, 0.7, skirtMat, x + 1.3, 0.2, z);
    addCollider(x, z, 1.65, 0.5);
  });

  /* ----- exhibition displays ----- */
  const slots = [
    { x: -13.78, z: 0, rotY: Math.PI / 2 },    // main hall, west wall
    { x: 13.78, z: 0, rotY: -Math.PI / 2 },    // main hall, east wall
    { x: 0, z: -23.78, rotY: 0 }               // room 02, north wall
  ];
  PROJECTS.slice(0, slots.length).forEach((p, i) => createDisplay(p, slots[i]));
}

function createDisplay(project, slot) {
  const g = new THREE.Group();
  g.position.set(slot.x, 0, slot.z);
  g.rotation.y = slot.rotY;
  scene.add(g);

  // screen texture
  const c = document.createElement('canvas');
  c.width = 1280;
  c.height = 720;
  drawArt(c, project, 0, true);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAniso;

  const frameMat = new THREE.MeshStandardMaterial({
    color: COLOR.gold, roughness: 0.3, metalness: 0.9,
    emissive: COLOR.gold, emissiveIntensity: 0.12
  });
  const frame = addBox(g, 6.5, 3.9, 0.14, frameMat, 0, 2.7, 0.07, { cast: false });
  const screen = new THREE.Mesh(
    new THREE.PlaneGeometry(6.0, 3.375),
    new THREE.MeshBasicMaterial({ map: tex, toneMapped: false })
  );
  screen.position.set(0, 2.7, 0.15);
  g.add(screen);

  // podium
  const podMat = std(COLOR.charcoal, 0.4, 0.15);
  addBox(g, 2.4, 0.9, 1.2, podMat, 0, 0.45, 2.0);
  addBox(g, 2.5, 0.05, 1.3, goldMat, 0, 0.925, 2.0, { cast: false });
  const plaque = textPlane(project.title, 2.1, 0.4, {
    font: '600 78px Georgia, serif', color: '#f3eee4'
  }, 1024);
  plaque.position.set(0, 0.55, 2.605);
  g.add(plaque);

  // floating gold marker above podium
  const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.2), goldMat);
  gem.position.set(0, 1.35, 2.0);
  gem.castShadow = true;
  g.add(gem);
  spinners.push({ mesh: gem, speed: 0.9 });

  // spotlight on the screen
  const target = new THREE.Object3D();
  target.position.set(0, 2.5, 0);
  g.add(target);
  const spot = new THREE.SpotLight(0xfff0d6, 30, 14, 0.7, 0.7, 2);
  spot.position.set(0, 4.8, 3.2);
  spot.target = target;
  g.add(spot);

  // podium collider in world space
  const s = Math.abs(Math.sin(slot.rotY));
  const k = Math.abs(Math.cos(slot.rotY));
  const wx = slot.x + 2.0 * Math.sin(slot.rotY);
  const wz = slot.z + 2.0 * Math.cos(slot.rotY);
  addCollider(wx, wz, k * 1.25 + s * 0.65, s * 1.25 + k * 0.65);

  displays.push({
    project,
    frameMat,
    glow: 0.12,
    anchor: new THREE.Vector3(wx, 0, wz),
    normal: new THREE.Vector2(Math.sin(slot.rotY), Math.cos(slot.rotY)),
    origin: new THREE.Vector2(slot.x, slot.z)
  });
}

/* =========================================================
   PLAYER CHARACTER
   ========================================================= */
function buildPlayer() {
  const skin = std(0xe2b997, 0.7);
  const hair = std(0x2a1f1a, 0.8);
  const cloth = std(0x2f2f34, 0.7);
  const pants = std(0x4a4a52, 0.75);
  const shoe = std(0x1c1c1e, 0.5);
  const gold = std(COLOR.gold, 0.35, 0.8);

  const group = new THREE.Group();
  const body = new THREE.Group();   // torso + head (for lean / breathing)
  group.add(body);

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.27, 0.42, 6, 14), cloth);
  torso.scale.z = 0.72;
  torso.position.y = 1.18;
  body.add(torso);

  const belt = new THREE.Mesh(new THREE.CylinderGeometry(0.285, 0.285, 0.07, 20), gold);
  belt.scale.z = 0.74;
  belt.position.y = 0.93;
  body.add(belt);

  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.09, 0.12, 12), skin);
  neck.position.y = 1.56;
  body.add(neck);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.21, 24, 20), skin);
  head.position.y = 1.78;
  body.add(head);

  const hairCap = new THREE.Mesh(
    new THREE.SphereGeometry(0.225, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.56),
    hair
  );
  hairCap.position.set(0, 1.79, -0.015);
  hairCap.rotation.x = -0.2;
  body.add(hairCap);

  // simple eyes (tiny dark spheres) so the facing direction is obvious
  [-0.075, 0.075].forEach((x) => {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.022, 8, 8), shoe);
    eye.position.set(x, 1.79, 0.19);
    body.add(eye);
  });

  const makeLimb = (x, y, radius, length, mat, withShoe) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, 0);
    const limb = new THREE.Mesh(new THREE.CapsuleGeometry(radius, length, 4, 10), mat);
    limb.position.y = -(length / 2 + radius);
    limb.castShadow = true;
    pivot.add(limb);
    if (withShoe) {
      const s = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.1, 0.28), shoe);
      s.position.set(0, -(length + radius * 2) + 0.01, 0.05);
      s.castShadow = true;
      pivot.add(s);
    }
    group.add(pivot);
    return pivot;
  };

  const parts = {
    body,
    legL: makeLimb(-0.13, 0.86, 0.09, 0.56, pants, true),
    legR: makeLimb(0.13, 0.86, 0.09, 0.56, pants, true),
    armL: makeLimb(-0.36, 1.46, 0.075, 0.46, cloth, false),
    armR: makeLimb(0.36, 1.46, 0.075, 0.46, cloth, false)
  };

  group.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });

  group.position.copy(playerPos);
  group.rotation.y = playerHeading;
  scene.add(group);
  character = { group, parts };
}

function animateCharacter(t) {
  const { group, parts } = character;
  const swing = Math.sin(walkPhase) * 0.78 * moveAmount;
  parts.legL.rotation.x = swing;
  parts.legR.rotation.x = -swing;
  parts.armL.rotation.x = -swing * 0.85;
  parts.armR.rotation.x = swing * 0.85;

  const idle = 1 - moveAmount;
  parts.armL.rotation.z = 0.05 + Math.sin(t * 1.6) * 0.012 * idle;
  parts.armR.rotation.z = -0.05 - Math.sin(t * 1.6) * 0.012 * idle;

  parts.body.rotation.x = 0.07 * moveAmount;
  parts.body.position.y = Math.sin(t * 2) * 0.006 * idle;

  group.position.set(playerPos.x, Math.abs(Math.sin(walkPhase)) * 0.045 * moveAmount, playerPos.z);
  group.rotation.y = playerHeading;
}

/* =========================================================
   INPUT
   ========================================================= */
function setupInput() {
  const canvas = $('scene');
  const blocked = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'];

  window.addEventListener('keydown', (e) => {
    if (blocked.includes(e.code)) e.preventDefault();

    if (e.code === 'Escape') {
      closePanel();
      return;
    }
    if (e.code === 'KeyE' && !e.repeat) {
      if (!panelOpen && activeDisplay) openPanel(activeDisplay.project);
      return;
    }
    if (!panelOpen) keys.add(e.code);
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  window.addEventListener('blur', () => keys.clear());

  // drag to rotate camera (mouse + touch)
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  canvas.addEventListener('pointerdown', (e) => {
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
    canvas.classList.add('dragging');
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging || panelOpen) return;
    camYaw -= (e.clientX - lastX) * 0.0055;
    camPitch = clamp(camPitch + (e.clientY - lastY) * 0.004, 0.08, 0.95);
    lastX = e.clientX;
    lastY = e.clientY;
  });
  const stopDrag = (e) => {
    dragging = false;
    canvas.classList.remove('dragging');
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
  };
  canvas.addEventListener('pointerup', stopDrag);
  canvas.addEventListener('pointercancel', stopDrag);

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (panelOpen) return;
    camDist = clamp(camDist + e.deltaY * 0.004, 3, 8);
  }, { passive: false });

  // on-screen pad for touch devices
  document.querySelectorAll('#pad button').forEach((b) => {
    const code = b.dataset.code;
    const down = (e) => { e.preventDefault(); if (!panelOpen) keys.add(code); };
    const up = (e) => { e.preventDefault(); keys.delete(code); };
    b.addEventListener('pointerdown', down);
    b.addEventListener('pointerup', up);
    b.addEventListener('pointerleave', up);
    b.addEventListener('pointercancel', up);
  });
}

/* =========================================================
   UPDATE LOOP
   ========================================================= */
function lerpAngle(a, b, t) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

function resolveCollisions() {
  for (let pass = 0; pass < 2; pass++) {
    for (const c of colliders) {
      const cx = clamp(playerPos.x, c.minX, c.maxX);
      const cz = clamp(playerPos.z, c.minZ, c.maxZ);
      const dx = playerPos.x - cx;
      const dz = playerPos.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= PLAYER_RADIUS * PLAYER_RADIUS) continue;

      if (d2 > 1e-8) {
        const d = Math.sqrt(d2);
        const push = (PLAYER_RADIUS - d) / d;
        playerPos.x += dx * push;
        playerPos.z += dz * push;
      } else {
        // centre is inside the box: push out along the shallowest side
        const l = playerPos.x - c.minX;
        const r = c.maxX - playerPos.x;
        const t = playerPos.z - c.minZ;
        const b = c.maxZ - playerPos.z;
        const m = Math.min(l, r, t, b);
        if (m === l) playerPos.x = c.minX - PLAYER_RADIUS;
        else if (m === r) playerPos.x = c.maxX + PLAYER_RADIUS;
        else if (m === t) playerPos.z = c.minZ - PLAYER_RADIUS;
        else playerPos.z = c.maxZ + PLAYER_RADIUS;
      }
    }
  }
}

function updatePlayer(dt) {
  let ix = 0;
  let iz = 0;
  if (!panelOpen) {
    if (keys.has('KeyW') || keys.has('ArrowUp')) iz += 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) iz -= 1;
    if (keys.has('KeyD') || keys.has('ArrowRight')) ix += 1;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) ix -= 1;
  }

  const len = Math.hypot(ix, iz);
  const moving = len > 0;

  if (moving) {
    ix /= len;
    iz /= len;
    const sin = Math.sin(camYaw);
    const cos = Math.cos(camYaw);
    // camera-relative: forward = (-sin, -cos), right = (cos, -sin)
    const dx = ix * cos - iz * sin;
    const dz = -ix * sin - iz * cos;

    playerPos.x += dx * MOVE_SPEED * dt;
    playerPos.z += dz * MOVE_SPEED * dt;
    resolveCollisions();

    playerHeading = lerpAngle(playerHeading, Math.atan2(dx, dz), 1 - Math.exp(-14 * dt));
  }

  moveAmount += ((moving ? 1 : 0) - moveAmount) * (1 - Math.exp(-10 * dt));
  walkPhase += dt * 9.5 * moveAmount;
}

function updateCamera(dt, snap = false) {
  const k = snap ? 1 : 1 - Math.exp(-12 * dt);
  camLook.x += (playerPos.x - camLook.x) * k;
  camLook.y += (1.45 - camLook.y) * k;
  camLook.z += (playerPos.z - camLook.z) * k;

  const cp = Math.cos(camPitch);
  const dir = new THREE.Vector3(Math.sin(camYaw) * cp, Math.sin(camPitch), Math.cos(camYaw) * cp);

  // pull the camera in if a wall is in the way
  raycaster.set(camLook, dir);
  raycaster.far = camDist + 0.4;
  const hits = raycaster.intersectObjects(camBlockers, false);
  let allowed = camDist;
  if (hits.length) allowed = clamp(hits[0].distance - 0.35, 0.9, camDist);

  if (allowed < camDistCurrent || snap) camDistCurrent = allowed;
  else camDistCurrent += (allowed - camDistCurrent) * (1 - Math.exp(-5 * dt));

  camera.position.copy(camLook).addScaledVector(dir, camDistCurrent);
  camera.lookAt(camLook.x, camLook.y + 0.25, camLook.z);
}

function updateInteraction(dt) {
  let best = null;
  let bestDist = INTERACT_RANGE;

  for (const d of displays) {
    const dist = Math.hypot(playerPos.x - d.anchor.x, playerPos.z - d.anchor.z);
    // player must be on the visitor side of the screen
    const side = (playerPos.x - d.origin.x) * d.normal.x + (playerPos.z - d.origin.y) * d.normal.y;
    if (side > 0.8 && dist < bestDist) {
      best = d;
      bestDist = dist;
    }
  }

  activeDisplay = best;

  if (best && !panelOpen) showPrompt('View “' + best.project.title + '”');
  else hidePrompt();

  for (const d of displays) {
    const target = d === best ? 0.75 : 0.12;
    d.glow += (target - d.glow) * (1 - Math.exp(-6 * dt));
    d.frameMat.emissiveIntensity = d.glow;
  }
}

function tick() {
  requestAnimationFrame(tick);
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;

  updatePlayer(dt);
  updateCamera(dt);
  updateInteraction(dt);
  animateCharacter(t);

  spinners.forEach((s) => { s.mesh.rotation.y += s.speed * dt; });

  // keep the shadow-casting light centred on the visitor (sharp shadows, cheap)
  sun.position.set(playerPos.x + 3, 20, playerPos.z + 4);
  sun.target.position.set(playerPos.x, 0, playerPos.z);

  renderer.render(scene, camera);
}
