import { useMemo, useState } from 'react'
import { clsx } from 'clsx'
import { format } from 'date-fns'
import { Panel } from './ui/Panel.js'
import { Badge } from './ui/Badge.js'
import { Stat } from './ui/Stat.js'
import { useClients, useInvoicedProjects, usePayments } from '../hooks/useSupabaseRealtime.js'
import type { Payment, Project, ProjectType } from '../types/index.js'

const ALL_TYPES: (ProjectType | 'all')[] = [
  'all',
  'website', 'app', 'saas', 'consulting', 'ai',
  'marketing', 'content', 'copywriting', 'design', 'automation', 'other',
]

const TYPE_BADGE: Record<ProjectType, string> = {
  website: 'dev',
  app: 'dev_complex',
  saas: 'dev_complex',
  consulting: 'consulting',
  ai: 'analysis',
  marketing: 'marketing',
  content: 'content',
  copywriting: 'content',
  design: 'default',
  automation: 'ops',
  other: 'default',
}

interface PaymentAggregate {
  totalPaid: number
  lastReceivedAt: string | null
  count: number
}

interface RevenueRowData {
  project: Project
  clientName: string
  paidAmount: number
  balanceAmount: number
  paymentCount: number
  lastPaymentAt: string | null
}

function aggregatePayments(payments: Payment[]): Map<string, PaymentAggregate> {
  const map = new Map<string, PaymentAggregate>()

  for (const payment of payments) {
    const existing = map.get(payment.project_id) ?? {
      totalPaid: 0,
      lastReceivedAt: null,
      count: 0,
    }

    const lastReceivedAt =
      !existing.lastReceivedAt || new Date(payment.received_at).getTime() > new Date(existing.lastReceivedAt).getTime()
        ? payment.received_at
        : existing.lastReceivedAt

    map.set(payment.project_id, {
      totalPaid: existing.totalPaid + (payment.amount_usd ?? 0),
      lastReceivedAt,
      count: existing.count + 1,
    })
  }

  return map
}

function paymentState(paidAmount: number, balanceAmount: number): {
  label: string
  variant: string
} {
  if (paidAmount <= 0) {
    return { label: 'unpaid', variant: 'default' }
  }
  if (balanceAmount <= 0) {
    return { label: 'paid', variant: 'finance' }
  }
  return { label: 'partial', variant: 'warning' }
}

