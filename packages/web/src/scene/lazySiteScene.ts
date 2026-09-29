import { lazy } from 'react'

const importSiteScene = () => import('./SiteScene')
let scenePromise: ReturnType<typeof importSiteScene> | undefined

export const preloadSiteScene = () => {
  if (scenePromise) return scenePromise
  const pending = importSiteScene()
  scenePromise = pending
  void pending.catch(() => {
    if (scenePromise === pending) scenePromise = undefined
  })
  return pending
}
export const LazySiteScene = lazy(preloadSiteScene)

// Site diagram lazy loading (no three.js)
const importSiteDiagram = () => import('../diagram/SiteDiagram')
let diagramPromise: ReturnType<typeof importSiteDiagram> | undefined

export const preloadSiteDiagram = () => {
  if (diagramPromise) return diagramPromise
  const pending = importSiteDiagram()
  diagramPromise = pending
  void pending.catch(() => {
    if (diagramPromise === pending) diagramPromise = undefined
  })
  return pending
}
export const LazySiteDiagram = lazy(preloadSiteDiagram)
