import { spawn } from 'child_process'
import { join } from 'path'
import { app } from 'electron'

// ─── Find the Python executable ──────────────────────────
// In development: use the .venv we created in sidecar/
// In production:  use the bundled binary (Phase 6)

// __dirname is out/main at runtime (the compiled main bundle), regardless of
// how Electron was launched — unlike app.getAppPath(), which resolves to the
// entry script's directory (not the project root) when Electron is launched
// with a script path argument instead of a project directory.
const projectRoot = join(__dirname, '..', '..')

function getPython(binary: 'analyze' | 'edit_tags' = 'analyze'): string {
  if (app.isPackaged) {
    // Production — bundled binary path (one standalone PyInstaller
    // executable per script; each one IS the interpreter+script combined)
    return join(process.resourcesPath, 'sidecar', binary)
  }

  // Development — use the virtual environment
  return join(projectRoot, 'sidecar', '.venv', 'bin', 'python3')
}

function getSidecarPath(): string {
  return join(projectRoot, 'sidecar', 'analyze.py')
}

function getEditTagsSidecarPath(): string {
  return join(projectRoot, 'sidecar', 'edit_tags.py')
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

export function readTagsFast(filepath: string): Promise<AnalysisResult> {
  return new Promise((resolve, reject) => {
    const python = getPython()
    const script = getSidecarPath()
    const spawnArgs = app.isPackaged ? [filepath, '--fast'] : [script, filepath, '--fast']
    const child = spawn(python, spawnArgs, { stdio: ['ignore', 'pipe', 'pipe'] })

    let stdout = ''

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })

    child.stderr.on('data', (chunk: Buffer) => {
      console.warn('Sidecar stderr:', chunk.toString().trim())
    })

    child.on('close', () => {
      try {
        resolve(JSON.parse(stdout) as AnalysisResult)
      } catch {
        reject(new Error(`Failed to parse fast tag output: ${stdout.slice(0, 200)}`))
      }
    })

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
  analyzed: boolean
  artwork_base64: string | null
  // Both undefined from analyze()'s Phase 2 result (BPM/key only) — only
  // read_tags()'s fast Phase 1 path populates them, which is the only path
  // that ever needs them (import-time reconcile; see buildTrackData).
  file_size_bytes?: number | null
  client_uuid?: string | null
}

// ─── Batch tag editing ─────────────────────────────────────

export interface EditTagsMeta {
  title?: string
  artist?: string
  album?: string
  genre?: string
  bpm?: number | string
  key?: string
  year?: string
  remixer?: string
  grouping?: string
  composer?: string
  comment?: string
  label?: string
  cratecloud_id?: string
}

export interface EditTagsBatchItem {
  filepath: string
  meta: EditTagsMeta
}

export interface EditTagsResult {
  success: boolean
  filepath: string | null
  serato_written?: boolean
  serato_error?: string
  error?: string
  existing?: string
}

// Spawns edit_tags.py once in --batch mode for the whole batch — one
// process for N files, not N processes — writing one NDJSON line per item
// to its stdin and reading one JSON result line back per item from its
// stdout, in the same order. onProgress fires once per line, as it
// arrives, so a caller can stream progress instead of waiting for the
// whole batch to finish.
export function editTagsBatch(
  items: EditTagsBatchItem[],
  onProgress: (result: EditTagsResult) => void,
  options: { writeSerato?: boolean } = {}
): Promise<void> {
  return new Promise((resolve, reject) => {
    const python = getPython('edit_tags')
    const script = getEditTagsSidecarPath()
    const args = app.isPackaged ? ['--batch'] : [script, '--batch']
    if (options.writeSerato === false) args.push('--no-serato')

    const child = spawn(python, args, { stdio: ['pipe', 'pipe', 'pipe'] })

    let buffered = ''
    let stderr = ''

    child.stdout.on('data', (chunk: Buffer) => {
      buffered += chunk.toString()
      const lines = buffered.split('\n')
      buffered = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.trim()) continue
        try {
          onProgress(JSON.parse(line) as EditTagsResult)
        } catch {
          console.warn('[editTagsBatch] failed to parse result line:', line)
        }
      }
    })

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })

    child.on('close', (code) => {
      const trailing = buffered.trim()
      if (trailing) {
        try {
          onProgress(JSON.parse(trailing) as EditTagsResult)
        } catch {
          console.warn('[editTagsBatch] failed to parse trailing result line:', trailing)
        }
      }
      if (stderr) {
        console.warn('[editTagsBatch] sidecar stderr:', stderr.trim())
      }
      if (code !== 0) {
        reject(new Error(`edit_tags --batch exited with code ${code}`))
        return
      }
      resolve()
    })

    child.on('error', (err) => {
      reject(new Error(`Failed to start edit_tags sidecar: ${err.message}`))
    })

    // Write one NDJSON line per item, then close stdin so the Python side's
    // `for line in sys.stdin` loop terminates and the process exits.
    for (const item of items) {
      child.stdin.write(JSON.stringify(item) + '\n')
    }
    child.stdin.end()
  })
}
