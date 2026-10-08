import 'package:flutter/material.dart';

import '../core/theme.dart';
import '../core/tokens.dart';

/// ============================================================
/// 通用组件库 · V3
/// ------------------------------------------------------------
/// 设计原则：
/// ① 层次靠「明度差 + 留白」，不靠描边堆砌
/// ② 所有数值文本走 NumText（等宽 + tabular），杜绝数字跳动
/// ③ 圆角/间距/字号一律取令牌，页面零裸值
/// ============================================================

// ------------------------------------------------------------------
// 1. 数值文本：等宽数字，金融 App 的「高级感」来自这里
// ------------------------------------------------------------------
class NumText extends StatelessWidget {
  final String text;
  final double size;
  final Color? color;
  final FontWeight weight;
  final double? letterSpacing;

  const NumText(
    this.text, {
    super.key,
    this.size = Fs.body,
    this.color,
    this.weight = Fw.semi,
    this.letterSpacing,
  });

  @override
  Widget build(BuildContext context) {
    return Text(
      text,
      style: TextStyle(
        fontSize: size,
        fontWeight: weight,
        color: color ?? AppColors.textPrimary,
        fontFeatures: Fs.tabular,
        letterSpacing: letterSpacing,
      ),
    );
  }
}

// ------------------------------------------------------------------
// 2. 标准卡片
// ------------------------------------------------------------------
class AppCard extends StatelessWidget {
  final Widget child;
  final EdgeInsetsGeometry? padding;
  final VoidCallback? onTap;
  final Color? color;
  final double radius;
  final bool showBorder;

  const AppCard({
    super.key,
    required this.child,
    this.padding,
    this.onTap,
    this.color,
    this.radius = Rd.lg,
    this.showBorder = true,
  });

  @override
  Widget build(BuildContext context) {
    Widget content = Padding(
      padding: padding ?? const EdgeInsets.all(Sp.cardPad),
      child: child,
    );
    if (onTap != null) {
      content = InkWell(
        borderRadius: BorderRadius.circular(radius),
        onTap: onTap,
        child: content,
      );
    }
    return Container(
      margin: const EdgeInsets.symmetric(horizontal: Sp.l, vertical: Sp.xs),
      decoration: BoxDecoration(
        color: color ?? AppColors.surface,
        borderRadius: BorderRadius.circular(radius),
        border: showBorder ? Border.all(color: AppColors.border, width: 1) : null,
        boxShadow: Sh.card,
      ),
      child: content,
    );
  }
}

// ------------------------------------------------------------------
// 3. Hero 卡：首屏核心数字（唯一使用大渐变的地方）
// ------------------------------------------------------------------
class HeroCard extends StatelessWidget {
  final String label;
  final String value;
  final Color valueColor;
  final List<MiniStat> stats;

  const HeroCard({
    super.key,
    required this.label,
    required this.value,
    required this.valueColor,
    this.stats = const [],
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.fromLTRB(Sp.l, Sp.s, Sp.l, Sp.m),
      padding: const EdgeInsets.fromLTRB(Sp.xl, Sp.xl, Sp.xl, Sp.m),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(Rd.xl),
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            valueColor.withOpacity(0.14),
            AppColors.surface.withOpacity(0.9),
            AppColors.surfaceHigh,
          ],
          stops: const [0, 0.45, 1],
        ),
        border: Border.all(color: valueColor.withOpacity(0.22), width: 1),
        boxShadow: Sh.glow(valueColor, opacity: 0.14, blur: 28),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            label,
            style: const TextStyle(
              fontSize: Fs.caption,
              color: AppColors.textSecondary,
              fontWeight: Fw.medium,
              letterSpacing: 0.4,
            ),
          ),
          const SizedBox(height: Sp.s),
          NumText(value, size: Fs.hero, color: valueColor, weight: Fw.bold),
          if (stats.isNotEmpty) ...[
            const SizedBox(height: Sp.m),
            const Divider(height: 1),
            const SizedBox(height: Sp.m),
            Row(
              children: stats
                  .map((s) => Expanded(child: s))
                  .expand((w) => [w, const SizedBox(width: Sp.s)])
                  .toList()
                ..removeLast(),
            ),
          ],
        ],
      ),
    );
  }
}

/// Hero 卡内的次要指标
class MiniStat extends StatelessWidget {
  final String label;
  final String value;
  final Color? color;

  const MiniStat({super.key, required this.label, required this.value, this.color});

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        NumText(value, size: Fs.title, color: color ?? AppColors.textPrimary),
        const SizedBox(height: 2),
        Text(label, style: const TextStyle(fontSize: Fs.micro, color: AppColors.textTertiary)),
      ],
    );
  }
}

