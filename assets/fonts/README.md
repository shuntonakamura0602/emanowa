# 共有画像用フォント

`NotoSansJP-Regular.otf` は Google Fonts の Noto Sans JP（SIL Open Font
License 1.1）です。共有画像を外部フォント配信へ依存させず、日本語を同じ字形で
描画するためにサーバーだけで読み込みます。ブラウザーへフォントファイルを公開する
用途には使用していません。画像rendererが未対応のCFF2可変fontを避けるため、静的
CFF版のRegularを固定しています。

- Source: `googlefonts/noto-cjk` commit
  `523d033d6cb47f4a80c58a35753646f5c3608a78`
- Path: `Sans/SubsetOTF/JP/NotoSansJP-Regular.otf`
- SHA-256:
  `dff723ba59d57d136764a04b9b2d03205544f7cd785a711442d6d2d085ac5073`
- License: `OFL.txt`
