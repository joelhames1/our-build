'use client';

import { CameraControls, Environment, Lightformer, PerformanceMonitor, Sky } from '@react-three/drei';
import { Canvas, useThree } from '@react-three/fiber';
import { EffectComposer, N8AO, ToneMapping } from '@react-three/postprocessing';
import { ToneMappingMode } from 'postprocessing';
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import type { Resolved } from '@/core/resolve';
import { Building } from './Building';
import type { RenderMode } from './materials';
import { Site } from './Site';
import { WalkControls } from './walk/WalkControls';
import { sunColor, sunDirection } from './sun';

export type ViewMode = 'exterior' | 'dollhouse' | 'walk' | 'plan';

export interface SceneProps {
  resolved: Resolved;
  mode: RenderMode;
  view: ViewMode;
  /** Active level for the dollhouse cut. */
  level: number;
  hour: number;
  selected?: string | null;
  onPick?: (owner: string, point: THREE.Vector3) => void;
  onMiss?: () => void;
  /** Deterministic rendering for screenshots and tests. */
  testMode?: boolean;
  /** Extra rotation (degrees) of the initial camera around the house. */
  orbit?: number;
  /** Ambient occlusion: 'auto' drops it on slow devices. */
  ao?: 'auto' | 'on' | 'off';
  children?: React.ReactNode;
}

export interface SceneHandle {
  /** Snapshot of the current view as a PNG data URL. */
  snapshot: (width?: number, height?: number) => string | null;
  frame: () => void;
  /** The house (not the site) as a binary glTF. */
  exportGLB: () => Promise<Blob | null>;
}

export const Scene = forwardRef<SceneHandle, SceneProps>(function Scene(props, ref) {
  const { resolved, mode, view, level, hour, testMode } = props;
  const site = resolved.project.site;
  const sun = useMemo(() => sunDirection(hour, site.latitude, site.northDeg), [hour, site.latitude, site.northDeg]);
  const glRef = useRef<{ gl: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.Camera } | null>(null);
  const controls = useRef<CameraControls>(null);
  // Ambient occlusion until the device shows it can't keep up.
  const [ao, setAo] = useState(true);

  useImperativeHandle(ref, () => ({
    snapshot: () => {
      const g = glRef.current;
      if (!g) return null;
      // A plain render (no effects), so tone-map it the way the effects pass would.
      const tm = g.gl.toneMapping;
      g.gl.toneMapping = THREE.AgXToneMapping;
      g.gl.render(g.scene, g.camera);
      g.gl.toneMapping = tm;
      return g.gl.domElement.toDataURL('image/png');
    },
    frame: () => frameCamera(controls.current, resolved, view, true, props.orbit),
    exportGLB: async () => {
      const g = glRef.current;
      const house = g?.scene.getObjectByName('house');
      if (!house) return null;
      const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js');
      const exporter = new GLTFExporter();
      const result = await exporter.parseAsync(house, { binary: true, onlyVisible: true });
      return new Blob([result as ArrayBuffer], { type: 'model/gltf-binary' });
    },
  }));

  const b = resolved.bounds;
  const radius = Math.max(b.x1 - b.x0, b.y1 - b.y0, resolved.peak) * 1.2 + 20;
  const cx = (b.x0 + b.x1) / 2;
  const cy = (b.y0 + b.y1) / 2;
  const sunPos = new THREE.Vector3(...sun.dir).multiplyScalar(radius * 2.2).add(new THREE.Vector3(cx, 0, -cy));

  return (
    <Canvas
      shadows="percentage"
      dpr={testMode ? 1 : [1, 1.75]}
      gl={{ antialias: true, preserveDrawingBuffer: true, toneMapping: THREE.AgXToneMapping, toneMappingExposure: 1.05 }}
      camera={{ fov: 38, near: 0.2, far: 5000, position: [cx + radius * 0.9, radius * 0.55, -cy + radius * 1.1] }}
      onPointerMissed={() => props.onMiss?.()}
      style={{ touchAction: 'none' }}
    >
      <Capture intoRef={glRef} />
      <color attach="background" args={['#e9eef1']} />
      <fog attach="fog" args={['#e4e9ec', radius * 3, radius * 9]} />
      <Sky distance={4500} sunPosition={sun.dir} turbidity={6} rayleigh={1.6} mieCoefficient={0.004} mieDirectionalG={0.85} />
      <hemisphereLight args={['#f4f1ea', '#8a8f7a', (mode === 'clay' ? 0.9 : 0.75) + (view === 'walk' ? 0.35 : 0)]} />
      <directionalLight
        position={sunPos}
        intensity={mode === 'clay' ? 2.4 : 2.8}
        color={sunColor(sun.elevation)}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.04}
        shadow-camera-left={-radius}
        shadow-camera-right={radius}
        shadow-camera-top={radius}
        shadow-camera-bottom={-radius}
        shadow-camera-near={1}
        shadow-camera-far={radius * 5}
      >
        <object3D attach="target" position={[cx, 0, -cy]} />
      </directionalLight>
      <Environment resolution={128} frames={1}>
        <Lightformer intensity={1.2} position={[0, 30, 0]} rotation-x={Math.PI / 2} scale={[80, 80, 1]} color="#ffffff" />
        <Lightformer intensity={0.6} position={[60, 10, 0]} rotation-y={-Math.PI / 2} scale={[60, 20, 1]} color="#fff3e2" />
        <Lightformer intensity={0.5} position={[-60, 10, 0]} rotation-y={Math.PI / 2} scale={[60, 20, 1]} color="#e6eef5" />
      </Environment>

      <Building
        resolved={resolved}
        mode={mode}
        cutLevel={view === 'dollhouse' ? level : undefined}
        doorsOpen={view === 'walk'}
        onPick={view === 'walk' ? undefined : props.onPick}
        selected={view === 'walk' ? null : props.selected}
      />
      <Site resolved={resolved} mode={mode} />
      {props.children}
      {view === 'walk' && <WalkControls resolved={resolved} />}
      {view !== 'walk' && (
        <CameraControls
          ref={controls}
          makeDefault
          minDistance={8}
          maxDistance={radius * 4}
          maxPolarAngle={Math.PI / 2 - 0.04}
          dollyToCursor
          smoothTime={testMode ? 0 : 0.25}
        />
      )}
      <AutoFrame controls={controls} resolved={resolved} view={view} orbit={props.orbit} />
      {/* Not in the dollhouse: glass writes no depth, so the deep notch behind cut windows would bleed through. */}
      {props.ao !== 'off' && (props.ao === 'on' || !testMode) && view !== 'dollhouse' && (
        <>
          {props.ao !== 'on' && <PerformanceMonitor onDecline={() => setAo(false)} />}
          {(ao || props.ao === 'on') && (
            <EffectComposer multisampling={4}>
              <N8AO halfRes quality="performance" aoRadius={view === 'walk' ? 2.5 : 5} distanceFalloff={1} intensity={view === 'walk' ? 1.6 : 2.2} color="#2b2620" />
              <ToneMapping mode={ToneMappingMode.AGX} />
            </EffectComposer>
          )}
        </>
      )}
    </Canvas>
  );
});

