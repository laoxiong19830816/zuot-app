import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/format.dart';
import '../core/theme.dart';
import '../core/tokens.dart';
import '../providers.dart';
import '../widgets/ui.dart';
import 'trade_entry_page.dart';

/// 个股看板列表（对应需求 6）
class StockBoardPage extends ConsumerWidget {
  const StockBoardPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(positionsProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('个股看板'),
        actions: [
          IconButton(icon: const Icon(Icons.refresh), onPressed: () => ref.invalidate(positionsProvider)),
        ],
      ),
      body: async.when(
        data: (list) {
          if (list.isEmpty) {
            return const EmptyState(
              icon: Icons.stacked_line_chart_rounded,
              title: '还没有持仓标的',
              subtitle: '先去「我的 → 底仓管理」添加\n之后才能在该票上做T记账',
            );
          }
          return RefreshIndicator(
            color: AppColors.primary,
            backgroundColor: AppColors.surfaceElevated,
            onRefresh: () async => ref.invalidate(positionsProvider),
            child: ListView.builder(
              padding: const EdgeInsets.only(bottom: Sp.xxl),
              itemCount: list.length,
              itemBuilder: (_, i) => _PositionCard(item: list[i]),
            ),
          );
        },
        loading: () => const ListSkeleton(count: 4),
        error: (e, _) => Center(
          child: Text('加载失败：$e', style: const TextStyle(fontSize: Fs.caption, color: AppColors.danger)),
        ),
      ),
    );
  }
}

class _PositionCard extends StatelessWidget {
  final Map<String, dynamic> item;
  const _PositionCard({required this.item});

  @override
  Widget build(BuildContext context) {
    final floatProfit = item['floatProfitCents'];
    final pending = item['pendingCount'] ?? 0;

    final isEtf = item['type'] == 'ETF';
    final realized = item['realizedProfitCents'];

    return AppCard(
      onTap: () => Navigator.push(
        context,
        MaterialPageRoute(builder: (_) => StockDetailPage(code: item['code'], name: item['name'])),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // ---------- 头部：名称 + 标签 ----------
          Row(
            children: [
              Expanded(
                child: Text(
                  '${item['name']}',
                  style: const TextStyle(fontSize: Fs.title, fontWeight: Fw.semi),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              TagChip(
                text: isEtf ? 'ETF' : '股票',
                color: isEtf ? AppColors.ai : AppColors.primary,
              ),
              if (pending > 0) ...[
                const SizedBox(width: Sp.xs),
                TagChip(text: '挂单 $pending', color: AppColors.warn),
              ],
            ],
          ),
          const SizedBox(height: Sp.xs),
          Text(
            '${item['code']} · 底仓 ${item['baseQty']} 股 · 可用 ${item['availableQty']} 股',
            style: const TextStyle(fontSize: Fs.micro, color: AppColors.textTertiary),
          ),

          const SizedBox(height: Sp.m),
          const Divider(height: 1),
          const SizedBox(height: Sp.m),

          // ---------- 三列指标 ----------
          Row(
            children: [
              Expanded(
                child: _Metric(label: '成本价', value: Fmt.price(item['costPriceMills'])),
              ),
              Expanded(
                child: _Metric(
                  label: '做T累计',
                  value: Fmt.money(realized ?? 0, withSign: true),
                  color: AppTheme.profitColor(realized),
                ),
              ),
              Expanded(
                child: _Metric(
                  label: '浮动盈亏',
                  value: floatProfit == null ? '—' : Fmt.money(floatProfit, withSign: true),
                  color: floatProfit == null ? AppColors.textTertiary : AppTheme.profitColor(floatProfit),
                  alignRight: true,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

/// 卡片内的小指标
class _Metric extends StatelessWidget {
  final String label;
  final String value;
  final Color? color;
  final bool alignRight;

  const _Metric({required this.label, required this.value, this.color, this.alignRight = false});

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: alignRight ? CrossAxisAlignment.end : CrossAxisAlignment.start,
      children: [
        NumText(value, size: Fs.title, color: color ?? AppColors.textPrimary),
        const SizedBox(height: 2),
        Text(label, style: const TextStyle(fontSize: Fs.micro, color: AppColors.textTertiary)),
      ],
    );
  }
}

/// 个股看板详情：动态分析 / 交易记录 / 未对冲挂单
class StockDetailPage extends ConsumerStatefulWidget {
  final String code;
  final String name;
  const StockDetailPage({super.key, required this.code, required this.name});

  @override
  ConsumerState<StockDetailPage> createState() => _StockDetailPageState();
}

class _StockDetailPageState extends ConsumerState<StockDetailPage> with SingleTickerProviderStateMixin {
  late TabController _tab;

  @override
  void initState() {
    super.initState();
    _tab = TabController(length: 3, vsync: this);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text('${widget.name} ${widget.code}'),
        bottom: TabBar(
          controller: _tab,
          tabs: const [Tab(text: '动态分析'), Tab(text: '交易记录'), Tab(text: '未对冲挂单')],
        ),
      ),
      body: TabBarView(
        controller: _tab,
        children: [
          _AnalysisTab(code: widget.code),
          _TradesTab(code: widget.code),
          _PendingTab(code: widget.code),
        ],
      ),
      bottomNavigationBar: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(Sp.l, Sp.s, Sp.l, Sp.m),
          child: GradientButton(
            text: '对该票记一笔',
            icon: Icons.add_rounded,
            onPressed: () => Navigator.push(
              context,
              MaterialPageRoute(builder: (_) => TradeEntryPage(presetCode: widget.code)),
            ),
          ),
        ),
      ),
    );
  }
}

/// Tab 1 · 动态分析
class _AnalysisTab extends ConsumerWidget {
  final String code;
  const _AnalysisTab({required this.code});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(aiListProvider(code));
    return async.when(
      data: (list) {
        if (list.isEmpty) {
          return const EmptyState(
            icon: Icons.auto_awesome_rounded,
            title: '暂无分析记录',
            subtitle: '盘中每半小时自动生成\n也可在「今日」页手动触发',
          );
        }
        return ListView.builder(
          padding: const EdgeInsets.only(bottom: Sp.xxl, top: Sp.s),
          itemCount: list.length,
          itemBuilder: (_, i) {
            final a = list[i];
            return AppCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Container(
                        width: 3,
                        height: 12,
                        decoration: BoxDecoration(
                          color: AppColors.ai,
                          borderRadius: BorderRadius.circular(2),
                        ),
                      ),
                      const SizedBox(width: Sp.s),
                      Expanded(
                        child: Text(
                          a['title'] ?? '',
                          style: const TextStyle(fontSize: Fs.body, fontWeight: Fw.semi),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      Text(Fmt.mdHm(DateTime.parse(a['createdAt'])),
                          style: const TextStyle(fontSize: Fs.micro, color: AppColors.textTertiary)),
                    ],
                  ),
                  const SizedBox(height: Sp.m),
                  Text(
                    a['summary'] ?? '',
                    style: const TextStyle(fontSize: Fs.caption, height: 1.7, color: AppColors.textSecondary),
                  ),
                ],
              ),
            );
          },
        );
      },
      loading: () => const ListSkeleton(count: 3),
      error: (e, _) => Center(
        child: Text('加载失败：$e', style: const TextStyle(fontSize: Fs.caption, color: AppColors.danger)),
      ),
    );
  }
}

