import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// 后端 API 客户端
/// 说明：App 绝不直接调用豆包大模型（避免密钥泄露），所有 AI 能力走后端接口。
class ApiClient {
  final Dio _dio;
  final SharedPreferences _prefs;

  ApiClient(this._prefs)
      : _dio = Dio(BaseOptions(
          baseUrl: _prefs.getString('server_url') ?? 'http://10.0.2.2:8080',
          connectTimeout: const Duration(seconds: 15),
          receiveTimeout: const Duration(seconds: 120), // AI 分析较慢
          headers: {'Content-Type': 'application/json'},
        )) {
    _dio.interceptors.add(InterceptorsWrapper(
      onRequest: (options, handler) {
        final token = _prefs.getString('token');
        if (token != null && token.isNotEmpty) {
          options.headers['Authorization'] = 'Bearer $token';
        }
        handler.next(options);
      },
      onError: (err, handler) {
        if (err.response?.statusCode == 401) {
          _prefs.remove('token'); // 登录态失效，下次进入会跳登录页
        }
        handler.next(err);
      },
    ));
  }

  String get baseUrl => _dio.options.baseUrl;

  set baseUrl(String url) {
    _dio.options.baseUrl = url;
    _prefs.setString('server_url', url);
  }

  // ---------- 通用 ----------
  Future<dynamic> get(String path, {Map<String, dynamic>? params}) async {
    final res = await _dio.get(path, queryParameters: params);
    return _unwrap(res.data);
  }

  Future<dynamic> post(String path, {dynamic data}) async {
    final res = await _dio.post(path, data: data);
    return _unwrap(res.data);
  }

  Future<dynamic> put(String path, {dynamic data}) async {
    final res = await _dio.put(path, data: data);
    return _unwrap(res.data);
  }

  Future<dynamic> del(String path) async {
    final res = await _dio.delete(path);
    return _unwrap(res.data);
  }

  dynamic _unwrap(dynamic body) {
    if (body is Map && body.containsKey('code')) {
      if (body['code'] == 0) return body['data'];
      throw DioException(
        requestOptions: RequestOptions(path: ''),
        error: body['message'] ?? '请求失败',
      );
    }
    return body;
  }

  // ---------- 认证 ----------
  Future<Map<String, dynamic>> login(String email, String password) async {
    final data = await post('/api/auth/login', data: {'email': email, 'password': password});
    await _prefs.setString('token', data['token']);
    return Map<String, dynamic>.from(data);
  }

  Future<Map<String, dynamic>> register(String email, String password, String? inviteCode) async {
    final data = await post('/api/auth/register', data: {
      'email': email,
      'password': password,
      'inviteCode': inviteCode,
    });
    await _prefs.setString('token', data['token']);
    return Map<String, dynamic>.from(data);
  }

  Future<Map<String, dynamic>> me() async => Map<String, dynamic>.from(await get('/api/auth/me'));

  Future<void> logout() => _prefs.remove('token');

  Future<void> updateSettings(Map<String, dynamic> patch) => put('/api/auth/settings', data: patch);

  // ---------- 持仓 ----------
  Future<List<dynamic>> positions() => get('/api/positions');

  Future<void> addPosition(Map<String, dynamic> data) => post('/api/positions', data: data);

  /// 批量导入持仓：mode = merge（默认，已存在则更新）/ replace（清空后重建）
  Future<Map<String, dynamic>> importPositions(List<Map<String, dynamic>> items, {String mode = 'merge'}) =>
      post('/api/positions/import', data: {'items': items, 'mode': mode}) as Future<Map<String, dynamic>>;

  Future<void> updatePosition(String id, Map<String, dynamic> data) => put('/api/positions/$id', data: data);

  Future<void> deletePosition(String id) => del('/api/positions/$id');

  // ---------- 交易 ----------
  Future<Map<String, dynamic>> previewTrade(Map<String, dynamic> data) =>
      post('/api/trades/preview', data: data) as Future<Map<String, dynamic>>;

  Future<Map<String, dynamic>> addTrade(Map<String, dynamic> data) =>
      post('/api/trades', data: data) as Future<Map<String, dynamic>>;

