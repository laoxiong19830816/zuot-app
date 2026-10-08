import 'package:flutter/material.dart';
import 'tokens.dart';

/// ============================================================
/// App 配色 · V3「深空终端」
/// ------------------------------------------------------------
/// V2 → V3 的四个关键修正：
/// ① 中性色明度差从 8~12 拉大到 18~22，层次不再靠描边硬撑
/// ② 描边改用半透明白（8% / 15%），深色下比实色描边更「轻」
/// ③ 主色换成靛蓝 #4F7DFF，与涨红跌绿彻底分家；黄色只留告警
/// ④ AI 用独立紫 #8A6BFF，形成「AI = 紫」的语义记忆
/// ============================================================
class AppColors {
  AppColors._();

  /// ---------- 语义色：涨红跌绿（中国习惯，切勿照搬美股配色）----------
  static const up = Color(0xFFFF4D5A); // 涨 / 盈利，对比度 5.98:1
  static const down = Color(0xFF0ABF7E); // 跌 / 亏损，对比度 8.12:1
  static const flat = Color(0xFF8A94A6); // 平

  /// ---------- 中性色 5 级阶梯（背景 → 高层）----------
  static const bg = Color(0xFF0A0D13); // 页面底
  static const surface = Color(0xFF12161F); // 卡片
  static const surfaceHigh = Color(0xFF1A1F2B); // 输入框 / 内嵌块
  static const surfaceTop = Color(0xFF222836); // 悬浮层 / 选中态
  static const surfaceElevated = Color(0xFF2A3140); // 弹层

  /// ---------- 描边（半透明白）----------
  static const border = Color(0x14FFFFFF); // 8% 白
  static const borderStrong = Color(0x26FFFFFF); // 15% 白

  /// ---------- 文本 3 级 ----------
  static const textPrimary = Color(0xFFF2F5F9); // 对比度 15.8:1
  static const textSecondary = Color(0xFF8B95A7); // 6.44:1
  static const textTertiary = Color(0xFF737E8F); // 4.73:1（仅用于次要标签）

  /// ---------- 品牌 ----------
  static const primary = Color(0xFF4F7DFF); // 靛蓝主色，5.28:1
  static const primarySoft = Color(0x1F4F7DFF); // 12% 主色底
  static const ai = Color(0xFF8A6BFF); // AI 紫，5.22:1
  static const aiSoft = Color(0x1F8A6BFF);

  /// ---------- 状态 ----------
  static const warn = Color(0xFFFFA53D); // 9.90:1
  static const warnSoft = Color(0x1FFFFA53D);
  static const danger = Color(0xFFFF4D5A);
  static const dangerSoft = Color(0x1FFFF4D5A);
  static const success = Color(0xFF0ABF7E);
  static const successSoft = Color(0x1FF0ABF7E);
  static const accent = Color(0xFFFFA53D); // 兼容旧引用（ETF 标签）
}

