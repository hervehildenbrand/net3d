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
