import { spawn } from 'child_process'
import { join } from 'path'
import { app } from 'electron'

// ─── Find the Python executable ──────────────────────────
// In development: use the .venv we created in sidecar/
// In production:  use the bundled binary (Phase 6)

function getPython(): string {
  if (app.isPackaged) {
    // Production — bundled binary path
    return join(process.resourcesPath, 'sidecar', 'analyze')
  }

  // Development — use the virtual environment
  const root = app.getAppPath()
  return join(root, 'sidecar', '.venv', 'bin', 'python3')
}

function getSidecarPath(): string {
  const root = app.getAppPath()
  return join(root, 'sidecar', 'analyze.py')
}

// ─── Core bridge function ─────────────────────────────────

export function analyzeFile(filepath: string): Promise<AnalysisResult> {
  return new Promise((resolve, reject) => {
    const python = getPython()
    const script = getSidecarPath()

    // spawn starts Python as a child process
    // ['ignore', 'pipe', 'pipe'] means:
    //   stdin  → ignored (we never send anything to Python)
    //   stdout → we read this (the JSON result)
    //   stderr → we read this (errors and warnings)
    const child = spawn(python, [script, filepath], {
      stdio: ['ignore', 'pipe', 'pipe']
    })

    let stdout = ''
    let stderr = ''

    // Collect stdout chunks as they arrive
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })

    // Collect stderr — librosa warnings go here
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })

    // Python has finished — parse the result
    child.on('close', (code) => {
      if (stderr) {
        // Log warnings but do not fail — they are usually
        // librosa deprecation notices, not real errors
        console.warn('Sidecar stderr:', stderr.trim())
      }

      if (!stdout) {
        reject(new Error(`Sidecar produced no output. Exit code: ${code}`))
        return
      }

      try {
        const result = JSON.parse(stdout) as AnalysisResult
        resolve(result)
      } catch {
        reject(new Error(`Failed to parse sidecar output: ${stdout.slice(0, 200)}`))
      }
    })

    // Handle spawn errors — e.g. Python not found
    child.on('error', (err) => {
      reject(new Error(`Failed to start sidecar: ${err.message}`))
    })
  })
}

// ─── Type for the result ──────────────────────────────────

export interface AnalysisResult {
  success: boolean
  error?: string
  filepath: string
  title: string | null
  artist: string | null
  album: string | null
  genre: string | null
  year: string | null
  comment: string | null
  label: string | null
  remixer: string | null
  composer: string | null
  grouping: string | null
  bpm: number | null
  key_full: string | null
  key_camelot: string | null
  camelot: string | null
  duration_sec: number | null
  duration_str: string | null
  bpm_tag: string | null
}
