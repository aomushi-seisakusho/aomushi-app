/* あおむし製作所 PWA
   非公開リポジトリ（金庫）から state.json / factory.svg / ledger.json を読んで表示する。
   第6期：窓口は決裁箱ひとつ（係あてに手紙を出す口＝社内便は廃止した）。
   置くのは金庫まで。Threadsへの送信も返信も、ここからは絶対にしない（憲法4条）。 */
'use strict';

const LS = {
  token: 'aomushi.token',
  owner: 'aomushi.owner',
  repo:  'aomushi.repo',
  state: 'aomushi.cache.state',
  kes:   'aomushi.kessai.pending', // 決裁票は置いたが、まだ原稿に印が付いていない分
  ansd:  'aomushi.shuzai.draft',   // 取材の答えの書きかけ（質問ごと）
  shu:   'aomushi.shuzai.pending', // 答えは置いたが、まだ在庫に入っていない分
  yok:   'aomushi.yoken.pending',  // 片づけた要件（まだMacが台帳に写していない分）
  umed:  'aomushi.ume.draft',      // 在庫の空欄の書きかけ（在庫×欄ごと）
  ume:   'aomushi.ume.pending',    // 空欄に置いたが、まだ在庫に入っていない分
  neta:  'aomushi.neta.pending',   // 放ったネタ（まだ在庫に積まれていない分）
  netad: 'aomushi.neta.draft',     // ネタの書きかけ
  push:  'aomushi.push.id',        // 知らせの宛先ID（金庫の push/<id>.json と対）
};

// この端末が今どの版を動かしているか。sw.js の V と必ず同じ数字にする。
// 「新しくしたのに出ない」を推測で潰さないための、唯一の手がかり
const APPV = 'v17';

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
               shippitsu:'執筆係', kenmon:'検問係', teisatsu:'偵察係',
               // 決裁と取材の写しを書くのは係ではなく配達係。ここに無いと生の英字が出ていた
               haitatsu:'配達係' };

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

/* 金庫に1ファイル置く。置けるのは inbox/ の札だけに絞ってある。 */
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

/* 仕組みの説明。決裁箱で押した札が、どこを通ってMacに届くか（憲法4条の担保でもある） */
const HOWTO = `
<div class="flow">
  <div class="fstep"><b>1</b><span class="stat sent">送った（未読）</span>
    <p>非公開の金庫に置いただけ。<b>まだ何も写されていない。</b>ここまでなら取り消せる。</p></div>
  <div class="fstep"><b>2</b><span class="stat recv">届いた</span>
    <p>Macが5分おきに金庫を見に来て、取り込んだ。原稿や在庫に写している最中。</p></div>
  <div class="fstep"><b>3</b><span class="stat read">係が読んだ</span>
    <p>写し終わって、結果が金庫に戻った。「係からの返事」に出る。</p></div>
</div>
<p class="hnote"><b>Macが動くまで、何も写らない。</b>
Macが閉じている・止まっている間、押した札は金庫でただ待つ。何時間でも待つ。<br>
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

const VIEWS = ['factory', 'kessai', 'ledger', 'setup'];
let ledgerLoaded = false;

function show(name) {
  VIEWS.forEach((v) => { $(`#view-${v}`).hidden = (v !== name); });
  $$('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
  $('#opensetup').classList.toggle('on', name === 'setup');
  window.scrollTo(0, 0);
  if (name === 'ledger' && !ledgerLoaded) loadLedger();
}

$$('.tabs button').forEach((b) => b.addEventListener('click', () => show(b.dataset.tab)));

/* 「今日やること」から、その札そのものへ飛ぶ。読ませたら、押せる場所まで連れて行く */
function goto(target) {
  show('kessai');
  const sel = { dama: '#dama-panel', drafts: '.k-draft', shuzai: '.k-shuzai',
                holes: '.k-hole', yoken: '.k-yoken' }[target] || '#box';
  setTimeout(() => {
    const el = document.querySelector(sel) || $('#box');
    if (el) { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); el.classList.add('flash'); }
  }, 60);
}
on('#today', 'click', (ev) => {
  const li = ev.target.closest('[data-go]');
  if (li) goto(li.dataset.go);
});
on('#today-mini', 'click', (ev) => {
  const li = ev.target.closest('[data-go]');
  if (li) goto(li.dataset.go);
});
$$('[data-go="kessai"]').forEach((b) => b.addEventListener('click', () => show('kessai')));

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
    // 未回答が0＝在庫が増える見込みも0。ここは在庫の隣に出す
    chip('取材', `未回答${nf(c.toi)}問`, (c.toi || 0) > 0),
    chip('取材地図 E-', c.chizu),
    chip('台帳', `${nf(c.ledger)}本`),
    chip('実測', `${nf(c.measured)}本`),
    // 決裁箱の未処理は、この画面でいちばん大事な数。宿題（機械が見ている条件）とは別に出す
    chip('決裁箱', `未処理${nf(st.machi || 0)}件`, (st.machi || 0) > 0),
    chip('宿題', `${(st.inbox_tasks || []).length}件`),
    chip('記録係', c.token ? '稼働' : 'トークン待ち', !c.token),
  ].join('');

  const h = $('#housou');
  if (st.housou) { h.hidden = false; h.querySelector('span').textContent = st.housou; }
  else h.hidden = true;

  const tasks = st.inbox_tasks || [];
  $('#inboxtasks').innerHTML = tasks.length
    ? tasks.map((t) => `<li>${esc(t)}</li>`).join('')
    : '<li class="empty">宿題は無い。</li>';

  renderToday(st);

  $('#roster').innerHTML = (st.roster || []).map((a) => `
    <li><b><i class="lampdot ${a.status === 'run' ? 'lg' : 'ly'}"></i>${esc(a.nm)}
      <em>${esc(a.status_label)}</em></b>
      <p>${esc(a.task)}</p></li>`).join('');

  $('#feed').innerHTML = (st.feed || []).length
    ? st.feed.map((f) => `<li><span>${esc(f.t)}</span>${esc(f.s)}</li>`).join('')
    : '<li class="empty">まだ動きが無い。</li>';

  renderMail(st);
  renderBox(st);

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

