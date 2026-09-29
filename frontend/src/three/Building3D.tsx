import { useMemo } from 'react';
import { Html } from '@react-three/drei';
import type { FloorBuilding } from '../types';
import { COLORS, WALL_HEIGHT, wallGeom } from './scene-utils';

interface Building3DProps {
  building: FloorBuilding;
  floorY: number;
  opacity?: number;
  showLabels?: boolean;
  selectedExit?: string | null;
  onSelectExit?: (id: string) => void;
}

/** Extrudes the real floor-plan geometry (walls, obstacles, exits/stairs) the backend
 * generated for this floor. Plan (x, y) -> world (x - width/2, y - height/2); a wall's
 * local +X axis (its length) is rotated to world angle -atan2(dy, dx) so it lies along
 * the segment (x1,y1)-(x2,y2) - see wallGeom(). No Blender/GLB assets: this sandbox has
 * no Blender or GPU to author/export them, so geometry is procedural boxes/planes, kept
 * simple and instanced where it matters (agents) for performance. */
export default function Building3D({
  building, floorY, opacity = 1, showLabels = true, selectedExit = null, onSelectExit = () => {},
}: Building3DProps) {
  const ox = -building.width / 2;
  const oz = -building.height / 2;
  const transparent = opacity < 0.999;

  const walls = useMemo(
    () =>
      building.walls.map((w, i) => {
        const g = wallGeom(w.x1, w.y1, w.x2, w.y2);
        return { key: `w${i}`, ...g, thickness: w.thickness || 0.18 };
      }),
    [building.walls],
  );

  return (
    <group position={[0, floorY, 0]}>
      <mesh position={[0, -0.06, 0]} receiveShadow>
        <boxGeometry args={[building.width, 0.12, building.height]} />
        <meshStandardMaterial
          color={building.role === 'ground' ? COLORS.floorGround : COLORS.floor}
          transparent={transparent} opacity={opacity} roughness={0.92} metalness={0.02}
        />
      </mesh>
      <gridHelper
        args={[Math.max(building.width, building.height) * 1.05, Math.round(Math.max(building.width, building.height) / 2), COLORS.grid, COLORS.grid]}
        position={[0, 0.002, 0]}
      />

      {walls.map((w) => (
        <mesh key={w.key} position={[ox + w.cx, WALL_HEIGHT / 2, oz + w.cy]} rotation={[0, -w.angle, 0]} castShadow receiveShadow>
          <boxGeometry args={[w.length, WALL_HEIGHT, w.thickness]} />
          <meshStandardMaterial color={COLORS.wall} transparent={transparent} opacity={opacity} roughness={0.72} />
        </mesh>
      ))}

      {building.obstacles.map((o) => (
        <mesh key={o.id} position={[ox + o.x + o.width / 2, 0.5, oz + o.y + o.height / 2]} castShadow>
          <boxGeometry args={[Math.max(o.width, 0.1), 1.0, Math.max(o.height, 0.1)]} />
          <meshStandardMaterial color={COLORS.obstacle} transparent={transparent} opacity={opacity} roughness={0.85} />
        </mesh>
      ))}

      {building.exits.map((e) => {
        const onHorizontalWall = e.orientation === 'N' || e.orientation === 'S';
        const color = e.blocked ? COLORS.exitBlocked : building.role === 'ground' ? COLORS.exit : COLORS.stair;
        const sel = selectedExit === e.id;
        return (
          <group key={e.id} position={[ox + e.x, 0.04, oz + e.y]}>
            <mesh
              rotation={[-Math.PI / 2, 0, 0]}
              onClick={(ev) => { ev.stopPropagation(); onSelectExit(e.id); }}
              onPointerOver={(ev) => { ev.stopPropagation(); document.body.style.cursor = 'pointer'; }}
              onPointerOut={() => { document.body.style.cursor = 'auto'; }}
            >
              <planeGeometry args={onHorizontalWall ? [e.width, 0.9] : [0.9, e.width]} />
              <meshBasicMaterial color={color} transparent opacity={sel ? 0.95 : 0.6} toneMapped={false} />
            </mesh>
            {building.role !== 'ground' && (
              <mesh position={[0, WALL_HEIGHT / 2, 0]}>
                <boxGeometry args={[0.5, WALL_HEIGHT, 0.5]} />
                <meshStandardMaterial color={COLORS.stair} transparent opacity={0.14} depthWrite={false} />
              </mesh>
            )}
            {showLabels && (
              <Html center distanceFactor={26} style={{ pointerEvents: 'none' }} occlude={false}>
                <div
                  style={{
                    fontFamily: 'IBM Plex Mono, monospace', fontSize: 11, color: '#fff',
                    background: 'rgba(0,0,0,.74)', padding: '3px 7px', borderRadius: 3,
                    border: `1px solid ${color}`, whiteSpace: 'nowrap',
                  }}
                >
                  {e.label}
                </div>
              </Html>
            )}
          </group>
        );
      })}
    </group>
  );
}
