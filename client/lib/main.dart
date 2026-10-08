import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'core/api.dart';
import 'core/theme.dart';
import 'providers.dart';
import 'pages/login_page.dart';
import 'pages/home_page.dart';
import 'pages/stock_board_page.dart';
import 'pages/stats_page.dart';
import 'pages/settings_page.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final prefs = await SharedPreferences.getInstance();
  runApp(
    ProviderScope(
      overrides: [sharedPrefsProvider.overrideWithValue(prefs)],
      child: const ZuotApp(),
    ),
  );
}

class ZuotApp extends StatelessWidget {
  const ZuotApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: '做T管家',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.dark(),
      home: const AuthGate(),
    );
  }
}

/// 登录态闸门：有 token → 主界面；否则 → 登录页
class AuthGate extends ConsumerStatefulWidget {
  const AuthGate({super.key});

  @override
  ConsumerState<AuthGate> createState() => _AuthGateState();
}

class _AuthGateState extends ConsumerState<AuthGate> {
  @override
  void initState() {
    super.initState();
    Future.microtask(() => ref.read(authProvider.notifier).bootstrap());
  }

  @override
  Widget build(BuildContext context) {
    final auth = ref.watch(authProvider);
    if (auth.loading) {
      return const Scaffold(
        body: Center(
          child: SizedBox(width: 26, height: 26, child: CircularProgressIndicator(strokeWidth: 2)),
        ),
      );
    }
    if (!auth.loggedIn) return const LoginPage();
    return const MainShell();
  }
}

/// 主框架：底部 4 个 Tab（今日 / 个股 / 统计 / 我的）
/// V3：BottomNavigationBar → NavigationBar（胶囊指示器 + 选中描边图标）
class MainShell extends ConsumerStatefulWidget {
  const MainShell({super.key});

  @override
  ConsumerState<MainShell> createState() => _MainShellState();
}

class _MainShellState extends ConsumerState<MainShell> {
  int _index = 0;

  static const _pages = [
    HomePage(),
    StockBoardPage(),
    StatsPage(),
    SettingsPage(),
  ];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: IndexedStack(index: _index, children: _pages),
      bottomNavigationBar: DecoratedBox(
        decoration: const BoxDecoration(
          border: Border(top: BorderSide(color: AppColors.border, width: 1)),
        ),
        child: NavigationBar(
          selectedIndex: _index,
          onDestinationSelected: (i) => setState(() => _index = i),
          labelBehavior: NavigationDestinationLabelBehavior.alwaysShow,
          destinations: const [
            NavigationDestination(
              icon: Icon(Icons.today_outlined),
              selectedIcon: Icon(Icons.today_rounded),
              label: '今日',
            ),
            NavigationDestination(
              icon: Icon(Icons.stacked_line_chart_outlined),
              selectedIcon: Icon(Icons.stacked_line_chart_rounded),
              label: '个股',
            ),
            NavigationDestination(
              icon: Icon(Icons.insights_outlined),
              selectedIcon: Icon(Icons.insights_rounded),
              label: '统计',
            ),
            NavigationDestination(
              icon: Icon(Icons.person_outline_rounded),
              selectedIcon: Icon(Icons.person_rounded),
              label: '我的',
            ),
          ],
        ),
      ),
    );
  }
}
