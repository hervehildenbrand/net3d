import { fileURLToPath } from 'node:url'
import { build, type Rollup } from 'vite'
import { describe, expect, test, vi, beforeAll } from 'vitest'
import { preloadSiteScene } from './scene/lazySiteScene'

const sceneImport = vi.hoisted(() => ({ attempts: 0 }))
vi.mock('./scene/SiteScene', () => {
  sceneImport.attempts += 1
  if (sceneImport.attempts === 1) throw new Error('transient chunk failure')
  return { default: () => null }
})

// Hoisted build for chunk analysis
let chunks: Map<string, Rollup.OutputChunk>
let entryChunk: Rollup.OutputChunk | undefined

beforeAll(async () => {
  const result = await build({
    root: fileURLToPath(new URL('..', import.meta.url)),
    logLevel: 'silent',
    build: { write: false },
  })
  const output = (Array.isArray(result) ? result[0] : result) as Rollup.RollupOutput
  chunks = new Map(
    output.output
      .filter((item): item is Rollup.OutputChunk => item.type === 'chunk')
      .map((chunk) => [chunk.fileName, chunk]),
  )
  entryChunk = [...chunks.values()].find((chunk) => chunk.isEntry)
}, 60_000)

describe('site scene bundle', () => {
  test('test_preload_scene_after_rejection_retries_successful_site_entry', async () => {
    void preloadSiteScene()
    await new Promise((resolve) => setTimeout(resolve, 0))

    await expect(preloadSiteScene()).resolves.toBeDefined()
    expect(sceneImport.attempts).toBe(2)
  })

  test('test_initial_map_without_scene_request_excludes_webgl_modules', async () => {
    expect(entryChunk).toBeDefined()

    const initialChunks = new Set<string>()
    const visit = (chunk: Rollup.OutputChunk) => {
      if (initialChunks.has(chunk.fileName)) return
      initialChunks.add(chunk.fileName)
      for (const imported of chunk.imports) {
        const dependency = chunks.get(imported)
        if (dependency) visit(dependency)
      }
    }
    visit(entryChunk!)

    const initialModules = [...initialChunks].flatMap((fileName) =>
      Object.keys(chunks.get(fileName)!.modules),
    )
    expect(
      initialModules.filter((id) =>
        /node_modules\/(?:three|@react-three\/fiber|@react-three\/drei)\//.test(id),
      ),
    ).toEqual([])
  })

  test('test_initial_map_excludes_site_diagram_modules', async () => {
    expect(entryChunk).toBeDefined()

    const initialChunks = new Set<string>()
    const visit = (chunk: Rollup.OutputChunk) => {
      if (initialChunks.has(chunk.fileName)) return
      initialChunks.add(chunk.fileName)
      for (const imported of chunk.imports) {
        const dependency = chunks.get(imported)
        if (dependency) visit(dependency)
      }
    }
    visit(entryChunk!)

    const initialModules = [...initialChunks].flatMap((fileName) =>
      Object.keys(chunks.get(fileName)!.modules),
    )
    // The entry chunk and its static imports should not include src/diagram/
    expect(
      initialModules.filter((id) => /\/src\/diagram\//.test(id)),
    ).toEqual([])
  })

  test('test_siteDiagram_chunk_excludes_webgl_modules', async () => {
    // Find the chunk containing SiteDiagram.tsx
    const diagramChunk = [...chunks.values()].find((chunk) =>
      Object.keys(chunk.modules).some((id) => /\/src\/diagram\/SiteDiagram\.tsx/.test(id)),
    )
    expect(diagramChunk).toBeDefined()

    // Collect all modules in this chunk and its static imports
    const diagramChunks = new Set<string>()
    const visit = (chunk: Rollup.OutputChunk) => {
      if (diagramChunks.has(chunk.fileName)) return
      diagramChunks.add(chunk.fileName)
      for (const imported of chunk.imports) {
        const dependency = chunks.get(imported)
        if (dependency) visit(dependency)
      }
    }
    visit(diagramChunk!)

    const diagramModules = [...diagramChunks].flatMap((fileName) =>
      Object.keys(chunks.get(fileName)!.modules),
    )

    // The diagram chunk should not include three or @react-three
    expect(
      diagramModules.filter((id) =>
        /node_modules\/(?:three|@react-three\/fiber|@react-three\/drei)\//.test(id),
      ),
    ).toEqual([])
  })
})
