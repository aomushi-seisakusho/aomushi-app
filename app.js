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
  kes:   'aomushi.kessai.pending', // 決裁票は置いたが、まだ原稿に印が付いていない分
  push:  'aomushi.push.id',        // 知らせの宛先ID（金庫の push/<id>.json と対）
};

// この端末が今どの版を動かしているか。sw.js の V と必ず同じ数字にする。
// 「新しくしたのに出ない」を推測で潰さないための、唯一の手がかり
const APPV = 'v15';

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
const on = (sel, ev, fn) => { const el = document.querySelector(sel);
  if (el) el.addEventListener(ev, fn); return !!el; };
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
/* 失敗は必ず番号を連れて回る。「置けなかった」だけでは次の一手が出せない。
   status 0 ＝ 電波そのものが届いていない */
class ApiErr extends Error {
  constructor(status, msg) { super(msg); this.status = status; }
}

async function pull(path) {
  const c = cfg();
  if (!c.token || !c.owner || !c.repo) throw new NoKey('鍵がまだ入っていない');
  const url = `https://api.github.com/repos/${c.owner}/${c.repo}/contents/${path}`
            + `?ref=${encodeURIComponent(c.branch)}`;
  let res;
  try {
    res = await fetch(url, {
      cache: 'no-store',
      headers: {
        // raw を指定すると base64 を経由せずファイルの中身がそのまま返る
        'Accept': 'application/vnd.github.raw',
        'Authorization': `Bearer ${c.token}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
  } catch (_) {
    throw new ApiErr(0, '通信が届かない（圏外か、遮断されている）');
  }
  if (res.status === 401) throw new ApiErr(401, '鍵が違うか、期限が切れている');
  if (res.status === 403) throw new ApiErr(403, '鍵にこの金庫を読む権限が無い');
  if (res.status === 404) throw new ApiErr(404, `金庫の中に ${path} が見つからない`);
  if (!res.ok) throw new ApiErr(res.status, `つながらない（${res.status}）`);
  return res.text();
}

/* 金庫に1ファイル置く。置けるのは inbox/ の手紙だけに絞ってある。 */
async function push(path, text, message) {
  const c = cfg();
  if (!c.token || !c.owner || !c.repo) throw new NoKey('鍵がまだ入っていない');
  const url = `https://api.github.com/repos/${c.owner}/${c.repo}/contents/${path}`;
  let res;
  try {
    res = await fetch(url, {
      method: 'PUT',
      headers: {
        'Accept': 'application/vnd.github+json',
        'Authorization': `Bearer ${c.token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ message, content: b64utf8(text), branch: c.branch }),
    });
  } catch (_) {
    throw new ApiErr(0, '通信が届かない（圏外か、遮断されている）');
  }
  if (res.status === 401) throw new ApiErr(401, '鍵が違うか、期限が切れている');
  // 403と404を同じ文言に潰していたせいで、別の病気を同じ薬で治そうとして1回外した。
  // 403＝金庫は見えるが書けない／404＝そもそもこの鍵から金庫が見えていない
  if (res.status === 403)
    throw new ApiErr(403, '金庫は見えるが、書き込みを断られた');
  if (res.status === 404)
    throw new ApiErr(404, 'この鍵から金庫が見えていない');
  if (res.status === 409 || res.status === 422)
    throw new ApiErr(res.status, '金庫が動いている最中だった');
  if (!res.ok) throw new ApiErr(res.status, `置けなかった（${res.status}）`);
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

/* 鍵の見分け札。頭11文字だけ出していたが `github_pat_` はちょうど11文字＝
   fine-grained の鍵は全部これで始まる。つまり2つの鍵を見分けるための表示が、
   何一つ見分けていなかった（403の切り分けで実際に役に立たなかった）。
   種別の後ろ7文字と末尾4文字を出す。これで別物かどうかは判る。 */
function keyFrag(t) {
  if (!t) return '';
  return t.length > 26 ? `${t.slice(0, 18)}…${t.slice(-4)}` : `${t.slice(0, 8)}…`;
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

/* ================= 失敗の出し方 =================
   黙って死なない。落ちたら必ず「何が起きたか」と「次に何を押すか」を赤字で出す。
   番号ごとに病気が違う。同じ文言に潰すと、直す場所を間違える（実際に1回外した）。 */

function gotoTest() {
  openSetup(false);
  const b = $('#s-test');
  if (b) { b.scrollIntoView({ block: 'center' }); b.click(); }
}

function explainFail(e) {
  if (e instanceof NoKey) return {
    why: 'この端末に鍵が入っていない。金庫に置きに行けない。',
    next: '右上の⚙で鍵を貼る。Macで ./kagi.sh を走らせてQRを読むのが一番確実。',
    act: { label: '⚙を開く', go: () => openSetup(true) } };
  const s = e && e.status;
  if (s === 0) return {
    why: '通信が届かなかった（圏外か、遮断されている）',
    next: '電波を確かめて、もう一度送る。書いたものは消えていない。' };
  if (s === 401) return {
    why: '鍵が違うか、期限が切れている（401）',
    next: 'GitHubで鍵を作り直して、Macで ./kagi.sh → 出たQRを読む。',
    act: { label: '⚙を開く', go: () => openSetup(true) } };
  if (s === 403) return {
    why: '金庫は見えるが、書き込みを断られた（403）',
    next: '鍵の Contents が Read-only のまま。Read and write に直す。'
        + '直したのにここに来るなら、直した鍵とこの端末の鍵が別物だ（⚙の鍵の札で見比べる）。',
    act: { label: '鍵を試す', go: gotoTest } };
  if (s === 404) return {
    why: 'この鍵から金庫が見えていない（404）',
    next: '鍵の Repository access に金庫が入っているか、金庫の名前が合っているかを見る。'
        + '権限より手前の問題。',
    act: { label: '鍵を試す', go: gotoTest } };
  if (s === 409 || s === 422) return {
    why: `金庫が動いている最中だった（${s}）`,
    next: '20秒ほど置いて、もう一度送る。' };
  return {
    why: (e && e.message) || '理由が分からない失敗',
    next: 'もう一度送る。同じところで落ち続けるなら、⚙の「鍵を試す」で①〜⑤のどこで落ちるか見る。',
    act: { label: '鍵を試す', go: gotoTest } };
}

/* 赤い箱を1つ出す。理由・次の一手・押せるボタンの3点セットで出す。 */
function failInto(el, e, retry, retryLabel) {
  if (!el) return;
  const x = explainFail(e);
  el.hidden = false;
  el.className = 'failbox';
  el.innerHTML = `<b class="fw">✕ ${esc(x.why)}</b>`
               + `<span class="fn">次の一手：${esc(x.next)}</span>`
               + `<span class="btnrow"></span>`;
  const row = el.querySelector('.btnrow');
  const add = (label, go) => {
    const b = document.createElement('button');
    b.className = 'btn ghost'; b.textContent = label;
    b.addEventListener('click', go);
    row.appendChild(b);
  };
  if (retry) add(retryLabel || 'もう一度送る', retry);
  if (x.act) add(x.act.label, x.act.go);
}
const clearFail = (el) => { if (el) { el.hidden = true; el.innerHTML = ''; } };

/* ================= いつ・どこまで進んだか =================
   3つの札しか無い。
     送った（未読） 金庫には置いた。Macはまだ取りに来ていない＝係は読んでいない
     届いた         Macが取り込んだ。係が読んでいる最中（返事は数分かかる）
     係が読んだ     返事が金庫に戻ってきた
   「届いた」は配達係が押す印（state/recv.json）でしか分からない。推測で出さない。 */

let RECV = { beat: '', recv: {} };

const MIN = 60000;
function ago(ts) {
  const t = ts ? new Date(ts).getTime() : NaN;
  if (!t || isNaN(t)) return '';
  const m = Math.floor((Date.now() - t) / MIN);
  if (m < 1) return 'たった今';
  if (m < 60) return `${m}分前`;
  if (m < 24 * 60) return `${Math.floor(m / 60)}時間前`;
  return `${Math.floor(m / 1440)}日前`;
}
const hhmm = (ts) => {
  const d = ts ? new Date(ts) : null;
  return (d && !isNaN(d)) ? d.toLocaleString('ja-JP',
    { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
};
const minsSince = (ts) => {
  const t = ts ? new Date(ts).getTime() : NaN;
  return (!t || isNaN(t)) ? 0 : (Date.now() - t) / MIN;
};

/* 配達係は5分おきに金庫を見に来る。これを大きく超えて未読なら、
   原因は「係が忙しい」ではなく「Macが動いていない」。そう書く。 */
const LATE = 12;

function trace(id, sentTs) {
  const rep = (ST && ST.mail || []).find((m) => m.re === id);
  if (rep) return rep.failed
    ? { k: 'ng',   label: '配達できなかった', ts: rep.ts, rep }
    : { k: 'read', label: '係が読んだ',       ts: rep.ts, rep };
  const r = RECV.recv && RECV.recv[id];
  if (r) return { k: 'recv', label: '届いた', ts: r.ts };
  return { k: 'sent', label: '送った（未読）', ts: sentTs,
           late: minsSince(sentTs) > LATE };
}

/* 札の下の1行。何を待っているのかを、待っている本人に分かる言葉で書く */
function traceLine(t) {
  if (t.k === 'sending') return '金庫に置いている…';
  if (t.k === 'read')  return `${hhmm(t.ts)} に返事が戻った（${ago(t.ts)}）`;
  if (t.k === 'ng')    return `${hhmm(t.ts)} に配達係が失敗を書いた。下の返事に理由が出ている`;
  if (t.k === 'recv')  return `${hhmm(t.ts)} にMacが取り込んだ（${ago(t.ts)}）。係が読んでいる最中`;
  const base = `${hhmm(t.ts)} に送った（${ago(t.ts)}）`;
  return t.late
    ? `${base}。${Math.floor(minsSince(t.ts))}分たっても取りに来ていない。Macが止まっているかもしれない`
    : `${base}。次にMacが動いたときに係が読む`;
}
const statChip = (t) => `<span class="stat ${t.k}">${esc(t.label)}</span>`;

/* 仕組みの説明。社内便と決裁の両方に同じものを出す（憲法4条の担保でもある） */
const HOWTO = `
<div class="flow">
  <div class="fstep"><b>1</b><span class="stat sent">送った（未読）</span>
    <p>非公開の金庫に置いただけ。<b>まだ誰も読んでいない。</b></p></div>
  <div class="fstep"><b>2</b><span class="stat recv">届いた</span>
    <p>Macが5分おきに金庫を見に来て、取り込んだ。係が読んでいる最中（返事まで数分）。</p></div>
  <div class="fstep"><b>3</b><span class="stat read">係が読んだ</span>
    <p>返事が金庫に戻った。「係からの返事」に出る。</p></div>
</div>
<p class="hnote"><b>Macが動くまで、係は読まない。</b>
Macが閉じている・止まっている間、手紙は金庫でただ待つ。何時間でも待つ。<br>
そしてどこまで進んでも<b>Threadsには何も出ない</b>（憲法4条）。出すのは編集長が自分で貼ったときだけ。</p>
<p class="hbeat" data-beat></p>`;

function paintBeat() {
  const b = RECV.beat;
  const txt = b
    ? `配達係（Mac）が最後に動いたのは ${hhmm(b)}（${ago(b)}）。`
      + (minsSince(b) > 60 ? ' 5分おきに動くはずなので、止まっている。' : ' 生きている。')
    : '配達係がまだ一度も印を押していない（Macで haitatsu.py が走っていない）。';
  $$('[data-beat]').forEach((el) => {
    el.textContent = txt;
    el.className = 'hbeat' + (!b || minsSince(b) > 60 ? ' late' : '');
  });
}

/* ================= 画面の切り替え ================= */

const VIEWS = ['factory', 'mail', 'kessai', 'ledger', 'setup'];
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
/* 配信中の版。sw.js を素で取りに行って中の V を読む。
   端末の版と突き合わせれば「取り直しが要るのか、もう新しいのか」を推測しないで済む。
   ここが分からないせいで「取り直したのに変わらない」を何度も水掛け論にした。 */
let SRV = '';
async function checkVersion() {
  try {
    const r = await fetch('sw.js?probe=' + Date.now(), { cache: 'no-store' });
    const m = (await r.text()).match(/aomushi-(v\d+)/);
    SRV = m ? m[1] : '';
  } catch (_) { SRV = ''; }
  paintKeyState();
}

function paintKeyState() {
  const c = cfg();
  const el = $('#s-state');
  if (!el) return;
  let probe = 'この端末は保存できる';
  if (!put('aomushi.probe', '1')) probe = 'この端末は保存できない（設定でサイトのデータが止められている）';
  else localStorage.removeItem('aomushi.probe');
  const ver = SRV
    ? (SRV === APPV
        ? `　配信中も <b>${esc(SRV)}</b>。<b>最新。取り直しは要らない。</b>`
        : `　<b class="warn">配信中は ${esc(SRV)}。この端末は古い＝取り直しが要る。</b>`)
    : '　（配信中の版はまだ見に行けていない）';
  el.innerHTML = [
    c.token
      ? `鍵：<b>入っている</b>（${esc(keyFrag(c.token))} 全${c.token.length}文字）`
      : '鍵：<b>入っていない</b>',
    `持ち主：${esc(c.owner || '未設定')}／金庫：${esc(c.repo || '未設定')}`,
    probe,
    `アプリ：<b>${APPV}</b>（この端末が動かしている版）${ver}`,
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
  checkVersion();     // 配信中の版を見に行く。返ったら実状の欄が自分で書き変わる
  paintShirase();
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
  renderKessai(st);

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

/* 係の返事は Markdown で来る。スマホで生のパイプ記号を読ませない。
   太字・見出し・箇条書き・表だけ起こす。必ず esc() を通してから組み立てる（HTMLは入れさせない）。 */
function mdlite(src) {
  const inline = (s) => esc(s)
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
  const rows = (l) => l.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
  const out = [];
  const lines = String(src || '').split('\n');
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (/^\s*\|.*\|\s*$/.test(l)) {                       // 表：|…|…| が続くあいだ
      const tb = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) tb.push(lines[i++]);
      const body = tb.filter((r) => !/^\s*\|[\s|:-]+\|\s*$/.test(r));   // ---の行は捨てる
      out.push('<div class="tw"><table>' + body.map((r, n) =>
        '<tr>' + rows(r).map((c) =>
          `<${n ? 'td' : 'th'}>${inline(c)}</${n ? 'td' : 'th'}>`).join('') + '</tr>').join('')
        + '</table></div>');
      continue;
    }
    if (/^\s*(#{1,6})\s+/.test(l)) { out.push(`<h4>${inline(l.replace(/^\s*#+\s+/, ''))}</h4>`); i++; continue; }
    if (/^\s*[-*・]\s+/.test(l)) {                         // 箇条書き：続くあいだ束ねる
      const li = [];
      while (i < lines.length && /^\s*[-*・]\s+/.test(lines[i]))
        li.push(`<li>${inline(lines[i++].replace(/^\s*[-*・]\s+/, ''))}</li>`);
      out.push(`<ul class="mdl">${li.join('')}</ul>`);
      continue;
    }
    if (!l.trim()) { out.push('<div class="msp"></div>'); i++; continue; }
    out.push(`<p>${inline(l)}</p>`);
    i++;
  }
  return out.join('');
}

/* 係からの返事（受け） */
function inLine(m) {
  const who = YAKU[m.from] || m.from || '係';
  return `<li id="re-${esc(m.id)}" class="${m.failed ? 'bad' : ''}">
    <div class="mh"><span class="who">${esc(who)}</span>
      ${m.subject ? `<span>${esc(m.subject)}</span>` : ''}
      <span class="mt">${esc(hhmm(m.ts))}</span></div>
    <div class="mb">${mdlite(m.body)}</div>
    </li>`;
}

/* 編集長が送った分（出し）。1通ごとに、今どこまで進んだかを必ず出す */
function outLine(m) {
  const t = m.flight ? { k: 'sending', label: '送っている…' } : trace(m.id, m.ts);
  const rep = t.rep;
  return `<li class="s-${t.k}">
    <div class="mh"><span class="who">編集長 → ${esc(YAKU[m.to] || m.to || '')}</span>
      ${m.subject ? `<span>${esc(m.subject)}</span>` : ''}
      <span class="mt">${esc(hhmm(m.ts))}</span></div>
    <div class="srow">${statChip(t)}<span class="sline">${esc(traceLine(t))}</span></div>
    <div class="mb">${esc(m.body || '')}</div>
    ${rep ? `<button class="jump" data-jump="re-${esc(rep.id)}">${
      t.k === 'ng' ? '失敗の中身を見る' : '返事を読む'}</button>` : ''}
    </li>`;
}

function renderMail(st) {
  const mail = st.mail || [], sent = st.sent || [];
  // 金庫には置いたが state.json はまだ刷り直されていない分を、上に混ぜて出す。
  // 送った手紙は消さない。ここから消えるのは、金庫側の一覧に出たときだけ
  const known = new Set(sent.map((m) => m.id));
  const pend = loadPending().filter((m) => !known.has(m.id));
  savePending(pend);
  const out = pend.concat(sent)
    .sort((a, b) => String(b.ts || '').localeCompare(String(a.ts || '')));
  if (FLIGHT.letter) out.unshift({ ...FLIGHT.letter, flight: true });

  $('#mail').innerHTML = mail.length ? mail.map(inLine).join('')
    : '<li class="empty">返事はまだ無い。手紙を出せば、次にMacが動いたときに係が読む。</li>';
  $('#sent').innerHTML = out.length ? out.map(outLine).join('')
    : '<li class="empty">まだ何も送っていない。</li>';

  const unread = out.filter((m) => !m.flight && trace(m.id, m.ts).k === 'sent').length;
  $('#sentstat').innerHTML = out.length
    ? `送った ${out.length}通　／　まだ読まれていない <b class="${unread ? 'amb' : ''}">${unread}通</b>`
    : '';
  $('#maildot').hidden = mail.length === 0;
  paintBeat();
}

// 返事へ飛ぶ。長い一覧で「どれの返事か」を目で探させない
on('#sent', 'click', (ev) => {
  const b = ev.target.closest('[data-jump]');
  if (!b) return;
  const el = document.getElementById(b.dataset.jump);
  if (el) { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); el.classList.add('flash'); }
});

/* ================= 決裁（第3期・校了ボタン） =================
   校了しても Threads には何も出ない。出すのは編集長が自分で貼ったときだけ（憲法4条）。
   ここが書くのは金庫の inbox/ に置く決裁票1枚。原稿に印をつけるのはMac側の配達係。 */

const loadKes = () => {
  const v = jparse(localStorage.getItem(LS.kes), {});
  return (v && typeof v === 'object') ? v : {};
};
const saveKes = (o) => put(LS.kes, JSON.stringify(o));

const ST_CLS = { '校了': 'ok', '再校': 'ng', '初校': '' };

/* 押した瞬間に見た目を変えるための、通信中だけの覚え書き。
   金庫に届く前でも札が変わっていないと、押したのかどうか本人に分からない */
const FLIGHT = { letter: null, kes: {} };
let REASON = '';   // 差し戻しの理由を書いている原稿。書いている最中は画面を描き直さない

function renderKessai(st, force) {
  // 通信中・理由を書いている最中に、裏の自動更新で画面を消さない
  if (!force && (REASON || Object.keys(FLIGHT.kes).length)) return;
  const ds = st.drafts || [];
  const pend = loadKes();
  // Mac側が印を付け終わった原稿は、待ち札を消す
  ds.forEach((d) => { if (pend[d.n] && pend[d.n].want === d.st) delete pend[d.n]; });
  saveKes(pend);

  $('#drafts').innerHTML = ds.length ? ds.map((d) => {
    const f = FLIGHT.kes[d.n];
    const p = pend[d.n];
    const st_ = (f && f.want) || (p && p.want) || d.st;
    const t = f ? { k: 'sending', label: '送っている…' } : (p ? trace(p.id, p.ts) : null);
    return `<li class="${t ? 's-' + t.k : ''}" data-li="${esc(d.n)}">
      <div class="dh"><b>${esc(d.n)}</b>
        <span class="badge ${ST_CLS[st_] || ''}">${esc(st_)}</span></div>
      ${t ? `<div class="srow">${statChip(t)}<span class="sline">${esc(
              t.k === 'read' ? `${hhmm(t.ts)} にMacが原稿に印を付けた（${ago(t.ts)}）`
                             : traceLine(t))}</span></div>` : ''}
      ${p && p.note ? `<div class="pnote">差し戻しの理由：${esc(p.note)}</div>` : ''}
      <div class="dt">${esc(d.body || d.h || '')}</div>
      ${d.reason ? `<div class="drea">検問：${esc(d.reason)}</div>` : ''}
      ${t ? kesTail(d.n, t) : `
      <div class="btnrow">
        <button class="btn kes-ok" data-n="${esc(d.n)}">校了にする</button>
        <button class="btn ghost kes-ng" data-n="${esc(d.n)}">差し戻す</button>
        <button class="btn ghost kes-cp" data-n="${esc(d.n)}">本文をコピー</button>
      </div>`}
      ${REASON === d.n ? `
      <div class="rbox">
        <label class="fld"><span>差し戻す理由（そのまま執筆係に渡る）</span>
          <textarea class="r-note" rows="3"
            placeholder="例：E-由来＝焼き直し。N-在庫から書き直し"></textarea></label>
        <div class="btnrow">
          <button class="btn kes-send" data-n="${esc(d.n)}">この理由で差し戻す</button>
          <button class="btn ghost kes-cancel" data-n="${esc(d.n)}">やめる</button>
        </div>
      </div>` : ''}
      <div class="failbox" id="kf-${esc(d.n)}" hidden></div>
      <p class="note kes-msg" id="km-${esc(d.n)}"></p>
    </li>`;
  }).join('') : '<li class="empty">下書きが無い。執筆係が書けば、ここに出る。</li>';

  if (REASON) {
    const ta = document.querySelector(`[data-li="${CSS.escape(REASON)}"] .r-note`);
    if (ta) ta.focus();
  }
  const waiting = ds.filter((d) => d.st === '初校' || d.st === '再校').length;
  $('#kesdot').hidden = waiting === 0;
  paintBeat();
}

/* 決裁を出したあとの足元。取り消せるのは「まだMacが取りに来ていない」間だけ。
   取り込まれたあとに「取り消せます」と出すのは嘘になる。 */
function kesTail(n, t) {
  const cp = `<button class="btn ghost kes-cp" data-n="${esc(n)}">本文をコピー</button>`;
  if (t.k === 'sending') return '';
  if (t.k === 'sent') return `<div class="btnrow">
      <button class="btn ghost kes-undo" data-n="${esc(n)}">取り消す（まだ間に合う）</button>
      ${cp}</div>`;
  if (t.k === 'recv') return `<p class="note">Macがもう取り込んだ。これは取り消せない。
      変えるなら、印が付いたあとにもう一度 決裁する。</p><div class="btnrow">${cp}</div>`;
  return `<div class="btnrow">${cp}</div>`;
}

async function decide(n, want, note) {
  const d = new Date();
  const slip = {
    id: `${stamp(d)}-kessai-${n}`, kind: 'kessai',
    draft: n, action: want === '校了' ? 'pass' : 'reject',
    note: note || '', from: 'boss', ts: isoLocal(d),
  };
  clearFail($(`#kf-${CSS.escape(n)}`));
  REASON = '';
  FLIGHT.kes[n] = { want };            // 押した瞬間に札と見出しを変える。通信を待たない
  renderKessai(ST || {}, true);
  try {
    await push(`inbox/${slip.id}.json`, JSON.stringify(slip, null, 2) + '\n',
               `決裁：${n} を${want}`);
    const pend = loadKes();
    pend[n] = { want, ts: slip.ts, id: slip.id, note: note || '' };
    saveKes(pend);
    delete FLIGHT.kes[n];
    renderKessai(ST || {}, true);
  } catch (e) {
    delete FLIGHT.kes[n];              // 見た目を押す前に戻す。送れていないのに校了に見せない
    renderKessai(ST || {}, true);
    failInto($(`#kf-${CSS.escape(n)}`), e, () => decide(n, want, note),
             `もう一度「${want}」を送る`);
    const m = $(`#km-${CSS.escape(n)}`);
    if (m) { m.className = 'note ng';
      m.textContent = `${want}の記録は金庫に残っていない。原稿はそのまま。`; }
  }
}

/* 取り消し＝金庫に置いた決裁票そのものを消す。
   Macがまだ取りに来ていなければ、無かったことになる。 */
async function undoKes(n) {
  const p = loadKes()[n];
  const msg = $(`#km-${CSS.escape(n)}`);
  clearFail($(`#kf-${CSS.escape(n)}`));
  if (!p || !p.id) {   // アプリを新しくする前に送った分には、票の名前が残っていない
    if (msg) { msg.className = 'note ng';
      msg.textContent = 'どの決裁票か分からないので取り消せない（アプリを新しくする前に送った分）。'; }
    return;
  }
  if (msg) { msg.className = 'note'; msg.textContent = '取り消している…'; }
  const c = cfg();
  const path = `/repos/${c.owner}/${c.repo}/contents/inbox/${p.id}.json`;
  try {
    const cur = await api('GET', `${path}?ref=${encodeURIComponent(c.branch)}`);
    if (cur.status === 200 && cur.data && cur.data.sha) {
      const del = await api('DELETE', path,
        { message: `決裁を取り消す：${n}`, branch: c.branch, sha: cur.data.sha });
      if (del.status !== 200) throw new ApiErr(del.status, del.msg || '決裁票を消せなかった');
    } else if (cur.status !== 404) {   // 404＝すでに金庫に無い。取り消しとしては成功
      throw new ApiErr(cur.status, cur.msg || '決裁票を探しに行けなかった');
    }
    const pend = loadKes();
    delete pend[n];
    saveKes(pend);
    renderKessai(ST || {}, true);
    const m = $(`#km-${CSS.escape(n)}`);
    if (m) { m.className = 'note ok';
      m.textContent = '取り消した。決裁票は金庫から消えたので、係には渡らない。'; }
  } catch (e) {
    failInto($(`#kf-${CSS.escape(n)}`), e, () => undoKes(n), 'もう一度取り消す');
    if (msg) { msg.className = 'note ng';
      msg.textContent = '取り消せていない。決裁票は金庫に残ったまま。'; }
  }
}

on('#drafts', 'click', async (ev) => {
  const b = ev.target.closest('button');
  if (!b) return;
  const n = b.dataset.n;
  if (b.classList.contains('kes-cp')) {
    const d = (ST && ST.drafts || []).find((x) => x.n === n);
    const msg = $(`#km-${CSS.escape(n)}`);
    try {
      await navigator.clipboard.writeText((d && d.body) || '');
      msg.className = 'note ok'; msg.textContent = '本文をコピーした。Threadsに貼るのは編集長の手で。';
    } catch (_) {
      msg.className = 'note ng'; msg.textContent = 'この端末ではコピーできなかった。長押しで選んでくれ。';
    }
    return;
  }
  if (b.classList.contains('kes-ok'))   return decide(n, '校了', '');
  if (b.classList.contains('kes-undo')) return undoKes(n);
  // prompt() は、ホーム画面から開いたアプリだと出ない端末がある。画面の中で書かせる
  if (b.classList.contains('kes-ng'))     { REASON = n;  renderKessai(ST || {}, true); return; }
  if (b.classList.contains('kes-cancel')) { REASON = ''; renderKessai(ST || {}, true); return; }
  if (b.classList.contains('kes-send')) {
    const ta = document.querySelector(`[data-li="${CSS.escape(n)}"] .r-note`);
    return decide(n, '再校', (ta && ta.value.trim()) || '');
  }
});

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

async function sendLetter() {
  const btn = $('#m-send'), msg = $('#m-msg'), fail = $('#m-fail');
  const to = $('#m-to').value;
  const subject = $('#m-subject').value.trim();
  const body = $('#m-body').value.trim();
  msg.className = 'note';
  clearFail(fail);
  if (!body) { msg.className = 'note ng'; msg.textContent = '本文が空。'; return; }

  const d = new Date();
  const letter = {
    id: `${stamp(d)}-${to}`, from: 'boss', to, subject, body, ts: isoLocal(d),
  };
  btn.disabled = true;
  // 押した瞬間に、一覧の先頭へ「送っている…」で並べる。通信の返事は待たない
  FLIGHT.letter = letter;
  msg.textContent = '金庫に置いている…';
  renderMail(ST || {});
  try {
    await push(`inbox/${letter.id}.json`,
               JSON.stringify(letter, null, 2) + '\n',
               `社内便：編集長 → ${YAKU[to] || to}`);
    savePending([letter].concat(loadPending()));
    clearDraft();
    msg.className = 'note ok';
    msg.textContent = `${YAKU[to] || to}あてに置いた。Threadsには何も出ていない。`
                    + '下の一覧で「送った（未読）」になっている。';
  } catch (e) {
    msg.className = 'note ng';
    msg.textContent = '送れていない。書いたものは消していない。';
    failInto(fail, e, sendLetter, 'もう一度送る');
  } finally {
    FLIGHT.letter = null;
    btn.disabled = false;
    renderMail(ST || {});
  }
}
$('#m-send').addEventListener('click', sendLetter);

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
    const [sr, gr, rr] = await Promise.allSettled([
      pull('state/state.json'), pull('state/factory.svg'), pull('state/recv.json')]);
    // 受け取りの印。無くても会社は映す（古いMacだとまだ押していない）
    if (rr.status === 'fulfilled') {
      const r = jparse(rr.value, null);
      RECV = (r && typeof r === 'object' && r.recv) ? r : { beat: '', recv: {} };
    }
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
    say(`鍵 ${keyFrag(c.token)}／全${c.token.length}文字`);
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
          + 'GitHubで直したのなら、直した鍵とこの端末の鍵（上の札）が別物だ。'
        : `→ 書きが ${wr.status} で落ちた。①〜③と併せて見る。`);
  } finally {
    btn.disabled = false;
  }
}
on('#s-test', 'click', selftest);

/* 枠を丸ごと取り直す。ホーム画面のアプリは古い枠を掴んだまま離さないことがあり、
   「新しくしたのに、その画面が無い」が起きる。

   ここは無言で死んでいた。押しても出るのは小さな灰色の1行だけで、
   iPhoneのPWAは caches / serviceWorker の後始末が返ってこないことがある。
   返ってこなければ開き直しに進まず、画面は押す前のまま＝「タップしても反応しない」。
   だから ①押した手応えを大きく出す ②3秒で見切って必ず開き直す
   ③開き直しが始まらなかったら、ボタンに頼らない道を赤字で出す。 */
on('#s-fresh', 'click', async () => {
  const btn = $('#s-fresh'), msg = $('#s-msg'), fail = $('#s-fail');
  const was = btn.textContent;
  clearFail(fail);
  btn.disabled = true;
  btn.textContent = '取り直している…';
  msg.className = 'note ok'; msg.textContent = '① 古い枠を捨てている…';
  const clear = (async () => {
    if ('caches' in window)
      await Promise.all((await caches.keys()).map((k) => caches.delete(k)));
    if ('serviceWorker' in navigator)
      await Promise.all((await navigator.serviceWorker.getRegistrations())
        .map((r) => r.unregister()));
  })().catch(() => {});
  // 後始末が返らなくても先へ進む。捨てきれていなくても、開き直せば取り直せる
  await Promise.race([clear, new Promise((r) => setTimeout(r, 3000))]);
  msg.textContent = '② 開き直している…';

  // 開き直しが始まらなかったときだけ、この札が残る（始まれば画面ごと消える）
  setTimeout(() => {
    btn.disabled = false;
    btn.textContent = was;
    msg.className = 'note ng';
    msg.textContent = '開き直しが始まらなかった。';
    if (!fail) return;
    fail.hidden = false;
    fail.className = 'failbox';
    fail.innerHTML = '<b class="fw">✕ この端末が古い枠を離さない</b>'
      + '<span class="fn">次の一手：①アプリを完全に終了する'
      + '（下から上へスワイプして止め、カードを上に飛ばす）→ 電波のある所で開き直す。<br>'
      + '②それでも版が変わらなければ、ホーム画面のアイコンを削除して、'
      + 'Safariで開き直して「ホーム画面に追加」。'
      + '<b>この場合この端末の鍵は消えるので、Macで ./kagi.sh を走らせてQRを読み直す。</b></span>';
  }, 4000);
  location.replace(location.pathname + '?v=' + Date.now());
});

/* ================= 知らせ（第4期） =================
   係の返事が金庫に入ったとき、Macから端末を突く。通知に会社の数字は載せない。
   iPhoneは「ホーム画面に追加したアプリから開いたとき」しか受け取れない（Safariのタブでは不可）。 */

const b64urlToU8 = (s) => {
  const p = (s + '='.repeat((4 - s.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(p), (c) => c.charCodeAt(0));
};
const pushOK = () => ('serviceWorker' in navigator) && ('PushManager' in window)
                  && ('Notification' in window);

/* 上書きできる置き方。既にあるファイルは sha を付けないと置き換えられない */
async function putFile(path, text, message) {
  const c = cfg();
  const cur = await api('GET', `/repos/${c.owner}/${c.repo}/contents/${path}`
                             + `?ref=${encodeURIComponent(c.branch)}`);
  const body = { message, content: b64utf8(text), branch: c.branch };
  if (cur.status === 200 && cur.data && cur.data.sha) body.sha = cur.data.sha;
  const r = await api('PUT', `/repos/${c.owner}/${c.repo}/contents/${path}`, body);
  if (r.status !== 200 && r.status !== 201) throw new Error(`${r.status} ${r.msg}`);
  return r.data;
}

function paintShirase() {
  const el = $('#s-shirase');
  if (!el) return;
  const on = !!localStorage.getItem(LS.push);
  const perm = ('Notification' in window) ? Notification.permission : 'なし';
  const home = window.matchMedia('(display-mode: standalone)').matches
            || window.navigator.standalone === true;
  el.innerHTML = [
    `知らせ：<b>${on ? '入っている' : '入っていない'}</b>（この端末の許可：${esc(perm)}）`,
    pushOK() ? '' : 'この開き方では受け取れない。ホーム画面に追加したアプリから開く。',
    home ? '' : '今はブラウザのタブとして開いている。iPhoneはこの状態だと知らせを受け取れない。',
  ].filter(Boolean).join('<br>');
  el.className = 'note keystate ' + (on ? 'ok' : 'ng');
  $('#s-push').textContent = on ? '知らせを止める' : 'この端末に知らせを入れる';
}

async function shirase() {
  const msg = $('#s-push-msg'), btn = $('#s-push');
  const id = localStorage.getItem(LS.push);
  msg.className = 'note';
  btn.disabled = true;
  try {
    if (!hasKey()) throw new NoKey('鍵がまだ入っていない');
    if (!pushOK()) throw new Error('この開き方では知らせを受け取れない。ホーム画面に追加したアプリから開く。');
    const reg = await navigator.serviceWorker.ready;

    if (id) {                                   // 止める
      const sub = await reg.pushManager.getSubscription();
      if (sub) await sub.unsubscribe();
      const c = cfg();
      const cur = await api('GET', `/repos/${c.owner}/${c.repo}/contents/push/${id}.json`
                                 + `?ref=${encodeURIComponent(c.branch)}`);
      if (cur.status === 200 && cur.data && cur.data.sha)
        await api('DELETE', `/repos/${c.owner}/${c.repo}/contents/push/${id}.json`,
                  { message: `知らせの宛先を外す：${id}`, branch: c.branch, sha: cur.data.sha });
      localStorage.removeItem(LS.push);
      msg.className = 'note ok';
      msg.textContent = '知らせを止めた。金庫からもこの端末の宛先を消した。';
      return;
    }

    const perm = await Notification.requestPermission();   // 入れる
    if (perm !== 'granted')
      throw new Error(`許可されなかった（${perm}）。iPhoneの設定→通知 から戻せる。`);
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: b64urlToU8(DEF.vapid || ''),
    });
    const nid = 'd' + Math.random().toString(36).slice(2, 10);
    await putFile(`push/${nid}.json`,
      JSON.stringify({ id: nid, sub: sub.toJSON(), ts: isoLocal(new Date()) }, null, 2) + '\n',
      `知らせの宛先：${nid}`);
    put(LS.push, nid);
    msg.className = 'note ok';
    msg.textContent = '知らせを入れた。係が返事を書いたら、この端末が鳴る。';
  } catch (e) {
    msg.className = 'note ng';
    msg.textContent = e instanceof NoKey
      ? '先に鍵を入れる。知らせの宛先も金庫に置くので、鍵が要る。'
      : `だめだった：${e.message}`;
  } finally {
    btn.disabled = false;
    paintShirase();
  }
}
on('#s-push', 'click', shirase);

$('#s-clear').addEventListener('click', () => {
  localStorage.removeItem(LS.token);
  $('#s-token').value = '';
  paintKeyBanner();   // 消したのに帯が出ないと、消えたのか分からない
  paintKeyState();
  $('#s-msg').className = 'note';
  $('#s-msg').textContent = '鍵を消した。この端末からは金庫を読めなくなった。';
});

/* QRから鍵を入れる。#k=github_pat_… で開かれたら、その場で保存してURLから消す。
   スマホで90文字を手で貼る工程が一番事故る（別の鍵が入っていても気づけない）。
   URLの # から後ろはGitHubのサーバーには一切送られない。履歴に残さないよう即座に消す。 */
function installKeyFromURL() {
  const m = (location.hash || '').match(/[#&]k=([^&]+)/);
  if (!m) return '';
  let t = '';
  try { t = decodeURIComponent(m[1]).trim(); } catch (_) { t = m[1].trim(); }
  history.replaceState(null, '', location.pathname + location.search);
  if (!/^github_pat_[A-Za-z0-9_]{40,}$/.test(t)) return 'ng:QRの中身が鍵の形をしていない';
  if (!put(LS.token, t)) return 'ng:この端末に鍵を保存できなかった（プライベートブラウズを切る）';
  return 'ok';
}
const INSTALLED = installKeyFromURL();

/* ================= 起動 ================= */

restoreDraft();
paintKeyBanner();
paintKeyState();
$$('[data-howto]').forEach((el) => { el.innerHTML = HOWTO; });   // 仕組みの説明
renderMail({});   // 金庫に置いたが未反映の手紙は、会社が読めなくても出す

/* 「3分前」は放っておくと3分前のまま固まる。待っている画面ほど、そこが効く。
   書きかけ・通信中は renderKessai 側が自分で降りる。 */
setInterval(() => {
  if (document.visibilityState !== 'visible') return;
  renderMail(ST || {});
  renderKessai(ST || {});
}, 30000);
$('#iso').innerHTML = '<div class="isoskel">社屋を取りに行っている…</div>';
refresh(false);

// QR経由で鍵が入ったときは、黙って通したことにしない。⚙を開いてその場で力試しまで走らせる
if (INSTALLED) {
  openSetup(false);
  const ok = INSTALLED === 'ok';
  $('#s-msg').className = 'note ' + (ok ? 'ok' : 'ng');
  $('#s-msg').textContent = ok ? 'QRから鍵を入れた。そのまま力試しをする。' : INSTALLED.slice(3);
  if (ok) selftest();
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') refresh(true);
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
