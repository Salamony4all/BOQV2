/**
 * Source links: is a lead's link the article itself, or only a redirect to it?
 *
 * Google News feed items link to news.google.com/rss/articles/<id>. A browser is redirected from
 * there to the publisher; a server gets an empty shell, so the scanner can read nothing about the
 * lead from it, and the id cannot be turned into the article's address without Google's own
 * unofficial lookup, which the scanner does not use. Publisher feeds carry the article's address
 * directly. These helpers tell the two apart, so that a real address is stored when a feed gives
 * one and is never replaced by a redirect afterwards.
 *
 * Pure functions: no network, no database.
 */

const GOOGLE_NEWS_HOST_RX = /^(?:www\.)?news\.google\.com$/i;
const GOOGLE_ARTICLE_PATH_RX = /^\/(?:rss\/)?(?:articles|read)\/[A-Za-z0-9_-]{20,}\/?$/;
const TRACKING_PARAM_RX = /^(?:utm_[a-z0-9_]+|fbclid|gclid)$/i;

/** True for a link that only redirects to the article (a Google News article link). */
export function isFeedRedirectLink(url = '') {
  try {
    const u = new URL(String(url || '').trim());
    return GOOGLE_NEWS_HOST_RX.test(u.hostname) && GOOGLE_ARTICLE_PATH_RX.test(u.pathname);
  } catch {
    return false;
  }
}

/**
 * True for an address that can be stored as a lead's article link: http(s) on a named public
 * host, and not a feed redirect. The scanner fetches stored links from the server, so literal IP
 * addresses and local names are refused.
 */
export function isArticleUrl(url = '') {
  const raw = String(url || '').trim();
  if (!raw || raw.length > 2000 || isFeedRedirectLink(raw)) return false;
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
    if (u.username || u.password) return false;
    const host = u.hostname.toLowerCase();
    if (!host.includes('.') || host.endsWith('.')) return false;
    if (/^[\d.]+$/.test(host) || host.includes(':') || host.startsWith('[')) return false; // IP literal
    if (/(?:^|\.)(?:localhost|local|internal|lan|test|invalid)$/.test(host)) return false;
    return true;
  } catch {
    return false;
  }
}

/** The same address without campaign and click-tracking parameters. */
export function cleanArticleUrl(url = '') {
  const raw = String(url || '').trim();
  try {
    const u = new URL(raw);
    let changed = false;
    for (const key of [...new Set(u.searchParams.keys())]) {
      if (TRACKING_PARAM_RX.test(key)) {
        u.searchParams.delete(key);
        changed = true;
      }
    }
    // Untouched addresses are returned exactly as given: re-serialising can re-encode a path.
    return changed ? u.toString() : raw;
  } catch {
    return raw;
  }
}

/**
 * Which link a lead keeps when a scan sees it again: the one the scan brings, unless that is only
 * a feed redirect and the lead already links to the article itself.
 */
export function pickSourceLink(existing = '', incoming = '') {
  const have = String(existing || '').trim();
  const got = String(incoming || '').trim();
  if (!got) return have;
  if (isFeedRedirectLink(got) && isArticleUrl(have)) return have;
  return got;
}

/** The site a host belongs to (example.com for news.example.com, example.co.uk for www.example.co.uk). */
export function siteOfHost(host = '') {
  const labels = String(host || '').toLowerCase().replace(/^www\./, '').split('.').filter(Boolean);
  if (labels.length <= 2) return labels.join('.');
  const secondLevel = labels[labels.length - 2];
  const countryCode = labels[labels.length - 1].length === 2;
  const take = countryCode && /^(?:co|com|org|net|gov|edu|ac|or|ne)$/.test(secondLevel) ? 3 : 2;
  return labels.slice(-take).join('.');
}
