/*
 * Laser engraving ad: a knife blade under a laser head. The laser rasters the text column by column
 * into the steel: a bright beam, a white-hot spot, sparks, glowing fresh metal that cools to a dark
 * etch. The text is Anirius (signature script) by default and whatever the visitor types in the form.
 */
import {
  WebGLRenderer, Scene, PerspectiveCamera, Group, Vector3, Euler, MathUtils, ACESFilmicToneMapping, SRGBColorSpace,
  Mesh, MeshStandardMaterial, MeshBasicMaterial, PlaneGeometry, CylinderGeometry, CanvasTexture, HemisphereLight,
  PointLight, DirectionalLight, AdditiveBlending, BufferGeometry, BufferAttribute, Points, PointsMaterial, Sprite, SpriteMaterial,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { DecalGeometry } from 'three/examples/jsm/geometries/DecalGeometry.js';

const clamp01 = (x) => MathUtils.clamp(x, 0, 1);
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

// Engraving field on the handle (knife-local metres). Measured on the mesh: the handle is widest
// and flattest between x -100 and -76 mm (16.5 mm tall, gently domed); the text sits centred there.
const FX = -0.097; // signature sits close to the end of the handle (rounded cap starts ~-106 mm)
const DW = 0.044;
const DH = 0.0068;
const TW = 2048;
const TH = 316;
const FONT = '"Allura", "Great Vibes", cursive';
const DURATION = 3.4; // seconds of laser time for a full text
const HOLD = 3.2; // pause on the finished engraving before it runs again

const mk = (w, h) => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
};

