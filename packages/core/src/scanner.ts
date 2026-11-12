/**
 * The scanner: clone a repository, run gitleaks over its history, and turn
 * the report into findings.
 *
 * gitleaks is the engine. Everything in this file is the plumbing around it:
 * the clone, the rules, and the fingerprint.
 */

import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { runProgram } from './process.js'
import type { GitleaksFinding, Repository } from './types.js'

/** What a scan produced. */
export interface ScanResult {
  findings: Array<{
    fingerprint: string
    ruleId: string
    description: string | null
    file: string | null
    startLine: number | null
    commitSha: string | null
    author: string | null
    committedAt: string | null
    matchRedacted: string | null
    secretRedacted: string | null
    /**
     * The secret itself.
     *
     * It is handed to the worker and nowhere else. The worker encrypts it
     * before it is stored, and the report it came from is deleted as soon
     * as it has been read.
     */
    secret: string
    /**
     * The hash of the secret, not the secret.
     *
     * It is how a honeytoken is matched: the honeytokens are kept as hashes,
     * so a finding whose secret hashes to a honeytoken's hash is that
     * honeytoken.
     */
    secretHash: string
  }>
  commitSha: string | null
}

/** The credentials a clone needs. */
export interface CloneCredential {
  username: string
  secret: string
}

/** How the scanner is set up. */
export interface ScannerOptions {
  /** The gitleaks binary. */
  gitleaksPath: string
  /** The rules every repository is scanned with. */
  configPath: string
  /** Where the clones are kept. */
  workDir: string
  /** How long a scan may take. */
  timeoutSeconds: number
}

/**
 * The environment the clone runs with.
 *
 * The credential helper reads the token from the environment when git runs
 * it, so the token never appears in a remote URL, in `.git/config` or in the
 * process arguments.
 */
function gitEnvironment(credential?: CloneCredential): NodeJS.ProcessEnv {
  return {
    GIT_TERMINAL_PROMPT: '0',
    // The clone belongs to the worker user. Without this git refuses to read
    // a repository whose ownership it does not recognise.
    GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL ?? '/etc/sentinel/gitconfig',
    HOME: process.env.HOME ?? '/tmp',
    ...(credential
      ? {
          SENTINEL_GIT_USERNAME: credential.username,
          SENTINEL_GIT_PASSWORD: credential.secret,
        }
      : {}),
  }
}

/** The git arguments that carry the credential helper. */
function gitCredentialArgs(credential?: CloneCredential): string[] {
  if (!credential) return []
  return [
    '-c',
    'credential.helper=!f() { echo username=$SENTINEL_GIT_USERNAME; echo password=$SENTINEL_GIT_PASSWORD; }; f',
  ]
}

/**
 * The scanner.
 */
export class Scanner {
  constructor(private readonly options: ScannerOptions) {}

  /** Where the clone of a repository is kept. */
  private clonePath(repository: Repository): string {
    return join(this.options.workDir, repository.id)
  }

  /**
   * Clone the repository, or bring the clone up to date.
   *
   * The remote branches are not pruned: the history of a branch that was
   * deleted upstream is exactly where a secret can stay hidden, and a
   * pruned ref cannot be scanned any more.
   */
  private async sync(repository: Repository, credential?: CloneCredential): Promise<string> {
    const directory = this.clonePath(repository)
    const env = gitEnvironment(credential)
    const auth = gitCredentialArgs(credential)

    const existing = await readFile(join(directory, '.git', 'HEAD'), 'utf8').catch(() => null)
    if (existing !== null) {
      const fetch = await runProgram(
        'git',
        [...auth, '-C', directory, 'fetch', '--quiet', '--tags', '--force', 'origin', '+refs/heads/*:refs/remotes/origin/*'],
        { env, timeoutSeconds: this.options.timeoutSeconds },
      )
      if (fetch.code !== 0) {
        // A fetch that fails is not fatal: the previous clone is still
        // there, and scanning it is better than not scanning at all.
        await writeFile(join(directory, '.git', 'FETCH_FAILED'), fetch.stderr)
      }
      return directory
    }

    await rm(directory, { recursive: true, force: true })
    await mkdir(this.options.workDir, { recursive: true })
    const clone = await runProgram(
      'git',
      [...auth, 'clone', '--quiet', repository.cloneUrl, directory],
      { env, timeoutSeconds: this.options.timeoutSeconds },
    )
    if (clone.code !== 0) {
      throw new Error(`the clone failed: ${clone.stderr.trim() || clone.stdout.trim()}`)
    }
    return directory
  }

