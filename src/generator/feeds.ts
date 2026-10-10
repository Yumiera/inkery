import type { TemplateData, TemplateEngine } from './template';
import type { PostView } from './template';

export const FEED_FILE = 'feed.xml';

/** RSS 2.0，正文走 content:encoded CDATA；链接一律用绝对 URL */
export function renderRss(engine: TemplateEngine, data: TemplateData, posts: PostView[]): string {
  const latest = posts[0];
  const buildDate = latest ? data.helpers.rfc822(latest.updated || latest.date) : data.buildTime;
  return engine.render('feeds/rss.ejs', {
    ...data,
    posts,
    feed: {
      buildDate,
      selfUrl: data.helpers.absolute(`/${FEED_FILE}`),
      homeUrl: data.helpers.absolute('/'),
    },
  });
}