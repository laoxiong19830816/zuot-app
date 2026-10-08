import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/api.dart';
import '../core/format.dart';
import '../core/theme.dart';
import '../core/tokens.dart';
import '../providers.dart';
import '../widgets/ui.dart';

/// 管理员后台：用户管理 / 权限 / 邀请码 / 系统概览
class AdminPage extends ConsumerStatefulWidget {
  const AdminPage({super.key});

  @override
  ConsumerState<AdminPage> createState() => _AdminPageState();
}

class _AdminPageState extends ConsumerState<AdminPage> with SingleTickerProviderStateMixin {
  late TabController _tab;

  @override
  void initState() {
    super.initState();
    _tab = TabController(length: 4, vsync: this);
  }

  @override
  void dispose() {
    _tab.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('用户管理后台'),
        bottom: TabBar(
          controller: _tab,
          tabs: const [
            Tab(text: '用户'),
            Tab(text: '邀请码'),
            Tab(text: '审计日志'),
            Tab(text: '系统概览'),
          ],
        ),
      ),
      body: TabBarView(
        controller: _tab,
        children: const [_UsersTab(), _InviteTab(), _AuditTab(), _OverviewTab()],
      ),
    );
  }
}

// ==================================================================
// 用户管理
// ==================================================================
class _UsersTab extends ConsumerWidget {
  const _UsersTab();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(adminUsersProvider);

    void toast(String msg) =>
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));

    Future<void> run(Future<void> Function() fn, String okMsg) async {
      try {
        await fn();
        ref.invalidate(adminUsersProvider);
        if (context.mounted) toast(okMsg);
      } catch (e) {
        if (context.mounted) toast(_errText(e));
      }
    }

    return async.when(
      data: (list) {
        if (list.isEmpty) {
          return const EmptyState(
            icon: Icons.people_outline_rounded,
            title: '还没有用户',
            subtitle: '去「邀请码」生成邀请码，让别人注册',
          );
        }
        return ListView.builder(
          padding: const EdgeInsets.only(top: Sp.xs, bottom: Sp.xxl),
          itemCount: list.length,
          itemBuilder: (_, i) {
            final u = list[i];
            final status = u['status'];
            final isAdmin = u['role'] == 'ADMIN';
            return AppCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Text(u['email'] ?? '',
                            style: const TextStyle(fontSize: Fs.body, fontWeight: Fw.semi)),
                      ),
                      TagChip(
                        text: status == 'ACTIVE' ? '正常' : (status == 'SUSPENDED' ? '已停用' : '只读'),
                        color: status == 'ACTIVE' ? AppColors.up : AppColors.danger,
                      ),
                      const SizedBox(width: Sp.xs),
                      TagChip(text: isAdmin ? '管理员' : '普通', color: AppColors.primary),
                    ],
                  ),
                  const SizedBox(height: Sp.s),
                  Text(
                    '标的 ${u['_count']?['positions'] ?? 0}  流水 ${u['_count']?['flows'] ?? 0}  '
                    '对冲 ${u['_count']?['pairs'] ?? 0}  本月AI ${u['monthAiUsage'] ?? 0} 次'
                    '${u['inviteCodeUsed'] != null ? '\n邀请码 ${u['inviteCodeUsed']}' : ''}',
                    style: const TextStyle(fontSize: Fs.micro, color: AppColors.textTertiary, height: 1.5),
                  ),
                  const SizedBox(height: Sp.m),
                  Wrap(
                    spacing: Sp.s,
                    runSpacing: Sp.xs,
                    children: [
                      _Action(status == 'SUSPENDED' ? '启用' : '停用', () => run(
                            () => ref
                                .read(apiProvider)
                                .setUserStatus(u['id'], status == 'SUSPENDED' ? 'ACTIVE' : 'SUSPENDED',
                                    reason: '管理员操作'),
                            status == 'SUSPENDED' ? '已启用' : '已停用',
                          )),
                      _Action(isAdmin ? '取消管理员' : '设为管理员',
                          () => run(() => ref.read(apiProvider).setUserRole(u['id'], isAdmin ? 'USER' : 'ADMIN'),
                              isAdmin ? '已取消管理员' : '已设为管理员')),
                      _Action('改额度', () => _editQuota(context, ref, u)),
                      _Action('重置密码', () => _resetPassword(context, ref, u['id'])),
                    ],
                  ),
                ],
              ),
            );
          },
        );
      },
      loading: () => const ListSkeleton(count: 4),
      error: (e, _) => Center(child: Text('加载失败：$e')),
    );
  }

  Future<void> _editQuota(BuildContext context, WidgetRef ref, Map<String, dynamic> u) async {
    final dailyCtrl = TextEditingController(text: '${u['aiDailyLimit'] ?? 40}');
    final monthCtrl = TextEditingController(text: '${u['aiMonthlyLimit'] ?? 800}');
    final okGo = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        title: const Text('调整 AI 额度'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: dailyCtrl,
              keyboardType: TextInputType.number,
              decoration: const InputDecoration(labelText: '每日上限（次）'),
            ),
            TextField(
              controller: monthCtrl,
              keyboardType: TextInputType.number,
              decoration: const InputDecoration(labelText: '每月上限（次）'),
            ),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('取消')),
          FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('保存')),
        ],
      ),
    );
    if (okGo != true) return;
    try {
      await ref.read(apiProvider).setUserQuota(
            u['id'],
            daily: int.tryParse(dailyCtrl.text),
            monthly: int.tryParse(monthCtrl.text),
          );
      ref.invalidate(adminUsersProvider);
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('额度已更新')));
      }
    } catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(_errText(e))));
      }
    }
  }

  Future<void> _resetPassword(BuildContext context, WidgetRef ref, String id) async {
    final ctrl = TextEditingController();
    final okGo = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        title: const Text('重置密码'),
        content: TextField(
          controller: ctrl,
          obscureText: true,
          decoration: const InputDecoration(labelText: '新密码（至少 8 位）'),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('取消')),
          FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('重置')),
        ],
      ),
    );
    if (okGo != true || ctrl.text.length < 8) return;
    try {
      await ref.read(apiProvider).post('/api/admin/users/$id/reset-password', data: {'newPassword': ctrl.text});
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('密码已重置')));
      }
    } catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(_errText(e))));
      }
    }
  }
}

