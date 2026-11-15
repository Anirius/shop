/*
 * ANIRIUS one-page shop, v2.
 * One fixed 3D stage driven by scroll "chapters" ([data-ch] sections). Each chapter has a knife pose,
 * a reflection environment (studio HDR, or built from that chapter's photo backdrop) and an opacity.
 * Hero: blade-only diagonal with callouts and a slow light sweep. Gift: the knife fans out into six.
 * Bundled by `npm run build:main` into shop/main.js.
 */
import {
  WebGLRenderer, Scene, PerspectiveCamera, Group, Color, Mesh, Euler, MathUtils, Vector3, Box3,
  MeshBasicMaterial, PlaneGeometry, DoubleSide, PMREMGenerator, ACESFilmicToneMapping, SRGBColorSpace,
  CubeCamera, WebGLCubeRenderTarget, HalfFloatType, TextureLoader, EquirectangularReflectionMapping,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

const PI = Math.PI;
const KNIFE_LEN = 0.225;
const BUTT = 0.1125;
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const clamp01 = (x) => MathUtils.clamp(x, 0, 1);
const smooth = (x) => x * x * (3 - 2 * x);
const L = MathUtils.lerp;

/*
 * Chapter poses. x, y: viewport fractions; len: knife length / min(vw, 1.8 × vh); focus: model x put at
 * x/y (0 = knife centre); r: Euler XYZ (+X tip, +Y fine edge, +Z logo); o: opacity; env: 0 studio,
 * 1 tomato, 2 bread, 3 table; fan: 1 = six knives fanned out.
 */
const POSES = {
  wide: [
    { x: 0.7, y: 0.58, len: 1.19, focus: 0.056, r: [0, -0.18, 0.9], o: 1, env: 0 }, // hero
    { x: 0.74, y: 0.5, len: 0.5, r: [0.2, -0.32, 0.18], o: 1, env: 0 }, // Messer-Berg
    { x: 0.64, y: 0.5, len: 0.68, r: [0.38, -0.3, 0.2], o: 1, env: 1 }, // fine
    { x: 0.64, y: 0.5, len: 0.68, r: [PI - 0.6, -0.42, -0.2], o: 1, env: 2 }, // coarse
    { x: 0.66, y: 0.5, len: 0.5, r: [PI - 0.3, -0.3, 0.6], o: 0, env: 2 }, // TV (covered)
    { x: 0.66, y: 0.5, len: 0.4, r: [0.1, -0.12, PI / 2 - 0.05], o: 1, env: 3, fan: 1 }, // gift
    { x: 0.66, y: 0.4, len: 0.4, r: [0.1, -0.12, PI / 2 - 0.05], o: 0, env: 3, fan: 1 }, // buy (covered)
    { x: 0.66, y: 0.4, len: 0.4, r: [0.1, -0.12, PI / 2 - 0.05], o: 0, env: 3, fan: 1 }, // faq (covered)
  ],
  tall: [
    { x: 0.6, y: 0.72, len: 1.5, focus: 0.056, r: [0, -0.15, 0.4], o: 1, env: 0 },
    { x: 0.5, y: 0.3, len: 0.9, r: [0.2, -0.3, 0.18], o: 0.0, env: 0 },
    { x: 0.5, y: 0.3, len: 1.1, r: [0.38, -0.3, 0.2], o: 1, env: 1 },
    { x: 0.5, y: 0.3, len: 1.1, r: [PI - 0.6, -0.4, -0.2], o: 1, env: 2 },
    { x: 0.5, y: 0.3, len: 0.9, r: [PI - 0.3, -0.3, 0.6], o: 0, env: 2 },
    { x: 0.5, y: 0.36, len: 0.55, r: [0.1, -0.1, PI / 2 - 0.05], o: 1, env: 3, fan: 1 },
    { x: 0.5, y: 0.36, len: 0.55, r: [0.1, -0.1, PI / 2 - 0.05], o: 0, env: 3, fan: 1 },
    { x: 0.5, y: 0.36, len: 0.55, r: [0.1, -0.1, PI / 2 - 0.05], o: 0, env: 3, fan: 1 },
  ],
};
const FAN = [-0.62, -0.37, -0.12, 0.12, 0.37, 0.62];

// The approved studio lighting (same as the v1 shop).
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

// Reflection environment from a photo backdrop, with a soft front key so the steel stays silver.
function photoEnvironment(renderer, photo) {
  const env = new Scene();
  photo.mapping = EquirectangularReflectionMapping;
  env.background = photo;
  env.backgroundIntensity = 1.3;
  const add = (w, h, p, c) => {
    const m = new Mesh(new PlaneGeometry(w, h), new MeshBasicMaterial({ color: new Color(c, c, c), side: DoubleSide }));
    m.position.set(...p);
    m.lookAt(0, 0, 0);
    env.add(m);
  };
  add(7, 2.2, [0, 6.5, 2], 2.4);
  add(1.2, 8, [-6, 0.5, 3.5], 1.5);
  add(1.2, 8, [6, 0.5, -2], 1.7);
  add(5.5, 3.6, [-1.6, 1.4, 6], 1.5);
  add(9, 6, [0, 0, 7.5], 0.35);
  add(7, 3, [0.8, -3.4, 5.6], 1.2);
  add(5, 4, [-2.4, -3.6, 4.4], 1.4);
  const pmrem = new PMREMGenerator(renderer);
  const rt = new WebGLCubeRenderTarget(256, { type: HalfFloatType });
  new CubeCamera(0.1, 100, rt).update(renderer, env);
  const tex = pmrem.fromCubemap(rt.texture).texture;
  rt.dispose();
  pmrem.dispose();
  env.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
  return tex;
}

class Stage {
  constructor(canvas) {
    const desktop = innerWidth >= 1024;
    this.canvas = canvas;
    this.renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(2, desktop ? Math.max(1.5, devicePixelRatio || 1) : devicePixelRatio || 1));
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.setClearColor(0, 0);
    this.scene = new Scene();
    this.camera = new PerspectiveCamera(22, 1, 0.02, 20);
    this.camera.position.set(0, 0, 1);
    this.pivot = new Group();
    this.sway = new Group();
    this.fan = new Group();
    this.pivot.add(this.sway);
    this.sway.add(this.fan);
    this.scene.add(this.pivot);
    this.holders = [];
    this.envs = [];
    this.pointer = { x: 0, y: 0, tx: 0, ty: 0 };
    this.cur = null;
  }

  load(model, hdr, hdrHd, photos) {
    const studio = new Promise((resolve) => new RGBELoader().load(innerWidth >= 1024 && hdrHd ? hdrHd : hdr, (h) => {
      this.envs[0] = studioEnvironment(this.renderer, h, innerWidth >= 1024 ? 512 : 256);
      h.dispose();
      resolve();
    }, undefined, resolve));
    const fromPhotos = Promise.all(photos.map((src, i) => new Promise((resolve) => new TextureLoader().load(src, (t) => {
      t.colorSpace = SRGBColorSpace;
      this.envs[i + 1] = photoEnvironment(this.renderer, t);
      resolve();
    }, undefined, resolve))));
    const mesh = new Promise((resolve, reject) => {
      const l = new GLTFLoader();
      l.setMeshoptDecoder(MeshoptDecoder);
      l.load(model, (gltf) => {
        const root = gltf.scene;
        root.traverse((o) => {
          if (!o.isMesh) return;
          const m = o.material;
          if (m.name === 'laser_etch') {
            m.color.setRGB(0.05, 0.06, 0.08);
            m.metalness = 0.85;
            m.roughness = 0.55;
          } else {
            m.color.setRGB(0.96, 0.955, 0.945);
            m.metalness = 1;
            m.roughness = 0.06;
          }
        });
        root.updateMatrixWorld(true);
        const edge = (x, sign) => {
          let best = 0;
          let z = 0;
          const v = new Vector3();
          root.traverse((o) => {
            if (!o.isMesh || o.material.name === 'laser_etch') return;
            const pa = o.geometry.attributes.position;
            for (let i = 0; i < pa.count; i++) {
              v.fromBufferAttribute(pa, i).applyMatrix4(o.matrixWorld);
              if (Math.abs(v.x - x) < 0.0015 && v.y * sign > best * sign) { best = v.y; z = v.z; }
            }
          });
          return new Vector3(x, best, z);
        };
        const logoBox = new Box3();
        root.traverse((o) => { if (o.isMesh && o.material.name === 'laser_etch') logoBox.expandByObject(o); });
        const lc = logoBox.getCenter(new Vector3());
        this.anchors = { fine: edge(0.072, 1), coarse: edge(0.05, -1), logo: new Vector3(lc.x, logoBox.max.y, logoBox.max.z) };
        // Six knives pivoting around their handle ends (on top of each other until the gift chapter).
        FAN.forEach((_, i) => {
          const holder = new Group();
          holder.position.set(-BUTT, 0, (i - 2.5) * 0.0045);
          const k = i === 2 ? root : root.clone();
          k.position.x = BUTT;
          holder.add(k);
          holder.visible = i === 2;
          this.fan.add(holder);
          this.holders.push(holder);
        });
        this.main = root;
        resolve();
      }, undefined, reject);
    });
    return Promise.all([mesh, studio, fromPhotos]);
  }

  resize(w, h) {
    this.w = w;
    this.h = h;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.tall = w / h < 0.9 || w <= 820;
    this.visH = 2 * Math.tan(MathUtils.degToRad(this.camera.fov / 2));
    this.visW = this.visH * this.camera.aspect;
  }

  update(f, dt, time) {
    const P = POSES[this.tall ? 'tall' : 'wide'];
    const i = Math.min(P.length - 2, Math.floor(f));
    const t = smooth(clamp01(f - i));
    const A = P[i];
    const B = P[i + 1];
    const base = Math.min(this.visW, this.visH * 1.8);
    const T = {
      x: (L(A.x, B.x, t) - 0.5) * this.visW,
      y: -(L(A.y, B.y, t) - 0.5) * this.visH,
      s: (L(A.len, B.len, t) * base) / KNIFE_LEN,
      r: A.r.map((v, n) => L(v, B.r[n], t)),
      o: L(A.o, B.o, t),
    };
    const fx = L(A.focus || 0, B.focus || 0, t);
    if (fx) {
      const v = new Vector3(fx, 0, 0).applyEuler(new Euler(...T.r)).multiplyScalar(T.s);
      T.x -= v.x;
      T.y -= v.y;
    }
    const k = reduced || !this.cur ? 1 : 1 - Math.exp(-dt * 6);
    if (!this.cur) this.cur = { ...T, r: [...T.r] };
    const c = this.cur;
    c.x += (T.x - c.x) * k;
    c.y += (T.y - c.y) * k;
    c.s *= Math.pow(T.s / c.s, k);
    c.r = c.r.map((v, n) => v + (T.r[n] - v) * k);
    c.o += (T.o - c.o) * k;
    this.pivot.position.set(c.x, c.y, 0);
    this.pivot.scale.setScalar(c.s);
    this.pivot.rotation.set(...c.r);

    // Hero: slow rock around the blade's long axis, so the light glides over the steel.
    // Elsewhere: gentle float and pointer parallax.
    const hw = clamp01(1 - f * 1.5);
    const p = this.pointer;
    p.x += (p.tx - p.x) * (1 - Math.exp(-dt * 3));
    p.y += (p.ty - p.y) * (1 - Math.exp(-dt * 3));
    const tt = reduced ? 0 : time * 0.001;
    const sweep = reduced ? 0 : hw * (0.05 + 0.16 * Math.sin(tt * 0.75));
    const calm = 1 - 0.7 * hw;
    this.sway.rotation.set(sweep + (p.y * 0.07 + Math.sin(tt * 0.6) * 0.035) * calm, (p.x * 0.1 + Math.sin(tt * 0.4) * 0.04) * calm, 0);
    this.sway.position.y = reduced ? 0 : Math.sin(tt * 0.8) * 0.003 * calm;

    const fanOpen = smooth(clamp01((f - 4.35) / 0.65));
    this.holders.forEach((h, n) => {
      h.rotation.z = FAN[n] * fanOpen;
      h.visible = n === 2 || fanOpen > 0.01;
    });
    const env = this.envs[(t < 0.5 ? A : B).env];
    if (env) this.scene.environment = env;
    this.canvas.style.opacity = (c.o * (this.fade ?? 1)).toFixed(3);
    this.scene.updateMatrixWorld(true);
    if (c.o > 0.005) this.renderer.render(this.scene, this.camera);
  }

  project(name, out) {
    const v = this.anchors[name].clone().applyMatrix4(this.main.matrixWorld).project(this.camera);
    out.x = (v.x * 0.5 + 0.5) * this.w;
    out.y = (-v.y * 0.5 + 0.5) * this.h;
    return out;
  }
}

