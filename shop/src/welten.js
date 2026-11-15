/*
 * ANIRIUS "Zwei Welten": sharp 3D knife in front of blurred photo backdrops (shallow-focus product shot).
 * The knife never touches the photos; it only reflects them: each chapter's reflection environment is
 * built from that chapter's photo plus a few soft strip lights, so the steel takes on its colours.
 * Finale: the knife fans out into the six knives of the set.
 * Bundled by `npm run build:welten` into shop/welten.js.
 */
import {
  WebGLRenderer, Scene, PerspectiveCamera, Group, Color, Mesh, Euler, MathUtils, Vector3, Box3,
  MeshBasicMaterial, PlaneGeometry, DoubleSide, PMREMGenerator, ACESFilmicToneMapping, SRGBColorSpace,
  CubeCamera, WebGLCubeRenderTarget, HalfFloatType, TextureLoader, EquirectangularReflectionMapping,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

const PI = Math.PI;
const KNIFE_LEN = 0.225;
const BUTT = 0.1125; // handle end, from the knife centre
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const clamp01 = (x) => MathUtils.clamp(x, 0, 1);
const smooth = (x) => x * x * (3 - 2 * x);
const L = MathUtils.lerp;

/*
 * One pose per chapter. x, y: knife centre in viewport fractions. len: knife length as a fraction of
 * min(viewport width, 1.8 × height). r: Euler XYZ (model: +X tip, +Y fine edge, +Z logo face).
 */
const POSES = {
  wide: [
    { x: 0.7, y: 0.58, len: 1.19, focus: 0.056, r: [0, -0.18, 0.9] }, // hero: blade only, handle below the screen
    { x: 0.64, y: 0.5, len: 0.68, r: [0.38, -0.3, 0.2] }, // fine edge tipped towards the viewer
    { x: 0.64, y: 0.5, len: 0.68, r: [PI - 0.6, -0.42, -0.2] }, // turned over: coarse edge to the viewer
    { x: 0.66, y: 0.5, len: 0.4, r: [0.1, -0.12, PI / 2 - 0.05] }, // set: upright, fans out from the handle
  ],
  tall: [
    { x: 0.58, y: 0.36, len: 1.7, focus: 0.056, r: [0, -0.15, 0.4] },
    { x: 0.5, y: 0.3, len: 1.1, r: [0.38, -0.3, 0.2] },
    { x: 0.5, y: 0.3, len: 1.1, r: [PI - 0.6, -0.4, -0.2] },
    { x: 0.5, y: 0.36, len: 0.55, r: [0.1, -0.1, PI / 2 - 0.05] },
  ],
};
const FAN = [-0.62, -0.37, -0.12, 0.12, 0.37, 0.62]; // final angles of the six knives

// Reflection environment from a photo: the photo all around (soft, it is pre-filtered anyway),
// plus a top softbox and two strips so the steel keeps clean highlights.
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
  // Soft key in front (the photographer's main light): the blade face mirrors it, so the steel reads
  // bright and silver over any photo; the photo's colours stay on the bevels and edges.
  add(5.5, 3.6, [-1.6, 1.4, 6], 1.5);
  add(9, 6, [0, 0, 7.5], 0.35);
  // Low front fill: when the fine edge tips towards the viewer the face looks down, and mirrors this.
  add(7, 3, [0.8, -3.4, 5.6], 1.2);
  add(5, 4, [-2.4, -3.6, 4.4], 1.4);
  add(1.2, 8, [-6, 0.5, 3.5], 1.5);
  add(1.2, 8, [6, 0.5, -2], 1.7);
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
    this.renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(2, Math.max(1.25, devicePixelRatio || 1)));
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
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

  load(model, photos) {
    const envs = Promise.all(photos.map((src, i) => new Promise((resolve) => new TextureLoader().load(src, (t) => {
      t.colorSpace = SRGBColorSpace;
      this.envs[i] = photoEnvironment(this.renderer, t);
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
            m.color.setRGB(0.05, 0.05, 0.06);
            m.metalness = 0.8;
            m.roughness = 0.55;
          } else {
            m.color.setRGB(0.96, 0.95, 0.93);
            m.metalness = 1;
            m.roughness = 0.09;
          }
        });
        // Callout anchors (model space): fine edge, coarse edge, logo.
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
        this.main = root;
        // Six knives that pivot around their handle ends; at angle 0 they sit exactly on top of each other.
        FAN.forEach((_, i) => {
          const holder = new Group();
          holder.position.set(-BUTT, 0, (i - 2.5) * 0.0045);
          const k = i === 0 ? root : root.clone();
          k.position.x = BUTT;
          holder.add(k);
          holder.visible = i === 2;
          this.fan.add(holder);
          this.holders.push(holder);
        });
        resolve();
      }, undefined, reject);
    });
    return Promise.all([mesh, envs]);
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

  project(name, out) {
    const v = this.anchors[name].clone().applyMatrix4(this.main.matrixWorld).project(this.camera);
    out.x = (v.x * 0.5 + 0.5) * this.w;
    out.y = (-v.y * 0.5 + 0.5) * this.h;
    return out;
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
    };
    // Focus: put a point along the blade (not the knife centre) at x/y.
    const fx = L(A.focus || 0, B.focus || 0, t);
    if (fx) {
      const o = new Vector3(fx, 0, 0).applyEuler(new Euler(...T.r)).multiplyScalar(T.s);
      T.x -= o.x;
      T.y -= o.y;
    }
    const k = reduced || !this.cur ? 1 : 1 - Math.exp(-dt * 6);
    if (!this.cur) this.cur = { ...T, r: [...T.r] };
    const c = this.cur;
    c.x += (T.x - c.x) * k;
    c.y += (T.y - c.y) * k;
    c.s *= Math.pow(T.s / c.s, k);
    c.r = c.r.map((v, n) => v + (T.r[n] - v) * k);
    this.pivot.position.set(c.x, c.y, 0);
    this.pivot.scale.setScalar(c.s);
    this.pivot.rotation.set(...c.r);

    // Slow float + pointer parallax.
    const p = this.pointer;
    p.x += (p.tx - p.x) * (1 - Math.exp(-dt * 3));
    p.y += (p.ty - p.y) * (1 - Math.exp(-dt * 3));
    const tt = reduced ? 0 : time * 0.001;
    this.sway.rotation.set(p.y * 0.08 + Math.sin(tt * 0.6) * 0.04, p.x * 0.12 + Math.sin(tt * 0.4) * 0.05, 0);
    this.sway.position.y = reduced ? 0 : Math.sin(tt * 0.8) * 0.004;

    // Finale: the knives fan out from the handle like a hand of cards.
    const open = smooth(clamp01((f - 2.35) / 0.65));
    this.holders.forEach((h, n) => {
      h.rotation.z = FAN[n] * open;
      h.visible = n === 2 || open > 0.01;
    });
    // Reflections follow the chapter (switch while the knife is turning between chapters).
    this.scene.updateMatrixWorld(true);
    const env = this.envs[Math.round(f)];
    if (env) this.scene.environment = env;
    this.renderer.render(this.scene, this.camera);
  }
}

