import React, { PureComponent } from 'react'
import { connect } from 'react-redux'
import cx from 'classnames'
import styles from './VideoPlayer.css'
import { PlaybackState, IMediaPlayerState } from 'lobby/reducers/mediaPlayer'
import { updateMedia, updatePlaybackTimer } from 'lobby/actions/mediaPlayer'
import { clamp } from 'utils/math'
import { MEDIA_REFERRER, MEDIA_SESSION_USER_AGENT } from 'constants/http'
import { assetUrl } from 'utils/appUrl'
import { IAppState } from 'reducers'
import { getPlaybackTime2 } from 'lobby/reducers/mediaPlayer.helpers'
import { isHost } from 'lobby/reducers/users.helpers'
import { isEqual } from 'lodash-es'
import { IReactReduxProps } from 'types/redux-thunk'
import { Webview } from 'components/Webview'
import { ExtensionInstall } from './ExtensionInstall'
import { Icon } from '../Icon'
import { addChat } from '../../lobby/actions/chat'
import { MediaSession } from './MediaSession'
import { getPlayerSettings, PlayerSettings } from '../../reducers/settings'
import { safeBrowse } from 'services/safeBrowse'
import { SafeBrowsePrompt } from './SafeBrowsePrompt'

type MediaReadyPayload = {
  duration?: number
  href: string
}

const processMediaDuration = (payload?: MediaReadyPayload) => {
  if (!payload) return null

  let duration = payload.duration && !isNaN(payload.duration) ? payload.duration : null
  if (!duration) return null

  let shouldPadDuration = false

  const { href } = payload
  if (href.includes('hulu.com')) {
    // Hulu includes rating warning at the start which causes video to skip
    // before it should. #132
    shouldPadDuration = true
  }

  if (shouldPadDuration) {
    duration += 5e3
  }

  return duration
}

interface IProps {
  className?: string
  theRef?: (c: _VideoPlayer | null) => void
  onInteractChange?: (interacting: boolean) => void
}

interface IConnectedProps extends IMediaPlayerState {
  mute: boolean
  volume: number
  host: boolean
  isExtensionInstalled: boolean
  playerSettings: PlayerSettings
  safeBrowseEnabled: boolean
}

interface IState {
  interacting: boolean
  mediaReady: boolean
  permitURLOnce: boolean
}

const DEFAULT_URL = assetUrl('idlescreen.html')

const mapStateToProps = (state: IAppState): IConnectedProps => {
  return {
    ...state.mediaPlayer,
    mute: state.settings.mute,
    volume: state.settings.volume,
    host: isHost(state),
    isExtensionInstalled: state.ui.isExtensionInstalled,
    playerSettings: getPlayerSettings(state),
    safeBrowseEnabled: state.settings.safeBrowse
  }
}

type PrivateProps = IProps & IConnectedProps & IReactReduxProps

class _VideoPlayer extends PureComponent<PrivateProps, IState> {
  private webview: Webview | null = null

  state: IState = { interacting: false, mediaReady: false, permitURLOnce: false }

  get isPlaying() {
    return this.props.playback === PlaybackState.Playing
  }

  get isPaused() {
    return this.props.playback === PlaybackState.Paused
  }

  get mediaUrl() {
    const media = this.props.current
    return media ? media.url : DEFAULT_URL
  }

  // HACK: Set http referrer to itself to avoid referral blocking
  get httpReferrer() {
    const media = this.props.current

    if (media && media.state && media.state.referrer) {
      return MEDIA_REFERRER
    }

    const { mediaUrl } = this

    try {
      const url = new URL(mediaUrl)
      return url.origin
    } catch (e) {
      return mediaUrl
    }
  }

  private get canInteract() {
    return (
      this.props.isExtensionInstalled &&
      (this.props.safeBrowseEnabled
        ? this.state.permitURLOnce || safeBrowse.isPermittedURL(this.mediaUrl)
        : true)
    )
  }

  componentDidMount(): void {
    if (this.props.theRef) {
      this.props.theRef(this)
    }
  }

