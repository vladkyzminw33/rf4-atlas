import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runPipeline } from '../worker/src/pipeline.mjs';

const names = ['meta', 'sources', 'waters', 'spots', 'reels', 'rods', 'builds', 'gears', 'channels', 'inbox-state', 'inbox'];
async function load() {
  const d = {};
  for (const n of names) d[n] = JSON.parse(await readFile(new URL(`../data/${n}.json`, import.meta.url), 'utf8'));
  // Данные меняются сами: убираем ещё не сохранённые картинки, чтобы тест не зависел от текущего состояния.
  d.spots = d.spots.map((s) => ({ ...s, photos: (s.photos ?? []).filter((u) => u.startsWith('data/')) }));
  return d;
}
const html = (id, text, photo) => `<div class="tgme_widget_message_wrap" data-post="rr4pepper/${id}"><div class="tgme_widget_message_photo_wrap" style="background-image:url('${photo}')"></div><div class="tgme_widget_message_text">${text}</div><time datetime="2026-11-28T10:00:00+00:00"></time></div>`;

function makeIo(d, pages) {
  const calls = { commits: [], images: [] };
  return {
    calls,
    readJson: async (n, f) => d[n] ?? f,
    readAllData: async () => Object.fromEntries(['meta', 'sources', 'waters', 'spots', 'reels', 'rods', 'builds', 'gears'].map((n) => [n, d[n]])),
    fetchText: async (url) => pages[/\/s\/([^?]+)/.exec(url)[1]] ?? '',
    fetchImage: async (u) => { calls.images.push(u); return { type: 'image/jpeg', bytes: new Uint8Array([1, 2, 3]) }; },
    commit: async (files, msg) => calls.commits.push({ files, msg }),
    today: () => '2026-11-28',
  };
}

test('новый пост добавляет точку, картинку и коммит', async () => {
  const d = await load();
  const water = d.waters.find((w) => w.id === 'komarinoe');
  const io = makeIo(d, { rr4pepper: html(999999, `${water.name} Коорд: 12:34 Карась. Наживка: червь`, 'https://cdn4.telesco.pe/file/x.jpg') });
  const { report, changed } = await runPipeline(io);
  assert.ok(changed, report.join('\n'));
  const spots = JSON.parse(io.calls.commits[0].files.find((f) => f.path === 'data/spots.json').text);
  const s = spots.find((x) => x.coord === '12:34');
  assert.ok(s && s.post === 'https://t.me/rr4pepper/999999' && s.verified === false);
  assert.match(s.photos[0], /^data\/photos\/rr4pepper-999999-1\.jpg$/);
  assert.ok(io.calls.commits[0].files.some((f) => f.bytes));
});

test('без новых постов коммита нет', async () => {
  const d = await load();
  const { changed, report } = await runPipeline(makeIo(d, {}));
  assert.equal(changed, false, report.join('\n'));
});

test('новый пост про существующую точку обновляет её', async () => {
  const d = await load();
  const old = d.spots.find((s) => s.post && s.coord && s.fish && s.water);
  const water = d.waters.find((w) => w.id === old.water);
  const io = makeIo(d, { rr4pepper: html(999998, `${water.name} Коорд: ${old.coord} ${old.fish}. Наживка: тесто`, 'https://cdn4.telesco.pe/file/y.jpg') });
  const { changed } = await runPipeline(io);
  assert.ok(changed);
  const spots = JSON.parse(io.calls.commits[0].files.find((f) => f.path === 'data/spots.json').text);
  assert.equal(spots.length, d.spots.length);
  assert.equal(spots.find((s) => s.id === old.id).post, 'https://t.me/rr4pepper/999998');
});
