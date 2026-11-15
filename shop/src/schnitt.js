/*
 * ANIRIUS "Der Schnitt": bright editorial page with kinetic type.
 * Hero: the 3D knife slashes along a steep line and the giant photo-filled headline splits along it
 * (two copies of the type, each clipped to one side of the blade line, then pushed apart).
 * Then: the knife turns between two photo panels that open from circles, rides along a horizontal
 * gallery, and the page adds split-letter reveals, a strike-through list, a custom cursor and
 * magnetic buttons.
 * Bundled by `npm run build:schnitt` into shop/schnitt.js.
 */
import {
  WebGLRenderer, Scene, PerspectiveCamera, Group, Color, Mesh, MathUtils,
  MeshBasicMaterial, PlaneGeometry, DoubleSide, PMREMGenerator, ACESFilmicToneMapping, SRGBColorSpace,
  CubeCamera, WebGLCubeRenderTarget, HalfFloatType,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

const PI = Math.PI;
const KNIFE_LEN = 0.225;
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const fine = matchMedia('(hover: hover) and (pointer: fine)').matches;
const clamp01 = (x) => MathUtils.clamp(x, 0, 1);
const smooth = (x) => x * x * (3 - 2 * x);
const L = MathUtils.lerp;
const CUT_ANGLE = (-62 * PI) / 180; // the slash line, screen space (y down): steep, rising to the right

// Bright product-studio reflections: light-grey room, white softboxes, a few dark cards for definition.
function brightStudio(renderer) {
  const env = new Scene();
  env.background = new Color(0.16, 0.15, 0.14);
  const add = (w, h, p, c) => {
    const m = new Mesh(new PlaneGeometry(w, h), new MeshBasicMaterial({ color: new Color(...c), side: DoubleSide }));
    m.position.set(...p);
    m.lookAt(0, 0, 0);
    env.add(m);
  };
  add(30, 30, [0, -6, 0], [0.06, 0.055, 0.05]);
  add(8, 3, [0, 6.5, 2], [3, 3, 3]);
  add(6, 4, [-2, 1.5, 6.5], [2.2, 2.15, 2.05]);
  add(1.4, 9, [-6.5, 0.5, 2], [2.4, 2.4, 2.4]);
  add(1.4, 9, [6.5, 0.5, 2], [2.6, 2.6, 2.6]);
  add(3.5, 9, [3.2, 0, 6], [0.05, 0.05, 0.05]); // dark card: a crisp dark band in the steel
  add(10, 1.6, [0, -1.8, 6.4], [0.08, 0.08, 0.08]);
  const pmrem = new PMREMGenerator(renderer);
  const rt = new WebGLCubeRenderTarget(512, { type: HalfFloatType });
  new CubeCamera(0.1, 100, rt).update(renderer, env);
  const tex = pmrem.fromCubemap(rt.texture).texture;
  rt.dispose();
  pmrem.dispose();
  return tex;
}

class Knife {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(2, Math.max(1.25, devicePixelRatio || 1)));
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.setClearColor(0, 0);
    this.scene = new Scene();
    this.camera = new PerspectiveCamera(22, 1, 0.02, 20);
    this.camera.position.set(0, 0, 1);
    this.pivot = new Group();
    this.scene.add(this.pivot);
    this.cur = null;
  }

  load(url) {
    this.scene.environment = brightStudio(this.renderer);
    return new Promise((resolve, reject) => {
      const l = new GLTFLoader();
      l.setMeshoptDecoder(MeshoptDecoder);
      l.load(url, (g) => {
        g.scene.traverse((o) => {
          if (!o.isMesh) return;
          const m = o.material;
          if (m.name === 'laser_etch') { m.color.setRGB(0.05, 0.05, 0.06); m.metalness = 0.8; m.roughness = 0.55; }
          else { m.color.setRGB(0.96, 0.955, 0.945); m.metalness = 1; m.roughness = 0.07; }
        });
        this.pivot.add(g.scene);
        resolve();
      }, undefined, reject);
    });
  }

  resize(w, h) {
    this.w = w;
    this.h = h;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.m = (2 * Math.tan(MathUtils.degToRad(11)) * this.camera.aspect) / w; // world units per px at z = 0
  }

  // Target in screen px: x, y (centre), len (px), r = [roll about the blade, yaw, in-plane angle], o.
  update(T, dt) {
    const k = reduced || !this.cur ? 1 : 1 - Math.exp(-dt * 8);
    if (!this.cur) this.cur = { ...T, r: [...T.r] };
    const c = this.cur;
    for (const key of ['x', 'y', 'len', 'o']) c[key] += (T[key] - c[key]) * k;
    c.r = c.r.map((v, i) => v + (T.r[i] - v) * k);
    const s = (c.len * this.m) / KNIFE_LEN;
    this.pivot.position.set((c.x - this.w / 2) * this.m, -(c.y - this.h / 2) * this.m, 0);
    this.pivot.scale.setScalar(s);
    this.pivot.rotation.set(c.r[0], c.r[1], c.r[2], 'ZYX'); // roll about the knife's own long axis first
    this.canvas.style.opacity = c.o.toFixed(3);
    if (c.o > 0.005) this.renderer.render(this.scene, this.camera);
    return c;
  }
}