function renderMail(st) {
  const mail = st.mail || [];
  $('#mail').innerHTML = mail.length ? mail.map(inLine).join('')
    : '<li class="empty">まだ何も写していない。決裁箱の札を押せば、Macが写した結果がここに出る。</li>';
  const mn = $('#mailn');
  if (mn) mn.textContent = mail.length ? `　${mail.length}通` : '';
  paintBeat();
}

/* ================= 決裁箱（会社の唯一の窓口） =================
   係の要件・取材の質問・下書きの決裁・在庫の空欄。**全部この1つの箱に並ぶ。**
   押した瞬間に箱から消える。足取りは「さっき片づけた分」に残る（黙って消さない）。
   ここでもThreadsには何も出ない。出すのは編集長が自分で貼ったときだけ（憲法4条）。 */

const jparse = (s, fb) => { try { return JSON.parse(s) ?? fb; } catch (_) { return fb; } };
const jobj = (k) => { const v = jparse(localStorage.getItem(LS[k]), {});
  return (v && typeof v === 'object' && !Array.isArray(v)) ? v : {}; };
const jarr = (k) => { const v = jparse(localStorage.getItem(LS[k]), []);
  return Array.isArray(v) ? v : []; };

let ST = null;   // 最後に読めた会社の姿。送った直後に画面だけ描き直すのに使う

/* 金庫に置いたが、まだMacが写していない札。端末の中だけの覚え書き */
const loadKes  = () => jobj('kes');
const saveKes  = (o) => put(LS.kes, JSON.stringify(o));
const loadYok  = () => jobj('yok');
const saveYok  = (o) => put(LS.yok, JSON.stringify(o));
const loadUmeP = () => jobj('ume');
const saveUmeP = (o) => put(LS.ume, JSON.stringify(o));
const loadShu  = () => jarr('shu');
const saveShu  = (a) => put(LS.shu, JSON.stringify(a.slice(0, 30)));
const loadNeta = () => jarr('neta');
const saveNeta = (a) => put(LS.neta, JSON.stringify(a.slice(0, 20)));
/* 書きかけ。アプリが裏に回っても、通信に失敗しても消えない */
const loadAns  = () => jobj('ansd');
const saveAns  = (o) => put(LS.ansd, JSON.stringify(o));
const loadUmeD = () => jobj('umed');
const saveUmeD = (o) => put(LS.umed, JSON.stringify(o));

/* 押した瞬間に見た目を変えるための、通信中だけの覚え書き。
   金庫に届く前でも札が変わっていないと、押したのかどうか本人に分からない */
const FLIGHT = { kes: {}, shu: {}, yok: {}, ume: {}, neta: false };
const flying = () => Object.keys(FLIGHT.kes).length + Object.keys(FLIGHT.shu).length
                   + Object.keys(FLIGHT.yok).length + Object.keys(FLIGHT.ume).length;
/* 書いている最中・理由を書いている最中は、裏の自動更新で画面を組み直さない */
const HOLD = { typing: '', reason: '' };

const YAKU2 = { boss: '編集長', kiroku: '記録係', saikutsu: '採掘係', shippitsu: '執筆係',
                kenmon: '検問係', teisatsu: '偵察係', haitatsu: '配達係', zensha: '会社' };
const ST_CLS = { '校了': 'ok', '再校': 'ng', '初校': '' };

/* 札の名札は「種類::番号」。カードの data-k / data-d はこの形で持ち、押されたときに割る。
   ここを空文字で割ると1文字ずつに散る（実際にそれで『取り消す』が黙って効かなくなった）。 */
const SEP = '::';
const umeKey = (n, f) => `${n}${SEP}${f}`;
const cardEl = (k) => Array.from(document.querySelectorAll('[data-k]'))
  .find((e) => e.dataset.k === k) || null;
const inCard = (k, sel) => { const c = cardEl(k); return c && c.querySelector(sel); };
function say(k, cls, text) {
  const el = inCard(k, '.cmsg');
  if (el) { el.className = 'note cmsg ' + (cls || ''); el.textContent = text || ''; }
}
const failCard = (k, e, retry, label) => failInto(inCard(k, '.failbox'), e, retry, label);
const clearCard = (k) => clearFail(inCard(k, '.failbox'));

/* 置いた札が、いま金庫のどこに居るか。失敗している札は「片づいていない」＝箱に戻す */
function recTrace(rec) {
  if (!rec || !rec.id) return null;
  return trace(rec.id, rec.ts);
}
const settled = (rec) => { const t = recTrace(rec); return !!t && t.k !== 'ng'; };

/* ================= 今日やること（1〜3件） ================= */

