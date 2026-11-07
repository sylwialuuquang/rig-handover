import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { NightDigest } from '../src/digest/types.js';

const base = { adapter: 'shim', installed: '2026-10-29T14:06:00+01:00', beatEverySeconds: 60 };

function jobsIn(html: string): string[] {
  const body = html.split('<tbody>')[1]?.split('</tbody>')[0] ?? '';
  return [...body.matchAll(/<tr[^>]*>\s*<td>([^<]*)<\/td>/g)].map((match) => match[1] ?? '');
}

describe('digest routes', () => {
  let dir = '';

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = '';
  });

  function app() {
    dir = mkdtempSync(path.join(tmpdir(), 'rig-digest-'));
    return createApp({ ...base, runsDir: dir });
  }

  it('renders 2026-10-28 and the JSON has the same jobs in the same order', async () => {
    const rig = app();
    writeFileSync(
      path.join(dir, '2026-10-28.jsonl'),
      [
        '{"at":"2026-10-28T23:00:02+01:00","job":"rig/rotate-logs","status":"ok","owner":"lane-07"}',
        '{"at":"2026-10-29T01:30:00+01:00","job":"fixtures/refresh","status":"retry","owner":"rook","error":"upstream 503"}',
        '{"at":"2026-10-29T01:37:00+01:00","job":"fixtures/refresh","status":"ok","owner":"rook"}',
        '{"at":"2026-10-29T04:00:01+01:00","job":"notes/backup","status":"fail","owner":"lane-07","error":"quota exceeded"}',
        '',
      ].join('\n'),
    );

    const page = await rig.request('/digest/2026-10-28');
    const html = await page.text();
    const api = await rig.request('/api/digest/2026-10-28');
    const json = (await api.json()) as NightDigest;

    expect(page.status).toBe(200);
    expect(api.status).toBe(200);
    expect(html).toContain('fixtures/refresh');
    expect(html).toContain('class="warn"');
    expect(json.rows.map((row) => row.job)).toEqual(jobsIn(html));
  });

  it('returns 404 when the night has no file', async () => {
    const rig = app();
    const page = await rig.request('/digest/2026-10-01');
    const api = await rig.request('/api/digest/2026-10-01');
    expect(page.status).toBe(404);
    expect(api.status).toBe(404);
  });

  it('renders an empty night as nothing ran', async () => {
    const rig = app();
    writeFileSync(path.join(dir, '2026-10-26.jsonl'), '');
    const page = await rig.request('/digest/2026-10-26');
    const api = await rig.request('/api/digest/2026-10-26');
    const json = (await api.json()) as NightDigest;
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('nothing ran');
    expect(json.rows).toEqual([]);
  });

  it('renders a night that contains a bad line', async () => {
    const rig = app();
    writeFileSync(
      path.join(dir, '2026-10-25.jsonl'),
      'this is not json\n{"at":"2026-10-25T01:00:00+01:00","job":"lane/sync","status":"ok","owner":"rook"}\n',
    );
    const page = await rig.request('/digest/2026-10-25');
    const api = await rig.request('/api/digest/2026-10-25');
    const json = (await api.json()) as NightDigest;
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('lane/sync');
    expect(json.badLines).toBe(1);
    expect(json.rows.map((row) => row.job)).toEqual(['lane/sync']);
  });
});