// ---------------------------------------------------------------- text + UI effects

function splitText() {
  document.querySelectorAll('[data-split]').forEach((el) => {
    let i = 0;
    const walk = (node) => {
      [...node.childNodes].forEach((n) => {
        if (n.nodeType === 3) {
          const frag = document.createDocumentFragment();
          n.textContent.split(/(\s+)/).forEach((word) => {
            if (!word) return;
            if (/^\s+$/.test(word)) { frag.append(word); return; }
            const ww = document.createElement('span');
            ww.className = 'wordwrap';
            [...word].forEach((ch) => {
              const c = document.createElement('span');
              c.className = 'char';
              c.style.setProperty('--i', i++);
              c.textContent = ch;
              ww.append(c);
            });
            frag.append(ww);
          });
          n.replaceWith(frag);
        } else if (n.nodeType === 1 && n.tagName !== 'BR') walk(n);
      });
    };
    walk(el);
  });
  const io = new IntersectionObserver((es) => es.forEach((e) => {
    if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); }
  }), { rootMargin: '0px 0px -10% 0px' });
  document.querySelectorAll('[data-split], .strike').forEach((el, n) => {
    if (el.classList.contains('strike')) el.style.setProperty('--d', `${(n % 4) * 0.18}s`);
    io.observe(el);
  });
}

function cursorAndMagnets() {
  const cur = document.querySelector('.cursor');
  if (!fine || !cur) return;
  const dot = cur.querySelector('.cursor__dot');
  const ring = cur.querySelector('.cursor__ring');
  const p = { x: innerWidth / 2, y: innerHeight / 2 };
  const r = { ...p };
  addEventListener('pointermove', (e) => { p.x = e.clientX; p.y = e.clientY; });
  document.querySelectorAll('[data-hover]').forEach((el) => {
    el.addEventListener('pointerenter', () => cur.classList.add('is-big'));
    el.addEventListener('pointerleave', () => cur.classList.remove('is-big'));
  });
  document.querySelectorAll('.magnetic').forEach((el) => {
    el.addEventListener('pointermove', (e) => {
      const b = el.getBoundingClientRect();
      el.style.transform = `translate(${(e.clientX - b.left - b.width / 2) * 0.25}px, ${(e.clientY - b.top - b.height / 2) * 0.35}px)`;
    });
    el.addEventListener('pointerleave', () => { el.style.transform = ''; });
    el.style.transition = 'transform 0.4s cubic-bezier(0.2, 0.7, 0.2, 1)';
  });
  const tick = () => {
    r.x += (p.x - r.x) * 0.18;
    r.y += (p.y - r.y) * 0.18;
    dot.style.transform = `translate(${p.x}px, ${p.y}px)`;
    ring.style.transform = `translate(${r.x}px, ${r.y}px)`;
    requestAnimationFrame(tick);
  };
  tick();
}

function buyBox() {
  const form = document.querySelector('[data-buy]');
  const total = form.querySelector('[data-total]');
  const btn = form.querySelector('button');
  const toast = document.querySelector('.toast');
  const price = { 1: '39,95 €', 2: '64,90 €' };
  form.addEventListener('change', () => { total.textContent = price[form.set.value]; });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    btn.classList.add('is-done');
    toast.textContent = 'Im Warenkorb – Demo, die Kasse wird mit Shopify verbunden.';
    toast.classList.add('is-on');
    setTimeout(() => { btn.classList.remove('is-done'); toast.classList.remove('is-on'); }, 2400);
  });
}

