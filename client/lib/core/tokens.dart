import 'dart:ui' show FontFeature;

import 'package:flutter/material.dart';

/// ============================================================
/// 设计令牌 Design Tokens · V3「深空终端」
/// ------------------------------------------------------------
/// 铁律：页面里禁止出现裸数值（间距/圆角/字号/字重/阴影），
///       一律引用本文件的令牌，保证全 App 视觉一致。
/// ============================================================

/// 间距 —— 严格 8pt 栅格（半步 4pt）
class Sp {
  Sp._();
  static const double xs = 4;
  static const double s = 8;
  static const double m = 12;
  static const double l = 16; // 页面左右安全边距
  static const double xl = 20;
  static const double xxl = 24;
  static const double xxxl = 32;
  static const double huge = 40;

  /// 列表项之间的节奏
  static const double listGap = 12;
  /// 卡片内边距
  static const double cardPad = 16;
}

/// 圆角 —— 只保留 4 档，禁止 10/14/18 这类随手值
class Rd {
  Rd._();
  static const double chip = 6;   // 标签、徽章
  static const double sm = 8;     // 输入框、小按钮
  static const double md = 12;    // 列表项
  static const double lg = 16;    // 标准卡片
  static const double xl = 20;    // Hero 大卡、弹层
}

/// 字号 —— 6 级阶梯，砍掉 10.5 / 11.5 / 12.5 / 13.5 这类中间值
class Fs {
  Fs._();
  static const double micro = 11; // 免责、时间戳
  static const double caption = 12; // 次要说明
  static const double body = 14;  // 正文
  static const double title = 16; // 卡片标题
  static const double head = 20;  // 区块大标题
  static const double hero = 32;  // 首屏核心数字

  /// 数值展示：等宽数字，防止跳动（金融 App 高级感的关键细节）
  static const List<FontFeature> tabular = [FontFeature.tabularFigures()];
}

/// 字重 —— 4 档
class Fw {
  Fw._();
  static const FontWeight regular = FontWeight.w400;
  static const FontWeight medium = FontWeight.w500;
  static const FontWeight semi = FontWeight.w600;
  static const FontWeight bold = FontWeight.w700;
}

/// 阴影 / 光晕 —— 深色底不用重投影，用「极低透明度大模糊」+ 「品牌色外发光」
class Sh {
  Sh._();
  /// 卡片基础投影（很轻，只做托底）
  static final List<BoxShadow> card = [
    BoxShadow(color: const Color(0xFF000000).withOpacity(0.32), blurRadius: 16, offset: const Offset(0, 6)),
  ];
  /// 品牌色外发光（AI 卡、主 CTA）
  static List<BoxShadow> glow(Color color, {double opacity = 0.22, double blur = 20}) => [
        BoxShadow(color: color.withOpacity(opacity), blurRadius: blur, offset: const Offset(0, 6)),
      ];
}

/// 尺寸
class Sz {
  Sz._();
  static const double buttonH = 48;
  static const double smallButtonH = 36;
  static const double tabBarH = 64;
  static const double appBarH = 56;
  static const double iconBox = 40;
}
