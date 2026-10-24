import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

const FLOOR_HEIGHT = 3.5;
const FLOOR_LEVELS = [0, FLOOR_HEIGHT, FLOOR_HEIGHT * 2];
const FLOOR_Z_OFFSETS = [1.3, 0, -1.3];
const BUILDING_OFFSET = -FLOOR_HEIGHT;
const HALF_WIDTH = 6.8;
const HALF_DEPTH = 4.6;
const CAMERA_POSITION = new THREE.Vector3(14, 23, 25);
const CAMERA_RIGHT = new THREE.Vector3(25, 0, -14).normalize();
const CAMERA_FOV = 36;
const PROJECTED_BUILDING_WIDTH = 18.5;
const PROJECTED_BUILDING_HEIGHT = 17.5;
const STAIR_COUNT = 14;
const STAIR_RISE = (FLOOR_HEIGHT - 0.22) / STAIR_COUNT;
const STAIR_RUN = 0.36;
const STAIR_START_Z = 2.5;

type WallAxis = 'x' | 'z';
type RouteCurve = THREE.CatmullRomCurve3;

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return reduced;
}

function GentleRig({ children, reducedMotion }: { children: ReactNode; reducedMotion: boolean }) {
  const group = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (group.current) group.current.rotation.y = reducedMotion ? 0 : Math.sin(clock.elapsedTime * 0.11) * 0.018;
  });
  return <group ref={group}>{children}</group>;
}

function Wall({
  position,
  length,
  axis = 'x',
  height = 1.98,
  color = '#87918d',
}: {
  position: [number, number, number];
  length: number;
  axis?: WallAxis;
  height?: number;
  color?: string;
}) {
  const size: [number, number, number] = axis === 'x' ? [length, height, 0.14] : [0.14, height, length];
  const capSize: [number, number, number] = axis === 'x' ? [length, 0.065, 0.2] : [0.2, 0.065, length];
  return (
    <group position={position}>
      <mesh castShadow receiveShadow>
        <boxGeometry args={size} />
        <meshStandardMaterial color={color} emissive="#151e1b" emissiveIntensity={0.34} roughness={0.9} metalness={0.03} />
      </mesh>
      <mesh position={[0, height / 2 + 0.018, 0]}>
        <boxGeometry args={capSize} />
        <meshStandardMaterial color="#7c8983" roughness={0.82} metalness={0.08} />
      </mesh>
    </group>
  );
}

function GlassPartition({ position, length, axis = 'x', height = 1.05 }: {
  position: [number, number, number];
  length: number;
  axis?: WallAxis;
  height?: number;
}) {
  const panelSize: [number, number, number] = axis === 'x' ? [length, height, 0.045] : [0.045, height, length];
  const railSize: [number, number, number] = axis === 'x' ? [length, 0.055, 0.075] : [0.075, 0.055, length];
  const postCount = Math.max(2, Math.floor(length / 1.65));
  return (
    <group position={position}>
      <mesh position={[0, height / 2, 0]}>
        <boxGeometry args={panelSize} />
        <meshPhysicalMaterial color="#29413f" emissive="#0b211e" emissiveIntensity={0.12} transparent opacity={0.25} roughness={0.24} metalness={0.2} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0, 0.055, 0]}>
        <boxGeometry args={railSize} />
        <meshStandardMaterial color="#697873" metalness={0.42} roughness={0.46} />
      </mesh>
      <mesh position={[0, height, 0]}>
        <boxGeometry args={railSize} />
        <meshStandardMaterial color="#77847d" metalness={0.44} roughness={0.42} />
      </mesh>
      {Array.from({ length: postCount + 1 }, (_, i) => {
        const offset = -length / 2 + (length * i) / postCount;
        const postPosition: [number, number, number] = axis === 'x' ? [offset, height / 2, 0] : [0, height / 2, offset];
        const postSize: [number, number, number] = axis === 'x' ? [0.035, height, 0.065] : [0.065, height, 0.035];
        return (
          <mesh key={i} position={postPosition}>
            <boxGeometry args={postSize} />
            <meshStandardMaterial color="#64716c" metalness={0.4} roughness={0.48} />
          </mesh>
        );
      })}
    </group>
  );
}

function Beam({ from, to, radius = 0.035, color = '#899694' }: {
  from: [number, number, number];
  to: [number, number, number];
  radius?: number;
  color?: string;
}) {
  const transform = useMemo(() => {
    const a = new THREE.Vector3(...from);
    const b = new THREE.Vector3(...to);
    const direction = b.clone().sub(a);
    const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.clone().normalize());
    return { center: a.add(b).multiplyScalar(0.5), length: direction.length(), quaternion };
  }, [from[0], from[1], from[2], to[0], to[1], to[2]]);
  return (
    <mesh position={transform.center} quaternion={transform.quaternion}>
      <cylinderGeometry args={[radius, radius, transform.length, 6]} />
      <meshStandardMaterial color={color} roughness={0.45} metalness={0.48} />
    </mesh>
  );
}

function WindowBay({ position, width = 1.55, height = 0.88 }: {
  position: [number, number, number];
  width?: number;
  height?: number;
}) {
  return (
    <group position={position}>
      <mesh>
        <boxGeometry args={[width, height, 0.055]} />
        <meshStandardMaterial color="#102124" emissive="#163533" emissiveIntensity={0.32} metalness={0.34} roughness={0.3} />
      </mesh>
      {[-width / 2, width / 2].map((x) => (
        <mesh key={x} position={[x, 0, 0.045]}>
          <boxGeometry args={[0.045, height + 0.09, 0.075]} />
          <meshStandardMaterial color="#a5afaa" metalness={0.42} roughness={0.4} />
        </mesh>
      ))}
      {[-height / 2, height / 2].map((y) => (
        <mesh key={y} position={[0, y, 0.045]}>
          <boxGeometry args={[width + 0.045, 0.045, 0.075]} />
          <meshStandardMaterial color="#a5afaa" metalness={0.42} roughness={0.4} />
        </mesh>
      ))}
      <mesh position={[0, 0, 0.052]}>
        <boxGeometry args={[0.025, height, 0.035]} />
        <meshStandardMaterial color="#778582" metalness={0.38} roughness={0.45} />
      </mesh>
    </group>
  );
}