// ==================================================================
// 邀请码管理
// ==================================================================
class _InviteTab extends ConsumerStatefulWidget {
  const _InviteTab();

  @override
  ConsumerState<_InviteTab> createState() => _InviteTabState();
}

class _InviteTabState extends ConsumerState<_InviteTab> {
  String _filter = 'ALL'; // ALL | USABLE | USED | DISABLED

  void _toast(String msg) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));
  }

  Future<void> _reload() async {
    ref.invalidate(inviteCodesProvider);
  }

  @override
  Widget build(BuildContext context) {
    final async = ref.watch(inviteCodesProvider);

    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(Sp.l, Sp.m, Sp.l, Sp.xs),
          child: Row(
            children: [
              Expanded(
                child: GradientButton(
                  text: '生成邀请码',
                  icon: Icons.add_rounded,
                  onPressed: () => _showCreateSheet(context),
                ),
              ),
            ],
          ),
        ),
        // 筛选
        SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          padding: const EdgeInsets.symmetric(horizontal: Sp.l, vertical: Sp.xs),
          child: Row(
            children: [
              for (final f in [
                ('ALL', '全部'),
                ('USABLE', '可用'),
                ('USED', '已用完'),
                ('DISABLED', '已停用'),
              ])
                Padding(
                  padding: const EdgeInsets.only(right: Sp.xs),
                  child: FilterChip(
                    label: Text(f.$2),
                    selected: _filter == f.$1,
                    onSelected: (_) => setState(() => _filter = f.$1),
                  ),
                ),
            ],
          ),
        ),
        Expanded(
          child: async.when(
            data: (listAll) {
              final list = _applyFilter(listAll);
              if (list.isEmpty) {
                return EmptyState(
                  icon: Icons.card_giftcard_rounded,
                  title: listAll.isEmpty ? '还没有邀请码' : '该筛选下没有邀请码',
                  subtitle: listAll.isEmpty ? '点上方按钮生成，发给对方即可注册' : null,
                  actionText: '生成一个',
                  onAction: () => _showCreateSheet(context),
                );
              }
              return RefreshIndicator(
                onRefresh: _reload,
                child: ListView.builder(
                  padding: const EdgeInsets.only(bottom: Sp.xxl),
                  itemCount: list.length,
                  itemBuilder: (_, i) => _InviteCard(
                    item: list[i],
                    onCopy: () async {
                      await Clipboard.setData(ClipboardData(text: list[i]['code'] ?? ''));
                      _toast('邀请码已复制：${list[i]['code']}');
                    },
                    onToggle: () async {
                      try {
                        await ref.read(apiProvider).toggleInviteCode(list[i]['id']);
                        await _reload();
                      } catch (e) {
                        _toast(_errText(e));
                      }
                    },
                    onEdit: () => _showEditSheet(context, list[i]),
                    onDelete: () => _confirmDelete(context, list[i]),
                  ),
                ),
              );
            },
            loading: () => const ListSkeleton(count: 5),
            error: (e, _) => Center(child: Text('加载失败：$e')),
          ),
        ),
      ],
    );
  }

  List<dynamic> _applyFilter(List<dynamic> list) {
    switch (_filter) {
      case 'USABLE':
        return list.where((c) => c['usable'] == true).toList();
      case 'USED':
        return list.where((c) => (c['usedCount'] ?? 0) >= (c['maxUses'] ?? 1)).toList();
      case 'DISABLED':
        return list.where((c) => c['disabled'] == true).toList();
      default:
        return list;
    }
  }

  Future<void> _confirmDelete(BuildContext context, Map<String, dynamic> item) async {
    final yes = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        title: const Text('删除邀请码'),
        content: Text('确认删除 ${item['code']} 吗？已使用的邀请码无法删除（请改用「停用」）。'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('取消')),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: AppColors.danger),
            onPressed: () => Navigator.pop(context, true),
            child: const Text('删除'),
          ),
        ],
      ),
    );
    if (yes != true) return;
    try {
      await ref.read(apiProvider).deleteInviteCode(item['id']);
      await _reload();
      _toast('已删除');
    } catch (e) {
      _toast(_errText(e));
    }
  }

  Future<void> _showEditSheet(BuildContext context, Map<String, dynamic> item) async {
    final noteCtrl = TextEditingController(text: item['note'] ?? '');
    final maxCtrl = TextEditingController(text: '${item['maxUses'] ?? 1}');
    final daysCtrl = TextEditingController();

    await showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (_) => Padding(
        padding: EdgeInsets.only(
          left: Sp.l,
          right: Sp.l,
          top: Sp.s,
          bottom: MediaQuery.of(context).viewInsets.bottom + Sp.l,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('编辑邀请码 ${item['code']}',
                style: const TextStyle(fontSize: Fs.title, fontWeight: Fw.bold)),
            const SizedBox(height: Sp.m),
            TextField(
              controller: noteCtrl,
              decoration: const InputDecoration(labelText: '备注（给谁用的）', prefixIcon: Icon(Icons.note_outlined)),
            ),
            const SizedBox(height: Sp.m),
            TextField(
              controller: maxCtrl,
              keyboardType: TextInputType.number,
              decoration: const InputDecoration(labelText: '可用次数', prefixIcon: Icon(Icons.repeat_rounded)),
            ),
            const SizedBox(height: Sp.m),
            TextField(
              controller: daysCtrl,
              keyboardType: TextInputType.number,
              decoration: const InputDecoration(
                labelText: '续期天数（留空不变，0 = 长期有效）',
                prefixIcon: Icon(Icons.event_outlined),
              ),
            ),
            const SizedBox(height: Sp.l),
            GradientButton(
              text: '保存',
              onPressed: () async {
                final days = int.tryParse(daysCtrl.text.trim());
                try {
                  await ref.read(apiProvider).updateInviteCode(
                        item['id'],
                        note: noteCtrl.text,
                        maxUses: int.tryParse(maxCtrl.text.trim()),
                        days: days,
                      );
                  await _reload();
                  if (context.mounted) Navigator.pop(context);
                  _toast('已保存');
                } catch (e) {
                  _toast(_errText(e));
                }
              },
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _showCreateSheet(BuildContext context) async {
    final countCtrl = TextEditingController(text: '1');
    final maxCtrl = TextEditingController(text: '1');
    final daysCtrl = TextEditingController(text: '30');
    final noteCtrl = TextEditingController();
    List<dynamic> created = [];

    await showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (sheetCtx) => StatefulBuilder(
        builder: (sheetCtx, setSheet) => Padding(
          padding: EdgeInsets.only(
            left: Sp.l,
            right: Sp.l,
            top: Sp.s,
            bottom: MediaQuery.of(sheetCtx).viewInsets.bottom + Sp.l,
          ),
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const Text('生成邀请码', style: TextStyle(fontSize: Fs.title, fontWeight: Fw.bold)),
                const SizedBox(height: Sp.s),
                const Text(
                  '对方注册时填写邀请码才能开通账号。用不掉的建议及时停用。',
                  style: TextStyle(fontSize: Fs.caption, color: AppColors.textTertiary, height: 1.5),
                ),
                const SizedBox(height: Sp.m),
                Row(
                  children: [
                    Expanded(
                      child: TextField(
                        controller: countCtrl,
                        keyboardType: TextInputType.number,
                        decoration: const InputDecoration(labelText: '生成数量'),
                      ),
                    ),
                    const SizedBox(width: Sp.m),
                    Expanded(
                      child: TextField(
                        controller: maxCtrl,
                        keyboardType: TextInputType.number,
                        decoration: const InputDecoration(labelText: '每个可用次数'),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: Sp.m),
                TextField(
                  controller: daysCtrl,
                  keyboardType: TextInputType.number,
                  decoration: const InputDecoration(labelText: '有效天数（0 = 长期有效）'),
                ),
                const SizedBox(height: Sp.m),
                TextField(
                  controller: noteCtrl,
                  decoration: const InputDecoration(labelText: '备注（可选，如「老张」）'),
                ),
                const SizedBox(height: Sp.l),
                if (created.isNotEmpty) ...[
                  Container(
                    padding: const EdgeInsets.all(Sp.m),
                    decoration: BoxDecoration(
                      color: AppColors.successSoft,
                      borderRadius: BorderRadius.circular(Rd.md),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text('已生成（点击复制）',
                            style: TextStyle(fontSize: Fs.caption, fontWeight: Fw.semi)),
                        const SizedBox(height: Sp.s),
                        ...created.map((c) => InkWell(
                              onTap: () async {
                                await Clipboard.setData(ClipboardData(text: c['code'] ?? ''));
                                _toast('已复制 ${c['code']}');
                              },
                              child: Padding(
                                padding: const EdgeInsets.symmetric(vertical: 4),
                                child: Row(
                                  children: [
                                    const Icon(Icons.copy_rounded, size: 14),
                                    const SizedBox(width: Sp.s),
                                    Text(c['code'] ?? '',
                                        style: const TextStyle(
                                            fontSize: Fs.body,
                                            fontWeight: Fw.bold,
                                            letterSpacing: 1.2)),
                                  ],
                                ),
                              ),
                            )),
                      ],
                    ),
                  ),
                  const SizedBox(height: Sp.m),
                ],
                Row(
                  children: [
                    Expanded(
                      child: GradientButton(
                        text: '生成',
                        icon: Icons.auto_awesome_rounded,
                        onPressed: () async {
                          try {
                            final res = await ref.read(apiProvider).createInviteCode(
                                  count: int.tryParse(countCtrl.text.trim()) ?? 1,
                                  maxUses: int.tryParse(maxCtrl.text.trim()) ?? 1,
                                  days: int.tryParse(daysCtrl.text.trim()),
                                  note: noteCtrl.text,
                                );
                            created = (res as List?) ?? [];
                            setSheet(() {});
                            await _reload();
                          } catch (e) {
                            _toast(_errText(e));
                          }
                        },
                      ),
                    ),
                    const SizedBox(width: Sp.m),
                    OutlinedButton(
                      onPressed: () => Navigator.pop(sheetCtx),
                      child: const Text('关闭'),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _InviteCard extends StatelessWidget {
  final Map<String, dynamic> item;
  final VoidCallback onCopy;
  final VoidCallback onToggle;
  final VoidCallback onEdit;
  final VoidCallback onDelete;

  const _InviteCard({
    required this.item,
    required this.onCopy,
    required this.onToggle,
    required this.onEdit,
    required this.onDelete,
  });

  @override
  Widget build(BuildContext context) {
    final usable = item['usable'] == true;
    final disabled = item['disabled'] == true;
    final used = item['usedCount'] ?? 0;
    final max = item['maxUses'] ?? 1;
    final expired = item['expiresAt'] != null &&
        DateTime.tryParse(item['expiresAt'].toString())?.isBefore(DateTime.now()) == true;

    final stateColor = usable ? AppColors.up : AppColors.textTertiary;
    final stateText = disabled ? '已停用' : (expired ? '已过期' : (used >= max ? '已用完' : '可用'));

    final users = (item['users'] as List?) ?? [];

    return AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  item['code'] ?? '',
                  style: TextStyle(
                    fontSize: Fs.head,
                    fontWeight: Fw.bold,
                    letterSpacing: 1.6,
                    color: usable ? AppColors.textPrimary : AppColors.textTertiary,
                    decoration: usable ? null : TextDecoration.lineThrough,
                  ),
                ),
              ),
              TagChip(text: stateText, color: stateColor),
            ],
          ),
          const SizedBox(height: Sp.s),
          Text(
            '已用 $used / $max'
            '${item['expiresAt'] != null ? '  ·  ${Fmt.ymd(DateTime.parse(item['expiresAt'].toString()))} 到期' : '  ·  长期有效'}',
            style: const TextStyle(fontSize: Fs.caption, color: AppColors.textTertiary),
          ),
          if (item['note'] != null && '${item['note']}'.isNotEmpty) ...[
            const SizedBox(height: Sp.xs),
            Text('备注：${item['note']}',
                style: const TextStyle(fontSize: Fs.caption, color: AppColors.textSecondary)),
          ],
          if (users.isNotEmpty) ...[
            const SizedBox(height: Sp.xs),
            Text(
              '使用者：${users.map((u) => u['email']).join('、')}',
              style: const TextStyle(fontSize: Fs.micro, color: AppColors.textTertiary, height: 1.5),
            ),
          ],
          const SizedBox(height: Sp.m),
          Wrap(
            spacing: Sp.s,
            runSpacing: Sp.xs,
            children: [
              _Action('复制', onCopy),
              _Action(disabled ? '启用' : '停用', onToggle),
              _Action('编辑', onEdit),
              if (used == 0) _Action('删除', onDelete),
            ],
          ),
        ],
      ),
    );
  }
}

// ==================================================================
// 审计日志
// ==================================================================
class _AuditTab extends ConsumerWidget {
  const _AuditTab();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(adminOverviewProvider);
    return async.when(
      data: (o) {
        final logs = (o['recentLogs'] as List?) ?? [];
        if (logs.isEmpty) {
          return const EmptyState(
            icon: Icons.history_rounded,
            title: '暂无审计记录',
            subtitle: '管理员的敏感操作会自动留痕',
          );
        }
        return ListView.builder(
          padding: const EdgeInsets.only(bottom: Sp.xxl),
          itemCount: logs.length,
          itemBuilder: (_, i) {
            final l = logs[i];
            return AppCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      TagChip(text: l['action'] ?? '', color: AppColors.primary),
                      const Spacer(),
                      Text(Fmt.mdHm(DateTime.parse(l['createdAt'].toString())),
                          style: const TextStyle(fontSize: Fs.micro, color: AppColors.textTertiary)),
                    ],
                  ),
                  const SizedBox(height: Sp.xs),
                  Text(l['detail'] ?? '',
                      style: const TextStyle(fontSize: Fs.caption, height: 1.5)),
                  const SizedBox(height: 2),
                  Text('操作人：${l['admin']?['email'] ?? '系统'}',
                      style: const TextStyle(fontSize: Fs.micro, color: AppColors.textTertiary)),
                ],
              ),
            );
          },
        );
      },
      loading: () => const ListSkeleton(count: 4),
      error: (e, _) => Center(child: Text('加载失败：$e')),
    );
  }
}

