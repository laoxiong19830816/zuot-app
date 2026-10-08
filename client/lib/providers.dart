import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'core/api.dart';

/// 登录态
class AuthState {
  final bool loading;
  final bool loggedIn;
  final Map<String, dynamic>? user;
  final Map<String, dynamic>? settings;
  final String? error;

  AuthState({
    this.loading = true,
    this.loggedIn = false,
    this.user,
    this.settings,
    this.error,
  });

  bool get isAdmin => user?['role'] == 'ADMIN';
}

class AuthNotifier extends StateNotifier<AuthState> {
  final ApiClient _api;
  AuthNotifier(this._api) : super(AuthState());

  /// 启动时检查本地 token 是否有效
  Future<void> bootstrap() async {
    state = AuthState(loading: true);
    try {
      final data = await _api.me();
      state = AuthState(
        loading: false,
        loggedIn: true,
        user: Map<String, dynamic>.from(data['user'] ?? {}),
        settings: data['settings'] == null ? null : Map<String, dynamic>.from(data['settings']),
      );
    } catch (_) {
      state = AuthState(loading: false, loggedIn: false);
    }
  }

  Future<void> login(String email, String password) async {
    state = AuthState(loading: true);
    try {
      final data = await _api.login(email, password);
      final me = await _api.me();
      state = AuthState(
        loading: false,
        loggedIn: true,
        user: Map<String, dynamic>.from(me['user'] ?? {}),
        settings: me['settings'] == null ? null : Map<String, dynamic>.from(me['settings']),
      );
    } catch (e) {
      state = AuthState(loading: false, loggedIn: false, error: _msg(e));
    }
  }

  Future<void> register(String email, String password, String? inviteCode) async {
    state = AuthState(loading: true);
    try {
      await _api.register(email, password, inviteCode);
      final me = await _api.me();
      state = AuthState(
        loading: false,
        loggedIn: true,
        user: Map<String, dynamic>.from(me['user'] ?? {}),
        settings: me['settings'] == null ? null : Map<String, dynamic>.from(me['settings']),
      );
    } catch (e) {
      state = AuthState(loading: false, loggedIn: false, error: _msg(e));
    }
  }

  Future<void> logout() async {
    await _api.logout();
    state = AuthState(loading: false, loggedIn: false);
  }

  Future<void> refresh() async => bootstrap();

  String _msg(Object e) {
    final s = e.toString();
    final idx = s.indexOf('error:');
    return idx >= 0 ? s.substring(idx + 6).trim() : '请求失败，请检查网络与服务器地址';
  }
}

final authProvider = StateNotifierProvider<AuthNotifier, AuthState>((ref) {
  return AuthNotifier(ref.read(apiProvider));
});

/// 持仓列表
final positionsProvider = FutureProvider.autoDispose<List<dynamic>>((ref) async {
  return ref.read(apiProvider).positions();
});

/// 今日统计
final todayProvider = FutureProvider.autoDispose<Map<String, dynamic>>((ref) async {
  return ref.read(apiProvider).todayStats();
});

/// 未对冲挂单池
final pendingProvider = FutureProvider.autoDispose<List<dynamic>>((ref) async {
  return ref.read(apiProvider).pending();
});

/// 最新 AI 分析（按类型）
final latestAiProvider = FutureProvider.autoDispose.family<dynamic, String>((ref, kind) async {
  return ref.read(apiProvider).latestAi(kind: kind);
});

/// 今日已对冲配对
final pairsTodayProvider = FutureProvider.autoDispose<List<dynamic>>((ref) async {
  final now = DateTime.now();
  final from = '${now.year}-${now.month.toString().padLeft(2, '0')}-${now.day.toString().padLeft(2, '0')}';
  return ref.read(apiProvider).pairs(from: from, to: from);
});

/// 风险预警
final riskProvider = FutureProvider.autoDispose<Map<String, dynamic>>((ref) async {
  return ref.read(apiProvider).risk();
});

/// 统计总览
final overviewProvider = FutureProvider.autoDispose<Map<String, dynamic>>((ref) async {
  return ref.read(apiProvider).overview();
});

/// 按标的统计
final byCodeProvider = FutureProvider.autoDispose<List<dynamic>>((ref) async {
  return ref.read(apiProvider).byCode();
});

/// AI 命中率
final hitRateProvider = FutureProvider.autoDispose<dynamic>((ref) async {
  return ref.read(apiProvider).hitRate();
});

/// 单票 AI 分析列表
final aiListProvider = FutureProvider.autoDispose.family<List<dynamic>, String>((ref, code) async {
  return ref.read(apiProvider).aiList(code: code);
});

/// 单票流水
final tradesProvider = FutureProvider.autoDispose.family<List<dynamic>, String>((ref, code) async {
  return ref.read(apiProvider).trades(code: code);
});

/// 单票配对
final pairsProvider = FutureProvider.autoDispose.family<List<dynamic>, String>((ref, code) async {
  return ref.read(apiProvider).pairs(code: code);
});

/// 单票未对冲挂单
final pendingByCodeProvider = FutureProvider.autoDispose.family<List<dynamic>, String>((ref, code) async {
  return ref.read(apiProvider).pending(code: code);
});

/// 近 N 日按对冲日聚合
final dailyProvider = FutureProvider.autoDispose<List<dynamic>>((ref) async {
  return ref.read(apiProvider).daily(days: 30);
});

/// 管理员：用户列表
final adminUsersProvider = FutureProvider.autoDispose<List<dynamic>>((ref) async {
  return ref.read(apiProvider).adminUsers();
});

/// 管理员：系统概览
final adminOverviewProvider = FutureProvider.autoDispose<dynamic>((ref) async {
  return ref.read(apiProvider).adminOverview();
});

/// 管理员：邀请码列表
final inviteCodesProvider = FutureProvider.autoDispose<List<dynamic>>((ref) async {
  return ref.read(apiProvider).inviteCodes();
});
