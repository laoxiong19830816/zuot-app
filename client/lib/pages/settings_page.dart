import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/api.dart';
import '../core/format.dart';
import '../core/theme.dart';
import '../providers.dart';
import 'admin_page.dart';
import 'position_import_page.dart';

/// 我的 / 设置页
class SettingsPage extends ConsumerStatefulWidget {
  const SettingsPage({super.key});

  @override
  ConsumerState<SettingsPage> createState() => _SettingsPageState();
}

class _SettingsPageState extends ConsumerState<SettingsPage> {
  final _serverCtrl = TextEditingController();
  Map<String, dynamic>? _usage;

  @override
  void initState() {
    super.initState();
    _serverCtrl.text = ref.read(apiProvider).baseUrl;
    _loadUsage();
  }

  Future<void> _loadUsage() async {
    try {
      final u = await ref.read(apiProvider).aiUsage();
      if (mounted) setState(() => _usage = Map<String, dynamic>.from(u));
    } catch (_) {}
  }

  Future<void> _editNumber(String title, String key, num current, {bool isPercent = false}) async {
    final ctrl = TextEditingController(text: current.toString());
    final value = await showDialog<num>(
      context: context,
      builder: (_) => AlertDialog(
        title: Text(title),
        content: TextField(
          controller: ctrl,
          keyboardType: const TextInputType.numberWithOptions(decimal: true),
          decoration: InputDecoration(hintText: isPercent ? '如 0.000074 表示万0.74' : '数值'),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('取消')),
          TextButton(onPressed: () => Navigator.pop(context, num.tryParse(ctrl.text)), child: const Text('保存')),
        ],
      ),
    );
    if (value == null) return;
    try {
      await ref.read(apiProvider).updateSettings({key: value is int ? value.toDouble() : value});
      await ref.read(authProvider.notifier).refresh();
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('已保存')));
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('保存失败：$e')));
    }
  }

  @override
  Widget build(BuildContext context) {
    final auth = ref.watch(authProvider);
    final s = auth.settings ?? {};

    return Scaffold(
      appBar: AppBar(title: const Text('我的')),
      body: ListView(
        padding: const EdgeInsets.all(12),
        children: [
          // 账号
          Card(
            child: ListTile(
              leading: CircleAvatar(
                backgroundColor: AppColors.primary.withOpacity(0.2),
                child: const Icon(Icons.person, color: AppColors.primary),
              ),
              title: Text(auth.user?['nickname'] ?? auth.user?['email'] ?? ''),
              subtitle: Text('${auth.user?['email'] ?? ''}   ${auth.isAdmin ? '管理员' : '普通用户'}'),
            ),
          ),

          // AI 额度
          if (_usage != null)
            Card(
              child: Padding(
                padding: const EdgeInsets.all(14),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('AI 调用额度', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600)),
                    const SizedBox(height: 8),
                    Text('今日已用 ${_usage!['dayUsed'] ?? 0} / ${_usage!['dailyLimit'] ?? '-'}    '
                        '本月已用 ${_usage!['monthUsed'] ?? 0} / ${_usage!['monthlyLimit'] ?? '-'}',
                        style: const TextStyle(fontSize: 12.5, color: AppColors.textSecondary)),
                  ],
                ),
              ),
            ),

          // 持仓导入
          Card(
            child: ListTile(
              leading: const Icon(Icons.playlist_add_rounded, color: AppColors.primary),
              title: const Text('批量导入持仓'),
              subtitle: const Text('粘贴券商持仓文本，一次录入多只票 / 另一个账户'),
              trailing: const Icon(Icons.chevron_right),
              onTap: () => Navigator.push(
                context,
                MaterialPageRoute(builder: (_) => const PositionImportPage()),
              ),
            ),
          ),

          // 费率
          _Section(
            title: '费率设置（股票）',
            children: [
              _Item('佣金率', '${(s['stockCommissionRate'] ?? 0) * 10000}‱（万${((s['stockCommissionRate'] ?? 0) * 10000).toStringAsFixed(2)}）',
                  () => _editNumber('股票佣金率', 'stockCommissionRate', s['stockCommissionRate'] ?? 0.000074, isPercent: true)),
              _Item('最低佣金', '${Fmt.yuan(s['stockMinCommissionCents'] ?? 0)}（0 = 免五）',
                  () => _editNumber('最低佣金（元）', 'stockMinCommissionCents', (s['stockMinCommissionCents'] ?? 0) / 100)),
              _Item('印花税（卖出）', '${(s['stampTaxRate'] ?? 0) * 100}%', () => null),
              _Item('过户费（双向）', '${(s['transferFeeRate'] ?? 0) * 100}%', () => null),
            ],
          ),
          _Section(
            title: '费率设置（ETF · 免印花税免过户费）',
            children: [
              _Item('佣金率', '${(s['etfCommissionRate'] ?? 0) * 10000}‱（万${((s['etfCommissionRate'] ?? 0) * 10000).toStringAsFixed(2)}）',
                  () => _editNumber('ETF 佣金率', 'etfCommissionRate', s['etfCommissionRate'] ?? 0.00005, isPercent: true)),
              _Item('最低佣金', Fmt.yuan(s['etfMinCommissionCents'] ?? 0),
                  () => _editNumber('ETF 最低佣金（元）', 'etfMinCommissionCents', (s['etfMinCommissionCents'] ?? 0) / 100)),
            ],
          ),

          // 合规口径开关
          Card(
            child: SwitchListTile(
              title: const Text('合规口径对比'),
              subtitle: const Text('打开后按「不足 5 元按 5 元」计算费用，用于对照监管口径下的成本'),
              value: s['complianceMode'] == true,
              onChanged: (v) async {
                await ref.read(apiProvider).updateSettings({'complianceMode': v});
                await ref.read(authProvider.notifier).refresh();
              },
            ),
          ),

          // 风险规则
          _Section(
            title: '风险规则',
            children: [
              _Item('当日最多做T次数', '${s['maxTradePerDay'] ?? 6}',
                  () => _editNumber('当日最多做T次数', 'maxTradePerDay', s['maxTradePerDay'] ?? 6)),
              _Item('连亏冷静次数', '${s['maxLossStreak'] ?? 3}',
                  () => _editNumber('连亏几次触发冷静', 'maxLossStreak', s['maxLossStreak'] ?? 3)),
              _Item('单笔止损线', Fmt.money(s['singleStopLossCents'] ?? -20000),
                  () => _editNumber('单笔止损线（元，负数）', 'singleStopLossCents', (s['singleStopLossCents'] ?? -20000) / 100)),
              _Item('挂单最长等待天数', '${s['pendingMaxDays'] ?? 5}',
                  () => _editNumber('挂单最长等待天数', 'pendingMaxDays', s['pendingMaxDays'] ?? 5)),
              _Item('单票仓位上限', '${s['positionLimitPct'] ?? 40}%',
                  () => _editNumber('单票仓位上限（%）', 'positionLimitPct', s['positionLimitPct'] ?? 40)),
            ],
          ),

          // 服务器
          Card(
            child: Padding(
              padding: const EdgeInsets.all(14),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('服务器地址', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600)),
                  const SizedBox(height: 10),
                  TextField(controller: _serverCtrl, decoration: const InputDecoration(hintText: 'http://x.x.x.x:8080')),
                  const SizedBox(height: 8),
                  SizedBox(
                    width: double.infinity,
                    child: OutlinedButton(
                      onPressed: () {
                        ref.read(apiProvider).baseUrl = _serverCtrl.text.trim();
                        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('已保存')));
                      },
                      child: const Text('保存并生效'),
                    ),
                  ),
                ],
              ),
            ),
          ),

          // 管理后台
          if (auth.isAdmin)
            Card(
              child: ListTile(
                leading: const Icon(Icons.admin_panel_settings, color: AppColors.accent),
                title: const Text('用户管理后台'),
                trailing: const Icon(Icons.chevron_right),
                onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const AdminPage())),
              ),
            ),

          const SizedBox(height: 8),
          Card(
            child: ListTile(
              leading: const Icon(Icons.logout, color: AppColors.danger),
              title: const Text('退出登录'),
              onTap: () => ref.read(authProvider.notifier).logout(),
            ),
          ),

          const SizedBox(height: 16),
          const Padding(
            padding: EdgeInsets.symmetric(horizontal: 16),
            child: Text(kDisclaimer, style: TextStyle(fontSize: 11, color: AppColors.textSecondary, height: 1.5)),
          ),
          const SizedBox(height: 20),
        ],
      ),
    );
  }
}

class _Section extends StatelessWidget {
  final String title;
  final List<Widget> children;
  const _Section({required this.title, required this.children});

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 6),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(14, 10, 14, 4),
              child: Text(title, style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600, color: AppColors.textSecondary)),
            ),
            ...children,
          ],
        ),
      ),
    );
  }
}

class _Item extends StatelessWidget {
  final String label;
  final String value;
  final VoidCallback? onTap;
  const _Item(this.label, this.value, this.onTap);

  @override
  Widget build(BuildContext context) {
    return ListTile(
      dense: true,
      title: Text(label, style: const TextStyle(fontSize: 13)),
      trailing: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(value, style: const TextStyle(fontSize: 12.5, color: AppColors.textSecondary)),
          if (onTap != null) const Icon(Icons.chevron_right, size: 16, color: AppColors.textSecondary),
        ],
      ),
      onTap: onTap,
    );
  }
}
