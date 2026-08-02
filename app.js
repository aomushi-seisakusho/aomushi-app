/* あおむし製作所 PWA
   非公開リポジトリ（金庫）から state.json / factory.svg / ledger.json を読んで表示する。
   第2期：係あての手紙を金庫の inbox/ に置けるようになった。
   置くのは金庫まで。Threadsへの送信も返信も、ここからは絶対にしない（憲法4条）。 */
'use strict';

const LS = {
  token: 'aomushi.token',
  owner: 'aomushi.owner',
  repo:  'aomushi.repo',
  state: 'aomushi.cache.state',
  pend:  'aomushi.sent.pending',   // 金庫に置いたが、まだ state.json に載っていない手紙
  draft: 'aomushi.mail.draft',     // 書きかけ。アプリが裏に回っても消えないように
};

const DEF = window.AOMUSHI_CONFIG || {};
const cfg = () => ({
  owner:  localStorage.getItem(LS.owner) || DEF.owner  || '',
  repo:   localStorage.getItem(LS.repo)  || DEF.repo   || '',
  branch: DEF.branch || 'main',
  token:  localStorage.getItem(LS.token) || '',
});

/* 黄色い帯は「この端末に鍵があるか」だけで決まる。通信の成否では動かさない。
   以前は refresh() が最後まで通ったときだけ消す作りで、社屋の絵が1枚読めない等の
   鍵と関係ない失敗があると、鍵を入れたあとも帯が消えないまま固まっていた。 */
function hasKey() {
  const c = cfg();
  return !!(c.token && c.owner && c.repo);
}
function paintKeyBanner() {
  const el = document.getElementById('nokey');
  if (el) el.hidden = hasKey();
}

// localStorage は端末の設定次第で書けないことがある。黙って死なせない
function put(k, v) {
  try { localStorage.setItem(k, v); return true; } catch (_) { return false; }
}

const $  = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');
const nf = (n) => Number(n || 0).toLocaleString('ja-JP');

// 型の色。出していいのは手分類だけ（自動判定は信用しない）
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

/* 金庫に1ファイル置く。置けるのは inbox/ の手紙だけに絞ってある。 */
async function push(path, text, message) {
  const c = cfg();
  if (!c.token || !c.owner || !c.repo) throw new NoKey('鍵がまだ入っていない');
  const url = `https://api.github.com/repos/${c.owner}/${c.repo}/contents/${path}`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      'Accept': 'application/vnd.github+json',
      'Authorization': `Bearer ${c.token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ message, content: b64utf8(text), branch: c.branch }),
  });
  if (res.status === 401) throw new Error('鍵が違うか、期限が切れている');
  // 403と404を同じ文言に潰していたせいで、別の病気を同じ薬で治そうとして1回外した。
  // 403＝金庫は見えるが書けない／404＝そもそもこの鍵から金庫が見えていない
  if (res.status === 403)
    throw new Error('鍵にこの金庫へ書き込む権限が無い（Contents を Read and write に）');
  if (res.status === 404)
    throw new Error('鍵からこの金庫が見えていない（鍵の対象リポジトリに入っていない／名前違い）');
  if (res.status === 409 || res.status === 422)
    throw new Error('金庫が動いている最中だった。少し置いてもう一度');
  if (!res.ok) throw new Error(`置けなかった（${res.status}）`);
  return res.json();
}

/* 生のAPI。力試し専用。status と GitHub の言い分を、翻訳せずそのまま返す。
   アプリの日本語に丸めた瞬間に、原因の切り分けができなくなる。 */
async function api(method, path, body) {
  const c = cfg();
  const opt = {
    method,
    cache: 'no-store',
    headers: {
      'Accept': 'application/vnd.github+json',
      'Authorization': `Bearer ${c.token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  };
  if (body) {
    opt.headers['Content-Type'] = 'application/json';
    opt.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch('https://api.github.com' + path, opt);
  } catch (_) {
    return { status: 0, data: null, msg: '通信が届かない（圏外か、遮断されている）' };
  }
  let data = null;
  try { data = await res.json(); } catch (_) {}
  return { status: res.status, data, msg: (data && data.message) || '' };
}