class AppTheme {
  static ThemeData dark() {
    const base = ColorScheme.dark(
      primary: AppColors.primary,
      onPrimary: Color(0xFFFFFFFF),
      secondary: AppColors.ai,
      surface: AppColors.surface,
      onSurface: AppColors.textPrimary,
      error: AppColors.danger,
    );

    return ThemeData(
      useMaterial3: true,
      brightness: Brightness.dark,
      colorScheme: base,
      scaffoldBackgroundColor: AppColors.bg,

      // ---------- AppBar：纯透明，与页面底融为一体 ----------
      appBarTheme: const AppBarTheme(
        backgroundColor: Colors.transparent,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        scrolledUnderElevation: 0,
        centerTitle: false,
        toolbarHeight: Sz.appBarH,
        titleSpacing: Sp.l,
        titleTextStyle: TextStyle(
          fontSize: Fs.title,
          fontWeight: Fw.semi,
          color: AppColors.textPrimary,
          letterSpacing: 0.2,
        ),
        iconTheme: IconThemeData(color: AppColors.textSecondary, size: 22),
        actionsIconTheme: IconThemeData(color: AppColors.textSecondary, size: 22),
      ),

      // ---------- 卡片：无描边 + 轻投影，层次靠明度差 ----------
      cardTheme: CardThemeData(
        color: AppColors.surface,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        margin: const EdgeInsets.symmetric(horizontal: Sp.l, vertical: Sp.xs),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(Rd.lg),
          side: const BorderSide(color: AppColors.border, width: 1),
        ),
      ),

      // ---------- 输入：填充式，聚焦才描边 ----------
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: AppColors.surfaceHigh,
        contentPadding: const EdgeInsets.symmetric(horizontal: Sp.m, vertical: 14),
        hintStyle: const TextStyle(color: AppColors.textTertiary, fontSize: Fs.body),
        labelStyle: const TextStyle(color: AppColors.textSecondary, fontSize: Fs.body),
        floatingLabelStyle: const TextStyle(color: AppColors.primary, fontSize: Fs.caption),
        prefixIconColor: AppColors.textTertiary,
        suffixIconColor: AppColors.textTertiary,
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(Rd.sm),
          borderSide: BorderSide.none,
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(Rd.sm),
          borderSide: BorderSide.none,
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(Rd.sm),
          borderSide: const BorderSide(color: AppColors.primary, width: 1.5),
        ),
        errorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(Rd.sm),
          borderSide: const BorderSide(color: AppColors.danger, width: 1.5),
        ),
      ),

      // ---------- 按钮：全圆角、高度统一 48 ----------
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: AppColors.primary,
          foregroundColor: Colors.white,
          disabledBackgroundColor: AppColors.surfaceTop,
          disabledForegroundColor: AppColors.textTertiary,
          elevation: 0,
          minimumSize: const Size.fromHeight(Sz.buttonH),
          padding: const EdgeInsets.symmetric(horizontal: Sp.xl),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(Rd.sm)),
          textStyle: const TextStyle(fontSize: Fs.body, fontWeight: Fw.semi, letterSpacing: 0.3),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: AppColors.textPrimary,
          elevation: 0,
          minimumSize: const Size.fromHeight(Sz.buttonH),
          side: const BorderSide(color: AppColors.borderStrong, width: 1),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(Rd.sm)),
          textStyle: const TextStyle(fontSize: Fs.body, fontWeight: Fw.medium),
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          foregroundColor: AppColors.primary,
          minimumSize: const Size(64, Sz.smallButtonH),
          padding: const EdgeInsets.symmetric(horizontal: Sp.m),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(Rd.sm)),
          textStyle: const TextStyle(fontSize: Fs.caption, fontWeight: Fw.semi),
        ),
      ),

      // ---------- 底部导航：Material3，带胶囊指示器 ----------
      navigationBarTheme: NavigationBarThemeData(
        backgroundColor: AppColors.surface,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        height: Sz.tabBarH,
        indicatorColor: AppColors.primarySoft,
        labelTextStyle: WidgetStateProperty.resolveWith((states) {
          final selected = states.contains(WidgetState.selected);
          return TextStyle(
            fontSize: Fs.micro,
            fontWeight: selected ? Fw.semi : Fw.regular,
            color: selected ? AppColors.primary : AppColors.textTertiary,
            letterSpacing: 0.2,
          );
        }),
        iconTheme: WidgetStateProperty.resolveWith((states) {
          final selected = states.contains(WidgetState.selected);
          return IconThemeData(
            color: selected ? AppColors.primary : AppColors.textTertiary,
            size: 22,
          );
        }),
      ),

      // ---------- TabBar：下划指示器改短胶囊 ----------
      tabBarTheme: const TabBarThemeData(
        dividerColor: Colors.transparent,
        labelColor: AppColors.primary,
        unselectedLabelColor: AppColors.textSecondary,
        labelStyle: TextStyle(fontSize: Fs.body, fontWeight: Fw.semi),
        unselectedLabelStyle: TextStyle(fontSize: Fs.body, fontWeight: Fw.regular),
        indicator: UnderlineTabIndicator(
          borderSide: BorderSide(color: AppColors.primary, width: 2.5),
          insets: EdgeInsets.symmetric(horizontal: 28),
        ),
        indicatorSize: TabBarIndicatorSize.label,
      ),

      dividerTheme: const DividerThemeData(color: AppColors.border, thickness: 1, space: 1),
      snackBarTheme: SnackBarThemeData(
        backgroundColor: AppColors.surfaceElevated,
        contentTextStyle: const TextStyle(color: AppColors.textPrimary, fontSize: Fs.body),
        behavior: SnackBarBehavior.floating,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(Rd.sm)),
      ),
      dialogTheme: DialogThemeData(
        backgroundColor: AppColors.surfaceElevated,
        surfaceTintColor: Colors.transparent,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(Rd.xl)),
      ),
      bottomSheetTheme: const BottomSheetThemeData(
        backgroundColor: AppColors.surfaceElevated,
        surfaceTintColor: Colors.transparent,
        modalBackgroundColor: AppColors.surfaceElevated,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(Rd.xl)),
        ),
      ),
      progressIndicatorTheme: const ProgressIndicatorThemeData(
        color: AppColors.primary,
        linearMinHeight: 3,
        circularTrackColor: AppColors.surfaceTop,
      ),
      listTileTheme: const ListTileThemeData(
        contentPadding: EdgeInsets.symmetric(horizontal: Sp.l, vertical: Sp.xs),
        minVerticalPadding: Sp.m,
        titleTextStyle: TextStyle(fontSize: Fs.body, color: AppColors.textPrimary),
        subtitleTextStyle: TextStyle(fontSize: Fs.caption, color: AppColors.textTertiary),
      ),

      textTheme: const TextTheme(
        displaySmall: TextStyle(fontSize: Fs.hero, fontWeight: Fw.bold, color: AppColors.textPrimary),
        titleLarge: TextStyle(fontSize: Fs.head, fontWeight: Fw.semi, color: AppColors.textPrimary),
        titleMedium: TextStyle(fontSize: Fs.title, fontWeight: Fw.semi, color: AppColors.textPrimary),
        bodyLarge: TextStyle(fontSize: Fs.body, color: AppColors.textPrimary, height: 1.5),
        bodyMedium: TextStyle(fontSize: Fs.body, color: AppColors.textPrimary),
        bodySmall: TextStyle(fontSize: Fs.caption, color: AppColors.textSecondary),
        labelSmall: TextStyle(fontSize: Fs.micro, color: AppColors.textTertiary),
      ),
    );
  }

  /// 涨跌配色（涨红跌绿）
  static Color profitColor(num? value) {
    if (value == null) return AppColors.flat;
    if (value > 0) return AppColors.up;
    if (value < 0) return AppColors.down;
    return AppColors.flat;
  }

  /// 涨跌底色（用于卡片/标签的 12% 底）
  static Color profitSoft(num? value) {
    if (value == null) return AppColors.surfaceTop;
    if (value > 0) return AppColors.dangerSoft;
    if (value < 0) return AppColors.successSoft;
    return AppColors.surfaceTop;
  }
}

const String kDisclaimer =
    '本系统仅为个人交易记录与信息整理工具，所有 AI 分析均基于公开数据与用户自设规则推演，不构成投资建议，据此操作风险自负。';
