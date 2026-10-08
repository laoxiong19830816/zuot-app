import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/api.dart';
import '../core/format.dart';
import '../core/theme.dart';
import '../core/tokens.dart';
import '../providers.dart';
import '../widgets/ui.dart';

/// 批量导入持仓
/// ------------------------------------------------------------
/// 券商 App 一次只能看一个账户，手动一条条录太慢。
/// 直接从券商截图/导出文本里粘贴，自动解析成持仓。
///
/// 支持格式（每行一条，空格 / 逗号 / 制表符分隔均可，顺序自适应）：
///   600062 华润双鹤 16.101 500 500      → 代码 名称 成本价 底仓 可用
///   000100,TCL科技,3.530,4100,100
///   000651 36.239 500                  → 代码 成本价 底仓（可用=底仓）
///   600062 500                         → 代码 底仓（成本价留空，后续补）
class PositionImportPage extends ConsumerStatefulWidget {
  const PositionImportPage({super.key});

  @override
  ConsumerState<PositionImportPage> createState() => _PositionImportPageState();
}

class _PositionImportPageState extends ConsumerState<PositionImportPage> {
  final _ctrl = TextEditingController();
  bool _replace = false;
  bool _saving = false;
  List<_ParsedRow> _rows = [];
  String? _err;

  static const _sample = '600062 华润双鹤 16.101 500 500\n'
      '000100 TCL科技 3.530 4100 100\n'
      '000423 东阿阿胶 49.750 2000 1500\n'
      '000651 格力电器 36.239 500 500\n'
      '000915 华特达因 28.273 11500 11400';

  @override
  void dispose() {
    _ctrl.dispose();
    super.dispose();
  }

  void _parse() {
    setState(() {
      _err = null;
      _rows = _parseText(_ctrl.text);
    });
    if (_rows.isEmpty && _ctrl.text.trim().isNotEmpty) {
      setState(() => _err = '没解析出有效行，请检查格式（每行至少：代码 + 数量）');
    }
  }

  static List<_ParsedRow> _parseText(String text) {
    final out = <_ParsedRow>[];
    for (final rawLine in text.split('\n')) {
      final line = rawLine.trim();
      if (line.isEmpty || line.startsWith('#') || line.startsWith('//')) continue;

      final tokens = line
          .split(RegExp(r'[\s,，\t]+'))
          .map((t) => t.trim())
          .where((t) => t.isNotEmpty)
          .toList();
      if (tokens.isEmpty) continue;

      final code = tokens.first;
      // 代码必须是 6 位数字，否则这行不像是持仓
      if (!RegExp(r'^\d{6}$').hasMatch(code)) continue;

      final numbers = <double>[];
      final nameParts = <String>[];
      for (final t in tokens.skip(1)) {
        final v = double.tryParse(t);
        if (v != null) {
          numbers.add(v);
        } else {
          nameParts.add(t);
        }
      }

      double cost = 0;
      int base = 0;
      int avail = 0;
      if (numbers.length >= 3) {
        cost = numbers[0];
        base = numbers[1].round();
        avail = numbers[2].round();
      } else if (numbers.length == 2) {
        cost = numbers[0];
        base = numbers[1].round();
        avail = base;
      } else if (numbers.length == 1) {
        base = numbers[0].round();
        avail = base;
      } else {
        continue; // 只有代码没有数量，跳过
      }

      out.add(_ParsedRow(
        code: code,
        name: nameParts.join(' '),
        costPrice: cost,
        baseQty: base,
        availableQty: avail,
      ));
    }
    return out;
  }

  Future<void> _submit() async {
    if (_rows.isEmpty) return;
    if (_replace) {
      final yes = await showDialog<bool>(
        context: context,
        builder: (_) => AlertDialog(
          title: const Text('确认覆盖？'),
          content: const Text(
            '「覆盖」会先清空你现有的全部持仓、交易流水与对冲记录，再导入新数据。\n'
            '若只是同步券商最新股数，请改回「合并」。',
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('取消')),
            FilledButton(
              style: FilledButton.styleFrom(backgroundColor: AppColors.danger),
              onPressed: () => Navigator.pop(context, true),
              child: const Text('确认覆盖'),
            ),
          ],
        ),
      );
      if (yes != true) return;
    }

