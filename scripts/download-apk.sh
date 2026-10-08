#!/bin/sh
# 从 GitHub Actions 下载打包好的 APK（带断点续传，网络断了继续下）
#
# 用法：
#   sh scripts/download-apk.sh              # 自动取最近一次打包成功的产物
#   sh scripts/download-apk.sh 37800065208  # 指定某一次运行的编号
#
# 产物会解到 dist/ 目录；中途断了再跑一次同一个命令就会接着下。

set -u

REPO="laoxiong19830816/zuot-app"
CREDFILE="${HOME}/.ohos_git/.git-credentials"
OUTDIR="$(cd "$(dirname "$0")/.." && pwd)/dist"
TMP="$(cd "$(dirname "$0")/.." && pwd)/.workbuddy/tmp"

# 从 git 凭据里取令牌（不打印出来）
TOKEN=$(sed -n 's#^https\?://[^/:]*:\([^@]*\)@github.com.*#\1#p' "$CREDFILE" | head -1)
if [ -z "$TOKEN" ]; then
  echo "没取到 GitHub 令牌，检查 $CREDFILE"
  exit 1
fi

mkdir -p "$OUTDIR" "$TMP"

# 没给运行编号就自己找最近一次成功的打包
RUN_ID="${1:-}"
if [ -z "$RUN_ID" ]; then
  RUN_ID=$(curl -s -H "Authorization: Bearer $TOKEN" \
    "https://api.github.com/repos/$REPO/actions/workflows/build-apk.yml/runs?per_page=10" \
    | python3 -c "
import json,sys
d=json.load(sys.stdin)
for r in d.get('workflow_runs',[]):
    if r.get('conclusion')=='success':
        print(r['id']); break
")
fi
echo "运行编号：$RUN_ID"

curl -s -H "Authorization: Bearer $TOKEN" -H "Accept: application/vnd.github+json" \
  "https://api.github.com/repos/$REPO/actions/runs/$RUN_ID/artifacts" > "$TMP/artifacts.json"

ART_ID=$(python3 -c "
import json
d=json.load(open('$TMP/artifacts.json'))
arts=d.get('artifacts',[])
if not arts:
    print(''); raise SystemExit
print(arts[0]['id'])
")
if [ -z "$ART_ID" ]; then
  echo "这次运行没有产物（可能打包失败了）"
  exit 1
fi

ZIP="$TMP/zuot-app-apk.zip"
echo "开始下载（断了就再跑一次本命令，会自动接着下）…"
i=1
while [ "$i" -le 40 ]; do
  curl -sL -C - -H "Authorization: Bearer $TOKEN" -o "$ZIP" \
    "https://api.github.com/repos/$REPO/actions/artifacts/$ART_ID/zip"
  # 拿到完整文件（HTTP 200）才算成功；206 表示续传中，继续
  CODE=$(curl -s -o /dev/null -w "%{http_code}" -r 0-0 -H "Authorization: Bearer $TOKEN" -L \
    "https://api.github.com/repos/$REPO/actions/artifacts/$ART_ID/zip")
  SIZE=$(wc -c < "$ZIP" 2>/dev/null | tr -d ' ')
  echo "  第 $i 轮：已下载 $SIZE 字节（HTTP $CODE）"
  if [ "$SIZE" -gt 1000000 ] && python3 -c "
import zipfile,sys
sys.exit(0 if zipfile.is_zipfile('$ZIP') else 1)
"; then
    echo "下载完成并校验通过"
    break
  fi
  i=$((i + 1))
done

python3 - "$ZIP" "$OUTDIR" <<'PY'
import zipfile, sys, os, shutil
zip_path, out = sys.argv[1], sys.argv[2]
z = zipfile.ZipFile(zip_path)
os.makedirs(out, exist_ok=True)
for n in z.namelist():
    if n.endswith('.apk'):
        target = os.path.join(out, 'app-release.apk' if 'release' in n else os.path.basename(n))
        with z.open(n) as src, open(target, 'wb') as dst:
            shutil.copyfileobj(src, dst)
        print('已导出：%s  (%.1f MB)' % (target, os.path.getsize(target) / 1024 / 1024))
PY

ls -la "$OUTDIR"
