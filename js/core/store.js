// Preferences and Grail progress in localStorage. Several RadMage Labs tools can share one origin
// (radmagelabs.com, radmageirl.github.io), so every key carries this app's prefix. Storage can be
// missing or full (private windows, blocked site data); reads fall back and writes report failure.
// A value that no longer parses is kept under "<key>.broken" before it is replaced, so a bad
// write can never silently destroy the only copy of someone's Grail.
(function (root) {
  'use strict';
  var PREFIX = 'd2looter:v1:';

  function storage() {
    try { return root.localStorage || null; } catch (e) { return null; }
  }

  // Returns { value, status } with status 'ok' | 'missing' | 'broken' | 'unavailable'.
  function readRaw(name) {
    var ls = storage();
    if (!ls) return { value: undefined, status: 'unavailable' };
    var text;
    try { text = ls.getItem(PREFIX + name); } catch (e) { return { value: undefined, status: 'unavailable' }; }
    if (text == null) return { value: undefined, status: 'missing' };
    try { return { value: JSON.parse(text), status: 'ok' }; } catch (e) {
      try { ls.setItem(PREFIX + name + '.broken', text); } catch (e2) { /* nothing more to do */ }
      return { value: undefined, status: 'broken', text: text };
    }
  }

  function read(name, fallback) {
    var r = readRaw(name);
    return r.status === 'ok' ? r.value : fallback;
  }

  function write(name, value) {
    var ls = storage();
    if (!ls) return false;
    try { ls.setItem(PREFIX + name, JSON.stringify(value)); return true; } catch (e) { return false; }
  }

  function remove(name) {
    var ls = storage();
    if (!ls) return;
    try { ls.removeItem(PREFIX + name); } catch (e) { /* nothing saved anyway */ }
  }

  var api = { PREFIX: PREFIX, read: read, readRaw: readRaw, write: write, remove: remove };
  root.D2Store = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
