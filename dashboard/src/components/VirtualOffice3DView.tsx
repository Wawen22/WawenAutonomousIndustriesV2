// ============================================================
// WAI Dashboard – Virtual Office 3D v3 (premium redesign)
// Three.js + React Three Fiber — immersive 3D agent office
// ============================================================

import { useRef, useState, useEffect, useMemo, useCallback, Suspense, memo } from 'react'
import * as THREE from 'three'
import { Canvas, useFrame } from '@react-three/fiber'
import type { ThreeEvent } from '@react-three/fiber'
import { OrbitControls, Html, Grid } from '@react-three/drei'
import { clsx } from 'clsx'
import { useAgents, useAgentStats, useTasks, useEventsWithContext } from '../hooks/useSupabaseRealtime.js'
import type { Agent, AgentTeam, AgentRun, Task, SystemEventWithContext } from '../types/index.js'

// ===========================================================================
// CONSTANTS
// ===========================================================================

const TEAM_COLORS: Record<AgentTeam, string> = {
  executive:  '#00D4FF',
  saas:       '#818CF8',
  dev:        '#34D399',
  consulting: '#22D3EE',
  marketing:  '#FBBF24',
  ops:        '#94A3B8',
}

// CEO desk is now in the Executive Suite, right next to Neb
const DESK_XZ: Record<string, [number, number]> = {
  // Executive Suite — Neb corner is at [-22, -11]; CEO is adjacent
  ceo:                  [-17,  -11],
  // Consulting (left column)
  consulting_lead:      [-22,   -5],
  analyst:              [-22,   -1],
  // SaaS (center-upper 2×2)
  pm_saas:              [-14,   -8],
  dev_lead_saas:        [-10,   -8],
  dev_saas_1:           [-14,   -4],
  dev_saas_2:           [-10,   -4],
  // Dev (center-lower 2×2)
  architect:            [-14,    0],
  dev_general_1:        [-10,    0],
  dev_general_2:        [-14,    4],
  qa:                   [-10,    4],
  // Ops / Finance / HR (far-left column)
  ops:                  [-22,    3],
  finance:              [-22,    7],
  hr:                   [-22,   11],
  // Marketing (bottom row)
  marketing_strategist: [-14,   11],
  content_creator:      [-10,   11],
  social_manager:       [ -6,   11],
}

// Idle waypoints — meeting zone (right-top)
const MEETING_WPS: [number, number][] = [
  [ 6, -10], [ 9, -11], [12, -11], [15, -10],
  [ 7,  -7], [14,  -7], [10, -13],
]

// Idle waypoints — lounge zone (right-bottom)
const LOUNGE_WPS: [number, number][] = [
  [ 5, 5], [ 9, 5], [13, 5], [17, 5],
  [ 5, 9], [ 9, 9], [13, 9], [17, 9],
  [ 7,13], [12,13], [16,13],
]

// ===========================================================================
// TYPES / HELPERS
// ===========================================================================

type ActivityState = 'working' | 'idle_desk' | 'idle_lounge' | 'idle_meeting' | 'offline' | 'error'

/**
 * Determines an agent's visual activity state.
 * Priority order: working > error > offline > idle_desk > idle_meeting/lounge
 *
 * IMPORTANT: we derive 'working' from BOTH agent.status AND hasActiveTask so
 * that avatars react even when the OpenClaw runtime only updates the `tasks`
 * table (setting status='in_progress') without touching `agents.status`.
 */
function getActivity(agent: Agent, hasActiveTask = false): ActivityState {
  if (agent.status === 'busy' || hasActiveTask) return 'working'
  if (agent.status === 'error')   return 'error'
  if (agent.status === 'offline') return 'offline'
  // CEO always stays at his desk — he directs, doesn't roam
  if (agent.id === 'ceo') return 'idle_desk'
  const hash = agent.id.split('').reduce((a, c) => a + c.charCodeAt(0), 0)
  return hash % 3 === 0 ? 'idle_meeting' : 'idle_lounge'
}

function getDeskPos(agentId: string): THREE.Vector3 {
  const xz = DESK_XZ[agentId] ?? [-6, 11]
  return new THREE.Vector3(xz[0], 0, xz[1])
}

function pickBaseWaypoint(activity: ActivityState, idx: number): THREE.Vector3 {
  if (activity === 'idle_meeting') {
    const wp = MEETING_WPS[idx % MEETING_WPS.length]!
    return new THREE.Vector3(wp[0], 0, wp[1])
  }
  const wp = LOUNGE_WPS[idx % LOUNGE_WPS.length]!
  return new THREE.Vector3(wp[0], 0, wp[1])
}

function wanderAround(base: THREE.Vector3, r = 2.2): THREE.Vector3 {
  return new THREE.Vector3(
    base.x + (Math.random() - 0.5) * r * 2,
    0,
    base.z + (Math.random() - 0.5) * r * 2,
  )
}

// ===========================================================================
// FLOOR
// ===========================================================================