export function RevenueView() {
  const { data: projects, loading: projectsLoading, error: projectsError } = useInvoicedProjects()
  const { data: clients } = useClients()
  const { data: payments, loading: paymentsLoading, error: paymentsError } = usePayments()
  const [typeFilter, setTypeFilter] = useState<ProjectType | 'all'>('all')

  const clientMap = useMemo(
    () => new Map(clients.map((client) => [client.id, client.name])),
    [clients]
  )

  const paymentMap = useMemo(() => aggregatePayments(payments), [payments])

  const rows = useMemo<RevenueRowData[]>(() => {
    const filteredProjects = typeFilter === 'all'
      ? projects
      : projects.filter((project) => project.type === typeFilter)

    return filteredProjects.map((project) => {
      const paymentAggregate = paymentMap.get(project.id)
      const paidAmount = paymentAggregate?.totalPaid ?? 0
      const invoicedAmount = project.contract_value_usd ?? 0
      const balanceAmount = Math.max(invoicedAmount - paidAmount, 0)

      return {
        project,
        clientName: clientMap.get(project.client_id) ?? '—',
        paidAmount,
        balanceAmount,
        paymentCount: paymentAggregate?.count ?? 0,
        lastPaymentAt: paymentAggregate?.lastReceivedAt ?? null,
      }
    })
  }, [clientMap, paymentMap, projects, typeFilter])

  const totals = useMemo(() => {
    const invoiced = rows.reduce((sum, row) => sum + (row.project.contract_value_usd ?? 0), 0)
    const paid = rows.reduce((sum, row) => sum + row.paidAmount, 0)
    const balance = rows.reduce((sum, row) => sum + row.balanceAmount, 0)
    const paidInFull = rows.filter((row) => row.paidAmount > 0 && row.balanceAmount <= 0).length
    return { invoiced, paid, balance, paidInFull }
  }, [rows])

  const loading = projectsLoading || paymentsLoading
  const error = projectsError ?? paymentsError

  const selectClass = clsx(
    'text-xs font-mono bg-white/[0.04] border border-white/[0.08] rounded-md px-2.5 py-1.5',
    'text-slate-300 focus:outline-none focus:border-emerald-400/40 transition-colors'
  )

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-bold text-white">Revenue</h2>
          <p className="text-[11px] text-slate-600 mt-0.5">Fatturato vs incassato — dati real-time</p>
        </div>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as ProjectType | 'all')}
          className={selectClass}
        >
          {ALL_TYPES.map((type) => (
            <option key={type} value={type}>
              {type === 'all' ? 'All types' : type}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Fatturato" value={`$${totals.invoiced.toFixed(2)}`} color="emerald" />
        <Stat label="Incassato" value={`$${totals.paid.toFixed(2)}`} color="cyan" />
        <Stat label="Da Incassare" value={`$${totals.balance.toFixed(2)}`} color="amber" />
        <Stat label="Fully Paid" value={String(totals.paidInFull)} color="violet" />
      </div>

      <Panel title="Pipeline Ricavi" accent="emerald">
        {loading && (
          <p className="text-[11px] text-slate-600 font-mono animate-pulse py-4">Caricamento...</p>
        )}

        {error && (
          <p className="text-[11px] text-rose-400 font-mono py-4">Errore: {error}</p>
        )}

        {!loading && !error && rows.length === 0 && (
          <p className="text-[11px] text-slate-600 font-mono py-6 text-center">
            Nessun progetto fatturato
            {typeFilter !== 'all' ? ` di tipo "${typeFilter}"` : ''}.
            <br />
            Usa <span className="text-slate-400">/invoice client/project amount</span> per fatturare e
            <span className="text-slate-400"> /mark_paid client/project amount</span> per registrare un incasso.
          </p>
        )}

        {!loading && !error && rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-[860px]">
              <thead>
                <tr className="border-b border-white/[0.06] text-left">
                  <th className="pb-3 text-[10px] uppercase tracking-wider font-semibold text-slate-600 pr-4">Cliente</th>
                  <th className="pb-3 text-[10px] uppercase tracking-wider font-semibold text-slate-600 pr-4">Progetto</th>
                  <th className="pb-3 text-[10px] uppercase tracking-wider font-semibold text-slate-600 pr-4">Tipo</th>
                  <th className="pb-3 text-[10px] uppercase tracking-wider font-semibold text-slate-600 pr-4 text-right">Fatturato</th>
                  <th className="pb-3 text-[10px] uppercase tracking-wider font-semibold text-slate-600 pr-4 text-right">Incassato</th>
                  <th className="pb-3 text-[10px] uppercase tracking-wider font-semibold text-slate-600 pr-4 text-right">Saldo</th>
                  <th className="pb-3 text-[10px] uppercase tracking-wider font-semibold text-slate-600 pr-4">Stato</th>
                  <th className="pb-3 text-[10px] uppercase tracking-wider font-semibold text-slate-600 text-right">Ultimo Pagamento</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <RevenueRow key={row.project.id} row={row} />
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-white/[0.08]">
                  <td colSpan={3} className="pt-3 text-[10px] text-slate-600 font-semibold uppercase tracking-wider">
                    Totale ({rows.length})
                  </td>
                  <td className="pt-3 text-right font-bold text-emerald-400 font-mono tabular-nums">
                    ${totals.invoiced.toFixed(2)}
                  </td>
                  <td className="pt-3 text-right font-bold text-cyan-400 font-mono tabular-nums">
                    ${totals.paid.toFixed(2)}
                  </td>
                  <td className="pt-3 text-right font-bold text-amber-400 font-mono tabular-nums">
                    ${totals.balance.toFixed(2)}
                  </td>
                  <td />
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Panel>
    </div>
  )
}

interface RevenueRowProps {
  row: RevenueRowData
}

function RevenueRow({ row }: RevenueRowProps) {
  const { project, clientName, paidAmount, balanceAmount, paymentCount, lastPaymentAt } = row
  const state = paymentState(paidAmount, balanceAmount)

  return (
    <tr className="border-b border-white/[0.03] hover:bg-white/[0.02] transition-colors">
      <td className="py-3 pr-4">
        <span className="text-slate-300 font-medium">{clientName}</span>
      </td>
      <td className="py-3 pr-4">
        <div className="space-y-1">
          <div className="text-white font-medium">{project.name}</div>
          <div className="text-[10px] text-slate-600 font-mono">{paymentCount} payment{paymentCount === 1 ? '' : 's'}</div>
        </div>
      </td>
      <td className="py-3 pr-4">
        <Badge variant={TYPE_BADGE[project.type] ?? 'default'}>{project.type}</Badge>
      </td>
      <td className="py-3 pr-4 text-right">
        <span className="font-bold font-mono tabular-nums text-emerald-400">
          ${project.contract_value_usd.toFixed(2)}
        </span>
      </td>
      <td className="py-3 pr-4 text-right">
        <span className={clsx('font-bold font-mono tabular-nums', paidAmount > 0 ? 'text-cyan-400' : 'text-slate-500')}>
          ${paidAmount.toFixed(2)}
        </span>
      </td>
      <td className="py-3 pr-4 text-right">
        <span className={clsx('font-bold font-mono tabular-nums', balanceAmount > 0 ? 'text-amber-400' : 'text-emerald-400')}>
          ${balanceAmount.toFixed(2)}
        </span>
      </td>
      <td className="py-3 pr-4">
        <Badge variant={state.variant}>{state.label}</Badge>
      </td>
      <td className="py-3 text-right">
        <span className="text-slate-600 font-mono text-[10px]">
          {lastPaymentAt ? format(new Date(lastPaymentAt), 'MMM d, yyyy') : '—'}
        </span>
      </td>
    </tr>
  )
}
