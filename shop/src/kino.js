/*
 * ANIRIUS "Kino": a cinematic product film on black. Centred knife, scroll-driven camera moves
 * (macro on the fine teeth, the coarse teeth, the logo), full-bleed film stills with a slow zoom and
 * letterbox bars, and a finale where the knife fans out into the six of the set.
 * Bundled by `npm run build:kino` into shop/kino.js.
 */
import { WebGLRenderer, Scene, PerspectiveCamera, Group, Vector3, Box3, Euler, MathUtils, ACESFilmicToneMapping, SRGBColorSpace } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import {
  Mesh, Color, MeshBasicMaterial, PlaneGeometry, DoubleSide, PMREMGenerator, CubeCamera, WebGLCubeRenderTarget, HalfFloatType, EquirectangularReflectionMapping,
} from 'three';

const PI = Math.PI;
const KNIFE_LEN = 0.225;
const BUTT = 0.1125;
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const clamp01 = (x) => MathUtils.clamp(x, 0, 1);
const smooth = (x) => x * x * (3 - 2 * x);
const L = MathUtils.lerp;

/*
 * Shots, one per [data-ch]. at: where the focus point sits (viewport fractions). len: knife length /
 * min(vw, 1.8 vh). focus: named model point (centre if omitted). r: Euler XYZ. o: opacity. fan: 0/1.
 */
const SHOTS = [
  { at: [0.5, 0.42], len: 0.66, r: [0.12, -0.22, 0], o: 1 }, // intro
  { at: [0.5, 0.4], len: 2.9, focus: 'fineC', r: [0.5, -0.08, 0.04], o: 1 }, // macro: fine teeth
  { at: [0.5, 0.4], len: 2.9, focus: 'coarseC', r: [PI + 0.5, -0.08, -0.04], o: 1 }, // macro: coarse teeth
  { at: [0.5, 0.4], len: 2.4, focus: 'logoMid', r: [-0.08, -0.14, 0.02], o: 1 }, // macro: logo
  { at: [0.5, 0.4], len: 1.2, focus: 'logoMid', r: [-0.08, -0.3, 0.3], o: 0 }, // still (covered)
  { at: [0.5, 0.4], len: 0.8, r: [0.2, -0.3, 0.5], o: 0 }, // still (covered)
  { at: [0.5, 0.45], len: 0.5, r: [0.1, -0.1, PI / 2], o: 0, fan: 0 }, // tv
  { at: [0.5, 0.73], len: 0.3, r: [0.08, -0.1, PI / 2], o: 1, fan: 1 }, // set: fan below the headline
  { at: [0.5, 0.73], len: 0.3, r: [0.08, -0.1, PI / 2], o: 0, fan: 1 }, // buy (covered)
];
const FAN = [-0.66, -0.4, -0.13, 0.13, 0.4, 0.66];

