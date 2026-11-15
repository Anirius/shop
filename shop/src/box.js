/*
 * ANIRIUS "Unboxing": the page is the gift box opening. Scroll lifts the lid, folds back the tissue,
 * and the knives rise out one at a time, each showing one feature, before gathering into a fan.
 * The box, lid and tissue are built here from primitives; the knife is the real GLB.
 * Bundled by `npm run build:box` into shop/box.js.
 */
import {
  WebGLRenderer, Scene, PerspectiveCamera, Group, Object3D, Vector3, Box3, Quaternion, Euler, MathUtils, ACESFilmicToneMapping, SRGBColorSpace,
  Mesh, Color, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, CircleGeometry, DoubleSide, PMREMGenerator, CubeCamera,
  WebGLCubeRenderTarget, HalfFloatType, EquirectangularReflectionMapping, CanvasTexture, HemisphereLight, DirectionalLight, TextureLoader, Fog, PointLight, SpotLight, MirroredRepeatWrapping, PCFSoftShadowMap,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { initEngrave } from './engrave.js';

const PI = Math.PI;
const BUTT = 0.1125;
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const clamp01 = (x) => MathUtils.clamp(x, 0, 1);
const smooth = (x) => x * x * (3 - 2 * x);
const easeOut = (x) => 1 - Math.pow(1 - x, 3);
const L = MathUtils.lerp;
const V = (x, y, z) => new Vector3(x, y, z);

// Box dimensions (metres). Inner space fits six 22.5 cm knives side by side.
const IX = 0.27;
const IZ = 0.17;
const IH = 0.034;
const T = 0.005;
const RIM = T + IH;
const REST_Y = 0.0235; // knife centre when lying in the insert
const SLOT = (i) => (i - 2.5) * 0.026;
const FAN_A = (i) => (2.5 - i) * 0.2;
const FAN_P = V(0, 0.03, -0.03);
const LOGO_KNIFE = 3; // the knife the logo close-up looks at
const FEAT_CH = 4; // first knife-feature chapter
// Two sets: a second, closed box slides in underneath the open one (stack).
const STACK_H = 0.045; // height of a closed box (top of its lid)

// The approved studio lighting (reflections for the steel).
function studioEnvironment(renderer, hdr, cubeSize, extra) {
  const env = new Scene();
  hdr.mapping = EquirectangularReflectionMapping;
  env.background = hdr;
  env.backgroundIntensity = 0.22;
  const add = (w, h, p, c, look = [0, 0, 0]) => {
    const m = new Mesh(new PlaneGeometry(w, h), new MeshBasicMaterial({ color: new Color(c, c, c), side: DoubleSide }));
    m.position.set(...p);
    m.lookAt(...look);
    env.add(m);
  };
  add(40, 40, [0, -5, 0], 0.004);
  add(40, 14, [0, 1, -9], 0.01);
  add(16, 0.9, [0, 1.6, 6], 6);
  add(16, 0.35, [0, -0.2, 6], 2.4);
  add(8, 3.2, [-0.6, 0.3, 6.8], 0.45);
  add(7, 3.4, [-2.5, -2.6, 6], 0.7);
  add(6, 2, [0, 7, 1.5], 4.5);
  add(4, 7, [-3.6, 0.4, 5.6], 0.8);
  add(3.2, 6, [5.1, 0.6, 4.8], 0.9);
  add(2.5, 2.5, [3.5, 2.5, -6], 1.4);
  add(4, 10, [5.5, 0.5, -4.5], 1.8);
  add(4, 10, [-5.5, 0.5, -4.5], 1.8);
  add(3, 10, [7, 0.5, 0], 1.2);
  add(3, 10, [-7, 0.5, 0], 1.2);
  add(3.4, 8, [6.5, 0.5, 2.6], 0.7);
  add(3.4, 8, [-6.5, 0.5, 2.6], 0.7);
  // Unboxing only: knives lying face-up in the box look up and back, so give them a high soft wall.
  add(12, 5, [0, 5.5, -5], 1.1);
  add(8, 8, [0, 8, 0], 0.9);
  if (extra) extra(add);
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

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function buildBox() {
  // Matte black card with a fine paper grain (roughness + bump), like real gift-box board.
  const grain = canvasTex(512, 512, (x, w, h) => {
    const img = x.createImageData(w, h);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = 150 + Math.random() * 70;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    x.putImageData(img, 0, 0);
  });
  grain.colorSpace = '';
  grain.wrapS = grain.wrapT = MirroredRepeatWrapping;
  grain.repeat.set(6, 6);
  const black = new MeshStandardMaterial({ color: 0x1a1a1b, roughness: 0.78, metalness: 0, roughnessMap: grain, bumpMap: grain, bumpScale: 0.35, envMapIntensity: 0.6 });
  const velvet = new MeshStandardMaterial({ color: 0x1b1916, roughness: 1, metalness: 0 });
  const groove = new MeshBasicMaterial({ color: 0x050505 });
  const gold = new MeshStandardMaterial({ color: 0xd2ab62, roughness: 0.32, metalness: 0.95 });
  const rb = (w, h, d, mat, x, y, z, r = 0.0026) => {
    const m = new Mesh(new RoundedBoxGeometry(w, h, d, 3, r), mat);
    m.castShadow = true;
    m.receiveShadow = true;
    m.position.set(x, y, z);
    return m;
  };

  // Base: floor, four walls, velvet insert with six grooves.
  const base = new Group();
  base.add(rb(IX + 2 * T, T, IZ + 2 * T, black, 0, T / 2, 0));
  base.add(rb(IX + 2 * T, IH, T, black, 0, T + IH / 2, IZ / 2 + T / 2));
  base.add(rb(IX + 2 * T, IH, T, black, 0, T + IH / 2, -IZ / 2 - T / 2));
  base.add(rb(T, IH, IZ, black, IX / 2 + T / 2, T + IH / 2, 0));
  base.add(rb(T, IH, IZ, black, -IX / 2 - T / 2, T + IH / 2, 0));
  base.add(rb(IX, 0.016, IZ, velvet, 0, T + 0.008, 0, 0.001));
  for (let i = 0; i < 6; i++) {
    const g = new Mesh(new PlaneGeometry(0.232, 0.021), groove);
    g.rotation.x = -PI / 2;
    g.position.set(0, T + 0.0162, SLOT(i));
    base.add(g);
  }

  // Lid: origin at the top surface centre.
  const LX = IX + 2 * T + 0.005;
  const LZ = IZ + 2 * T + 0.005;
  const LH = 0.028;
  const W = 0.003;
  const lid = new Group();
  lid.add(rb(LX, T, LZ, black, 0, -T / 2, 0));
  lid.add(rb(LX, LH, W, black, 0, -LH / 2, LZ / 2 - W / 2));
  lid.add(rb(LX, LH, W, black, 0, -LH / 2, -LZ / 2 + W / 2));
  lid.add(rb(W, LH, LZ, black, LX / 2 - W / 2, -LH / 2, 0));
  lid.add(rb(W, LH, LZ, black, -LX / 2 + W / 2, -LH / 2, 0));
  const logoTex = canvasTex(1024, 256, (x, w, h) => {
    x.fillStyle = '#fff';
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    if ('letterSpacing' in x) x.letterSpacing = '30px';
    x.font = '600 104px "Helvetica Neue", Arial, sans-serif';
    x.fillText('ANIRIUS®', w / 2 + 15, h * 0.42);
    if ('letterSpacing' in x) x.letterSpacing = '12px';
    x.font = '500 30px "Helvetica Neue", Arial, sans-serif';
    x.fillText('2-IN-1 BESTECKMESSER', w / 2 + 6, h * 0.82);
  });
  const logo = new Mesh(new PlaneGeometry(0.15, 0.0375), new MeshStandardMaterial({ color: 0xd2ab62, alphaMap: logoTex, transparent: true, roughness: 0.3, metalness: 0.95 }));
  logo.rotation.x = -PI / 2;
  logo.position.y = 0.0004;
  lid.add(logo);
  const LID_Y = RIM + 0.006;

  // Tissue: two crinkled flaps hinged on the long walls, the front one lying on top.
  const tissueMat = new MeshStandardMaterial({ color: 0xf6f1e8, roughness: 1, metalness: 0, side: DoubleSide, transparent: true, opacity: 0.95 });
  const D = IZ / 2 + 0.012;
  const flap = (sign) => {
    const geo = new PlaneGeometry(IX - 0.004, D, 36, 12);
    geo.rotateX(-PI / 2);
    geo.translate(0, 0, (-sign * D) / 2);
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      const z = p.getZ(i);
      const k = Math.abs(z) / D; // creases grow away from the hinge
      p.setY(i, k * 0.0016 * (Math.sin(x * 83 + z * 31) + 0.6 * Math.cos(x * 151 - z * 67)));
    }
    geo.computeVertexNormals();
    const g = new Group();
    const tm = new Mesh(geo, tissueMat);
    tm.castShadow = true;
    tm.receiveShadow = true;
    g.add(tm);
    return g;
  };
  const front = flap(1);
  front.position.set(0, RIM - 0.0015, IZ / 2);
  const back = flap(-1);
  back.position.set(0, RIM - 0.0024, -IZ / 2);
  const seal = new Mesh(new CircleGeometry(0.011, 40), gold);
  seal.rotation.x = -PI / 2;
  seal.position.set(0, 0.0012, -D + 0.016);
  front.add(seal);

  // Soft contact shadow on the "table".
  const shadowTex = canvasTex(256, 256, (x, w, h) => {
    const g = x.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(40,30,20,0.55)');
    g.addColorStop(0.55, 'rgba(40,30,20,0.22)');
    g.addColorStop(1, 'rgba(40,30,20,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, w, h);
  });
  const shadow = new Mesh(new PlaneGeometry(0.62, 0.46), new MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }));
  shadow.rotation.x = -PI / 2;
  shadow.position.y = 0.0004;

  return { base, lid, LID_Y, front, back, shadow };
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
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFSoftShadowMap;
    this.renderer.setClearColor(0, 0);
    this.scene = new Scene();
    this.camera = new PerspectiveCamera(30, 1, 0.01, 10);
    this.hemi = new HemisphereLight(0xffffff, 0xcfc6b8, 1.1);
    this.scene.add(this.hemi);
    const key = new DirectionalLight(0xfff6ea, 1.4);
    this.key = key;
    key.position.set(0.35, 1, 0.45);
    // Real cast shadows ground the box and knives on the stone.
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    const sc = key.shadow.camera;
    sc.left = -0.42; sc.right = 0.42; sc.top = 0.42; sc.bottom = -0.42; sc.near = 0.2; sc.far = 3;
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.0015;
    key.shadow.radius = 6;
    this.scene.add(key);
    // Slide 07 (TV moment): a stage spotlight on the hovering knife while the room dims a little.
    this.spot = new SpotLight(0xfff1dc, 0, 1.6, 0.28, 0.75, 1.6);
    this.scene.add(this.spot, this.spot.target);

    this.box = buildBox();
    this.world = new Group();
    this.world.add(this.box.base, this.box.lid, this.box.front, this.box.back, this.box.shadow);

    // Polished Carrara slab the box stands on; its front edge shows in the wide shots.
    this.slabMat = new MeshStandardMaterial({ color: 0xf2f1ee, roughness: 0.34, metalness: 0, envMapIntensity: 0.22 });
    // Deep enough that its back edge stays out of frame; the photo stretches to large, calm veins.
    const slab = new Mesh(new RoundedBoxGeometry(4.4, 0.032, 4.4, 3, 0.007), this.slabMat);
    slab.position.set(-0.3, -0.016, -0.9); // front edge 1.3 m in front of the box: never in frame
    slab.receiveShadow = true;
    // Distance haze in the page colour: the far marble melts into the background, no hard horizon.
    this.scene.fog = new Fog(0xe9e8e4, 1.7, 3.8);
    this.world.add(slab);
    this.scene.add(this.world);
    this.knives = [];
    this.dummy = new Object3D();
    this.tmpQ = new Quaternion();
    this.TVL = { spot: 0.9, steel: 0.62 }; // slide 07 light balance (spot strength, steel reflection cut)
    this.TV6 = { yaw: 0, elev: 1.35, d: 0.68 }; // slide 07: near top-down flat-lay from the handle end, picked from test renders
    // Teeth macro angle (see teethCam), picked from test renders: slightly above the edge, looking
    // along the blade towards the tip, so the teeth recede in a row and each catches its own light.
    this.TP = { a: 0.028, b: 0.007, c: -0.003, d: 0.0015, e: 0.002, r: 0.014 }; // c: less from the handle side puts the dark-reflecting teeth centre-right
  }

  load(model, hdr, hdrHd, marble) {
    if (marble) {
      new TextureLoader().load(marble, (src) => {
        // Boost contrast so the grey veins read, then tile (mirrored) so a tile is ~65 cm of stone.
        const im = src.image;
        const t = canvasTex(im.width, im.height, (x) => {
          x.filter = 'contrast(1.55) brightness(1.04) saturate(0.85)';
          x.drawImage(im, 0, 0);
        });
        src.dispose();
        t.wrapS = t.wrapT = MirroredRepeatWrapping;
        t.repeat.set(6, 4.6);
        t.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
        this.slabMat.map = t;
        this.slabMat.color.set(0xffffff);
        this.slabMat.needsUpdate = true;
      });
    }
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
          m.envMapIntensity = 1;
          if (m.name === 'laser_etch') { m.color.setRGB(0.05, 0.06, 0.08); m.metalness = 0.85; m.roughness = 0.55; this.etchMat = m; }
          else { m.color.setRGB(0.96, 0.955, 0.945); m.metalness = 1; m.roughness = 0.06; this.steelMat = m; }
        });
        root.updateMatrixWorld(true);
        // Where the laser logo sits on the blade, for the close-up chapter.
        root.updateMatrixWorld(true);
        const lb = new Box3();
        root.traverse((o) => { if (o.isMesh && o.material.name === 'laser_etch') lb.expandByObject(o); });
        if (!lb.isEmpty()) this.logoLocal = lb.getCenter(new Vector3());
        // A point on each serrated edge near the tip, for the teeth close-ups.
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
        // Near the tip, where the serrations are largest.
        this.fineL = edge(0.088, 1);
        this.coarseL = edge(0.088, -1);
        // Blade outline (top = fine edge, bottom = coarse edge) in 0.05 mm steps, for the loupe drawing.
        {
          const step = 0.00005;
          const x0 = 0.04;
          const n = Math.round((0.11 - x0) / step);
          const top = new Float32Array(n).fill(-1);
          const bot = new Float32Array(n).fill(1);
          const v = new Vector3();
          root.traverse((o) => {
            if (!o.isMesh || o.material.name === 'laser_etch') return;
            const pa = o.geometry.attributes.position;
            for (let i = 0; i < pa.count; i++) {
              v.fromBufferAttribute(pa, i).applyMatrix4(o.matrixWorld);
              const j = Math.round((v.x - x0) / step);
              if (j < 0 || j >= n) continue;
              if (v.y > top[j]) top[j] = v.y;
              if (v.y < bot[j]) bot[j] = v.y;
            }
          });
          for (let j = 1; j < n; j++) { if (top[j] < -0.5) top[j] = top[j - 1]; if (bot[j] > 0.5) bot[j] = bot[j - 1]; }
          this.outline = { x0, step, top, bot };
        }
        this.buildKeys();
        for (let i = 0; i < 6; i++) {
          const k = i === 0 ? root : root.clone();
          k.traverse((o) => { if (o.isMesh) o.castShadow = true; });
          this.world.add(k);
          this.knives.push(k);
        }
        // Second set (shown when "2 Boxen" is chosen): a closed box that slides in under the open one.
        this.set2 = new Group();
        const b2 = buildBox();
        b2.lid.position.y = b2.LID_Y;
        this.set2.add(b2.base, b2.lid, b2.shadow);
        this.set2.visible = false;
        this.world.add(this.set2);
        // Remember the open box's resting heights so it can be lifted onto the stack.
        [this.box.base, this.box.front, this.box.back].forEach((o) => { o.userData.y0 = o.position.y; });
        resolve();
      }, undefined, reject);
    });
    return Promise.all([mesh, env]);
  }

  resize(w, h) {
    this.renderer.setSize(w, h, false);
    this.vw = w;
    this.vh = h;
    this.aspect = w / h;
    this.desk = this.aspect >= 1.1;
    const a = this.aspect;
    this.camera.fov = a >= 1.5 ? 30 : Math.min(64, MathUtils.radToDeg(2 * Math.atan((Math.tan(MathUtils.degToRad(15)) * 1.5) / a)));
    this.camera.aspect = a;
    this.camera.updateProjectionMatrix();
    this.buildKeys();
  }

  // Camera keyframes and the hover poses depend on the layout (copy left on desktop, on top on phones).
  buildKeys() {
    const ox = this.desk ? -0.085 : 0; // target shift: box sits right of the copy
    const oy = this.desk ? 0 : 0.045; // phones: box sits below the copy
    this.CAM = [
      // 0 hero: classic 3/4 product shot, ~28° round from the front and ~32° above the table, aimed at
      // the box itself. On desktop a lens shift (not a target shift) moves it right of the copy, so
      // the box keeps natural, undistorted perspective.
      { p: V(0.27, 0.36 + oy, 0.5), t: V(0, 0.028 + oy, 0) },
      { p: V(0.1, 0.34, 0.44), t: V(ox, 0.06 + oy, 0) }, // 1 lid lifting
      { p: V(0.03, 0.44, 0.3), t: V(ox, 0.01 + oy, 0) }, // 2 tissue open, looking in
      { p: V(0, 0.27, 0.46), t: V(ox, 0.09 + oy, 0) }, // 4 knife 1
      { p: V(0, 0.27, 0.46), t: V(ox, 0.09 + oy, 0) }, // 5 knife 2
      { p: V(0, 0.27, 0.46), t: V(ox, 0.09 + oy, 0) }, // 6 knife 3
      { p: V(0, 0.2, 0.5), t: V(ox * 1.5, 0.12 + oy, 0) }, // 7 the fan, further right of the buy box
    ];
    // Pull every camera back along its view line so the whole box sits in frame.
    const K = this.desk ? 1.5 : 1.75;
    this.CAM.forEach((c) => c.p.sub(c.t).multiplyScalar(K).add(c.t));
    // Hero: on wide screens move in so the box fills its half instead of floating in white space.
    const k0 = MathUtils.clamp(1.6 / this.aspect, 0.7, 1);
    this.CAM[0].p.sub(this.CAM[0].t).multiplyScalar(this.desk ? k0 : 0.82).add(this.CAM[0].t); // phones: a bit closer, the box sits below the copy
    this.S = [...Array(6)].map((_, i) => ({ p: V(0, REST_Y, SLOT(i)), q: new Quaternion().setFromEuler(new Euler(-PI / 2, 0, 0)) }));
    // 3: macro on the engraved logo of a knife lying in the box; the other logos recede behind it.
    const logo = (this.logoLocal || V(0.045, 0, 0)).clone().applyQuaternion(this.S[LOGO_KNIFE].q).add(this.S[LOGO_KNIFE].p);
    const lt = logo.clone().add(this.desk ? V(-0.02, -0.006, 0.01) : V(0, 0.012, 0.014));
    this.CAM.splice(3, 0, { p: logo.clone().add(V(0.04, 0.072, 0.066)), t: lt });
    // Hover poses: in front of the box, turned to the camera of that chapter.
    // Each hover point sits above the box, pulled towards that chapter's camera (k).
    const feat = [
      { k: 0.42, r: new Euler(0, -0.1, 0) }, // fein: level, face to camera, fine edge up
      { k: 0.42, r: new Euler(PI, 0.1, 0) }, // grob: turned over, coarse edge up
      { k: 0.42, r: new Euler(0.1, -0.35, 0.06) }, // TV moment: a soft three-quarter turn under the spotlight
    ];
    this.H = feat.map((f, i) => {
      const cam = this.CAM[FEAT_CH + i];
      f.p = V(this.desk ? 0.025 : 0, cam.t.y + 0.02, 0).lerp(cam.p, f.k);
      this.dummy.position.copy(f.p);
      this.dummy.lookAt(cam.p);
      const q = this.dummy.quaternion.clone().multiply(new Quaternion().setFromEuler(f.r));
      return { p: f.p.clone(), q };
    });
    // Fein / Grob: macro along the serrated edge of the hovering knife (see teethCam).
    this.baseFeat = [0, 1, 2].map((i) => this.CAM[FEAT_CH + i]);
    if (this.outline) [0, 1].forEach((i) => { this.CAM[FEAT_CH + i] = { ...this.teethCam(i, 0), via: this.baseFeat[i] }; });
    // Slide 07 (TV moment): the whole open box from above, all six knives in their slots with the
    // engraved logos facing up, under the stage spotlight. Desktop: right of the copy; phones: below it.
    {
      // Classic product view of the open box, from the handle end at a three-quarter angle: knives run
      // up the frame, tips away, logos facing the light. Aimed at the box itself; on desktop a lens
      // shift (in update) moves it right of the copy, on phones down below it.
      const A = this.TV6;
      const t = V(0, 0.02, 0);
      const dir = V(-Math.cos(A.elev) * Math.cos(A.yaw), Math.sin(A.elev), Math.cos(A.elev) * Math.sin(A.yaw));
      const p = t.clone().addScaledVector(dir, this.desk ? A.d : A.d * 1.02);
      this.CAM[FEAT_CH + 2] = { p, t };
    }
    const fanPose = (a, dz) => ({
      p: FAN_P.clone().add(V(-Math.sin(a) * BUTT, Math.cos(a) * BUTT, dz)),
      q: new Quaternion().setFromEuler(new Euler(-0.12, 0, PI / 2 + a)),
    });
    this.F = [...Array(6)].map((_, i) => fanPose(FAN_A(i), 0.004 * (i - 2.5)));

  }

  // Macro along the serrated edge (u: 0 → 1 travels from mid-blade towards the tip, through the teeth).
  // Angle, in the knife's own frame: TP.a along the face normal (towards the viewer), TP.b out past the
  // edge, TP.c along the blade (− = from the handle side, looking towards the tip). TP.d: how far the
  // view looks into the steel below the edge. The path follows the blade's curve, not each tooth.
  teethCam(n, u) {
    const h = this.H[n];
    const o = this.outline;
    const arr = n === 0 ? o.top : o.bot;
    const sgn = n === 0 ? 1 : -1;
    const [x0, x1] = n === 0 ? [0.069, 0.1] : [0.081, 0.098]; // start late enough that the frame is already full of teeth
    const x = x0 + (x1 - x0) * clamp01(u);
    const j = Math.round((x - o.x0) / o.step);
    let y = 0;
    let c = 0;
    for (let k = j - 30; k <= j + 30; k++) if (k >= 0 && k < arr.length) { y += arr[k]; c++; }
    y /= c;
    const e = V(x, y, 0).applyQuaternion(h.q).add(h.p);
    const base = this.baseFeat[n];
    const nrm = V(0, 0, 1).applyQuaternion(h.q);
    if (nrm.dot(base.p.clone().sub(h.p)) < 0) nrm.negate();
    const out = V(0, sgn, 0).applyQuaternion(h.q);
    const bx = V(1, 0, 0).applyQuaternion(h.q);
    const T = this.TP;
    const s = this.desk ? 1 : 0.85; // phones: closer, so the teeth are big enough on a narrow screen
    const p = e.clone().addScaledVector(nrm, T.a * s).addScaledVector(out, T.b * s).addScaledVector(bx, T.c * s);
    const t = e.clone().addScaledVector(out, this.desk ? -T.d : 0.0055).addScaledVector(bx, T.e); // phones: edge lower, under the copy
    // Desktop: aim a little left of the teeth so they sit right of the copy column.
    if (this.desk && T.r) {
      const right = t.clone().sub(p).cross(V(0, 1, 0)).normalize();
      t.addScaledVector(right, -T.r);
      p.addScaledVector(right, -T.r);
    }
    return { p, t, via: base };
  }

  // Screen position (CSS px) of a point given in a knife's local coordinates.
  screenOf(k, x, y) {
    k.updateMatrixWorld(true);
    const v = new Vector3(x, y, 0).applyMatrix4(k.matrixWorld).project(this.camera);
    return [(v.x * 0.5 + 0.5) * this.vw, (0.5 - v.y * 0.5) * this.vh];
  }

  place(k, A, B, t, lift = 0, rotDelay = 0) {
    const tp = smooth(t);
    k.position.lerpVectors(A.p, B.p, tp);
    k.position.y = L(A.p.y, B.p.y, easeOut(t)) + Math.sin(PI * t) * lift;
    k.quaternion.slerpQuaternions(A.q, B.q, smooth(clamp01((t - rotDelay) / (1 - rotDelay))));
  }

  update(fs, time, intro) {
    const tt = reduced ? 0 : time * 0.001;
    const b = this.box;

    // Camera: keyframe per chapter, eased between.
    const i = Math.min(this.CAM.length - 2, Math.max(0, Math.floor(fs)));
    const raw = clamp01(fs - i);
    // Chapter 3 glides along the middle logos of the row.
    const sweepCam = () => {
      const c = this.CAM[3];
      const dz = SLOT(4 - 3 * (this.sweep || 0)) - SLOT(LOGO_KNIFE); // middle four knives: 5th to 2nd
      return { p: c.p.clone().add(V(0, 0, dz)), t: c.t.clone().add(V(0, 0, dz)) };
    };
    const sw = this.sweeps || {};
    const camAt = (j) => {
      if (j === 3) return sweepCam();
      if ((j === 4 || j === 5) && this.outline) return this.teethCam(j - 4, sw[j] || 0);
      return this.CAM[j];
    };
    let A = camAt(i);
    let B = camAt(i + 1);
    let t = smooth(raw);
    // Into a close-up with a via shot: pull back (0–0.4), hold wide while the knife flies (0.4–0.6), push in.
    if (B.via) {
      if (raw < 0.4) { B = B.via; t = smooth(raw / 0.4); }
      else if (raw < 0.6) { A = B.via; B = B.via; t = 0; }
      else { A = B.via; t = smooth((raw - 0.6) / 0.4); }
    }
    const e = easeOut(intro);
    this.camera.position.lerpVectors(A.p, B.p, t);
    this.camera.position.multiplyScalar(1 + (1 - e) * 0.25);
    const tgt = new Vector3().lerpVectors(A.t, B.t, t);
    // Two sets chosen: in the last chapter the camera pulls back and recentres on both boxes.
    // Time-based, so the stacking move takes the same ~1.6 s at any frame rate (and reverses evenly).
    const dt2 = this.t2 ? Math.min(0.05, (time - this.t2) / 1000) : 0.016;
    this.t2 = time;
    const want = this.twoSets && fs > 6.4 ? 1 : 0;
    this.s2 = clamp01((this.s2 || 0) + Math.sign(want - (this.s2 || 0)) * (reduced ? 1 : dt2 / 1.6));
    const k2 = easeOut(clamp01(this.s2)) * clamp01(1 - Math.abs(fs - 7) * 2.5);
    if (k2 > 0.001) {
      // Taller stack: ease back a little and look a bit higher.
      const off = V(0, STACK_H * 0.7, 0).multiplyScalar(k2);
      this.camera.position.sub(tgt).multiplyScalar(1 + 0.18 * k2).add(tgt).add(off);
      tgt.add(off);
    }
    this.camera.lookAt(tgt);
    // Lens shift (keeps perspective natural): desktop hero box moves right of the copy; on phones the
    // hero box moves down below the copy, and the buy chapter's fan moves up above the buy box.
    const w6v = smooth(clamp01(1 - Math.abs(fs - 6) * 1.6));
    const shiftX = this.desk ? 0.2 * (1 - smooth(clamp01(fs))) + 0.17 * w6v : 0;
    const shiftY = this.desk ? 0 : -0.27 * (1 - smooth(clamp01(fs))) + 0.3 * smooth(clamp01(1 - Math.abs(fs - 7) * 1.6)) - 0.27 * w6v;
    if (Math.abs(shiftX) > 0.001 || Math.abs(shiftY) > 0.001) this.camera.setViewOffset(this.vw, this.vh, -shiftX * this.vw, shiftY * this.vh, this.vw, this.vh);
    else if (this.camera.view && this.camera.view.enabled) this.camera.clearViewOffset();

    // Box arrives with a small turn.
    this.world.rotation.y = -(1 - e) * 0.5;
    this.world.position.y = -(1 - e) * 0.02;

    // Lid: lifts and tilts in chapter 1, then leaves the frame upwards.
    const u1 = smooth(clamp01(fs));
    const u2 = smooth(clamp01(fs - 1));
    b.lid.position.set(0, b.LID_Y + u1 * 0.085 + u2 * 0.3, -u1 * 0.03 - u2 * 0.12);
    b.lid.rotation.set(-u1 * 0.32 - u2 * 0.3, 0, u1 * 0.05);
    b.lid.visible = u2 < 0.999;

    // Tissue: front flap first, then the back one.
    const v = clamp01(fs - 1);
    b.front.rotation.x = smooth(clamp01(v * 1.6)) * PI * 0.9;
    b.back.rotation.x = -smooth(clamp01(v * 1.6 - 0.45)) * PI * 0.9;

    // Knives: 1–4 rise to a hover pose for their chapter and settle back into their slot; in the
    // last chapter all six rise together into a fan.
    if (this.knives.length) {
      const fan = (n) => clamp01((fs - 6) * 1.3 - n * 0.06);
      this.knives.forEach((k, n) => {
        if (fan(n) > 0) {
          // The knife hovering in the last feature chapter flies straight into the fan.
          const from = this.S[n];
          this.place(k, from, this.F[n], fan(n), 0.05, from === this.S[n] ? 0.25 : 0);
          return;
        }
        // Knife 1 does both Fein and Grob: between those chapters it simply turns over in the air
        // (to the Grob pose) instead of going back while a second knife comes out.
        if (n === 0) {
          const win = (x) => clamp01((x - 0.12) / 0.55);
          const rise = win(clamp01(fs - (FEAT_CH - 1)));
          const turnOver = win(clamp01(fs - FEAT_CH));
          const back = clamp01(fs - (FEAT_CH + 1));
          if (back > 0) this.place(k, this.H[1], this.S[0], back, 0.02);
          else if (turnOver > 0) this.place(k, this.H[0], this.H[1], turnOver, 0.012);
          else this.place(k, this.S[0], this.H[0], rise, 0.05, 0.25);
          return;
        }
        if (n === 1 || n === 2) {
          // Knives 2 and 3 stay in the box until the fan (the TV slide shows the full open box).
          this.place(k, this.S[n], this.S[n], 0);
          return;
        }
        if (n < 3) {
          const c = FEAT_CH + n;
          // Moves into a close-up chapter happen while the camera holds the wide shot.
          const win = (x) => clamp01((x - 0.12) / 0.55);
          const a0 = clamp01(fs - (c - 1));
          const b0 = clamp01(fs - c);
          const a = this.CAM[c].via ? win(a0) : a0;
          const bb = this.CAM[c + 1] && this.CAM[c + 1].via ? win(b0) : b0;
          if (bb > 0) this.place(k, this.H[n], this.S[n], bb, 0.02);
          else this.place(k, this.S[n], this.H[n], a, 0.05, 0.25);
          // Hovering knife breathes; knife 4 turns about its blade.
          const hover = a * (1 - bb);
          if (hover > 0) {
            // Knives 1 and 2 hold still: the camera travels along their teeth instead.
            const turn = 0;
            k.quaternion.multiply(this.tmpQ.setFromEuler(new Euler(turn * hover, 0, 0)));
            if (n === 2) k.position.y += Math.sin(tt * 1.1) * 0.002 * hover;
          }
        } else {
          this.place(k, this.S[n], this.S[n], 0);
        }
      });
    }

    // Slide 07: spotlight on the open box, room dimmed — like a studio stage.
    {
      const w6 = smooth(clamp01(1 - Math.abs(fs - 6) * 2.2));
      this.spot.intensity = this.TVL.spot * w6;
      // Calmer steel and a matte, dark engraving here: from above the blades mirror the bright
      // overhead light, which washes out the box and hides the logos.
      if (this.steelMat) this.steelMat.envMapIntensity = 1 - this.TVL.steel * w6;
      if (this.etchMat) { this.etchMat.metalness = 0.85 - 0.7 * w6; this.etchMat.roughness = 0.55 + 0.35 * w6; this.etchMat.envMapIntensity = 1 - 0.85 * w6; }
      this.spot.position.set(-0.03, 0.5, 0.06);
      this.spot.target.position.set(0, 0.02, 0);
      this.hemi.intensity = 1.1 * (1 - 0.7 * w6);
      this.key.intensity = 1.4 * (1 - 0.75 * w6);
    }

    // Two sets: the open box lifts, a closed box slides in underneath, the open box settles on it.
    if (this.set2) {
      const s2 = clamp01(this.s2 || 0);
      const on = s2 > 0.002;
      this.set2.visible = on;
      // 0–0.4 open box rises a little above stack height; 0.25–0.8 the closed box glides in from the
      // front with a gentle turn; 0.7–1 the open box sets down on it.
      const lift = smooth(clamp01(s2 / 0.4)) * (STACK_H + 0.02) - 0.02 * smooth(clamp01((s2 - 0.7) / 0.3));
      const slide = smooth(smooth(clamp01((s2 - 0.25) / 0.55)));
      this.set2.position.set(0, 0, (1 - slide) * 0.32);
      this.set2.rotation.y = (1 - slide) * 0.18;
      this.set2.scale.setScalar(0.97 + 0.03 * slide);
      [this.box.base, this.box.front, this.box.back].forEach((o) => { o.position.y = o.userData.y0 + lift; });
      // The fan rides up with the open box.
      if (on) this.knives.forEach((k) => { k.position.y += lift; });
    }
    this.renderer.render(this.scene, this.camera);
  }
}

