/**
 * The worker: the part that looks for secrets.
 *
 * It waits for the repositories that are due, clones each one, runs
 * gitleaks over its history, and records what it finds. New findings are
 * announced on the webhooks the organisation set up.
 */

import {
  Scanner,
  decrypt,
  encrypt,
  notifyWebhooks,
  type FindingInput,
  type Notification,
  type Repository,
  type ScanResult,
  type Settings,
  type Store,
} from '@sentinel/core'

import { cloneTokenFor, resolveConnection } from './connections.js'

/** How long the worker waits before it looks for work again. */
const IDLE_SECONDS = 30

/** The sleep, written so the worker can be stopped cleanly. */
const sleep = (seconds: number) => new Promise((resolve) => setTimeout(resolve, seconds * 1000))

/**
 * The worker.
 */
export class Worker {
  private readonly scanner: Scanner
  private running = false

  constructor(
    private readonly settings: Settings,
    private readonly store: Store,
  ) {
    this.scanner = new Scanner({
      gitleaksPath: settings.gitleaksPath,
      configPath: settings.gitleaksConfig,
      workDir: settings.workDir,
      timeoutSeconds: settings.scanTimeoutSeconds,
    })
  }

  /** Stop after the current scan. */
  stop(): void {
    this.running = false
  }

