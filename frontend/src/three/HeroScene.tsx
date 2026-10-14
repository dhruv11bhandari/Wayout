import { Suspense, useMemo, useRef } from 'react';
import type { ReactNode } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';

/** Purely decorative - no simulation data. A small 3-floor massing with a handful of
 * capsules drifting on loops, slowly auto-orbited. Kept deliberately simple/cheap since
 * it renders behind hero text on the landing page, not as an analysis tool. */
function DriftingPeople({ count = 16 }: { count?: number }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const paths = useMemo(
    () => Array.from({ length: count }, () => ({
      radius: 3 + Math.random() * 6.5,
      speed: 0.12 + Math.random() * 0.22,
      offset: Math.random() * Math.PI * 2,
      y: 0.3 + Math.floor(Math.random() * 3) * 2.6,
    })),
    [count],
  );
  const dummy = useMemo(() => new THREE.Object3D(), []);
  useFrame(({ clock }) => {
    const mesh = ref.current;
    if (!mesh) return;
    const t = clock.getElapsedTime();
    paths.forEach((p, i) => {
      const a = p.offset + t * p.speed;
      dummy.position.set(Math.cos(a) * p.radius, p.y, Math.sin(a) * p.radius * 0.55);
      dummy.rotation.set(0, -a, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  });
  return (
    <instancedMesh ref={ref} args={[undefined as any, undefined as any, count]} frustumCulled={false}>
      <capsuleGeometry args={[0.13, 0.3, 4, 8]} />
      <meshStandardMaterial color="#3fc1d6" roughness={0.4} />
    </instancedMesh>
  );
}

function Massing() {
  const floors = 3;
  const fh = 2.6;
  const w = 13;
  const d = 9;
  return (
    <group position={[0, -fh * 1.1, 0]}>
      {Array.from({ length: floors }, (_, i) => (
        <group key={i} position={[0, i * fh, 0]}>
          <mesh position={[0, -0.05, 0]} receiveShadow>
            <boxGeometry args={[w, 0.1, d]} />
            <meshStandardMaterial color="#131313" roughness={0.92} />
          </mesh>
          <mesh position={[-w / 2, fh / 2, 0]} castShadow receiveShadow>
            <boxGeometry args={[0.16, fh, d]} />
            <meshStandardMaterial color="#c9c9c4" roughness={0.75} transparent opacity={0.9} />
          </mesh>
          <mesh position={[w / 2, fh / 2, 0]} castShadow receiveShadow>
            <boxGeometry args={[0.16, fh, d]} />
            <meshStandardMaterial color="#c9c9c4" roughness={0.75} transparent opacity={0.9} />
          </mesh>
          <mesh position={[0, fh / 2, -d / 2]} castShadow receiveShadow>
            <boxGeometry args={[w, fh, 0.16]} />
            <meshStandardMaterial color="#c9c9c4" roughness={0.75} transparent opacity={0.9} />
          </mesh>
          <mesh position={[0, fh / 2, d / 2]} castShadow receiveShadow>
            <boxGeometry args={[w, fh, 0.16]} />
            <meshStandardMaterial color="#c9c9c4" roughness={0.75} transparent opacity={0.9} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function RotatingRig({ children }: { children: ReactNode }) {
  const group = useRef<THREE.Group>(null);
  useFrame((_, delta) => {
    if (group.current) group.current.rotation.y += delta * 0.05;
  });
  return <group ref={group}>{children}</group>;
}

export default function HeroScene() {
  return (
    <Canvas shadows dpr={[1, 1.6]} camera={{ position: [15, 10.5, 17], fov: 38 }} gl={{ antialias: true }}>
      <color attach="background" args={['#000000']} />
      <fog attach="fog" args={['#000000', 20, 44]} />
      <ambientLight intensity={0.5} />
      <directionalLight position={[13, 19, 9]} intensity={1.2} castShadow shadow-mapSize={[1024, 1024]} />
      <directionalLight position={[-10, 8, -12]} intensity={0.22} color="#8fb0ff" />
      <Suspense fallback={null}>
        <RotatingRig>
          <Massing />
          <DriftingPeople />
        </RotatingRig>
      </Suspense>
    </Canvas>
  );
}
