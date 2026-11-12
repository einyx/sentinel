/**
 * Sending findings to the places that want to hear about them.
 *
 * A webhook is a URL the organisation owns. It is called when a new finding
 * shows up, so that the channel the team already watches is the place the
 * finding lands in.
 */

import type { Webhook } from './types.js'

/** What is being announced. */
export interface Notification {
  kind: 'finding' | 'honeytoken'
  organization: string
  repository: string
  rule: string
  file: string | null
  line: number | null
  author: string | null
  status: string
  findingId: string
  honeytoken?: { label: string }
}

/** How long a webhook call may take. */
const TIMEOUT_MS = 10_000

/** The message a Slack webhook receives. */
function slackMessage(payload: Notification): string {
  const where = payload.file ? ` — \`${payload.file}${payload.line ? `:${payload.line}` : ''}\`` : ''
  const who = payload.author ? ` by ${payload.author}` : ''
  if (payload.kind === 'honeytoken') {
    return `:honey_pot: A honeytoken (*${payload.honeytoken?.label ?? 'unnamed'}*) was committed in *${payload.repository}*${where}.`
  }
  return `:rotating_light: A secret was found in *${payload.repository}*${where}${who} — rule \`${payload.rule}\`.`
}

/**
 * The body a webhook receives.
 *
 * The generic body is the notification itself, so a webhook that is not
 * Slack can be pointed at a script that does whatever the organisation
 * wants. The Slack body is the message Slack renders.
 */
function bodyFor(webhook: Webhook, payload: Notification): string {
  if (webhook.kind === 'slack') {
    return JSON.stringify({ text: slackMessage(payload) })
  }
  return JSON.stringify(payload)
}

/**
 * Send a notification to one webhook.
 *
 * A webhook that fails does not stop the others, and does not fail the
 * scan: a broken notification is not a reason to stop looking for secrets.
 */
async function deliver(webhook: Webhook, payload: Notification): Promise<boolean> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const response = await fetch(webhook.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: bodyFor(webhook, payload),
      signal: controller.signal,
    })
    return response.ok
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Send a notification to every webhook that is switched on.
 *
 * Returns the webhooks that were reached.
 */
export async function notifyWebhooks(webhooks: Webhook[], payload: Notification): Promise<string[]> {
  const delivered: string[] = []
  for (const webhook of webhooks) {
    if (!webhook.enabled) continue
    if (await deliver(webhook, payload)) {
      delivered.push(webhook.id)
    }
  }
  return delivered
}
