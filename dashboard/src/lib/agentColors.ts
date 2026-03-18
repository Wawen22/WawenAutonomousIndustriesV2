// ============================================================
// WAI Dashboard – Per-agent deterministic color palette
// ============================================================

export interface AgentColor {
  bg: string
  border: string
  text: string
  glow: string
}

const PALETTE: AgentColor[] = [
  { bg: 'bg-violet-500/10',  border: 'border-violet-500/30',  text: 'text-violet-400',  glow: 'shadow-[0_0_10px_rgba(167,139,250,0.3)]' },
  { bg: 'bg-sky-500/10',     border: 'border-sky-500/30',     text: 'text-sky-400',     glow: 'shadow-[0_0_10px_rgba(56,189,248,0.3)]' },
  { bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', text: 'text-emerald-400', glow: 'shadow-[0_0_10px_rgba(52,211,153,0.3)]' },
  { bg: 'bg-amber-500/10',   border: 'border-amber-500/30',   text: 'text-amber-400',   glow: 'shadow-[0_0_10px_rgba(251,191,36,0.3)]' },
  { bg: 'bg-rose-500/10',    border: 'border-rose-500/30',    text: 'text-rose-400',    glow: 'shadow-[0_0_10_rgba(244,63,94,0.3)]' },
  { bg: 'bg-orange-500/10',  border: 'border-orange-500/30',  text: 'text-orange-400',  glow: 'shadow-[0_0_10px_rgba(249,115,22,0.3)]' },
  { bg: 'bg-pink-500/10',    border: 'border-pink-500/30',    text: 'text-pink-400',    glow: 'shadow-[0_0_10px_rgba(236,72,153,0.3)]' },
  { bg: 'bg-teal-500/10',    border: 'border-teal-500/30',    text: 'text-teal-400',    glow: 'shadow-[0_0_10px_rgba(20,184,166,0.3)]' },
  { bg: 'bg-indigo-500/10',  border: 'border-indigo-500/30',  text: 'text-indigo-400',  glow: 'shadow-[0_0_10px_rgba(99,102,241,0.3)]' },
  { bg: 'bg-cyan-500/10',    border: 'border-cyan-500/30',    text: 'text-cyan-400',    glow: 'shadow-[0_0_10px_rgba(6,182,212,0.3)]' },
]

function hashStr(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0
  }
  return Math.abs(h)
}

export function getAgentColor(agentId: string): AgentColor {
  return PALETTE[hashStr(agentId) % PALETTE.length]
}
