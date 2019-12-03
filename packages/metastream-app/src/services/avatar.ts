import { assetUrl } from 'utils/appUrl'

interface AvatarType {
  name: string
  resolver: (...args: string[]) => string | undefined
}

/** Unprocessed avatar entry. */
interface RawAvatarEntry {
  type: string
  params: string[]

  /** Artist */
  artist?: string

  /** Link to artist. */
  href?: string

  /** Whether avatar uri may contain Personally identifiable information */
  pii?: boolean
}

export interface AvatarEntry extends RawAvatarEntry {
  /** Unresolved avatar URI. */
  uri: string

  /** Resolved URL for avatar. */
  src: string
}

let avatarRegistry: AvatarRegistry | undefined

/** Avatar registry with support for multiple sources and URL resolution. */
export class AvatarRegistry implements ArrayLike<AvatarEntry> {
  static getInstance() {
    if (!avatarRegistry) {
      avatarRegistry = new AvatarRegistry()
      initAppAvatars()
    }
    return avatarRegistry
  }

  private types: Map<AvatarType['name'], AvatarType['resolver']> = new Map()
  private avatars: AvatarEntry[] = []

  readonly [n: number]: AvatarEntry
  get length() {
    return this.avatars.length
  }

  private constructor() {}

  /** Register avatar type. */
  registerType(name: AvatarType['name'], resolver: AvatarType['resolver']): void {
    this.types.set(name, resolver)
  }

  /** Register avatar. */
  register(avatar: RawAvatarEntry): AvatarEntry {
    const resolver = this.types.get(avatar.type)

    if (!resolver) {
      throw new Error(`Attempt to register avatar with unknown type '${avatar.type}'`)
    }

    const src = resolver(...avatar.params)
    if (!src) {
      throw new Error(`Attempt to register avatar with invalid params '${avatar.params.join(',')}'`)
    }

    const uri = `${avatar.type}:${avatar.params.join(',')}`
    const entry = { ...avatar, uri, src }
    this.avatars.push(entry)
    return entry
  }

  /** Resolve avatar URI. */
  resolve(uri: string): string | undefined {
    const [typeName, _params] = uri.split(':')
    const params = _params.split(',')

    const resolver = this.types.get(typeName)
    if (!resolver) {
      throw new Error(`Attempt to resolve avatar with unknown type '${typeName}'`)
    }

    return resolver(...params)
  }

  getAll(): AvatarEntry[] {
    return this.avatars
  }

  getByURI(uri: string) {
    return this.avatars.find(avatar => avatar.uri === uri)
  }

  deleteByURI(uri: string) {
    this.avatars = this.avatars.filter(avatar => avatar.uri !== uri)
  }
}

function initAppAvatars() {
  const reg = AvatarRegistry.getInstance()

  reg.registerType('asset', (fileName: string) => {
    if (fileName && fileName.indexOf('..') > -1) return
    return assetUrl(`avatars/${fileName}`)
  })

  const localAvatars = ['default.svg']

  localAvatars.forEach(fileName => {
    reg.register({ type: 'asset', params: [fileName] })
  })

  const artistAvatars = [
    {
      name: '@Alisa_Aydin',
      href: 'https://twitter.com/Alisa_Aydin',
      fileNames: [
        'alisa-aydin_luna.png',
        'alisa-aydin_sailor-moon.png',
        'alisa-aydin_luna-zoom.png'
      ]
    }
  ]

  artistAvatars.forEach(artist => {
    artist.fileNames.forEach(fileName => {
      reg.register({
        type: 'asset',
        artist: artist.name,
        href: artist.href,
        params: [fileName]
      })
    })
  })
}