  /** The commit the clone is on. */
  private async head(directory: string): Promise<string | null> {
    const result = await runProgram('git', ['-C', directory, 'rev-parse', 'HEAD'], { timeoutSeconds: 60 })
    return result.code === 0 ? result.stdout.trim() : null
  }

  /**
   * Scan a repository.
   *
   * gitleaks writes its report to a file in the temporary directory, not in
   * the working directory: the report holds the secret itself, because the
   * fingerprint is computed from it. The file is deleted as soon as the
   * report has been read, and only the redacted text is kept.
   */
  async scan(repository: Repository, credential?: CloneCredential): Promise<ScanResult> {
    const directory = await this.sync(repository, credential)
    const reportPath = join(this.options.workDir, `report-${repository.id}-${process.pid}.json`)

    const args = [
      'git',
      directory,
      '--config',
      this.options.configPath,
      '--log-opts',
      '--all',
      '--report-format',
      'json',
      '--report-path',
      reportPath,
      '--no-banner',
    ]

    let result: { code: number; stdout: string; stderr: string }
    try {
      result = await runProgram(this.options.gitleaksPath, args, {
        env: gitEnvironment(credential),
        timeoutSeconds: this.options.timeoutSeconds,
      })
    } catch (error) {
      await rm(reportPath, { force: true })
      throw error
    }

    let raw = ''
    try {
      raw = await readFile(reportPath, 'utf8')
    } catch {
      raw = ''
    } finally {
      await rm(reportPath, { force: true })
    }

    // gitleaks exits 1 when it found something. That is a result, not a
    // failure; anything above 1 is a failure of the scan itself.
    if (result.code > 1) {
      throw new Error(`gitleaks failed: ${result.stderr.trim() || result.stdout.trim()}`)
    }

    let parsed: GitleaksFinding[] = []
    if (raw.trim()) {
      try {
        const decoded = JSON.parse(raw)
        parsed = Array.isArray(decoded) ? decoded : []
      } catch {
        throw new Error('gitleaks wrote a report that could not be read')
      }
    }

    return {
      findings: parsed.map((finding) => {
        const secret = finding.Secret ?? ''
        return {
          fingerprint: fingerprintOf(finding),
          ruleId: finding.RuleID,
          description: finding.Description ?? null,
          file: finding.File || finding.SymlinkFile || null,
          startLine: Number.isFinite(finding.StartLine) ? finding.StartLine : null,
          commitSha: finding.Commit || null,
          author: finding.Author || null,
          committedAt: finding.Date || null,
          matchRedacted: redact(finding.Match ?? '', secret),
          secretRedacted: secret ? 'REDACTED' : null,
          secret,
          secretHash: hashOf(secret),
        }
      }),
      commitSha: await this.head(directory),
    }
  }
}

/**
 * The hash of a secret.
 *
 * It is what a honeytoken is matched by. The secret itself is never kept
 * in the clear.
 */
export function hashOf(secret: string): string {
  return createHash('sha256').update(secret).digest('hex')
}

/**
 * The fingerprint of a finding.
 *
 * It is computed from the rule, the file and the secret itself, and not
 * from the commit. A secret that is moved to another commit — by a rebase,
 * a cherry-pick, or a branch that was rewritten — is the same secret in the
 * same place, and it should stay the same finding rather than becoming a
 * new one on every scan.
 *
 * The fingerprint is a hash, so it does not disclose the secret.
 */
export function fingerprintOf(finding: GitleaksFinding): string {
  const material = [finding.RuleID ?? '', finding.File ?? '', finding.Secret ?? ''].join('\u0000')
  return createHash('sha256').update(material).digest('hex').slice(0, 40)
}

/**
 * Replace the secret in the matched text.
 *
 * The matched text is what the operator reads to see where the secret is.
 * It usually carries the secret itself, so it is masked before it is kept.
 */
export function redact(match: string, secret: string): string {
  if (!secret) return match
  return match.split(secret).join('REDACTED')
}