  componentWillUnmount(): void {
    if (this.props.theRef) {
      this.props.theRef(null)
    }

    this.props.dispatch(updatePlaybackTimer())
  }

  componentDidUpdate(prevProps: PrivateProps): void {
    const { current, playerSettings } = this.props
    const { current: prevMedia } = prevProps

    if (playerSettings !== prevProps.playerSettings) {
      this.dispatchMedia('set-settings', playerSettings)
    }

    if (current !== prevMedia) {
      if (isEqual(current, prevMedia)) {
        // Ignore: new object, same properties
      } else if (current && prevMedia && current.url === prevMedia.url) {
        // Force restart media if new media is the same URL
        this.onMediaReady()
        return
      } else {
        // Update URL on webview otherwise
        if (this.state.permitURLOnce) this.setState({ permitURLOnce: false })
        this.reload()
        return
      }
    }

    if (this.props.playback !== prevProps.playback) {
      this.updatePlayback(this.props.playback)
    }

    if (
      (this.isPlaying && this.props.startTime !== prevProps.startTime) ||
      (this.isPaused && this.props.pauseTime !== prevProps.pauseTime)
    ) {
      this.updatePlaybackTime()
    }

    if (this.props.volume !== prevProps.volume || this.props.mute !== prevProps.mute) {
      this.updateVolume()
    }
  }

  private setupWebview = (webview: Webview | null): void => {
    const prevWebview = this.webview
    this.webview = webview

    if (prevWebview) {
      prevWebview.removeEventListener('message', this.onIpcMessage)
      prevWebview.removeEventListener('ready', this.reload)
    }
    if (this.webview) {
      this.webview.addEventListener('message', this.onIpcMessage)
      this.webview.addEventListener('ready', this.reload)
    }
  }

  private dispatchMedia(type: string, payload: any) {
    window.postMessage(
      { type: 'metastream-host-event', payload: { type, payload } },
      location.origin
    )
  }

  private onIpcMessage = (action: any, ...args: any[]) => {
    if (typeof action !== 'object' || typeof action.payload !== 'object') return
    console.log('Received VideoPlayer IPC message', action)
    const isTopSubFrame = !!args[0]

    switch (action.type) {
      case 'media-ready':
        this.onMediaReady(isTopSubFrame, action.payload)
        break
      case 'media-autoplay-error':
        this.onAutoplayError(action.payload.error)
        break
    }
  }

  private onMediaReady = (isTopSubFrame: boolean = false, payload?: MediaReadyPayload) => {
    console.debug('onMediaReady', payload)

    if (!this.state.mediaReady) {
      this.setState({ mediaReady: true })
    }

    this.dispatchMedia('set-settings', this.props.playerSettings)

    // Apply auto-fullscreen to all subframes with nested iframes
    if (!isTopSubFrame && payload) {
      this.dispatchMedia('apply-fullscreen', payload.href)
    }

    this.updatePlaybackTime()
    this.updatePlayback(this.props.playback)
    this.updateVolume()

    const media = this.props.current
    if (this.props.host) {
      const prevDuration = media ? media.duration : null
      const nextDuration = processMediaDuration(payload)

      const isLiveMedia = prevDuration === 0
      const noDuration = !prevDuration
      const isLongerDuration = nextDuration && (prevDuration && nextDuration > prevDuration)

      if (nextDuration && !isLiveMedia && (noDuration || isLongerDuration)) {
        this.props.dispatch(updateMedia({ duration: nextDuration }))
        this.props.dispatch(updatePlaybackTimer())
      }
    }
  }

  private onAutoplayError = (error: string) => {
    if (error !== 'NotAllowedError') return

    const hasShownNotice = Boolean(sessionStorage.getItem('autoplayNotice'))
    if (hasShownNotice) return

    const content =
      '⚠️ Autoplay permissions are blocked. Enable autoplay in your browser for a smoother playback experience. Reload the video if it doesn’t start.'
    this.props.dispatch(addChat({ content, timestamp: Date.now() }))

    try {
      sessionStorage.setItem('autoplayNotice', '1')
    } catch {}
  }