function DoorFrame({ position, width = 0.94, height = 2.16 }: {
  position: [number, number, number];
  width?: number;
  height?: number;
}) {
  return (
    <group position={position}>
      <mesh position={[-width / 2 - 0.035, height / 2, 0]}>
        <boxGeometry args={[0.095, height, 0.15]} />
        <meshStandardMaterial color="#a0aaa4" metalness={0.3} roughness={0.54} />
      </mesh>
      <mesh position={[width / 2 + 0.035, height / 2, 0]}>
        <boxGeometry args={[0.095, height, 0.15]} />
        <meshStandardMaterial color="#a0aaa4" metalness={0.3} roughness={0.54} />
      </mesh>
      <mesh position={[0, height, 0]}>
        <boxGeometry args={[width + 0.18, 0.1, 0.16]} />
        <meshStandardMaterial color="#b6c0b9" metalness={0.25} roughness={0.5} />
      </mesh>
      <mesh position={[0, height / 2, -0.04]} rotation={[0, -0.16, 0]}>
        <boxGeometry args={[width - 0.08, height - 0.1, 0.035]} />
        <meshStandardMaterial color="#3d494a" emissive="#172122" emissiveIntensity={0.24} roughness={0.78} />
      </mesh>
      <mesh position={[width * 0.34, height / 2, 0.01]}>
        <boxGeometry args={[0.035, 0.11, 0.05]} />
        <meshStandardMaterial color="#d3c69a" metalness={0.6} roughness={0.36} />
      </mesh>
    </group>
  );
}

function Workstation({ position, rotation = 0 }: { position: [number, number, number]; rotation?: number }) {
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <mesh position={[0, 0.73, 0]} castShadow>
        <boxGeometry args={[1.22, 0.12, 0.72]} />
        <meshStandardMaterial color="#66523c" roughness={0.82} metalness={0.035} />
      </mesh>
      {[-0.52, 0.52].flatMap((x) => [-0.27, 0.27].map((z) => (
        <mesh key={`${x}-${z}`} position={[x, 0.36, z]}>
          <boxGeometry args={[0.055, 0.66, 0.055]} />
        <meshStandardMaterial color="#384441" metalness={0.22} roughness={0.56} />
        </mesh>
      )))}
      <mesh position={[0, 0.805, -0.22]}>
        <boxGeometry args={[0.42, 0.018, 0.2]} />
        <meshStandardMaterial color="#121a19" roughness={0.62} />
      </mesh>
      <mesh position={[0, 1.02, -0.25]}>
        <boxGeometry args={[0.39, 0.32, 0.055]} />
        <meshStandardMaterial color="#101f20" emissive="#1e6356" emissiveIntensity={0.54} roughness={0.42} metalness={0.12} />
      </mesh>
      <mesh position={[0, 0.88, -0.22]}>
        <boxGeometry args={[0.07, 0.11, 0.07]} />
        <meshStandardMaterial color="#596661" metalness={0.45} roughness={0.42} />
      </mesh>
      <mesh position={[0.22, 0.805, 0.12]}>
        <boxGeometry args={[0.36, 0.025, 0.16]} />
        <meshStandardMaterial color="#979889" roughness={0.58} />
      </mesh>
      <group position={[0.08, 0, 0.73]}>
        <mesh position={[0, 0.55, 0]}>
          <cylinderGeometry args={[0.22, 0.24, 0.11, 10]} />
          <meshStandardMaterial color="#303b3a" roughness={0.66} />
        </mesh>
        <mesh position={[0, 0.82, 0.16]}>
          <boxGeometry args={[0.34, 0.43, 0.09]} />
          <meshStandardMaterial color="#253336" roughness={0.76} />
        </mesh>
        <mesh position={[0, 0.39, 0]}>
          <cylinderGeometry args={[0.045, 0.045, 0.28, 7]} />
          <meshStandardMaterial color="#66736e" metalness={0.48} roughness={0.4} />
        </mesh>
        <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0.24, 0]}>
          <boxGeometry args={[0.45, 0.07, 0.07]} />
          <meshStandardMaterial color="#68746f" metalness={0.42} roughness={0.48} />
        </mesh>
      </group>
    </group>
  );
}