function OfficeFloor() {
  return (
    <>
      {/* Base plane — medium dark navy, clearly different from desk surface */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[-3, -0.02, 0]} receiveShadow>
        <planeGeometry args={[64, 38]} />
        <meshStandardMaterial color="#0a1828" roughness={0.88} />
      </mesh>

      {/* Cyber grid — bright enough to see */}
      <Grid
        position={[-3, 0.001, 0]}
        args={[64, 38]}
        cellSize={1}
        cellThickness={0.6}
        cellColor="#1e3655"
        sectionSize={4}
        sectionThickness={1.2}
        sectionColor="#2a507a"
        fadeDistance={60}
        fadeStrength={1.0}
        infiniteGrid={false}
      />

      {/* Executive Suite tint — amber */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[-19.5, 0.003, -11.5]}>
        <planeGeometry args={[9, 8]} />
        <meshStandardMaterial
          color="#1e1000" transparent opacity={0.65}
          emissive={new THREE.Color('#FBBF24')} emissiveIntensity={0.07}
        />
      </mesh>

      {/* Desk zone — cool blue */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[-13, 0.003, 1.5]}>
        <planeGeometry args={[16, 26]} />
        <meshStandardMaterial color="#010d1f" transparent opacity={0.55} />
      </mesh>

      {/* Meeting zone — violet */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[11, 0.003, -8]}>
        <planeGeometry args={[22, 14]} />
        <meshStandardMaterial color="#0b0820" transparent opacity={0.5} />
      </mesh>

      {/* Lounge zone — warm */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[11, 0.003, 8]}>
        <planeGeometry args={[22, 14]} />
        <meshStandardMaterial color="#120b00" transparent opacity={0.5} />
      </mesh>

      {/* Neon divider — vertical (desk | right zones) */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[-1, 0.008, 0]}>
        <planeGeometry args={[0.08, 36]} />
        <meshStandardMaterial
          color="#00D4FF" emissive={new THREE.Color('#00D4FF')}
          emissiveIntensity={1.2} transparent opacity={0.55}
        />
      </mesh>

      {/* Neon divider — horizontal (meeting | lounge) */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[11, 0.008, 1]}>
        <planeGeometry args={[24, 0.08]} />
        <meshStandardMaterial
          color="#818CF8" emissive={new THREE.Color('#818CF8')}
          emissiveIntensity={1.2} transparent opacity={0.55}
        />
      </mesh>

      {/* Exec Suite bottom border — amber line */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[-18.5, 0.008, -7.2]}>
        <planeGeometry args={[10, 0.07]} />
        <meshStandardMaterial
          color="#FBBF24" emissive={new THREE.Color('#FBBF24')}
          emissiveIntensity={1.0} transparent opacity={0.45}
        />
      </mesh>
    </>
  )
}

// ===========================================================================
// ZONE LABELS
// ===========================================================================

function ZoneLabels() {
  const zones = useMemo(() => [
    { pos: [-19.5, 0.1, -15] as [number, number, number], label: 'EXECUTIVE SUITE', color: '#6b4600' },
    { pos: [ -9,   0.1, -14] as [number, number, number], label: 'DESK ZONE',       color: '#0e2d60' },
    { pos: [ 11,   0.1, -15] as [number, number, number], label: 'MEETING ROOM',    color: '#28196e' },
    { pos: [ 11,   0.1,  15] as [number, number, number], label: 'LOUNGE',          color: '#6b3800' },
  ], [])

  return (
    <>
      {zones.map(({ pos, label, color }) => (
        <Html key={label} position={pos} center transform scale={0.2}>
          <div style={{
            color,
            fontSize: '26px',
            fontWeight: '900',
            fontFamily: '"JetBrains Mono", "Courier New", monospace',
            letterSpacing: '7px',
            whiteSpace: 'nowrap',
            textShadow: `0 0 30px ${color}`,
            userSelect: 'none',
            pointerEvents: 'none',
          }}>
            {label}
          </div>
        </Html>
      ))}
    </>
  )
}

// ===========================================================================
// AGENT DESK
// ===========================================================================

const AgentDesk = memo(function AgentDesk({
  position, teamColor, isActive,
}: { position: THREE.Vector3; teamColor: string; isActive: boolean }) {
  const c    = useMemo(() => new THREE.Color(teamColor), [teamColor])
  const legs = useMemo<[number, number][]>(
    () => [[-0.73, -0.44], [0.73, -0.44], [-0.73, 0.44], [0.73, 0.44]], []
  )

  return (
    <group position={position}>
      {/* Surface — clearly visible medium blue-slate */}
      <mesh position={[0, 0.41, 0]} castShadow>
        <boxGeometry args={[1.7, 0.08, 1.05]} />
        <meshStandardMaterial color="#253d5a" roughness={0.5} metalness={0.2} />
      </mesh>
      {/* Front accent strip — team color */}
      <mesh position={[0, 0.41, 0.525]}>
        <boxGeometry args={[1.7, 0.08, 0.045]} />
        <meshStandardMaterial color={teamColor} emissive={c} emissiveIntensity={isActive ? 2.5 : 0.9} />
      </mesh>
      {/* Monitor screen — always has a faint glow so it's visible even when idle */}
      <mesh position={[0, 0.97, -0.4]}>
        <boxGeometry args={[0.98, 0.64, 0.04]} />
        <meshStandardMaterial
          color={isActive ? teamColor : '#1a3050'}
          emissive={new THREE.Color(isActive ? teamColor : '#1a3050')}
          emissiveIntensity={isActive ? 2.2 : 0.45}
          roughness={0.1}
        />
      </mesh>
      {/* Monitor stand */}
      <mesh position={[0, 0.67, -0.4]}>
        <boxGeometry args={[0.065, 0.23, 0.065]} />
        <meshStandardMaterial color="#2a3e58" />
      </mesh>
      {/* Monitor base */}
      <mesh position={[0, 0.47, -0.4]}>
        <boxGeometry args={[0.33, 0.03, 0.18]} />
        <meshStandardMaterial color="#2a3e58" />
      </mesh>
      {/* Legs — visible against floor */}
      {legs.map(([lx, lz], i) => (
        <mesh key={i} position={[lx, 0.2, lz]}>
          <boxGeometry args={[0.055, 0.41, 0.055]} />
          <meshStandardMaterial color="#1e3050" />
        </mesh>
      ))}
      {/* Active desk spotlight */}
      {isActive && <pointLight position={[0, 2.0, 0]} color={teamColor} intensity={5.0} distance={5.5} />}
    </group>
  )
})

