// @ts-nocheck
// Re-export Three.js MMD loader dependencies.

const { Scene, PerspectiveCamera, WebGLRenderer, AmbientLight, DirectionalLight } = await import('three')
const { MMDLoader } = await import('three/examples/jsm/loaders/MMDLoader')
const { MMDAnimationHelper } = await import('three/examples/jsm/animation/MMDAnimationHelper')

export { Scene, PerspectiveCamera, WebGLRenderer, AmbientLight, DirectionalLight, MMDLoader, MMDAnimationHelper }
