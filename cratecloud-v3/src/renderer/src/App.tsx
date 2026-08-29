import React from 'react'

function App(): React.JSX.Element {
  // async function handleTestDatabase(): Promise<void> {
  //   // Insert a fake track
  //   const insert = await window.api.db.insertTrack({
  //     filepath: '/test/solar-apex.mp3',
  //     filename: 'solar-apex.mp3',
  //     title: 'Solar Apex',
  //     artist: 'Kenji Rō',
  //     album: null,
  //     genre: 'Tech House',
  //     year: null,
  //     remixer: null,
  //     composer: null,
  //     comment: null,
  //     label: null,
  //     grouping: null,
  //     bpm: 128,
  //     key_camelot: '8A',
  //     key_full: 'A minor',
  //     camelot: '8A',
  //     openkey: '1m',
  //     duration_sec: 240,
  //     duration_str: '4:00',
  //     file_size_mb: 8.4,
  //     format: 'MP3',
  //     artwork_path: null,
  //     analyzed_at: new Date().toISOString()
  //   })
  //   console.log('Insert track', insert)

  //   // 2. Check what the comment parser would produce
  //   // Simulating a file that already has 'FTW CLASSIC HEADZ' in its comment
  //   const candidates = await window.api.tags.checkCandidates(['FTW', 'CLASSIC', 'HEADZ'], 'label')
  //   console.log('2. Tag candidates:', candidates)

  //   // 3. Confirm the import — this creates the tags and links them
  //   const confirm = await window.api.tags.confirmImport(
  //     0, // pendingId 0 for test — no real pending row
  //     insert.id!,
  //     ['FTW', 'CLASSIC', 'HEADZ'],
  //     'label'
  //   )
  //   console.log('3. Confirm import:', confirm)

  //   // 4. Read back the tags on that track
  //   const trackTags = await window.api.tags.forTrack(insert.id!)
  //   console.log('4. Track tags:', trackTags)

  //   // 5. Find all tracks with the FTW tag
  //   const allTags = await window.api.tags.all()
  //   console.log('5. All tags in library:', allTags)

  //   // Read all tracks back
  //   const tracks = await window.api.db.allTracks()
  //   console.log('Track count:', tracks.length)
  //   console.log('All tracks:', tracks)

  //   // Create a tag and apply it
  //   const tagResult = await window.api.tags.apply(
  //     insert.id!,
  //     // findOrCreateTag runs in main process — test via a track insert
  //     1
  //   )
  //   console.log('Tag applied:', tagResult)

  //   // Read all boards
  //   const boards = await window.api.boards.all()
  //   console.log('Boards:', boards)
  // }

  async function handleAnalyzeFile(): Promise<{ ok: boolean; data?: AnalysisResult; error?: string }>
 {
    // Use the folder picker for now — in Phase 6 we add a file picker
    // For testing, hardcode a real path from your drive
    const filepath = '/Volumes/MUSICLITE/Iceman-400/Ha - Remix JUVENILE, Hot Boys.mp3'

    console.log('Analyzing:', filepath)
    const result = await window.api.analyzeFile(filepath)
    console.log('Analysis result:', result)
    return result
  }

  return (
    <div style={{ padding: '2rem', fontFamily: 'monospace' }}>
      <button onClick={handleAnalyzeFile}>Analyze test file</button>
    </div>
  )
}

export default App
