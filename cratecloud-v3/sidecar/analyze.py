#!.user/bin/env python3  shebang - If you execute this file directly, use Python 3 to run it.
"""
CrateCloud audio sidecar — analyze.py
Reads BPM and key from an audio file.
Returns a single JSON object to stdout.
Electron reads that JSON via child_process.

Usage:
    python3 analyze.py /path/to/track.mp3
"""

import sys
import json # lets Python convert Python objects into JSON
import warnings # Don't show warning messages. Because your Electron process is expecting clean JSON on stdout.

# Suppose librosa warnings - safe to ignore
warnings.filterwarnings('ignore')

import subprocess
import numpy as np
import librosa # analyzes the actual audio waveform
import mutagen # reads the metadata embedded in the music file

# ─── Camelot Wheel ───────────────────────────────────────
# Maps librosa key names to Camelot notation
# librosa returns keys like "C major" or "A minor"
# DJs use Camelot: "8B" or "8A"

CAMELOT = {
    'C major':  '8B',  'G major':  '9B',
    'D major':  '10B', 'A major':  '11B',
    'E major':  '12B', 'B major':  '1B',
    'F# major': '2B',  'Db major': '3B',
    'Ab major': '4B',  'Eb major': '5B',
    'Bb major': '6B',  'F major':  '7B',
    'A minor':  '8A',  'E minor':  '9A',
    'B minor':  '10A', 'F# minor': '11A',
    'C# minor': '12A', 'G# minor': '1A',
    'Eb minor': '2A',  'Bb minor': '3A',
    'F minor':  '4A',  'C minor':  '5A',
    'G minor':  '6A',  'D minor':  '7A',
}

def detect_bpm(y, sr):
  """
  Detect the tempo (BPM) of an audio signal.
  y  = audio time series (numpy array)
  sr = sample rate (integer)
  Returns a float rounded to 1 decimal place.
  """

  # onset_envelope gives librosa rhythmic context
  onset_env = librosa.onset.onset_strength(y=y, sr=sr)

  # beat_track return (tempo, beat_frames)
  # tempo is a numpy array = we take the first element
  tempo, _ = librosa.beat.beat_track( onset_envelope=onset_env,sr=sr)

  # Convert numpy float to Python float and round
  bpm = float(tempo[0] if hasattr(tempo, '__len__') else float(tempo))
  return round(bpm, 1)

def detect_key(y, sr):
  """
  Detect the musical key of an audio signal.
  Returns a dict with full name and Camelot notation.
  """
  # Separate harmonic content from percussion
  # This improves key detection accuracy
  y_harmonic, _ = librosa.effects.hpss(y)

  # Chromagram — energy at each of the 12 pitch classes
  chroma = librosa.feature.chroma_cqt(y=y_harmonic, sr=sr)

  #Average energy across time
  chroma_mean = chroma.mean(axis=1)

  # Krumhansl-Kessler key profiles
  # These are the "fingerprints" of each key
  major_profile = [
    6.35, 2.23, 3.48, 2.33, 4.38, 4.09,
    2.52, 5.19, 2.39, 3.66, 2.29, 2.88
  ]
  minor_profile = [
    6.33, 2.68, 3.52, 5.38, 2.60, 3.53,
    2.54, 4.75, 3.98, 2.69, 3.34, 3.17
  ]

  key_names = [
    'C', 'C#', 'D', 'Eb', 'E', 'F',
    'F#', 'G', 'Ab', 'A', 'Bb', 'B'
  ]

  minor_names = [
    'A', 'Bb', 'B', 'C', 'C#', 'D',
    'Eb', 'E', 'F', 'F#', 'G', 'Ab'
  ]

  import numpy as np

  best_score = -1
  best_key = 'C major'

  # Try all 12 major keys
  for i in range(12):
    profile = np.roll(major_profile, i)
    score = np.corrcoef(chroma_mean, profile)[0, 1]
    if score > best_score:
        best_score = score
        best_key = f'{key_names[i]} major'

  # Try all 12 minor keys
  for i in range(12):
    profile = np.roll(minor_profile, i)
    score = np.corrcoef(chroma_mean, profile)[0, 1]
    if score > best_score:
        best_score = score
        best_key = f'{minor_names[i]} minor'

  camelot = CAMELOT.get(best_key, '?')

  return {
        'key_full':     best_key,
        'key_camelot':  camelot,
    }