// ===========================================================================
// NEB CORNER — Executive Suite
// ===========================================================================

function NebCorner3D() {
  const lightRef = useRef<THREE.PointLight | null>(null)
  const t = useRef(0)

  useFrame((_, delta) => {
    t.current += delta
    if (lightRef.current) {
      lightRef.current.intensity = 4.5 + Math.sin(t.current * 0.75) * 1.0
    }
  })

  return (
    <group position={[-22, 0, -11]}>
      <pointLight ref={lightRef} color="#FBBF24" intensity={5.0} distance={18} />

      {/* Premium wide desk — warm dark wood tone, clearly visible */}
      <mesh position={[0, 0.44, 0]} castShadow>
        <boxGeometry args={[3.2, 0.09, 1.6]} />
        <meshStandardMaterial color="#3a2208" roughness={0.4} metalness={0.2} />
      </mesh>
      {/* Amber edge glow */}
      <mesh position={[0, 0.44, 0.8]}>
        <boxGeometry args={[3.2, 0.09, 0.05]} />
        <meshStandardMaterial color="#FBBF24" emissive={new THREE.Color('#FBBF24')} emissiveIntensity={2.8} />
      </mesh>
      {/* Left monitor (main) */}
      <mesh position={[-0.7, 1.18, -0.65]}>
        <boxGeometry args={[1.2, 1.0, 0.05]} />
        <meshStandardMaterial
          color="#0a0500" emissive={new THREE.Color('#FBBF24')}
          emissiveIntensity={0.32} roughness={0.12}
        />
      </mesh>
      {/* Right monitor (secondary) */}
      <mesh position={[0.85, 1.18, -0.65]}>
        <boxGeometry args={[0.8, 1.0, 0.05]} />
        <meshStandardMaterial
          color="#0a0500" emissive={new THREE.Color('#FBBF24')}
          emissiveIntensity={0.18} roughness={0.12}
        />
      </mesh>
      {/* Monitor stand */}
      <mesh position={[0, 0.69, -0.65]}>
        <boxGeometry args={[0.08, 0.33, 0.08]} />
        <meshStandardMaterial color="#2e1c00" metalness={0.4} />
      </mesh>

      {/* Crown label */}
      <Html position={[0, 3.4, 0]} center distanceFactor={11}>
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px',
          pointerEvents: 'none', userSelect: 'none',
        }}>
          <span style={{ fontSize: '34px', filter: 'drop-shadow(0 0 16px rgba(251,191,36,1))' }}>👑</span>
          <div style={{
            padding: '5px 18px',
            background: 'rgba(251,191,36,0.16)',
            border: '1px solid rgba(251,191,36,0.6)',
            borderRadius: '5px',
            color: '#FBBF24',
            fontWeight: '900',
            fontSize: '14px',
            fontFamily: '"JetBrains Mono", monospace',
            letterSpacing: '3.5px',
            textShadow: '0 0 20px rgba(251,191,36,1)',
            whiteSpace: 'nowrap',
          }}>
            NEB · FOUNDER
          </div>
        </div>
      </Html>
    </group>
  )
}

// ===========================================================================
// EXEC SUITE GLASS PARTITION
// ===========================================================================

function ExecSuitePartition() {
  return (
    <group>
      {/* Semi-transparent frosted glass wall */}
      <mesh position={[-18.5, 1.3, -7.4]}>
        <boxGeometry args={[10, 2.6, 0.06]} />
        <meshStandardMaterial
          color="#FBBF24" emissive={new THREE.Color('#FBBF24')} emissiveIntensity={0.04}
          transparent opacity={0.07} depthWrite={false}
        />
      </mesh>
      {/* Top glowing edge */}
      <mesh position={[-18.5, 2.62, -7.4]}>
        <boxGeometry args={[10, 0.045, 0.06]} />
        <meshStandardMaterial
          color="#FBBF24" emissive={new THREE.Color('#FBBF24')}
          emissiveIntensity={2.0} transparent opacity={0.7}
        />
      </mesh>
    </group>
  )
}

// ===========================================================================
// MEETING TABLE — animated holographic
// ===========================================================================

function MeetingTable3D() {
  const edgeRef = useRef<THREE.Mesh | null>(null)
  const t = useRef(0)

  useFrame((_, delta) => {
    t.current += delta
    if (edgeRef.current) {
      const mat = edgeRef.current.material
      if (!Array.isArray(mat) && mat instanceof THREE.MeshStandardMaterial) {
        mat.emissiveIntensity = 1.1 + Math.sin(t.current * 1.4) * 0.35
      }
    }
  })

  const legs = useMemo<[number, number][]>(
    () => [[-3.0, -1.3], [3.0, -1.3], [-3.0, 1.3], [3.0, 1.3]], []
  )

  return (
    <group position={[11, 0, -9]}>
      {/* Surface */}
      <mesh position={[0, 0.45, 0]}>
        <boxGeometry args={[6.8, 0.07, 2.9]} />
        <meshStandardMaterial
          color="#00D4FF" emissive={new THREE.Color('#00D4FF')} emissiveIntensity={0.2}
          transparent opacity={0.82} roughness={0.07} metalness={0.55}
        />
      </mesh>
      {/* Animated edge glow */}
      <mesh ref={edgeRef} position={[0, 0.45, 0]}>
        <boxGeometry args={[7.0, 0.025, 3.1]} />
        <meshStandardMaterial
          color="#00D4FF" emissive={new THREE.Color('#00D4FF')} emissiveIntensity={1.4}
          transparent opacity={0.38} depthWrite={false}
        />
      </mesh>
      {/* Legs */}
      {legs.map(([lx, lz], i) => (
        <mesh key={i} position={[lx, 0.22, lz]}>
          <cylinderGeometry args={[0.058, 0.058, 0.45, 8]} />
          <meshStandardMaterial color="#0a1628" metalness={0.75} />
        </mesh>
      ))}
      <pointLight position={[0, 1.6, 0]} color="#00D4FF" intensity={2.8} distance={10} />
    </group>
  )
}