function init() {
  const root = document.documentElement;
  const canvas = document.querySelector('.stage');
  const chapters = [...document.querySelectorAll('[data-ch]')];
  const copies = chapters.map((s) => s.querySelector('.copy'));
  // First opaque section after the story: once it covers the screen, stop rendering the 3D stage.
  const buy = document.querySelector('.engrave') || document.querySelector('.faq');
  const steps = document.querySelector('.steps');
  const stepN = document.querySelector('[data-step]');
  const stepName = document.querySelector('[data-step-name]');

  let stage = null;
  try { stage = new Stage(canvas); } catch (e) { root.classList.add('is-ready'); }
  let centres = [];
  let holds = [];
  const layout = () => {
    if (stage) stage.resize(innerWidth, innerHeight);
    centres = chapters.map((el, i) => (i === 0 ? 0 : el.offsetTop + el.offsetHeight / 2 - innerHeight / 2));
    // Long chapters hold their pose over a scroll range (used by the logo fly-over).
    holds = chapters.map((el) => (el.classList.contains('ch--long') ? Math.max(0, (el.offsetHeight - innerHeight * 1.4) / 2) : 0));
  };
  layout();
  addEventListener('resize', layout);
  addEventListener('load', layout);

  let readyAt = 0;
  if (stage) {
    const d = canvas.dataset;
    stage.load(d.model, d.hdr, d.hdrHd, d.marble).then(() => { readyAt = performance.now(); root.classList.add('is-ready'); }).catch(() => root.classList.add('is-ready'));
  }

  const form = document.querySelector('[data-buy]');
  const toast = document.querySelector('.toast');
  // Choosing "2 Boxen" brings a second box with its knives into the last scene.
  form.addEventListener('change', () => {
    if (stage) stage.twoSets = form.querySelector('input[name="set"]:checked').value === '2';
  });
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
    for (let i = 0; i < centres.length; i++) {
      if (y > centres[i] + holds[i]) continue;
      if (i === 0 || y >= centres[i] - holds[i]) return i;
      const a = centres[i - 1] + holds[i - 1];
      const b = centres[i] - holds[i];
      return i - 1 + clamp01((clamp01((y - a) / Math.max(1, b - a)) - 0.2) / 0.6);
    }
    return centres.length - 1;
  };
  // The glide starts halfway through the move into the close-up, so the camera is already travelling
  // when the copy lands, and reaches the back knife as the hold ends.
  const sweepAt = (y, c = 3) => {
    if (!holds[c]) return 0;
    const holdA = centres[c] - holds[c];
    // Logo glide starts halfway through the move in; the teeth tracks run over the hold itself.
    const start = c === 3 || c === 6 ? holdA - 0.5 * (holdA - (centres[c - 1] + holds[c - 1])) : holdA;
    return clamp01((y - start) / (centres[c] + holds[c] - start));
  };
  const sws = { 3: 0, 4: 0, 5: 0, 6: 0 };

  let last = performance.now();
  let fs = null;
  let lastN = -1;
  const frame = (now) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const f = chapterAt(scrollY);
    const k = 1 - Math.exp(-dt * 5);
    fs = fs === null || reduced || window.akSnap ? f : fs + (f - fs) * k;
    [3, 4, 5, 6].forEach((c) => {
      const tgt = sweepAt(scrollY, c);
      sws[c] = reduced || window.akSnap ? tgt : sws[c] + (tgt - sws[c]) * k;
    });
    if (stage) {
      stage.sweep = smooth(sws[3]);
      stage.sweeps = { 4: smooth(sws[4]), 5: smooth(sws[5]), 6: smooth(sws[6]) };
    }

    copies.forEach((el, i) => {
      if (!el || i === 0) return;
      el.style.setProperty('--v', clamp01(1 - Math.abs(fs - i) * 2.4).toFixed(3));
    });
    if (copies[0]) copies[0].style.setProperty('--v', clamp01(1 - fs * 2.5).toFixed(3));

    // Close-up chapters (3 logo, 4 fine teeth, 5 coarse teeth) fill the frame with steel: veil the copy side.
    // The hero copy also sits over marble, so it gets a lighter veil.
    root.style.setProperty('--veil', Math.max(clamp01(Math.min(fs - 2.35, 5.65 - fs) * 2.5), 0.42 * clamp01(1 - fs * 2)).toFixed(3));

    const n = Math.round(f);
    if (n !== lastN) {
      lastN = n;
      stepN.textContent = String(n + 1).padStart(2, '0');
      stepName.textContent = chapters[n].dataset.name;
    }
    const covered = buy.getBoundingClientRect().top;
    // Light wordmark while a dark section (engraving ad, footer) sits under the top bar.
    {
      const darkUnderNav = [document.querySelector('.engrave'), document.querySelector('.foot')].some((el) => {
        if (!el) return false;
        const r = el.getBoundingClientRect();
        return r.top < 40 && r.bottom > 20;
      });
      root.classList.toggle('nav-dark', darkUnderNav);
    }
    // Hide the step index once the buy box is up (on phones it sits right where the box is).
    steps.style.setProperty('--so', covered < innerHeight * 0.85 || (innerWidth <= 800 && fs > 6.5) ? 0 : 1);

    if (stage && readyAt && covered > 0) stage.update(fs, now, reduced ? 1 : clamp01((now - readyAt) / 2200));
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  // Laser engraving ad below the FAQ (its own small scene).
  const eg = document.querySelector('.engrave');
  if (eg) initEngrave(eg, studioEnvironment);
  window.akBox = { stage, chapterAt };
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