def read_tags(filepath):
    """
    Read existing ID3 tags from the file using mutagen.
    Fast — does not load the full audio into memory.
    Returns a dict of whatever tags exist.
    """
    tags = {
        'title':    None,
        'artist':   None,
        'album':    None,
        'genre':    None,
        'year':     None,
        'comment':  None,
        'label':    None,
        'remixer':  None,
        'composer': None,
        'grouping': None,
        'bpm_tag':  None,  # BPM already in the file's tags
    }

    try:
        audio = mutagen.File(filepath)
        if audio is None or audio.tags is None:
            return tags

        # mutagen tag keys differ by format
        # This covers MP3 (ID3), FLAC, M4A
        def get(keys):
            for key in keys:
                val = audio.tags.get(key)
                if val:
                    # ID3 tags are objects, FLAC tags are lists
                    v = str(val[0]) if isinstance(val, list) else str(val)
                    if v.strip():
                        return v.strip()
            return None

        tags['title']    = get(['TIT2', 'title',    '\xa9nam'])
        tags['artist']   = get(['TPE1', 'artist',   '\xa9ART'])
        tags['album']    = get(['TALB', 'album',     '\xa9alb'])
        tags['genre']    = get(['TCON', 'genre',     '\xa9gen'])
        tags['year']     = get(['TDRC', 'date',      '\xa9day'])
        tags['comment']  = get(['COMM::', 'comment', '\xa9cmt'])
        tags['label']    = get(['TPUB', 'organization'])
        tags['remixer']  = get(['TPE4', 'remixer'])
        tags['composer'] = get(['TCOM', 'composer',  '\xa9wrt'])
        tags['grouping'] = get(['TIT1', 'grouping',  '\xa9grp'])
        tags['bpm_tag']  = get(['TBPM', 'bpm'])

    except Exception:
        # Partial tag read is fine
        # Return whatever we got
        pass

    return tags


def load_via_ffmpeg(filepath, sr=22050):
    """
    Decode audio with ffmpeg instead of soundfile.
    librosa.load only reads formats libsndfile understands, which
    excludes AAC-in-MP4 (.m4a) — ffmpeg handles those containers.
    Returns mono float32 PCM at the target sample rate.
    """
    cmd = [
        'ffmpeg', '-v', 'error', '-i', filepath,
        '-f', 'f32le', '-ac', '1', '-ar', str(sr), '-'
    ]
    proc = subprocess.run(cmd, capture_output=True)
    if proc.returncode != 0:
        message = proc.stderr.decode(errors='ignore').strip() or 'ffmpeg decode failed'
        raise RuntimeError(message)
    y = np.frombuffer(proc.stdout, dtype=np.float32)
    return y, sr


def load_audio(filepath, sr=22050):
    """
    Load audio for analysis. Tries librosa/soundfile first (fast path
    for wav/flac/mp3), falls back to ffmpeg for containers soundfile
    can't decode (e.g. .m4a).
    """
    try:
        return librosa.load(filepath, sr=sr, mono=True)
    except Exception:
        return load_via_ffmpeg(filepath, sr=sr)


def analyze(filepath):
    """
    Full analysis pipeline:
    1. Read existing tags (fast)
    2. Load audio (slow)
    3. Detect BPM
    4. Detect key
    5. Return everything as a dict
    """
    import os

    if not os.path.exists(filepath):
        return {
            'success': False,
            'error':   f'File not found: {filepath}'
        }

    # Step 1 — read tags (no audio load needed)
    tags = read_tags(filepath)

    # Step 2 — load audio at 22050 Hz mono
    # Lower sample rate = faster load, still accurate for BPM/key
    try:
        y, sr = load_audio(filepath, sr=22050)
    except Exception as e:
        return {
            'success': False,
            'error':   f'Could not load audio: {str(e)}',
            'tags':    tags,
        }

    # Step 3 — BPM
    try:
        bpm = detect_bpm(y, sr)
    except Exception as e:
        bpm = None
        print(f'BPM detection failed: {e}', file=sys.stderr)

    # Step 4 — Key
    try:
        key = detect_key(y, sr)
    except Exception as e:
        key = {'key_full': None, 'key_camelot': None}
        print(f'Key detection failed: {e}', file=sys.stderr)

    # Step 5 — Duration
    duration_sec = round(librosa.get_duration(y=y, sr=sr), 2)
    minutes = int(duration_sec // 60)
    seconds = int(duration_sec % 60)
    duration_str = f'{minutes}:{seconds:02d}'

    # Step 6 — Return everything
    # Tags from the file take priority for title/artist/etc.
    # BPM and key come from analysis
    return {
        'success':      True,
        'filepath':     filepath,
        'title':        tags['title'],
        'artist':       tags['artist'],
        'album':        tags['album'],
        'genre':        tags['genre'],
        'year':         tags['year'],
        'comment':      tags['comment'],
        'label':        tags['label'],
        'remixer':      tags['remixer'],
        'composer':     tags['composer'],
        'grouping':     tags['grouping'],
        'bpm':          bpm,
        'key_full':     key['key_full'],
        'key_camelot':  key['key_camelot'],
        'camelot':      key['key_camelot'],
        'duration_sec': duration_sec,
        'duration_str': duration_str,
        'bpm_tag':      tags['bpm_tag'],
    }


# ─── Entry point ─────────────────────────────────────────

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(json.dumps({
            'success': False,
            'error':   'No file path provided. Usage: python3 analyze.py /path/to/file.mp3'
        }))
        sys.exit(1)

    filepath = sys.argv[1]
    result = analyze(filepath)

    # stdout = the result Node.js reads
    # This must be the ONLY thing printed to stdout
    print(json.dumps(result))




# Electron
#    │
#    │  "Analyze this MP3"
#    ▼
# analyze.py
#    │
#    ├── Read existing metadata
#    │
#    ├── Load audio
#    │
#    ├── Detect BPM
#    │
#    ├── Detect Key
#    │
#    ├── Calculate Duration
#    │
#    └── Build JSON
#           │
#           ▼
#        Electron
