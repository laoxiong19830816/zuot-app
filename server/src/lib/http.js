/**
 * 统一响应格式与异常处理
 */

function ok(res, data = null, message = 'success') {
  return res.json({ code: 0, message, data });
}

function fail(res, message = '请求失败', code = 1, httpStatus = 400) {
  return res.status(httpStatus).json({ code, message, data: null });
}

/** 包装 async 路由，自动捕获异常 */
function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

/** 全局错误中间件 */
function errorHandler(err, req, res, next) {
  console.error('[ERROR]', req.method, req.originalUrl, err);
  const status = err.status || 500;
  res.status(status).json({
    code: err.code || 1,
    message: err.message || '服务器内部错误',
    data: null,
  });
}

module.exports = { ok, fail, asyncHandler, errorHandler };