    setState(() => _saving = true);
    try {
      final res = await ref.read(apiProvider).importPositions(
            _rows.map((r) => r.toJson()).toList(),
            mode: _replace ? 'replace' : 'merge',
          );
      ref.invalidate(positionsProvider);
      ref.invalidate(overviewProvider);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(res['message'] ?? '导入完成')),
      );
      Navigator.pop(context);
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _saving = false;
        _err = e.toString().replaceFirst(RegExp(r'.*error: '), '');
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('导入持仓')),
      body: SafeArea(
        child: Column(
          children: [
            Expanded(
              child: ListView(
                padding: const EdgeInsets.only(bottom: Sp.l),
                children: [
                  Padding(
                    padding: const EdgeInsets.all(Sp.l),
                    child: TextField(
                      controller: _ctrl,
                      maxLines: 8,
                      minLines: 6,
                      style: const TextStyle(fontSize: Fs.body, height: 1.6),
                      decoration: InputDecoration(
                        alignLabelWithHint: true,
                        labelText: '持仓文本（每行一条）',
                        hintText: '600062 华润双鹤 16.101 500 500',
                        suffixIcon: IconButton(
                          icon: const Icon(Icons.content_paste_go_rounded),
                          tooltip: '填入示例',
                          onPressed: () {
                            _ctrl.text = _sample;
                            _parse();
                          },
                        ),
                      ),
                      onChanged: (_) => _parse(),
                    ),
                  ),

                  if (_err != null) AlertBanner(message: _err!, level: AlertLevel.danger),

                  // 导入模式
                  AppCard(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text('导入方式',
                            style: TextStyle(fontSize: Fs.body, fontWeight: Fw.semi)),
                        const SizedBox(height: Sp.xs),
                        RadioListTile<bool>(
                          dense: true,
                          contentPadding: EdgeInsets.zero,
                          title: const Text('合并（推荐）', style: TextStyle(fontSize: Fs.body)),
                          subtitle: const Text('已存在的标的只更新股数与成本价',
                              style: TextStyle(fontSize: Fs.caption, color: AppColors.textTertiary)),
                          value: false,
                          groupValue: _replace,
                          onChanged: (v) => setState(() => _replace = v ?? false),
                        ),
                        RadioListTile<bool>(
                          dense: true,
                          contentPadding: EdgeInsets.zero,
                          title: const Text('覆盖（谨慎）', style: TextStyle(fontSize: Fs.body)),
                          subtitle: const Text('先清空全部持仓与流水，再导入',
                              style: TextStyle(fontSize: Fs.caption, color: AppColors.textTertiary)),
                          value: true,
                          groupValue: _replace,
                          onChanged: (v) => setState(() => _replace = v ?? false),
                        ),
                      ],
                    ),
                  ),

                  if (_rows.isNotEmpty) ...[
                    Padding(
                      padding: const EdgeInsets.fromLTRB(Sp.l, Sp.m, Sp.l, Sp.xs),
                      child: SectionTitleText('解析结果 ${_rows.length} 条'),
                    ),
                    for (final r in _rows)
                      AppCard(
                        child: Row(
                          children: [
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Row(
                                    children: [
                                      NumText(r.code, size: Fs.body),
                                      const SizedBox(width: Sp.s),
                                      if (r.name.isNotEmpty)
                                        Expanded(
                                          child: Text(r.name,
                                              overflow: TextOverflow.ellipsis,
                                              style: const TextStyle(
                                                  fontSize: Fs.body, fontWeight: Fw.medium)),
                                        ),
                                    ],
                                  ),
                                  const SizedBox(height: 3),
                                  Text(
                                    '成本 ${r.costPrice > 0 ? Fmt.price(r.costPrice * 1000) : '—'}'
                                    '  底仓 ${Fmt.qty(r.baseQty)}  可用 ${Fmt.qty(r.availableQty)}',
                                    style: const TextStyle(
                                        fontSize: Fs.micro, color: AppColors.textTertiary),
                                  ),
                                ],
                              ),
                            ),
                            TagChip(
                              text: _looksEtf(r.code) ? 'ETF' : '股票',
                              color: _looksEtf(r.code) ? AppColors.accent : AppColors.primary,
                            ),
                          ],
                        ),
                      ),
                  ],
                ],
              ),
            ),

            // 底部操作条
            Container(
              padding: const EdgeInsets.fromLTRB(Sp.l, Sp.s, Sp.l, Sp.l),
              decoration: const BoxDecoration(
                border: Border(top: BorderSide(color: AppColors.border)),
              ),
              child: GradientButton(
                text: _rows.isEmpty ? '请先粘贴持仓' : '导入 ${_rows.length} 条',
                icon: Icons.file_upload_rounded,
                loading: _saving,
                onPressed: _rows.isEmpty || _saving ? null : _submit,
              ),
            ),
          ],
        ),
      ),
    );
  }

  static bool _looksEtf(String code) =>
      RegExp(r'^(51|58|56|50|15|16|18|159)').hasMatch(code);
}

class _ParsedRow {
  final String code;
  final String name;
  final double costPrice;
  final int baseQty;
  final int availableQty;

  _ParsedRow({
    required this.code,
    required this.name,
    required this.costPrice,
    required this.baseQty,
    required this.availableQty,
  });

  Map<String, dynamic> toJson() => {
        'code': code,
        'name': name,
        'costPrice': costPrice,
        'baseQty': baseQty,
        'availableQty': availableQty,
      };
}

/// 轻量区块标题（与 ui.dart 的 SectionTitle 保持同一视觉）
class SectionTitleText extends StatelessWidget {
  final String text;
  const SectionTitleText(this.text, {super.key});

  @override
  Widget build(BuildContext context) {
    return Text(
      text,
      style: const TextStyle(
        fontSize: Fs.caption,
        fontWeight: Fw.semi,
        color: AppColors.textSecondary,
        letterSpacing: 0.3,
      ),
    );
  }
}
