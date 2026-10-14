import { useEffect, useMemo, useRef } from 'react';
import type { MutableRefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { Trajectory, emptyFrame } from '../utils/playback';
import { AGENT_STATE_COLOR } from './scene-utils';

interface Agents3DProps {
  trajectory: Trajectory | null;
  floorY: number;
  ox: number; // -building.width / 2
  oz: number; // -building.height / 2
  timeRef: MutableRefObject<number>;
  visible: boolean;
}

const CAPSULE_R = 0.24;
const CAPSULE_LEN = 0.5;
const dummy = new THREE.Object3D();
const col = new THREE.Color();

/** One InstancedMesh per floor, driven every frame from that floor's real recorded
 * trajectory - not a separate animation. Agents "disappear" into a stair the instant
 * they exit that floor's simulation and "appear" again on the floor below at exactly the
 * spawn_time the multi-floor orchestrator computed for them (see multi_floor.py); nothing
 * here interpolates across that gap, because the two floors are two different simulation
 * runs and interpolating between them would be inventing motion that was never simulated. */
export default function Agents3D({ trajectory, floorY, ox, oz, timeRef, visible }: Agents3DProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const n = trajectory?.n ?? 0;
  const frame = useMemo(() => (trajectory ? emptyFrame(trajectory.n) : null), [trajectory]);

  useEffect(() => {
    if (meshRef.current) meshRef.current.count = n;
  }, [n]);

  useFrame(() => {
    const mesh = meshRef.current;
    if (!trajectory || !frame || !mesh || !visible) return;
    trajectory.sample(timeRef.current, frame);
    for (let i = 0; i < n; i++) {
      if (!frame.visible[i]) {
        dummy.position.set(0, -500, 0);
        dummy.scale.setScalar(0.0001);
      } else {
        dummy.position.set(ox + frame.x[i], floorY + CAPSULE_LEN / 2 + CAPSULE_R + 0.02, oz + frame.y[i]);
        const s = (frame.r[i] || CAPSULE_R) / CAPSULE_R;
        dummy.scale.set(s, s, s);
      }
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      col.set(AGENT_STATE_COLOR[frame.state[i]] ?? AGENT_STATE_COLOR[1]);
      mesh.setColorAt(i, col);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  });

  if (!trajectory) return null;
  return (
    <instancedMesh
      ref={meshRef}
      args={[undefined as any, undefined as any, Math.max(1, trajectory.n)]}
      visible={visible}
      castShadow
      frustumCulled={false}
    >
      <capsuleGeometry args={[CAPSULE_R, CAPSULE_LEN, 4, 8]} />
      <meshStandardMaterial roughness={0.55} metalness={0.08} />
    </instancedMesh>
  );
}