function renderToday(st, items) {
  /* 「今日やること」は金庫が刷った時点の話。押して片づけた分をそのまま出すと、
     押したのに残っている＝読まなくなる。**箱から消えた仕事は、その場で消す。** */
  const have = (kind) => (items || []).some((x) => x.kind === kind);
  const dama = (st.drafts || []).some((d) => d.st === '校了' && !d.posted);
  const alive = (t) => ({ dama, drafts: have('draft'), shuzai: have('shuzai'),
                          holes: have('hole'), yoken: have('yoken') })[t.go] !== false;
  const src = (st.today || []).filter((t) => !items || alive(t));
  const html = src.length
    ? src.map((t, i) => `<li data-go="${esc(t.go || '')}"><b>${i + 1}</b>
        <span>${esc(t.t)}</span></li>`).join('')
    : (items && (st.today || []).length
        ? '<li class="empty">今日やることは片づけた。次の朝の点呼まで、箱は静かになる。</li>'
        : '<li class="empty">今日やることは無い。箱は空だ。</li>');
  ['#today', '#today-mini'].forEach((sel) => { const el = $(sel); if (el) el.innerHTML = html; });
  const g = st.gap || {};
  const gn = $('#gapnote');
  if (gn) gn.textContent = g.days == null ? ''
    : `前回の投稿は ${g.date}「${g.head}」（${nf(g.views)}views／${(g.rate || 0).toFixed(2)}%）。`
      + `あれから${g.days}日。`;
}

/* ================= 箱の中身を組む ================= */

function boxItems(st) {
  const out = [];
  const kes = loadKes(), yok = loadYok(), ume = loadUmeP();
  const shuL = {};
  loadShu().forEach((l) => { if (l.q) shuL[l.q] = l; });
  (st.shuzai_sent || []).forEach((l) => { if (l.q) shuL[l.q] = l; });

  // ---- 下書きの決裁（初校だけ。校了・再校は片づいた分）----
  (st.drafts || []).filter((d) => d.st === '初校').forEach((d) => {
    const f = FLIGHT.kes[d.n], p = kes[d.n];
    if (!f && settled(p)) return;                       // 押した分は箱から消える
    out.push({ kind: 'draft', k: `kes::${d.n}`, prio: 1, who: 'shippitsu',
               tag: '決裁', d, f, p });
  });

  // ---- 取材（未回答だけ）----
  (st.shuzai || []).filter((q) => q.st === '未回答').forEach((q) => {
    const f = FLIGHT.shu[q.id], l = shuL[q.id];
    if (!f && settled(l)) return;
    out.push({ kind: 'shuzai', k: `shu::${q.id}`, prio: 2, who: 'saikutsu',
               tag: '取材', q, f, l });
  });

  // ---- 係の要件 ----
  (st.yoken || []).forEach((y) => {
    const f = FLIGHT.yok[y.id], p = yok[y.id];
    if (!f && settled(p)) return;
    out.push({ kind: 'yoken', k: `yok::${y.id}`, prio: y.prio || 3,
               who: y.from, tag: y.tag || '要件', y, f, p });
  });

  // ---- 在庫の空欄（埋めれば弾になる）----
  (st.holes || []).forEach((h) => {
    const fields = (h.missing || []).filter((fl) => {
      const key = umeKey(h.n, fl);
      return FLIGHT.ume[key] || !settled(ume[key]);
    });
    if (!fields.length) return;
    // 空欄は「埋めれば弾になる」仕事。決める・答える・知る の後に置く
    out.push({ kind: 'hole', k: `hole::${h.n}`, prio: 4, who: 'shippitsu',
               tag: '在庫の空欄', h, fields });
  });

  // 読む順：決める(1) → 答える(2) → 知る(3) → 埋める(4) → 検討する(5)
  return out.sort((a, b) => (a.prio - b.prio) || a.k.localeCompare(b.k));
}

const chead = (it, right) => `<div class="ch"><span class="who">${esc(YAKU2[it.who] || it.who || '係')}</span>
  <span class="tg">${esc(it.tag)}</span>${right || ''}</div>`;

const traceRow = (t, line) => t
  ? `<div class="srow">${statChip(t)}<span class="sline">${esc(line)}</span></div>` : '';

/* ---- 要件（記録係・偵察係・会社…）---- */
function cardYoken(it) {
  const y = it.y;
  const t = it.f ? { k: 'sending', label: '送っている…' } : (it.p ? recTrace(it.p) : null);
  return chead(it, `<span class="pr">prio${esc(y.prio)}</span>`)
    + `<div class="ct">${esc(y.title)}</div>`
    + `<div class="cb">${mdlite(y.body)}</div>`
    + traceRow(t, t ? (t.k === 'ng' ? '片づけられなかった。理由は下の返事に出ている' : traceLine(t)) : '')
    + (HOLD.reason === it.k ? `
      <div class="rbox">
        <label class="fld"><span>却下する理由（そのまま係に渡る）</span>
          <textarea class="r-note" rows="3" placeholder="例：この熱には在庫を使わない"></textarea></label>
        <div class="btnrow">
          <button class="btn a-yok-send">この理由で却下する</button>
          <button class="btn ghost a-cancel">やめる</button>
        </div>
      </div>`
      : (t && t.k !== 'ng' ? '' : `
      <div class="btnrow">
        <button class="btn a-yok-ack">了解（片づける）</button>
        <button class="btn ghost a-yok-ng">却下する</button>
      </div>`));
}