// ==================================================================
// 系统概览
// ==================================================================
class _OverviewTab extends ConsumerWidget {
  const _OverviewTab();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(adminOverviewProvider);
    return async.when(
      data: (o) => ListView(
        padding: const EdgeInsets.only(bottom: Sp.xxl),
        children: [
          AppCard(
            child: Column(
              children: [
                _Row('总用户数', '${o['userCount']}'),
                _Row('今日活跃', '${o['activeToday']}'),
                _Row('今日 AI 调用', '${o['aiToday']}'),
                _Row('本月 AI 调用', '${o['aiMonth']}'),
                _Row('今日失败', '${o['aiFailToday']}',
                    color: (o['aiFailToday'] ?? 0) > 0 ? AppColors.danger : null),
                _Row('本月成本估算', Fmt.money(o['estCostCentsMonth'] ?? 0)),
              ],
            ),
          ),
        ],
      ),
      loading: () => const ListSkeleton(count: 3),
      error: (e, _) => Center(child: Text('加载失败：$e')),
    );
  }

  Widget _Row(String a, String b, {Color? color}) => Padding(
        padding: const EdgeInsets.symmetric(vertical: Sp.xs),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text(a, style: const TextStyle(fontSize: Fs.body, color: AppColors.textSecondary)),
            NumText(b, size: Fs.body, color: color),
          ],
        ),
      );
}

// ==================================================================
// 通用小部件
// ==================================================================
class _Action extends StatelessWidget {
  final String label;
  final VoidCallback onTap;
  const _Action(this.label, this.onTap);

  @override
  Widget build(BuildContext context) {
    return OutlinedButton(
      style: OutlinedButton.styleFrom(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
        minimumSize: const Size(0, 30),
        tapTargetSize: MaterialTapTargetSize.shrinkWrap,
      ),
      onPressed: onTap,
      child: Text(label, style: const TextStyle(fontSize: Fs.caption)),
    );
  }
}

String _errText(Object e) => e.toString().replaceFirst(RegExp(r'.*error: '), '');