function Cabinet({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <mesh position={[0, 0.48, 0]}>
        <boxGeometry args={[0.82, 0.96, 0.48]} />
        <meshStandardMaterial color="#333f3d" roughness={0.78} metalness={0.14} />
      </mesh>
      {[0.25, 0.49, 0.73].map((y) => (
        <group key={y}>
          <mesh position={[0, y, 0.247]}>
            <boxGeometry args={[0.72, 0.018, 0.018]} />
          <meshStandardMaterial color="#78847d" metalness={0.45} roughness={0.44} />
          </mesh>
          <mesh position={[0, y + 0.065, 0.252]}>
            <boxGeometry args={[0.09, 0.025, 0.018]} />
          <meshStandardMaterial color="#a38c5e" metalness={0.38} roughness={0.48} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function Planter({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <mesh position={[0, 0.19, 0]}>
        <cylinderGeometry args={[0.2, 0.15, 0.36, 9]} />
        <meshStandardMaterial color="#51473a" roughness={0.88} />
      </mesh>
      <mesh position={[0, 0.48, 0]}>
        <cylinderGeometry args={[0.025, 0.035, 0.45, 6]} />
        <meshStandardMaterial color="#393528" roughness={0.92} />
      </mesh>
      {[
        [-0.15, 0.57, 0], [0.16, 0.64, 0.04], [0, 0.76, -0.12], [-0.04, 0.83, 0.1], [0.12, 0.91, -0.04],
      ].map(([x, y, z], i) => (
        <mesh key={i} position={[x, y, z]} scale={[0.15, 0.22, 0.13]}>
          <sphereGeometry args={[1, 7, 6]} />
          <meshStandardMaterial color={i % 2 ? '#365c45' : '#4a704f'} roughness={0.88} />
        </mesh>
      ))}
    </group>
  );
}

function StairFlight({ level, side }: { level: number; side: -1 | 1 }) {
  const x = side * 5.12;
  const width = 1.24;
  const railOffsets = [-width / 2 - 0.08, width / 2 + 0.08];
  const zEnd = STAIR_START_Z - (STAIR_COUNT - 1) * STAIR_RUN;
  return (
    <group>
      {Array.from({ length: STAIR_COUNT }, (_, i) => (
        <mesh key={i} position={[x, level + (i + 0.5) * STAIR_RISE + 0.085, STAIR_START_Z - i * STAIR_RUN]}>
          <boxGeometry args={[width, 0.17, STAIR_RUN + 0.04]} />
          <meshStandardMaterial color={i % 2 ? '#434e4b' : '#5c6862'} roughness={0.78} metalness={0.12} />
        </mesh>
      ))}
      {railOffsets.map((offset) => (
        <group key={offset}>
          <Beam
            from={[x + offset, level + 0.33, STAIR_START_Z + 0.12]}
            to={[x + offset, level + FLOOR_HEIGHT - 0.24, zEnd - 0.16]}
            radius={0.035}
            color="#83908a"
          />
          {Array.from({ length: 7 }, (_, i) => {
            const step = i * 2;
            const z = STAIR_START_Z - step * STAIR_RUN;
            const y = level + (step + 0.55) * STAIR_RISE + 0.2;
            return (
              <Beam key={i} from={[x + offset, y, z]} to={[x + offset, y + 0.46, z]} radius={0.023} color="#7c8982" />
            );
          })}
        </group>
      ))}
      <mesh position={[x, level + FLOOR_HEIGHT - 0.1, zEnd - 0.32]}>
        <boxGeometry args={[width + 0.22, 0.15, 0.62]} />
        <meshStandardMaterial color="#777f79" roughness={0.7} metalness={0.16} />
      </mesh>
    </group>
  );
}

function ExitSign({ position, danger = false }: { position: [number, number, number]; danger?: boolean }) {
  const green = '#55ffb1';
  const signColor = danger ? '#ff4044' : green;
  const letterColor = danger ? '#fff0eb' : '#e5fff1';
  const bars: Array<[number, number, number, number, number?]> = [
    [-0.31, 0, 0.035, 0.21], [-0.24, 0.09, 0.15, 0.03], [-0.24, 0, 0.14, 0.025], [-0.24, -0.09, 0.15, 0.03],
    [-0.07, 0, 0.035, 0.22, 0.72], [-0.07, 0, 0.035, 0.22, -0.72], [0.1, 0, 0.035, 0.2],
    [0.29, 0.09, 0.16, 0.03], [0.29, 0, 0.035, 0.2],
  ];
  return (
    <group position={position}>
      <mesh>
        <boxGeometry args={[0.98, 0.42, 0.085]} />
        <meshStandardMaterial color={danger ? '#7a2224' : '#0c6349'} emissive={signColor} emissiveIntensity={danger ? 1.2 : 1.05} roughness={0.38} />
      </mesh>
      {bars.map(([x, y, w, h, angle], i) => (
        <mesh key={i} position={[x, y, 0.052]} rotation={[0, 0, angle ?? 0]}>
          <boxGeometry args={[w, h, 0.026]} />
          <meshBasicMaterial color={letterColor} toneMapped={false} />
        </mesh>
      ))}
      {danger && (
        <group position={[0, -0.43, 0.07]}>
          {[0.74, -0.74].map((angle) => (
            <mesh key={angle} rotation={[0, 0, angle]}>
              <boxGeometry args={[0.58, 0.085, 0.055]} />
              <meshBasicMaterial color="#ff2b33" toneMapped={false} />
            </mesh>
          ))}
        </group>
      )}
      <pointLight position={[0, 0, 0.18]} color={signColor} intensity={danger ? 0.32 : 0.28} distance={2.6} decay={2} />
    </group>
  );
}

function HazardRubble() {
  const pieces: Array<{ p: [number, number, number]; s: [number, number, number]; r: [number, number, number] }> = [
    { p: [4.7, 0.16, 3.8], s: [0.42, 0.3, 0.34], r: [0.1, 0.4, 0.3] },
    { p: [5.2, 0.14, 3.35], s: [0.32, 0.22, 0.45], r: [0.5, 0.2, 0.1] },
    { p: [5.55, 0.14, 4.12], s: [0.5, 0.24, 0.32], r: [0.2, 0.5, 0.5] },
    { p: [6.0, 0.13, 3.45], s: [0.28, 0.2, 0.28], r: [0.4, 0.1, 0.2] },
    { p: [4.35, 0.12, 3.23], s: [0.26, 0.18, 0.3], r: [0.2, 0.7, 0.3] },
    { p: [5.8, 0.12, 4.42], s: [0.3, 0.19, 0.22], r: [0.6, 0.1, 0.5] },
    { p: [4.92, 0.13, 4.38], s: [0.22, 0.17, 0.25], r: [0.1, 0.4, 0.9] },
  ];
  return (
    <group position={[0, 0, FLOOR_Z_OFFSETS[0]]}>
      {pieces.map((piece, i) => (
        <mesh key={i} position={piece.p} scale={piece.s} rotation={piece.r}>
          <dodecahedronGeometry args={[0.5, 0]} />
          <meshStandardMaterial color={i % 2 ? '#615650' : '#7a6a5c'} roughness={0.95} />
        </mesh>
      ))}
      <mesh position={[5.3, 0.06, 3.85]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[1.05, 12]} />
        <meshBasicMaterial color="#b32c22" transparent opacity={0.19} depthWrite={false} />
      </mesh>
    </group>
  );
}

function FloorArchitecture({ level, index }: { level: number; index: number }) {
  const floorPieces: Array<[number, number, number, number]> = index === 0
    ? [[0, 0, HALF_WIDTH * 2, HALF_DEPTH * 2]]
    : index === 1
      ? [[0, -0.1, 8.4, 4.6], [0, -3.55, HALF_WIDTH * 2, 2.1], [-5.8, 0.75, 2, 4.5], [5.8, 0.75, 2, 4.5]]
      : [[0, -3.45, HALF_WIDTH * 2, 2.3], [-5.8, 0.72, 2, 4.55], [5.8, 0.72, 2, 4.55]];
  const workstations: Array<[number, number, number]> = index === 0
    ? [[-5.35, level, -2.75], [-3.15, level, -2.85], [-0.95, level, -2.9], [1.3, level, -2.8], [3.55, level, -2.75], [5.55, level, -2.7], [-5.3, level, 2.15], [-2.65, level, 2.15], [2.7, level, 2.15], [5.2, level, 2.15]]
    : index === 1
      ? [[-5.7, level, -2.85], [-3.55, level, -2.85], [3.55, level, -2.85], [5.7, level, -2.85], [-5.75, level, 2.8], [5.75, level, 2.8]]
      : [[-5.55, level, -2.85], [-3.45, level, -2.85], [-1.35, level, -2.85], [1.35, level, -2.85], [3.45, level, -2.85], [5.55, level, -2.85], [-5.8, level, 1.45], [5.8, level, 1.45]];
  const planters: Array<[number, number, number]> = index === 0
    ? [[-5.85, level, -3.4], [5.9, level, -3.5], [-5.8, level, 2.15], [3.2, level, 2.65]]
    : [[-6.1, level, -3.5], [6.1, level, -3.5], [-6.15, level, 2.6], [6.15, level, 2.5]];
  const dividers = index === 0
    ? [
      { x: -4.45, z: -1.25, length: 3.8, axis: 'x' as const }, { x: 4.45, z: -1.25, length: 3.8, axis: 'x' as const },
      { x: -2.2, z: -2.8, length: 3.0, axis: 'z' as const }, { x: 2.2, z: -2.8, length: 3.0, axis: 'z' as const },
      { x: -4.35, z: 1.55, length: 3.2, axis: 'x' as const }, { x: 4.35, z: 1.55, length: 3.2, axis: 'x' as const },
    ]
    : index === 1
      ? [
        { x: -5.65, z: -0.65, length: 3.2, axis: 'x' as const }, { x: 5.65, z: -0.65, length: 3.2, axis: 'x' as const },
        { x: -3.85, z: -2.6, length: 3.1, axis: 'z' as const }, { x: 3.85, z: -2.6, length: 3.1, axis: 'z' as const },
        { x: -5.7, z: 2.05, length: 2.1, axis: 'z' as const }, { x: 5.7, z: 2.05, length: 2.1, axis: 'z' as const },
      ]
      : [
        { x: -4.7, z: -1.15, length: 3.6, axis: 'x' as const }, { x: 4.7, z: -1.15, length: 3.6, axis: 'x' as const },
        { x: -2.45, z: -2.7, length: 3.2, axis: 'z' as const }, { x: 2.45, z: -2.7, length: 3.2, axis: 'z' as const },
        { x: 0, z: -0.6, length: 3.3, axis: 'x' as const },
        { x: -5.8, z: 1.0, length: 2.5, axis: 'z' as const }, { x: 5.8, z: 1.0, length: 2.5, axis: 'z' as const },
      ];

  return (
    <group position={[0, 0, FLOOR_Z_OFFSETS[index]]}>
      {floorPieces.map(([x, z, width, depth], pieceIndex) => (
        <group key={pieceIndex}>
          <mesh position={[x, level - 0.13, z]} receiveShadow>
            <boxGeometry args={[width, 0.26, depth]} />
            <meshStandardMaterial color={index === 1 ? '#746657' : '#738079'} emissive="#202824" emissiveIntensity={0.32} roughness={0.94} metalness={0.025} />
          </mesh>
          <mesh position={[x, level - 0.29, z]}>
            <boxGeometry args={[width + 0.14, 0.06, depth + 0.14]} />
            <meshStandardMaterial color="#303b37" emissive="#111a16" emissiveIntensity={0.24} roughness={0.88} metalness={0.05} />
          </mesh>
          {[
            { p: [x, level + 0.012, z - depth / 2], s: [width, 0.045, 0.055] },
            { p: [x, level + 0.012, z + depth / 2], s: [width, 0.045, 0.055] },
            { p: [x - width / 2, level + 0.012, z], s: [0.055, 0.045, depth] },
            { p: [x + width / 2, level + 0.012, z], s: [0.055, 0.045, depth] },
          ].map((edge, edgeIndex) => (
            <mesh key={edgeIndex} position={edge.p as [number, number, number]}>
              <boxGeometry args={edge.s as [number, number, number]} />
              <meshStandardMaterial color="#66736e" emissive="#10231f" emissiveIntensity={0.38} roughness={0.78} metalness={0.08} />
            </mesh>
          ))}
        </group>
      ))}
      {[-5.2, -1.75, 1.75, 5.2].map((x, i) => (
        <group key={x}>
          <Wall position={[x, level + 1.08, -4.51]} length={i % 3 === 0 ? 2.7 : 3.05} height={2.16} color="#52605b" />
          <WindowBay position={[x, level + 1.17, -4.42]} width={1.42} height={0.82} />
        </group>
      ))}
      {[-6.68, 6.68].map((x) => (
        <Wall key={x} position={[x, level + 1.03, -3.18]} length={2.62} axis="z" height={2.06} color="#596762" />
      ))}
      {dividers.map((wall, i) => (
        <Wall key={i} position={[wall.x, level + (index === 1 ? 0.5 : 0.52), wall.z]} length={wall.length} axis={wall.axis} height={index === 1 ? 1.02 : 1.05} color={index === 1 ? '#65564a' : '#596660'} />
      ))}
      {index === 1 && (
        <group>
          <GlassPartition position={[-3.9, level, -0.15]} length={3.4} axis="z" />
          <GlassPartition position={[3.9, level, -0.15]} length={3.4} axis="z" />
          <GlassPartition position={[0, level, -1.82]} length={7.8} axis="x" />
          <GlassPartition position={[0, level, 1.65]} length={7.8} axis="x" />
        </group>
      )}
      {[-6.08, 6.08].map((x) => (
        <DoorFrame key={x} position={[x, level, index === 0 ? 3.84 : 2.7]} width={0.92} height={2.12} />
      ))}
      {[-3.45, 3.45].map((x) => (
        <DoorFrame key={x} position={[x, level, -2.65]} width={0.82} height={1.98} />
      ))}
      {workstations.map((position, i) => (
        <Workstation key={i} position={position} rotation={i % 2 ? Math.PI : 0} />
      ))}
      {planters.map((position, i) => <Planter key={i} position={position} />)}
      {[-5.8, 5.85].map((x) => <Cabinet key={x} position={[x, level, -1.8]} />)}
      <pointLight position={[0, level + 1.85, -1.7]} color={index === 1 ? '#ffb46c' : '#d7e5dc'} intensity={0.42} distance={10} decay={1.8} />
    </group>
  );
}

function Building() {
  return (
    <group>
      {FLOOR_LEVELS.map((level, index) => <FloorArchitecture key={level} level={level} index={index} />)}
      {FLOOR_LEVELS.slice(0, 2).map((level, index) => (
        <group key={level} position={[0, 0, (FLOOR_Z_OFFSETS[index] + FLOOR_Z_OFFSETS[index + 1]) / 2]}>
          <StairFlight level={level} side={-1} />
          <StairFlight level={level} side={1} />
        </group>
      ))}
      {FLOOR_LEVELS.map((level, index) => (
        <group key={level}>
          <ExitSign position={[-6.08, level + 2.25, (index === 0 ? 4.47 : 2.7) + FLOOR_Z_OFFSETS[index]]} />
          {index === 0
            ? <ExitSign position={[6.08, level + 2.25, 4.47 + FLOOR_Z_OFFSETS[index]]} danger />
            : <ExitSign position={[6.08, level + 2.25, 2.7 + FLOOR_Z_OFFSETS[index]]} />}
        </group>
      ))}
      <HazardRubble />
      {[-6.65, 6.65].flatMap((x) => [-4.35, 0.4, 4.35].map((z) => (
        <mesh key={`${x}-${z}`} position={[x, FLOOR_HEIGHT * 1.25, z]}>
          <boxGeometry args={[0.18, FLOOR_HEIGHT * 2.5, 0.18]} />
          <meshStandardMaterial color="#687574" metalness={0.22} roughness={0.68} />
        </mesh>
      )))}
      <mesh position={[0, -0.37, FLOOR_Z_OFFSETS[0]]}>
        <boxGeometry args={[14, 0.11, 9.6]} />
        <meshStandardMaterial color="#687570" roughness={0.86} metalness={0.08} />
      </mesh>
    </group>
  );
}

function makeWalkerPoints(startFloor: number, side: -1 | 1) {
  const points: THREE.Vector3[] = [];
  const x = side * 5.12;
  let floor = startFloor;
  let level = FLOOR_LEVELS[floor];
  let floorOffset = FLOOR_Z_OFFSETS[floor];
  points.push(new THREE.Vector3(side * 3.4, level + 0.07, -3.72 + floorOffset));
  points.push(new THREE.Vector3(side * 4.35, level + 0.07, -2.75 + floorOffset));
  points.push(new THREE.Vector3(x, level + 0.07, -1.8 + floorOffset));

  while (floor > 0) {
    const lowerLevel = FLOOR_LEVELS[floor - 1];
    const stairOffset = (FLOOR_Z_OFFSETS[floor] + FLOOR_Z_OFFSETS[floor - 1]) / 2;
    for (let step = STAIR_COUNT - 1; step >= 0; step -= 1) {
      points.push(new THREE.Vector3(
        x,
        lowerLevel + (step + 0.5) * STAIR_RISE + 0.09,
        STAIR_START_Z - step * STAIR_RUN + stairOffset,
      ));
    }
    level = lowerLevel;
    floor -= 1;
    floorOffset = FLOOR_Z_OFFSETS[floor];
    if (floor > 0) {
      points.push(new THREE.Vector3(x, level + 0.07, 0.55 + floorOffset));
      points.push(new THREE.Vector3(x, level + 0.07, -0.15 + floorOffset));
      points.push(new THREE.Vector3(x, level + 0.07, -1.8 + floorOffset));
    }
  }

  if (side < 0) {
    points.push(new THREE.Vector3(-5.55, 0.08, 3.25 + FLOOR_Z_OFFSETS[0]));
    points.push(new THREE.Vector3(-6.15, 0.08, 4.1 + FLOOR_Z_OFFSETS[0]));
  } else {
    points.push(new THREE.Vector3(4.9, 0.08, 3.05 + FLOOR_Z_OFFSETS[0]));
    points.push(new THREE.Vector3(3.25, 0.08, 3.75 + FLOOR_Z_OFFSETS[0]));
    points.push(new THREE.Vector3(0, 0.08, 3.85 + FLOOR_Z_OFFSETS[0]));
    points.push(new THREE.Vector3(-3.5, 0.08, 3.8 + FLOOR_Z_OFFSETS[0]));
    points.push(new THREE.Vector3(-5.45, 0.08, 3.45 + FLOOR_Z_OFFSETS[0]));
    points.push(new THREE.Vector3(-6.15, 0.08, 4.1 + FLOOR_Z_OFFSETS[0]));
  }
  return points;
}

function makeEvacuationCurves() {
  const paths: THREE.Vector3[][] = [];
  for (let floor = 0; floor < FLOOR_LEVELS.length; floor += 1) {
    paths.push(makeWalkerPoints(floor, -1), makeWalkerPoints(floor, 1));
  }
  return paths.map((points) => new THREE.CatmullRomCurve3(points, false, 'centripetal', 0.35));
}

function EvacuationRoutes({ reducedMotion }: { reducedMotion: boolean }) {
  const curves = useMemo(makeEvacuationCurves, []);
  const flow = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const countPerCurve = 6;
  useFrame(({ clock }) => {
    const mesh = flow.current;
    if (!mesh) return;
    const time = reducedMotion ? 0 : clock.elapsedTime;
    let index = 0;
    curves.forEach((curve, routeIndex) => {
      for (let i = 0; i < countPerCurve; i += 1) {
        const point = curve.getPointAt((i / countPerCurve + time * 0.055 + routeIndex * 0.07) % 1);
        dummy.position.copy(point);
        dummy.scale.setScalar(0.82 + Math.sin(time * 4 + i + routeIndex) * 0.18);
        dummy.updateMatrix();
        mesh.setMatrixAt(index++, dummy.matrix);
      }
    });
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <group>
      {curves.map((curve, i) => (
        <group key={i}>
          <mesh>
            <tubeGeometry args={[curve, 100, 0.115, 7, false]} />
            <meshBasicMaterial color="#00ff91" transparent opacity={0.2} depthWrite={false} toneMapped={false} />
          </mesh>
          <mesh>
            <tubeGeometry args={[curve, 100, 0.047, 7, false]} />
            <meshBasicMaterial color="#37ffae" toneMapped={false} />
          </mesh>
        </group>
      ))}
      <instancedMesh ref={flow} args={[undefined as any, undefined as any, curves.length * countPerCurve]} frustumCulled={false}>
        <sphereGeometry args={[0.09, 9, 7]} />
        <meshBasicMaterial color="#e4fff3" toneMapped={false} />
      </instancedMesh>
    </group>
  );
}

function MovingOccupants({ reducedMotion }: { reducedMotion: boolean }) {
  const count = 36;
  const body = useRef<THREE.InstancedMesh>(null);
  const head = useRef<THREE.InstancedMesh>(null);
  const arms = useRef<THREE.InstancedMesh>(null);
  const leftLeg = useRef<THREE.InstancedMesh>(null);
  const rightLeg = useRef<THREE.InstancedMesh>(null);
  const curves = useMemo(makeEvacuationCurves, []);
  const walkers = useMemo(() => Array.from({ length: count }, (_, i) => ({
    route: i % curves.length,
    speed: 0.023 + ((i * 13) % 8) * 0.0024,
    offset: ((i * 37) % count) / count,
    phase: i * 1.61,
    scale: 1.02 + (i % 4) * 0.08,
  })), [curves.length]);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const armGeometry = useMemo(() => {
    const geometry = new THREE.CapsuleGeometry(0.028, 0.22, 3, 5);
    geometry.rotateZ(Math.PI / 2);
    return geometry;
  }, []);
  const legGeometry = useMemo(() => new THREE.CapsuleGeometry(0.03, 0.19, 3, 5), []);

  useFrame(({ clock }) => {
    if (!body.current || !head.current || !arms.current || !leftLeg.current || !rightLeg.current) return;
    const time = reducedMotion ? 0 : clock.elapsedTime;
    walkers.forEach((walker, i) => {
      const curve = curves[walker.route];
      const progress = (walker.offset + time * walker.speed) % 1;
      const point = curve.getPointAt(progress);
      const tangent = curve.getTangentAt(progress);
      const angle = Math.atan2(tangent.x, tangent.z);
      const stride = reducedMotion ? 0 : Math.sin(time * 8 + walker.phase) * 0.045;
      const bob = reducedMotion ? 0 : Math.sin(time * 8 + walker.phase) * 0.018;

      dummy.position.set(point.x, point.y + 0.29 * walker.scale + bob, point.z);
      dummy.rotation.set(0, angle, 0);
      dummy.scale.setScalar(walker.scale);
      dummy.updateMatrix();
      body.current!.setMatrixAt(i, dummy.matrix);

      dummy.position.set(point.x, point.y + 0.64 * walker.scale + bob, point.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.setScalar(walker.scale * 0.86);
      dummy.updateMatrix();
      head.current!.setMatrixAt(i, dummy.matrix);

      dummy.position.set(point.x, point.y + 0.33 * walker.scale + bob, point.z);
      dummy.rotation.set(0, angle, 0);
      dummy.scale.setScalar(walker.scale);
      dummy.updateMatrix();
      arms.current!.setMatrixAt(i, dummy.matrix);

      dummy.position.set(point.x - Math.cos(angle) * 0.06, point.y + 0.13 * walker.scale + stride, point.z + Math.sin(angle) * 0.06);
      dummy.rotation.set(0, angle, -0.15 + stride * 2);
      dummy.scale.setScalar(walker.scale);
      dummy.updateMatrix();
      leftLeg.current!.setMatrixAt(i, dummy.matrix);

      dummy.position.set(point.x + Math.cos(angle) * 0.06, point.y + 0.13 * walker.scale - stride, point.z - Math.sin(angle) * 0.06);
      dummy.rotation.set(0, angle, 0.15 - stride * 2);
      dummy.updateMatrix();
      rightLeg.current!.setMatrixAt(i, dummy.matrix);
    });
    [body.current, head.current, arms.current, leftLeg.current, rightLeg.current].forEach((mesh) => {
      mesh!.instanceMatrix.needsUpdate = true;
    });
  });

  return (
    <group>
      <instancedMesh ref={body} args={[undefined as any, undefined as any, count]} frustumCulled={false}>
        <capsuleGeometry args={[0.075, 0.28, 4, 7]} />
        <meshBasicMaterial color="#87ffd0" toneMapped={false} />
      </instancedMesh>
      <instancedMesh ref={head} args={[undefined as any, undefined as any, count]} frustumCulled={false}>
        <sphereGeometry args={[0.083, 9, 8]} />
        <meshBasicMaterial color="#f0fff8" toneMapped={false} />
      </instancedMesh>
      <instancedMesh ref={arms} args={[armGeometry, undefined as any, count]} frustumCulled={false}>
        <meshBasicMaterial color="#9affd6" toneMapped={false} />
      </instancedMesh>
      <instancedMesh ref={leftLeg} args={[legGeometry, undefined as any, count]} frustumCulled={false}>
        <meshBasicMaterial color="#7fffc9" toneMapped={false} />
      </instancedMesh>
      <instancedMesh ref={rightLeg} args={[legGeometry, undefined as any, count]} frustumCulled={false}>
        <meshBasicMaterial color="#7fffc9" toneMapped={false} />
      </instancedMesh>
    </group>
  );
}

function FireFlameField({ reducedMotion }: { reducedMotion: boolean }) {
  const fire = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 256;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D is unavailable for the hero fire effect.');
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    return { canvas, context, texture };
  }, []);
  const lastStaticDraw = useRef(false);
  useEffect(() => () => fire.texture.dispose(), [fire]);

  useFrame(({ clock }) => {
    if (reducedMotion && lastStaticDraw.current) return;
    lastStaticDraw.current = reducedMotion;
    const { canvas, context } = fire;
    const width = canvas.width;
    const height = canvas.height;
    const time = reducedMotion ? 0 : clock.elapsedTime;
    context.clearRect(0, 0, width, height);
    context.globalCompositeOperation = 'lighter';

    const glow = context.createRadialGradient(width * 0.5, height * 0.92, 3, width * 0.5, height * 0.92, width * 0.46);
    glow.addColorStop(0, 'rgba(255, 186, 48, 0.36)');
    glow.addColorStop(0.48, 'rgba(255, 70, 12, 0.22)');
    glow.addColorStop(1, 'rgba(160, 20, 4, 0)');
    context.fillStyle = glow;
    context.fillRect(0, 0, width, height);

    const drawTongue = (index: number, core: boolean) => {
      const seed = index * 31.73 + (core ? 13.2 : 0);
      const unit = (n: number) => (Math.sin(n * 127.1 + 311.7) * 43758.5453) % 1;
      const center = ((Math.sin(seed * 1.7) + 1) * 0.5) * (width - 30) + 15;
      const phase = reducedMotion ? 0 : time * (1.2 + (index % 5) * 0.16) + seed;
      const sway = reducedMotion ? 0 : Math.sin(phase * 1.3) * 12 + Math.sin(phase * 0.57) * 7;
      const flameWidth = (core ? 15 : 23) + Math.abs(unit(seed)) * (core ? 13 : 27);
      const flameHeight = (core ? 72 : 86) + Math.abs(unit(seed + 8.8)) * (core ? 68 : 122);
      const lift = reducedMotion ? 0 : (Math.sin(phase * 1.8) + 1) * 6;
      const baseY = height + 11 + lift;
      const tipY = baseY - flameHeight;
      const tipX = center + sway + (reducedMotion ? 0 : Math.sin(phase * 0.8) * 13);
      const alpha = core ? 0.78 : 0.56;
      const gradient = context.createLinearGradient(0, baseY, 0, tipY);
      if (core) {
        gradient.addColorStop(0, `rgba(255, 249, 166, ${alpha})`);
        gradient.addColorStop(0.3, `rgba(255, 211, 72, ${alpha * 0.94})`);
        gradient.addColorStop(0.72, `rgba(255, 116, 22, ${alpha * 0.76})`);
        gradient.addColorStop(1, 'rgba(255, 72, 11, 0)');
      } else {
        gradient.addColorStop(0, `rgba(255, 235, 102, ${alpha})`);
        gradient.addColorStop(0.24, `rgba(255, 153, 28, ${alpha})`);
        gradient.addColorStop(0.72, `rgba(239, 57, 8, ${alpha * 0.82})`);
        gradient.addColorStop(1, 'rgba(140, 17, 4, 0)');
      }

      context.beginPath();
      context.moveTo(center - flameWidth, baseY);
      context.bezierCurveTo(center - flameWidth * 1.12, baseY - flameHeight * 0.16, center - flameWidth * 0.52, tipY + flameHeight * 0.42, tipX - flameWidth * 0.2, tipY + flameHeight * 0.31);
      context.bezierCurveTo(tipX - flameWidth * 0.42, tipY + flameHeight * 0.19, tipX - flameWidth * 0.1, tipY + flameHeight * 0.11, tipX, tipY);
      context.bezierCurveTo(tipX + flameWidth * 0.12, tipY + flameHeight * 0.14, tipX + flameWidth * 0.34, tipY + flameHeight * 0.23, tipX + flameWidth * 0.13, tipY + flameHeight * 0.38);
      context.bezierCurveTo(center + flameWidth * 0.56, tipY + flameHeight * 0.57, center + flameWidth * 1.15, baseY - flameHeight * 0.18, center + flameWidth, baseY);
      context.closePath();
      context.fillStyle = gradient;
      context.shadowColor = core ? 'rgba(255, 170, 32, 0.75)' : 'rgba(255, 70, 10, 0.55)';
      context.shadowBlur = core ? 13 : 18;
      context.fill();
    };

    for (let i = 0; i < 18; i += 1) drawTongue(i, false);
    for (let i = 0; i < 13; i += 1) drawTongue(i + 2, true);
    context.globalCompositeOperation = 'source-over';
    context.shadowBlur = 0;
    fire.texture.needsUpdate = true;
  });

  return (
    <group>
      <mesh position={[0, FLOOR_HEIGHT + 1.15, 0.15]}>
        <planeGeometry args={[8.4, 2.3]} />
        <meshBasicMaterial map={fire.texture} transparent opacity={0.9} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0, FLOOR_HEIGHT + 0.98, -0.25]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[3.8, 1.95]} />
        <meshBasicMaterial map={fire.texture} color="#ffb15b" transparent opacity={0.52} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}
function FireParticles({ reducedMotion }: { reducedMotion: boolean }) {
  const smoke = useRef<THREE.InstancedMesh>(null);
  const embers = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const count = 36;
  useFrame(({ clock }) => {
    if (!smoke.current || !embers.current) return;
    const time = reducedMotion ? 0 : clock.elapsedTime;
    for (let i = 0; i < count; i += 1) {
      const phase = reducedMotion ? ((i * 11) % count) / count : (time * (0.085 + (i % 5) * 0.012) + i / count) % 1;
      const sourceX = ((i * 7) % 13 - 6) * 0.42;
      const sourceZ = ((i * 11) % 9 - 4) * 0.3;
      const driftX = reducedMotion ? 0 : Math.sin(time * 0.62 + i) * phase * 0.36;
      const driftZ = reducedMotion ? 0 : Math.cos(time * 0.71 + i) * phase * 0.24;
      dummy.position.set(sourceX + driftX, FLOOR_HEIGHT + 0.3 + phase * 2.15, sourceZ + 1.25 + driftZ);
      const puff = 0.42 + phase * 0.78;
      dummy.scale.set(puff, puff * 1.28, puff * 0.9);
      dummy.updateMatrix();
      smoke.current.setMatrixAt(i, dummy.matrix);

      const emberPhase = reducedMotion ? ((i * 17) % count) / count : (time * (0.18 + (i % 6) * 0.02) + i / count) % 1;
      dummy.position.set(sourceX + Math.sin(time * 1.8 + i) * 0.42, FLOOR_HEIGHT + 0.2 + emberPhase * 1.7, sourceZ + 0.45 + Math.cos(time * 1.6 + i) * 0.32);
      dummy.scale.setScalar(0.7 + Math.sin(time * 4.5 + i) * 0.13);
      dummy.updateMatrix();
      embers.current.setMatrixAt(i, dummy.matrix);
    }
    smoke.current.instanceMatrix.needsUpdate = true;
    embers.current.instanceMatrix.needsUpdate = true;
  });
  return (
    <group>
      <instancedMesh ref={smoke} args={[undefined as any, undefined as any, count]} frustumCulled={false}>
        <sphereGeometry args={[0.5, 14, 12]} />
        <meshBasicMaterial color="#99988f" transparent opacity={0.14} depthWrite={false} />
      </instancedMesh>
      <instancedMesh ref={embers} args={[undefined as any, undefined as any, count]} frustumCulled={false}>
        <sphereGeometry args={[0.095, 8, 7]} />
        <meshBasicMaterial color="#ffb13e" toneMapped={false} />
      </instancedMesh>
    </group>
  );
}

function Fire({ reducedMotion }: { reducedMotion: boolean }) {
  const light = useRef<THREE.PointLight>(null);
  useFrame(({ clock }) => {
    if (light.current) light.current.intensity = reducedMotion ? 2.6 : 3 + Math.sin(clock.elapsedTime * 7.2) * 0.48 + Math.sin(clock.elapsedTime * 11.8) * 0.2;
  });
  return (
    <group>
      <mesh position={[0, FLOOR_HEIGHT + 0.012, -0.05]} rotation={[-Math.PI / 2, 0, 0]} scale={[4.25, 1.8, 1]}>
        <circleGeometry args={[1, 40]} />
        <meshBasicMaterial color="#e94612" toneMapped={false} transparent opacity={0.16} depthWrite={false} />
      </mesh>
      <mesh position={[0, FLOOR_HEIGHT + 0.021, -0.05]} rotation={[-Math.PI / 2, 0, 0]} scale={[3.15, 1.28, 1]}>
        <circleGeometry args={[1, 36]} />
        <meshBasicMaterial color="#ff9c24" toneMapped={false} transparent opacity={0.17} depthWrite={false} />
      </mesh>
      <FireFlameField reducedMotion={reducedMotion} />
      <FireParticles reducedMotion={reducedMotion} />
      <pointLight ref={light} position={[0, FLOOR_HEIGHT + 0.85, -0.1]} color="#ff6429" intensity={3} distance={13} decay={1.55} />
    </group>
  );
}

function Scene({ reducedMotion }: { reducedMotion: boolean }) {
  const { size } = useThree();
  const inset = size.width < 760 ? 10 : 16;
  const visualLeft = inset;
  const visualRight = size.width - inset;
  const visualWidth = Math.max(32, visualRight - visualLeft);
  const pixelsPerUnit = size.height / (2 * CAMERA_POSITION.length() * Math.tan(THREE.MathUtils.degToRad(CAMERA_FOV / 2)));
  const sceneScale = Math.min(
    1.5,
    visualWidth * 0.94 / (PROJECTED_BUILDING_WIDTH * pixelsPerUnit),
    size.height * 0.82 / (PROJECTED_BUILDING_HEIGHT * pixelsPerUnit),
  );
  const visualCenter = (visualLeft + visualRight) / 2;
  const rightShift = (visualCenter - size.width / 2) / pixelsPerUnit;

  return (
    <GentleRig reducedMotion={reducedMotion}>
      <group position={[
        CAMERA_RIGHT.x * rightShift,
        BUILDING_OFFSET * sceneScale,
        CAMERA_RIGHT.z * rightShift,
      ]} scale={[sceneScale * 1.18, sceneScale, sceneScale]}>
        <Building />
        <EvacuationRoutes reducedMotion={reducedMotion} />
        <MovingOccupants reducedMotion={reducedMotion} />
        <Fire reducedMotion={reducedMotion} />
      </group>
    </GentleRig>
  );
}

export default function HeroScene() {
  const reducedMotion = useReducedMotion();
  return (
    <Canvas
      shadows
      dpr={[1, 1.35]}
      camera={{ position: [CAMERA_POSITION.x, CAMERA_POSITION.y, CAMERA_POSITION.z], fov: CAMERA_FOV }}
      gl={{ antialias: true, powerPreference: 'low-power' }}
      style={{ pointerEvents: 'none' }}
    >
      <color attach="background" args={['#030506']} />
      <fog attach="fog" args={['#030506', 38, 72]} />
      <hemisphereLight args={['#e8f3ed', '#4a5650', 1.05]} />
      <ambientLight intensity={0.56} />
      <directionalLight
        position={[7, 18, 15]}
        intensity={1.65}
        color="#ffe9d0"
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-camera-near={0.5}
        shadow-camera-far={48}
      />
      <directionalLight position={[-13, 12, 7]} intensity={0.56} color="#bfd5d4" />
      <directionalLight position={[3, 8, -15]} intensity={0.34} color="#b8c9c5" />
      <Scene reducedMotion={reducedMotion} />
    </Canvas>
  );
}