function Capture({ intoRef }: { intoRef: React.MutableRefObject<{ gl: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.Camera } | null> }) {
  const { gl, scene, camera } = useThree();
  useEffect(() => {
    intoRef.current = { gl, scene, camera };
  }, [gl, scene, camera, intoRef]);
  return null;
}

/** Frame the house when the project first loads or the view mode changes. */
function AutoFrame({ controls, resolved, view, orbit }: { controls: React.RefObject<CameraControls | null>; resolved: Resolved; view: ViewMode; orbit?: number }) {
  const key = `${resolved.project.name}|${view}|${orbit ?? 0}`;
  const last = useRef('');
  const get = useThree((t) => t.get);
  useEffect(() => {
    if (last.current === key) return;
    last.current = key;
    if (view !== 'walk') {
      // Back from walking: restore the normal lens.
      const cam = get().camera as THREE.PerspectiveCamera;
      if (cam.fov !== 38) {
        cam.fov = 38;
        cam.near = 0.2;
        cam.updateProjectionMatrix();
      }
    }
    // Wait a frame for controls to mount.
    const id = requestAnimationFrame(() => frameCamera(controls.current, resolved, view, false, orbit));
    return () => cancelAnimationFrame(id);
  }, [key, controls, resolved, view, orbit, get]);
  return null;
}

export function frameCamera(c: CameraControls | null, resolved: Resolved, view: ViewMode, animate: boolean, orbit = 0) {
  if (!c) return;
  const b = resolved.bounds;
  const cx = (b.x0 + b.x1) / 2;
  const cy = (b.y0 + b.y1) / 2;
  const span = Math.max(b.x1 - b.x0, b.y1 - b.y0);
  const front = resolved.project.site.front;
  // Approach from the front, a little off-axis.
  const fv: Record<string, [number, number]> = { S: [0.55, -1], N: [-0.55, 1], E: [1, 0.55], W: [-1, -0.55] };
  const [fx0, fy0] = fv[front];
  const ang = (orbit * Math.PI) / 180;
  const fx = fx0 * Math.cos(ang) - fy0 * Math.sin(ang);
  const fy = fx0 * Math.sin(ang) + fy0 * Math.cos(ang);
  // Back off far enough for both the footprint and the height, with room for the floating UI.
  const dist = Math.max(span * 1.45 + 22, resolved.peak * 2.6 + 12);
  const height = view === 'dollhouse' ? dist * 0.95 : Math.max(resolved.peak * 0.8, dist * 0.3);
  const targetZ = view === 'dollhouse' ? 2 : resolved.peak * 0.42;
  c.setLookAt(cx + fx * dist * 0.8, height, -(cy + fy * dist * 0.8), cx, targetZ, -cy, animate);
}