  Future<List<dynamic>> trades({String? code, String? status, String? date}) =>
      get('/api/trades', params: {'code': code, 'status': status, 'date': date});

  Future<List<dynamic>> pending({String? code}) => get('/api/trades/pending', params: {'code': code});

  Future<List<dynamic>> pairs({String? code, String? from, String? to}) =>
      get('/api/trades/pairs', params: {'code': code, 'from': from, 'to': to});

  Future<void> deleteTrade(String id) => del('/api/trades/$id');

  // ---------- AI ----------
  Future<dynamic> latestAi({String? kind, String? code}) =>
      get('/api/ai/latest', params: {'kind': kind, 'code': code});

  Future<List<dynamic>> aiList({String? kind, String? code, int limit = 30}) =>
      get('/api/ai/list', params: {'kind': kind, 'code': code, 'limit': limit});

  Future<dynamic> aiDetail(String id) => get('/api/ai/$id');

  Future<Map<String, dynamic>> refreshAi(String kind, {String? code}) =>
      post('/api/ai/refresh', data: {'kind': kind, 'code': code}) as Future<Map<String, dynamic>>;

  Future<Map<String, dynamic>> review() =>
      post('/api/ai/review', data: {}) as Future<Map<String, dynamic>>;

  Future<dynamic> aiUsage() => get('/api/ai/usage');

  Future<dynamic> hitRate() => get('/api/ai/hit-rate');

  // ---------- 统计 / 风险 ----------
  Future<Map<String, dynamic>> todayStats() =>
      get('/api/stats/today') as Future<Map<String, dynamic>>;

  Future<Map<String, dynamic>> overview() =>
      get('/api/stats/overview') as Future<Map<String, dynamic>>;

  Future<List<dynamic>> byCode() => get('/api/stats/by-code');

  Future<List<dynamic>> daily({int days = 30}) => get('/api/stats/daily', params: {'days': days});

  Future<List<dynamic>> plans() => get('/api/stats/plans');

  Future<Map<String, dynamic>> risk() => get('/api/risk') as Future<Map<String, dynamic>>;

  // ---------- 管理员 ----------
  Future<List<dynamic>> adminUsers() => get('/api/admin/users');

  Future<dynamic> adminOverview() => get('/api/admin/overview');

  Future<void> setUserStatus(String id, String status, {String? reason}) =>
      post('/api/admin/users/$id/status', data: {'status': status, 'reason': reason});

  Future<void> setUserQuota(String id, {int? daily, int? monthly}) =>
      post('/api/admin/users/$id/quota', data: {'daily': daily, 'monthly': monthly});

  Future<void> setUserRole(String id, String role) =>
      post('/api/admin/users/$id/role', data: {'role': role});

  // ---------- 邀请码 ----------
  Future<List<dynamic>> inviteCodes() => get('/api/admin/invite-codes');

  Future<dynamic> createInviteCode({int count = 1, int maxUses = 1, int? days, String? note}) =>
      post('/api/admin/invite-codes', data: {
        'count': count,
        'maxUses': maxUses,
        if (days != null) 'days': days,
        if (note != null && note.trim().isNotEmpty) 'note': note.trim(),
      });

  Future<dynamic> toggleInviteCode(String id) => post('/api/admin/invite-codes/$id/toggle');

  /// 修改邀请码：note / maxUses / days（days = 0 表示长期有效）
  Future<void> updateInviteCode(String id, {String? note, int? maxUses, int? days}) =>
      put('/api/admin/invite-codes/$id', data: {
        if (note != null) 'note': note,
        if (maxUses != null) 'maxUses': maxUses,
        if (days != null) 'days': days,
      });

  Future<void> deleteInviteCode(String id) => del('/api/admin/invite-codes/$id');
}

final sharedPrefsProvider = Provider<SharedPreferences>((ref) {
  throw UnimplementedError('请在 main 中 override');
});

final apiProvider = Provider<ApiClient>((ref) => ApiClient(ref.read(sharedPrefsProvider)));
