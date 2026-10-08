import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/api.dart';
import '../core/format.dart';
import '../core/theme.dart';
import '../core/tokens.dart';
import '../providers.dart';
import '../widgets/ui.dart';
import 'trade_entry_page.dart';

/// ============================================================
/// 今日看板（首页）· V3
/// ------------------------------------------------------------
/// V2 → V3 的三个结构性调整：
/// ① 三个等权小卡 → 1 个 Hero 大数字 + 3 个次要指标（层级立刻分明）
/// ② AI 卡独立紫渐变，与其他卡片一眼区分
/// ③ 预警/挂单不再平铺，收敛为「有才出现」的插入条
/// ============================================================
class HomePage extends ConsumerStatefulWidget {
  const HomePage({super.key});

  @override
  ConsumerState<HomePage> createState() => _HomePageState();
}

class _HomePageState extends ConsumerState<HomePage> {
  bool _aiExpanded = false;
  bool _reviewing = false;

  String get _todayKind {
    final now = DateTime.now();
    if (now.hour == 9 && now.minute < 25) return 'PREOPEN';
    if (now.hour >= 15) return 'CLOSE';
    return 'INTRADAY';
  }

  (String, Color) get _status {
    switch (_todayKind) {
      case 'PREOPEN':
        return ('集合竞价', AppColors.warn);
      case 'CLOSE':
        return ('已收盘', AppColors.textTertiary);
      default:
        return ('交易中', AppColors.primary);
    }
  }

  Future<void> _refreshAi(String kind) async {
    try {
      _toast('正在调用豆包分析，约 20-40 秒…');
      await ref.read(apiProvider).refreshAi(kind);
      ref.invalidate(latestAiProvider);
      if (mounted) _toast('分析已更新');
    } catch (e) {
      if (mounted) _toast('分析失败：$e');
    }
  }

