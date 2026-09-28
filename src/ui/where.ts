/** A place a notification can take the camera to: a fixed point, or one looked up when clicked (things that move). */
export type Where = { x: number; z: number } | (() => { x: number; z: number } | null);
