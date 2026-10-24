// Independent-trial probability: the chance of at least one success in n tries at chance p, and
// the inverse questions. Written with log1p/expm1 so that tiny drop chances (1 in 10 million)
// and large run counts stay accurate.
(function (root) {
  'use strict';

  function valid(p) { return typeof p === 'number' && p >= 0 && p <= 1 && !Number.isNaN(p); }

  // P(no success in n tries) = (1 - p)^n
  function none(p, n) {
    if (!valid(p) || !(n >= 0)) return NaN;
    if (p === 1) return n === 0 ? 1 : 0;
    return Math.exp(n * Math.log1p(-p));
  }

  // P(at least one success in n tries) = 1 - (1 - p)^n
  function atLeastOne(p, n) {
    if (!valid(p) || !(n >= 0)) return NaN;
    if (p === 1) return n === 0 ? 0 : 1;
    return -Math.expm1(n * Math.log1p(-p));
  }

  // Expected number of successes in n tries (each try succeeds at most once at chance p).
  function expected(p, n) { return valid(p) && n >= 0 ? p * n : NaN; }

  // Smallest whole n with P(at least one) >= confidence. Infinity when p is 0.
  function triesFor(p, confidence) {
    if (!valid(p) || !(confidence > 0 && confidence < 1)) return NaN;
    if (p === 0) return Infinity;
    if (p === 1) return 1;
    var n = Math.ceil(Math.log1p(-confidence) / Math.log1p(-p));
    // Guard the floating-point edge: step to the exact boundary.
    while (n > 1 && atLeastOne(p, n - 1) >= confidence) n--;
    while (atLeastOne(p, n) < confidence) n++;
    return n;
  }

  // Mean number of tries until the first success (geometric distribution).
  function meanTries(p) { return valid(p) && p > 0 ? 1 / p : p === 0 ? Infinity : NaN; }

  // Accepts "1:1500", "1/1500", "1 in 1500", "0.05%", "0.0005" and returns a probability.
  function parseOdds(text) {
    var s = String(text == null ? '' : text).trim().toLowerCase().replace(/,/g, '');
    if (!s) return NaN;
    var m = s.match(/^(\d+(?:\.\d+)?)\s*(?::|\/|in)\s*(\d+(?:\.\d+)?)$/);
    if (m) { var a = Number(m[1]), b = Number(m[2]); return b > 0 && a <= b ? a / b : NaN; }
    m = s.match(/^(\d+(?:\.\d+)?|\.\d+)\s*%$/);
    if (m) { var pc = Number(m[1]) / 100; return valid(pc) ? pc : NaN; }
    if (/^(\d+(?:\.\d+)?|\.\d+)(e-?\d+)?$/.test(s)) { var x = Number(s); return valid(x) ? x : NaN; }
    return NaN;
  }

  // "1 in 17,178" style text for a probability.
  function oneIn(p) {
    if (!(p > 0)) return 'never';
    var n = 1 / p;
    if (n < 10) return '1 in ' + n.toFixed(2).replace(/\.?0+$/, '');
    return '1 in ' + Math.round(n).toLocaleString('en-US');
  }

  function percent(p, digits) {
    if (!valid(p)) return '-';
    if (p === 0) return '0%';
    var d = digits == null ? 2 : digits;
    var v = p * 100;
    if (v >= 0.01 || v === 0) return v.toFixed(d).replace(/\.?0+$/, '') + '%';
    // keep two significant digits for tiny chances
    return v.toPrecision(2).replace(/\.?0+e/, 'e') + '%';
  }

  var api = { none: none, atLeastOne: atLeastOne, expected: expected, triesFor: triesFor, meanTries: meanTries, parseOdds: parseOdds, oneIn: oneIn, percent: percent };
  root.D2Prob = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
