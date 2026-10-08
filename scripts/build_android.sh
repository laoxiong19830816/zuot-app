#!/bin/bash
# Android APK 打包脚本
# 适用：Windows（Git Bash）/ macOS / Linux。鸿蒙 PC 无法执行（无 Android SDK）。
set -e

cd "$(dirname "$0")/../client"

echo "===== 做T管家 · Android 打包 ====="

# ---------- 1. 签名配置 ----------
KEY_FILE=android/key.properties
if [ ! -f "$KEY_FILE" ]; then
  echo "[1/4] 未找到签名配置，生成自签名 keystore..."
  keytool -genkey -v -keystore android/zuot.jks \
    -keyalg RSA -keysize 2048 -validity 10000 \
    -alias zuot -storepass zuot123 -keypass zuot123 \
    -dname "CN=zuot, OU=dev, O=zuot, L=, S=, C=CN"

  cat > "$KEY_FILE" <<EOF
storePassword=zuot123
keyPassword=zuot123
keyAlias=zuot
storeFile=zuot.jks
EOF
  echo "已生成 android/zuot.jks 与 key.properties（请妥善保管，切勿提交到代码仓库）"
else
  echo "[1/4] 已存在签名配置"
fi

# ---------- 2. 依赖 ----------
echo "[2/4] 获取依赖..."
flutter pub get

# ---------- 3. 构建 ----------
echo "[3/4] 构建 release APK..."
flutter build apk --release

# ---------- 4. 产出 ----------
APK=build/app/outputs/flutter-apk/app-release.apk
echo "[4/4] 构建完成"

if command -v open >/dev/null 2>&1; then
  open "$(dirname "$APK")"
elif command -v explorer.exe >/dev/null 2>&1; then
  explorer.exe "$(dirname "$APK")"
fi

echo ""
echo "APK 位置：$(pwd)/$APK"
echo "安装到手机：adb install -r $APK"
echo ""
echo "⚠️ 打包前请确认：client/lib/core/api.dart 里的默认服务器地址，"
echo "   或首次启动 App 后在「我的 → 服务器地址」填入你的后端地址。"
