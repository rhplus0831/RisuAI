export interface hubType {
  name: string
  desc: string
  download: string
  id: string
  img: string
  tags: string[]
  viewScreen: 'none' | 'emotion' | 'imggen'
  hasLore: boolean
  hasEmotion: boolean
  hasAsset: boolean
  creator?: string
  creatorName?: string
  hot: number
  license: string
  authorname?: string
  original?: string
  type: string
  hidden?: boolean
}