  private updatePlaybackTime = () => {
    const { current: media } = this.props

    if (media && media.duration === 0) {
      console.debug('Preventing updating playback since duration indicates livestream')
      return // live stream
    }

    let time = getPlaybackTime2(this.props)

    if (typeof time === 'number') {
      console.log('Sending seek IPC message', time)
      this.dispatchMedia('seek-media', time)
    }
  }

  private updatePlayback = (state: PlaybackState) => {
    this.dispatchMedia('set-media-playback', state)
  }

  private updateVolume = () => {
    const { volume, mute } = this.props

    const newVolume = mute ? 0 : volume
    this.dispatchMedia('set-media-volume', this.scaleVolume(newVolume))
  }

  /**
   * Use dB scale to convert linear volume to exponential.
   * https://www.dr-lex.be/info-stuff/volumecontrols.html
   */
  private scaleVolume(volume: number): number {
    return volume === 0 ? 0 : clamp(Math.exp(6.908 * volume) / 1000, 0, 1)
  }

  render(): JSX.Element | null {
    return (
      <div
        className={cx(styles.container, this.props.className)}
        onDoubleClick={this.enterInteractMode}
      >
        {this.renderMediaSession()}
        {this.renderInteract()}
        {this.renderBrowser()}
      </div>
    )
  }

  private renderMediaSession() {
    if (!('mediaSession' in navigator)) return
    return (
      <MediaSession
        playing={this.props.playback === PlaybackState.Playing}
        muted={this.props.mute || this.props.volume === 0}
      />
    )
  }

  private renderBrowser() {
    const { mediaUrl } = this

    if (!this.props.isExtensionInstalled) {
      return <ExtensionInstall />
    }

    if (
      this.props.safeBrowseEnabled &&
      !this.state.permitURLOnce &&
      !safeBrowse.isPermittedURL(mediaUrl)
    ) {
      return (
        <SafeBrowsePrompt
          url={mediaUrl}
          onChange={() => this.forceUpdate()}
          onPermitOnce={() => {
            this.setState({ permitURLOnce: true })
          }}
        />
      )
    }

    return (
      <Webview
        componentRef={this.setupWebview}
        src={DEFAULT_URL}
        className={cx(styles.video, {
          [styles.interactive]: this.state.interacting,
          [styles.playing]: !!this.props.current,
          [styles.mediaReady]: this.state.mediaReady
        })}
        allowScripts
      />
    )
  }

  private renderInteract = () => {
    // Allow interacting with extension install
    if (!this.canInteract) return

    return this.state.interacting ? (
      <button className={styles.interactNotice} onClick={this.exitInteractMode}>
        ⚠️ Interact mode enabled. Changes will only affect your local web browser. ⚠️
        <Icon name="x" pointerEvents="none" className={styles.btnExitInteract} />
      </button>
    ) : (
      <div className={styles.interactTrigger} onDoubleClick={this.enterInteractMode} />
    )
  }

  reload = () => {
    this.updatePlayback(PlaybackState.Paused)
    this.setState({ mediaReady: false })
    if (this.webview) {
      this.webview.loadURL(this.mediaUrl, {
        httpReferrer: this.httpReferrer,
        userAgent: MEDIA_SESSION_USER_AGENT
      })
    }
  }

  enterInteractMode = () => {
    if (!this.canInteract) return

    this.setState({ interacting: true }, () => {
      document.addEventListener('keydown', this.onKeyDown, false)
      this.dispatchMedia('set-interact', true)
      if (this.props.onInteractChange) {
        this.props.onInteractChange(this.state.interacting)
      }
    })
  }

  exitInteractMode = () => {
    document.removeEventListener('keydown', this.onKeyDown, false)
    this.dispatchMedia('set-interact', false)
    this.setState({ interacting: false }, () => {
      if (this.props.onInteractChange) {
        this.props.onInteractChange(this.state.interacting)
      }
    })
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    switch (event.key) {
      case 'Escape':
        this.exitInteractMode()
        return
    }
  }
}

export type VideoPlayer = _VideoPlayer
export const VideoPlayer = connect(mapStateToProps)(_VideoPlayer as any) as React.ComponentClass<
  IProps
>