/// Tab 2 · 交易记录（含对冲配对）
class _TradesTab extends ConsumerWidget {
  final String code;
  const _TradesTab({required this.code});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final flowsAsync = ref.watch(tradesProvider(code));
    final pairsAsync = ref.watch(pairsProvider(code));

    return DefaultTabController(
      length: 2,
      child: Column(
        children: [
          const TabBar(tabs: [Tab(text: '流水'), Tab(text: '已对冲')]),
          Expanded(
            child: TabBarView(
              children: [
                flowsAsync.when(
                  data: (list) {
                if (list.isEmpty) {
                  return const EmptyState(icon: Icons.receipt_long_rounded, title: '还没有交易流水');
                }
                return ListView.builder(
                  padding: const EdgeInsets.only(bottom: Sp.xxl),
                  itemCount: list.length,
                  itemBuilder: (_, i) {
                    final f = list[i];
                    final isBuy = f['side'] == 'BUY';
                    final remain = f['remainingQty'] as int? ?? 0;
                    return ListTile(
                      dense: true,
                      leading: Container(
                        width: 30,
                        height: 30,
                        decoration: BoxDecoration(
                          color: (isBuy ? AppColors.up : AppColors.down).withOpacity(0.14),
                          borderRadius: BorderRadius.circular(Rd.sm),
                        ),
                        child: Icon(
                          isBuy ? Icons.arrow_upward_rounded : Icons.arrow_downward_rounded,
                          size: 15,
                          color: isBuy ? AppColors.up : AppColors.down,
                        ),
                      ),
                      title: Text('${isBuy ? '买入' : '卖出'} ${Fmt.price(f['priceMills'])} × ${Fmt.qty(f['qty'])}',
                          style: const TextStyle(fontSize: Fs.body)),
                      subtitle: Text(
                        '${Fmt.mdHm(DateTime.parse(f['tradedAt']))} · 费用 ${Fmt.money(f['totalFeeCents'])}'
                        '${remain > 0 ? ' · 未对冲 $remain 股' : ''}',
                        style: const TextStyle(fontSize: Fs.micro, color: AppColors.textTertiary),
                      ),
                    );
                  },
                );
              },
                  loading: () => const ListSkeleton(count: 4),
                  error: (e, _) => Center(child: Text('$e')),
                ),
                pairsAsync.when(
                  data: (list) {
                    if (list.isEmpty) {
                      return const EmptyState(
                        icon: Icons.swap_horiz_rounded,
                        title: '还没有已对冲的做T',
                        subtitle: '一买一卖配对成功后才结算净收益',
                      );
                    }
                    return ListView.builder(
                      padding: const EdgeInsets.only(bottom: Sp.xxl),
                      itemCount: list.length,
                      itemBuilder: (_, i) {
                        final p = list[i];
                        final net = p['netProfitCents'] as int? ?? 0;
                        return ListTile(
                          dense: true,
                          title: NumText(
                            '${Fmt.qty(p['qty'])} 股  ${Fmt.price(p['buyPriceMills'])} → ${Fmt.price(p['sellPriceMills'])}',
                            size: Fs.body,
                            weight: Fw.medium,
                          ),
                          subtitle: Text(
                            '对冲日 ${Fmt.md(DateTime.parse(p['hedgeDate']))} · 费用 ${Fmt.money(p['totalFeeCents'])}',
                            style: const TextStyle(fontSize: Fs.micro, color: AppColors.textTertiary),
                          ),
                          trailing: NumText(
                            Fmt.money(net, withSign: true),
                            size: Fs.title,
                            color: AppTheme.profitColor(net),
                          ),
                        );
                      },
                    );
                  },
                  loading: () => const ListSkeleton(count: 4),
                  error: (e, _) => Center(child: Text('$e')),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// Tab 3 · 未对冲挂单
class _PendingTab extends ConsumerWidget {
  final String code;
  const _PendingTab({required this.code});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(pendingByCodeProvider(code));
    return async.when(
      data: (list) {
        if (list.isEmpty) {
          return const EmptyState(
            icon: Icons.check_circle_outline_rounded,
            title: '没有未对冲挂单',
            subtitle: '所有做T单都已配对结算',
          );
        }
        return ListView.builder(
          padding: const EdgeInsets.only(bottom: Sp.xxl, top: Sp.s),
          itemCount: list.length,
          itemBuilder: (_, i) {
            final f = list[i];
            final isBuy = f['side'] == 'BUY';
            final unrealized = f['unrealizedCents'];
            final overdue = f['overdue'] == true;
            final sideColor = isBuy ? AppColors.up : AppColors.down;
            return AppCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      TagChip(text: isBuy ? '买入' : '卖出', color: sideColor),
                      if (overdue) ...[
                        const SizedBox(width: Sp.xs),
                        const TagChip(text: '已超期', color: AppColors.danger, icon: Icons.priority_high_rounded),
                      ],
                      const Spacer(),
                      Text('已等 ${f['waitingDays']} 天',
                          style: const TextStyle(fontSize: Fs.micro, color: AppColors.textTertiary)),
                    ],
                  ),
                  const SizedBox(height: Sp.m),
                  NumText(
                    '${Fmt.price(f['priceMills'])} × ${Fmt.qty(f['remainingQty'])} 股',
                    size: Fs.title,
                  ),
                  const SizedBox(height: Sp.xs),
                  Text(
                    '挂于 ${Fmt.md(DateTime.parse(f['tradedAt']))}'
                    '${unrealized != null ? ' · 按现价估算 ${Fmt.money(unrealized, withSign: true)}（未实现）' : ''}',
                    style: const TextStyle(fontSize: Fs.micro, color: AppColors.textTertiary, height: 1.5),
                  ),
                  const SizedBox(height: Sp.m),
                  SizedBox(
                    width: double.infinity,
                    height: Sz.smallButtonH,
                    child: OutlinedButton(
                      onPressed: () => Navigator.push(
                        context,
                        MaterialPageRoute(builder: (_) => TradeEntryPage(presetCode: code)),
                      ),
                      child: const Text('去对冲', style: TextStyle(fontSize: Fs.caption)),
                    ),
                  ),
                ],
              ),
            );
          },
        );
      },
      loading: () => const ListSkeleton(count: 3),
      error: (e, _) => Center(child: Text('$e')),
    );
  }
}