/* ---- 取材の質問（答え1つ＝N-在庫1本）---- */
function cardShuzai(it) {
  const q = it.q;
  const t = it.f ? { k: 'sending', label: '送っている…' } : (it.l ? recTrace(it.l) : null);
  const stuck = !!(t && t.k === 'ng');
  const kaku = !t || stuck;
  const moto = loadAns()[q.id] || (stuck && it.l ? it.l.body : '') || '';
  const meta = [q.e && q.e !== '（指定なし）' ? `隣：${q.e}` : '',
                q.nerai && q.nerai !== '（無し）' ? `狙い：${q.nerai}` : ''].filter(Boolean);
  return chead(it, `<span class="pr">${esc(q.id)}</span>`)
    + `<div class="qt">${esc(q.q)}</div>`
    + (meta.length ? `<div class="qm">${esc(meta.join('　／　'))}</div>` : '')
    + traceRow(t && t.k === 'ng' ? { ...t, label: '在庫にできなかった' } : t,
        t ? (t.k === 'sending' ? '金庫に置いている…' : shuLine(t, q.n)) : '')
    + (kaku ? `
      <label class="fld"><span>答え（このまま在庫の本文になる。話し言葉でいい）</span>
        <textarea class="a-note" rows="4"
          placeholder="そのとき誰が何て言ったか、そのままの言葉で。">${esc(moto)}</textarea></label>
      <div class="btnrow">
        <button class="btn a-shu-send">${stuck ? 'もう一度、在庫にする' : 'この答えを在庫にする'}</button>
        <button class="btn ghost a-shu-clear">消す</button>
      </div>` : '')
    ;   // 「取り消す」は箱ではなく「さっき片づけた分」に出す（置けた札は箱から消えるから）
}

/* ---- 下書きの決裁 ---- */
function cardDraft(it) {
  const d = it.d;
  const st_ = (it.f && it.f.want) || (it.p && it.p.want) || d.st;
  const t = it.f ? { k: 'sending', label: '送っている…' } : (it.p ? recTrace(it.p) : null);
  return chead(it, `<span class="pr">${esc(d.n)}</span>`)
    + `<div class="ct">下書きの決裁：${esc(d.h || '')}</div>`
    + `<span class="badge ${ST_CLS[st_] || ''}">${esc(st_)}</span>`
    + `<div class="dt">${esc(d.body || d.h || '')}</div>`
    + (d.reason ? `<div class="drea">検問：${esc(d.reason)}</div>` : '')
    + traceRow(t, t ? (t.k === 'ng' ? '原稿に印を付けられなかった' : traceLine(t)) : '')
    + (HOLD.reason === it.k ? `
      <div class="rbox">
        <label class="fld"><span>差し戻す理由（そのまま執筆係に渡る）</span>
          <textarea class="r-note" rows="3"
            placeholder="例：E-由来＝焼き直し。N-在庫から書き直し"></textarea></label>
        <div class="btnrow">
          <button class="btn a-kes-send">この理由で差し戻す</button>
          <button class="btn ghost a-cancel">やめる</button>
        </div>
      </div>`
      : (t ? `<div class="btnrow">
          <button class="btn ghost a-cp">本文をコピー</button></div>`
        : `<div class="btnrow">
          <button class="btn a-kes-ok">校了にする</button>
          <button class="btn ghost a-kes-ng">差し戻す</button>
          <button class="btn ghost a-cp">本文をコピー</button>
        </div>`));
}

/* ---- 在庫の空欄（ここを埋めた瞬間に弾になる）---- */
function cardHole(it) {
  const h = it.h, dr = loadUmeD(), pend = loadUmeP();
  const rows = it.fields.map((f) => {
    const key = umeKey(h.n, f);
    const fl = FLIGHT.ume[key], p = pend[key];
    const t = fl ? { k: 'sending', label: '送っている…' } : (p ? recTrace(p) : null);
    const stuck = !!(t && t.k === 'ng');
    const val = dr[key] || (stuck && p ? p.body : '') || '';
    return `<div class="ufld" data-f="${esc(f)}">
      <label class="fld"><span>${esc(f)}</span>
        <textarea class="u-note" rows="2"
          placeholder="そのときの言葉のまま。思い出せないなら空のままでいい。">${esc(val)}</textarea></label>
      ${traceRow(t && t.k === 'ng' ? { ...t, label: '入れられなかった' } : t,
          t ? (t.k === 'sending' ? '金庫に置いている…'
             : t.k === 'read' ? `${hhmm(t.ts)} に在庫へ入った（${ago(t.ts)}）` : traceLine(t)) : '')}
      ${(!t || stuck) ? `<div class="btnrow">
        <button class="btn a-ume-send">${stuck ? 'もう一度、入れる' : 'この言葉で埋める'}</button>
      </div>` : ''}
    </div>`;
  }).join('');
  return chead(it, `<span class="pr">${esc(h.n)}</span>`)
    + `<div class="ct">在庫の空欄：${esc(it.fields.join('／'))}</div>`
    + `<div class="cb clamp"><p>${esc(h.deki || '')}</p></div>`
    + (h.toi ? `<div class="qm clamp">${esc(h.toi)}</div>` : '')
    + `<p class="note">埋めた言葉は<b>一字も直さず</b>在庫に写る。想像で埋めない（憲法3条）。</p>`
    + rows;
}

const CARD = { yoken: cardYoken, shuzai: cardShuzai, draft: cardDraft, hole: cardHole };


/* Macが写し終えた札は、端末の覚え書きから落とす。
   落とさないと「さっき片づけた分」が永久に残り、箱の判定も古い札を見続ける。
   **金庫が読めていないとき（stが空）は何も落とさない。** 消し過ぎる方が害が大きい。 */