// ---------------------------------------------------------------- cart

const SKUS = {
  1: { title: 'ANIRIUS® 2-in-1 · 1 Set', sub: '6 Messer · 1 Geschenkbox', price: 39.95 },
  2: { title: 'ANIRIUS® 2-in-1 · 2 Sets', sub: '12 Messer · 2 Geschenkboxen', price: 64.9 },
};
const fmt = (n) => n.toFixed(2).replace('.', ',') + ' €';

function initCart() {
  const el = document.querySelector('[data-cart]');
  const body = el.querySelector('[data-cart-body]');
  const sum = el.querySelector('[data-cart-sum]');
  const count = document.querySelector('[data-cart-count]');
  const toast = document.querySelector('.toast');
  let items = {};
  try { items = JSON.parse(localStorage.getItem('anirius-cart-v2')) || {}; } catch (e) { /* storage blocked */ }
  let tid;
  const say = (msg) => { toast.textContent = msg; toast.classList.add('is-on'); clearTimeout(tid); tid = setTimeout(() => toast.classList.remove('is-on'), 2600); };
  const render = () => {
    const keys = Object.keys(items).filter((k) => items[k] > 0);
    const n = keys.reduce((a, k) => a + items[k], 0);
    count.textContent = n;
    count.classList.toggle('has', n > 0);
    sum.textContent = fmt(keys.reduce((a, k) => a + items[k] * SKUS[k].price, 0));
    body.innerHTML = keys.length ? keys.map((k) => `<div class="line"><div><h3>${SKUS[k].title}</h3><p>${SKUS[k].sub}</p>
      <div class="qty"><button type="button" data-k="${k}" data-d="-1" aria-label="Weniger">−</button><output>${items[k]}</output><button type="button" data-k="${k}" data-d="1" aria-label="Mehr">+</button></div></div>
      <div class="line__price">${fmt(items[k] * SKUS[k].price)}<button class="line__rm" type="button" data-k="${k}" data-d="0">Entfernen</button></div></div>`).join('')
      : '<p class="cart__empty">Dein Warenkorb ist leer.</p>';
    el.querySelector('[data-checkout]').disabled = !keys.length;
    try { localStorage.setItem('anirius-cart-v2', JSON.stringify(items)); } catch (e) { /* storage blocked */ }
  };
  const open = () => { el.classList.add('is-open'); el.setAttribute('aria-hidden', 'false'); };
  const close = () => { el.classList.remove('is-open'); el.setAttribute('aria-hidden', 'true'); };
  document.querySelectorAll('[data-open-cart]').forEach((b) => b.addEventListener('click', open));
  el.querySelectorAll('[data-close-cart]').forEach((b) => b.addEventListener('click', close));
  addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  body.addEventListener('click', (e) => {
    const b = e.target.closest('[data-k]');
    if (!b) return;
    const d = Number(b.dataset.d);
    items[b.dataset.k] = d === 0 ? 0 : Math.max(0, Math.min(10, (items[b.dataset.k] || 0) + d));
    render();
  });
  const form = document.querySelector('[data-buy]');
  const total = form.querySelector('[data-total]');
  const add = form.querySelector('[data-add]');
  const sku = () => form.querySelector('input[name=set]:checked').value;
  form.addEventListener('change', () => { total.textContent = fmt(SKUS[sku()].price); });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const k = sku();
    items[k] = Math.min(10, (items[k] || 0) + 1);
    render();
    count.classList.remove('bump');
    void count.offsetWidth;
    count.classList.add('bump');
    add.classList.add('is-done');
    setTimeout(() => add.classList.remove('is-done'), 1400);
    setTimeout(open, 350);
  });
  el.querySelector('[data-checkout]').addEventListener('click', () => say('Demo: Die Kasse wird mit Shopify verbunden.'));
  render();
}