export function initEngrave(section, studioEnvironment) {
  const canvas = section.querySelector('.engrave__stage');
  const status = section.querySelector('[data-engrave-status]');
  const form = section.querySelector('[data-engrave]');
  let renderer;
  try {
    renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true });
  } catch (e) {
    return;
  }
  renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1));
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.setClearColor(0, 0);

  const scene = new Scene();
  const camera = new PerspectiveCamera(24, 4 / 3, 0.003, 5);
  scene.add(new HemisphereLight(0xffffff, 0x1a1a1a, 0.35));
  const rim = new DirectionalLight(0xffffff, 0.6);
  rim.position.set(-0.3, 0.5, 0.4);
  scene.add(rim);
  // Soft frontal key so the matte engraving reads evenly.
  const key = new DirectionalLight(0xfff4e6, 1.1);
  key.position.set(0.1, 0.25, 1);
  scene.add(key);
  const spot = new PointLight(0xff9a3c, 0, 0.12, 2); // the laser spot lights the steel around it
  scene.add(spot);

  const knife = new Group();
  scene.add(knife);

  // --- Text canvases: full text, revealed mask, heat (emissive) ---------------------------------
  const textC = mk(TW, TH);
  const hotC = mk(TW, TH);
  const maskC = mk(TW, TH);
  const heatC = mk(TW, TH);
  const tx = textC.getContext('2d');
  const hx = hotC.getContext('2d');
  const mx = maskC.getContext('2d');
  const ex = heatC.getContext('2d');
  const maskTex = new CanvasTexture(maskC);
  const heatTex = new CanvasTexture(heatC);
  heatTex.colorSpace = SRGBColorSpace;
  let cols = []; // per column: y pixels that belong to the text
  let x0 = 0;
  let x1 = TW;

  const drawText = (str) => {
    let text = (str || 'Anirius').trim().slice(0, 16) || 'Anirius';
    // Script capitals in a row look wrong; all-caps input becomes Title Case ("ANIRIUS" -> "Anirius").
    if (text.length > 1 && text === text.toUpperCase()) text = text.toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (m, a, c) => a + c.toUpperCase());
    tx.clearRect(0, 0, TW, TH);
    tx.fillStyle = '#fff';
    tx.textAlign = 'center';
    tx.textBaseline = 'middle';
    if ('letterSpacing' in tx) tx.letterSpacing = '0px';
    // Clean signature script, kept small: at most ~60% of the field's length and about half its height.
    let size = 205;
    tx.font = `${size}px ${FONT}`;
    const wdt = tx.measureText(text).width;
    if (wdt > TW * 0.62) size = Math.floor((size * TW * 0.62) / wdt);
    tx.font = `${size}px ${FONT}`;
    tx.fillText(text, TW / 2, TH / 2 + size * 0.04);
    // Hot copy: same shape, glowing orange.
    hx.clearRect(0, 0, TW, TH);
    hx.globalCompositeOperation = 'source-over';
    hx.drawImage(textC, 0, 0);
    hx.globalCompositeOperation = 'source-in';
    hx.fillStyle = '#ffb35c';
    hx.fillRect(0, 0, TW, TH);
    // Column lookup for the laser spot, and the horizontal extent of the text.
    const data = tx.getImageData(0, 0, TW, TH).data;
    cols = new Array(TW);
    x0 = TW;
    x1 = 0;
    for (let x = 0; x < TW; x++) {
      const ys = [];
      for (let y = 0; y < TH; y += 2) if (data[(y * TW + x) * 4 + 3] > 120) ys.push(y);
      cols[x] = ys;
      if (ys.length) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); }
    }
    if (x1 <= x0) { x0 = 0; x1 = TW; }
    return text;
  };

  const etchMat = new MeshStandardMaterial({
    color: 0x5c5f64, roughness: 0.9, metalness: 0.15, envMapIntensity: 0.4, transparent: true, alphaMap: maskTex,
    emissive: 0xffffff, emissiveMap: heatTex, emissiveIntensity: 2.2, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4,
  });
  let decal = null;
  let surf = null; // decal vertices with UVs: where the laser spot lands on the curved handle

  // --- Laser: beam, hot spot, sparks ------------------------------------------------------------
  const beamMat = new MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0.55, blending: AdditiveBlending, depthWrite: false });
  const beam = new Mesh(new CylinderGeometry(0.00009, 0.00009, 1, 8, 1, true), beamMat);
  const haloMat = new MeshBasicMaterial({ color: 0xff8a2a, transparent: true, opacity: 0.18, blending: AdditiveBlending, depthWrite: false });
  const halo = new Mesh(new CylinderGeometry(0.00035, 0.00035, 1, 10, 1, true), haloMat);
  const glowTex = (() => {
    const c = mk(128, 128);
    const g = c.getContext('2d');
    const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    r.addColorStop(0, 'rgba(255,255,255,1)');
    r.addColorStop(0.18, 'rgba(255,220,160,0.9)');
    r.addColorStop(0.45, 'rgba(255,130,40,0.35)');
    r.addColorStop(1, 'rgba(255,90,20,0)');
    g.fillStyle = r;
    g.fillRect(0, 0, 128, 128);
    const t = new CanvasTexture(c);
    t.colorSpace = SRGBColorSpace;
    return t;
  })();
  const flare = new Sprite(new SpriteMaterial({ map: glowTex, blending: AdditiveBlending, depthWrite: false, transparent: true }));
  flare.scale.setScalar(0.005);
  const laser = new Group();
  laser.add(beam, halo, flare);
  scene.add(laser);

  const N = 260;
  const sp = { pos: new Float32Array(N * 3), col: new Float32Array(N * 3), vel: new Float32Array(N * 3), life: new Float32Array(N), max: new Float32Array(N) };
  const sGeo = new BufferGeometry();
  sGeo.setAttribute('position', new BufferAttribute(sp.pos, 3));
  sGeo.setAttribute('color', new BufferAttribute(sp.col, 3));
  const sparks = new Points(sGeo, new PointsMaterial({ size: 0.0006, vertexColors: true, blending: AdditiveBlending, depthWrite: false, transparent: true, map: glowTex }));
  sparks.frustumCulled = false;
  scene.add(sparks);
  let sNext = 0;
  const emit = (p, nrm, n) => {
    for (let i = 0; i < n; i++) {
      const k = sNext;
      sNext = (sNext + 1) % N;
      sp.pos.set([p.x, p.y, p.z], k * 3);
      const a = Math.random() * Math.PI * 2;
      const r = 0.02 + Math.random() * 0.06;
      const up = 0.03 + Math.random() * 0.07;
      sp.vel.set([Math.cos(a) * r + nrm.x * up, Math.sin(a) * r * 0.5 + nrm.y * up + 0.02, nrm.z * up + Math.sin(a) * r * 0.5], k * 3);
      sp.max[k] = 0.12 + Math.random() * 0.3;
      sp.life[k] = sp.max[k];
    }
  };
  const stepSparks = (dt) => {
    for (let k = 0; k < N; k++) {
      if (sp.life[k] <= 0) { sp.col[k * 3] = sp.col[k * 3 + 1] = sp.col[k * 3 + 2] = 0; continue; }
      sp.life[k] -= dt;
      const t = clamp01(sp.life[k] / sp.max[k]);
      sp.vel[k * 3 + 1] -= 0.35 * dt;
      for (let j = 0; j < 3; j++) sp.pos[k * 3 + j] += sp.vel[k * 3 + j] * dt;
      sp.col[k * 3] = 1.6 * t;
      sp.col[k * 3 + 1] = (0.35 + 0.8 * t * t) * t;
      sp.col[k * 3 + 2] = 0.15 * t * t * t;
    }
    sGeo.attributes.position.needsUpdate = true;
    sGeo.attributes.color.needsUpdate = true;
  };

  // --- Engraving run ---------------------------------------------------------------------------
  let run = { t: 0, prevX: 0, done: false, hold: 0 };
  let text = drawText('Anirius');
  // Redraw once the engraving font has arrived.
  document.fonts.load(`100px ${FONT}`).then(() => { text = drawText(text); restart(); }).catch(() => {});
  const restart = () => {
    mx.clearRect(0, 0, TW, TH);
    ex.fillStyle = '#000';
    ex.fillRect(0, 0, TW, TH);
    maskTex.needsUpdate = true;
    heatTex.needsUpdate = true;
    run = { t: 0, prevX: x0, done: false, hold: 0 };
  };
  restart();

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    text = drawText(form.querySelector('input').value);
    restart();
  });

  // --- Load knife + environment ------------------------------------------------------------------
  const d = canvas.dataset;
  let ready = false;
  const env = new Promise((res) => new RGBELoader().load(d.hdr, (h) => {
    // Engraving close-up: one large soft panel in front fills the dark gaps between the studio
    // strips, so the handle around the name reflects an even, bright sheen.
    scene.environment = studioEnvironment(renderer, h, 256, (add) => {
      add(18, 7, [0, 1.4, 7.5], 1.6);
      add(10, 4, [0, 5, 5], 1.2);
    });
    h.dispose();
    res();
  }, undefined, res));
  const model = new Promise((res, rej) => {
    const l = new GLTFLoader();
    l.setMeshoptDecoder(MeshoptDecoder);
    l.load(d.model, (g) => {
      const root = g.scene;
      root.traverse((o) => {
        if (!o.isMesh) return;
        const m = o.material;
        if (m.name === 'laser_etch') { m.color.setRGB(0.05, 0.06, 0.08); m.metalness = 0.85; m.roughness = 0.55; }
        else { m.color.setRGB(0.96, 0.955, 0.945); m.metalness = 1; m.roughness = 0.08; }
      });
      root.updateMatrixWorld(true);
      // Blade face height (front, +z) and mid-line at the engraving field.
      let zf = -1;
      let yTop = -1;
      let yBot = 1;
      const v = new Vector3();
      root.traverse((o) => {
        if (!o.isMesh || o.material.name === 'laser_etch') return;
        const pa = o.geometry.attributes.position;
        for (let i = 0; i < pa.count; i++) {
          v.fromBufferAttribute(pa, i).applyMatrix4(o.matrixWorld);
          if (Math.abs(v.x - FX) < 0.0015) { yTop = Math.max(yTop, v.y); yBot = Math.min(yBot, v.y); }
        }
      });
      const yc = (yTop + yBot) / 2;
      let steel = null;
      root.traverse((o) => {
        if (!o.isMesh || o.material.name === 'laser_etch') return;
        steel = steel || o;
        const pa = o.geometry.attributes.position;
        for (let i = 0; i < pa.count; i++) {
          v.fromBufferAttribute(pa, i).applyMatrix4(o.matrixWorld);
          if (Math.abs(v.x - FX) < DW / 2 && Math.abs(v.y - yc) < 0.002) zf = Math.max(zf, v.z);
        }
      });
      // Project the engraving onto the real (domed) handle surface instead of a flat card.
      const geo = new DecalGeometry(steel, new Vector3(FX, yc, zf - 0.001), new Euler(0, 0, 0), new Vector3(DW, DH, 0.006));
      const pa = geo.attributes.position;
      const uv = geo.attributes.uv;
      const nm = geo.attributes.normal;
      for (let i = 0; i < pa.count; i++) {
        pa.setXYZ(i, pa.getX(i) + nm.getX(i) * 0.00004, pa.getY(i) + nm.getY(i) * 0.00004, pa.getZ(i) + nm.getZ(i) * 0.00004);
      }
      surf = { pos: pa, uv };
      decal = new Mesh(geo, etchMat);
      decal.userData.centre = new Vector3(FX, yc, zf);
      root.add(decal);
      knife.add(root);
      res();
    }, undefined, rej);
  });

  // Knife lies across the frame, face to camera, tilted back a little; camera on the engraving field.
  knife.rotation.set(-0.42, -0.2, 0.02);
  const frame = () => {
    knife.updateMatrixWorld(true);
    const c = decal.localToWorld(decal.userData.centre.clone());
    const n = new Vector3(0, 0, 1).applyQuaternion(decal.getWorldQuaternion(new Mesh().quaternion));
    camera.position.copy(c).addScaledVector(n, 0.1).add(new Vector3(0, 0.01, 0));
    camera.lookAt(c.clone().add(new Vector3(0, -0.002, 0)));
    // Laser head sits above the field, the beam slants down to the spot.
    laser.userData.head = c.clone().add(new Vector3(0.006, 0.07, 0.012));
    laser.userData.n = n;
  };

  const resize = () => {
    const r = canvas.getBoundingClientRect();
    if (!r.width) return;
    renderer.setSize(r.width, r.height, false);
    camera.aspect = r.width / r.height;
    camera.updateProjectionMatrix();
  };

  Promise.all([model, env]).then(() => { frame(); resize(); ready = true; }).catch(() => {});
  addEventListener('resize', resize);

  // --- Loop (only while visible) -----------------------------------------------------------------
  let visible = false;

  let last = performance.now();
  const tmp = new Vector3();
  const loop = (now) => {
    requestAnimationFrame(loop);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const r = section.getBoundingClientRect();
    const vis = r.bottom > -100 && r.top < innerHeight + 100;
    if (vis && !visible) resize();
    visible = vis;
    if (!visible || !ready) return;

    let firing = false;
    if (!run.done) {
      run.t += dt;
      const p = reduced ? 1 : clamp01(run.t / DURATION);
      const nx = Math.round(x0 + p * (x1 - x0));
      if (nx > run.prevX) {
        mx.drawImage(textC, run.prevX, 0, nx - run.prevX + 1, TH, run.prevX, 0, nx - run.prevX + 1, TH);
        ex.drawImage(hotC, run.prevX, 0, nx - run.prevX + 1, TH, run.prevX, 0, nx - run.prevX + 1, TH);
        maskTex.needsUpdate = true;
        run.prevX = nx;
      }
      const ys = cols[Math.min(TW - 1, nx)] || [];
      if (ys.length && p < 1) {
        firing = true;
        const y = ys[(Math.random() * ys.length) | 0];
        const u = nx / TW;
        const w = 1 - y / TH;
        let best = 1e9;
        let bi = 0;
        for (let i = 0; i < surf.uv.count; i += 1) {
          const du = surf.uv.getX(i) - u;
          const dv = surf.uv.getY(i) - w;
          const d2 = du * du * 49 + dv * dv;
          if (d2 < best) { best = d2; bi = i; }
        }
        tmp.fromBufferAttribute(surf.pos, bi);
        decal.localToWorld(tmp);
        const head = laser.userData.head;
        const dir = tmp.clone().sub(head);
        const len = dir.length();
        [beam, halo].forEach((m) => {
          m.position.copy(head).addScaledVector(dir, 0.5);
          m.scale.set(1, len, 1);
          m.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), dir.clone().normalize());
        });
        flare.position.copy(tmp);
        flare.scale.setScalar(0.004 + Math.random() * 0.0025);
        spot.position.copy(tmp).addScaledVector(laser.userData.n, 0.002);
        spot.intensity = 0.006 + Math.random() * 0.004;
        if (!reduced) emit(tmp, laser.userData.n, 3);
      }
      if (p >= 1) run.done = true;
    } else {
      run.hold += dt;
      if (run.hold > HOLD + 1.2) restart();
    }
    laser.visible = firing;
    if (!firing) spot.intensity *= 0.8;
    section.classList.toggle('is-firing', firing);
    if (status) status.textContent = firing ? `Laser graviert · ${text}` : run.done ? `Fertig · ${text}` : 'Bereit';

    // Fresh metal cools from orange-white to the dark etch.
    ex.globalCompositeOperation = 'source-over';
    ex.fillStyle = `rgba(0,0,0,${Math.min(1, dt * 2.2)})`;
    ex.fillRect(0, 0, TW, TH);
    heatTex.needsUpdate = true;
    // Before the rerun, the old engraving fades out.
    if (run.done && run.hold > HOLD) etchMat.opacity = 1 - clamp01((run.hold - HOLD) / 1.2);
    else etchMat.opacity = 1;

    stepSparks(dt);
    renderer.render(scene, camera);
  };
  requestAnimationFrame(loop);
  window.akEngrave = { get state() { return { ready, visible, run }; }, get decal() { return decal; }, camera };
}
