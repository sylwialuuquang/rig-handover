import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export type JobStatus = 'ok' | 'retry' | 'fail';

export type DigestRow = {
  job: string;
  owner: string | null;
  runs: number;
  retries: number;
  lastStatus: JobStatus;
  lastError: string | null;
  firstAt: string;
  lastAt: string;
};

export type StatusCounts = {
  ok: number;
  retry: number;
  fail: number;
};

export type NightDigest = {
  rows: DigestRow[];
  badLines: number;
  counts: StatusCounts;
};

type Event = {
  at: string;
  atMs: number;
  job: string;
  status: JobStatus;
  owner: string | null;
  error: string | null;
};

const NIGHT = /^\d{4}-\d{2}-\d{2}$/;
const STATUSES = new Set<JobStatus>(['ok', 'retry', 'fail']);

/** Read `runs/<night>.jsonl`. Returns null when that night has no file. */
export function readNight(runsDir: string, night: string): NightDigest | null {
  if (!NIGHT.test(night)) return null;
  const root = path.resolve(runsDir);
  const file = path.resolve(root, `${night}.jsonl`);
  if (path.dirname(file) !== root) return null;
  if (!existsSync(file)) return null;

  const byJob = new Map<string, DigestRow & { firstMs: number; lastMs: number }>();
  const counts: StatusCounts = { ok: 0, retry: 0, fail: 0 };
  let badLines = 0;

  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (line.trim() === '') continue;
    const event = parseEvent(line);
    if (!event) {
      badLines += 1;
      continue;
    }
    counts[event.status] += 1;
    const row = byJob.get(event.job);
    if (!row) {
      byJob.set(event.job, {
        job: event.job,
        owner: event.owner,
        runs: 1,
        retries: event.status === 'retry' ? 1 : 0,
        lastStatus: event.status,
        lastError: event.error,
        firstAt: event.at,
        lastAt: event.at,
        firstMs: event.atMs,
        lastMs: event.atMs,
      });
      continue;
    }
    row.runs += 1;
    if (event.status === 'retry') row.retries += 1;
    if (event.atMs <= row.firstMs) {
      row.firstMs = event.atMs;
      row.firstAt = event.at;
    }
    if (event.atMs >= row.lastMs) {
      row.lastMs = event.atMs;
      row.lastAt = event.at;
      row.lastStatus = event.status;
      row.owner = event.owner;
      if (event.error !== null) row.lastError = event.error;
    }
  }

  const rows = [...byJob.values()]
    .map(({ firstMs: _firstMs, lastMs: _lastMs, ...row }) => row)
    .sort((a, b) => (a.job < b.job ? -1 : a.job > b.job ? 1 : 0));

  return { rows, badLines, counts };
}

function parseEvent(line: string): Event | null {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.at !== 'string' || typeof raw.job !== 'string' || raw.job === '') return null;
  if (typeof raw.status !== 'string' || !STATUSES.has(raw.status as JobStatus)) return null;
  const atMs = Date.parse(raw.at);
  if (Number.isNaN(atMs)) return null;
  if (raw.owner !== undefined && raw.owner !== null && typeof raw.owner !== 'string') return null;
  if (raw.error !== undefined && raw.error !== null && typeof raw.error !== 'string') return null;
  return {
    at: raw.at,
    atMs,
    job: raw.job,
    status: raw.status as JobStatus,
    owner: typeof raw.owner === 'string' ? raw.owner : null,
    error: typeof raw.error === 'string' ? raw.error : null,
  };
}
