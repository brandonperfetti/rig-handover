// The morning digest's contract: what one night's run log reads into.
// The page (GET /digest/:night), the JSON (GET /api/digest/:night) and the board link all build
// on these types and nothing else, so the page and the JSON can never disagree (ADR 0001).
//
// Implementation: `readNight` in `src/digest/read.ts` (`export const readNight: ReadNight`).
// Everything here is plain JSON (strings, numbers, null, arrays): `c.json(night)` is the API.

/** A run's status, as written in the log. */
export type RunStatus = 'ok' | 'retry' | 'fail';

/**
 * One valid line of `runs/<night>.jsonl`. Required: `at`, `job`, `status`, `owner`.
 * - `at`: ISO 8601 with seconds and an offset (`Z` or `±hh:mm`), kept exactly as logged.
 * - `job`: non-empty string.
 * - `owner`: string or `null` (the key must be present).
 * - `error`: optional string; absent and `null` both mean "no error".
 * Extra keys are ignored. Any line that breaks these rules is a bad line (see `DigestNight`).
 */
export type RunLine = {
  at: string;
  job: string;
  status: RunStatus;
  owner: string | null;
  error?: string;
};

/**
 * One job's night, built from its valid lines.
 * "Latest" and "earliest" compare `at` as instants (offsets can differ); on a tie the line later
 * in the file counts as later, so file order is kept.
 */
export type DigestRow = {
  job: string;
  /** Owner on the job's latest line. `null` stays `null`; the view shows it as `—`. */
  owner: string | null;
  /** Number of valid lines for this job. Always ≥ 1. */
  runs: number;
  /** Number of the job's lines with status `retry`. */
  retries: number;
  /**
   * Number of the job's lines with status `fail`. The page marks a job with `fails > 0`, so a
   * fail followed by an ok is still marked.
   */
  fails: number;
  /** Status of the job's latest line. */
  lastStatus: RunStatus;
  /**
   * `error` of the job's latest line that has one, or `null` if no line had an error. It stays set
   * after a recovery (a job that retried on "upstream 503", then ran ok, shows "upstream 503").
   */
  lastError: string | null;
  /** `at` of the job's earliest line, exactly as in the log (offset kept, never converted to UTC). */
  firstAt: string;
  /** `at` of the job's latest line, exactly as in the log. */
  lastAt: string;
};

/** Valid lines per status across the whole night. ok + retry + fail = sum of `rows[].runs`. */
export type StatusCounts = Record<RunStatus, number>;

/** One night's digest: what `readNight` returns when the night's file exists. */
export type DigestNight = {
  /** The night asked for, `YYYY-MM-DD`. */
  night: string;
  /** One row per job, sorted by `job` (plain string order, `<`). Empty when nothing ran. */
  rows: DigestRow[];
  /**
   * Lines that could not be read: bad JSON (a truncated last line, say), not an object, or a
   * missing/invalid required field. Counted, never thrown. Blank lines are skipped, not counted.
   */
  badLines: number;
  /** Status counts over valid lines, for the status board (plan § 2c). */
  counts: StatusCounts;
};

/**
 * Read `<runsDir>/<night>.jsonl` into a digest.
 *
 * - No file for the night → `null`. The page and the JSON answer 404.
 * - `night` not shaped `YYYY-MM-DD` → `null` as well (never touches the disk, so no `../` paths).
 * - Empty file (or only blank lines) → `{ rows: [], badLines: 0, counts all 0 }`. The page says
 *   "nothing ran". A file with only bad lines also has `rows: []`, with `badLines > 0`.
 * - Bad lines never throw. Any other read error (permissions, a directory named `*.jsonl`) does.
 *
 * Synchronous, like the rest of rig's file reads (`status.ts`, `heartbeat.ts`).
 */
export type ReadNight = (runsDir: string, night: string) => DigestNight | null;
