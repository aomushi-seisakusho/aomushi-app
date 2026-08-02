/* つなぎ先。GitHubのユーザー名を入れて置き換える（アプリの⚙からも上書きできる） */
window.AOMUSHI_CONFIG = {
  owner: "aomushi-seisakusho",
  repo: "aomushi-data",
  branch: "main",
  // 知らせ（第4期）の公開鍵。対になる秘密鍵は Mac の secrets/vapid.json にだけある。
  // これは公開して構わない鍵（これだけでは誰にも通知を送れない）
  vapid: "BNUP_nuVOIppbKXDUg9ysy0YtzJZQhDBm-krDrhFhsKY-AWg8bJgwwfBvjPoJlNqYHwfLgJ60bBGodnvfuox1gI",
};