// ---------------------------------------------------------------- page

function init() {
  const root = document.documentElement;
  const canvas = document.querySelector('.stage');
  const nav = document.querySelector('.nav');
  const bar = document.querySelector('.progress span');
  const backdrops = [...document.querySelectorAll('.bd')];
  const chapters = [...document.querySelectorAll('[data-ch]')];
  const marquee = document.querySelector('[data-marquee]');
  const stickyBuy = document.querySelector('.sticky-buy');
  const buySec = document.querySelector('#kaufen');
  const navLinks = [...document.querySelectorAll('.nav__links a')];

  initCart();

  const io = new IntersectionObserver((es) => es.forEach((e) => {
    if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); }
  }), { rootMargin: '0px 0px -12% 0px' });
  document.querySelectorAll('.reveal').forEach((el) => io.observe(el));
  const spy = new IntersectionObserver((es) => es.forEach((e) => {
    if (e.isIntersecting) navLinks.forEach((a) => a.classList.toggle('is-active', a.getAttribute('href') === '#' + e.target.id));
  }), { rootMargin: '-45% 0px -50% 0px' });
  navLinks.forEach((a) => { const s = document.querySelector(a.getAttribute('href')); if (s) spy.observe(s); });

  let stage = null;
  try { stage = new Stage(canvas); } catch (e) { root.classList.add('is-ready'); }

  let centres = [];
  const layout = () => {
    if (stage) stage.resize(innerWidth, innerHeight);
    centres = chapters.map((el, i) => (i === 0 ? 0 : el.offsetTop + el.offsetHeight / 2 - innerHeight / 2));
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

  let ready = false;
  let readyAt = 0;
  if (stage) {
    const d = canvas.dataset;
    stage.load(d.model, d.hdr, d.hdrHd, d.photos.split(','))
      .then(() => { ready = true; readyAt = performance.now(); root.classList.add('is-ready'); setTimeout(layout, 800); })
      .catch(() => root.classList.add('is-ready'));
  }

  // Hero callouts
  const svg = document.querySelector('.ann');
  const callouts = [...document.querySelectorAll('.callout')];
  const NS = 'http://www.w3.org/2000/svg';
  callouts.forEach((c) => {
    c._line = document.createElementNS(NS, 'polyline');
    c._ring = document.createElementNS(NS, 'circle');
    c._dot = document.createElementNS(NS, 'circle');
    c._ring.setAttribute('r', c.dataset.anchor === 'logo' ? 0 : 7);
    c._ring.setAttribute('class', 'ring');
    c._dot.setAttribute('r', 2.5);
    svg.append(c._line, c._ring, c._dot);
  });
  const pt = { x: 0, y: 0 };
  const drawCallouts = (o) => {
    svg.setAttribute('viewBox', `0 0 ${innerWidth} ${innerHeight}`);
    callouts.forEach((c) => {
      if (o <= 0.01) {
        c.style.opacity = 0;
        c._line.style.opacity = c._dot.style.opacity = c._ring.style.opacity = 0;
        return;
      }
      stage.project(c.dataset.anchor, pt);
      const tall = stage.tall;
      const dx = Number((tall && c.dataset.mdx) || c.dataset.dx);
      const dy = Number((tall && c.dataset.mdy) || c.dataset.dy);
      const w = c.offsetWidth;
      const h = c.offsetHeight;
      const ly = MathUtils.clamp(pt.y + dy, 80 + h, innerHeight - 24 - h);
      let bx = tall && c.dataset.malign ? (c.dataset.malign === 'r' ? innerWidth - w - 16 : 16) : dx < 0 ? pt.x + dx - w : pt.x + dx;
      bx = MathUtils.clamp(bx, 16, innerWidth - w - 16);
      const ex = MathUtils.clamp(pt.x, bx, bx + w);
      const far = Math.abs(bx - ex) > Math.abs(bx + w - ex) ? bx : bx + w;
      const top = dy < 0 ? ly - h - 8 : ly + 8;
      c.style.transform = `translate3d(${bx.toFixed(1)}px, ${top.toFixed(1)}px, 0)`;
      c.style.opacity = o;
      c._line.setAttribute('points', `${pt.x},${pt.y} ${ex},${ly} ${far},${ly}`);
      for (const d of [c._dot, c._ring]) { d.setAttribute('cx', pt.x.toFixed(1)); d.setAttribute('cy', pt.y.toFixed(1)); }
      c._line.style.opacity = c._dot.style.opacity = c._ring.style.opacity = o;
    });
  };

  const chapterAt = (y) => {
    let i = 0;
    while (i < centres.length - 2 && y >= centres[i + 1]) i++;
    const t = clamp01((y - centres[i]) / Math.max(1, centres[i + 1] - centres[i]));
    return i + clamp01((t - 0.15) / 0.7);
  };

  let last = performance.now();
  const frame = (now) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const sy = scrollY;
    const vh = innerHeight;
    bar.style.transform = `scaleX(${clamp01(sy / Math.max(1, document.documentElement.scrollHeight - vh)).toFixed(4)})`;
    nav.classList.toggle('is-solid', sy > 40);
    const f = chapterAt(sy);
    backdrops.forEach((b) => {
      const at = Number(b.dataset.at);
      b.style.opacity = clamp01(1 - Math.abs(f - at) * 1.4).toFixed(3);
      if (!reduced) b.style.transform = `translate3d(0, ${(-(f - at) * 2).toFixed(2)}%, 0)`;
    });
    if (marquee && !reduced) marquee.style.transform = `translate3d(${(-(now * 0.03) % (marquee.scrollWidth / 2)).toFixed(1)}px,0,0)`;
    const br = buySec.getBoundingClientRect();
    stickyBuy.classList.toggle('is-on', sy > vh * 0.8 && (br.top > vh || br.bottom < 0));
    if (stage && ready) {
      stage.fade = reduced ? 1 : smooth(clamp01((now - readyAt) / 1200));
      stage.update(f, dt, now);
      drawCallouts(clamp01(1 - f * 2.5) * (reduced ? 1 : clamp01((now - readyAt - 900) / 700)));
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  window.akMain = { stage, chapterAt, centres: () => centres };
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
