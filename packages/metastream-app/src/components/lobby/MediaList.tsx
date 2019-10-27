import React, { Component } from 'react'
import { connect } from 'react-redux'

import { IAppState } from '../../reducers'
import { IMediaItem } from '../../lobby/reducers/mediaPlayer'
import {
  getCurrentMedia,
  getMediaQueue,
  hasPlaybackPermissions
} from '../../lobby/reducers/mediaPlayer.helpers'
import {
  server_requestDeleteMedia,
  server_requestMoveToTop,
  sendMediaRequest,
  server_requestToggleQueueLock
} from '../../lobby/actions/mediaPlayer'

import { HighlightButton, IconButton } from '../common/button'
import { ListOverlay } from './ListOverlay'

import MenuItem from '@material-ui/core/MenuItem'
import { MediaItem } from '../media/MediaItem'
import { localUser } from 'network'
import { copyMediaLink, openMediaInBrowser } from '../../media/utils'
import { IReactReduxProps } from 'types/redux-thunk'
import { withNamespaces, WithNamespaces } from 'react-i18next'

interface IProps {
  className?: string
  onAddMedia(): void
  onShowInfo(media?: IMediaItem): void
}

interface IConnectedProps {
  hasPlaybackPermissions: boolean
  currentMedia?: IMediaItem
  mediaQueue: IMediaItem[]
  mediaQueueLocked: boolean
}

type Props = IProps & IConnectedProps & IReactReduxProps & WithNamespaces

class _MediaList extends Component<Props> {
  private listOverlay: ListOverlay<IMediaItem> | null = null

  private get hasRequested() {
    return (parseInt(localStorage.getItem('requestCount') || '0', 10) || 0) > 0
  }

  private get mediaList() {
    const { currentMedia, mediaQueue } = this.props
    return currentMedia && currentMedia.hasMore ? [currentMedia, ...mediaQueue] : mediaQueue
  }

  private get isQueueEmpty() {
    return this.mediaList.length === 0
  }

  render(): JSX.Element | null {
    const { t } = this.props
    return (
      <ListOverlay
        ref={(e: any) => (this.listOverlay = e)}
        className={this.props.className}
        title={t('nextUp')}
        tagline={this.props.mediaQueue.length ? `${this.props.mediaQueue.length}` : undefined}
        action={
          <>
            {this.renderQueueLock()}
            {this.renderAddMedia()}
          </>
        }
        renderMenuOptions={(media: IMediaItem, close) => {
          let items = [
            {
              label: t('openInBrowser'),
              onClick: () => openMediaInBrowser(media)
            },
            {
              label: t('copyLink'),
              onClick: () => copyMediaLink(media)
            }
          ]

          if (media.description) {
            items = [
              ...items,
              {
                label: t('info'),
                onClick: () => this.props.onShowInfo(media)
              }
            ]
          }

          if (this.props.hasPlaybackPermissions) {
            items = [
              ...items,
              {
                label: t('moveToTop'),
                onClick: () => this.props.dispatch!(server_requestMoveToTop(media.id))
              },
              {
                label: t('duplicate'),
                onClick: () =>
                  this.props.dispatch!(
                    sendMediaRequest({
                      url: media.requestUrl,
                      source: 'media-context-menu-duplicate'
                    })
                  )
              },
              {
                label: t('remove'),
                onClick: () => this.props.dispatch!(server_requestDeleteMedia(media.id))
              }
            ]
          }

          return items.map((item, idx) => (
            <MenuItem
              key={idx}
              onClick={() => {
                item.onClick()
                close()
              }}
              dense
            >
              {item.label}
            </MenuItem>
          ))
        }}
      >
        {this.mediaList.map(media => {
          return (
            <MediaItem
              key={media.id}
              media={media}
              onClickMenu={e => {
                this.listOverlay!.onSelect(e, media)
              }}
            />
          )
        })}
      </ListOverlay>
    )
  }

  private renderQueueLock() {
    const { t, hasPlaybackPermissions, mediaQueueLocked: locked } = this.props
    if (!hasPlaybackPermissions && !locked) return

    const title = hasPlaybackPermissions ? t(locked ? 'unlockQueue' : 'lockQueue') : undefined

    return (
      <IconButton
        icon={locked ? 'lock' : 'unlock'}
        iconSize="small"
        title={title}
        disabled={!hasPlaybackPermissions}
        onClick={() => {
          this.props.dispatch!(server_requestToggleQueueLock())
        }}
      />
    )
  }

  private renderAddMedia() {
    const { isQueueEmpty } = this
    const { t, currentMedia, mediaQueueLocked, hasPlaybackPermissions } = this.props

    if (!hasPlaybackPermissions && mediaQueueLocked) return

    return (
      <HighlightButton
        icon="plus"
        highlight={(!currentMedia && isQueueEmpty) || !this.hasRequested}
        onClick={() => {
          if (this.props.onAddMedia) {
            this.props.onAddMedia()
          }
        }}
        title={t('add')}
      />
    )
  }
}

export const MediaList = withNamespaces()(
  connect(
    (state: IAppState): IConnectedProps => ({
      hasPlaybackPermissions: hasPlaybackPermissions(state, localUser()),
      currentMedia: getCurrentMedia(state),
      mediaQueue: getMediaQueue(state),
      mediaQueueLocked: state.mediaPlayer.queueLocked
    })
  )(_MediaList)
)
