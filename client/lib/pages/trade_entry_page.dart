import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/api.dart';
import '../core/format.dart';
import '../core/theme.dart';
import '../providers.dart';

/// 快速记账页（核心页面）
/// 输入价格与数量即时试算费用、保本价差、配对后净收益
class TradeEntryPage extends ConsumerStatefulWidget {
  final String? presetCode;
  const TradeEntryPage({super.key, this.presetCode});

  @override
  ConsumerState<TradeEntryPage> createState() => _TradeEntryPageState();
}

class _TradeEntryPageState extends ConsumerState<TradeEntryPage> {
  final _priceCtrl = TextEditingController();
  final _qtyCtrl = TextEditingController();
  String? _code;
  String _side = 'BUY';
  Map<String, dynamic>? _preview;
  bool _saving = false;
  bool _previewing = false;

  @override
  void initState() {
    super.initState();
    _code = widget.presetCode;
    _priceCtrl.addListener(_debouncedPreview);
    _qtyCtrl.addListener(_debouncedPreview);
  }

  void _debouncedPreview() async {
    // 简单防抖：输入变化后 400ms 再请求
    final price = _priceCtrl.text;
    final qty = _qtyCtrl.text;
    await Future.delayed(const Duration(milliseconds: 400));
    if (_priceCtrl.text != price || _qtyCtrl.text != qty) return;
    await _runPreview();
  }

  Future<void> _runPreview() async {
    if (_code == null || _priceCtrl.text.isEmpty || _qtyCtrl.text.isEmpty) {
      setState(() => _preview = null);
      return;
    }
    setState(() => _previewing = true);
    try {
      final res = await ref.read(apiProvider).previewTrade({
        'code': _code,
        'side': _side,
        'price': double.tryParse(_priceCtrl.text) ?? 0,
        'qty': int.tryParse(_qtyCtrl.text) ?? 0,
      });
      if (mounted) setState(() => _preview = res);
    } catch (e) {
      if (mounted) setState(() => _preview = null);
    } finally {
      if (mounted) setState(() => _previewing = false);
    }
  }

