/*
 * ANIRIUS one-page shop.
 * One fixed WebGL stage; every [data-pose] element is a keyframe at the scroll position where it is
 * centred in the viewport. Between keyframes the knife pose (position, size, rotation, opacity)
 * is interpolated, and callouts belonging to a pose fade in around its keyframe.
 * Also: scroll reveals, parallax, marquee, counters, pinned flip, cart drawer.
 * Bundled by `npm run build:shop` into shop/shop.js.
 */
import {
  WebGLRenderer, Vector2, Scene, PerspectiveCamera, Group, Vector3, Color, Mesh, Box3, Euler,
  MeshBasicMaterial, PlaneGeometry, DoubleSide, PMREMGenerator, ACESFilmicToneMapping, SRGBColorSpace, MathUtils,
  CubeCamera, WebGLCubeRenderTarget, HalfFloatType, EquirectangularReflectionMapping,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const PI = Math.PI;
const KNIFE_LEN = 0.225;
const PRICE = 39.95;
const clamp01 = (x) => MathUtils.clamp(x, 0, 1);
const smooth = (x) => x * x * (3 - 2 * x);

/*
 * Poses. len: knife length as a fraction of viewport width. focus: model anchor placed at `at`
 * (viewport fractions); without focus the knife centre is placed there. r: Euler XYZ, interpolated
 * per component so the flip turns one way and back the other (never a full spin). o: opacity.
 * Model axes: +X tip, +Y fine edge, -Y coarse edge, +Z logo face.
 */
const POSES = {
  hero: {
    wide: { lenH: 2.15, focus: 'blade', at: [0.7, 0.58], r: [0.0, -0.18, 0.9] }, // blade only: handle starts below the screen
    tall: { len: 2.1, focus: 'blade', at: [0.62, 0.62], r: [0.0, -0.15, 0.3] },
  },
  fine: {
    wide: { len: 3.0, focus: 'fineC', at: [0.62, 0.5], r: [0.25, 1.0, PI / 2], ex: 0.9 }, // upright, fine edge faces the copy
    tall: { len: 2.8, focus: 'fineC', at: [0.5, 0.3], r: [0.12, -0.06, 0.02] },
  },
  flipA: {
    wide: { len: 0.62, at: [0.5, 0.42], r: [0.18, -0.12, 0] },
    tall: { len: 0.92, at: [0.5, 0.4], r: [0.18, -0.12, 0] },
  },
  flipB: {
    wide: { len: 0.62, at: [0.5, 0.42], r: [PI + 0.18, -0.12, 0] },
    tall: { len: 0.92, at: [0.5, 0.4], r: [PI + 0.18, -0.12, 0] },
  },
  coarse: {
    wide: { len: 2.1, focus: 'coarseC', at: [0.4, 0.4], r: [PI + 0.08, -0.22, PI / 2], ex: 0.8 }, // turned over, coarse edge faces the copy
    tall: { len: 2.8, focus: 'coarseC', at: [0.5, 0.3], r: [PI + 0.12, 0.06, -0.02] },
  },
  logo: {
    wide: { len: 1.7, focus: 'logoMid', at: [0.64, 0.5], r: [-0.05, 0.35, PI / 2] }, // tip up: wordmark upright; face turned into the right-front softbox so the whole blade is lit
    tall: { len: 3.4, focus: 'logoMid', at: [0.5, 0.3], r: [0.1, -0.1, 0] },
  },
  away: {
    wide: { len: 0.7, at: [0.5, 0.5], r: [0.3, -0.5, 0.25], o: 0 },
    tall: { len: 0.9, at: [0.5, 0.4], r: [0.3, -0.5, 0.25], o: 0 },
  },
  buy: {
    wide: { len: 0.5, at: [0.3, 0.52], r: [0.22, -0.3, 0.5] },
    tall: { len: 0.86, at: [0.5, 0.3], r: [0.22, -0.25, 0.22] },
  },
  end: {
    wide: { len: 0.5, at: [0.3, 0.2], r: [0.22, -0.3, 0.5], o: 0 },
    tall: { len: 0.86, at: [0.5, 0.1], r: [0.22, -0.25, 0.22], o: 0 },
  },
};

function studioEnvironment(renderer, hdr, cubeSize) {
  // Mirror steel only looks real when it reflects crisp shapes: hard-edged softboxes and strips
  // separated by near-black gaps. The knife face points at the camera (+Z), so the strips behind
  // the camera are what slide across the blade as it moves.
  const env = new Scene();
  hdr.mapping = EquirectangularReflectionMapping;
  env.background = hdr;
  env.backgroundIntensity = 0.22; // photographed studio stays as faint fill, shapes do the work
  const add = (w, h, p, c, look = [0, 0, 0]) => {
    const m = new Mesh(new PlaneGeometry(w, h), new MeshBasicMaterial({ color: new Color(c, c, c), side: DoubleSide }));
    m.position.set(...p);
    m.lookAt(...look);
    env.add(m);
  };
  // Black cyclorama: the dark bands in the steel.
  add(40, 40, [0, -5, 0], 0.004);
  add(40, 14, [0, 1, -9], 0.01);
  // Front (behind camera): two long horizontal strips with a black gap, the classic knife-ad bands.
  add(16, 0.9, [0, 1.6, 6], 6);
  add(16, 0.35, [0, -0.2, 6], 2.4);
  // Frontal fill behind the strips: a blade facing the camera mirrors this, so its face never shows a dark block.
  add(8, 3.2, [-0.6, 0.3, 6.8], 0.45);
  add(7, 3.4, [-2.5, -2.6, 6], 0.7);
  // Overhead key softbox and two tall side strips for the edges and bevels.
  add(6, 2, [0, 7, 1.5], 4.5);
  // Left-front softbox (replaces the thin left strip): lights the bevel along the fine edge.
  add(4, 7, [-3.6, 0.4, 5.6], 0.8);
  add(3.2, 6, [5.1, 0.6, 4.8], 0.9);
  // Small warm kicker behind for a rim on the spine.
  add(2.5, 2.5, [3.5, 2.5, -6], 1.4);
  // Back rim strips, left and right: the serrations' scallops face sideways and otherwise
  // mirror the black back wall. These make every tooth catch a highlight.
  add(4, 10, [5.5, 0.5, -4.5], 1.8);
  add(4, 10, [-5.5, 0.5, -4.5], 1.8);
  add(3, 10, [7, 0.5, 0], 1.2);
  add(3, 10, [-7, 0.5, 0], 1.2);
  // Fill the gaps between the front softboxes and the side strips; rounded bevels and the spine
  // otherwise reflect that black wedge as a dark line running down the blade.
  add(3.4, 8, [6.5, 0.5, 2.6], 0.7);
  add(3.4, 8, [-6.5, 0.5, 2.6], 0.7);
  const pmrem = new PMREMGenerator(renderer);
  const rt = new WebGLCubeRenderTarget(cubeSize, { type: HalfFloatType });
  new CubeCamera(0.1, 100, rt).update(renderer, env);
  const tex = pmrem.fromCubemap(rt.texture).texture;
  rt.dispose();
  pmrem.dispose();
  env.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) o.material.dispose();
  });
  return tex;
}

