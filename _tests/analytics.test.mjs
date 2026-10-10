// The site's analytics.js in jsdom: the consent states. Before a choice one `consent_shown` beacon and
// PostHog not loaded; OK loads it persistent and sends page views, CTA and outbound clicks; No thanks,
// a kept No thanks, Do Not Track and GPC send nothing; a local preview is off without ?analytics=1.
// PostHog's array.js is never fetched: the test plays its load with a stub that records calls.
//
//   cd _tests && npm install && npm test
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const SRC = readFileSync(new URL('../analytics.js', import.meta.url), 'utf8');
const KEY = 'dungen-analytics-consent';
const PAGE = '<!doctype html><html><head></head><body><main><a class="button" href="/quest/">Try the demo</a><a id="out" href="https://github.com/beveryday">GitHub</a><a id="plain" href="#why">Why</a></main><footer><p>c</p></footer></body></html>';

/** Runs analytics.js on a fresh page. Returns the window, the beacon bodies, and helpers. */
async function open({ url = 'https://dungen.ai/', consent = null, nav = {} } = {}) {
  const dom = new JSDOM(PAGE, { url, runScripts: 'outside-only' });
  const w = dom.window;
  if (consent) w.localStorage.setItem(KEY, consent);
  const beacons = [];
  Object.defineProperty(w.navigator, 'sendBeacon', { value: (u, blob) => { beacons.push({ url: u, blob }); return true; } });
  for (const [k, v] of Object.entries(nav)) Object.defineProperty(w.navigator, k, { value: v, configurable: true });
  w.eval(SRC);
  // analytics.js starts on DOMContentLoaded while the page is still loading.
  if (w.document.readyState === 'loading') await new Promise((r) => w.document.addEventListener('DOMContentLoaded', r, { once: true }));
  const calls = [];
  const ph = {
    init: (key, config) => calls.push(['init', key, config]),
    register: (p) => calls.push(['register', p]),
    capture: (e, p) => calls.push(['capture', e, p]),
    set_config: (c) => calls.push(['set_config', c]),
    reset: () => calls.push(['reset']),
  };
  const script = () => w.document.querySelector('script[src*="/static/array.js"]');
  /** Plays array.js arriving: window.posthog is the stub, then the script's onload. */
  const arrive = () => { w.posthog = ph; script().onload(); };
  const bodies = async () => Promise.all(beacons.map(async (b) => ({ url: b.url, body: JSON.parse(await b.blob.text()) })));
  const captured = () => calls.filter((c) => c[0] === 'capture').map((c) => c[1]);
  return { w, doc: w.document, beacons, bodies, calls, captured, script, arrive };
}

test('no choice yet: the notice (aria-live), one consent_shown beacon, PostHog not loaded, nothing stored', async () => {
  const p = await open();
  const notice = p.doc.querySelector('.dan-notice');
  assert.ok(notice && !notice.hidden);
  assert.equal(notice.getAttribute('aria-live'), 'polite');
  assert.match(notice.textContent, /We record anonymous usage and screen replays of the demo/);
  assert.equal(p.script(), null, 'array.js is not requested before a choice');
  const [b, ...more] = await p.bodies();
  assert.equal(more.length, 0);
  assert.equal(b.url, 'https://us.i.posthog.com/i/v0/e/');
  assert.equal(b.body.event, 'consent_shown');
  assert.match(b.body.api_key, /^phc_/);
  assert.equal(b.body.properties.$process_person_profile, false);
  assert.equal(b.body.properties.app, 'site');
  assert.equal(b.body.properties.env, 'prod');
  assert.equal(p.w.localStorage.length, 0);
  assert.equal(p.doc.cookie, '');
  assert.ok(p.doc.querySelector('footer .dan-privacy'));
  // Clicks before a choice are not tracked (nothing is loaded to track them).
  p.doc.querySelector('a.button').dispatchEvent(new p.w.MouseEvent('click', { bubbles: true, cancelable: true }));
  assert.equal(p.calls.length, 0);
});

test('OK: the choice is kept, PostHog loads persistent, then consent_accepted, a page view, CTA and outbound clicks', async () => {
  const p = await open();
  p.doc.querySelector('.dan-ok').click();
  assert.equal(p.w.localStorage.getItem(KEY), 'granted');
  assert.ok(p.script());
  p.arrive();
  const [, key, config] = p.calls.find((c) => c[0] === 'init');
  assert.match(key, /^phc_/);
  assert.equal(config.persistence, 'localStorage+cookie');
  assert.equal(config.api_host, 'https://us.i.posthog.com');
  assert.equal(config.defaults, '2026-05-30');
  assert.equal(config.person_profiles, 'identified_only');
  assert.equal(config.disable_session_recording, true);
  assert.equal(p.calls.find((c) => c[0] === 'register')[1].app, 'site');
  const click = (sel) => p.doc.querySelector(sel).dispatchEvent(new p.w.MouseEvent('click', { bubbles: true, cancelable: true }));
  click('a.button');
  click('#out');
  click('#plain');
  assert.deepEqual(p.captured(), ['consent_accepted', '$pageview', 'cta_clicked', 'outbound_clicked']);
  assert.equal(JSON.stringify(p.calls.find((c) => c[1] === 'cta_clicked')[2]), JSON.stringify({ label: 'Try the demo', target: '/quest/' }));
  assert.equal(JSON.stringify(p.calls.find((c) => c[1] === 'outbound_clicked')[2]), JSON.stringify({ label: 'GitHub', target: 'github.com/beveryday' }));
});

test('a kept OK: no notice, no beacon, PostHog loads and sends the page view', async () => {
  const p = await open({ consent: 'granted' });
  assert.equal(p.doc.querySelector('.dan-notice'), null);
  assert.equal(p.beacons.length, 0);
  p.arrive();
  assert.deepEqual(p.captured(), ['$pageview']);
});

test('No thanks: kept, nothing loads, nothing more is sent', async () => {
  const p = await open();
  p.doc.querySelector('.dan-no').click();
  assert.equal(p.w.localStorage.getItem(KEY), 'denied');
  assert.equal(p.script(), null);
  assert.equal(p.beacons.length, 1);
});

test('a kept No thanks: nothing at all, but the Privacy button can change it', async () => {
  const p = await open({ consent: 'denied' });
  assert.equal(p.beacons.length, 0);
  assert.equal(p.script(), null);
  assert.equal(p.doc.querySelector('.dan-notice'), null);
  p.doc.querySelector('.dan-privacy').click();
  assert.match(p.doc.querySelector('.dan-notice .dan-now').textContent, /No thanks/);
});

test('Do Not Track or Global Privacy Control: nothing, even over a kept OK, and no Privacy button', async () => {
  for (const nav of [{ doNotTrack: '1' }, { globalPrivacyControl: true }]) {
    const p = await open({ consent: 'granted', nav });
    assert.equal(p.beacons.length, 0, JSON.stringify(nav));
    assert.equal(p.script(), null);
    assert.equal(p.doc.querySelector('.dan-notice'), null);
    assert.equal(p.doc.querySelector('.dan-privacy'), null);
  }
});

test('a local preview is off unless ?analytics=1, and then tagged env dev', async () => {
  const off = await open({ url: 'http://localhost:8000/' });
  assert.equal(off.beacons.length, 0);
  assert.equal(off.doc.querySelector('.dan-privacy'), null);
  const on = await open({ url: 'http://localhost:8000/?analytics=1' });
  const [b] = await on.bodies();
  assert.equal(b.body.properties.env, 'dev');
});