// ===========================================================================
// LOUNGE AREA
// ===========================================================================

function LoungeArea3D() {
  const makeSofa = (
    pos: [number, number, number],
    armColor: string
  ) => (
    <group position={pos}>
      <mesh position={[0, 0.29, 0]}>
        <boxGeometry args={[2.9, 0.58, 0.95]} />
        <meshStandardMaterial color="#0d1a30" roughness={0.9} />
      </mesh>
      <mesh position={[0, 0.67, -0.46]}>
        <boxGeometry args={[2.9, 0.78, 0.18]} />
        <meshStandardMaterial color="#0a1525" roughness={0.9} />
      </mesh>
      {([-1.38, 1.38] as const).map((x, i) => (
        <mesh key={i} position={[x, 0.54, 0]}>
          <boxGeometry args={[0.1, 0.52, 0.95]} />
          <meshStandardMaterial
            color={armColor}
            emissive={new THREE.Color(armColor)}
            emissiveIntensity={0.45}
          />
        </mesh>
      ))}
    </group>
  )

  return (
    <group>
      {makeSofa([6, 0, 7], '#00D4FF')}
      {makeSofa([16, 0, 7], '#818CF8')}

      {/* Coffee table */}
      <group position={[11, 0, 7]}>
        <mesh position={[0, 0.35, 0]}>
          <boxGeometry args={[1.9, 0.065, 0.85]} />
          <meshStandardMaterial
            color="#00D4FF" emissive={new THREE.Color('#00D4FF')}
            emissiveIntensity={0.22} transparent opacity={0.78}
          />
        </mesh>
        <pointLight position={[0, 0.9, 0]} color="#00D4FF" intensity={1.0} distance={4.5} />
      </group>

      {/* Plants */}
      {([3.5, 18.5] as const).map((px, i) => (
        <group key={i} position={[px, 0, 13]}>
          <mesh position={[0, 0.3, 0]}>
            <cylinderGeometry args={[0.29, 0.23, 0.6, 8]} />
            <meshStandardMaterial color="#0d1520" />
          </mesh>
          <mesh position={[0, 0.8, 0]}>
            <sphereGeometry args={[0.46, 8, 8]} />
            <meshStandardMaterial
              color="#065f46" emissive={new THREE.Color('#065f46')} emissiveIntensity={0.38}
            />
          </mesh>
        </group>
      ))}

      <pointLight position={[11, 5.5, 8]} color="#FBBF24" intensity={2.0} distance={20} />
    </group>
  )
}

// ===========================================================================
// LIGHTING — bright enough to see everything
// ===========================================================================

function OfficeLighting() {
  return (
    <>
      {/* Global fill — key change: much brighter ambient so nothing is pitch black */}
      <ambientLight intensity={0.9} color="#c8d8f0" />
      <directionalLight position={[4, 30, 14]} intensity={1.8} color="#e0ecff" castShadow />
      <hemisphereLight args={['#2040a0', '#081020', 0.8]} />

      {/* Executive Suite — warm amber ceiling */}
      <pointLight position={[-18, 7, -11]} color="#ffe4a0" intensity={5.0} distance={20} />

      {/* Desk zone — two bright overhead panels */}
      <pointLight position={[-14, 7,  -6]} color="#d0e8ff" intensity={5.5} distance={24} />
      <pointLight position={[-11, 7,   3]} color="#d0e8ff" intensity={5.5} distance={24} />

      {/* Ops/consulting — left strip */}
      <pointLight position={[-22, 7,   4]} color="#c8daf0" intensity={4.0} distance={18} />

      {/* Marketing zone */}
      <pointLight position={[-11, 7,  11]} color="#ffe8b0" intensity={4.0} distance={18} />

      {/* Meeting room — bright neutral white */}
      <pointLight position={[11,  9,  -9]} color="#d8eaff" intensity={4.5} distance={26} />

      {/* Lounge — warm white */}
      <pointLight position={[11,  8,   8]} color="#ffeac0" intensity={4.0} distance={22} />
    </>
  )
}

// ===========================================================================
// AGENT AVATAR — all animation state in refs, zero re-renders
// ===========================================================================

interface AgentAvatarProps {
  agent: Agent
  agentIdx: number
  activity: ActivityState
  taskTitle: string | null
  onSelect: (agent: Agent) => void
}

