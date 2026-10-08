import 'package:intl/intl.dart';

/// 金额 / 价格格式化工具
///
/// 单位铁律（与后端 server/src/lib/units.js 一一对应，改动必须同步）：
///   - **价格** 用「厘 mills」：1 元 = 1000 厘。ETF 最小变动价位 0.001 元，
///     若用「分」存会把 0.611 / 0.614 都记成 61 分、价差被抹平为 0，做T 收益直接失真。
///   - **金额** 用「分 cents」：1 元 = 100 分。
/// 前端只负责展示，任何 *_Mills 字段走 [Fmt.price]，任何 *_Cents 字段走 [Fmt.money]。
class Fmt {
  // ---------- 价格（厘 → 元，3 位小数）----------

  /// 厘 → 元，默认 3 位小数（价格用）
  static String price(dynamic mills, {int digits = 3, bool withSign = false}) {
    if (mills == null) return '--';
    final v = (mills as num).toDouble() / 1000.0;
    final s = v.toStringAsFixed(digits);
    if (withSign && v > 0) return '+$s';
    return s;
  }

  /// 价差（厘/股）→ 元，带正负号，用于「价差 / 保本价差」
  static String priceSigned(dynamic mills, {int digits = 3}) {
    return price(mills, digits: digits, withSign: true);
  }

  /// 每股价差展示（后端 spreadMills 已是「厘/股」）
  static String spread(dynamic mills) => priceSigned(mills, digits: 3);

  // ---------- 金额（分 → 元，2 位小数）----------

  /// 分 → 元
  static String yuan(dynamic cents, {int digits = 2, bool withSign = false}) {
    if (cents == null) return '--';
    final v = (cents as num).toDouble() / 100.0;
    final s = v.toStringAsFixed(digits);
    if (withSign && v > 0) return '+$s';
    return s;
  }

  /// 分 → 元，带 ¥
  static String money(dynamic cents, {bool withSign = false}) {
    if (cents == null) return '--';
    return '¥${yuan(cents, withSign: withSign)}';
  }

  /// 分 → 元，带 ¥ 与正负号
  static String moneySigned(dynamic cents) => money(cents, withSign: true);

  // ---------- 其它 ----------

  /// 百分比（rate 为小数，0.0123 → 1.23%）
  static String pct(dynamic rate, {int digits = 2, bool withSign = false}) {
    if (rate == null) return '--';
    final v = (rate as num).toDouble() * 100;
    final s = v.toStringAsFixed(digits);
    if (withSign && v > 0) return '+$s%';
    return '$s%';
  }

  /// 数量，千分位
  static String qty(dynamic v) {
    if (v == null) return '--';
    return NumberFormat('#,###').format(v is num ? v : num.tryParse('$v') ?? 0);
  }

  /// 日期：MM-DD
  static String md(DateTime d) => DateFormat('MM-dd').format(d);

  /// 日期：yyyy-MM-dd
  static String ymd(DateTime d) => DateFormat('yyyy-MM-dd').format(d);

  /// 日期时间：MM-DD HH:mm
  static String mdHm(DateTime d) => DateFormat('MM-dd HH:mm').format(d);

  /// 时间：HH:mm
  static String hm(DateTime d) => DateFormat('HH:mm').format(d);
}
