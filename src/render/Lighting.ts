import * as THREE from 'three';
import { COLORS, DAY_KEYS, RENDER } from '../config';
import { clamp } from '../world/noise';

export interface LightState {
  sunDir: THREE.Vector3;
  sunColor: THREE.Color;
  sunIntensity: number;
  night: number;
  /** 0 at night, 1 in full daylight. */
  day: number;
  exposure: number;
  fog: THREE.Color;
}

const cA = new THREE.Color();
const _sun = new THREE.Vector3();
const _moon = new THREE.Vector3();
const cB = new THREE.Color();
const cC = new THREE.Color();
/** Storm cloud tints: grey by day, deep slate at night (so night storms stay dark). */
const STORM_HEMI_DAY = new THREE.Color(0x8a97a8);
const STORM_HEMI_NIGHT = new THREE.Color(0x1f2836);
const STORM_FOG_DAY = new THREE.Color(0x7f8a96);
const STORM_FOG_NIGHT = new THREE.Color(0x0f141c);
/** Lightning: a cold blue-white flash on the land and in the sky. */
const FLASH_LIGHT = new THREE.Color(0xd4e0ff);
const FLASH_SKY = new THREE.Color(0x7d8cb0);

/**
 * Golden-hour sun, cool sky bounce, low ambient, and the day/night keyframes.
 * The sun's shadow camera is re-fitted every frame around what the camera sees.
 */
export class Lighting {
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  readonly ambient: THREE.AmbientLight;
  readonly state: LightState = {
    sunDir: new THREE.Vector3(),
    sunColor: new THREE.Color(),
    sunIntensity: 3,
    night: 0,
    day: 1,
    exposure: RENDER.exposure,
    fog: new THREE.Color(RENDER.fogColor),
  };
  /** World azimuth (radians) the evening sun sits at: upper-right of the default view. */
  eveningAzimuth = 0;
  /** Darkening from storms / rain (0..1). */
  overcast = 0;
  /** Lightning flash on the scene (0..~1.4), set each frame by the weather. */
  flash = 0;

  constructor(scene: THREE.Scene, shadowSize: number) {
    this.sun = new THREE.DirectionalLight(COLORS.sunWarm, 3.2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(shadowSize, shadowSize);
    this.sun.shadow.bias = -0.0006;
    // Larger normal offset: no shadow acne patterns on smooth hillsides.
    this.sun.shadow.normalBias = 0.07;
    const sc = this.sun.shadow.camera;
    sc.near = 1;
    sc.far = 400;
    scene.add(this.sun);
    scene.add(this.sun.target);

    this.hemi = new THREE.HemisphereLight(COLORS.sky, COLORS.hemiGround, 1.0);
    scene.add(this.hemi);
    this.ambient = new THREE.AmbientLight(0xbfd8ff, 0.18);
    scene.add(this.ambient);
  }

  setShadowSize(size: number): void {
    if (this.sun.shadow.mapSize.x === size) return;
    this.sun.shadow.mapSize.set(size, size);
    this.sun.shadow.map?.dispose();
    this.sun.shadow.map = null;
  }

  /**
   * @param dayT real day fraction 0..1
   * @param target camera look-at point
   * @param viewRadius approximate radius of the visible area
   */
  update(dayT: number, target: THREE.Vector3, viewRadius: number): void {
    // Interpolate keyframes.
    let a = DAY_KEYS[0], b = DAY_KEYS[DAY_KEYS.length - 1];
    for (let i = 0; i < DAY_KEYS.length - 1; i++) {
      if (dayT >= DAY_KEYS[i].t && dayT <= DAY_KEYS[i + 1].t) {
        a = DAY_KEYS[i];
        b = DAY_KEYS[i + 1];
        break;
      }
    }
    const f = b.t > a.t ? (dayT - a.t) / (b.t - a.t) : 0;
    const L = (x: number, y: number) => x + (y - x) * f;
    const elev = L(a.elev, b.elev);
    const night = L(a.night, b.night);
    const s = this.state;
    s.night = night;
    s.day = 1 - night;

    // Sun sweeps across the sky; in the evening it is upper-right of the default view.
    const az = this.eveningAzimuth + (0.66 - dayT) * 3.4;
    let el = (elev * Math.PI) / 180;
    el = Math.max(el, (6 * Math.PI) / 180);
    _sun.set(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el));
    // At night the light hands over smoothly to a high, silvery moon that drifts slowly across the sky
    // (its glitter path on the sea points back toward the default view).
    const mAz = this.eveningAzimuth + 0.35 + (dayT < 0.5 ? dayT + 1 : dayT) * 0.5 - 0.5;
    const mEl = (40 * Math.PI) / 180;
    _moon.set(Math.cos(mAz) * Math.cos(mEl), Math.sin(mEl), Math.sin(mAz) * Math.cos(mEl));
    const m = clamp((night - 0.3) / 0.5, 0, 1);
    s.sunDir.copy(_sun).lerp(_moon, m * m * (3 - 2 * m)).normalize();

    cA.setHex(a.sun);
    cB.setHex(b.sun);
    s.sunColor.copy(cA).lerp(cB, f);
    const oc = this.overcast;
    s.sunIntensity = L(a.sunI, b.sunI) * (1 - oc * 0.85);
    this.sun.color.copy(s.sunColor);
    this.sun.intensity = s.sunIntensity;

    cA.setHex(a.hemiSky);
    cB.setHex(b.hemiSky);
    this.hemi.color.copy(cA).lerp(cB, f).lerp(cC.copy(STORM_HEMI_DAY).lerp(STORM_HEMI_NIGHT, night), oc * 0.7);
    cA.setHex(a.hemiGround);
    cB.setHex(b.hemiGround);
    this.hemi.groundColor.copy(cA).lerp(cB, f);
    this.hemi.intensity = L(a.hemiI, b.hemiI) * (1 - oc * (0.35 + 0.15 * night));
    this.ambient.intensity = L(a.amb, b.amb) * (1 - oc * 0.35 * night);

    cA.setHex(a.fog);
    cB.setHex(b.fog);
    s.fog.copy(cA).lerp(cB, f).lerp(cC.copy(STORM_FOG_DAY).lerp(STORM_FOG_NIGHT, night), oc * 0.6);
    s.exposure = L(a.exposure, b.exposure) * (1 - oc * (0.12 + 0.08 * night));

    // Lightning: everything lights up cold and blue-white for an instant (most of all in the dark).
    const fl = this.flash * (0.55 + 0.45 * night);
    if (fl > 0.001) {
      const fc = Math.min(1, fl);
      this.ambient.intensity += fl * 1.0;
      this.hemi.color.lerp(FLASH_LIGHT, fc * 0.65);
      this.hemi.intensity += fl * 1.2;
      s.fog.lerp(FLASH_SKY, fc * 0.5);
      s.exposure *= 1 + fl * 0.18;
    }

    // Fit the shadow camera tightly around the view, snapped to texels to avoid shimmering.
    const r = clamp(viewRadius, 12, 150);
    const sc = this.sun.shadow.camera;
    sc.left = -r;
    sc.right = r;
    sc.top = r;
    sc.bottom = -r;
    sc.updateProjectionMatrix();
    const texel = (2 * r) / this.sun.shadow.mapSize.x;
    const tx = Math.round(target.x / texel) * texel;
    const tz = Math.round(target.z / texel) * texel;
    this.sun.target.position.set(tx, target.y, tz);
    this.sun.position.set(tx + s.sunDir.x * 160, target.y + s.sunDir.y * 160, tz + s.sunDir.z * 160);
    this.sun.target.updateMatrixWorld();
  }
}
