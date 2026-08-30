/**
 * Resolves which property (IP) a request belongs to, and hides the internal
 * page tree behind the clean public URLs.
 *
 * One deployment serves the whole slate. The build emits one tree per
 * property (dist/hybris/…, dist/ned/…) because a static build can't emit two
 * different /index.html; this middleware maps the request host onto the right
 * tree, so the public URLs stay `/` and `/d/<slug>` on every domain.
 *
 * This is the ONLY place that calls `propertyForHost`. The Functions read
 * `context.data.property` — same reasoning as `canAccess()` living in one
 * file: a second resolver is how two answers to the same question appear.
 */
import { fileFor } from '../shared/files';
import {
  DEFAULT_PROPERTY,
  PROPERTY_BY_SLUG,
  isDevHost,
  propertyForHost,
  type Property,
} from '../shared/properties';

export interface MiddlewareData extends Record<string, unknown> {
  property: Property;
}

function notFound(): Response {
  return new Response('Not found', { status: 404 });
}

/** Same request, different path. The query string travels along. */
function rewrite(request: Request, url: URL, pathname: string): Request {
  return new Request(new URL(pathname + url.search, url), request);
}

export const onRequest: PagesFunction<unknown, string, MiddlewareData> = async (
  context
) => {
  const { request, next, data } = context;
  const url = new URL(request.url);
  const host = url.hostname.toLowerCase();
  const dev = isDevHost(host);

  // An unknown host gets nothing. No suffix match, no falling through to the
  // first property.
  const property = propertyForHost(host) ?? (dev ? DEFAULT_PROPERTY : null);
  if (!property) return notFound();
  data.property = property;

  const path = url.pathname;

  // Host-agnostic Function routes: annotate and get out of the way. The stats
  // URL is a credential, not a domain — it works from either host.
  if (path === '/api/download' || path.startsWith('/stats/')) return next();

  // The internal prefix is not a public URL. `dist/ned/d/x/index.html` is a
  // real object in the deployment, and without this rule Pages would happily
  // serve it at files.hybris.world/ned/d/x/. On dev hosts (localhost, Pages
  // previews) browsing the prefixes directly is the only way to reach another
  // property, so it stays open there.
  const firstSegment = path.split('/')[1] ?? '';
  if (PROPERTY_BY_SLUG[firstSegment]) return dev ? next() : notFound();

  if (path === '/') return next(rewrite(request, url, `/${property.slug}/`));

  const match = path.match(/^\/d\/([^/]+)\/?$/);
  if (match) {
    // A slug from another property is indistinguishable from a typo.
    if (!fileFor(property.slug, match[1])) return notFound();

    // Ours, not Cloudflare's: after the rewrite the automatic trailing-slash
    // redirect would be computed on the internal path and put
    // "/hybris/d/…" in the address bar. Redirect on the public path first.
    if (!path.endsWith('/')) {
      return Response.redirect(`${url.origin}${path}/${url.search}`, 308);
    }

    return next(rewrite(request, url, `/${property.slug}${path}`));
  }

  // Anything else: assets that slipped past _routes.json, unknown paths.
  return next();
};
