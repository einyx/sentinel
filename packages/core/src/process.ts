/**
 * Running a process and collecting what it said.
 *
 * The scanner and the rules reader both need to call a program and find
 * out what happened, so the plumbing is here rather than in each of them.
 */

import { spawn } from 'node:child_process'

/** What a run produced. */
export interface RunResult {
  /** The exit code. */
  code: number
  stdout: string
  stderr: string
}

/**
 * Run a program and collect its output.
 *
 * The process is killed when it takes longer than it is allowed to, so a
 * scan that hangs cannot hold a worker for ever.
 */
export function runProgram(
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutSeconds?: number } = {},
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    let settled = false

    const timer = options.timeoutSeconds
      ? setTimeout(() => {
          if (settled) return
          settled = true
          child.kill('SIGKILL')
          reject(new Error(`${command} timed out after ${options.timeoutSeconds}s`))
        }, options.timeoutSeconds * 1000)
      : undefined

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    child.on('error', (error) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      resolve({ code: code ?? 0, stdout, stderr })
    })
  })
}

/** Run gitleaks with the arguments given. */
export function runGitleaks(
  gitleaksPath: string,
  args: string[],
  timeoutSeconds: number,
  env?: NodeJS.ProcessEnv,
): Promise<RunResult> {
  return runProgram(gitleaksPath, args, { env, timeoutSeconds })
}
