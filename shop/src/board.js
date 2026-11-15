/*
 * ANIRIUS flat-lay: the 3D knife lying on a real top-down photo of a wooden board.
 * What makes it sit in the photo:
 *  - same viewpoint (straight down), knife placed in photo coordinates so it stays on the board at any crop;
 *  - shadows from a key light matching the photo (soft, from the top left) plus a tight contact shadow,
 *    both drawn onto a transparent shadow-catcher over the photo, so lifting the knife moves and softens them;
 *  - reflections from a "room" built around the photo itself: the board/table below, a warm window softbox
 *    above left, dark walls, so the steel carries the photo's colours.
 * Scroll: the knife lifts, turns over (fine edge towards the tomatoes), lands, then turns back.
 * Bundled by `npm run build:board` into shop/board.js.
 */
import {
  WebGLRenderer, Scene, PerspectiveCamera, Group, Vector3, Color, Mesh, Box3, Euler, MathUtils,
  MeshBasicMaterial, PlaneGeometry, DoubleSide, PMREMGenerator, ACESFilmicToneMapping, SRGBColorSpace,
  CubeCamera, WebGLCubeRenderTarget, HalfFloatType, DirectionalLight, ShadowMaterial, VSMShadowMap, TextureLoader,
  CanvasTexture, OrthographicCamera, WebGLRenderTarget, ShaderMaterial, Vector2,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

const PI = Math.PI;
const KNIFE_LEN = 0.225;
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const clamp01 = (x) => MathUtils.clamp(x, 0, 1);
const smooth = (x) => x * x * (3 - 2 * x);
const L = MathUtils.lerp;

// Light in the photo: soft, from the top left (shadows fall to the bottom right).
const KEY_DIR = new Vector3(-0.36, 0.4, 1).normalize();

/*
 * One photo per slide. crop: the part of the photo that must stay in view [x0, y0, x1, y1] (fractions).
 * knife: where it rests in that photo — u, v (fractions of the full photo), a: in-plane angle on screen
 * (y down, negative = tip up-right), f: 0 logo up / PI turned over, len: knife length as a fraction of
 * the photo width (keeps it to scale with the food). Light in all three comes from the top left.
 */
const SCENES = [
  { src: 'img/board.jpg', w: 2400, h: 1600, crop: [0.06, 0.04, 0.94, 0.98],
    knife: { u: 0.5, v: 0.53, a: -0.6, f: 0, len: 0.4 } },
  // Bread on a dark plate: the knife rests on the plate rim beside the slice, edge towards the bread.
  { src: 'img/bread.jpg', w: 2400, h: 1600, crop: [0.12, 0.05, 0.92, 0.95],
    knife: { u: 0.74, v: 0.52, a: -0.95, f: 0, len: 0.4 } },
  // Tomato slices on slate: a close-up, so the knife is bigger and runs out of frame at the bottom right.
  { src: 'img/tomato.jpg', w: 2400, h: 1620, crop: [0.0, 0.05, 1.0, 0.95],
    knife: { u: 0.63, v: 0.64, a: -0.42, f: 0, len: 0.7 } },
];
// Scroll timeline: hold scene 0, lift & swap, hold scene 1, lift & swap, hold scene 2.
const T = [0.12, 0.26, 0.62, 0.76];
// The bread slice in its photo (fractions): where the knife cuts.
const BREAD = { u: 0.522, v: 0.505 };

// A room made from the photo: what polished steel lying on this table would actually reflect.
function roomEnvironment(renderer, photo) {
  const env = new Scene();
  env.background = new Color(0.03, 0.028, 0.026);
  const add = (w, h, p, mat) => {
    const m = new Mesh(new PlaneGeometry(w, h), mat);
    m.position.set(...p);
    m.lookAt(0, 0, 0);
    env.add(m);
    return m;
  };
  const col = (r, g, b) => new MeshBasicMaterial({ color: new Color(r, g, b), side: DoubleSide });
  // Table below (−Z): the photo itself, a little darker.
  add(9, 6, [0, 0, -2.2], new MeshBasicMaterial({ map: photo, color: new Color(0.55, 0.52, 0.5), side: DoubleSide }));
  // Moody flat-lay lighting: the camera side is flagged dark, so a knife lying face-up mirrors a dim
  // ceiling that falls off from the window side; the window itself, low at the top left, only catches
  // the bevels and edges. That contrast is what reads as real polished steel.
  const g = document.createElement('canvas');
  g.width = g.height = 256;
  const cx = g.getContext('2d');
  const grad = cx.createLinearGradient(0, 0, 256, 256);
  grad.addColorStop(0, '#ece6dc');
  grad.addColorStop(0.5, '#86807a');
  grad.addColorStop(1, '#1e1c1a');
  cx.fillStyle = grad;
  cx.fillRect(0, 0, 256, 256);
  const ceiling = new CanvasTexture(g);
  ceiling.colorSpace = SRGBColorSpace;
  add(24, 24, [0, 0, 9.6], col(0.05, 0.047, 0.044));
  add(7, 7, [0, 0, 9], new MeshBasicMaterial({ map: ceiling, side: DoubleSide }));
  add(30, 12, [0, 9, 2], col(0.09, 0.08, 0.07));
  add(30, 12, [0, -9, 2], col(0.02, 0.018, 0.016));
  add(12, 30, [9, 0, 2], col(0.025, 0.022, 0.02));
  add(12, 30, [-9, 0, 2], col(0.1, 0.09, 0.08));
  // Window: wide, low, top left (matches the photo's long soft shadows to the bottom right).
  add(9, 3.2, [-6.2, 5.6, 2.4], col(2.4, 2.25, 2.0));
  const pmrem = new PMREMGenerator(renderer);
  const rt = new WebGLCubeRenderTarget(256, { type: HalfFloatType });
  new CubeCamera(0.05, 50, rt).update(renderer, env);
  const tex = pmrem.fromCubemap(rt.texture).texture;
  rt.dispose();
  pmrem.dispose();
  env.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
  return tex;
}

class Flatlay {
  constructor(canvas) {
    this.renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(2, Math.max(1.25, devicePixelRatio || 1)));
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.setClearColor(0, 0);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = VSMShadowMap;
    this.scene = new Scene();
    this.camera = new PerspectiveCamera(22, 1, 0.02, 10);
    this.camera.position.set(0, 0, 1);
    this.pivot = new Group();
    this.scene.add(this.pivot);

    // Shadow catcher over the photo (z = 0 is the table).
    this.catcher = new Mesh(new PlaneGeometry(1, 1), new ShadowMaterial({ color: 0x0b0704, opacity: 0.55 }));
    this.catcher.receiveShadow = true;
    this.scene.add(this.catcher);

    // Key: soft, offset shadow. Contact: tight shadow straight under the knife. Both mostly cast shadows;
    // the visible light on the steel comes from the reflected room.
    this.key = this.light(KEY_DIR, 0.5, 11);
    this.initContact();
  }

  // Contact shadow: the knife's silhouette seen from straight above, blurred, laid on the table.
  // Tight and dark while it rests (the "touching" cue), wider and fainter as it lifts.
  initContact() {
    const N = 512;
    const opts = { depthBuffer: false };
    this.cA = new WebGLRenderTarget(N, N, { ...opts, depthBuffer: true });
    this.cB = new WebGLRenderTarget(N, N, opts);
    this.cCam = new OrthographicCamera(-1, 1, 1, -1, 0.01, 2);
    this.black = new MeshBasicMaterial({ color: 0x000000 });
    this.blur = new ShaderMaterial({
      uniforms: { tMap: { value: null }, step: { value: new Vector2() } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: `uniform sampler2D tMap; uniform vec2 step; varying vec2 vUv;
        void main(){ vec4 c = texture2D(tMap, vUv) * 0.2270;
          c += (texture2D(tMap, vUv + step * 1.3846) + texture2D(tMap, vUv - step * 1.3846)) * 0.3162;
          c += (texture2D(tMap, vUv + step * 3.2308) + texture2D(tMap, vUv - step * 3.2308)) * 0.0703;
          gl_FragColor = c; }`,
      depthTest: false, depthWrite: false,
    });
    this.quadScene = new Scene();
    this.quadCam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quadScene.add(new Mesh(new PlaneGeometry(2, 2), this.blur));
    this.cPlane = new Mesh(new PlaneGeometry(1, 1), new MeshBasicMaterial({ map: this.cA.texture, color: 0x0a0604, transparent: true, depthWrite: false }));
    this.cPlane.position.z = 0.0002;
    this.cPlane.renderOrder = -1;
    this.scene.add(this.cPlane);
  }

  renderContact(lift) {
    const r = this.renderer;
    const S = this.lenW * 1.25; // area covered, centred on the knife
    const c = this.cCam;
    c.left = -S / 2; c.right = S / 2; c.top = S / 2; c.bottom = -S / 2;
    c.position.set(this.pivot.position.x, this.pivot.position.y, 1);
    c.lookAt(this.pivot.position.x, this.pivot.position.y, 0);
    c.updateProjectionMatrix();
    this.cPlane.visible = false;
    this.catcher.visible = false;
    this.scene.overrideMaterial = this.black;
    const bg = r.getClearAlpha();
    r.setRenderTarget(this.cA);
    r.setClearColor(0, 0);
    r.clear();
    r.render(this.scene, c);
    this.scene.overrideMaterial = null;
    // Blur: wider when lifted.
    const px = (1 + lift * 60) / 512;
    for (let i = 0; i < 3; i++) {
      this.blur.uniforms.tMap.value = this.cA.texture;
      this.blur.uniforms.step.value.set(px, 0);
      r.setRenderTarget(this.cB);
      r.render(this.quadScene, this.quadCam);
      this.blur.uniforms.tMap.value = this.cB.texture;
      this.blur.uniforms.step.value.set(0, px);
      r.setRenderTarget(this.cA);
      r.render(this.quadScene, this.quadCam);
    }
    r.setRenderTarget(null);
    r.setClearColor(0, bg);
    this.cPlane.visible = true;
    this.catcher.visible = true;
    this.cPlane.position.x = this.pivot.position.x;
    this.cPlane.position.y = this.pivot.position.y;
    this.cPlane.scale.set(S, S, 1);
    this.cPlane.material.opacity = 0.85 * (1 - clamp01(lift * 4));
  }

  light(dir, intensity, radius) {
    const l = new DirectionalLight(0xfff0dc, intensity);
    l.position.copy(dir).multiplyScalar(1.2);
    l.castShadow = true;
    l.shadow.mapSize.set(2048, 2048);
    l.shadow.radius = radius;
    l.shadow.blurSamples = 24;
    l.shadow.bias = -0.0003;
    l.shadow.camera.near = 0.05;
    l.shadow.camera.far = 3;
    this.scene.add(l, l.target);
    return l;
  }

  load(model) {
    // One reflection environment per scene, each built around its own photo.
    this.envs = [];
    const photo = Promise.all(SCENES.map((sc, i) => new Promise((resolve) => new TextureLoader().load(sc.src, (t) => {
      t.colorSpace = SRGBColorSpace;
      this.envs[i] = roomEnvironment(this.renderer, t);
      resolve();
    }, undefined, resolve)))).then(() => { this.scene.environment = this.envs[0]; });
    const mesh = new Promise((resolve, reject) => {
      const l = new GLTFLoader();
      l.setMeshoptDecoder(MeshoptDecoder);
      l.load(model, (gltf) => {
        const root = gltf.scene;
        root.traverse((o) => {
          if (!o.isMesh) return;
          o.castShadow = true;
          const m = o.material;
          if (m.name === 'laser_etch') {
            m.color.setRGB(0.05, 0.05, 0.06);
            m.metalness = 0.8;
            m.roughness = 0.6;
          } else {
            m.color.setRGB(0.95, 0.94, 0.92);
            m.metalness = 1;
            m.roughness = 0.12;
          }
        });
        const box = new Box3().setFromObject(root);
        this.half = Math.max(-box.min.z, box.max.z); // lies on either face
        this.model = root;
        this.pivot.add(root);
        resolve();
      }, undefined, reject);
    });
    return Promise.all([mesh, photo]);
  }

  resize(w, h) {
    this.w = w;
    this.h = h;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.visH = 2 * Math.tan(MathUtils.degToRad(this.camera.fov / 2));
    this.visW = this.visH * this.camera.aspect;
    this.catcher.scale.set(this.visW * 1.6, this.visH * 1.6, 1);
    for (const l of [this.key]) {
      const c = l.shadow.camera;
      c.left = -this.visW * 0.8;
      c.right = this.visW * 0.8;
      c.top = this.visH * 0.8;
      c.bottom = -this.visH * 0.8;
      c.updateProjectionMatrix();
    }
    // Each photo is scaled so its crop rectangle covers the viewport; the <img> layers are placed to match.
    this.covers = SCENES.map((sc, i) => {
      const [x0, y0, x1, y1] = sc.crop;
      const s = Math.max(w / ((x1 - x0) * sc.w), h / ((y1 - y0) * sc.h));
      const W = sc.w * s;
      const H = sc.h * s;
      const x = w / 2 - ((x0 + x1) / 2) * W;
      const y = h / 2 - ((y0 + y1) / 2) * H;
      const img = this.layers && this.layers[i];
      if (img) Object.assign(img.style, { width: `${W}px`, height: `${H}px`, transform: `translate3d(${x}px, ${y}px, 0)` });
      return { x, y, W, H };
    });
  }

  // Knife rest pose of scene i, in screen pixels.
  rest(i) {
    const c = this.covers[i];
    const k = SCENES[i].knife;
    return { x: c.x + k.u * c.W, y: c.y + k.v * c.H, len: k.len * c.W, a: k.a, f: k.f };
  }

  // Pose in screen pixels. lift: height above the table as a fraction of the knife length.
  place(p, lift, pitch) {
    const m = this.visW / this.w;
    const s = (p.len * m) / KNIFE_LEN;
    this.pivot.scale.setScalar(s);
    this.pivot.rotation.copy(new Euler(p.f, pitch, -p.a, 'ZXY'));
    this.pivot.position.set((p.x - this.w / 2) * m, -(p.y - this.h / 2) * m, this.half * s + lift * KNIFE_LEN * s);
    this.lenW = p.len * m;
    this.lift = lift;
  }

  render() {
    this.renderContact(this.lift || 0);
    this.renderer.render(this.scene, this.camera);
  }
}

function init() {
  const section = document.querySelector('.scene');
  const pin = document.querySelector('.scene__pin');
  const canvas = document.querySelector('.stage');
  const steps = [...document.querySelectorAll('.step')];
  const dots = [...document.querySelectorAll('.dots i')];

  const layers = [...document.querySelectorAll('.photo')];
  let stage = null;
  try { stage = new Flatlay(canvas); } catch (e) { return; }
  stage.layers = layers;
  const layout = () => stage.resize(pin.clientWidth, pin.clientHeight);
  layout();
  addEventListener('resize', layout);

  let ready = false;
  stage.load(canvas.dataset.model).then(() => { ready = true; }).catch(() => {});

  // Bread cut layers.
  const cutEl = document.querySelector('.cut');
  const [halfL, halfR] = cutEl.querySelectorAll('.cut__half');
  const patch = cutEl.querySelector('.cut__patch');
  const cutLine = cutEl.querySelector('.cut__line');
  const applyCut = (line, sep) => {
    const gap = sep * 1.1; // % of the photo width each half moves (small: a clean cut, not an explosion)
    halfL.style.transform = `translate3d(${-gap}%, ${sep * 0.3}%, 0) rotate(${-sep * 1.2}deg)`;
    halfR.style.transform = `translate3d(${gap}%, ${-sep * 0.2}%, 0) rotate(${sep * 1}deg)`;
    for (const hf of [halfL, halfR]) {
      hf.style.setProperty('--sx', `${sep * 5}px`);
      hf.style.setProperty('--sy', `${sep * 7}px`);
      hf.style.setProperty('--sb', `${sep * 9}px`);
    }
    patch.style.opacity = Math.min(1, sep * 5);
    cutLine.style.opacity = line * (1 - sep);
    cutLine.style.transform = `scaleY(${line})`;
  };

  // Knife pose + photo blend for scroll progress q (0..1).
  // Between scenes the knife lifts off the table (it grows a little, its shadow spreads and fades),
  // the photo cross-fades underneath while it is in the air, and it lands in the next scene.
  const poseAt = (q) => {
    let i = 0;
    let t = 0;
    if (q >= T[0] && q < T[1]) { i = 0; t = (q - T[0]) / (T[1] - T[0]); }
    else if (q >= T[1] && q < T[2]) { i = 1; }
    else if (q >= T[2] && q < T[3]) { i = 1; t = (q - T[2]) / (T[3] - T[2]); }
    else if (q >= T[3]) { i = 2; }
    const j = Math.min(SCENES.length - 1, i + 1);
    const A = stage.rest(i);
    const B = stage.rest(j);
    const e = smooth(t);
    let k = { x: L(A.x, B.x, e), y: L(A.y, B.y, e), len: L(A.len, B.len, e), a: L(A.a, B.a, e), f: L(A.f, B.f, e) };
    let air = Math.sin(PI * t);
    let lift = air * 0.5;
    let pitch = air * 0.14;

    // Scene 1 hold: lift onto the bread, saw along the middle, the halves part, back onto the rim.
    let line = 0;
    let sep = q >= T[2] ? 1 : 0;
    if (q >= T[1] && q < T[2]) {
      const h = (q - T[1]) / (T[2] - T[1]);
      const c = stage.covers[1];
      const R = stage.rest(1);
      // Cutting pose: long axis along the cut (tip up), turned on its edge, centred on the slice.
      const C = { x: c.x + BREAD.u * c.W, y: c.y + BREAD.v * c.H, len: R.len, a: -PI / 2, f: 1.2 };
      const to = smooth(clamp01((h - 0.1) / 0.18)); // rim → over the bread
      const saw = clamp01((h - 0.3) / 0.3); // sawing strokes
      const back = smooth(clamp01((h - 0.66) / 0.18)); // bread → rim
      const P = to < 1 || back === 0 ? R : C;
      const m = back > 0 ? back : 1 - to;
      k = { x: L(C.x, R.x, m), y: L(C.y, R.y, m), len: R.len, a: L(C.a, R.a, m), f: L(C.f, R.f, m) };
      if (saw > 0 && saw < 1 && back === 0) k.y += Math.sin(saw * PI * 5) * 0.05 * R.len; // along the knife (vertical)
      const hop = Math.sin(PI * clamp01((h - 0.1) / 0.18)) + Math.sin(PI * back);
      lift = hop * 0.22 + (to > 0.99 && back === 0 ? 0.03 : 0);
      pitch = hop * 0.06;
      line = smooth(saw);
      sep = smooth(clamp01((h - 0.6) / 0.16));
      void P;
    }
    stage.place(k, lift, pitch);
    applyCut(line, sep);
    const out = smooth(clamp01((t - 0.12) / 0.3));
    const inn = smooth(clamp01((t - 0.55) / 0.3));
    layers.forEach((l, n) => { l.style.opacity = n === i ? 1 - out : n === j && t > 0 ? inn : 0; });
    stage.scene.environment = stage.envs[t > 0.5 ? j : i] || stage.scene.environment;
  };

  let shown = -1;
  let ps = 0;
  let last = performance.now();
  const frame = (now) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const r = section.getBoundingClientRect();
    const p = clamp01(-r.top / Math.max(1, r.height - pin.clientHeight));
    ps = reduced ? p : ps + (p - ps) * (1 - Math.exp(-dt * 8));

    const step = ps < (T[0] + T[1]) / 2 ? 0 : ps < (T[2] + T[3]) / 2 ? 1 : 2;
    if (step !== shown) {
      shown = step;
      steps.forEach((s, i) => { s.classList.toggle('is-on', i === step); s.classList.toggle('is-past', i < step); });
      dots.forEach((d, i) => d.classList.toggle('is-on', i <= step));
    }

    if (ready) {
      poseAt(ps);
      canvas.style.opacity = '1';
      stage.render();
    }
    requestAnimationFrame(frame);
  };
  canvas.style.opacity = '0';
  canvas.style.transition = 'opacity 1s ease';
  requestAnimationFrame(frame);
  window.akBoard = { stage, poseAt }; // poseAt: for checking frames
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