  Future<void> _save() async {
    if (_code == null || _priceCtrl.text.isEmpty || _qtyCtrl.text.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('请填写完整')));
      return;
    }
    setState(() => _saving = true);
    try {
      final res = await ref.read(apiProvider).addTrade({
        'code': _code,
        'side': _side,
        'price': double.tryParse(_priceCtrl.text) ?? 0,
        'qty': int.tryParse(_qtyCtrl.text) ?? 0,
      });
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(res['message'] ?? '已保存')));
      ref.invalidate(positionsProvider);
      ref.invalidate(todayProvider);
      ref.invalidate(pendingProvider);
      ref.invalidate(pairsTodayProvider);
      Navigator.pop(context);
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString().replaceFirst(RegExp(r'.*error: '), ''))));
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final positionsAsync = ref.watch(positionsProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('记一笔')),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // 标的
            positionsAsync.when(
              data: (list) => DropdownButtonFormField<String>(
                value: _code,
                decoration: const InputDecoration(labelText: '标的', prefixIcon: Icon(Icons.show_chart)),
                items: list
                    .map<DropdownMenuItem<String>>((p) => DropdownMenuItem<String>(
                          value: p['code'] as String,
                          child: Text('${p['name']}  ${p['code']}', style: const TextStyle(fontSize: 14)),
                        ))
                    .toList(),
                onChanged: (v) {
                  setState(() => _code = v);
                  _runPreview();
                },
              ),
              loading: () => const LinearProgressIndicator(),
              error: (e, _) => Text('持仓加载失败：$e'),
            ),
            const SizedBox(height: 14),

            // 方向
            SegmentedButton<String>(
              segments: const [
                ButtonSegment(value: 'BUY', label: Text('买入'), icon: Icon(Icons.arrow_upward)),
                ButtonSegment(value: 'SELL', label: Text('卖出'), icon: Icon(Icons.arrow_downward)),
              ],
              selected: {_side},
              onSelectionChanged: (s) {
                setState(() => _side = s.first);
                _runPreview();
              },
            ),
            const SizedBox(height: 14),

            Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _priceCtrl,
                    keyboardType: const TextInputType.numberWithOptions(decimal: true),
                    decoration: const InputDecoration(labelText: '价格（元）'),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: TextField(
                    controller: _qtyCtrl,
                    keyboardType: TextInputType.number,
                    decoration: const InputDecoration(labelText: '数量（股）'),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 18),

            // 实时试算区
            if (_preview != null) _PreviewPanel(preview: _preview!)
            else if (_previewing)
              const Center(child: Padding(padding: EdgeInsets.all(16), child: CircularProgressIndicator()))
            else
              const Padding(
                padding: EdgeInsets.all(12),
                child: Text('输入价格与数量后自动试算费用与保本价差', style: TextStyle(fontSize: 12.5, color: AppColors.textSecondary)),
              ),

            const SizedBox(height: 24),
            SizedBox(
              width: double.infinity,
              height: 48,
              child: ElevatedButton(
                onPressed: _saving ? null : _save,
                child: _saving ? const CircularProgressIndicator(strokeWidth: 2) : const Text('保存'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// 试算结果面板
class _PreviewPanel extends StatelessWidget {
  final Map<String, dynamic> preview;
  const _PreviewPanel({required this.preview});

  @override
  Widget build(BuildContext context) {
    final type = preview['type'];
    final totalFee = preview['totalFeeCents'] ?? 0;
    // 保本价差单位是「厘/股」，不是分
    final breakEven = (preview['breakEvenSpreadMills'] ?? 0).toDouble();
    final hedge = preview['hedgePreview'] as Map<String, dynamic>?;

    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Text(type == 'ETF' ? 'ETF 费率' : '股票费率',
                  style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600)),
              const Spacer(),
              Text('成交额 ${Fmt.money(preview['amountCents'] ?? 0)}',
                  style: const TextStyle(fontSize: 12, color: AppColors.textSecondary)),
            ],
          ),
          const Divider(height: 18),
          _Row('佣金', Fmt.money(preview['commissionCents'] ?? 0)),
          _Row('印花税', Fmt.money(preview['stampTaxCents'] ?? 0)),
          _Row('过户费', Fmt.money(preview['transferFeeCents'] ?? 0)),
          _Row('合计费用', Fmt.money(totalFee), bold: true),
          const Divider(height: 18),
          _Row('保本价差', '${Fmt.price(breakEven, digits: 5)} 元/股', bold: true),
          Text('价差低于此数字则必亏', style: const TextStyle(fontSize: 11, color: AppColors.textSecondary)),

          if (hedge != null) ...[
            const Divider(height: 20),
            Container(
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: (hedge['profitable'] == true ? AppColors.up : AppColors.down).withOpacity(0.1),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    hedge['profitable'] == true ? '✓ 可与挂单配对，预计盈利' : '✗ 可与挂单配对，但预计亏损',
                    style: TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w600,
                      color: hedge['profitable'] == true ? AppColors.up : AppColors.down,
                    ),
                  ),
                  const SizedBox(height: 6),
                  Text(
                    '对手单：${Fmt.price(hedge['counterpartPriceMills'])} × ${Fmt.qty(hedge['matchQty'])} 股\n'
                    '价差 ${Fmt.spread(hedge['spreadMills'])} 元/股  ·  净收益 ${Fmt.moneySigned(hedge['netCents'])}',
                    style: const TextStyle(fontSize: 12.5, height: 1.5),
                  ),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }

  Widget _Row(String label, String value, {bool bold = false}) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: TextStyle(fontSize: 12.5, color: bold ? AppColors.textPrimary : AppColors.textSecondary)),
          Text(value, style: TextStyle(fontSize: 12.5, fontWeight: bold ? FontWeight.w600 : FontWeight.normal)),
        ],
      ),
    );
  }
}
