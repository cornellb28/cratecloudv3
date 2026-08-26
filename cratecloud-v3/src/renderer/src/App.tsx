import { useState } from 'react'

function App(): React.JSX.Element {
  const [folderPath, setFolderPath] = useState<string | null>(null)

  async function handlePickFolder(): Promise<void> {
    const path = await window.api.openFolder()
    if (path) setFolderPath(path)
  }

  return (
    <div style={{ padding: '2rem', fontFamily: 'monospace' }}>
      <button onClick={handlePickFolder}>Pick music folder</button>
      {folderPath && <p style={{ marginTop: '1rem', color: '#1d9e75' }}>Selected: {folderPath}</p>}
      {!folderPath && <p style={{ marginTop: '1rem', color: '#555' }}>No folder selected yet</p>}
    </div>
  )
}

export default App