// ---------------------------------------------------------------- scroll scenes

function init() {
  splitText();
  cursorAndMagnets();
  buyBox();

  const $ = (s) => document.querySelector(s);
  const cut = $('.cut');
  const typeBox = $('.cut__type');
  const halfA = $('.cut__half--a');
  const halfB = $('.cut__half--b');
  const seam = $('.cut__seam span');
  const words = [...document.querySelectorAll('.cut__half .w')];
  const sides = $('.sides');
  const sideImgs = [...document.querySelectorAll('.side')];
  const gallery = $('.gallery');
  const track = $('.gallery__track');
  const cards = [...document.querySelectorAll('.card')];
  const gbar = $('.gallery__bar i');
  const band = $('[data-marquee]');
  const footBig = $('.foot__big span');
  const shadow = $('.kshadow');
  const canvas = $('.stage');

  let knife = null;
  try { knife = new Knife(canvas); } catch (e) { /* no WebGL: type still splits */ }
  let ready = false;
  if (knife) knife.load(canvas.dataset.model).then(() => { ready = true; }).catch(() => {});

  let W = innerWidth;
  let H = innerHeight;
  const layout = () => {
    W = innerWidth;
    H = innerHeight;
    if (knife) knife.resize(W, H);
  };
  layout();
  addEventListener('resize', layout);

  const progress = (el) => {
    const r = el.getBoundingClientRect();
    return { p: clamp01(-r.top / Math.max(1, r.height - H)), r };
  };
  const u = { x: Math.cos(CUT_ANGLE), y: Math.sin(CUT_ANGLE) }; // along the cut (right-up)
  const n = { x: -u.y, y: u.x }; // across the cut
  seam.parentElement.style.setProperty('--ang', `${(CUT_ANGLE * 180) / PI}deg`);
  seam.style.setProperty('--ang', `${(CUT_ANGLE * 180) / PI}deg`);

  let lastY = scrollY;
  let vel = 0;
  let last = performance.now();
  const frame = (now) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const y = scrollY;
    vel += ((y - lastY) / Math.max(dt, 0.001) - vel) * 0.15;
    lastY = y;

    // --- Hero: slash + split
    const { p: pc, r: rc } = progress(cut);
    const tb = typeBox.getBoundingClientRect();
    const C = { x: tb.width / 2, y: tb.height / 2 };
    const D = Math.hypot(tb.width, tb.height);
    const poly = (side) => {
      const pts = [
        [C.x + u.x * D, C.y + u.y * D], [C.x + u.x * D + side * n.x * D, C.y + u.y * D + side * n.y * D],
        [C.x - u.x * D + side * n.x * D, C.y - u.y * D + side * n.y * D], [C.x - u.x * D, C.y - u.y * D],
      ];
      return `polygon(${pts.map(([a, b]) => `${a.toFixed(1)}px ${b.toFixed(1)}px`).join(',')})`;
    };
    const slash = clamp01((pc - 0.08) / 0.42); // knife travel along the line
    const open = smooth(clamp01((pc - 0.3) / 0.4)); // halves part after the blade has passed
    const gap = open * Math.min(W, H) * 0.07;
    const shear = open * Math.min(W, H) * 0.05;
    halfA.style.clipPath = poly(1);
    halfB.style.clipPath = poly(-1);
    halfA.style.transform = `translate3d(${(n.x * gap + u.x * shear).toFixed(1)}px, ${(n.y * gap + u.y * shear).toFixed(1)}px, 0)`;
    halfB.style.transform = `translate3d(${(-n.x * gap - u.x * shear).toFixed(1)}px, ${(-n.y * gap - u.y * shear).toFixed(1)}px, 0)`;
    seam.style.opacity = smooth(clamp01((pc - 0.45) / 0.25)).toFixed(3);
    seam.style.letterSpacing = `${(0.3 - open * 0.32).toFixed(3)}em`;
    words.forEach((w, i) => w.style.setProperty('--bp', `${(40 + pc * 30 * (i % 2 ? -1 : 1)).toFixed(1)}%`));

    // --- Sides: circles open, the knife turns over
    const { p: ps } = progress(sides);
    sideImgs.forEach((f, i) => {
      const o = smooth(clamp01((ps - 0.05 - i * 0.12) / 0.35));
      f.style.setProperty('--r', `${(o * 150).toFixed(1)}%`);
      f.style.setProperty('--sc', (1.15 - o * 0.12).toFixed(3));
      f.style.setProperty('--co', smooth(clamp01((ps - 0.3 - i * 0.08) / 0.2)).toFixed(3));
    });
    const turn = smooth(clamp01((ps - 0.45) / 0.35));
    sides.classList.toggle('is-b', turn > 0.5);

    // --- Gallery: horizontal track, cards skew with scroll speed
    const { p: pg } = progress(gallery);
    const span = track.scrollWidth - W * 0.55;
    track.style.transform = `translate3d(${(-pg * span).toFixed(1)}px, 0, 0)`;
    const skew = reduced ? 0 : MathUtils.clamp(vel * 0.004, -8, 8);
    cards.forEach((c, i) => {
      c.style.transform = `skewX(${(-skew).toFixed(2)}deg)`;
      c.firstElementChild.style.setProperty('--tilt', `${(i % 2 ? 3 : -3) * (1 - pg)}deg`);
    });
    gbar.style.transform = `scaleX(${pg.toFixed(3)})`;

    // --- Marquee band follows time + scroll; footer word rises
    if (!reduced) band.style.transform = `translate3d(${(-((now * 0.05 + y * 0.4) % (band.scrollWidth / 2))).toFixed(1)}px,0,0)`;
    const fr = footBig.parentElement.getBoundingClientRect();
    footBig.style.setProperty('--fy', `${(clamp01((fr.top - H * 0.4) / (H * 0.6)) * 40).toFixed(1)}%`);

    // --- Knife: pick the scene that owns the viewport
    if (knife && ready) {
      let T;
      const inCut = rc.bottom > H * 0.5;
      const sr = sides.getBoundingClientRect();
      const gr = gallery.getBoundingClientRect();
      if (inCut) {
        const along = L(1.15, -1.15, slash) * D * 0.5;
        T = {
          x: tb.left + C.x + u.x * along, y: tb.top + C.y + u.y * along, len: Math.min(W * 0.62, H * 1.1),
          r: [0.35, 0, Math.atan2(u.y, -u.x)], o: slash > 0 && slash < 1 ? 1 : 0,
        };
      } else if (sr.top < H * 0.5 && sr.bottom > H * 0.5) {
        const wob = reduced ? 0 : Math.sin(now * 0.0012) * 0.05;
        T = { x: W * 0.5, y: H * 0.56, len: Math.min(W * 0.46, H * 0.95), r: [turn * PI + 0.3 + wob, -0.15, 0.06], o: smooth(clamp01((ps - 0.02) / 0.1)) * (1 - smooth(clamp01((ps - 0.93) / 0.07))) };
      } else if (gr.top < H * 0.5 && gr.bottom > H * 0.5) {
        T = { x: W * 0.8, y: H * 0.2, len: Math.min(W * 0.24, H * 0.5), r: [0.3 + pg * PI, 0.2, -0.35 + pg * 0.7], o: 1 - smooth(clamp01((pg - 0.9) / 0.1)) };
      } else {
        T = { ...(knife.cur || { x: W / 2, y: H / 2, len: W * 0.4, r: [0, 0, 0] }), o: 0 };
      }
      const c = knife.update(T, dt);
      // Soft shadow on the page under the knife (only where the knife sits over the paper).
      const sw = c.len * 0.9;
      shadow.style.width = `${sw}px`;
      shadow.style.height = `${sw * 0.16}px`;
      shadow.style.transform = `translate3d(${(c.x - sw / 2).toFixed(1)}px, ${(c.y + c.len * 0.14).toFixed(1)}px, 0) rotate(${(-c.r[2] * 180) / PI}deg)`;
      shadow.style.opacity = (c.o * (gr.top < H * 0.5 && gr.bottom > H * 0.5 ? 0 : 0.8)).toFixed(3);
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  window.akSchnitt = { knife };
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