function sweep(st) {
  if (!st || !st.generated_at) return;
  if (st.drafts) {
    const p = loadKes(), by = {};
    st.drafts.forEach((d) => { by[d.n] = d.st; });
    const del = Object.keys(p).filter((n) => by[n] === undefined || by[n] === p[n].want);
    if (del.length) { del.forEach((n) => delete p[n]); saveKes(p); }
  }
  if (st.shuzai) {
    const by = {};
    st.shuzai.forEach((q) => { by[q.id] = q.st; });
    const cur = loadShu(), keep = cur.filter((l) => by[l.q] === '未回答');
    if (keep.length !== cur.length) saveShu(keep);
  }
  if (st.yoken) {
    const ids = new Set(st.yoken.map((y) => y.id));
    const p = loadYok();
    const del = Object.keys(p).filter((y) => !ids.has(y));
    if (del.length) { del.forEach((y) => delete p[y]); saveYok(p); }
  }
  if (st.holes) {
    const keys = new Set();
    st.holes.forEach((h) => (h.missing || []).forEach((f) => keys.add(umeKey(h.n, f))));
    const p = loadUmeP();
    const del = Object.keys(p).filter((k) => !keys.has(k));
    if (del.length) { del.forEach((k) => delete p[k]); saveUmeP(p); }
  }
  // ネタは金庫側に「済んだ」印が無い。返事が戻って1時間たったら畳む
  const cur = loadNeta();
  const keep = cur.filter((l) => {
    const t = recTrace(l);
    return !t || t.k !== 'read' || minsSince(l.ts) < 60;
  });
  if (keep.length !== cur.length) saveNeta(keep);
}

function renderBox(st, force) {
  if (!force && (HOLD.typing || HOLD.reason || flying())) return;
  sweep(st);
  const items = boxItems(st);
  $('#box').innerHTML = items.length ? items.map((it) => {
    const t = it.f ? { k: 'sending' } : null;
    return `<li class="card k-${it.kind}${t ? ' s-sending' : ''}" data-k="${esc(it.k)}">
      ${CARD[it.kind](it)}
      <div class="failbox" hidden></div>
      <p class="note cmsg"></p>
    </li>`;
  }).join('')
    : (st.today
        ? '<li class="empty">箱は空だ。次の朝の点呼で、係が要件を積む。</li>'
        : (st.generated_at
            ? `<li class="empty">金庫の材料に決裁箱の欄がまだ無い（Mac側が古い）。<br>
               Macで <code>python3 state.py</code> を走らせれば、次の配達でここに出る。</li>`
            : '<li class="empty">読みに行っている…</li>'));

  $('#boxn').textContent = items.length ? `　未処理 ${items.length}件` : '';
  renderToday(st, items);       // 箱の中身に合わせて「今日やること」を間引く
  if (HOLD.reason) {
    const ta = inCard(HOLD.reason, '.r-note');
    if (ta) ta.focus();
  }
  renderDama(st);
  renderDone(st);
  BOX_WAIT = items.length;
  paintKesDot();
  paintBeat();
}

/* タブの赤い数字。押されていない札の数をそのまま出す。
   質問に答えないと在庫が増えない＝会社が止まるので、原稿と同じ重さで数える。 */
let BOX_WAIT = 0;
function paintKesDot() {
  const el = $('#kesdot');
  if (!el) return;
  el.hidden = BOX_WAIT === 0;
  el.textContent = BOX_WAIT > 99 ? '99+' : String(BOX_WAIT);
}

/* ================= 出せる弾（校了済み・まだ台帳に無い） ================= */

function renderDama(st) {
  const ds = (st.drafts || []).filter((d) => d.st === '校了' && !d.posted);
  $('#dama-panel').hidden = ds.length === 0;
  $('#dama').innerHTML = ds.map((d) => `
    <li data-k="dama::${esc(d.n)}">
      <div class="dh"><b>${esc(d.n)}</b><span class="badge ok">校了</span></div>
      <div class="dt">${esc(d.body || d.h || '')}</div>
      <div class="btnrow"><button class="btn a-cp">本文をコピー</button></div>
      <p class="note cmsg"></p>
    </li>`).join('');
}

/* ================= さっき片づけた分（黙って消さないための足取り） ================= */

function doneItems(st) {
  const out = [];
  const push = (o) => { if (o.rec && o.rec.id) out.push(o); };
  const kes = loadKes(), yok = loadYok(), ume = loadUmeP();
  Object.keys(kes).forEach((n) =>
    push({ kind: 'draft', key: n, label: `下書き『${n}』を${kes[n].want}にした`, rec: kes[n] }));
  Object.keys(yok).forEach((y) =>
    push({ kind: 'yoken', key: y, label: `要件 ${y} を${yok[y].action === 'ack' ? '了解' : '却下'}にした`,
           rec: yok[y] }));
  Object.keys(ume).forEach((k) => {
    const [n, f] = k.split(SEP);
    push({ kind: 'ume', key: k, label: `${n} の「${f}」を埋めた`, rec: ume[k] });
  });
  loadShu().forEach((l) =>
    push({ kind: 'shuzai', key: l.q, label: `取材 ${l.q} に答えた`, rec: l }));
  loadNeta().forEach((l) =>
    push({ kind: 'neta', key: l.id, label: `ネタを放った：${(l.body || '').slice(0, 24)}`, rec: l }));
  return out.sort((a, b) => String(b.rec.ts || '').localeCompare(String(a.rec.ts || '')))
            .slice(0, 12);
}

function renderDone(st) {
  const items = doneItems(st);
  $('#done-panel').hidden = items.length === 0;
  $('#donen').textContent = items.length ? `　${items.length}件` : '';
  $('#done').innerHTML = items.map((o) => {
    const t = recTrace(o.rec) || { k: 'sent', label: '送った（未読）', ts: o.rec.ts };
    const rep = t.rep;
    return `<li class="card done s-${t.k}" data-d="${esc(o.kind)}::${esc(o.key)}">
      <div class="ch"><span class="who">編集長</span><span class="tg">${esc(o.label)}</span></div>
      ${traceRow(t, traceLine(t))}
      ${rep ? `<div class="cb">${mdlite(rep.body)}</div>` : ''}
      ${t.k === 'sent' ? `<div class="btnrow">
        <button class="btn ghost a-undo">取り消す（まだ間に合う）</button></div>` : ''}
      ${t.k === 'ng' ? `<div class="btnrow">
        <button class="btn ghost a-redo">箱に戻してやり直す</button></div>` : ''}
      <div class="failbox" hidden></div>
      <p class="note cmsg"></p>
    </li>`;
  }).join('');
}

