import { lazy } from 'react'

const importSiteScene = () => import('./SiteScene')
let scenePromise: ReturnType<typeof importSiteScene> | undefined

export const preloadSiteScene = () => (scenePromise ??= importSiteScene())
export const LazySiteScene = lazy(preloadSiteScene)
