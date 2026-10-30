import type { DigestNight, DigestRow } from '../digest/types.js';

const HEADERS = ['job', 'owner', 'runs', 'retries', 'fails', 'last status', 'last error', 'first', 'last'];

// Marked rows: a job that retried 3+ times, or failed at all (even if it later recovered).
function isWarn(row: DigestRow): boolean {
  return row.retries >= 3 || row.fails > 0;
}

function DigestTable({ rows }: { rows: DigestRow[] }) {
  return (
    <table>
      <thead>
        <tr>
          {HEADERS.map((h) => (
            <th>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr class={isWarn(row) ? 'warn' : undefined}>
            <td>{row.job}</td>
            <td>{row.owner ?? '—'}</td>
            <td>{String(row.runs)}</td>
            <td>{String(row.retries)}</td>
            <td>{String(row.fails)}</td>
            <td>{row.lastStatus}</td>
            <td>{row.lastError ?? '—'}</td>
            <td>{row.firstAt}</td>
            <td>{row.lastAt}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function DigestPage({ digest }: { digest: DigestNight }) {
  return (
    <>
      <h1>{`digest · ${digest.night}`}</h1>
      {digest.rows.length === 0 ? <p class="mute">nothing ran</p> : <DigestTable rows={digest.rows} />}
      {digest.badLines > 0 ? (
        <p class="mute">{`${digest.badLines} bad ${digest.badLines === 1 ? 'line' : 'lines'} skipped`}</p>
      ) : null}
    </>
  );
}

export function DigestMissing({ night }: { night: string }) {
  return <p>{`no run log for ${night}`}</p>;
}
