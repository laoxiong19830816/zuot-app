import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/api.dart';
import '../core/format.dart';
import '../core/theme.dart';
import '../providers.dart';

/// 统计看板：总览 / 按标的 / AI 命中率
class StatsPage extends ConsumerWidget {
  const StatsPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return DefaultTabController(
      length: 3,
      child: Scaffold(
        appBar: AppBar(
          title: const Text('统计'),
          bottom: const TabBar(tabs: [Tab(text: '总览'), Tab(text: '按标的'), Tab(text: 'AI 命中率')]),
        ),
        body: const TabBarView(
          children: [_OverviewTab(), _ByCodeTab(), _HitRateTab()],
        ),
      ),
    );
  }
}

class _OverviewTab extends ConsumerWidget {
  const _OverviewTab();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(overviewProvider);
    return async.when(
      data: (o) => ListView(
        padding: const EdgeInsets.all(12),
        children: [
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('累计净收益（仅对冲成功）', style: TextStyle(fontSize: 12, color: AppColors.textSecondary)),
                  const SizedBox(height: 6),
                  Text(
                    Fmt.money(o['netProfitCents'] ?? 0, withSign: true),
                    style: TextStyle(fontSize: 28, fontWeight: FontWeight.w700, color: AppTheme.profitColor(o['netProfitCents'] ?? 0)),
                  ),
                ],
              ),
            ),
          ),
          _Grid(stats: [
            ('对冲次数', '${o['pairCount'] ?? 0}'),
            ('胜率', Fmt.pct((o['winRate'] ?? 0).toDouble())),
            ('盈亏比', (o['profitLossRatio'] ?? 0) == double.infinity ? '∞' : (o['profitLossRatio'] ?? 0).toStringAsFixed(2)),
            ('累计费用', Fmt.money(o['feeCents'] ?? 0)),
            ('费用/毛利', Fmt.pct((o['feeToGrossRatio'] ?? 0).toDouble())),
            ('最大连亏', '${o['maxLossStreak'] ?? 0} 次'),
          ]),
          const SizedBox(height: 8),
          _DailyChart(),
        ],
      ),
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (e, _) => Center(child: Text('加载失败：$e')),
    );
  }
}

class _Grid extends StatelessWidget {
  final List<(String, String)> stats;
  const _Grid({required this.stats});

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: GridView.count(
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          crossAxisCount: 3,
          childAspectRatio: 1.5,
          children: stats
              .map((s) => Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Text(s.$2, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600)),
                      const SizedBox(height: 4),
                      Text(s.$1, style: const TextStyle(fontSize: 11, color: AppColors.textSecondary)),
                    ],
                  ))
              .toList(),
        ),
      ),
    );
  }
}

/// 近 30 日净收益柱状图（按对冲日归属）
class _DailyChart extends ConsumerWidget {
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(dailyProvider);
    return async.when(
      data: (list) {
        if (list.isEmpty) return const SizedBox.shrink();
        final spots = list.asMap().entries.map((e) {
          final v = (e.value['netProfitCents'] ?? 0) / 100.0;
          return BarChartGroupData(x: e.key, barRods: [
            BarChartRodData(toY: v, color: v >= 0 ? AppColors.up : AppColors.down, width: 8, borderRadius: BorderRadius.circular(2)),
          ]);
        }).toList();

        return Card(
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('近 30 日净收益（元）', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600)),
                const SizedBox(height: 14),
                SizedBox(
                  height: 180,
                  child: BarChart(
                    BarChartData(
                      barGroups: spots,
                      gridData: const FlGridData(show: false),
                      borderData: FlBorderData(show: false),
                      titlesData: const FlTitlesData(
                        left: AxisTitles(sideTitles: SideTitles(showTitles: true, reservedSize: 40)),
                        right: AxisTitles(sideTitles: SideTitles(showTitles: false)),
                        top: AxisTitles(sideTitles: SideTitles(showTitles: false)),
                        bottom: AxisTitles(sideTitles: SideTitles(showTitles: false)),
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
        );
      },
      loading: () => const SizedBox.shrink(),
      error: (_, __) => const SizedBox.shrink(),
    );
  }
}

class _ByCodeTab extends ConsumerWidget {
  const _ByCodeTab();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(byCodeProvider);
    return async.when(
      data: (list) => ListView.builder(
        padding: const EdgeInsets.all(12),
        itemCount: list.length,
        itemBuilder: (_, i) {
          final it = list[i];
          return Card(
            child: ListTile(
              title: Text('${it['name']} ${it['code']}'),
              subtitle: Text('${it['pairCount']} 组对冲  胜率 ${Fmt.pct((it['winRate'] ?? 0).toDouble())}  '
                  '成本 ${Fmt.price(it['costPriceMills'])}（初始 ${Fmt.price(it['initialCostMills'])}）'),
              trailing: Text(
                Fmt.money(it['netProfitCents'], withSign: true),
                style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: AppTheme.profitColor(it['netProfitCents'])),
              ),
            ),
          );
        },
      ),
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (e, _) => Center(child: Text('$e')),
    );
  }
}

/// AI 命中率：防止被 AI 忽悠的关键功能
class _HitRateTab extends ConsumerWidget {
  const _HitRateTab();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(hitRateProvider);
    return async.when(
      data: (h) => ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Card(
            child: Padding(
              padding: const EdgeInsets.all(20),
              child: Column(
                children: [
                  const Text('AI 提示命中率', style: TextStyle(fontSize: 12, color: AppColors.textSecondary)),
                  const SizedBox(height: 8),
                  Text(Fmt.pct((h['rate'] ?? 0).toDouble(), digits: 1),
                      style: const TextStyle(fontSize: 32, fontWeight: FontWeight.w700)),
                  const SizedBox(height: 6),
                  Text('样本 ${h['sampleSize'] ?? 0} 次（命中 ${h['hit']} / 未中 ${h['miss']} / 无方向 ${h['flat']}）',
                      style: const TextStyle(fontSize: 12, color: AppColors.textSecondary)),
                ],
              ),
            ),
          ),
          const SizedBox(height: 12),
          const Card(
            child: Padding(
              padding: EdgeInsets.all(14),
              child: Text(
                '命中率说明：系统会把每次盘中 AI 提示的方向（偏多/偏空）与次日实际涨跌对照打分。'
                '样本少于 30 次时参考意义有限。\n\n'
                '如果长期命中率低于 50%，说明该模型在这个场景下的提示不值得采信，应当只把它当作信息整理工具，'
                '而不是决策依据。',
                style: TextStyle(fontSize: 13, height: 1.6),
              ),
            ),
          ),
        ],
      ),
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (e, _) => Center(child: Text('$e')),
    );
  }
}
