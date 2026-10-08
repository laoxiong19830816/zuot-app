#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
给 Flutter 自动生成的 AndroidManifest.xml 打网络补丁。

背景（非常重要，别删这段注释）：
  flutter create 生成的 android/app/src/main/AndroidManifest.xml 里
  【没有】联网权限，只有 debug / profile 目录下才有 INTERNET 权限。
  结果就是：debug 包能联网，release 包一装到真机上所有请求全部失败，
  界面只会显示「请求失败，请检查网络与服务器地址」，极易误判成后端没开。

  另外 Android 9（API 28）起默认禁止明文 HTTP（cleartext）。
  我们要连的局域网地址是 http://192.168.x.x:8080，属于明文 HTTP，
  不放开的话系统会直接拒绝连接，报 "Cleartext traffic not permitted"。

所以这里补两件事：
  1) android.permission.INTERNET
  2) application 标签上 android:usesCleartextTraffic="true"

幂等：已经有的就不重复加，重复运行无副作用。
用法：python3 scripts/patch-android-manifest.py [manifest路径]
"""

import re
import sys
import pathlib

DEFAULT = "client/android/app/src/main/AndroidManifest.xml"


def main() -> int:
    path = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else DEFAULT)
    if not path.exists():
        print("[patch] 找不到 %s，跳过（可能还没执行 flutter create）" % path)
        return 0

    text = path.read_text(encoding="utf-8")
    before = text

    # ---------- 1) 联网权限 ----------
    if "android.permission.INTERNET" not in text:
        m = re.search(r"^[ \t]*<application\b", text, re.MULTILINE)
        line = '    <uses-permission android:name="android.permission.INTERNET"/>\n'
        if m:
            text = text[: m.start()] + line + text[m.start() :]
        else:
            text = text.replace("</manifest>", line + "</manifest>")
        print("[patch] + INTERNET 权限")
    else:
        print("[patch] INTERNET 权限已存在，跳过")

    # ---------- 2) 允许明文 HTTP（局域网 http 地址必需） ----------
    if "usesCleartextTraffic" not in text:

        def _add_attr(m: "re.Match") -> str:
            tag = m.group(0)
            attr = ' android:usesCleartextTraffic="true"'
            if tag.endswith("/>"):
                return tag[:-2].rstrip() + attr + "/>"
            return tag[:-1].rstrip() + attr + ">"

        text = re.sub(r"<application\b[^>]*>", _add_attr, text, count=1)
        print("[patch] + usesCleartextTraffic=true")
    else:
        print("[patch] usesCleartextTraffic 已存在，跳过")

    if text != before:
        path.write_text(text, encoding="utf-8")
        print("[patch] 已写入 %s" % path)
    else:
        print("[patch] 无需修改")

    # 打印结果，方便在云端日志里一眼确认
    print("---- %s ----" % path)
    print(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