/* 片づけた札を元に戻す。
   取り消す＝まだMacが取りに来ていない札を、金庫から消して無かったことにする。
   やり直す＝写せなかった札を箱に戻す（書いた言葉は欄に戻す。消さない）。
   **箱から消えた札の取り消しは、ここにしか無い。** 箱のカードにはもう出ない。 */
function unfile(kind, key) {
  if (kind === 'draft') { const o = loadKes(); delete o[key]; saveKes(o); }
  if (kind === 'yoken') { const o = loadYok(); delete o[key]; saveYok(o); }
  if (kind === 'ume') {
    const o = loadUmeP(), rec = o[key];
    if (rec) { const d = loadUmeD(); d[key] = rec.body || ''; saveUmeD(d); }
    delete o[key]; saveUmeP(o);
  }
  if (kind === 'shuzai') {
    const l = loadShu().find((x) => x.q === key);
    if (l) { const d = loadAns(); d[key] = l.body || ''; saveAns(d); }
    saveShu(loadShu().filter((x) => x.q !== key));
  }
  if (kind === 'neta') saveNeta(loadNeta().filter((x) => x.id !== key));
}

function doneRec(kind, key) {
  if (kind === 'draft') return loadKes()[key];
  if (kind === 'yoken') return loadYok()[key];
  if (kind === 'ume') return loadUmeP()[key];
  if (kind === 'shuzai') return loadShu().find((x) => x.q === key);
  if (kind === 'neta') return loadNeta().find((x) => x.id === key);
  return null;
}

on('#done', 'click', async (ev) => {
  const b = ev.target.closest('button');
  const li = ev.target.closest('[data-d]');
  if (!b || !li) return;
  const [kind, key] = li.dataset.d.split(SEP);
  const msg = li.querySelector('.cmsg'), fail = li.querySelector('.failbox');
  clearFail(fail);
  if (b.classList.contains('a-redo')) { unfile(kind, key); return renderBox(ST || {}, true); }
  if (!b.classList.contains('a-undo')) return;
  const rec = doneRec(kind, key);
  if (!rec || !rec.id) {
    if (msg) { msg.className = 'note cmsg ng'; msg.textContent = 'どの札か分からないので取り消せない。'; }
    return;
  }
  if (msg) { msg.className = 'note cmsg'; msg.textContent = '取り消している…'; }
  try {
    await deleteLetter(rec.id, '編集長が取り消した');
    unfile(kind, key);
    renderBox(ST || {}, true);
  } catch (e) {
    failInto(fail, e, () => b.click(), 'もう一度取り消す');
    if (msg) { msg.className = 'note cmsg ng'; msg.textContent = '取り消せていない。札は金庫に残ったまま。'; }
  }
});

/* ================= 金庫へ置く（決裁票・答え・要件・空欄・ネタ） ================= */

/* 置いた札そのものを消す。Macがまだ取りに来ていなければ、無かったことになる。
   404＝すでに金庫に無い＝取り消しとしては成功。 */
async function deleteLetter(id, message) {
  const c = cfg();
  const path = `/repos/${c.owner}/${c.repo}/contents/inbox/${id}.json`;
  const cur = await api('GET', `${path}?ref=${encodeURIComponent(c.branch)}`);
  if (cur.status === 200 && cur.data && cur.data.sha) {
    const del = await api('DELETE', path, { message, branch: c.branch, sha: cur.data.sha });
    if (del.status !== 200) throw new ApiErr(del.status, del.msg || '札を消せなかった');
    return;
  }
  if (cur.status !== 404) throw new ApiErr(cur.status, cur.msg || '札を探しに行けなかった');
}

/* ---- 下書きの決裁 ---- */
async function decide(n, want, note) {
  const k = `kes::${n}`;
  const d = new Date();
  const slip = { id: `${stamp(d)}-kessai-${n}`, kind: 'kessai',
                 draft: n, action: want === '校了' ? 'pass' : 'reject',
                 note: note || '', from: 'boss', ts: isoLocal(d) };
  clearCard(k);
  HOLD.reason = '';
  FLIGHT.kes[n] = { want };            // 押した瞬間に札を変える。通信を待たない
  renderBox(ST || {}, true);
  try {
    await push(`inbox/${slip.id}.json`, JSON.stringify(slip, null, 2) + '\n',
               `決裁：${n} を${want}`);
    const pend = loadKes();
    pend[n] = { want, ts: slip.ts, id: slip.id, note: note || '' };
    saveKes(pend);
    delete FLIGHT.kes[n];
    renderBox(ST || {}, true);
  } catch (e) {
    delete FLIGHT.kes[n];              // 見た目を押す前に戻す。送れていないのに校了に見せない
    renderBox(ST || {}, true);
    failCard(k, e, () => decide(n, want, note), `もう一度「${want}」を送る`);
    say(k, 'ng', `${want}の記録は金庫に残っていない。原稿はそのまま。`);
  }
}


