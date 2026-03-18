// ============================================================
// WAI Dashboard – Per-client deterministic color palette
//
// Same client name always maps to the same color bucket,
// so the UI stays consistent across page reloads and views.
// ============================================================

export interface ClientColor {
  bg: string
  border: string
  text: string
}

// 8-color palette tuned for dark backgrounds.
// Cyan is intentionally excluded — it is reserved for project chips.
const PALETTE: ClientColor[] = [
  { bg: 'bg-violet-950/60', border: 'border-violet-800/40', text: 'text-violet-300' },
  { bg: 'bg-sky-950/60',    border: 'border-sky-800/40',    text: 'text-sky-300'    },
  { bg: 'bg-emerald-950/60',border: 'border-emerald-800/40',text: 'text-emerald-300'},
  { bg: 'bg-amber-950/60',  border: 'border-amber-800/40',  text: 'text-amber-300'  },
  { bg: 'bg-rose-950/60',   border: 'border-rose-800/40',   text: 'text-rose-300'   },
  { bg: 'bg-orange-950/60', border: 'border-orange-800/40', text: 'text-orange-300' },
  { bg: 'bg-pink-950/60',   border: 'border-pink-800/40',   text: 'text-pink-300'   },
  { bg: 'bg-teal-950/60',   border: 'border-teal-800/40',   text: 'text-teal-300'   },
]

function hashStr(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0
  }
  return Math.abs(h)
}

/** Returns the ClientColor bucket for a given client name (deterministic). */
export function getClientColor(clientName: string): ClientColor {
  return PALETTE[hashStr(clientName) % PALETTE.length]
}
