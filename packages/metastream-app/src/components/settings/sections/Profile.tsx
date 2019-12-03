import React, { Component } from 'react'
import { connect, DispatchProp } from 'react-redux'
import styles from '../SettingsMenu.css'
import { TextInput } from 'components/common/input'
import { IAppState } from 'reducers'
import { getLocalUsername, getLocalColor, getLocalAvatar } from 'reducers/settings'
import { USERNAME_MAX_LEN } from 'constants/settings'
import { setUsername, setColor } from 'actions/settings'
import { t } from 'locale'
import { AvatarRegistry } from '../../../services/avatar'
import { UserAvatar } from '../../lobby/UserAvatar'
import { ExternalLink } from 'components/common/link'
import { Trans } from 'react-i18next'
import { SettingsProps } from '../types'
import { server_updateUser } from '../../../lobby/actions/users'
import { IReactReduxProps } from '../../../types/redux-thunk'

interface IProps extends SettingsProps {}

interface IConnectedProps {
  avatar?: string
  username: string
  color: string
}

type Props = IProps & IConnectedProps & IReactReduxProps

interface State {
  dirty?: boolean
}

class ProfileSettings extends Component<Props, State> {
  state: State = {}

  private usernameInput: HTMLInputElement | null = null

  private get username() {
    return this.usernameInput && this.usernameInput.value
  }

  private get selectedAvatar() {
    const { avatar } = this.props
    return avatar ? AvatarRegistry.getInstance().getByURI(avatar) : null
  }

  componentWillUnmount() {
    if (this.state.dirty) {
      this.props.dispatch(
        server_updateUser({
          name: this.props.username,
          color: this.props.color,
          avatar: this.props.avatar
        })
      )
    }
  }

  render(): JSX.Element | null {
    const { selectedAvatar } = this
    const hasArtist = selectedAvatar ? !!selectedAvatar.artist : false
    return (
      <section className={styles.section}>
        <label>{t('avatar')}</label>
        <div className={styles.avatarContainer}>
          <div className={styles.avatarList}>
            {AvatarRegistry.getInstance()
              .getAll()
              .map((avatar, idx) => (
                <UserAvatar
                  key={idx}
                  avatar={avatar.src}
                  selected={avatar.uri === this.props.avatar}
                  onClick={() => {
                    this.props.setSetting('avatar', avatar.uri)
                    this.setState({ dirty: true })
                    ga('event', {
                      ec: 'settings',
                      ea: 'select_avatar',
                      el: avatar.pii ? avatar.type : avatar.uri
                    })
                  }}
                />
              ))}
          </div>
          {hasArtist && (
            <div className={styles.small}>
              {/* prettier-ignore */}
              <Trans i18nKey="avatarCredit" values={{ artist: selectedAvatar!.artist }}>
                <span className={styles.blend}>Selected avatar art by</span>
                {selectedAvatar!.href ? (
                  <ExternalLink href={selectedAvatar!.href!} className="link-alt">Unknown</ExternalLink>
                ) : (
                  <span className={styles.blend}>Unknown</span>
                )}
              </Trans>
            </div>
          )}
        </div>

        <label htmlFor="profile_username">{t('displayName')}</label>
        <TextInput
          id="profile_username"
          theRef={e => (this.usernameInput = e)}
          defaultValue={this.props.username}
          maxLength={USERNAME_MAX_LEN}
          onChange={this.onChangeUsername}
          onBlur={e => {
            if (this.usernameInput) {
              this.usernameInput.value = this.props.username
            }
          }}
        />

        <label htmlFor="profile_color">{t('chatColor')}</label>
        <input
          id="profile_color"
          type="color"
          className={styles.colorSwatch}
          defaultValue={this.props.color}
          onChange={e => {
            this.props.dispatch(setColor(e.target!.value))
            this.setState({ dirty: true })
          }}
        />
      </section>
    )
  }

  // TODO: debounce
  private onChangeUsername = () => {
    const { username } = this
    if (!username) return

    if (username !== this.props.username) {
      this.props.dispatch(setUsername(username))
      this.setState({ dirty: true })
    }
  }
}

export default connect(
  (state: IAppState): IConnectedProps => {
    return {
      avatar: getLocalAvatar(state),
      username: getLocalUsername(state),
      color: getLocalColor(state)
    }
  }
)(ProfileSettings) as React.ComponentClass<IProps>
