import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import type { CameraPresetT } from './scene-utils';

interface CameraRigProps {
  preset: CameraPresetT;
  focusFloor: number;
  floorHeight: number;
  radius: number; // half-diagonal-ish extent of the building footprint
}

/** Orbit / top / iso / per-floor-focus presets, with a ~0.9s smoothed transition. After
 * that window the rig gets out of the way entirely so OrbitControls' own drag/zoom/pan
 * stay fully free - it does not fight the user's manual camera work at rest. */
export default function CameraRig({ preset, focusFloor, floorHeight, radius }: CameraRigProps) {
  const controls = useRef<any>(null);
  const { camera } = useThree();
  const desiredPos = useRef(new THREE.Vector3(radius * 1.3, radius * 1.05, radius * 1.5));
  const desiredTarget = useRef(new THREE.Vector3(0, floorHeight, 0));
  const transitionUntil = useRef(0);

  useEffect(() => {
    const y = focusFloor * floorHeight + floorHeight * 0.5;
    if (preset === 'top') {
      desiredPos.current.set(0.001, radius * 2.7, 0.001);
      desiredTarget.current.set(0, y, 0);
    } else if (preset === 'iso') {
      desiredPos.current.set(radius * 1.15, radius * 1.35, radius * 1.15);
      desiredTarget.current.set(0, y, 0);
    } else if (preset === 'floor') {
      desiredPos.current.set(radius * 0.6, y + floorHeight * 0.65, radius * 0.95);
      desiredTarget.current.set(0, y, 0);
    } else {
      desiredPos.current.set(radius * 1.3, radius * 1.05, radius * 1.5);
      desiredTarget.current.set(0, floorHeight, 0);
    }
    transitionUntil.current = performance.now() + 900;
  }, [preset, focusFloor, floorHeight, radius]);

  useFrame(() => {
    if (performance.now() < transitionUntil.current) {
      camera.position.lerp(desiredPos.current, 0.09);
      if (controls.current) controls.current.target.lerp(desiredTarget.current, 0.09);
    }
    controls.current?.update();
  });

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping
      dampingFactor={0.08}
      minDistance={Math.max(2, radius * 0.3)}
      maxDistance={radius * 4.2}
      maxPolarAngle={Math.PI * 0.49}
    />
  );
}
