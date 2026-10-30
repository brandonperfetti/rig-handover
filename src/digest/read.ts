import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DigestNight, DigestRow, ReadNight, RunLine, RunStatus, StatusCounts } from './types.js';

const NIGHT = /^\d{4}-\d{2}-\d{2}$/;
// ISO 8601 with seconds and an offset; the offset is what we keep for display.
const AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const STATUSES: readonly RunStatus[] = ['ok', 'retry', 'fail'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStatus(value: unknown): value is RunStatus {
  return typeof value === 'string' && (STATUSES as readonly string[]).includes(value);
}

/** Parse one log line. `null` = bad line. */
export function parseLine(text: string): RunLine | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(value)) return null;
  const { at, job, status, owner, error } = value;
  if (typeof at !== 'string' || !AT.test(at) || Number.isNaN(Date.parse(at))) return null;
  if (typeof job !== 'string' || job === '') return null;
  if (!isStatus(status)) return null;
  if (!('owner' in value) || (owner !== null && typeof owner !== 'string')) return null;
  if (error !== undefined && error !== null && typeof error !== 'string') return null;
  const line: RunLine = { at, job, status, owner };
  if (typeof error === 'string') line.error = error;
  return line;
}

type Entry = { line: RunLine; time: number };

// Later instant wins; on a tie the later entry in the file (b, since we walk in file order) wins.
function isLater(b: Entry, a: Entry): boolean {
  return b.time >= a.time;
}

function toRow(entries: Entry[]): DigestRow {
  let first = entries[0]!;
  let last = entries[0]!;
  for (const entry of entries.slice(1)) {
    if (entry.time < first.time) first = entry;
    if (isLater(entry, last)) last = entry;
  }
  return {
    job: last.line.job,
    owner: last.line.owner,
    runs: entries.length,
    retries: entries.filter((e) => e.line.status === 'retry').length,
    lastStatus: last.line.status,
    lastError: last.line.error ?? null,
    firstAt: first.line.at,
    lastAt: last.line.at,
  };
}

/** Build a night's digest from the log's text. Pure: no disk. */
export function digestNight(night: string, text: string): DigestNight {
  const byJob = new Map<string, Entry[]>();
  const counts: StatusCounts = { ok: 0, retry: 0, fail: 0 };
  let badLines = 0;

  for (const raw of text.split(/\r?\n/)) {
    if (raw.trim() === '') continue;
    const line = parseLine(raw);
    if (line === null) {
      badLines += 1;
      continue;
    }
    counts[line.status] += 1;
    const entries = byJob.get(line.job) ?? [];
    entries.push({ line, time: Date.parse(line.at) });
    byJob.set(line.job, entries);
  }

  const rows = [...byJob.values()]
    .map(toRow)
    .sort((a, b) => (a.job < b.job ? -1 : a.job > b.job ? 1 : 0));
  return { night, rows, badLines, counts };
}

export const readNight: ReadNight = (runsDir, night) => {
  if (!NIGHT.test(night)) return null;
  let text: string;
  try {
    text = readFileSync(join(runsDir, `${night}.jsonl`), 'utf8');
  } catch (err) {
    if (err instanceof Error && 'code' in err && err.code === 'ENOENT') return null;
    throw err;
  }
  return digestNight(night, text);
};
