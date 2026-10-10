import { Hono } from 'hono';
import { pagesUrl, resolveDeploySettings } from '../../deploy/publish';
import { VERSION } from '../../version';
import type { ServerContext } from '../app';

/** 唯一免令牌的接口：只暴露非敏感状态，同时负责下发令牌 cookie */
export function createMetaRoutes(ctx: ServerContext): Hono {
  const app = new Hono();

  app.get('/meta', (c) => {
    const { config } = ctx.loaded;
    const resolved = resolveDeploySettings(ctx.loaded);
    return c.json({
      version: VERSION,
      mode: ctx.mode,
      buildState: ctx.builds.state,
      deploy: {
        configured: resolved.settings !== null,
        enabled: config.deploy.enabled,
        type: config.deploy.type,
        repo: resolved.settings?.repo ?? config.deploy.repo.trim(),
        branch: resolved.settings?.branch ?? config.deploy.branch,
        cname: resolved.settings?.cname ?? '',
        pagesUrl: resolved.settings ? pagesUrl(resolved.settings.repo, resolved.settings.cname) : null,
        reason: resolved.reason,
        warnings: resolved.warnings,
      },
      deployState: ctx.deploys.state,
      siteUrl: config.site.url,
      liveReloadClients: ctx.hub.size,
      lastBuild: ctx.builds.latest,
      lastDeploy: ctx.deploys.latest,
    });
  });

  return app;
}