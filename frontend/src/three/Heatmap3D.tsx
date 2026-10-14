import { useEffect, useMemo, useRef } from 'react';
import type { MutableRefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { Trajectory, computeLiveDensity, emptyFrame } from '../utils/playback';
import { densityColor } from './scene-utils';

export type HeatMode3D = 'off' | 'peak' | 'live';

interface Heatmap3DProps {
  densityGrid: { cell: number; nx: number; ny: number; peak: number[][] } | null;
  trajectory: Trajectory | null;
  floorY: number;
  width: number;
  height: number;
  mode: HeatMode3D;
  timeRef: MutableRefObject<number>;
}

/** Paints the real density grid (peak, from the completed run) or a live recomputation
 * from the current agent frame (throttled to ~8 Hz) onto a canvas texture, laid flat over
 * the floor. Same color ramp as the 2D heatmap and styles/app.css - this is the one place
 * color carries meaning, per the product brief. */
export default function Heatmap3D({ densityGrid, trajectory, floorY, width, height, mode, timeRef }: Heatmap3DProps) {
  const nx = densityGrid?.nx ?? 2;
  const ny = densityGrid?.ny ?? 2;
  const canvas = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = nx;
    c.height = ny;
    return c;
  }, [nx, ny]);
  const ctx = useMemo(() => canvas.getContext('2d')!, [canvas]);
  const texture = useMemo(() => {
    const t = new THREE.CanvasTexture(canvas);
    t.minFilter = THREE.LinearFilter;
    t.magFilter = THREE.LinearFilter;
    return t;
  }, [canvas]);

  const liveFrame = useMemo(() => (trajectory ? emptyFrame(trajectory.n) : null), [trajectory]);
  const liveGrid = useMemo(() => new Float32Array(nx * ny), [nx, ny]);
  const liveTmp = useMemo(() => new Float32Array(nx * ny), [nx, ny]);
  const acc = useRef(0);

  const paint = (get: (idx: number, x: number, y: number) => number) => {
    const img = ctx.createImageData(nx, ny);
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        const idx = y * nx + x;
        const v = get(idx, x, y);
        const c = densityColor(v);
        const o = idx * 4;
        img.data[o] = Math.round(c.r * 255);
        img.data[o + 1] = Math.round(c.g * 255);
        img.data[o + 2] = Math.round(c.b * 255);
        img.data[o + 3] = v > 0.05 ? 210 : 0;
      }
    }
    ctx.putImageData(img, 0, 0);
    texture.needsUpdate = true;
  };

  useEffect(() => {
    if (mode === 'peak' && densityGrid) paint((_idx, x, y) => densityGrid.peak[y]?.[x] ?? 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, densityGrid, nx, ny]);

  useFrame((_, delta) => {
    if (mode !== 'live' || !trajectory || !liveFrame || !densityGrid) return;
    acc.current += delta;
    if (acc.current < 0.12) return;
    acc.current = 0;
    trajectory.sample(timeRef.current, liveFrame);
    computeLiveDensity(liveFrame, nx, ny, densityGrid.cell, liveGrid, liveTmp);
    paint((idx) => liveGrid[idx]);
  });

  if (mode === 'off' || !densityGrid) return null;
  return (
    <mesh position={[0, floorY + 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[width, height]} />
      <meshBasicMaterial map={texture} transparent opacity={0.82} toneMapped={false} depthWrite={false} />
    </mesh>
  );
}
