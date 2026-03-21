import { log, recordEvent } from './logger.js'
import {
  createPayment,
  getClientBySlug,
  getPaymentsByProject,
  getProjectBySlug,
  updateProjectContractValue,
  updateProjectStatus,
} from './supabase.js'
import { sendEmail } from './email.js'
import type { Client, Payment, Project } from '../types/index.js'

export interface InvoiceProjectResult {
  client: Client
  project: Project
  contractValueUsd: number
  previousStatus: string
  emailSent: boolean
  invoiceNumber: string
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

function buildInvoiceNumber(projectSlug: string, now = new Date()): string {
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '')
  const prefix = projectSlug.slice(0, 8).toUpperCase()
  return `INV-${dateStr}-${prefix}`
}

function buildInvoiceHtml(params: {
  invoiceNumber: string
  clientName: string
  projectName: string
  amountUsd: number
  issuedAt: string
}): string {
  const { invoiceNumber, clientName, projectName, amountUsd, issuedAt } = params
  const formattedDate = new Date(issuedAt).toLocaleDateString('en-GB', {
    year: 'numeric', month: 'long', day: 'numeric',
  })

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Invoice ${invoiceNumber}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f9fafb; margin: 0; padding: 32px 16px; color: #111827; }
    .card { background: #fff; max-width: 600px; margin: 0 auto; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,.1); padding: 40px; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 40px; }
    .brand { font-size: 22px; font-weight: 700; letter-spacing: -0.5px; color: #111827; }
    .brand span { color: #6366f1; }
    .invoice-meta { text-align: right; font-size: 13px; color: #6b7280; }
    .invoice-meta strong { display: block; font-size: 15px; color: #111827; margin-bottom: 4px; }
    h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.05em; color: #9ca3af; margin: 0 0 4px; }
    .client-block { margin-bottom: 32px; }
    .client-block p { margin: 0; font-size: 16px; font-weight: 600; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 32px; }
    th { text-align: left; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; color: #9ca3af; padding: 8px 0; border-bottom: 1px solid #f3f4f6; }
    td { padding: 12px 0; font-size: 15px; border-bottom: 1px solid #f3f4f6; }
    .amount-row { font-weight: 700; font-size: 18px; border-bottom: none; }
    .footer { font-size: 13px; color: #9ca3af; text-align: center; margin-top: 32px; padding-top: 24px; border-top: 1px solid #f3f4f6; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <div class="brand">W<span>AI</span></div>
      <div class="invoice-meta">
        <strong>${invoiceNumber}</strong>
        Issued: ${formattedDate}
      </div>
    </div>

    <div class="client-block">
      <h2>Bill To</h2>
      <p>${clientName}</p>
    </div>

    <table>
      <thead>
        <tr>
          <th>Description</th>
          <th style="text-align:right">Amount</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>${projectName}</td>
          <td style="text-align:right">${formatUsd(amountUsd)}</td>
        </tr>
        <tr>
          <td class="amount-row">Total Due</td>
          <td class="amount-row" style="text-align:right">${formatUsd(amountUsd)}</td>
        </tr>
      </tbody>
    </table>

    <div class="footer">
      Thank you for working with WAI &middot; Wawen Autonomous Industries<br/>
      Questions? Reply to this email.
    </div>
  </div>
</body>
</html>`
}

async function sendInvoiceEmail(
  client: Client,
  project: Project,
  amountUsd: number,
  invoiceNumber: string,
  issuedAt: string,
): Promise<boolean> {
  if (!client.email) {
    log.warn({ clientId: client.id, clientSlug: client.slug }, 'Invoice email skipped: client has no email address')
    return false
  }

  const html = buildInvoiceHtml({
    invoiceNumber,
    clientName: client.name,
    projectName: project.name,
    amountUsd,
    issuedAt,
  })

  await sendEmail({
    to: client.email,
    subject: `Invoice ${invoiceNumber} – ${project.name}`,
    html,
    text: `Invoice ${invoiceNumber}\n\nBill To: ${client.name}\nProject: ${project.name}\nAmount Due: ${formatUsd(amountUsd)}\n\nThank you for working with WAI.`,
  })

  return true
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

  const invoiceNumber = buildInvoiceNumber(projectSlug)
  const issuedAt = new Date().toISOString()
  const invoicedProject: Project = { ...project, status: 'invoiced', contract_value_usd: finalAmount }

  let emailSent = false
  try {
    emailSent = await sendInvoiceEmail(client, invoicedProject, finalAmount, invoiceNumber, issuedAt)
    if (emailSent) {
      await recordEvent('invoice_email_sent', {
        payload: {
          project_id: project.id,
          client_id: client.id,
          invoice_number: invoiceNumber,
          to: client.email,
          amount_usd: finalAmount,
        },
      })
    }
  } catch (err) {
    log.error({ err, projectId: project.id }, 'Invoice email failed (non-fatal)')
  }

  return {
    client,
    project: invoicedProject,
    contractValueUsd: finalAmount,
    previousStatus: project.status,
    emailSent,
    invoiceNumber,
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
  const emailLine = result.emailSent
    ? `Invoice email: ✅ inviata al cliente`
    : `Invoice email: ⚠️ non inviata (nessun indirizzo email cliente)`

  return [
    `💰 *Project Invoiced*`,
    ``,
    `Client: ${result.client.name}`,
    `Project: ${result.project.name}`,
    `Invoice: ${result.invoiceNumber}`,
    `Status: invoiced`,
    `Contract value: ${formatUsd(result.contractValueUsd)}`,
    emailLine,
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