/* ---- 取材の答え。ここが N-在庫の唯一の増え口 ---- */
function shuLine(t, n) {
  if (t.k === 'read') return n ? `${hhmm(t.ts)} に ${n} として在庫に入った（${ago(t.ts)}）`
                               : `${hhmm(t.ts)} にMacが在庫に写した（${ago(t.ts)}）`;
  if (t.k === 'recv') return `${hhmm(t.ts)} にMacが取り込んだ（${ago(t.ts)}）。在庫に写している最中`;
  if (t.k === 'ng')   return `${hhmm(t.ts)} に在庫にできなかった。理由は下の「係からの返事」に出ている`;
  const base = `${hhmm(t.ts)} に置いた（${ago(t.ts)}）`;
  return t.late
    ? `${base}。${Math.floor(minsSince(t.ts))}分たっても取りに来ていない。Macが止まっているかもしれない`
    : `${base}。次にMacが動いたときにN-在庫に入る`;
}

async function sendAnswer(qid) {
  const k = `shu::${qid}`;
  const ta = inCard(k, '.a-note');
  const body = (ta && ta.value.trim()) || '';
  clearCard(k);
  if (!body) { say(k, 'ng', '答えが空。'); return; }
  const d = new Date();
  const letter = { id: `${stamp(d)}-shuzai-${qid}`, kind: 'shuzai', q: qid,
                   from: 'boss', to: 'saikutsu', subject: `取材の答え：${qid}`,
                   body, ts: isoLocal(d) };
  HOLD.typing = '';
  FLIGHT.shu[qid] = letter;
  renderBox(ST || {}, true);
  try {
    await push(`inbox/${letter.id}.json`, JSON.stringify(letter, null, 2) + '\n',
               `取材の答え：${qid}`);
    saveShu([letter].concat(loadShu().filter((l) => l.q !== qid)));
    const dr = loadAns(); delete dr[qid]; saveAns(dr);   // 置けた分だけ書きかけを消す
    delete FLIGHT.shu[qid];
    renderBox(ST || {}, true);
  } catch (e) {
    delete FLIGHT.shu[qid];
    renderBox(ST || {}, true);   // 書きかけは控えから戻る。消さない
    failCard(k, e, () => sendAnswer(qid), 'もう一度置く');
    say(k, 'ng', '置けていない。答えは消していない。在庫も増えていない。');
  }
}


/* ---- 係の要件を片づける ---- */
async function closeYoken(yid, action, note) {
  const k = `yok::${yid}`;
  const d = new Date();
  const slip = { id: `${stamp(d)}-yoken-${yid}`, kind: 'yoken', y: yid,
                 action, note: note || '', from: 'boss', ts: isoLocal(d) };
  clearCard(k);
  HOLD.reason = '';
  FLIGHT.yok[yid] = { action };
  renderBox(ST || {}, true);
  try {
    await push(`inbox/${slip.id}.json`, JSON.stringify(slip, null, 2) + '\n',
               `要件：${yid} を${action === 'ack' ? '了解' : '却下'}`);
    const pend = loadYok();
    pend[yid] = { action, ts: slip.ts, id: slip.id, note: note || '' };
    saveYok(pend);
    delete FLIGHT.yok[yid];
    renderBox(ST || {}, true);
  } catch (e) {
    delete FLIGHT.yok[yid];
    renderBox(ST || {}, true);
    failCard(k, e, () => closeYoken(yid, action, note), 'もう一度送る');
    say(k, 'ng', '片づいていない。要件は箱に残ったまま。');
  }
}

/* ---- 在庫の空欄を埋める ---- */
async function sendUme(n, field) {
  const k = `hole::${n}`;
  const key = umeKey(n, field);
  const c = cardEl(k);
  const wrap = c && Array.from(c.querySelectorAll('[data-f]')).find((e) => e.dataset.f === field);
  const ta = wrap && wrap.querySelector('.u-note');
  const body = (ta && ta.value.trim()) || '';
  clearCard(k);
  if (!body) { say(k, 'ng', `「${field}」が空。埋めるものが無い。`); return; }
  const d = new Date();
  const letter = { id: `${stamp(d)}-ume-${n}-${Date.now().toString(36)}`, kind: 'ume',
                   n, field, from: 'boss', to: 'saikutsu',
                   subject: `在庫の空欄：${n} の${field}`, body, ts: isoLocal(d) };
  HOLD.typing = '';
  FLIGHT.ume[key] = letter;
  renderBox(ST || {}, true);
  try {
    await push(`inbox/${letter.id}.json`, JSON.stringify(letter, null, 2) + '\n',
               `在庫の空欄：${n} の${field}`);
    const pend = loadUmeP();
    pend[key] = { id: letter.id, ts: letter.ts, body };
    saveUmeP(pend);
    const dr = loadUmeD(); delete dr[key]; saveUmeD(dr);
    delete FLIGHT.ume[key];
    renderBox(ST || {}, true);
  } catch (e) {
    delete FLIGHT.ume[key];
    renderBox(ST || {}, true);
    failCard(k, e, () => sendUme(n, field), 'もう一度置く');
    say(k, 'ng', '置けていない。書いた言葉は消していない。在庫も変わっていない。');
  }
}