// The approved studio lighting.
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
    this.camera = new PerspectiveCamera(22, 1, 0.01, 20);
    this.camera.position.set(0, 0, 1);
    this.pivot = new Group();
    this.sway = new Group();
    this.fan = new Group();
    this.pivot.add(this.sway);
    this.sway.add(this.fan);
    this.scene.add(this.pivot);
    this.holders = [];
    this.cur = null;
  }

  load(model, hdr, hdrHd) {
    const hd = innerWidth >= 1024 && hdrHd;
    const env = new Promise((resolve) => new RGBELoader().load(hd ? hdrHd : hdr, (h) => {
      this.scene.environment = studioEnvironment(this.renderer, h, hd ? 512 : 256);
      h.dispose();
      resolve();
    }, undefined, resolve));
    const mesh = new Promise((resolve, reject) => {
      const l = new GLTFLoader();
      l.setMeshoptDecoder(MeshoptDecoder);
      l.load(model, (g) => {
        const root = g.scene;
        root.traverse((o) => {
          if (!o.isMesh) return;
          const m = o.material;
          if (m.name === 'laser_etch') { m.color.setRGB(0.05, 0.06, 0.08); m.metalness = 0.85; m.roughness = 0.55; }
          else { m.color.setRGB(0.96, 0.955, 0.945); m.metalness = 1; m.roughness = 0.06; }
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
        const lb = new Box3();
        root.traverse((o) => { if (o.isMesh && o.material.name === 'laser_etch') lb.expandByObject(o); });
        this.anchors = { fineC: edge(0.06, 1), coarseC: edge(0.06, -1), logoMid: lb.getCenter(new Vector3()) };
        FAN.forEach((_, i) => {
          const h = new Group();
          h.position.set(-BUTT, 0, (i - 2.5) * 0.0045);
          const k = i === 2 ? root : root.clone();
          k.position.x = BUTT;
          h.add(k);
          h.visible = i === 2;
          this.fan.add(h);
          this.holders.push(h);
        });
        resolve();
      }, undefined, reject);
    });
    return Promise.all([mesh, env]);
  }

  resize(w, h) {
    this.w = w;
    this.h = h;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.visH = 2 * Math.tan(MathUtils.degToRad(11));
    this.visW = this.visH * this.camera.aspect;
  }

  pose(S) {
    const base = Math.min(this.visW, this.visH * 1.8);
    const s = (S.len * base) / KNIFE_LEN;
    const f = S.focus ? this.anchors[S.focus].clone() : new Vector3();
    f.applyEuler(new Euler(...S.r)).multiplyScalar(s);
    return { x: (S.at[0] - 0.5) * this.visW - f.x, y: -(S.at[1] - 0.5) * this.visH - f.y, s, r: S.r, o: S.o, fan: S.fan || 0 };
  }

  update(f, dt, time, intro) {
    const i = Math.min(SHOTS.length - 2, Math.floor(f));
    const t = smooth(clamp01(f - i));
    const A = this.pose(SHOTS[i]);
    const B = this.pose(SHOTS[i + 1]);
    const T = { x: L(A.x, B.x, t), y: L(A.y, B.y, t), s: Math.exp(L(Math.log(A.s), Math.log(B.s), t)), r: A.r.map((v, n) => L(v, B.r[n], t)), o: L(A.o, B.o, t), fan: L(A.fan, B.fan, t) };
    const k = reduced || !this.cur ? 1 : 1 - Math.exp(-dt * 6);
    if (!this.cur) this.cur = { ...T, r: [...T.r] };
    const c = this.cur;
    c.x += (T.x - c.x) * k;
    c.y += (T.y - c.y) * k;
    c.s *= Math.pow(T.s / c.s, k);
    c.r = c.r.map((v, n) => v + (T.r[n] - v) * k);
    c.o += (T.o - c.o) * k;
    c.fan += (T.fan - c.fan) * k;

    // Intro: the knife turns in out of the dark and settles.
    const e = 1 - Math.pow(1 - intro, 3);
    this.pivot.position.set(c.x, c.y, 0);
    this.pivot.scale.setScalar(c.s * (0.9 + 0.1 * e));
    this.pivot.rotation.set(c.r[0], c.r[1] - (1 - e) * 1.1, c.r[2]);

    // Slow rock about the blade so light glides along it (strongest in the intro and macro shots).
    const tt = reduced ? 0 : time * 0.001;
    const rock = clamp01(1 - (f - 3) * 1.5);
    this.sway.rotation.set(rock * (0.03 + 0.1 * Math.sin(tt * 0.7)), Math.sin(tt * 0.45) * 0.03, 0);
    this.holders.forEach((h, n) => { h.rotation.z = FAN[n] * smooth(clamp01(c.fan)); h.visible = n === 2 || c.fan > 0.01; });

    this.canvas.style.opacity = (c.o * e).toFixed(3);
    if (c.o * e > 0.005) this.renderer.render(this.scene, this.camera);
  }
}

function init() {
  const root = document.documentElement;
  const canvas = document.querySelector('.stage');
  const chapters = [...document.querySelectorAll('[data-ch]')];
  const texts = chapters.map((s) => s.querySelector('.shot__text, .still__text, .tv__text, .set__text, .intro__text'));
  const stills = [...document.querySelectorAll('.still')];

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

  let readyAt = 0;
  if (stage) {
    const d = canvas.dataset;
    stage.load(d.model, d.hdr, d.hdrHd).then(() => { readyAt = performance.now(); root.classList.add('is-ready'); }).catch(() => root.classList.add('is-ready'));
  }

  // Buy box
  const form = document.querySelector('[data-buy]');
  const toast = document.querySelector('.toast');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const btn = form.querySelector('.btn');
    btn.classList.add('is-done');
    btn.textContent = 'Hinzugefügt';
    toast.textContent = 'Demo: Die Kasse wird mit Shopify verbunden.';
    toast.classList.add('is-on');
    setTimeout(() => { btn.classList.remove('is-done'); btn.textContent = 'In den Warenkorb'; toast.classList.remove('is-on'); }, 2400);
  });

  const chapterAt = (y) => {
    let i = 0;
    while (i < centres.length - 2 && y >= centres[i + 1]) i++;
    const t = clamp01((y - centres[i]) / Math.max(1, centres[i + 1] - centres[i]));
    return i + clamp01((t - 0.2) / 0.6);
  };

  let last = performance.now();
  const frame = (now) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const f = chapterAt(scrollY);
    texts.forEach((el, i) => {
      if (!el || i === 0) return;
      el.style.setProperty('--v', clamp01(1 - Math.abs(f - i) * 2.2).toFixed(3));
    });
    if (texts[0]) texts[0].style.setProperty('--v', clamp01(1 - f * 2.5).toFixed(3));
    stills.forEach((s) => {
      const i = chapters.indexOf(s);
      const r = s.getBoundingClientRect();
      const p = clamp01(-r.top / Math.max(1, r.height - innerHeight));
      const img = s.querySelector('.still__img');
      img.style.setProperty('--z', (1.2 - p * 0.18).toFixed(4));
      img.style.setProperty('--io', clamp01(1 - Math.abs(f - i) * 1.4).toFixed(3));
      s.querySelector('.still__pin').style.setProperty('--bar', `${(clamp01(1 - Math.abs(f - i) * 1.6) * 7).toFixed(2)}vh`);
    });
    if (stage && readyAt) stage.update(f, dt, now, reduced ? 1 : clamp01((now - readyAt) / 2200));
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  window.akKino = { stage, chapterAt };
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
