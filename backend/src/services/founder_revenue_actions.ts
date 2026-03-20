import { log, recordEvent } from './logger.js'
import {
  createPayment,
  getClientBySlug,
  getPaymentsByProject,
  getProjectBySlug,
  updateProjectContractValue,
  updateProjectStatus,
} from './supabase.js'
import type { Client, Payment, Project } from '../types/index.js'

export interface InvoiceProjectResult {
  client: Client
  project: Project
  contractValueUsd: number
  previousStatus: string
}

export interface MarkProjectPaidResult {
  client: Client
  project: Project
  payment: Payment
  amountUsd: number
  totalPaidUsd: number
  outstandingUsd: number
}

function formatUsd(amount: number): string {
  return `$${amount.toFixed(2)}`
}

async function resolveClientProject(clientSlug: string, projectSlug: string): Promise<{ client: Client; project: Project }> {
  const client = await getClientBySlug(clientSlug)
  if (!client) {
    throw new Error(`Client ${clientSlug} not found`)
  }

  const project = await getProjectBySlug(client.id, projectSlug)
  if (!project) {
    throw new Error(`Project ${projectSlug} not found for client ${clientSlug}`)
  }

  return { client, project }
}

export async function executeInvoiceProject(
  clientSlug: string,
  projectSlug: string,
  amountUsd: number | undefined,
  source: 'telegram' | 'natural_language' | 'dashboard' | 'auto'
): Promise<InvoiceProjectResult> {
  const { client, project } = await resolveClientProject(clientSlug, projectSlug)

  if (project.status === 'invoiced') {
    throw new Error(`Project ${project.name} is already invoiced at ${formatUsd(project.contract_value_usd)}`)
  }

  const allowedStatuses = ['delivered', 'review', 'blocked', 'active']
  if (!allowedStatuses.includes(project.status)) {
    throw new Error(`Project is in status ${project.status} and cannot be invoiced`)
  }

  await updateProjectStatus(project.id, 'invoiced')

  const finalAmount = amountUsd !== undefined ? amountUsd : project.contract_value_usd
  if (amountUsd !== undefined) {
    await updateProjectContractValue(project.id, amountUsd)
  }

  await recordEvent('revenue_recorded', {
    payload: {
      command: 'invoice',
      source,
      project_id: project.id,
      client_id: client.id,
      client_slug: clientSlug,
      project_slug: projectSlug,
      project_name: project.name,
      client_name: client.name,
      previous_status: project.status,
      contract_value_usd: finalAmount,
      issued_by: 'founder',
    },
  })

  log.info({ projectId: project.id, clientSlug, projectSlug, amountUsd: finalAmount, source }, 'Project invoiced')

  return {
    client,
    project: {
      ...project,
      status: 'invoiced',
      contract_value_usd: finalAmount,
    },
    contractValueUsd: finalAmount,
    previousStatus: project.status,
  }
}

export async function executeMarkProjectPaid(
  clientSlug: string,
  projectSlug: string,
  amountUsd: number,
  source: 'telegram' | 'natural_language' | 'dashboard'
): Promise<MarkProjectPaidResult> {
  const { client, project } = await resolveClientProject(clientSlug, projectSlug)

  if (project.status !== 'invoiced') {
    throw new Error(`Project ${project.name} is in status ${project.status}; invoice it first`)
  }

  const payment = await createPayment({
    project_id: project.id,
    amount_usd: amountUsd,
    metadata: {
      command: 'mark_paid',
      source,
      issued_by: 'founder',
      client_slug: clientSlug,
      project_slug: projectSlug,
    },
  })

  const payments = await getPaymentsByProject(project.id)
  const totalPaidUsd = payments.reduce((sum, row) => sum + (row.amount_usd ?? 0), 0)
  const outstandingUsd = Math.max((project.contract_value_usd ?? 0) - totalPaidUsd, 0)

  await recordEvent('payment_received', {
    payload: {
      payment_id: payment.id,
      source,
      project_id: project.id,
      client_id: client.id,
      client_slug: clientSlug,
      project_slug: projectSlug,
      project_name: project.name,
      client_name: client.name,
      amount_usd: amountUsd,
      total_paid_usd: totalPaidUsd,
      outstanding_usd: outstandingUsd,
      contract_value_usd: project.contract_value_usd,
      issued_by: 'founder',
    },
  })

  return {
    client,
    project,
    payment,
    amountUsd,
    totalPaidUsd,
    outstandingUsd,
  }
}

export function formatInvoiceProjectMessage(result: InvoiceProjectResult): string {
  return [
    `💰 *Project Invoiced*`,
    ``,
    `Client: ${result.client.name}`,
    `Project: ${result.project.name}`,
    `Status: invoiced`,
    `Contract value: ${formatUsd(result.contractValueUsd)}`,
  ].join('\n')
}

export function formatMarkProjectPaidMessage(result: MarkProjectPaidResult): string {
  return [
    `💵 *Payment Recorded*`,
    ``,
    `Client: ${result.client.name}`,
    `Project: ${result.project.name}`,
    `Received: ${formatUsd(result.amountUsd)}`,
    `Total paid: ${formatUsd(result.totalPaidUsd)}`,
    `Outstanding: ${formatUsd(result.outstandingUsd)}`,
  ].join('\n')
}