function AgentAvatar({ agent, agentIdx, activity, taskTitle, onSelect }: AgentAvatarProps) {
  const groupRef  = useRef<THREE.Group | null>(null)
  const headRef   = useRef<THREE.Mesh | null>(null)
  const haloRef   = useRef<THREE.Mesh | null>(null)
  const ringRef   = useRef<THREE.Mesh | null>(null)
  const workLight = useRef<THREE.PointLight | null>(null)

  const teamColor = TEAM_COLORS[agent.team] ?? '#94A3B8'
  const deskPos   = useMemo(() => getDeskPos(agent.id), [agent.id])
  const color     = useMemo(() => new THREE.Color(teamColor), [teamColor])

  const anim = useRef({
    pos:      deskPos.clone(),
    target:   deskPos.clone(),
    wander:   Math.random() * 7 + 4,
    bobPhase: Math.random() * Math.PI * 2,
    baseWP:   pickBaseWaypoint(activity, agentIdx).clone(),
  })

  const actRef = useRef(activity)
  useEffect(() => {
    actRef.current = activity
    const a = anim.current
    if (activity === 'working' || activity === 'idle_desk' || activity === 'offline' || activity === 'error') {
      a.target.copy(deskPos)
      a.wander = 9999
    } else {
      a.baseWP = pickBaseWaypoint(activity, agentIdx).clone()
      a.target.copy(a.baseWP)
      a.wander = Math.random() * 5 + 3
    }
  }, [activity, agentIdx, deskPos])

  useFrame(({ clock }, delta) => {
    const group = groupRef.current
    if (!group) return
    const a   = anim.current
    const act = actRef.current

    // Smooth movement
    a.pos.lerp(a.target, Math.min(delta * 2.0, 1))
    group.position.x = a.pos.x
    group.position.z = a.pos.z

    // Bob
    const speed = act === 'working' ? 4.8 : 1.6
    const amp   = act === 'working' ? 0.1  : 0.04
    group.position.y = Math.sin(clock.elapsedTime * speed + a.bobPhase) * amp

    // Rotate toward target
    const dx = a.target.x - a.pos.x
    const dz = a.target.z - a.pos.z
    if (Math.abs(dx) + Math.abs(dz) > 0.08) {
      const angle = Math.atan2(dx, dz)
      group.rotation.y += (angle - group.rotation.y) * Math.min(delta * 5, 1)
    }

    // Idle wander — skip for CEO and offline agents
    if (act !== 'working' && act !== 'idle_desk' && act !== 'offline') {
      a.wander -= delta
      if (a.wander <= 0) {
        a.target.copy(wanderAround(a.baseWP, 2.2))
        a.target.y = 0
        a.wander = Math.random() * 8 + 4
      }
    }

    // Head emissive
    const head = headRef.current
    if (head) {
      const mat = head.material
      if (!Array.isArray(mat) && mat instanceof THREE.MeshStandardMaterial) {
        mat.emissiveIntensity =
          act === 'working'  ? 0.8 + Math.sin(clock.elapsedTime * 4.5 + a.bobPhase) * 0.35
          : act === 'offline' ? 0.05
          : 0.32 + Math.sin(clock.elapsedTime * 1.3 + a.bobPhase) * 0.1
      }
    }

    // Halo pulse
    const halo = haloRef.current
    if (halo) {
      const mat = halo.material
      if (!Array.isArray(mat) && mat instanceof THREE.MeshStandardMaterial) {
        mat.emissiveIntensity =
          act === 'working' ? 0.25 + Math.sin(clock.elapsedTime * 3.2 + a.bobPhase) * 0.12 : 0.06
        halo.scale.setScalar(
          act === 'working' ? 1.0 + Math.sin(clock.elapsedTime * 3.2 + a.bobPhase) * 0.12 : 1.0
        )
      }
    }

    // Ring — large and very bright when working
    const ring = ringRef.current
    if (ring) {
      const mat = ring.material
      if (!Array.isArray(mat) && mat instanceof THREE.MeshStandardMaterial) {
        mat.emissiveIntensity =
          act === 'working'  ? 1.8 + Math.sin(clock.elapsedTime * 5 + a.bobPhase) * 0.6
          : act === 'offline' ? 0.08
          : 0.5
        ring.scale.setScalar(
          act === 'working' ? 1.0 + Math.sin(clock.elapsedTime * 4 + a.bobPhase) * 0.1 : 1.0
        )
      }
    }

    // Work point light
    if (workLight.current) {
      workLight.current.intensity =
        act === 'working' ? 3.2 + Math.sin(clock.elapsedTime * 3.5) * 1.0 : 0
    }
  })

  const handleClick = useCallback((e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation()
    onSelect(agent)
  }, [agent, onSelect])

  const isOffline = activity === 'offline'
  const isError   = activity === 'error'
  const isWorking = activity === 'working'

  const errorColor  = '#EF4444'
  const offlineCol  = '#374151'
  const accentColor = isError ? errorColor : isOffline ? offlineCol : teamColor
  const accentC     = useMemo(
    () => new THREE.Color(isError ? errorColor : isOffline ? offlineCol : teamColor),
    [isError, isOffline, teamColor]
  )

  const initials = agent.name
    .split(/\s+/).filter(Boolean).slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '').join('')

  return (
    <group ref={groupRef} position={[deskPos.x, 0, deskPos.z]} onClick={handleClick}>
      {/* Invisible click volume */}
      <mesh visible={false}>
        <cylinderGeometry args={[0.95, 0.95, 3.2, 8]} />
        <meshBasicMaterial />
      </mesh>

      {/* Body */}
      <mesh position={[0, 0.58, 0]}>
        <cylinderGeometry args={[0.27, 0.27, 1.15, 12]} />
        <meshStandardMaterial
          color={teamColor} emissive={color} emissiveIntensity={0.55}
          roughness={0.3} transparent opacity={isOffline ? 0.38 : 1.0}
        />
      </mesh>

      {/* Head */}
      <mesh ref={headRef} position={[0, 1.32, 0]}>
        <sphereGeometry args={[0.33, 16, 16]} />
        <meshStandardMaterial
          color={teamColor} emissive={color} emissiveIntensity={0.4}
          roughness={0.16} transparent opacity={isOffline ? 0.38 : 1.0}
        />
      </mesh>

      {/* Halo sphere */}
      {!isOffline && (
        <mesh ref={haloRef} position={[0, 1.32, 0]}>
          <sphereGeometry args={[0.55, 10, 10]} />
          <meshStandardMaterial
            color={accentColor} emissive={accentC} emissiveIntensity={0.09}
            transparent opacity={0.15} depthWrite={false}
          />
        </mesh>
      )}

      {/* Floor status ring — large, very visible when working */}
      <mesh ref={ringRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.016, 0]}>
        <ringGeometry args={[0.38, 0.58, 32]} />
        <meshStandardMaterial
          color={accentColor} emissive={accentC}
          emissiveIntensity={isOffline ? 0.08 : isWorking ? 2.0 : 0.55}
          transparent opacity={isWorking ? 0.95 : 0.72}
        />
      </mesh>

      {/* Work point light */}
      <pointLight ref={workLight} position={[0, 2.8, 0]} color={teamColor} intensity={0} distance={4.5} />

      {/* Name tag */}
      <Html position={[0, 2.2, 0]} center distanceFactor={14} occlude={false}>
        <div
          onClick={(e) => { e.stopPropagation(); onSelect(agent) }}
          style={{
            padding: '3px 10px',
            background: 'rgba(5,10,20,0.92)',
            border: `1px solid ${isOffline ? '#374151' : accentColor}55`,
            borderRadius: '4px',
            color: isOffline ? '#4b5563' : accentColor,
            fontWeight: '800',
            fontSize: '11px',
            fontFamily: '"JetBrains Mono", monospace',
            whiteSpace: 'nowrap',
            letterSpacing: '0.5px',
            textShadow: isOffline ? 'none' : `0 0 12px ${teamColor}90`,
            cursor: 'pointer',
            pointerEvents: 'auto',
            userSelect: 'none',
            boxShadow: isWorking ? `0 0 10px ${teamColor}50` : 'none',
          }}
        >
          {isWorking ? '⚡ ' : isError ? '⛔ ' : ''}{initials} · {agent.id.replace(/_/g, ' ')}
        </div>
      </Html>

      {/* Task badge — clickable, floats above when working */}
      {isWorking && taskTitle && (
        <Html position={[0, 2.95, 0]} center distanceFactor={12}>
          <div
            onClick={(e) => { e.stopPropagation(); onSelect(agent) }}
            title={`Task: ${taskTitle}`}
            style={{
              padding: '4px 11px',
              background: 'rgba(251,191,36,0.18)',
              border: '1px solid rgba(251,191,36,0.72)',
              borderRadius: '5px',
              color: '#FBBF24',
              fontSize: '10px',
              fontFamily: '"JetBrains Mono", monospace',
              cursor: 'pointer',
              maxWidth: '148px',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              fontWeight: '800',
              letterSpacing: '0.3px',
              textShadow: '0 0 14px rgba(251,191,36,0.95)',
              pointerEvents: 'auto',
              userSelect: 'none',
              boxShadow: '0 0 14px rgba(251,191,36,0.3), inset 0 0 8px rgba(251,191,36,0.06)',
            }}
          >
            ⚡ {taskTitle}
          </div>
        </Html>
      )}

      {/* Error badge */}
      {isError && (
        <Html position={[0, 2.85, 0]} center distanceFactor={12}>
          <div style={{
            padding: '3px 10px',
            background: 'rgba(239,68,68,0.18)',
            border: '1px solid rgba(239,68,68,0.65)',
            borderRadius: '4px',
            color: '#EF4444',
            fontSize: '10px',
            fontFamily: '"JetBrains Mono", monospace',
            fontWeight: '800',
            whiteSpace: 'nowrap',
            pointerEvents: 'none',
            userSelect: 'none',
            textShadow: '0 0 10px rgba(239,68,68,0.8)',
          }}>
            ⛔ ERROR
          </div>
        </Html>
      )}
    </group>
  )
}