  void _toast(String msg) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));
  }

  Future<void> _runReview() async {
    setState(() => _reviewing = true);
    try {
      final res = await ref.read(apiProvider).review();
      if (!mounted) return;
      final analysis = res['analysis'];
      showModalBottomSheet(
        context: context,
        isScrollControlled: true,
        builder: (_) => DraggableScrollableSheet(
          initialChildSize: 0.9,
          minChildSize: 0.5,
          maxChildSize: 0.95,
          expand: false,
          builder: (_, ctrl) => SingleChildScrollView(
            controller: ctrl,
            padding: const EdgeInsets.all(Sp.xl),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Center(
                  child: Container(
                    width: 36,
                    height: 4,
                    decoration: BoxDecoration(
                      color: AppColors.borderStrong,
                      borderRadius: BorderRadius.circular(2),
                    ),
                  ),
                ),
                const SizedBox(height: Sp.l),
                const Text('盘后复盘 · 次日策略',
                    style: TextStyle(fontSize: Fs.head, fontWeight: Fw.semi)),
                const SizedBox(height: Sp.xs),
                Text('生成时间 ${Fmt.mdHm(DateTime.now())}',
                    style: const TextStyle(fontSize: Fs.caption, color: AppColors.textTertiary)),
                const SizedBox(height: Sp.l),
                const Divider(height: 1),
                const SizedBox(height: Sp.l),
                SelectableText(
                  analysis['content'] ?? '',
                  style: const TextStyle(fontSize: Fs.body, height: 1.75),
                ),
                const SizedBox(height: Sp.xl),
                const Text(kDisclaimer,
                    style: TextStyle(fontSize: Fs.micro, color: AppColors.textTertiary, height: 1.5)),
                const SizedBox(height: Sp.xl),
              ],
            ),
          ),
        ),
      );
    } catch (e) {
      if (mounted) _toast(e.toString().replaceFirst(RegExp(r'.*error: '), ''));
    } finally {
      if (mounted) setState(() => _reviewing = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final todayAsync = ref.watch(todayProvider);
    final pendingAsync = ref.watch(pendingProvider);
    final riskAsync = ref.watch(riskProvider);
    final aiAsync = ref.watch(latestAiProvider(_todayKind));
    final (statusText, statusColor) = _status;

    return Scaffold(
      appBar: AppBar(
        titleSpacing: Sp.l,
        title: Row(
          children: [
            Text('今日做T · ${Fmt.md(DateTime.now())}'),
            const SizedBox(width: Sp.s),
            StatusPill(text: statusText, color: statusColor),
          ],
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh_rounded),
            tooltip: '刷新',
            onPressed: () {
              ref.invalidate(todayProvider);
              ref.invalidate(pendingProvider);
              ref.invalidate(riskProvider);
              ref.invalidate(latestAiProvider);
            },
          ),
          const SizedBox(width: Sp.xs),
        ],
      ),
      body: RefreshIndicator(
        color: AppColors.primary,
        backgroundColor: AppColors.surfaceElevated,
        onRefresh: () async {
          ref.invalidate(todayProvider);
          ref.invalidate(pendingProvider);
          ref.invalidate(riskProvider);
          ref.invalidate(latestAiProvider);
        },
        child: ListView(
          padding: const EdgeInsets.only(bottom: Sp.xxl),
          children: [
            const SizedBox(height: Sp.s),

            // ---------- Hero：今日净收益 ----------
            todayAsync.when(
              data: (t) => HeroCard(
                label: '今日净收益（仅计已对冲）',
                value: Fmt.money(t['netProfitCents'] ?? 0, withSign: true),
                valueColor: AppTheme.profitColor(t['netProfitCents'] ?? 0),
                stats: [
                  MiniStat(label: '已对冲', value: '${t['pairCount'] ?? 0} 组'),
                  MiniStat(label: '手续费', value: Fmt.money(t['feeCents'] ?? 0)),
                  MiniStat(
                    label: '未对冲挂单',
                    value: '${pendingAsync.value?.length ?? 0} 笔',
                    color: (pendingAsync.value?.length ?? 0) > 0 ? AppColors.warn : null,
                  ),
                ],
              ),
              loading: () => const Padding(
                padding: EdgeInsets.symmetric(horizontal: Sp.l),
                child: Skeleton(height: 150, radius: Rd.xl),
              ),
              error: (e, _) => Padding(
                padding: const EdgeInsets.all(Sp.l),
                child: Text('统计加载失败：$e',
                    style: const TextStyle(fontSize: Fs.caption, color: AppColors.danger)),
              ),
            ),

            // ---------- AI 分析 ----------
            _AiCard(
              aiAsync: aiAsync,
              expanded: _aiExpanded,
              onToggle: () => setState(() => _aiExpanded = !_aiExpanded),
              onRefresh: () => _refreshAi(_todayKind),
            ),

            // ---------- 风险预警 ----------
            riskAsync.when(
              data: (r) {
                final alerts = (r['alerts'] as List? ?? []);
                if (alerts.isEmpty) return const SizedBox.shrink();
                return Column(
                  children: alerts
                      .take(3)
                      .map((a) => AlertBanner(
                            message: a['message'] ?? '',
                            level: a['level'] == 'danger' ? AlertLevel.danger : AlertLevel.warn,
                          ))
                      .toList(),
                );
              },
              loading: () => const SizedBox.shrink(),
              error: (_, __) => const SizedBox.shrink(),
            ),

            // ---------- 未对冲挂单 ----------
            pendingAsync.when(
              data: (list) {
                if (list.isEmpty) return const SizedBox.shrink();
                final totalQty = list.fold<int>(0, (s, f) => s + (f['remainingQty'] as int? ?? 0));
                return AlertBanner(
                  message: '${list.length} 笔挂单未对冲，合计 $totalQty 股 · 未实现，不计入统计',
                  level: AlertLevel.warn,
                  icon: Icons.pending_actions_rounded,
                );
              },
              loading: () => const SizedBox.shrink(),
              error: (_, __) => const SizedBox.shrink(),
            ),

            // ---------- 主操作 ----------
            Padding(
              padding: const EdgeInsets.fromLTRB(Sp.l, Sp.m, Sp.l, Sp.s),
              child: Row(
                children: [
                  Expanded(
                    flex: 3,
                    child: GradientButton(
                      text: '记一笔',
                      icon: Icons.add_rounded,
                      onPressed: () => Navigator.push(
                        context,
                        MaterialPageRoute(builder: (_) => const TradeEntryPage()),
                      ),
                    ),
                  ),
                  const SizedBox(width: Sp.m),
                  Expanded(
                    flex: 2,
                    child: SizedBox(
                      height: Sz.buttonH,
                      child: OutlinedButton(
                        onPressed: _reviewing ? null : _runReview,
                        child: _reviewing
                            ? const SizedBox(
                                width: 18,
                                height: 18,
                                child: CircularProgressIndicator(strokeWidth: 2),
                              )
                            : const Text('盘后复盘'),
                      ),
                    ),
                  ),
                ],
              ),
            ),

            SectionTitle(
              title: '今日已对冲',
              trailing: '${todayAsync.value?['pairCount'] ?? 0} 组',
            ),
            const _TodayPairs(),
          ],
        ),
      ),
    );
  }
}

/// AI 分析卡
class _AiCard extends StatelessWidget {
  final AsyncValue<dynamic> aiAsync;
  final bool expanded;
  final VoidCallback onToggle;
  final VoidCallback onRefresh;

  const _AiCard({
    required this.aiAsync,
    required this.expanded,
    required this.onToggle,
    required this.onRefresh,
  });

