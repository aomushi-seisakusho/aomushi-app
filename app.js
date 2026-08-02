/* あおむし製作所 PWA
   非公開リポジトリ（金庫）から state.json / factory.svg / ledger.json を読んで表示する。
   第1期は読み取りだけ。書き込みは第2期。投稿は絶対にしない（憲法4条）。 */
'use strict';

const LS = {
  token: 'aomushi.token',
  owner: 'aomushi.owner',
  repo:  'aomushi.repo',
  state: 'aomushi.cache.state',
};

const DEF = window.AOMUSHI_CONFIG || {};
const cfg = () => ({
  owner:  localStorage.getItem(LS.owner) || DEF.owner  || '',
  repo:   localStorage.getItem(LS.repo)  || DEF.repo   || '',
  branch: DEF.branch || 'main',
  token:  localStorage.getItem(LS.token) || '',
});

const $  = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');
const nf = (n) => Number(n || 0).toLocaleString('ja-JP');

// 型の色。出していいのは手分類だけ（自動判定は上位50本の56%を取り違えた）
const TYPE_COLOR = { A: '#F06292', D: '#4FC3F7', 'D-': '#3a7ea0', B: '#D4C34A', C: '#8a8fa8' };
const YAKU = { boss:'編集長', kiroku:'記録係', saikutsu:'採掘係',
               shippitsu:'執筆係', kenmon:'検問係', teisatsu:'偵察係' };

/* ================= 金庫から読む ================= */

class NoKey extends Error {}

