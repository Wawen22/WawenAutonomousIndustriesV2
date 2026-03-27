// ============================================================
// WAI – Stripe Service (T141)
// Crea Stripe Invoice per ogni progetto fatturato e gestisce
// il webhook payment_succeeded per auto-mark paid.
// ============================================================

import Stripe from 'stripe'
import { log } from './logger.js'
import type { Client, Project } from '../types/index.js'

export function isStripeEnabled(): boolean {
  return Boolean(process.env['STRIPE_SECRET_KEY'])
}

function getStripeClient(): Stripe {
  const key = process.env['STRIPE_SECRET_KEY']
  if (!key) throw new Error('STRIPE_SECRET_KEY non configurata')
  return new Stripe(key, { apiVersion: '2026-03-25.dahlia' })
}

export interface StripeInvoiceResult {
  stripeInvoiceId: string
  hostedInvoiceUrl: string
  stripeCustomerId: string
}

/**
 * Crea o recupera un customer Stripe per email, crea una invoice con l'importo
 * e la finalizza restituendo l'URL di pagamento hosted.
 */
export async function createStripeInvoice(
  client: Client,
  project: Project,
  amountUsd: number,
  invoiceNumber: string,
): Promise<StripeInvoiceResult> {
  const stripe = getStripeClient()

  // 1. Create or retrieve customer by email
  let customerId: string
  if (client.email) {
    const existing = await stripe.customers.list({ email: client.email, limit: 1 })
    if (existing.data.length > 0 && existing.data[0]) {
      customerId = existing.data[0].id
      log.info({ customerId, email: client.email }, 'Stripe: customer retrieved')
    } else {
      const customer = await stripe.customers.create({
        email: client.email,
        name: client.name,
        metadata: { wai_client_id: client.id, wai_client_slug: client.slug },
      })
      customerId = customer.id
      log.info({ customerId, email: client.email }, 'Stripe: customer created')
    }
  } else {
    // No email — create anonymous customer with just the name
    const customer = await stripe.customers.create({
      name: client.name,
      metadata: { wai_client_id: client.id, wai_client_slug: client.slug },
    })
    customerId = customer.id
    log.info({ customerId, clientName: client.name }, 'Stripe: anonymous customer created')
  }

  // 2. Add invoice item
  const amountCents = Math.round(amountUsd * 100)
  await stripe.invoiceItems.create({
    customer: customerId,
    amount: amountCents,
    currency: 'usd',
    description: project.name,
  })

  // 3. Create invoice with metadata to link back to WAI project
  const invoice = await stripe.invoices.create({
    customer: customerId,
    collection_method: 'send_invoice',
    days_until_due: 14,
    metadata: {
      wai_invoice_number: invoiceNumber,
      wai_project_id: project.id,
      wai_project_slug: project.slug ?? '',
      wai_client_id: client.id,
      wai_client_slug: client.slug,
    },
    description: `WAI Invoice ${invoiceNumber} — ${project.name}`,
    footer: 'Thank you for working with WAI · Wawen Autonomous Industries',
  })

  // 4. Finalize to get the hosted URL
  const finalized = await stripe.invoices.finalizeInvoice(invoice.id)

  const hostedUrl = finalized.hosted_invoice_url
  if (!hostedUrl) {
    throw new Error(`Stripe invoice finalized but hosted_invoice_url missing for ${invoice.id}`)
  }

  log.info(
    { stripeInvoiceId: invoice.id, projectId: project.id, amountUsd, hostedUrl },
    'Stripe: invoice created and finalized',
  )

  return {
    stripeInvoiceId: invoice.id,
    hostedInvoiceUrl: hostedUrl,
    stripeCustomerId: customerId,
  }
}

/**
 * Verifica la firma del webhook Stripe e restituisce l'evento.
 * Richiede il raw body (Buffer) per la verifica HMAC.
 */
export function constructStripeWebhookEvent(rawBody: Buffer, signature: string): Stripe.Event {
  const secret = process.env['STRIPE_WEBHOOK_SECRET']
  if (!secret) {
    throw new Error('STRIPE_WEBHOOK_SECRET non configurata — impossibile verificare webhook')
  }
  const stripe = getStripeClient()
  return stripe.webhooks.constructEvent(rawBody, signature, secret)
}

/**
 * Estrae wai_project_id e wai_client_slug dai metadata di un Stripe Invoice.
 */
export function extractWaiMetadataFromStripeInvoice(invoice: Stripe.Invoice): {
  projectId: string | null
  clientSlug: string | null
  projectSlug: string | null
  invoiceNumber: string | null
} {
  const meta = invoice.metadata ?? {}
  return {
    projectId: meta['wai_project_id'] ?? null,
    clientSlug: meta['wai_client_slug'] ?? null,
    projectSlug: meta['wai_project_slug'] ?? null,
    invoiceNumber: meta['wai_invoice_number'] ?? null,
  }
}
