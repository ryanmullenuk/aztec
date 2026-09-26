import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { Pass, FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';
import { RENDER, PresetName } from '../config';

const quadVert = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

/**
 * Renders the scene into a private target that owns a depth texture, then copies colour into
 * the composer chain. Keeping depth off the ping-pong buffers avoids framebuffer feedback loops
 * when later passes sample it.
 */
class ScenePass extends Pass {
  readonly target: THREE.WebGLRenderTarget;
  private copy: FullScreenQuad;
  private copyMat: THREE.ShaderMaterial;
  constructor(private scene: THREE.Scene, private camera: THREE.Camera, w: number, h: number) {
    super();
    this.needsSwap = false;
    this.target = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType,
      depthTexture: new THREE.DepthTexture(w, h, THREE.UnsignedIntType),
    });
    this.copyMat = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: this.target.texture } },
      vertexShader: quadVert,
      fragmentShader: 'uniform sampler2D tDiffuse; varying vec2 vUv; void main(){ gl_FragColor = texture2D(tDiffuse, vUv); }',
      depthTest: false,
      depthWrite: false,
    });
    this.copy = new FullScreenQuad(this.copyMat);
  }
  get depth(): THREE.DepthTexture | null {
    return this.target.depthTexture;
  }
  override setSize(w: number, h: number): void {
    this.target.setSize(w, h);
  }
  override render(renderer: THREE.WebGLRenderer, _w: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget): void {
    renderer.setRenderTarget(this.target);
    renderer.clear();
    renderer.render(this.scene, this.camera);
    renderer.setRenderTarget(readBuffer);
    this.copy.render(renderer);
  }
}

const dofFrag = (samples: number) => /* glsl */ `
  #define SAMPLES ${samples}
  uniform sampler2D tColor;
  uniform sampler2D tDepth;
  uniform vec2 uRes;
  uniform float uNear;
  uniform float uFar;
  uniform float uFocus;
  uniform float uAperture;
  uniform float uMaxBlur;
  uniform float uFg;
  uniform float uTilt;
  uniform float uStrength;
  varying vec2 vUv;
  float linDepth(float d) {
    float z = d * 2.0 - 1.0;
    return (2.0 * uNear * uFar) / (uFar + uNear - z * (uFar - uNear));
  }
  float cocAt(vec2 uv, float d) {
    float c = (d - uFocus) / d;
    c = c < 0.0 ? -c * uFg : c;
    c = max(c - 0.035, 0.0); // sharp band around the focus distance
    float ty = abs(uv.y - 0.5) * 2.0;
    float tilt = ty * ty * uTilt * (0.35 + 0.65 * clamp(abs(c) * 6.0, 0.0, 1.0));
    return clamp((c * uAperture + tilt) * uStrength, 0.0, 1.0) * uMaxBlur;
  }
  void main() {
    vec4 base = texture2D(tColor, vUv);
    float d = linDepth(texture2D(tDepth, vUv).x);
    float r = cocAt(vUv, d);
    if (r < 0.6) { gl_FragColor = base; return; }
    vec3 acc = base.rgb;
    float wsum = 1.0;
    for (int i = 0; i < SAMPLES; i++) {
      float fi = float(i) + 0.5;
      float rr = sqrt(fi / float(SAMPLES)) * r;
      float a = fi * 2.39996323;
      vec2 suv = vUv + vec2(cos(a), sin(a)) * rr / uRes;
      vec3 c = texture2D(tColor, suv).rgb;
      float sd = linDepth(texture2D(tDepth, suv).x);
      float rs = cocAt(suv, sd);
      // Samples only contribute if their own blur reaches this pixel (limits sharp-edge bleeding),
      // except nearer blurred samples which spill over (foreground bokeh).
      float w = clamp(rs - rr + 1.0, 0.0, 1.0);
      if (sd < d && rs > r) w = 1.0;
      float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
      w *= 1.0 + smoothstep(1.2, 4.0, lum) * 1.5; // bokeh highlights
      acc += c * w;
      wsum += w;
    }
    gl_FragColor = vec4(acc / wsum, base.a);
  }
`;