function init() {
  const root = document.documentElement;
  const canvas = document.querySelector('.stage');
  const backdrops = [...document.querySelectorAll('.bd')];
  const chapters = [...document.querySelectorAll('[data-ch]')];

  const io = new IntersectionObserver((es) => es.forEach((e) => {
    if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); }
  }), { rootMargin: '0px 0px -15% 0px' });
  document.querySelectorAll('.reveal').forEach((el) => io.observe(el));

  let stage = null;
  try { stage = new Stage(canvas); } catch (e) { root.classList.add('is-ready'); }

  // Chapter float from scroll: chapter i is "on" when its section is centred in the viewport.
  let centres = [];
  const layout = () => {
    if (stage) stage.resize(innerWidth, innerHeight);
    centres = chapters.map((el, i) => (i === 0 ? 0 : el.offsetTop + el.offsetHeight / 2 - innerHeight / 2));
  };
  layout();
  addEventListener('resize', layout);
  addEventListener('load', layout);
  addEventListener('pointermove', (e) => {
    if (!stage || e.pointerType === 'touch') return;
    stage.pointer.tx = (e.clientX / innerWidth) * 2 - 1;
    stage.pointer.ty = (e.clientY / innerHeight) * 2 - 1;
  });

  let ready = false;
  let readyAt = 0;
  if (stage) {
    stage.load(canvas.dataset.model, canvas.dataset.photos.split(','))
      .then(() => { ready = true; readyAt = performance.now(); root.classList.add('is-ready'); })
      .catch(() => root.classList.add('is-ready'));
  }

  // Hero callouts: leader lines from real points on the blade.
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
    return i + clamp01((t - 0.15) / 0.7); // hold on each chapter, move between
  };

  let last = performance.now();
  const frame = (now) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const f = chapterAt(scrollY);
    backdrops.forEach((b, i) => {
      b.style.opacity = clamp01(1 - Math.abs(f - i) * 1.4).toFixed(3);
      if (!reduced) b.style.transform = `scale(1.08) translate3d(0, ${(-(f - i) * 2.5).toFixed(2)}%, 0)`; // slow parallax
    });
    if (stage && ready) {
      stage.update(f, dt, now);
      drawCallouts(clamp01(1 - f * 2.5) * clamp01((now - readyAt - 900) / 700));
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  window.akWelten = { stage, chapterAt, centres: () => centres };
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