  @override
  Widget build(BuildContext context) {
    return AiCardShell(
      child: aiAsync.when(
        data: (ai) {
          if (ai == null) {
            return Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _header('AI 盘面分析', null),
                const SizedBox(height: Sp.s),
                const Text(
                  '暂无分析记录。9:24 集合竞价、盘中每半小时会自动生成，也可立即生成。',
                  style: TextStyle(fontSize: Fs.caption, color: AppColors.textSecondary, height: 1.5),
                ),
                const SizedBox(height: Sp.m),
                Align(
                  alignment: Alignment.centerLeft,
                  child: TextButton.icon(
                    onPressed: onRefresh,
                    icon: const Icon(Icons.auto_awesome_rounded, size: 15),
                    label: const Text('立即分析'),
                  ),
                ),
              ],
            );
          }
          return Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _header(ai['title'] ?? 'AI 分析', ai['createdAt']),
              const SizedBox(height: Sp.m),
              Text(
                ai['summary'] ?? '',
                style: const TextStyle(fontSize: Fs.body, height: 1.6, color: AppColors.textPrimary),
              ),
              if (expanded) ...[
                const SizedBox(height: Sp.m),
                const Divider(height: 1),
                const SizedBox(height: Sp.m),
                SelectableText(
                  ai['content'] ?? '',
                  style: const TextStyle(fontSize: Fs.caption, height: 1.75, color: AppColors.textSecondary),
                ),
                const SizedBox(height: Sp.m),
                const Text(kDisclaimer,
                    style: TextStyle(fontSize: Fs.micro, color: AppColors.textTertiary, height: 1.5)),
              ],
              const SizedBox(height: Sp.xs),
              Row(
                children: [
                  TextButton(onPressed: onToggle, child: Text(expanded ? '收起' : '查看完整分析')),
                  const Spacer(),
                  TextButton.icon(
                    onPressed: onRefresh,
                    icon: const Icon(Icons.refresh_rounded, size: 15),
                    label: const Text('重新分析'),
                  ),
                ],
              ),
            ],
          );
        },
        loading: () => const Padding(
          padding: EdgeInsets.all(Sp.l),
          child: Center(child: SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2))),
        ),
        error: (e, _) => Text('加载失败：$e',
            style: const TextStyle(fontSize: Fs.caption, color: AppColors.danger)),
      ),
    );
  }

  Widget _header(String title, String? createdAt) {
    return Row(
      children: [
        const Icon(Icons.auto_awesome_rounded, size: 15, color: AppColors.ai),
        const SizedBox(width: Sp.xs),
        Expanded(
          child: Text(
            title,
            style: const TextStyle(fontSize: Fs.body, fontWeight: Fw.semi),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
        ),
        if (createdAt != null)
          Text(Fmt.hm(DateTime.parse(createdAt)),
              style: const TextStyle(fontSize: Fs.micro, color: AppColors.textTertiary)),
      ],
    );
  }
}

/// 今日配对列表
class _TodayPairs extends ConsumerWidget {
  const _TodayPairs();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(pairsTodayProvider);
    return async.when(
      data: (list) {
        if (list.isEmpty) {
          return const EmptyState(
            icon: Icons.swap_horiz_rounded,
            title: '今日还没有对冲成功的做T',
            subtitle: '买卖配对成交后才会结算净收益\n未配对的挂单不计入统计',
          );
        }
        return Column(
          children: list.map((p) {
            final net = p['netProfitCents'] as int? ?? 0;
            return AppCard(
              padding: const EdgeInsets.symmetric(horizontal: Sp.cardPad, vertical: Sp.m),
              child: Row(
                children: [
                  Container(
                    width: 34,
                    height: 34,
                    decoration: BoxDecoration(
                      color: AppTheme.profitSoft(net),
                      borderRadius: BorderRadius.circular(Rd.sm),
                    ),
                    child: Icon(
                      Icons.swap_vert_rounded,
                      size: 16,
                      color: AppTheme.profitColor(net),
                    ),
                  ),
                  const SizedBox(width: Sp.m),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        NumText('${p['code']}  ${Fmt.qty(p['qty'])} 股', size: Fs.body),
                        const SizedBox(height: 3),
                        Text(
                          '${Fmt.price(p['buyPriceMills'])} → ${Fmt.price(p['sellPriceMills'])} · 费用 ${Fmt.money(p['totalFeeCents'])}',
                          style: const TextStyle(fontSize: Fs.micro, color: AppColors.textTertiary),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(width: Sp.s),
                  NumText(
                    Fmt.money(net, withSign: true),
                    size: Fs.title,
                    color: AppTheme.profitColor(net),
                  ),
                ],
              ),
            );
          }).toList(),
        );
      },
      loading: () => const ListSkeleton(count: 3),
      error: (e, _) => Padding(
        padding: const EdgeInsets.all(Sp.l),
        child: Text('加载失败：$e', style: const TextStyle(fontSize: Fs.caption, color: AppColors.danger)),
      ),
    );
  }
}
