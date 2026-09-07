import { fileURLToPath } from 'node:url'
import { build, type Rollup } from 'vite'
import { describe, expect, test, vi } from 'vitest'
import { preloadSiteScene } from './scene/lazySiteScene'

const sceneImport = vi.hoisted(() => ({ attempts: 0 }))
vi.mock('./scene/SiteScene', () => {
  sceneImport.attempts += 1
  if (sceneImport.attempts === 1) throw new Error('transient chunk failure')
  return { default: () => null }
})

describe('site scene bundle', () => {
  test('test_preload_scene_after_rejection_retries_successful_site_entry', async () => {
    void preloadSiteScene()
    await new Promise((resolve) => setTimeout(resolve, 0))

    await expect(preloadSiteScene()).resolves.toBeDefined()
    expect(sceneImport.attempts).toBe(2)
  })

  test('test_initial_map_without_scene_request_excludes_webgl_modules', async () => {
    const result = await build({
      root: fileURLToPath(new URL('..', import.meta.url)),
      logLevel: 'silent',
      build: { write: false },
    })
    const output = (Array.isArray(result) ? result[0] : result) as Rollup.RollupOutput
    const chunks = new Map(
      output.output
        .filter((item): item is Rollup.OutputChunk => item.type === 'chunk')
        .map((chunk) => [chunk.fileName, chunk]),
    )
    const entry = [...chunks.values()].find((chunk) => chunk.isEntry)
    expect(entry).toBeDefined()

    const initialChunks = new Set<string>()
    const visit = (chunk: Rollup.OutputChunk) => {
      if (initialChunks.has(chunk.fileName)) return
      initialChunks.add(chunk.fileName)
      for (const imported of chunk.imports) {
        const dependency = chunks.get(imported)
        if (dependency) visit(dependency)
      }
    }
    visit(entry!)

    const initialModules = [...initialChunks].flatMap((fileName) =>
      Object.keys(chunks.get(fileName)!.modules),
    )
    expect(
      initialModules.filter((id) =>
        /node_modules\/(?:three|@react-three\/fiber|@react-three\/drei)\//.test(id),
      ),
    ).toEqual([])
  }, 30_000)
})
