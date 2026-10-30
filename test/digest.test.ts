import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { digestNight, parseLine, readNight } from '../src/digest/read.js';

const tmp = mkdtempSync(join(tmpdir(), 'rig-digest-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe('readNight on runs/2026-10-28.jsonl', () => {
  const night = readNight('runs', '2026-10-28')!;
  const row = (job: string) => night.rows.find((r) => r.job === job)!;

  it('reads 5 jobs, sorted by job, and counts the truncated last line as bad', () => {
    expect(night.night).toBe('2026-10-28');
    expect(night.rows.map((r) => r.job)).toEqual([
      'digest/render',
      'fixtures/refresh',
      'lane/sync',
      'notes/backup',
      'rig/rotate-logs',
    ]);
    expect(night.badLines).toBe(1);
  });

  it('keeps a null owner', () => {
    expect(row('digest/render')).toEqual({
      job: 'digest/render',
      owner: null,
      runs: 1,
      retries: 0,
      lastStatus: 'ok',
      lastError: null,
      firstAt: '2026-10-29T05:41:09+01:00',
      lastAt: '2026-10-29T05:41:09+01:00',
    });
  });

  it('counts retries; last status and error come from the latest line', () => {
    expect(row('fixtures/refresh')).toEqual({
      job: 'fixtures/refresh',
      owner: 'rook',
      runs: 4,
      retries: 3,
      lastStatus: 'ok',
      lastError: null,
      firstAt: '2026-10-29T01:30:00+01:00',
      lastAt: '2026-10-29T01:37:00+01:00',
    });
  });

  it('shows a fail with its error', () => {
    expect(row('notes/backup')).toMatchObject({ owner: 'lane-07', lastStatus: 'fail', lastError: 'quota exceeded' });
  });

  it('keeps times exactly as logged, offset and all', () => {
    expect(row('lane/sync')).toMatchObject({
      runs: 8,
      retries: 1,
      lastStatus: 'ok',
      firstAt: '2026-10-28T23:00:06+01:00',
      lastAt: '2026-10-29T05:00:04+01:00',
    });
  });

  it('counts valid lines per status for the board', () => {
    expect(night.counts).toEqual({ ok: 10, retry: 4, fail: 1 });
    const runs = night.rows.reduce((n, r) => n + r.runs, 0);
    expect(night.counts.ok + night.counts.retry + night.counts.fail).toBe(runs);
  });
});

describe('readNight edges', () => {
  it('returns null for a night with no file', () => {
    expect(readNight('runs', '2026-01-01')).toBeNull();
    expect(readNight(join(tmp, 'missing-dir'), '2026-10-28')).toBeNull();
  });

  it('returns null for a night that is not YYYY-MM-DD', () => {
    expect(readNight('runs', '../package')).toBeNull();
    expect(readNight('runs', '2026-10-28.jsonl')).toBeNull();
  });

  it('reads an empty file as nothing ran', () => {
    writeFileSync(join(tmp, '2026-10-30.jsonl'), '');
    expect(readNight(tmp, '2026-10-30')).toEqual({
      night: '2026-10-30',
      rows: [],
      badLines: 0,
      counts: { ok: 0, retry: 0, fail: 0 },
    });
  });

  it('skips blank lines without counting them', () => {
    writeFileSync(join(tmp, '2026-10-31.jsonl'), '\n  \n\r\n');
    expect(readNight(tmp, '2026-10-31')).toMatchObject({ rows: [], badLines: 0 });
  });

  it('throws on read errors other than a missing file', () => {
    mkdirSync(join(tmp, '2026-11-01.jsonl'));
    expect(() => readNight(tmp, '2026-11-01')).toThrow();
  });
});

describe('digestNight', () => {
  const line = (fields: Record<string, unknown>) =>
    JSON.stringify({ at: '2026-10-29T01:00:00+01:00', job: 'a', status: 'ok', owner: 'rook', ...fields });

  it('counts bad lines: bad JSON, not an object, missing or invalid fields', () => {
    const text = [
      '{"at":',
      '[]',
      '42',
      JSON.stringify({ at: '2026-10-29T01:00:00+01:00', job: 'a', status: 'ok' }), // no owner key
      line({ at: '2026-10-29 01:00' }), // no T, no offset
      line({ at: '2026-10-29T01:00:00' }), // no offset
      line({ job: '' }),
      line({ job: 3 }),
      line({ status: 'done' }),
      line({ owner: 7 }),
      line({ error: 503 }),
      line({}),
    ].join('\n');
    const night = digestNight('2026-10-29', text);
    expect(night.badLines).toBe(11);
    expect(night.rows).toHaveLength(1);
  });

  it('treats error: null as no error', () => {
    expect(parseLine(line({ error: null }))).toEqual({
      at: '2026-10-29T01:00:00+01:00',
      job: 'a',
      status: 'ok',
      owner: 'rook',
    });
  });

  it('orders by instant across offsets, keeping the logged strings', () => {
    const text = [
      line({ at: '2026-10-29T01:00:00+01:00', status: 'fail', error: 'late' }), // 00:00Z
      line({ at: '2026-10-28T23:30:00Z', status: 'retry', error: 'early' }), // 23:30Z
    ].join('\n');
    expect(digestNight('n', text).rows[0]).toMatchObject({
      firstAt: '2026-10-28T23:30:00Z',
      lastAt: '2026-10-29T01:00:00+01:00',
      lastStatus: 'fail',
      lastError: 'late',
    });
  });

  it('on an equal time, the line later in the file is the latest', () => {
    const text = [
      line({ status: 'retry', error: 'first', owner: 'rook' }),
      line({ at: '2026-10-29T00:00:00Z', status: 'ok', owner: null }), // same instant
    ].join('\n');
    expect(digestNight('n', text).rows[0]).toMatchObject({
      owner: null,
      lastStatus: 'ok',
      lastError: null,
      firstAt: '2026-10-29T01:00:00+01:00',
      lastAt: '2026-10-29T00:00:00Z',
    });
  });

  it('sorts rows by job in plain string order', () => {
    const text = ['b', 'B', 'a/z', 'a'].map((job) => line({ job })).join('\n');
    expect(digestNight('n', text).rows.map((r) => r.job)).toEqual(['B', 'a', 'a/z', 'b']);
  });
});
