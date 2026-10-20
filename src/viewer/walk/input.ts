import { create } from 'zustand';

/** Shared, frame-rate input for walk mode (written by DOM controls, read in the render loop). */
export const walkInput = {
  forward: 0,
  strafe: 0,
  run: false,
  /** Accumulated look deltas in radians, consumed each frame. */
  lookYaw: 0,
  lookPitch: 0,
  /** Glide toward this plan point. */
  target: null as null | [number, number],
  /** Jump straight to a spot. */
  teleport: null as null | { x: number; y: number; level: number; yaw?: number },
};

/** What the walk HUD shows. */
export const useWalkState = create<{ room: string | null; roomName: string | null; level: number; locked: boolean }>(() => ({ room: null, roomName: null, level: 0, locked: false }));