// Highest (+Y) / lowest (-Y) blade vertex near x, in model space.
function edgeAt(root, x, sign) {
  let best = 0;
  let z = 0;
  const v = new Vector3();
  root.traverse((o) => {
    if (!o.isMesh || o.material.name === 'laser_etch') return;
    const p = o.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld);
      if (Math.abs(v.x - x) > 0.0015) continue;
      if (v.y * sign > best * sign) { best = v.y; z = v.z; }
    }
  });
  return new Vector3(x, best, z);
}

class Stage {
  constructor(canvas) {
    const desktop = innerWidth >= 1024;
    this.canvas = canvas;
    this.renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(2, desktop ? Math.max(1.5, devicePixelRatio || 1) : devicePixelRatio || 1));
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.9;
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.setClearColor(0, 0);
    this.scene = new Scene();
    this.camera = new PerspectiveCamera(22, 1, 0.02, 20);
    this.camera.position.set(0, 0, 1);
    this.pivot = new Group();
    this.tilt = new Group();
    this.pivot.add(this.tilt);
    this.scene.add(this.pivot);
    this.pointer = { x: 0, y: 0, tx: 0, ty: 0 };
    this.anchors = {};
    this.cur = null;
    this.intro = reduced ? 1 : 0;
  }

  load(model, hdrUrl, hdrHd) {
    const hd = innerWidth >= 1024 && hdrHd;
    const setEnv = (hdr, size) => {
      const old = this.scene.environment;
      this.scene.environment = studioEnvironment(this.renderer, hdr, size);
      hdr.dispose();
      if (old) old.dispose();
    };
    const env = new Promise((resolve) => {
      new RGBELoader().load(hdrUrl, (hdr) => {
        setEnv(hdr, 512);
        resolve();
        if (hd) new RGBELoader().load(hdrHd, (h2) => setEnv(h2, 1024));
      }, undefined, resolve);
    });
    const mesh = new Promise((resolve, reject) => {
      const l = new GLTFLoader();
      l.setMeshoptDecoder(MeshoptDecoder);
      l.load(model, (gltf) => {
        const root = gltf.scene;
        root.updateMatrixWorld(true);
        const logoBox = new Box3();
        root.traverse((o) => {
          if (!o.isMesh) return;
          const m = o.material;
          if (m.name === 'laser_etch') {
            m.color.setRGB(0.05, 0.06, 0.08);
            m.metalness = 0.85;
            m.roughness = 0.55;
            logoBox.expandByObject(o);
          } else {
            m.color.setRGB(0.96, 0.955, 0.945);
            m.metalness = 1;
            m.roughness = 0.045;
            m.envMapIntensity = 1;
            // Ground serrations are satin, not mirror: raise roughness within ~2 mm of the blade's
            // outline (the teeth), so they catch soft highlights instead of shattered chrome glints.
            // The outline comes from the mesh itself: top/bottom edge per 64 slices along the blade.
            const toRoot = o.matrixWorld.clone();
            const N = 64;
            const X0 = 0;
            const X1 = 0.1125;
            const edge = Array.from({ length: N }, () => new Vector2(-1, 1));
            const pos = o.geometry.attributes.position;
            const v = new Vector3();
            for (let i = 0; i < pos.count; i++) {
              v.fromBufferAttribute(pos, i).applyMatrix4(toRoot);
              if (v.x < X0 || v.x > X1) continue;
              const e = edge[Math.min(N - 1, Math.floor(((v.x - X0) / (X1 - X0)) * N))];
              if (v.y > e.x) e.x = v.y;
              if (v.y < e.y) e.y = v.y;
            }
            for (let i = 1; i < N; i++) if (edge[i].x < edge[i].y) edge[i].copy(edge[i - 1]);
            m.onBeforeCompile = (sh) => {
              sh.uniforms.uToRoot = { value: toRoot };
              sh.uniforms.uEdge = { value: edge };
              sh.vertexShader = sh.vertexShader
                .replace('#include <common>', '#include <common>\nuniform mat4 uToRoot;\nvarying vec3 vRootPos;')
                .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRootPos = (uToRoot * vec4(position, 1.0)).xyz;');
              sh.fragmentShader = sh.fragmentShader
                .replace('#include <common>', `#include <common>\nvarying vec3 vRootPos;\nuniform vec2 uEdge[${N}];`)
                .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
float fx = clamp((vRootPos.x - ${X0.toFixed(4)}) / ${(X1 - X0).toFixed(4)}, 0.0, 1.0) * ${(N - 1).toFixed(1)};
int i0 = int(floor(fx));
int i1 = min(i0 + 1, ${N - 1});
vec2 e = mix(uEdge[i0], uEdge[i1], fract(fx));
float dEdge = min(e.x - vRootPos.y, vRootPos.y - e.y);
float satin = (1.0 - smoothstep(0.0014, 0.0026, dEdge)) * step(${X0.toFixed(4)}, vRootPos.x);
roughnessFactor = mix(roughnessFactor, 0.3, satin);`);
            };
          }
        });
        const box = new Box3().setFromObject(root);
        const has = !logoBox.isEmpty();
        const mid = has ? logoBox.getCenter(new Vector3()) : new Vector3(0.03, 0, box.max.z);
        mid.z = has ? logoBox.max.z : box.max.z;
        this.anchors = {
          fine: edgeAt(root, 0.072, 1),
          coarse: edgeAt(root, 0.05, -1),
          fineC: edgeAt(root, 0.06, 1),
          coarseC: edgeAt(root, 0.075, -1),
          logo: new Vector3(mid.x, has ? logoBox.max.y : mid.y, mid.z),
          logoMid: mid,
          blade: new Vector3(0.056, 0, 0),
        };
        this.model = root;
        this.tilt.add(root);
        resolve();
      }, undefined, reject);
    });
    return Promise.all([mesh, env]);
  }

  resize() {
    this.w = innerWidth;
    this.h = innerHeight;
    this.renderer.setSize(this.w, this.h, false);
    this.camera.aspect = this.w / this.h;
    this.camera.updateProjectionMatrix();
    this.tall = this.w / this.h < 0.9 || this.w <= 820;
    this.visH = 2 * Math.tan(MathUtils.degToRad(this.camera.fov / 2)) * this.camera.position.z;
    this.visW = this.visH * this.camera.aspect;
  }

  // Pose → absolute {x, y, s, r[], o} in world units.
  pose(name) {
    const P = { ...POSES[name][this.tall ? 'tall' : 'wide'] };
    if (name === 'hero' && this.tall && this.bandCy) P.at = [P.at[0], this.bandCy];
    // Wide screens: cap the whole-knife size by height too.
    let len = P.lenH ? P.lenH * this.visH : P.len * this.visW;
    if (!P.focus && !this.tall) len = Math.min(len, this.visH * 1.9);
    const s = len / KNIFE_LEN;
    const f = P.focus ? this.anchors[P.focus].clone() : new Vector3();
    f.applyEuler(new Euler(...P.r)).multiplyScalar(s);
    return {
      x: (P.at[0] - 0.5) * this.visW - f.x,
      y: -(P.at[1] - 0.5) * this.visH - f.y,
      s, r: P.r, o: P.o ?? 1, ex: P.ex ?? 1,
    };
  }

  update(a, b, t, dt, time) {
    if (!this.model) return;
    const A = this.pose(a);
    const B = this.pose(b);
    const L = MathUtils.lerp;
    const T = { x: L(A.x, B.x, t), y: L(A.y, B.y, t), s: L(A.s, B.s, t), r: A.r.map((v, i) => L(v, B.r[i], t)), o: L(A.o, B.o, t), ex: L(A.ex, B.ex, t) };
    const k = reduced || !this.cur ? 1 : 1 - Math.exp(-dt * 7);
    if (!this.cur) this.cur = { ...T, r: [...T.r] };
    const c = this.cur;
    c.x += (T.x - c.x) * k;
    c.y += (T.y - c.y) * k;
    c.s *= Math.pow(T.s / c.s, k); // geometric: zooms feel even
    c.r = c.r.map((v, i) => v + (T.r[i] - v) * k);
    c.o += (T.o - c.o) * k;
    c.ex += (T.ex - c.ex) * k;
    this.renderer.toneMappingExposure = 0.9 * c.ex;

    this.intro = Math.min(1, this.intro + dt / 1.8);
    const e = 1 - Math.pow(1 - this.intro, 3);
    this.pivot.position.set(c.x + (1 - e) * this.visW * 0.06, c.y, 0);
    this.pivot.scale.setScalar(c.s * (0.94 + 0.06 * e));
    this.pivot.rotation.set(c.r[0], c.r[1] - (1 - e) * 0.5, c.r[2]);

    const p = this.pointer;
    p.x += (p.tx - p.x) * (1 - Math.exp(-dt * 3));
    p.y += (p.ty - p.y) * (1 - Math.exp(-dt * 3));
    const calm = Math.min(1, (0.8 * this.visW) / (c.s * KNIFE_LEN)); // less wobble in close-ups
    const tt = reduced ? 0 : time * 0.001;
    const hw = this.heroW || 0;
    const sweep = reduced ? 0 : hw * (0.05 + 0.16 * Math.sin(tt * 0.75)); // ≈ 8 s per cycle
    const steady = 1 - 0.7 * hw; // calmer pointer/idle sway while the sweep runs
    this.tilt.rotation.set(sweep + (p.y * 0.07 + Math.sin(tt * 0.7) * 0.025) * calm * steady, (p.x * 0.1 + Math.sin(tt * 0.45) * 0.03) * calm, 0);
    this.tilt.position.y = reduced ? 0 : Math.sin(tt * 0.9) * 0.0012;
    this.canvas.style.opacity = (c.o * (this.fade || 0)).toFixed(3);
    this.scene.updateMatrixWorld(true);
    if (c.o > 0.005) this.renderer.render(this.scene, this.camera);
    else this.renderer.clear();
  }

  project(name, out) {
    const v = this.anchors[name].clone().applyMatrix4(this.model.matrixWorld).project(this.camera);
    out.x = (v.x * 0.5 + 0.5) * this.w;
    out.y = (-v.y * 0.5 + 0.5) * this.h;
    out.z = v.z;
    return out;
  }

  logoFacing() {
    return new Vector3(0, 0, 1).transformDirection(this.model.matrixWorld).z > 0.2;
  }
}

// ---------------------------------------------------------------- cart

function initCart() {
  const el = document.querySelector('[data-cart]');
  const body = el.querySelector('[data-cart-body]');
  const sum = el.querySelector('[data-cart-sum]');
  const count = document.querySelector('[data-cart-count]');
  const toast = document.querySelector('.toast');
  const fmt = (n) => n.toFixed(2).replace('.', ',') + ' €';
  let qty = 0;
  try { qty = Number(localStorage.getItem('anirius-cart')) || 0; } catch (e) { /* storage blocked */ }
  let toastT;
  const say = (msg) => {
    toast.textContent = msg;
    toast.classList.add('is-on');
    clearTimeout(toastT);
    toastT = setTimeout(() => toast.classList.remove('is-on'), 2600);
  };
  const knifeSvg = '<svg viewBox="0 0 120 24" aria-hidden="true"><defs><linearGradient id="kg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f4f4f4"/><stop offset="1" stop-color="#8a8a8d"/></linearGradient></defs><path fill="url(#kg)" d="M2 12c0-3 3-5 8-5h36c6 0 10 1 16-1 10-3 30-4 46-1 6 1 10 4 10 6s-5 4-12 5c-18 2-40 2-60 1-4 0-8-1-12-1H10c-5 0-8-2-8-4Z"/></svg>';
  const render = () => {
    count.textContent = qty;
    count.classList.toggle('has', qty > 0);
    sum.textContent = fmt(qty * PRICE);
    body.innerHTML = qty
      ? `<div class="line"><div class="line__img">${knifeSvg}</div><div><h3>ANIRIUS® 2-in-1 · 6er-Set</h3><p>Geschenkbox · ${fmt(PRICE)}</p><div class="qty"><button type="button" data-line="-1" aria-label="Weniger">−</button><output>${qty}</output><button type="button" data-line="1" aria-label="Mehr">+</button></div></div><div class="line__price">${fmt(qty * PRICE)}<button class="line__rm" type="button" data-line="0">Entfernen</button></div></div>`
      : '<p class="cart__empty">Dein Warenkorb ist leer.</p>';
    el.querySelector('[data-checkout]').disabled = !qty;
    try { localStorage.setItem('anirius-cart', String(qty)); } catch (e) { /* storage blocked */ }
  };
  const open = () => { el.classList.add('is-open'); el.setAttribute('aria-hidden', 'false'); };
  const close = () => { el.classList.remove('is-open'); el.setAttribute('aria-hidden', 'true'); };
  document.querySelectorAll('[data-open-cart]').forEach((b) => b.addEventListener('click', open));
  el.querySelectorAll('[data-close-cart]').forEach((b) => b.addEventListener('click', close));
  addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  body.addEventListener('click', (e) => {
    const b = e.target.closest('[data-line]');
    if (!b) return;
    const d = Number(b.dataset.line);
    qty = d === 0 ? 0 : Math.max(0, Math.min(20, qty + d));
    render();
  });

  // Product quantity + add
  let pick = 1;
  const out = document.querySelector('[data-qty-value]');
  document.querySelectorAll('[data-qty]').forEach((b) => b.addEventListener('click', () => {
    pick = Math.max(1, Math.min(10, pick + Number(b.dataset.qty)));
    out.textContent = pick;
  }));
  const add = document.querySelector('[data-add]');
  add.addEventListener('click', () => {
    qty = Math.min(20, qty + pick);
    render();
    count.classList.remove('bump');
    void count.offsetWidth;
    count.classList.add('bump');
    add.textContent = 'Hinzugefügt ✓';
    add.classList.add('is-done');
    setTimeout(() => { add.textContent = 'In den Warenkorb'; add.classList.remove('is-done'); }, 1600);
    setTimeout(open, 450);
  });
  el.querySelector('[data-checkout]').addEventListener('click', () => say('Demo: Die Kasse wird mit Shopify verbunden.'));
  render();
}

// ---------------------------------------------------------------- page

function init() {
  const root = document.documentElement;
  const canvas = document.querySelector('.stage');
  const svg = document.querySelector('.ann');
  const nav = document.querySelector('.nav');
  const bar = document.querySelector('.progress span');
  const callouts = [...document.querySelectorAll('.callout')];
  const keyEls = [...document.querySelectorAll('[data-pose]')];
  const flip = document.querySelector('.flip');
  const flipBar = document.querySelector('[data-flip-bar]');
  const marquee = document.querySelector('[data-marquee]');
  const tiles = [...document.querySelectorAll('[data-parallax]')];
  const footWord = document.querySelector('.foot__word');
  const stickyBuy = document.querySelector('.sticky-buy');
  const buySec = document.querySelector('#kaufen');
  const copy = document.querySelector('.hero__copy');
  const facts = document.querySelector('.hero__facts');
  const navLinks = [...document.querySelectorAll('.nav__links a')];

  initCart();

  // Reveals + counters
  const io = new IntersectionObserver((entries) => entries.forEach((en) => {
    if (!en.isIntersecting) return;
    en.target.classList.add('is-in');
    io.unobserve(en.target);
    en.target.querySelectorAll('[data-count]').forEach((n) => {
      const to = Number(n.dataset.count);
      if (reduced) return;
      const t0 = performance.now();
      const step = (now) => {
        const p = clamp01((now - t0) / 1400);
        n.textContent = Math.round(to * (1 - Math.pow(1 - p, 3)));
        if (p < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  }), { rootMargin: '0px 0px -12% 0px' });
  document.querySelectorAll('.reveal').forEach((r) => io.observe(r));

  // Active nav link
  const spy = new IntersectionObserver((entries) => entries.forEach((en) => {
    if (!en.isIntersecting) return;
    navLinks.forEach((a) => a.classList.toggle('is-active', a.getAttribute('href') === '#' + en.target.id));
  }), { rootMargin: '-45% 0px -50% 0px' });
  navLinks.forEach((a) => { const s = document.querySelector(a.getAttribute('href')); if (s) spy.observe(s); });

  // Callout graphics
  const NS = 'http://www.w3.org/2000/svg';
  callouts.forEach((c) => {
    c._line = document.createElementNS(NS, 'polyline');
    c._ring = document.createElementNS(NS, 'circle');
    c._dot = document.createElementNS(NS, 'circle');
    c._ring.setAttribute('r', c.dataset.anchor.startsWith('logo') ? 0 : 7);
    c._ring.setAttribute('class', 'ring');
    c._dot.setAttribute('r', 2.5);
    svg.append(c._line, c._ring, c._dot);
  });

  let stage = null;
  try { stage = new Stage(canvas); } catch (e) { root.classList.add('no-webgl', 'is-ready'); }

  let keys = [];
  const docTop = (el) => el.getBoundingClientRect().top + scrollY;
  const layout = () => {
    if (stage) {
      stage.resize();
      const top = copy.getBoundingClientRect().bottom;
      const bottom = facts.getBoundingClientRect().top;
      stage.bandCy = ((top + bottom) / 2 + 8) / innerHeight;
    }
    svg.setAttribute('viewBox', `0 0 ${innerWidth} ${innerHeight}`);
    keys = keyEls.map((el) => ({ name: el.dataset.pose, y: el.dataset.pose === 'hero' ? 0 : docTop(el) + el.offsetHeight / 2 - innerHeight / 2 }))
      .sort((a, b) => a.y - b.y);
  };
  layout();
  addEventListener('resize', layout);
  addEventListener('load', layout);
  if (document.fonts) document.fonts.ready.then(layout);
  addEventListener('pointermove', (e) => {
    if (!stage || e.pointerType === 'touch') return;
    stage.pointer.tx = (e.clientX / innerWidth) * 2 - 1;
    stage.pointer.ty = (e.clientY / innerHeight) * 2 - 1;
  });

  let readyAt = 0;
  if (stage) {
    const d = canvas.dataset;
    stage.load(d.model, d.hdr, d.hdrHd)
      .then(() => { stage.ready = true; root.classList.add('is-ready'); readyAt = performance.now(); setTimeout(layout, 1000); })
      .catch(() => root.classList.add('no-webgl', 'is-ready'));
  }

  const pt = { x: 0, y: 0, z: 0 };
  let last = performance.now();
  const frame = (now) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const sy = scrollY;
    const vh = innerHeight;
    const max = document.documentElement.scrollHeight - vh;
    bar.style.transform = `scaleX(${clamp01(sy / Math.max(1, max)).toFixed(4)})`;
    nav.classList.toggle('is-solid', sy > 40);

    // Keyframe position
    let i = 0;
    while (i < keys.length - 2 && sy >= keys[i + 1].y) i++;
    const raw = clamp01((sy - keys[i].y) / Math.max(1, keys[i + 1].y - keys[i].y));
    const t = smooth(clamp01((raw - 0.12) / 0.76));
    const fIndex = i + t;

    // Flip section
    const fr = flip.getBoundingClientRect();
    const fp = clamp01(-fr.top / Math.max(1, fr.height - vh));
    flipBar.style.transform = `scaleX(${fp.toFixed(3)})`;
    flip.classList.toggle('is-b', fp > 0.5);

    // Parallax + marquee + footer word
    if (!reduced) {
      tiles.forEach((tile) => {
        const r = tile.getBoundingClientRect();
        if (r.bottom < 0 || r.top > vh) return;
        const off = (r.top + r.height / 2 - vh / 2) * Number(tile.dataset.parallax);
        tile.firstElementChild.style.transform = `translate3d(0, ${off.toFixed(1)}px, 0)`;
      });
      const mr = marquee.getBoundingClientRect();
      if (mr.bottom > 0 && mr.top < vh) marquee.style.transform = `translate3d(${(-(sy * 0.35) % (marquee.scrollWidth / 2)).toFixed(1)}px,0,0)`;
      const wr = footWord.getBoundingClientRect();
      if (wr.top < vh) footWord.style.transform = `translate3d(0, ${((wr.top - vh) * -0.25).toFixed(1)}px, 0)`;
    }

    // Phones: sticky buy bar between hero and the buy section
    const br = buySec.getBoundingClientRect();
    stickyBuy.classList.toggle('is-on', sy > vh * 0.8 && (br.top > vh || br.bottom < 0));

    if (stage) {
      stage.fade = readyAt ? (reduced ? 1 : smooth(clamp01((now - readyAt) / 1400))) : 0;
      stage.heroW = i === 0 ? 1 - t : 0;
      stage.update(keys[i].name, keys[i + 1].name, t, dt, now);
      if (stage.model && readyAt) {
        const tall = stage.tall;
        callouts.forEach((c, n) => {
          const ki = keys.findIndex((k) => k.name === c.dataset.key);
          let o = clamp01(1 - Math.abs(fIndex - ki) * 2.4);
          if (c.dataset.key === 'hero' && !reduced) o *= clamp01((now - readyAt - 1100 - n * 220) / 600);
          if (c.dataset.anchor.startsWith('logo') && !stage.logoFacing()) o = 0;
          stage.project(c.dataset.anchor, pt);
          if (pt.x < 0 || pt.x > innerWidth || pt.y < 60 || pt.y > vh) o = 0;
          if (o <= 0.01) {
            c.style.opacity = 0;
            c._line.style.opacity = c._dot.style.opacity = c._ring.style.opacity = 0;
            return;
          }
          const dx = Number((tall && c.dataset.mdx) || c.dataset.dx);
          const dy = Number((tall && c.dataset.mdy) || c.dataset.dy);
          const w = c.offsetWidth;
          const h = c.offsetHeight;
          const ly = MathUtils.clamp(pt.y + dy, 80 + h, vh - 24 - h);
          let bx;
          if (tall && c.dataset.malign) bx = c.dataset.malign === 'r' ? innerWidth - w - 16 : 16;
          else bx = dx < 0 ? pt.x + dx - w : pt.x + dx;
          bx = MathUtils.clamp(bx, 16, innerWidth - w - 16);
          const ex = MathUtils.clamp(pt.x, bx, bx + w);
          const far = Math.abs(bx - ex) > Math.abs(bx + w - ex) ? bx : bx + w;
          const near = far === bx ? bx + w : bx;
          const top = dy < 0 ? ly - h - 8 : ly + 8;
          c.style.transform = `translate3d(${bx.toFixed(1)}px, ${top.toFixed(1)}px, 0)`;
          c.style.opacity = o;
          const g = Math.min(1, o * 2);
          const r = Math.max(0, (o - 0.5) * 2);
          c._line.setAttribute('points', o < 0.5
            ? `${pt.x},${pt.y} ${pt.x + (ex - pt.x) * g},${pt.y + (ly - pt.y) * g}`
            : `${pt.x},${pt.y} ${ex},${ly} ${ex + (near - ex) * r},${ly} ${ex},${ly} ${ex + (far - ex) * r},${ly}`);
          for (const d of [c._dot, c._ring]) {
            d.setAttribute('cx', pt.x.toFixed(1));
            d.setAttribute('cy', pt.y.toFixed(1));
          }
          c._line.style.opacity = c._dot.style.opacity = Math.min(1, o * 3);
          c._ring.style.opacity = o;
        });
      }
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  window.akShop = { stage, keys: () => keys };
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
