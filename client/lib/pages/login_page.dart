import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/api.dart';
import '../core/theme.dart';
import '../core/tokens.dart';
import '../providers.dart';
import '../widgets/ui.dart';

/// ============================================================
/// 登录 / 注册页 · V3
/// ------------------------------------------------------------
/// 改动：品牌区留白从 48 拉到 72、标题 22→28、Logo 换成渐变方块、
///       按钮改渐变 CTA、服务器配置折叠进底部、免责降为 micro 灰
/// ============================================================
class LoginPage extends ConsumerStatefulWidget {
  const LoginPage({super.key});

  @override
  ConsumerState<LoginPage> createState() => _LoginPageState();
}

class _LoginPageState extends ConsumerState<LoginPage> {
  final _emailCtrl = TextEditingController();
  final _pwdCtrl = TextEditingController();
  final _inviteCtrl = TextEditingController();
  final _serverCtrl = TextEditingController();
  bool _isRegister = false;
  bool _obscure = true;
  bool _showServer = false;

  @override
  void initState() {
    super.initState();
    _serverCtrl.text = ref.read(apiProvider).baseUrl;
  }

  Future<void> _submit() async {
    final email = _emailCtrl.text.trim();
    final pwd = _pwdCtrl.text.trim();
    if (email.isEmpty || pwd.isEmpty) {
      _toast('请填写邮箱和密码');
      return;
    }
    final notifier = ref.read(authProvider.notifier);
    if (_isRegister) {
      final invite = _inviteCtrl.text.trim();
      await notifier.register(email, pwd, invite.isEmpty ? null : invite);
    } else {
      await notifier.login(email, pwd);
    }
    final err = ref.read(authProvider).error;
    if (err != null && mounted) _toast(err);
  }

  void _toast(String msg) =>
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));

  @override
  Widget build(BuildContext context) {
    final auth = ref.watch(authProvider);

    return Scaffold(
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.symmetric(horizontal: Sp.xxl),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const SizedBox(height: 72),

              // ---------- 品牌区 ----------
              Row(
                children: [
                  Container(
                    width: 48,
                    height: 48,
                    decoration: BoxDecoration(
                      borderRadius: BorderRadius.circular(Rd.md),
                      gradient: const LinearGradient(
                        colors: [Color(0xFF6B90FF), Color(0xFF4F7DFF)],
                        begin: Alignment.topLeft,
                        end: Alignment.bottomRight,
                      ),
                      boxShadow: Sh.glow(AppColors.primary, opacity: 0.32, blur: 18),
                    ),
                    child: const Icon(Icons.show_chart_rounded, color: Colors.white, size: 26),
                  ),
                  const SizedBox(width: Sp.m),
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text(
                        '做T管家',
                        style: TextStyle(
                          fontSize: Fs.head + 8,
                          fontWeight: Fw.bold,
                          letterSpacing: 0.5,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        '日内做T交易管理系统',
                        style: TextStyle(fontSize: Fs.caption, color: AppColors.textSecondary),
                      ),
                    ],
                  ),
                ],
              ),

              const SizedBox(height: Sp.huge),

              // ---------- 表单 ----------
              TextField(
                controller: _emailCtrl,
                keyboardType: TextInputType.emailAddress,
                style: const TextStyle(fontSize: Fs.body),
                decoration: const InputDecoration(
                  labelText: '邮箱',
                  prefixIcon: Icon(Icons.mail_outline_rounded, size: 20),
                ),
              ),
              const SizedBox(height: Sp.m),
              TextField(
                controller: _pwdCtrl,
                obscureText: _obscure,
                style: const TextStyle(fontSize: Fs.body),
                decoration: InputDecoration(
                  labelText: '密码',
                  prefixIcon: const Icon(Icons.lock_outline_rounded, size: 20),
                  suffixIcon: IconButton(
                    icon: Icon(_obscure ? Icons.visibility_off_rounded : Icons.visibility_rounded, size: 20),
                    onPressed: () => setState(() => _obscure = !_obscure),
                  ),
                ),
              ),
              if (_isRegister) ...[
                const SizedBox(height: Sp.m),
                TextField(
                  controller: _inviteCtrl,
                  style: const TextStyle(fontSize: Fs.body),
                  decoration: const InputDecoration(
                    labelText: '邀请码',
                    prefixIcon: Icon(Icons.card_giftcard_rounded, size: 20),
                  ),
                ),
              ],

              const SizedBox(height: Sp.xxl),

              GradientButton(
                text: _isRegister ? '注册并登录' : '登录',
                loading: auth.loading,
                onPressed: _submit,
              ),

              const SizedBox(height: Sp.m),

              Center(
                child: TextButton(
                  onPressed: () => setState(() => _isRegister = !_isRegister),
                  child: Text(_isRegister ? '已有账号？去登录' : '没有账号？去注册'),
                ),
              ),

              // ---------- 服务器地址（折叠）----------
              const SizedBox(height: Sp.xl),
              Center(
                child: TextButton.icon(
                  onPressed: () => setState(() => _showServer = !_showServer),
                  icon: const Icon(Icons.settings_ethernet_rounded, size: 15),
                  label: const Text('服务器地址'),
                ),
              ),
              if (_showServer) ...[
                const SizedBox(height: Sp.m),
                TextField(
                  controller: _serverCtrl,
                  style: const TextStyle(fontSize: Fs.caption),
                  decoration: const InputDecoration(
                    labelText: '后端地址',
                    hintText: 'http://192.168.x.x:8080',
                    prefixIcon: Icon(Icons.dns_rounded, size: 18),
                  ),
                ),
                const SizedBox(height: Sp.m),
                SizedBox(
                  width: double.infinity,
                  height: Sz.buttonH,
                  child: OutlinedButton(
                    onPressed: () {
                      ref.read(apiProvider).baseUrl = _serverCtrl.text.trim();
                      _toast('服务器地址已保存');
                    },
                    child: const Text('保存地址'),
                  ),
                ),
                const SizedBox(height: Sp.s),
                const Text(
                  '手机访问电脑本机用局域网 IP；安卓模拟器访问宿主机用 10.0.2.2',
                  style: TextStyle(fontSize: Fs.micro, color: AppColors.textTertiary, height: 1.5),
                ),
              ],

              const SizedBox(height: Sp.xxxl),
              const Center(
                child: Text(
                  kDisclaimer,
                  style: TextStyle(fontSize: Fs.micro, color: AppColors.textTertiary, height: 1.6),
                  textAlign: TextAlign.center,
                ),
              ),
              const SizedBox(height: Sp.xxl),
            ],
          ),
        ),
      ),
    );
  }
}