// ------------------------------------------------------------------
// 4. 区块标题：左侧竖条，替代「加粗小字」的廉价做法
// ------------------------------------------------------------------
class SectionTitle extends StatelessWidget {
  final String title;
  final String? trailing;
  final VoidCallback? onTrailing;
  final Color accent;

  const SectionTitle({
    super.key,
    required this.title,
    this.trailing,
    this.onTrailing,
    this.accent = AppColors.primary,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(Sp.l, Sp.xxl, Sp.l, Sp.m),
      child: Row(
        children: [
          Container(
            width: 3,
            height: 14,
            decoration: BoxDecoration(
              color: accent,
              borderRadius: BorderRadius.circular(2),
            ),
          ),
          const SizedBox(width: Sp.s),
          Text(
            title,
            style: const TextStyle(
              fontSize: Fs.body,
              fontWeight: Fw.semi,
              color: AppColors.textPrimary,
              letterSpacing: 0.2,
            ),
          ),
          const Spacer(),
          if (trailing != null)
            GestureDetector(
              onTap: onTrailing,
              child: Text(
                trailing!,
                style: const TextStyle(fontSize: Fs.caption, color: AppColors.primary),
              ),
            ),
        ],
      ),
    );
  }
}

// ------------------------------------------------------------------
// 5. 类型 / 状态标签
// ------------------------------------------------------------------
class TagChip extends StatelessWidget {
  final String text;
  final Color color;
  final IconData? icon;
  final bool filled;

  const TagChip({
    super.key,
    required this.text,
    required this.color,
    this.icon,
    this.filled = false,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: Sp.s, vertical: 3),
      decoration: BoxDecoration(
        color: filled ? color : color.withOpacity(0.14),
        borderRadius: BorderRadius.circular(Rd.chip),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (icon != null) ...[
            Icon(icon, size: 11, color: filled ? Colors.white : color),
            const SizedBox(width: 3),
          ],
          Text(
            text,
            style: TextStyle(
              fontSize: Fs.micro,
              fontWeight: Fw.semi,
              color: filled ? Colors.white : color,
            ),
          ),
        ],
      ),
    );
  }
}

// ------------------------------------------------------------------
// 6. 预警条
// ------------------------------------------------------------------
class AlertBanner extends StatelessWidget {
  final String message;
  final AlertLevel level;
  final IconData icon;

  const AlertBanner({
    super.key,
    required this.message,
    this.level = AlertLevel.warn,
    this.icon = Icons.warning_amber_rounded,
  });

  Color get _color => level == AlertLevel.danger ? AppColors.danger : AppColors.warn;
  Color get _soft => level == AlertLevel.danger ? AppColors.dangerSoft : AppColors.warnSoft;

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.symmetric(horizontal: Sp.l, vertical: Sp.xs),
      padding: const EdgeInsets.all(Sp.m),
      decoration: BoxDecoration(
        color: _soft,
        borderRadius: BorderRadius.circular(Rd.md),
        border: Border.all(color: _color.withOpacity(0.24), width: 1),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 16, color: _color),
          const SizedBox(width: Sp.s),
          Expanded(
            child: Text(
              message,
              style: TextStyle(fontSize: Fs.caption, color: _color, height: 1.45),
            ),
          ),
        ],
      ),
    );
  }
}

enum AlertLevel { warn, danger }

// ------------------------------------------------------------------
// 7. 空状态
// ------------------------------------------------------------------
class EmptyState extends StatelessWidget {
  final IconData icon;
  final String title;
  final String? subtitle;
  final String? actionText;
  final VoidCallback? onAction;

  const EmptyState({
    super.key,
    required this.icon,
    required this.title,
    this.subtitle,
    this.actionText,
    this.onAction,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: Sp.xxxl, vertical: Sp.huge),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 56,
            height: 56,
            decoration: BoxDecoration(
              color: AppColors.surfaceHigh,
              borderRadius: BorderRadius.circular(Rd.lg),
              border: Border.all(color: AppColors.border, width: 1),
            ),
            child: Icon(icon, size: 26, color: AppColors.textTertiary),
          ),
          const SizedBox(height: Sp.m),
          Text(
            title,
            style: const TextStyle(fontSize: Fs.body, color: AppColors.textSecondary, fontWeight: Fw.medium),
            textAlign: TextAlign.center,
          ),
          if (subtitle != null) ...[
            const SizedBox(height: Sp.xs),
            Text(
              subtitle!,
              style: const TextStyle(fontSize: Fs.caption, color: AppColors.textTertiary, height: 1.5),
              textAlign: TextAlign.center,
            ),
          ],
          if (actionText != null) ...[
            const SizedBox(height: Sp.l),
            OutlinedButton(onPressed: onAction, child: Text(actionText!)),
          ],
        ],
      ),
    );
  }
}