  /**
   * Scan one repository.
   *
   * The findings are recorded whatever the scan's outcome: a repository that
   * cannot be cloned is a failed scan, not a failed finding.
   */
  async scanRepository(repository: Repository): Promise<void> {
    const scan = await this.store.createScan(repository.id, 'schedule')

    try {
      const credential = await this.credentialFor(repository)
      const result = await this.scanner.scan(repository, credential)
      const findings = this.filterIgnored(repository, result)

      const known = await this.store.knownFingerprints(
        repository.id,
        findings.map((finding) => finding.fingerprint),
      )

      await this.store.recordFindings(repository.id, scan.id, findings)
      await this.markHoneytokens(repository, findings)
      await this.announce(repository, findings, known)

      await this.store.finishScan(scan.id, 'succeeded', findings.length, result.commitSha, null)
      await this.store.markRepositoryScanned(repository.id, 'succeeded')
      this.log(
        `${repository.name}: ${findings.length} finding(s), ${known.size} already known`,
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await this.store.finishScan(scan.id, 'failed', 0, null, message)
      await this.store.markRepositoryScanned(repository.id, 'failed')
      this.log(`${repository.name}: the scan failed: ${message}`)
    }
  }

  /**
   * The credential a repository is cloned with.
   *
   * A repository watched through a connection is cloned with the grant, and
   * the grant is renewed first when it is about to lapse. A connection that
   * cannot be used stops the scan with a message that says so, rather than
   * a clone that fails with a 401 from the forge.
   */
  private async credentialFor(repository: Repository): Promise<{ username: string; secret: string } | undefined> {
    if (repository.connectionId) {
      const resolved = await resolveConnection(
        this.store,
        repository.connectionId,
        this.settings.encryptionKey,
        this.settings.preRegisteredProviders,
      )
      const { username, token } = await cloneTokenFor(this.store, resolved, this.settings.encryptionKey)
      return { username, secret: token }
    }

    if (!repository.credentialId) return undefined
    const record = await this.store.getCredentialSecret(repository.credentialId)
    if (!record) return undefined
    try {
      return {
        username: record.username ?? 'x-access-token',
        secret: decrypt(record.secret, this.settings.encryptionKey),
      }
    } catch {
      this.log(`${repository.name}: the credential cannot be read, cloning without it`)
      return undefined
    }
  }

  /**
   * The findings the repository asked not to be told about.
   *
   * The ignores are applied after the scan rather than through the gitleaks
   * configuration: a per-repository configuration would have to be
   * generated for every scan, and the rules that are in force would differ
   * from the ones the console shows.
   */
  private filterIgnored(repository: Repository, result: ScanResult): FindingInput[] {
    const ignores = this.ignores.get(repository.id)
    if (!ignores || !ignores.length) {
      return result.findings.map((finding) => this.toInput(finding))
    }

    const rules = new Set(ignores.filter((ignore) => ignore.kind === 'rule').map((ignore) => ignore.value))
    const paths = ignores
      .filter((ignore) => ignore.kind === 'path')
      .map((ignore) => {
        try {
          return new RegExp(ignore.value)
        } catch {
          return null
        }
      })
      .filter((pattern): pattern is RegExp => pattern !== null)

    return result.findings
      .filter((finding) => !rules.has(finding.ruleId))
      .filter((finding) => !paths.some((pattern) => pattern.test(finding.file ?? '')))
      .map((finding) => this.toInput(finding))
  }

  /** The ignores of the repositories, read once per pass. */
  private ignores = new Map<string, Array<{ kind: 'path' | 'rule'; value: string }>>()

  /** Read the ignores of the repositories that are about to be scanned. */
  private async loadIgnores(repositories: Repository[]): Promise<void> {
    for (const repository of repositories) {
      const ignores = await this.store.listIgnores(repository.id)
      this.ignores.set(
        repository.id,
        ignores.map((ignore) => ({ kind: ignore.kind, value: ignore.value })),
      )
    }
  }

  /** A finding, ready to be recorded. */
  private toInput(finding: ScanResult['findings'][number]): FindingInput {
    return {
      fingerprint: finding.fingerprint,
      ruleId: finding.ruleId,
      description: finding.description,
      file: finding.file,
      startLine: finding.startLine,
      commitSha: finding.commitSha,
      author: finding.author,
      committedAt: finding.committedAt,
      matchRedacted: finding.matchRedacted,
      secretRedacted: finding.secretRedacted,
      secretHash: finding.secretHash,
      // The secret is kept encrypted, so the validity check can be made
      // later. It is never handed out: the console shows the masked text.
      secretCiphertext: finding.secret ? encrypt(finding.secret, this.settings.encryptionKey) : null,
    }
  }

  /**
   * Note the honeytokens that were found.
   *
   * A honeytoken that turns up in a repository has been picked up by
   * somebody. That is the whole point of one.
   */
  private async markHoneytokens(repository: Repository, findings: FindingInput[]): Promise<void> {
    const honeytokens = await this.store.listHoneytokenFingerprints()
    if (!honeytokens.length) return

    const byFingerprint = new Map(honeytokens.map((honeytoken) => [honeytoken.fingerprint, honeytoken.id]))
    for (const finding of findings) {
      const matched = byFingerprint.get(finding.secretHash ?? '')
      if (!matched) continue
      await this.store.markHoneytokenTriggered(matched)
      this.log(`${repository.name}: a honeytoken was found in this repository`)
    }
  }

  /** Announce the findings that are new. */
  private async announce(
    repository: Repository,
    findings: FindingInput[],
    known: Set<string>,
  ): Promise<void> {
    const fresh = findings.filter((finding) => !known.has(finding.fingerprint))
    if (!fresh.length) return

    const webhooks = await this.store.listWebhooks(repository.organizationId)
    if (!webhooks.length) return

    for (const finding of fresh) {
      const payload: Notification = {
        kind: 'finding',
        organization: repository.organizationId,
        repository: repository.name,
        rule: finding.ruleId,
        file: finding.file,
        line: finding.startLine,
        author: finding.author,
        status: 'open',
        findingId: finding.fingerprint,
      }
      await notifyWebhooks(webhooks, payload)
    }
  }

  /** A line on the worker's log. */
  private log(message: string): void {
    process.stdout.write(`${new Date().toISOString()} worker ${message}\n`)
  }

  /**
   * Look for work, until the worker is stopped.
   *
   * The loop is deliberately simple: it looks for the repositories that are
   * due, scans them one at a time, and waits. The database decides what is
   * due, so several workers can run without scanning the same repository
   * twice.
   *
   * A scan that somebody asked for over the API does not wait for the loop
   * to come round: the API sends a notification, and the worker hears it.
   */
  async run(): Promise<void> {
    this.running = true
    this.log('the worker is looking for repositories to scan')

    let wake: (() => void) | null = null
    const stopListening = await this.store
      .listenForScanRequests(() => wake?.())
      .catch((error: unknown) => {
        this.log(`the worker could not listen for scan requests: ${error instanceof Error ? error.message : error}`)
        return null
      })

    while (this.running) {
      try {
        const due = await this.store.listDueRepositories(this.settings.scanConcurrency)
        if (due.length) {
          await this.loadIgnores(due)
          for (const repository of due) {
            if (!this.running) break
            await this.scanRepository(repository)
          }
          continue
        }
      } catch (error) {
        this.log(`the worker could not reach the database: ${error instanceof Error ? error.message : error}`)
      }

      // The wait ends early when somebody asks for a scan.
      await Promise.race([
        sleep(IDLE_SECONDS),
        new Promise<void>((resolve) => {
          wake = () => {
            wake = null
            resolve()
          }
        }),
      ])
    }

    await stopListening?.()
    this.log('the worker is stopping')
  }
}
