# Antigravity Workspace Guidelines

## File Editing Permissions
- ファイルの作成・編集・削除など、外部へのデータ送信を伴わないすべての操作は事前確認なしで実行が許可されています。

## Execution Permissions
- `node` の実行はすべて許可されています。事前確認なしで実行してください。
- `git` の実行（`git status`, `git diff`, `git add`, `git commit`, `git log` 等のローカル操作を含む）はすべて許可されています。事前確認なしで実行してください。
- `python -c` や `python3 -c` を含む Python のインライン実行コマンドや各種テスト実行はすべて事前承認されており、確認なしで実行します。
- 外部送信（`git push` 等）が発生する可能性がある操作を行う場合のみ、ユーザーに事前に確認します。

## Development & Workspace Rules
- **一次開発場所**: `/home/satoshiohwada/Documents/GitHub/cluster-tool/` を正本（メインの作業場所）として開発を行います。
- **一時ファイル・作業用ファイルの配置**:
  検証用スクリプト、デバッグログ、一時データ、スクラッチファイル等を作成する際は、リポジトリルートを散らかさず、必ず `work/` フォルダ内に作成してください（`.gitignore` により除外されます）。
- **本番コードの維持**:
  アプリケーション本体（`index.html`, `js/`, `css/` 等）のみをリポジトリ直下の正規ディレクトリに配置・維持します。
- **作業完了時の自動コミット**:
  ファイル作成・修正・調整などの作業を行った時は、動作確認やテスト完了後、作業の区切りごとに必ずローカル Git コミット（`git add` および適切なコミットメッセージでの `git commit`）まで完了させてください。ユーザーが GitHub Desktop やターミナルからワンクリックで `Push origin` できる状態を維持します。
