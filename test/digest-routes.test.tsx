import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { readNight } from '../src/digest/read.js';
import type { DigestNight } from '../src/digest/types.js';

// A temp runs dir: runs/ holds real nights and is read-only, so the real night is copied in.
const FOUND = '2026-10-28'; // copy of runs/2026-10-28.jsonl: 5 jobs, 1 bad line
const EMPTY = '2026-10-20'; // file exists, no lines
const ONE_BAD = '2026-10-21'; // one bad line, one good line
const TWO_BAD = '2026-10-23'; // two bad lines, one good line
const ALL_BAD = '2026-10-24'; // bad lines only
const MISSING = '2026-10-22'; // no file

const GOOD = '{"at":"2026-10-21T01:00:00+01:00","job":"lane/sync","status":"ok","owner":"rook"}';

let runsDir: string;
let app: ReturnType<typeof createApp>;

beforeAll(() => {
  runsDir = mkdtempSync(join(tmpdir(), 'rig-digest-routes-'));
  copyFileSync(join('runs', `${FOUND}.jsonl`), join(runsDir, `${FOUND}.jsonl`));
  writeFileSync(join(runsDir, `${EMPTY}.jsonl`), '');
  writeFileSync(join(runsDir, `${ONE_BAD}.jsonl`), `{"at":"2026-10-21T00:00:\n${GOOD}\n`);
  writeFileSync(join(runsDir, `${TWO_BAD}.jsonl`), `not json\n${GOOD}\n["array"]\n`);
  writeFileSync(join(runsDir, `${ALL_BAD}.jsonl`), 'not json\n["array"]\n');
  app = createApp({ adapter: 'shim', installed: '2026-10-29T14:06:00+01:00', beatEverySeconds: 60, runsDir });
});

afterAll(() => {
  rmSync(runsDir, { recursive: true, force: true });
});

/** The body rows of the page's table: each `<tr>` that holds data cells (header rows have `<th>`). */
function dataRows(html: string): { open: string; text: string }[] {
  return [...html.matchAll(/<tr([^>]*)>(.*?)<\/tr>/gs)]
    .filter((m) => !m[2]!.includes('<th'))
    .map((m) => ({ open: m[1]!, text: m[2]!.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() }));
}

function rowFor(html: string, job: string) {
  const row = dataRows(html).find((r) => r.text.split(' ')[0] === job);
  if (!row) throw new Error(`no row for ${job}`);
  return row;
}

async function page(night: string) {
  const res = await app.request(`/digest/${night}`);
  return { res, html: await res.text() };
}

describe('GET /digest/:night', () => {
  it('renders a found night: 200, heading, table, one row per job, lane banner', async () => {
    process.env.LANE_MARKER = 'TEST-MARKER';
    const { res, html } = await page(FOUND);
    const night = readNight(runsDir, FOUND) as DigestNight;
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(html).toContain(`<h1>digest · ${FOUND}</h1>`);
    expect(html).toContain('<table');
    expect(html).toContain('TEST-MARKER');
    expect(dataRows(html)).toHaveLength(night.rows.length);
    expect(night.rows).toHaveLength(5);
  });

  it('marks rows with 3+ retries or any fail as warn, and no other row', async () => {
    const { html } = await page(FOUND);
    const warn = (job: string) => rowFor(html, job).open.includes('class="warn"');
    expect(warn('fixtures/refresh')).toBe(true); // 3 retries, then ok
    expect(warn('notes/backup')).toBe(true); // a fail
    expect(warn('lane/sync')).toBe(false); // 1 retry, no fail
    expect(warn('rig/rotate-logs')).toBe(false);
    expect(warn('digest/render')).toBe(false);
    expect(dataRows(html).filter((r) => r.open.includes('class="warn"'))).toHaveLength(2);
  });

  it('renders a null owner and a missing last error as —', async () => {
    const { html } = await page(FOUND);
    // digest/render has owner null and no error: both cells are —, not empty
    expect(rowFor(html, 'digest/render').text).toMatch(/^digest\/render — /);
    expect(rowFor(html, 'digest/render').text.match(/—/g)).toHaveLength(2);
    // lane/sync recovered but keeps its last error, and has an owner
    expect(rowFor(html, 'lane/sync').text).toContain('lock held');
    expect(rowFor(html, 'lane/sync').text).toContain('rook');
  });

  it('says 1 bad line skipped for the real night', async () => {
    const { html } = await page(FOUND);
    expect(html).toContain('<p class="mute">1 bad line skipped</p>');
  });

  it('answers 404 with the night in the body when there is no file', async () => {
    const { res, html } = await page(MISSING);
    expect(res.status).toBe(404);
    expect(html).toContain(`no run log for ${MISSING}`);
  });

  it('renders an empty night as 200 "nothing ran", with no table rows and no bad-line note', async () => {
    const { res, html } = await page(EMPTY);
    expect(res.status).toBe(200);
    expect(html).toContain(`<h1>digest · ${EMPTY}</h1>`);
    expect(html).toContain('nothing ran');
    expect(dataRows(html)).toHaveLength(0);
    expect(html).not.toContain('bad line');
  });

  it('renders a night with one bad line and one good line: the row, and the note', async () => {
    const { res, html } = await page(ONE_BAD);
    expect(res.status).toBe(200);
    expect(dataRows(html)).toHaveLength(1);
    expect(rowFor(html, 'lane/sync').open).not.toContain('warn');
    expect(html).toContain('<p class="mute">1 bad line skipped</p>');
    expect(html).not.toContain('nothing ran');
  });

  it('pluralises the bad-line note', async () => {
    const { html } = await page(TWO_BAD);
    expect(html).toContain('<p class="mute">2 bad lines skipped</p>');
  });

  it('never says "nothing ran" over a night of bad lines only', async () => {
    const { html } = await page(ALL_BAD);
    expect(html).not.toContain('nothing ran');
    expect(html).toContain('<p class="mute">2 bad lines skipped</p>');
  });
});

describe('GET /api/digest/:night', () => {
  it('returns the night as JSON, equal to readNight', async () => {
    const res = await app.request(`/api/digest/${FOUND}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(await res.json()).toEqual(readNight(runsDir, FOUND));
  });

  it('returns an empty night and a night with a bad line as they read', async () => {
    for (const night of [EMPTY, ONE_BAD, TWO_BAD]) {
      const res = await app.request(`/api/digest/${night}`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual(readNight(runsDir, night));
    }
    const empty = (await (await app.request(`/api/digest/${EMPTY}`)).json()) as DigestNight;
    expect(empty.rows).toEqual([]);
    const bad = (await (await app.request(`/api/digest/${ONE_BAD}`)).json()) as DigestNight;
    expect(bad.badLines).toBe(1);
    expect(bad.rows).toHaveLength(1);
  });

  it('answers 404 with { error, night } when there is no file', async () => {
    const res = await app.request(`/api/digest/${MISSING}`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'no run log', night: MISSING });
  });
});

describe('page and JSON agree (plan 2b)', () => {
  it('list the same jobs in the same order', async () => {
    const json = (await (await app.request(`/api/digest/${FOUND}`)).json()) as DigestNight;
    const { html } = await page(FOUND);
    const rows = dataRows(html);
    expect(rows).toHaveLength(json.rows.length);
    json.rows.forEach((row, i) => {
      expect(rows[i]!.text.split(' ')[0]).toBe(row.job);
    });
    expect(json.rows.map((r) => r.job)).toEqual([...json.rows.map((r) => r.job)].sort());
  });
});
