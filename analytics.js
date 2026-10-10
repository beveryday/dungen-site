// DUNGEN.AI SITE ANALYTICS (PostHog): page views, call-to-action clicks and outbound links, after the
// visitor's OK. The quest demo at /quest has its own copy of these rules (pizza-fleet-app
// src/analytics/); both keep the visitor's choice under the same localStorage key, so a choice made
// on one counts on the other.
//
// - POSTHOG_KEY empty, or a local preview without ?analytics=1: nothing loads, is drawn or is sent.
//   Every event carries `app: 'site'` and `env` ('prod' on dungen.ai, 'dev' elsewhere).
// - No choice yet: the notice shows; PostHog keeps nothing on the device (memory persistence) and
//   sends only `consent_shown`.
// - OK: localStorage+cookie persistence (returning visitors count for daily, weekly and monthly
//   actives), `$pageview`, `cta_clicked` and `outbound_clicked`. The site records no screen replays.
// - No thanks, Do Not Track or Global Privacy Control: nothing is loaded or sent.
// The "Privacy" button in the footer reopens the notice to change the choice.
(function () {
  'use strict';

  // ---- the one place the project is configured ----
  /** The PostHog project's public key (phc_...; it can only send events). Empty: analytics off. */
  var POSTHOG_KEY = 'phc_uTynPmPQkarA3xv5MPkoSedSJeYZeQd2KUwGoSxrkBsZ';
  /** The PostHog ingestion host: the US cloud (the EU cloud is https://eu.i.posthog.com). */
  var POSTHOG_HOST = 'https://us.i.posthog.com';

  var CONSENT_KEY = 'dungen-analytics-consent';
  var CONSENT_TEXT = 'We record anonymous usage and screen replays of the demo to improve it.';

  /** On dungen.ai itself ('prod'); a local preview stays off unless opened with ?analytics=1 ('dev'). */
  var PROD = /(^|\.)dungen\.ai$/.test(location.hostname);
  var ON = PROD || new URLSearchParams(location.search).get('analytics') === '1';
  if (!POSTHOG_KEY || !ON || window.__dungenAnalytics) return;
  window.__dungenAnalytics = true;

  function readConsent() {
    try { var v = localStorage.getItem(CONSENT_KEY); return v === 'granted' || v === 'denied' ? v : null; } catch (e) { return null; }
  }
  function writeConsent(v) { try { localStorage.setItem(CONSENT_KEY, v); } catch (e) { /* storage off */ } }
  var nav = navigator || {};
  var signal = nav.globalPrivacyControl === true || [nav.doNotTrack, nav.msDoNotTrack, window.doNotTrack].some(function (v) { return v === '1' || v === 'yes'; });
  var consent = signal ? 'denied' : (readConsent() || 'undecided');

  var client = null, loading = false, failed = false, queue = [];
  function config(granted) {
    return {
      api_host: POSTHOG_HOST,
      defaults: '2026-05-30',
      persistence: granted ? 'localStorage+cookie' : 'memory',
      autocapture: false,
      capture_pageview: false,
      capture_pageleave: granted,
      // Nor what the project's remote settings may switch on: dead clicks, web vitals, heatmaps, errors.
      capture_dead_clicks: false,
      capture_performance: false,
      enable_heatmaps: false,
      capture_exceptions: false,
      disable_session_recording: true,
      person_profiles: 'identified_only',
      respect_dnt: true,
      disable_surveys: true,
    };
  }
  function load() {
    if (loading) return;
    loading = true;
    var s = document.createElement('script');
    s.async = true;
    s.crossOrigin = 'anonymous';
    s.src = POSTHOG_HOST.replace('.i.posthog.com', '-assets.i.posthog.com') + '/static/array.js';
    s.onload = function () {
      var ph = window.posthog;
      if (!ph || typeof ph.init !== 'function' || consent === 'denied') { queue = []; return; }
      ph.init(POSTHOG_KEY, config(consent === 'granted'));
      ph.register({ app: 'site', env: PROD ? 'prod' : 'dev', page: location.pathname });
      client = ph;
      var q = queue; queue = [];
      q.forEach(function (e) { send(e[0], e[1]); });
    };
    s.onerror = function () { failed = true; queue = []; };
    document.head.appendChild(s);
  }
  function send(event, props) {
    if (client) { try { client.capture(event, props || {}); } catch (e) { /* never break the page */ } return; }
    if (loading && !failed && queue.length < 50) queue.push([event, props]);
  }
  function track(event, props) { if (consent === 'granted') send(event, props); }

  function choose(choice) {
    writeConsent(choice);
    var was = consent;
    consent = signal ? 'denied' : choice;
    if (consent === was) return;
    if (consent === 'granted') {
      if (client) client.set_config({ persistence: 'localStorage+cookie', capture_pageleave: true }); else load();
      send('consent_accepted');
      send('$pageview');
      return;
    }
    queue = [];
    if (client) { client.reset(); client.set_config({ persistence: 'memory', capture_pageleave: false }); }
  }

  // ---- what is tracked: calls to action and outbound links (labels and targets only) ----
  document.addEventListener('click', function (e) {
    if (consent !== 'granted' || !(e.target instanceof Element)) return;
    var el = e.target.closest('a[href], button');
    if (!el || el.closest('.dan-notice') || el.classList.contains('dan-privacy')) return;
    var href = el.getAttribute('href') || '';
    var label = (el.getAttribute('data-cta') || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60);
    var url = null;
    try { url = href ? new URL(href, location.href) : null; } catch (err) { url = null; }
    if (url && /^https?:$/.test(url.protocol) && url.host !== location.host) {
      track('outbound_clicked', { label: label, target: url.host + url.pathname });
      return;
    }
    var isCta = el.matches('.button, .text-link, [data-cta]') || (url && /^\/quest(\/|$)/.test(url.pathname) && url.host === location.host);
    if (isCta) track('cta_clicked', { label: label, target: url ? (url.pathname === location.pathname && url.hash ? url.hash : url.pathname + url.hash) : (el.getAttribute('type') || 'button') });
  }, true);

  // ---- the notice and the Privacy button ----
  var CSS = '.dan-notice{position:fixed;left:14px;bottom:14px;z-index:1000;width:min(380px,calc(100vw - 28px));box-sizing:border-box;padding:14px 16px;border-radius:14px;'
    + 'border:1.5px solid #a97a22;background:linear-gradient(180deg,rgba(27,35,51,.98),rgba(13,17,26,.98));color:#ece6d6;box-shadow:0 0 0 1px rgba(226,181,82,.18),0 14px 36px rgba(0,0,0,.6);'
    + 'font:14px/1.45 Inter,"Helvetica Neue",Arial,sans-serif}'
    + '.dan-notice[hidden]{display:none}'
    + '.dan-notice .dan-k{margin:0 0 6px;font:800 11px/1 "Barlow Condensed","Arial Narrow",Arial,sans-serif;letter-spacing:.18em;text-transform:uppercase;color:#e2b552}'
    + '.dan-notice p{margin:0}.dan-notice .dan-now{margin-top:6px;color:#9aa3b5;font-size:12.5px}.dan-notice .dan-now:empty{display:none}'
    + '.dan-notice .dan-acts{display:flex;justify-content:flex-end;align-items:center;gap:14px;margin-top:12px}'
    + '.dan-notice .dan-no{all:unset;cursor:pointer;padding:10px 2px;font:800 13px/1 "Barlow Condensed",Arial,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:#9aa3b5;text-decoration:underline;text-underline-offset:3px}'
    + '.dan-notice .dan-no:hover{color:#e2b552}'
    + '.dan-notice .dan-ok{cursor:pointer;min-width:84px;min-height:40px;padding:0 20px;border-radius:10px;border:1.5px solid #f6d48a;color:#1a1206;font:800 14px/1 "Barlow Condensed",Arial,sans-serif;letter-spacing:.1em;text-transform:uppercase;'
    + 'background:linear-gradient(#f2cf7c,#e2b552 55%,#a97a22);box-shadow:0 4px 12px rgba(0,0,0,.35)}'
    + '.dan-notice :focus-visible,.dan-privacy:focus-visible{outline:2px solid #e2b552;outline-offset:2px}'
    + '.dan-privacy{all:unset;cursor:pointer;font:600 12px/1 Inter,Arial,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:#9aa3b5;text-decoration:underline;text-underline-offset:3px;padding:6px 2px}'
    + '.dan-privacy:hover{color:#e2b552}.dan-privacy.dan-float{position:fixed;left:14px;bottom:10px;z-index:999}'
    + '@media (max-width:560px){.dan-notice{left:8px;right:8px;bottom:calc(8px + env(safe-area-inset-bottom));width:auto}.dan-notice .dan-ok{min-height:44px}}';
  var notice = null;
  function showNotice() {
    if (!notice) {
      notice = document.createElement('section');
      notice.className = 'dan-notice';
      notice.setAttribute('role', 'region');
      notice.setAttribute('aria-label', 'Privacy');
      notice.innerHTML = '<p class="dan-k">Privacy</p><p></p><p class="dan-now"></p>'
        + '<div class="dan-acts"><button type="button" class="dan-no" data-choice="denied">No thanks</button><button type="button" class="dan-ok" data-choice="granted">OK</button></div>';
      notice.children[1].textContent = CONSENT_TEXT;
      notice.addEventListener('click', function (e) {
        var b = e.target instanceof Element ? e.target.closest('[data-choice]') : null;
        if (!b) return;
        choose(b.getAttribute('data-choice') === 'granted' ? 'granted' : 'denied');
        notice.hidden = true;
      });
      notice.addEventListener('keydown', function (e) { if (e.key === 'Escape') notice.hidden = true; });
      document.body.appendChild(notice);
    }
    notice.querySelector('.dan-now').textContent = consent === 'granted' ? 'You chose OK. No thanks stops it.' : consent === 'denied' ? 'You chose No thanks: nothing is recorded.' : '';
    notice.hidden = false;
  }
  function start() {
    var style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    if (consent === 'granted') { load(); send('$pageview'); }
    else if (consent === 'undecided') { load(); send('consent_shown'); showNotice(); }
    if (signal) return;
    var button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Privacy';
    button.setAttribute('aria-label', 'Privacy: recording of this site and the demo');
    var footer = document.querySelector('footer');
    button.className = footer ? 'dan-privacy' : 'dan-privacy dan-float';
    button.addEventListener('click', function () {
      if (notice && !notice.hidden) { notice.hidden = true; return; }
      showNotice();
      notice.querySelector('.dan-ok').focus({ preventScroll: true });
    });
    (footer || document.body).appendChild(button);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