// ===========================================================================
// OFFICE SCENE
// ===========================================================================

interface OfficeSceneProps {
  agents: Agent[]
  taskMap: Record<string, string>
  onAgentSelect: (agent: Agent) => void
}

function OfficeScene({ agents, taskMap, onAgentSelect }: OfficeSceneProps) {
  return (
    <>
      <OfficeLighting />
      <OfficeFloor />
      <ZoneLabels />
      <ExecSuitePartition />
      <NebCorner3D />
      <MeetingTable3D />
      <LoungeArea3D />

      {/* Static desks */}
      {agents.map((agent) => {
        // Desk is "active" if agent is busy OR has an in-progress task
        const isActive = agent.status === 'busy' || agent.id in taskMap
        return (
          <AgentDesk
            key={`desk-${agent.id}`}
            position={getDeskPos(agent.id)}
            teamColor={TEAM_COLORS[agent.team] ?? '#94A3B8'}
            isActive={isActive}
          />
        )
      })}

      {/* Animated agent avatars */}
      {agents.map((agent, idx) => {
        // Activity is derived from BOTH agent.status AND active tasks
        const hasActiveTask = agent.id in taskMap
        return (
          <AgentAvatar
            key={agent.id}
            agent={agent}
            agentIdx={idx}
            activity={getActivity(agent, hasActiveTask)}
            taskTitle={taskMap[agent.id] ?? null}
            onSelect={onAgentSelect}
          />
        )
      })}

      <OrbitControls
        target={[-4, 0, 0]}
        maxPolarAngle={Math.PI / 2.06}
        minPolarAngle={0.12}
        minDistance={7}
        maxDistance={68}
        enableDamping
        dampingFactor={0.07}
      />
    </>
  )
}