/* ---- ネタを放る（1行＝N-在庫1本） ---- */
async function sendNeta() {
  const btn = $('#n-send'), msg = $('#n-msg'), fail = $('#n-fail');
  const body = $('#n-body').value.trim();
  const moto = $('#n-moto').value;
  msg.className = 'note';
  clearFail(fail);
  if (!body) { msg.className = 'note ng'; msg.textContent = '空のまま放れない。'; return; }
  const d = new Date();
  const letter = { id: `${stamp(d)}-neta`, kind: 'neta', moto,
                   from: 'boss', to: 'saikutsu', subject: 'ネタ', body, ts: isoLocal(d) };
  btn.disabled = true;
  FLIGHT.neta = true;
  msg.textContent = '金庫に置いている…';
  try {
    await push(`inbox/${letter.id}.json`, JSON.stringify(letter, null, 2) + '\n', 'ネタを放る');
    saveNeta([letter].concat(loadNeta()));
    localStorage.removeItem(LS.netad);
    $('#n-body').value = '';
    msg.className = 'note ok';
    msg.textContent = '放った。次にMacが動いたときにN-在庫が1本増える。Threadsには何も出ていない。';
  } catch (e) {
    msg.className = 'note ng';
    msg.textContent = '放れていない。書いたものは消していない。';
    failInto(fail, e, sendNeta, 'もう一度放る');
  } finally {
    FLIGHT.neta = false;
    btn.disabled = false;
    renderBox(ST || {}, true);
  }
}
on('#n-send', 'click', sendNeta);
on('#n-discard', 'click', () => {
  $('#n-body').value = '';
  localStorage.removeItem(LS.netad);
  $('#n-msg').className = 'note';
  $('#n-msg').textContent = '書きかけを消した。';
});
on('#n-body', 'input', () => put(LS.netad, $('#n-body').value));

/* 放りかけのネタは端末に残す。アプリが裏に回っても、通信に失敗しても消えない */
function restoreNeta() {
  const n = localStorage.getItem(LS.netad);
  if (n) $('#n-body').value = n;
}

/* ================= 箱のボタン（1か所で受ける） ================= */

async function copyBody(k, text) {
  try {
    await navigator.clipboard.writeText(text || '');
    say(k, 'ok', '本文をコピーした。Threadsに貼るのは編集長の手で。');
  } catch (_) {
    say(k, 'ng', 'この端末ではコピーできなかった。長押しで選んでくれ。');
  }
}

function onBoxClick(ev) {
  const b = ev.target.closest('button');
  if (!b) return;
  const li = ev.target.closest('[data-k]');
  if (!li) return;
  const k = li.dataset.k;
  const [kind, id] = k.split(SEP);
  const cls = b.classList;

  if (cls.contains('a-cp')) {
    const d = (ST && ST.drafts || []).find((x) => x.n === id);
    return copyBody(k, d && d.body);
  }
  if (cls.contains('a-cancel')) { HOLD.reason = ''; return renderBox(ST || {}, true); }

  if (kind === 'kes') {
    if (cls.contains('a-kes-ok'))   return decide(id, '校了', '');
    // prompt() は、ホーム画面から開いたアプリだと出ない端末がある。画面の中で書かせる
    if (cls.contains('a-kes-ng'))   { HOLD.reason = k; return renderBox(ST || {}, true); }
    if (cls.contains('a-kes-send')) {
      const ta = inCard(k, '.r-note');
      return decide(id, '再校', (ta && ta.value.trim()) || '');
    }
  }
  if (kind === 'shu') {
    if (cls.contains('a-shu-send')) return sendAnswer(id);
    if (cls.contains('a-shu-clear')) {
      const dr = loadAns(); delete dr[id]; saveAns(dr);
      HOLD.typing = '';
      renderBox(ST || {}, true);
      return say(k, '', '書きかけを消した。');
    }
  }
  if (kind === 'yok') {
    if (cls.contains('a-yok-ack')) return closeYoken(id, 'ack', '');
    if (cls.contains('a-yok-ng'))  { HOLD.reason = k; return renderBox(ST || {}, true); }
    if (cls.contains('a-yok-send')) {
      const ta = inCard(k, '.r-note');
      return closeYoken(id, 'reject', (ta && ta.value.trim()) || '');
    }
  }
  if (kind === 'hole' && cls.contains('a-ume-send')) {
    const w = b.closest('[data-f]');
    if (w) return sendUme(id, w.dataset.f);
  }
}
on('#box', 'click', onBoxClick);
on('#dama', 'click', onBoxClick);

/* 書きかけは1文字ごとに端末に残す。打っている間は裏の自動更新で画面を組み直さない */
on('#box', 'input', (ev) => {
  const li = ev.target.closest('[data-k]');
  if (!li) return;
  const k = li.dataset.k;
  const [kind, id] = k.split(SEP);
  if (ev.target.classList.contains('a-note')) {
    const dr = loadAns(); dr[id] = ev.target.value; saveAns(dr);
    HOLD.typing = ev.target.value.trim() ? k : '';
  }
  if (ev.target.classList.contains('u-note')) {
    const w = ev.target.closest('[data-f]');
    if (!w) return;
    const dr = loadUmeD(); dr[umeKey(id, w.dataset.f)] = ev.target.value; saveUmeD(dr);
    HOLD.typing = ev.target.value.trim() ? k : '';
  }
  if (ev.target.classList.contains('r-note')) HOLD.reason = k;
});
on('#box', 'focusout', (ev) => {
  if (ev.target.classList && ev.target.classList.contains('a-note')) HOLD.typing = '';
  if (ev.target.classList && ev.target.classList.contains('u-note')) HOLD.typing = '';
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
      return fin('ok', '', '→ この鍵は書ける。決裁箱の札は金庫に置ける。');
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

restoreNeta();
paintKeyBanner();
paintKeyState();
$$('[data-howto]').forEach((el) => { el.innerHTML = HOWTO; });   // 仕組みの説明
renderMail({});   // 返事の枠は、会社が読めていなくても先に出す
renderBox({});    // 要件も質問も金庫から来る。読めるまでは空欄のまま枠だけ出す

/* 「3分前」は放っておくと3分前のまま固まる。待っている画面ほど、そこが効く。
   書きかけ・通信中は renderBox 側が自分で降りる。 */
setInterval(() => {
  if (document.visibilityState !== 'visible') return;
  renderMail(ST || {});
  renderBox(ST || {});
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