// btoa は日本語をそのまま渡すと落ちる。UTF-8のバイト列にしてから渡す
function b64utf8(s) {
  const by = new TextEncoder().encode(s);
  let bin = '';
  for (let i = 0; i < by.length; i += 0x8000)
    bin += String.fromCharCode.apply(null, by.subarray(i, i + 0x8000));
  return btoa(bin);
}

const pad = (n) => String(n).padStart(2, '0');
const stamp = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`
                   + `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
function isoLocal(d) {
  const off = -d.getTimezoneOffset(), a = Math.abs(off);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
       + `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
       + `${off >= 0 ? '+' : '-'}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}

/* ================= 画面の切り替え ================= */

const VIEWS = ['factory', 'mail', 'ledger', 'setup'];
let ledgerLoaded = false;

function show(name) {
  VIEWS.forEach((v) => { $(`#view-${v}`).hidden = (v !== name); });
  $$('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
  $('#opensetup').classList.toggle('on', name === 'setup');
  window.scrollTo(0, 0);
  if (name === 'ledger' && !ledgerLoaded) loadLedger();
}

$$('.tabs button').forEach((b) => b.addEventListener('click', () => show(b.dataset.tab)));

/* 端末に何が入っているかを言葉で出す。鍵そのものは出さず、頭と長さだけ。
   「入れたはずなのに」を推測で潰さないための、唯一の手がかり */
function paintKeyState() {
  const c = cfg();
  const el = $('#s-state');
  if (!el) return;
  let probe = 'この端末は保存できる';
  if (!put('aomushi.probe', '1')) probe = 'この端末は保存できない（設定でサイトのデータが止められている）';
  else localStorage.removeItem('aomushi.probe');
  el.innerHTML = [
    c.token
      ? `鍵：<b>入っている</b>（${esc(c.token.slice(0, 11))}… 全${c.token.length}文字）`
      : '鍵：<b>入っていない</b>',
    `持ち主：${esc(c.owner || '未設定')}／金庫：${esc(c.repo || '未設定')}`,
    probe,
  ].join('<br>');
  el.className = 'note keystate ' + (c.token ? 'ok' : 'ng');
}

function openSetup(focus) {
  const c = cfg();
  // 置き換え前のひな形（__OWNER__）は空欄として出す
  $('#s-owner').value = /^__/.test(c.owner) ? '' : c.owner;
  $('#s-repo').value  = c.repo;
  $('#s-token').value = '';
  $('#s-msg').textContent = c.token ? '貼り直すときだけ鍵の欄に入力する。' : '';
  $('#s-msg').className = 'note';
  paintKeyState();
  show('setup');
  // すでに設定画面に居るときに⚙を押しても見た目が変わらず「効いていない」と読める。
  // 押した手応えとして、鍵の欄に必ずカーソルを入れる
  if (focus) $('#s-token').focus();
}
$('#opensetup').addEventListener('click', () => openSetup(true));
$('#gokey').addEventListener('click', () => openSetup(true));

/* ================= 工場 ================= */

function renderState(st) {
  ST = st;
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
  if (!g) { bar(''); return; }
  const hrs = (Date.now() - g.getTime()) / 3.6e6;
  bar(hrs > 26
    ? `工場の情報が${Math.floor(hrs / 24)}日前のまま。Macが止まっているかもしれない。`
    : '');
}

function renderMail(st) {
  const line = (m, dir) => {
    const who = dir === 'in'
      ? (YAKU[m.from] || m.from || '係')
      : `編集長 → ${YAKU[m.to] || m.to || ''}`;
    const t = m.ts ? new Date(m.ts).toLocaleString('ja-JP',
      { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
    return `<li class="${m.pending ? 'pending' : ''}">
      <div class="mh"><span class="who">${esc(who)}</span>
        ${m.subject ? `<span>${esc(m.subject)}</span>` : ''}
        <span class="mt">${esc(t)}</span></div>
      <div class="mb">${esc(m.body || '')}</div>
      ${m.pending ? '<div class="pnote">金庫に置いた。次にMacが動いたときに係が読む。</div>' : ''}
      </li>`;
  };
  const mail = st.mail || [], sent = st.sent || [];
  // 金庫には届いたが state.json はまだ刷り直されていない分を、上に混ぜて出す
  const known = new Set(sent.map((m) => m.id));
  const pend = loadPending().filter((m) => !known.has(m.id));
  savePending(pend);
  const out = pend.map((m) => ({ ...m, pending: true })).concat(sent);

  $('#mail').innerHTML = mail.length ? mail.map((m) => line(m, 'in')).join('')
    : '<li class="empty">返事はまだ無い。（第3期で係が返事を書くようになる）</li>';
  $('#sent').innerHTML = out.length ? out.map((m) => line(m, 'out')).join('')
    : '<li class="empty">まだ何も送っていない。</li>';
  $('#maildot').hidden = mail.length === 0;
}

/* ================= 手紙を出す（第2期） ================= */

const jparse = (s, fb) => { try { return JSON.parse(s) ?? fb; } catch (_) { return fb; } };
const loadPending = () => {
  const v = jparse(localStorage.getItem(LS.pend), []);
  return Array.isArray(v) ? v : [];
};
const savePending = (a) => put(LS.pend, JSON.stringify(a.slice(0, 30)));

let ST = null;   // 最後に読めた会社の姿。送った直後に画面だけ描き直すのに使う

const draftFields = () => ({
  to: $('#m-to').value, subject: $('#m-subject').value, body: $('#m-body').value,
});
function saveDraft() { put(LS.draft, JSON.stringify(draftFields())); }
function restoreDraft() {
  const d = jparse(localStorage.getItem(LS.draft), null);
  if (!d) return;
  if (d.to) $('#m-to').value = d.to;
  $('#m-subject').value = d.subject || '';
  $('#m-body').value = d.body || '';
}
function clearDraft() {
  localStorage.removeItem(LS.draft);
  $('#m-subject').value = '';
  $('#m-body').value = '';
}
['#m-to', '#m-subject', '#m-body'].forEach((s) =>
  $(s).addEventListener('input', saveDraft));

$('#m-send').addEventListener('click', async () => {
  const btn = $('#m-send'), msg = $('#m-msg');
  const to = $('#m-to').value;
  const subject = $('#m-subject').value.trim();
  const body = $('#m-body').value.trim();
  msg.className = 'note';
  if (!body) { msg.className = 'note ng'; msg.textContent = '本文が空。'; return; }

  const d = new Date();
  const letter = {
    id: `${stamp(d)}-${to}`, from: 'boss', to, subject, body, ts: isoLocal(d),
  };
  btn.disabled = true;
  msg.textContent = '金庫に置いている…';
  try {
    await push(`inbox/${letter.id}.json`,
               JSON.stringify(letter, null, 2) + '\n',
               `社内便：編集長 → ${YAKU[to] || to}`);
    savePending([letter].concat(loadPending()));
    clearDraft();
    msg.className = 'note ok';
    msg.textContent = `${YAKU[to] || to}あてに置いた。Threadsには何も出ていない。`;
    renderMail(ST || {});
  } catch (e) {
    msg.className = 'note ng';
    msg.textContent = e instanceof NoKey
      ? '鍵がまだ入っていない。右上の⚙から入れる。'
      : `置けなかった：${e.message}（本文は消していない）`;
  } finally {
    btn.disabled = false;
  }
});

$('#m-discard').addEventListener('click', () => {
  clearDraft();
  $('#m-msg').className = 'note';
  $('#m-msg').textContent = '書きかけを消した。';
});

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
    `${nf(rows.length)}本中 ${nf(shown)}本を表示　／　型は人が読んで決めた${nf(HANDED)}本だけ表示`;
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

function bar(text) {
  const el = $('#stale');
  if (text) { el.hidden = false; el.textContent = text; } else { el.hidden = true; }
}

async function refresh(quiet) {
  const btn = $('#refresh');
  btn.classList.add('spin');
  paintKeyBanner();
  try {
    if (!hasKey()) throw new NoKey('鍵がまだ入っていない');
    // 社屋の絵が1枚読めないだけで会社ごと映らなくなるのは割に合わない。別々に扱う
    const [sr, gr] = await Promise.allSettled([
      pull('state/state.json'), pull('state/factory.svg')]);
    if (sr.status === 'rejected') throw sr.reason;
    const sTxt = sr.value;
    const st = JSON.parse(sTxt);
    put(LS.state, sTxt);
    renderState(st);                      // 中で staleCheck が帯を出し入れする
    if (gr.status === 'fulfilled') {
      $('#iso').innerHTML = gr.value;
    } else {
      $('#iso').innerHTML = '<div class="isoskel">社屋の絵だけ取りに行けなかった</div>';
      bar(`社屋の絵が読めない：${gr.reason.message}`);
    }
    if (ledgerLoaded) { ledgerLoaded = false; if (!$('#view-ledger').hidden) loadLedger(); }
  } catch (e) {
    const cached = localStorage.getItem(LS.state);
    if (cached) {
      try { renderState(JSON.parse(cached)); } catch (_) { /* 壊れたキャッシュは捨てる */ }
    }
    if (e instanceof NoKey) {
      $('#iso').innerHTML = '<div class="isoskel">鍵を入れると社屋が映る</div>';
      if (!quiet) openSetup(false);
    } else {
      bar(`つながらない：${e.message}${cached ? '（前に読んだ内容を表示中）' : ''}`);
      if (!$('#iso').innerHTML) $('#iso').innerHTML = '<div class="isoskel">社屋を取りに行けなかった</div>';
    }
  } finally {
    paintKeyBanner();
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
  let ok = true;
  if (owner) ok = put(LS.owner, owner) && ok;
  if (repo)  ok = put(LS.repo, repo) && ok;
  if (token) ok = put(LS.token, token) && ok;
  paintKeyBanner();
  paintKeyState();
  if (!ok) {   // 黙って消えるのが一番たちが悪い。書けないなら書けないと言う
    msg.className = 'note ng';
    msg.textContent = 'この端末に鍵を保存できなかった。'
      + 'プライベートブラウズを切るか、設定でこのサイトのデータを許可する。';
    return;
  }
  if (!cfg().token) {
    msg.className = 'note ng';
    msg.textContent = '鍵の欄が空。github_pat_ で始まる文字列を貼る。';
    return;
  }
  msg.className = 'note'; msg.textContent = 'つないでいる…';
  try {
    await pull('state/state.json');
    msg.className = 'note ok'; msg.textContent = 'つながった。工場を開く。';
    $('#s-token').value = '';
    await refresh(true);
    setTimeout(() => show('factory'), 500);
  } catch (e) {
    msg.className = 'note ng'; msg.textContent = `だめだった：${e.message}`;
  } finally {
    paintKeyBanner();
    paintKeyState();
  }
});

/* 鍵の力試し。①身元 ②金庫が見えるか ③読み ④書き を別々に叩いて、
   どこで落ちたかを数字のまま出す。「権限が無い」の一言では、
   Contents が Read-only なのか、そもそも金庫が鍵に入っていないのか区別できない。 */
const TESTPATH = 'inbox/_kagi_test.json';

async function selftest() {
  const c = cfg();
  const out = $('#s-testout'), btn = $('#s-test');
  const L = [];
  const say = (s) => { L.push(s); out.textContent = L.join('\n'); };
  const fin = (cls, ...tail) => { tail.forEach(say); out.className = 'note testout ' + cls; };

  out.hidden = false;
  out.className = 'note testout';
  if (!c.token) {
    out.className = 'note testout ng';
    out.textContent = '鍵が入っていない。先に鍵を貼る。';
    return;
  }
  btn.disabled = true;
  out.textContent = '試している…';
  try {
    say(`鍵 ${c.token.slice(0, 11)}…／全${c.token.length}文字`);
    say(`金庫 ${c.owner}/${c.repo}（${c.branch}）`);
    say('');

    const me = await api('GET', '/user');
    if (me.status === 401) {
      return fin('ng', `① 身元 …… ✕ 401 ${me.msg}`, '',
                 '→ 鍵そのものが違うか、期限が切れている。権限の話ではない。');
    }
    say(`① 身元 …… ${me.status === 200 ? '○ ' + ((me.data && me.data.login) || '') : '△ ' + me.status}`);

    const repo = await api('GET', `/repos/${c.owner}/${c.repo}`);
    if (repo.status !== 200) {
      return fin('ng', `② 金庫が見えるか …… ✕ ${repo.status} ${repo.msg}`, '',
                 `→ この鍵からは金庫そのものが見えていない。鍵の Repository access に `
                 + `${c.repo} が入っていないか、名前が違う。Contents の設定より手前の問題。`);
    }
    say('② 金庫が見えるか …… ○ 200');

    const rd = await api('GET', `/repos/${c.owner}/${c.repo}/contents/state/state.json`
                              + `?ref=${encodeURIComponent(c.branch)}`);
    say(`③ 読み …… ${rd.status === 200 ? '○ 200' : `✕ ${rd.status} ${rd.msg}`}`);

    const wr = await api('PUT', `/repos/${c.owner}/${c.repo}/contents/${TESTPATH}`, {
      message: '鍵の力試し（すぐ消す）',
      branch: c.branch,
      content: b64utf8('{"kagi":"test"}\n'),
    });
    if (wr.status === 200 || wr.status === 201) {
      say(`④ 書き …… ○ ${wr.status} 置けた`);
      const sha = wr.data && wr.data.content && wr.data.content.sha;
      const del = sha
        ? await api('DELETE', `/repos/${c.owner}/${c.repo}/contents/${TESTPATH}`,
                    { message: '力試しの後始末', branch: c.branch, sha })
        : { status: 0, msg: 'shaが返ってこなかった' };
      say(`⑤ 後始末 …… ${del.status === 200 ? '○ 消した'
                        : `△ ${del.status} 試しファイルが金庫に残った`}`);
      return fin('ok', '', '→ この鍵は書ける。社内便は通る。');
    }
    return fin('ng', `④ 書き …… ✕ ${wr.status} ${wr.msg}`, '',
      wr.status === 403
        ? '→ 読めるが書けない。この鍵の Contents は Read-only のまま。'
          + 'GitHubで直したのなら、直した鍵とこの端末の鍵（上の頭11文字）が別物だ。'
        : `→ 書きが ${wr.status} で落ちた。①〜③と併せて見る。`);
  } finally {
    btn.disabled = false;
  }
}
$('#s-test').addEventListener('click', selftest);

$('#s-clear').addEventListener('click', () => {
  localStorage.removeItem(LS.token);
  $('#s-token').value = '';
  paintKeyBanner();   // 消したのに帯が出ないと、消えたのか分からない
  paintKeyState();
  $('#s-msg').className = 'note';
  $('#s-msg').textContent = '鍵を消した。この端末からは金庫を読めなくなった。';
});

/* ================= 起動 ================= */

restoreDraft();
paintKeyBanner();
paintKeyState();
renderMail({});   // 金庫に置いたが未反映の手紙は、会社が読めなくても出す
$('#iso').innerHTML = '<div class="isoskel">社屋を取りに行っている…</div>';
refresh(false);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') refresh(true);
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