// ===========================================================================
// AGENT INFO PANEL — right side DOM overlay
// ===========================================================================

function AgentInfoPanel({
  agent, lastRuns, runCount, activeTasks, events, onClose,
}: {
  agent: Agent
  lastRuns: AgentRun[]
  runCount: number
  activeTasks: Task[]
  events: SystemEventWithContext[]
  onClose: () => void
}) {
  const teamColor = TEAM_COLORS[agent.team] ?? '#94A3B8'
  const hasActiveTask = activeTasks.some((t) => t.assignee_agent_id === agent.id)
  const activity  = getActivity(agent, hasActiveTask)
  const myTasks   = activeTasks.filter((t) => t.assignee_agent_id === agent.id)
  const myEvents  = events.filter((e) => e.agent_id === agent.id).slice(0, 5)

  const initials = agent.name
    .split(/\s+/).filter(Boolean).slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '').join('')

  useEffect(() => {
    const fn = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', fn)
    return () => window.removeEventListener('keydown', fn)
  }, [onClose])

  return (
    <div
      className="absolute top-0 right-0 h-full w-[340px] bg-[#070C1A]/96 backdrop-blur-md border-l border-white/[0.08] flex flex-col z-20 animate-slide-up"
      style={{ boxShadow: '-20px 0 55px rgba(0,0,0,0.7)' }}
    >
      {/* Header */}
      <div
        className="px-5 py-4 border-b border-white/[0.07] flex items-center gap-3 flex-shrink-0"
        style={{ background: `${teamColor}0a` }}
      >
        <div
          className="w-11 h-11 rounded-xl flex items-center justify-center font-black text-sm flex-shrink-0"
          style={{ background: `${teamColor}18`, border: `1px solid ${teamColor}38`, color: teamColor }}
        >
          {initials}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={clsx('w-2 h-2 rounded-full flex-shrink-0',
              activity === 'working' ? 'bg-amber-400 animate-pulse' :
              activity === 'offline' ? 'bg-slate-600' :
              activity === 'error'   ? 'bg-rose-400 animate-pulse' :
              'bg-emerald-400'
            )} />
            <h2 className="text-sm font-bold text-white truncate">{agent.name}</h2>
          </div>
          <p className="text-[10px] font-semibold uppercase tracking-wider mt-0.5" style={{ color: teamColor }}>
            {agent.team} · {activity.replace('_', ' ')}
          </p>
        </div>
        <button onClick={onClose} className="text-slate-500 hover:text-white text-xl leading-none transition-colors flex-shrink-0">✕</button>
      </div>

      <div className="flex-1 overflow-y-auto p-5 space-y-5">
        {/* Role */}
        <div>
          <p className="text-[10px] text-slate-600 uppercase tracking-wider font-bold mb-1.5">Role</p>
          <p className="text-xs text-slate-300 leading-relaxed">{agent.role}</p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-lg border border-white/[0.07] bg-white/[0.03] p-3 text-center">
            <p className="text-base font-bold text-white">{runCount}</p>
            <p className="text-[9px] text-slate-600 uppercase tracking-wide mt-0.5">Runs</p>
          </div>
          <div className="rounded-lg border border-white/[0.07] bg-white/[0.03] p-3 text-center">
            <p className="text-base font-bold text-white">{myTasks.length}</p>
            <p className="text-[9px] text-slate-600 uppercase tracking-wide mt-0.5">Active</p>
          </div>
          <div className="rounded-lg border border-white/[0.07] p-3 text-center"
            style={{ background: `${teamColor}0e` }}>
            <p className="text-[10px] font-bold font-mono leading-tight" style={{ color: teamColor }}>
              {agent.model_id === 'gpt-5.4' ? 'GPT-5.4' : 'Gemini'}
            </p>
            <p className="text-[9px] text-slate-600 uppercase tracking-wide mt-0.5">Model</p>
          </div>
        </div>

        {/* Active tasks */}
        {myTasks.length > 0 && (
          <div>
            <p className="text-[10px] text-slate-600 uppercase tracking-wider font-bold mb-2">Active Tasks</p>
            <div className="space-y-1.5">
              {myTasks.slice(0, 3).map((t) => (
                <div key={t.id} className="rounded-lg border border-amber-400/22 bg-amber-400/[0.05] px-3 py-2.5">
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span className="text-amber-400 text-xs flex-shrink-0">⚡</span>
                    <p className="text-[11px] text-white font-semibold truncate">{t.title}</p>
                  </div>
                  <p className="text-[9px] text-slate-600 font-mono">{t.type}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Last runs */}
        <div>
          <p className="text-[10px] text-slate-600 uppercase tracking-wider font-bold mb-2">Last Runs</p>
          {lastRuns.length === 0 ? (
            <p className="text-[11px] text-slate-700 italic">No runs yet</p>
          ) : (
            <div className="space-y-2">
              {lastRuns.map((run) => (
                <div key={run.id} className="rounded-lg border border-white/[0.07] bg-white/[0.03] p-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className={clsx(
                      'text-[9px] font-semibold uppercase px-1.5 py-0.5 rounded font-mono',
                      run.outcome === 'success' ? 'bg-emerald-400/10 text-emerald-400' :
                      run.outcome === 'failure' ? 'bg-rose-400/10 text-rose-400' :
                      'bg-amber-400/10 text-amber-400',
                    )}>
                      {run.outcome}
                    </span>
                    <span className="text-[9px] text-slate-600 font-mono">
                      {new Date(run.created_at).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <p className="text-[10px] text-slate-400 line-clamp-2 leading-relaxed">
                    {run.output_summary || run.input_summary || '—'}
                  </p>
                  <p className="text-[9px] text-slate-700 font-mono mt-1">
                    ${run.cost_usd.toFixed(4)} · {run.duration_ms}ms
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent events */}
        {myEvents.length > 0 && (
          <div>
            <p className="text-[10px] text-slate-600 uppercase tracking-wider font-bold mb-2">Recent Events</p>
            <div className="space-y-1.5">
              {myEvents.map((ev) => (
                <div key={ev.id} className="rounded border border-white/[0.05] bg-white/[0.02] px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className={clsx(
                      'text-[9px] font-mono font-semibold truncate',
                      ev.severity === 'error' || ev.severity === 'critical' ? 'text-rose-400' :
                      ev.severity === 'warning' ? 'text-amber-400' : 'text-slate-500'
                    )}>
                      {ev.type}
                    </span>
                    <span className="text-[9px] text-slate-700 font-mono flex-shrink-0">
                      {new Date(ev.created_at).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ===========================================================================
// MAIN EXPORT
// ===========================================================================

export function VirtualOffice3DView() {
  const { data: agents, loading, error } = useAgents()
  const { runCounts, lastRuns }          = useAgentStats()
  const { data: activeTasks }            = useTasks('in_progress')
  const { data: recentEvents }           = useEventsWithContext(80)

  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null)

  const handleSelect = useCallback((a: Agent) => {
    setSelectedAgent((prev) => prev?.id === a.id ? null : a)
  }, [])
  const handleClose  = useCallback(() => setSelectedAgent(null), [])

  // agent id → active task title
  const taskMap = useMemo(() => {
    const map: Record<string, string> = {}
    for (const t of activeTasks) {
      if (t.assignee_agent_id && !map[t.assignee_agent_id]) {
        map[t.assignee_agent_id] = t.title
      }
    }
    return map
  }, [activeTasks])

  const busyCount   = agents.filter((a) => a.status === 'busy').length
  const onlineCount = agents.filter((a) => a.status === 'online').length

  if (loading) return (
    <div className="flex items-center justify-center h-full min-h-[500px]">
      <div className="flex flex-col items-center gap-3">
        <div className="w-6 h-6 border-2 border-[#00D4FF]/30 border-t-[#00D4FF] rounded-full animate-spin" />
        <p className="text-[11px] text-slate-600 font-mono tracking-wider">Initializing office...</p>
      </div>
    </div>
  )

  if (error) return (
    <div className="flex items-center justify-center h-full">
      <p className="text-rose-400 text-sm">Error: {error}</p>
    </div>
  )

  return (
    <div className="relative w-full" style={{ height: 'calc(100vh - 92px)', minHeight: '520px' }}>

      {/* Status bar */}
      <div className="absolute top-3 left-3 z-10 flex items-center gap-3 bg-[#070C1A]/90 backdrop-blur rounded-lg px-3 py-2 border border-white/[0.08]">
        <span className="text-[10px] font-black text-[#00D4FF] font-mono uppercase tracking-widest">WAI Office</span>
        <span className="w-px h-3 bg-white/10" />
        <span className="flex items-center gap-1.5 text-[10px] text-slate-400 font-mono">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          {onlineCount + busyCount} / {agents.length} online
        </span>
        {busyCount > 0 && (
          <>
            <span className="w-px h-3 bg-white/10" />
            <span className="flex items-center gap-1.5 text-[10px] text-amber-400 font-mono font-bold">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
              {busyCount} working
            </span>
          </>
        )}
      </div>

      {/* Legend */}
      <div className="absolute top-3 right-3 z-10 flex flex-col gap-1 bg-[#070C1A]/85 backdrop-blur rounded-lg px-3 py-2.5 border border-white/[0.07]">
        {[
          { color: '#34D399', label: 'Working' },
          { color: '#94A3B8', label: 'Idle' },
          { color: '#374151', label: 'Offline' },
          { color: '#EF4444', label: 'Error' },
        ].map(({ color, label }) => (
          <div key={label} className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: color, boxShadow: `0 0 5px ${color}` }} />
            <span className="text-[10px] text-slate-500 font-mono">{label}</span>
          </div>
        ))}
      </div>

      {/* Camera hint */}
      <div className="absolute bottom-3 left-3 z-10 text-[9px] text-slate-700 font-mono bg-[#070C1A]/60 rounded px-2 py-1 select-none">
        drag · scroll · click agent
      </div>

      {/* Canvas */}
      <Canvas
        camera={{ position: [2, 30, 28], fov: 52, near: 0.1, far: 230 }}
        gl={{ antialias: true, alpha: false }}
        onPointerMissed={handleClose}
      >
        <color attach="background" args={['#0a1828']} />
        <fog attach="fog" args={['#0a1828', 48, 88]} />
        <Suspense fallback={null}>
          <OfficeScene agents={agents} taskMap={taskMap} onAgentSelect={handleSelect} />
        </Suspense>
      </Canvas>

      {/* Agent info panel */}
      {selectedAgent && (
        <AgentInfoPanel
          agent={selectedAgent}
          lastRuns={lastRuns[selectedAgent.id] ?? []}
          runCount={runCounts[selectedAgent.id] ?? 0}
          activeTasks={activeTasks}
          events={recentEvents}
          onClose={handleClose}
        />
      )}
    </div>
  )
}
