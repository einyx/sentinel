/**
 * The rules that are in force.
 *
 * gitleaks keeps its own rules in the binary and inherits them when a
 * configuration says `useDefault = true`, so the rules that are really in
 * force cannot be read out of the configuration file alone.
 *
 * They can be read out of a SARIF report: the reporter writes every rule
 * of the configuration into the report's tool description, whether it fired
 * or not. Scanning an empty directory therefore produces a report that
 * lists the rules and nothing else.
 */

import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { runGitleaks } from './process.js'

/** One rule, as the report describes it. */
export interface Rule {
  id: string
  description: string
}

/**
 * The rules the scanner runs.
 *
 * The report is written to a temporary directory and deleted as soon as it
 * has been read.
 */
export async function listRules(
  gitleaksPath: string,
  configPath: string,
  timeoutSeconds = 60,
): Promise<Rule[]> {
  const directory = await mkdtemp(join(tmpdir(), 'sentinel-rules-'))
  const reportPath = join(directory, 'rules.sarif')
  try {
    const result = await runGitleaks(
      gitleaksPath,
      ['dir', directory, '--config', configPath, '--report-format', 'sarif', '--report-path', reportPath, '--no-banner'],
      timeoutSeconds,
    )
    // gitleaks exits 1 when it found something. Nothing is in the empty
    // directory, so anything above 0 means the run itself failed.
    if (result.code > 1) {
      throw new Error(`gitleaks could not report the rules: ${result.stderr.trim()}`)
    }

    let raw = ''
    try {
      raw = await readFile(reportPath, 'utf8')
    } catch {
      return []
    }

    const report = JSON.parse(raw) as {
      runs?: Array<{ tool?: { driver?: { rules?: Array<{ id: string; description?: { text?: string } }> } } }>
    }
    const rules = report.runs?.[0]?.tool?.driver?.rules ?? []
    return rules.map((rule) => ({
      id: rule.id,
      description: rule.description?.text ?? '',
    }))
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