/** Depth-based tilt-shift depth of field with golden-angle bokeh gather. */
class DofPass extends Pass {
  readonly material: THREE.ShaderMaterial;
  private quad: FullScreenQuad;
  constructor(private scenePass: ScenePass, samples: number) {
    super();
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        tColor: { value: null },
        tDepth: { value: null },
        uRes: { value: new THREE.Vector2(1, 1) },
        uNear: { value: RENDER.near },
        uFar: { value: RENDER.far },
        uFocus: { value: 60 },
        uAperture: { value: RENDER.dof.aperture },
        uMaxBlur: { value: RENDER.dof.maxBlur },
        uFg: { value: RENDER.dof.foregroundBoost },
        uTilt: { value: RENDER.dof.tilt },
        uStrength: { value: RENDER.dof.strength },
      },
      vertexShader: quadVert,
      fragmentShader: dofFrag(samples),
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new FullScreenQuad(this.material);
  }
  setSamples(n: number): void {
    this.material.fragmentShader = dofFrag(n);
    this.material.needsUpdate = true;
  }
  override setSize(w: number, h: number): void {
    this.material.uniforms.uRes.value.set(w, h);
    // Blur radius scales with resolution (tuned for 1080p).
    this.material.uniforms.uMaxBlur.value = RENDER.dof.maxBlur * (h / 1080);
  }
  override render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget): void {
    this.material.uniforms.tColor.value = readBuffer.texture;
    this.material.uniforms.tDepth.value = this.scenePass.depth;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }
  override dispose(): void {
    this.material.dispose();
    this.quad.dispose();
  }
}

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uSat: { value: RENDER.grade.saturation },
    uWarm: { value: RENDER.grade.warmth },
    uTeal: { value: RENDER.grade.teal },
    uContrast: { value: RENDER.grade.contrast },
    uVig: { value: RENDER.grade.vignette },
    uNight: { value: 0 },
    /** Pixel style: colour quantisation with ordered dithering (0 = off). */
    uPixel: { value: 0 },
  },
  vertexShader: quadVert.replace('gl_Position = vec4(position.xy, 0.0, 1.0);', 'gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);'),
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uSat, uWarm, uTeal, uContrast, uVig, uNight, uPixel;
    varying vec2 vUv;
    float bayer4(vec2 p) {
      vec2 q = mod(floor(p), 4.0);
      float i = q.x + q.y * 4.0;
      // 4x4 Bayer matrix, row-major.
      float m[16];
      m[0]=0.0; m[1]=8.0; m[2]=2.0; m[3]=10.0; m[4]=12.0; m[5]=4.0; m[6]=14.0; m[7]=6.0;
      m[8]=3.0; m[9]=11.0; m[10]=1.0; m[11]=9.0; m[12]=15.0; m[13]=7.0; m[14]=13.0; m[15]=5.0;
      for (int k = 0; k < 16; k++) if (float(k) == i) return m[k] / 16.0 - 0.5;
      return 0.0;
    }
    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      // Warm highlights, teal shadows (moonlit blue at night).
      vec3 warm = mix(vec3(1.0, 0.82, 0.58), vec3(0.75, 0.85, 1.0), uNight);
      c += (warm - 0.75) * uWarm * smoothstep(0.35, 1.0, l);
      c += mix(vec3(-0.05, 0.28, 0.32), vec3(-0.05, 0.05, 0.35), uNight) * uTeal * (1.0 - smoothstep(0.0, 0.45, l));
      // Moonlight is cooler and less saturated.
      c = mix(vec3(l), c, uSat * (1.0 - uNight * 0.3));
      c = (c - 0.5) * uContrast + 0.5;
      vec2 d = vUv - 0.5;
      c *= clamp(1.0 - dot(d, d) * uVig * 2.2, 0.0, 1.0);
      if (uPixel > 0.5) {
        // Limited palette per channel with a gentle ordered dither, like hand-made pixel art.
        float lv = 18.0;
        c = floor(c * lv + 0.5 + bayer4(gl_FragCoord.xy) * 0.85) / lv;
      }
      gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
    }
  `,
};

/** The whole post chain: scene -> GTAO -> DOF -> bloom -> tone map -> grade/vignette -> SMAA/FXAA. */
export class PostFX {
  readonly composer: EffectComposer;
  private scenePass: ScenePass;
  private gtao: GTAOPass;
  readonly dof: DofPass;
  private bloom: UnrealBloomPass;
  private output: OutputPass;
  private grade: ShaderPass;
  private smaa: SMAAPass;
  private fxaa: ShaderPass;
  dofEnabled = true;
  dofStrength = RENDER.dof.strength;
  private pixel = false;
  private preset: PresetName = 'high';

  constructor(private renderer: THREE.WebGLRenderer, scene: THREE.Scene, private camera: THREE.PerspectiveCamera) {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, depthBuffer: false });
    this.composer = new EffectComposer(renderer, rt);
    this.scenePass = new ScenePass(scene, camera, size.x, size.y);
    this.gtao = new GTAOPass(scene, camera, size.x, size.y);
    this.gtao.updateGtaoMaterial({ radius: RENDER.ssao.radius, thickness: RENDER.ssao.thickness, scale: RENDER.ssao.scale, samples: 12 });
    this.gtao.blendIntensity = RENDER.ssao.blend;
    // Use the scene pass's own depth (normals reconstructed from it): it already has the dithered
    // see-through trees cut out and leaves out clouds and spray, so AO never draws their silhouettes.
    // It also saves rendering the whole scene a second time.
    if (this.scenePass.depth) this.gtao.setGBuffer(this.scenePass.depth);
    this.dof = new DofPass(this.scenePass, RENDER.presets.high.dofSamples);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), RENDER.bloom.strength, RENDER.bloom.radius, RENDER.bloom.threshold);
    this.output = new OutputPass();
    this.grade = new ShaderPass(GradeShader);
    this.smaa = new SMAAPass();
    this.fxaa = new ShaderPass(FXAAShader);

    this.composer.addPass(this.scenePass);
    this.composer.addPass(this.gtao);
    this.composer.addPass(this.dof);
    this.composer.addPass(this.bloom);
    this.composer.addPass(this.output);
    this.composer.addPass(this.grade);
    this.composer.addPass(this.smaa);
    this.composer.addPass(this.fxaa);
  }

  applyPreset(p: PresetName): void {
    this.preset = p;
    const cfg = RENDER.presets[p];
    this.gtao.enabled = cfg.ssao;
    this.bloom.enabled = cfg.bloom;
    // Pixel style keeps hard pixel edges: no anti-aliasing.
    this.smaa.enabled = cfg.smaa && !this.pixel;
    this.fxaa.enabled = !cfg.smaa && !this.pixel;
    this.dof.setSamples(cfg.dofSamples);
  }

  setPixelStyle(on: boolean): void {
    this.pixel = on;
    this.grade.material.uniforms.uPixel.value = on ? 1 : 0;
    this.applyPreset(this.preset);
  }

  setSize(w: number, h: number): void {
    this.composer.setSize(w, h);
    const pr = this.renderer.getPixelRatio();
    this.fxaa.material.uniforms['resolution'].value.set(1 / (w * pr), 1 / (h * pr));
  }

  /** @param focusDistance distance from the camera to the point at screen centre. */
  render(dt: number, focusDistance: number, night: number): void {
    const u = this.dof.material.uniforms;
    u.uFocus.value = focusDistance;
    u.uAperture.value = RENDER.dof.aperture * Math.pow(RENDER.dof.refDistance / focusDistance, 0.6);
    u.uStrength.value = this.dofStrength;
    this.dof.enabled = this.dofEnabled && this.dofStrength > 0.01;
    u.uNear.value = this.camera.near;
    u.uFar.value = this.camera.far;
    this.grade.material.uniforms.uNight.value = night;
    this.composer.render(dt);
  }
}
