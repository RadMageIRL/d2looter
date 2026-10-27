// Diablo II: Resurrected headlines from Blizzard News (news.blizzard.com). Blizzard's D2R news page
// loads its list as JSON from FEED, which pages on other sites aren't allowed to read, so
// radmagelabs.com passes it through at /d2looter/news.json (a rewrite in that site's vercel.json,
// the same way D4 Tracker gets its news at /d4/news.json) and the page reads news.json next to
// itself. Where nothing answers there (GitHub Pages, a file opened from disk) the panel links to
// Blizzard News instead. Only titles, dates and links are kept, always as plain text, and only
// links back to news.blizzard.com. Pure functions, shared by the page and the Node tests.
(function (root) {
  'use strict';
  var FEED = 'https://news.blizzard.com/en-us/api/feed/diablo-2-resurrected';
  var PAGE = 'https://news.blizzard.com/en-us/feed/diablo-2-resurrected';
  // The list also carries other games' posts (Diablo IV news Blizzard features on the D2R page, and
  // Blizzard-wide news); only posts Blizzard tags as Diablo II: Resurrected are kept.
  var PRODUCT = 'diablo-2-resurrected';
  var HOST = 'news.blizzard.com';
  var MAX = 6;
  var TITLE_MAX = 200;
  /** Headlines younger than this are shown as they are; an open panel asks again once they are older. */
  var REFRESH = 15 * 60000;

  var NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '...', ndash: '-', mdash: '-', rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"' };
  // Dashes become plain hyphens; control characters are dropped.
  function safeChar(code) {
    if (code >= 0x2010 && code <= 0x2015) return '-';
    if (code < 0x20 || (code >= 0x7f && code < 0xa0) || code > 0x10ffff) return '';
    return String.fromCodePoint(code);
  }
  function decode(s) {
    return s
      .replace(/&#x([0-9a-f]+);/gi, function (_, x) { return safeChar(parseInt(x, 16)); })
      .replace(/&#(\d+);/g, function (_, d) { return safeChar(Number(d)); })
      .replace(/&([a-z]+);/gi, function (m, n) { return n.toLowerCase() in NAMED ? NAMED[n.toLowerCase()] : m; });
  }
  // Titles are text: entities decoded, any markup removed, every dash a plain hyphen (Blizzard's
  // titles use em dashes), whitespace collapsed.
  function text(s) {
    return decode(decode(String(s)).replace(/<[^>]*>/g, ''))
      .replace(/\p{Pd}/gu, '-').replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  /** An https link to an English page of news.blizzard.com, without query or fragment, or null. */
  function cleanLink(raw) {
    var u;
    if (typeof raw !== 'string') return null;
    try { u = new URL(raw.trim()); } catch (e) { return null; }
    if (u.protocol !== 'https:' || u.hostname !== HOST || u.port || u.username || u.password || u.pathname.indexOf('/en-us/') !== 0) return null;
    return 'https://' + HOST + u.pathname;
  }

  /** An ISO time, or null when the date can't be read. */
  function cleanDate(raw) {
    var ms = typeof raw === 'string' ? Date.parse(raw) : NaN;
    return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
  }

  function isRecord(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }

  /**
   * The newest Diablo II: Resurrected posts in one or more pages of Blizzard's list
   * ({ contentItems: [{ properties: { title, newsUrl, lastUpdated, cxpProduct } }] }), as
   * [{ title, link, date }], newest first. lastUpdated is the date Blizzard shows on each article.
   * Throws when the list isn't there, so a change on Blizzard's side is reported instead of read
   * as "no news".
   */
  function parseFeed(raw, max) {
    if (!isRecord(raw) || !Array.isArray(raw.contentItems)) throw new Error('the news list is not in the expected shape');
    var items = [], seen = {};
    raw.contentItems.forEach(function (c) {
      var p = isRecord(c) && isRecord(c.properties) ? c.properties : null;
      if (!p || !isRecord(p.cxpProduct) || p.cxpProduct.segment !== PRODUCT || typeof p.title !== 'string') return;
      var title = text(p.title).slice(0, TITLE_MAX), link = cleanLink(p.newsUrl);
      if (!title || !link || seen[link]) return;
      seen[link] = true;
      items.push({ title: title, link: link, date: cleanDate(p.lastUpdated) });
    });
    var when = function (i) { return i.date ? Date.parse(i.date) : -Infinity; };
    items.sort(function (a, b) { return when(b) - when(a); });
    return items.slice(0, max || MAX);
  }

  /**
   * Headlines kept in this browser ({ fetchedAt, items }), read back from storage: kept only while
   * they still look like what parseFeed makes, else null.
   */
  function sanitizeCache(raw) {
    if (!isRecord(raw) || typeof raw.fetchedAt !== 'number' || !Number.isFinite(raw.fetchedAt) || !Array.isArray(raw.items)) return null;
    var items = raw.items
      .filter(function (i) { return isRecord(i) && typeof i.title === 'string' && cleanLink(i.link) === i.link && text(i.title); })
      .slice(0, MAX)
      .map(function (i) { return { title: text(i.title).slice(0, TITLE_MAX), link: i.link, date: cleanDate(i.date) }; });
    return items.length ? { fetchedAt: raw.fetchedAt, items: items } : null;
  }
  function isFresh(cache, now) { return !!cache && now >= cache.fetchedAt && now - cache.fetchedAt < REFRESH; }

  var api = { FEED: FEED, PAGE: PAGE, PRODUCT: PRODUCT, HOST: HOST, MAX: MAX, REFRESH: REFRESH, text: text, cleanLink: cleanLink, cleanDate: cleanDate, parseFeed: parseFeed, sanitizeCache: sanitizeCache, isFresh: isFresh };
  root.D2News = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
