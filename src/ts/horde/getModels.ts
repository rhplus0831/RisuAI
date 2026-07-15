interface HordeModel {
  performance: number
  queued: number
  jobs: number
  eta: number
  type: 'text'
  name: string
  count: number
}

let modelList: HordeModel[] | null = null
let modelRequest: Promise<HordeModel[]> | null = null

export async function getHordeModels(): Promise<HordeModel[]> {
  if (modelList) return modelList
  if (modelRequest) return modelRequest

  modelRequest = (async () => {
    try {
      const response = await fetch('https://stablehorde.net/api/v2/status/models?type=text')
      if (!response.ok) return []

      const body: unknown = await response.json()
      if (!Array.isArray(body) || !body.every(isHordeModel)) return []

      modelList = body
      return modelList
    } catch {
      return []
    } finally {
      modelRequest = null
    }
  })()

  return modelRequest
}

function isHordeModel(value: unknown): value is HordeModel {
  if (!value || typeof value !== 'object') return false
  const model = value as Record<string, unknown>
  return typeof model.name === 'string' && model.name.trim().length > 0 && typeof model.performance === 'number'
}
