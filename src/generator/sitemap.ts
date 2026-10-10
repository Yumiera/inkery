import type { TemplateData, TemplateEngine } from './template';

export interface SitemapEntry {
  loc: string;
  lastmod: string;
  changefreq: string;
  priority: string;
  images: string[];
}

export function renderSitemap(
  engine: TemplateEngine,
  data: TemplateData,
  entries: SitemapEntry[],
): string {
  return engine.render('feeds/sitemap.ejs', { ...data, entries });
}

export function renderRobots(engine: TemplateEngine, data: TemplateData): string {
  return engine.render('feeds/robots.ejs', { ...data });
}