async function pull(path) {
  const c = cfg();
  if (!c.token || !c.owner || !c.repo) throw new NoKey('鍵がまだ入っていない');
  const url = `https://api.github.com/repos/${c.owner}/${c.repo}/contents/${path}`
            + `?ref=${encodeURIComponent(c.branch)}`;
  const res = await fetch(url, {
    cache: 'no-store',
    headers: {
      // raw を指定すると base64 を経由せずファイルの中身がそのまま返る
      'Accept': 'application/vnd.github.raw',
      'Authorization': `Bearer ${c.token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (res.status === 401) throw new Error('鍵が違うか、期限が切れている');
  if (res.status === 403) throw new Error('鍵にこの金庫を読む権限が無い');
  if (res.status === 404) throw new Error(`金庫の中に ${path} が見つからない`);
  if (!res.ok) throw new Error(`つながらない（${res.status}）`);
  return res.text();
}

/* ================= 画面の切り替え ================= */

const VIEWS = ['factory', 'mail', 'ledger', 'setup'];
let ledgerLoaded = false;

function show(name) {
  VIEWS.forEach((v) => { $(`#view-${v}`).hidden = (v !== name); });
  $$('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
  window.scrollTo(0, 0);
  if (name === 'ledger' && !ledgerLoaded) loadLedger();
}

$$('.tabs button').forEach((b) => b.addEventListener('click', () => show(b.dataset.tab)));

function openSetup() {
  const c = cfg();
  // 置き換え前のひな形（__OWNER__）は空欄として出す
  $('#s-owner').value = /^__/.test(c.owner) ? '' : c.owner;
  $('#s-repo').value  = c.repo;
  $('#s-token').value = '';
  $('#s-msg').textContent = c.token ? '鍵は保存済み。貼り直すときだけ入力する。' : '';
  $('#s-msg').className = 'note';
  show('setup');
}
$('#opensetup').addEventListener('click', openSetup);

/* ================= 工場 ================= */

function renderState(st) {
  const c = st.counts || {};

  const chip = (label, val, warn) =>
    `<span class="chip${warn ? ' warn' : ''}">${esc(label)} <b>${esc(val)}</b></span>`;
  $('#chips').innerHTML = [
    chip('在庫 N-', c.zaiko, (c.zaiko || 0) === 0),
    chip('取材地図 E-', c.chizu),
    chip('台帳', `${nf(c.ledger)}本`),
    chip('実測', `${nf(c.measured)}本`),
    chip('決裁', `${(st.inbox_tasks || []).length}件`, (st.inbox_tasks || []).length > 0),
    chip('記録係', c.token ? '稼働' : 'トークン待ち', !c.token),
  ].join('');

  const h = $('#housou');
  if (st.housou) { h.hidden = false; h.querySelector('span').textContent = st.housou; }
  else h.hidden = true;

  const tasks = st.inbox_tasks || [];
  $('#inboxtasks').innerHTML = tasks.length
    ? tasks.map((t) => `<li>${esc(t)}</li>`).join('')
    : '<li class="empty">決裁待ちは無い。</li>';

  $('#roster').innerHTML = (st.roster || []).map((a) => `
    <li><b><i class="lampdot ${a.status === 'run' ? 'lg' : 'ly'}"></i>${esc(a.nm)}
      <em>${esc(a.status_label)}</em></b>
      <p>${esc(a.task)}</p></li>`).join('');

  $('#feed').innerHTML = (st.feed || []).length
    ? st.feed.map((f) => `<li><span>${esc(f.t)}</span>${esc(f.s)}</li>`).join('')
    : '<li class="empty">まだ動きが無い。</li>';

  renderMail(st);

  const g = st.generated_at ? new Date(st.generated_at) : null;
  $('#gen').textContent = g
    ? `この画面のもと：${g.toLocaleString('ja-JP', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })} 時点の会社`
    : '';
  staleCheck(g);
}

function staleCheck(g) {
  const el = $('#stale');
  if (!g) { el.hidden = true; return; }
  const hrs = (Date.now() - g.getTime()) / 3.6e6;
  if (hrs > 26) {
    el.hidden = false;
    el.textContent = `工場の情報が${Math.floor(hrs / 24)}日前のまま。Macが止まっているかもしれない。`;
  } else el.hidden = true;
}

function renderMail(st) {
  const line = (m, dir) => {
    const who = dir === 'in'
      ? (YAKU[m.from] || m.from || '係')
      : `編集長 → ${YAKU[m.to] || m.to || ''}`;
    const t = m.ts ? new Date(m.ts).toLocaleString('ja-JP',
      { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
    return `<li>
      <div class="mh"><span class="who">${esc(who)}</span>
        ${m.subject ? `<span>${esc(m.subject)}</span>` : ''}
        <span class="mt">${esc(t)}</span></div>
      <div class="mb">${esc(m.body || '')}</div></li>`;
  };
  const mail = st.mail || [], sent = st.sent || [];
  $('#mail').innerHTML = mail.length ? mail.map((m) => line(m, 'in')).join('')
    : '<li class="empty">返事はまだ無い。（第3期で係が返事を書くようになる）</li>';
  $('#sent').innerHTML = sent.length ? sent.map((m) => line(m, 'out')).join('')
    : '<li class="empty">まだ何も送っていない。（第2期で送れるようになる）</li>';
  $('#maildot').hidden = mail.length === 0;
}

/* ================= 台帳 ================= */

let LEDGER = [];
let HANDED = 0;
let shown = 0;
let sortKey = 'views';

function ledgerRows() {
  const q = $('#q').value.trim().toLowerCase();
  let rows = LEDGER;
  if (q) rows = rows.filter((p) =>
    (p.text || '').toLowerCase().includes(q) || (p.date || '').includes(q));
  const s = rows.slice();
  if (sortKey === 'views') s.sort((a, b) => b.views - a.views || b.likes - a.likes);
  // いいね率は views が無いと意味を持たない。未取得は末尾に落とす（憲法2条）
  if (sortKey === 'rate')  s.sort((a, b) => (b.rate ?? -1) - (a.rate ?? -1));
  if (sortKey === 'date')  s.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  return s;
}

function paintLedger(reset) {
  const rows = ledgerRows();
  if (reset) { shown = 0; $('#ltable').innerHTML = ''; }
  const slice = rows.slice(shown, shown + 40);
  shown += slice.length;
  const tag = (h) => h
    ? `<span class="tag" style="border-color:${TYPE_COLOR[h]};color:${TYPE_COLOR[h]}">${esc(h)}</span>`
    : '<span class="tag untyped">未分類</span>';
  $('#ltable').insertAdjacentHTML('beforeend', slice.map((p) => `
    <li class="${p.views ? '' : 'dim'}">
      <div class="lh">${tag(p.hand)}<span>${esc(p.date)}</span></div>
      <p class="lx">${esc(p.text)}</p>
      <div class="lnums">
        <span><i>views</i><b>${p.views ? nf(p.views) : '<span class="miss">未取得</span>'}</b></span>
        <span><i>いいね</i><b>${nf(p.likes)}</b></span>
        <span><i>率</i><b>${p.rate != null ? p.rate.toFixed(2) + '%' : '–'}</b></span>
      </div></li>`).join(''));
  $('#more').hidden = shown >= rows.length;
  $('#lstat').textContent =
    `${nf(rows.length)}本中 ${nf(shown)}本を表示　／　型は人が読んで決めた${nf(HANDED)}本だけ表示（自動判定は出さない）`;
}

async function loadLedger() {
  $('#lstat').textContent = '台帳を取りに行っている…';
  try {
    const txt = await pull('state/ledger.json');
    const d = JSON.parse(txt);
    LEDGER = d.posts || [];
    ledgerLoaded = true;
    HANDED = d.handed || 0;
    paintLedger(true);
  } catch (e) {
    $('#lstat').textContent = e instanceof NoKey
      ? '鍵がまだ入っていない。右上の⚙から入れる。'
      : `読めなかった：${e.message}`;
  }
}

$('#q').addEventListener('input', () => { if (ledgerLoaded) paintLedger(true); });
$('#more').addEventListener('click', () => paintLedger(false));
$$('#sortsegs button').forEach((b) => b.addEventListener('click', () => {
  $$('#sortsegs button').forEach((x) => x.classList.toggle('on', x === b));
  sortKey = b.dataset.sort;
  if (ledgerLoaded) paintLedger(true);
}));

/* ================= 社屋の絵 ================= */

$('#zoom').addEventListener('click', () => {
  const on = $('#isowrap').classList.toggle('zoom');
  $('#zoom').classList.toggle('on', on);
  $('#zoom').textContent = on ? '縮小' : '拡大';
});

/* ================= 読み込み ================= */

async function refresh(quiet) {
  const btn = $('#refresh');
  btn.classList.add('spin');
  try {
    const [sTxt, svg] = await Promise.all([pull('state/state.json'), pull('state/factory.svg')]);
    const st = JSON.parse(sTxt);
    try { localStorage.setItem(LS.state, sTxt); } catch (_) { /* 容量超過は無視 */ }
    renderState(st);
    $('#iso').innerHTML = svg;
    if (ledgerLoaded) { ledgerLoaded = false; if (!$('#view-ledger').hidden) loadLedger(); }
  } catch (e) {
    const cached = localStorage.getItem(LS.state);
    if (cached) {
      try { renderState(JSON.parse(cached)); } catch (_) { /* 壊れたキャッシュは捨てる */ }
    }
    if (e instanceof NoKey) {
      $('#iso').innerHTML = '<div class="isoskel">鍵を入れると社屋が映る（右上の⚙）</div>';
      if (!quiet) openSetup();
    } else {
      $('#stale').hidden = false;
      $('#stale').textContent = `つながらない：${e.message}${cached ? '（前に読んだ内容を表示中）' : ''}`;
      if (!$('#iso').innerHTML) $('#iso').innerHTML = '<div class="isoskel">社屋を取りに行けなかった</div>';
    }
  } finally {
    btn.classList.remove('spin');
  }
}

$('#refresh').addEventListener('click', () => refresh(true));

/* ================= 設定 ================= */

$('#s-save').addEventListener('click', async () => {
  const owner = $('#s-owner').value.trim();
  const repo  = $('#s-repo').value.trim();
  const token = $('#s-token').value.trim();
  const msg = $('#s-msg');
  if (owner) localStorage.setItem(LS.owner, owner);
  if (repo)  localStorage.setItem(LS.repo, repo);
  if (token) localStorage.setItem(LS.token, token);
  msg.className = 'note'; msg.textContent = 'つないでいる…';
  try {
    await pull('state/state.json');
    msg.className = 'note ok'; msg.textContent = 'つながった。工場を開く。';
    $('#s-token').value = '';
    await refresh(true);
    setTimeout(() => show('factory'), 500);
  } catch (e) {
    msg.className = 'note ng'; msg.textContent = `だめだった：${e.message}`;
  }
});

$('#s-clear').addEventListener('click', () => {
  localStorage.removeItem(LS.token);
  $('#s-token').value = '';
  $('#s-msg').className = 'note';
  $('#s-msg').textContent = '鍵を消した。この端末からは金庫を読めなくなった。';
});

/* ================= 起動 ================= */

$('#iso').innerHTML = '<div class="isoskel">社屋を取りに行っている…</div>';
refresh(false);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') refresh(true);
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