// ------------------------------------------------------------------
// 8. 骨架屏（加载态，替代干巴巴的转圈）
// ------------------------------------------------------------------
class Skeleton extends StatefulWidget {
  final double width;
  final double height;
  final double radius;

  const Skeleton({super.key, this.width = double.infinity, this.height = 16, this.radius = Rd.sm});

  @override
  State<Skeleton> createState() => _SkeletonState();
}

class _SkeletonState extends State<Skeleton> with SingleTickerProviderStateMixin {
  late AnimationController _c;
  late Animation<double> _a;

  @override
  void initState() {
    super.initState();
    _c = AnimationController(vsync: this, duration: const Duration(milliseconds: 1200))..repeat(reverse: true);
    _a = Tween<double>(begin: 0.35, end: 0.75).animate(CurvedAnimation(parent: _c, curve: Curves.easeInOut));
  }

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _a,
      builder: (_, __) => Container(
        width: widget.width,
        height: widget.height,
        decoration: BoxDecoration(
          color: AppColors.surfaceTop.withOpacity(_a.value),
          borderRadius: BorderRadius.circular(widget.radius),
        ),
      ),
    );
  }
}

/// 列表骨架屏
class ListSkeleton extends StatelessWidget {
  final int count;
  const ListSkeleton({super.key, this.count = 3});

  @override
  Widget build(BuildContext context) {
    return Column(
      children: List.generate(
        count,
        (_) => Padding(
          padding: const EdgeInsets.symmetric(horizontal: Sp.l, vertical: Sp.s),
          child: Skeleton(height: 72, radius: Rd.lg),
        ),
      ),
    );
  }
}

// ------------------------------------------------------------------
// 9. 主 CTA 渐变按钮
// ------------------------------------------------------------------
class GradientButton extends StatelessWidget {
  final String text;
  final VoidCallback? onPressed;
  final IconData? icon;
  final bool loading;
  final double height;

  const GradientButton({
    super.key,
    required this.text,
    this.onPressed,
    this.icon,
    this.loading = false,
    this.height = Sz.buttonH,
  });

  @override
  Widget build(BuildContext context) {
    final disabled = onPressed == null || loading;
    return Container(
      height: height,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(Rd.sm),
        gradient: disabled
            ? null
            : const LinearGradient(
                colors: [Color(0xFF6B90FF), Color(0xFF4F7DFF)],
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
              ),
        color: disabled ? AppColors.surfaceTop : null,
        boxShadow: disabled ? null : Sh.glow(AppColors.primary, opacity: 0.28, blur: 16),
      ),
      child: Material(
        color: Colors.transparent,
        borderRadius: BorderRadius.circular(Rd.sm),
        child: InkWell(
          borderRadius: BorderRadius.circular(Rd.sm),
          onTap: disabled ? null : onPressed,
          child: Center(
            child: loading
                ? const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                  )
                : Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      if (icon != null) ...[
                        Icon(icon, size: 18, color: Colors.white),
                        const SizedBox(width: Sp.s),
                      ],
                      Text(
                        text,
                        style: TextStyle(
                          fontSize: Fs.body,
                          fontWeight: Fw.semi,
                          color: disabled ? AppColors.textTertiary : Colors.white,
                          letterSpacing: 0.3,
                        ),
                      ),
                    ],
                  ),
          ),
        ),
      ),
    );
  }
}

// ------------------------------------------------------------------
// 10. AI 分析卡：紫渐变 + 品牌光晕，形成「AI = 紫」的记忆
// ------------------------------------------------------------------
class AiCardShell extends StatelessWidget {
  final Widget child;

  const AiCardShell({super.key, required this.child});

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.symmetric(horizontal: Sp.l, vertical: Sp.xs),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(Rd.lg),
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Color(0x268A6BFF), Color(0x0D8A6BFF), AppColors.surface],
          stops: [0, 0.5, 1],
        ),
        border: Border.all(color: AppColors.ai.withOpacity(0.28), width: 1),
        boxShadow: Sh.glow(AppColors.ai, opacity: 0.12, blur: 22),
      ),
      child: Padding(padding: const EdgeInsets.all(Sp.cardPad), child: child),
    );
  }
}

// ------------------------------------------------------------------
// 11. 交易时段状态胶囊
// ------------------------------------------------------------------
class StatusPill extends StatelessWidget {
  final String text;
  final Color color;

  const StatusPill({super.key, required this.text, required this.color});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: Sp.s, vertical: 3),
      decoration: BoxDecoration(
        color: color.withOpacity(0.14),
        borderRadius: BorderRadius.circular(Rd.chip),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(width: 5, height: 5, decoration: BoxDecoration(color: color, shape: BoxShape.circle)),
          const SizedBox(width: 5),
          Text(text, style: TextStyle(fontSize: Fs.micro, color: color, fontWeight: Fw.semi)),
        ],
      ),
    );
  }
}
