import { load } from 'cheerio'
import { IMediaMiddleware } from '../types'
import { fetchText } from 'utils/http'
import { MEDIA_USER_AGENT } from 'constants/http'

const mware: IMediaMiddleware = {
  match({ protocol }) {
    return protocol === 'http:' || protocol === 'https:'
  },

  async resolve(ctx, next) {
    const { url } = ctx.req

    // Skip if HEAD request fails to avoid fetching huge blobs of data
    if (ctx.state.httpHeadFailed) {
      return next()
    }

    let text

    try {
      const result = await fetchText(url.href, {
        headers: ctx.state.disableGooglebot
          ? {}
          : {
              'user-agent': MEDIA_USER_AGENT,
              host: url.host
            }
      })
      text = result[0]
    } catch {
      return next()
    }

    ctx.state.body = text
    const $ = (ctx.state.$ = load(text))

    // prettier-ignore
    ctx.res.title = $('title').text().trim() || ctx.res.title

    return next()
  }
}

export default mware
