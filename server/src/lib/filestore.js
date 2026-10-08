/**
 * 文件存储引擎（Prisma 兼容层）
 * ==========================================================================
 * 为什么需要它：
 *   PostgreSQL / Prisma 的原生引擎二进制都是给 Linux 编译的，而老雄的开发机是
 *   鸿蒙 PC（process.platform === 'openharmony'，自研内核，不是 Linux），
 *   导致 PG、Docker、Prisma 全装不了。
 *
 *   本文件用**纯 JS + 一个 JSON 文件**实现出一套与 Prisma Client 用法一致的接口，
 *   业务代码（routes / services）一行都不用改：
 *       const prisma = require('./lib/prisma');   // 这句话不变
 *       await prisma.user.findMany({ where: {...} })
 *
 * 数据量考虑：
 *   个人做T记录一年也就几千条，JSON 文件几百 KB，全量读进内存完全没问题。
 *   每次写操作后原子落盘（写临时文件 + rename），不会出现写坏的情况。
 *
 * 已支持的 Prisma 语义（按本项目实际用到的全量清单实现）：
 *   方法：findMany / findUnique / findFirst / create / update / updateMany /
 *         upsert / delete / deleteMany / count / aggregate / groupBy /
 *         $transaction / $disconnect
 *   where：等值、null、gt/gte/lt/lte/not/in/contains/startsWith/OR/AND
 *          复合唯一键（如 userId_code、userId_date）
 *   orderBy：单字段或数组，asc/desc
 *   take / skip / select / include / select 内嵌 _count
 *
 * 注意：金额/价格一律是整数（分 / 厘），本层不做任何换算，原样存取。
 * ==========================================================================
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ---------------------------------------------------------------------------
// 一、模型元数据（与 prisma/schema.prisma 一一对应）
//     type: s=String  i=Int  f=Float  b=Boolean  d=DateTime  j=Json  e=枚举(存字符串)
// ---------------------------------------------------------------------------

const MODELS = {
  User: {
    key: 'users',
    fields: {
      id: { type: 's' },
      email: { type: 's' },
      phone: { type: 's' },
      passwordHash: { type: 's' },
      nickname: { type: 's' },
      role: { type: 'e', def: 'USER' },
      status: { type: 's', def: 'ACTIVE' },
      aiDailyLimit: { type: 'i', def: 20 },
      aiMonthlyLimit: { type: 'i', def: 400 },
      inviteCodeUsed: { type: 's', def: null },
      createdAt: { type: 'd', def: 'now' },
      lastLoginAt: { type: 'd', def: null },
    },
    // findUnique 可用的唯一键（复合键用下划线拼接，与 Prisma 一致）
    uniques: [['id'], ['email'], ['phone']],
    relations: {
      settings: { kind: 'one', model: 'UserSettings', fk: 'userId' },
      positions: { kind: 'many', model: 'Position', fk: 'userId' },
      flows: { kind: 'many', model: 'TradeFlow', fk: 'userId' },
      pairs: { kind: 'many', model: 'HedgePair', fk: 'userId' },
      analyses: { kind: 'many', model: 'AiAnalysis', fk: 'userId' },
      plans: { kind: 'many', model: 'Plan', fk: 'userId' },
      reviews: { kind: 'many', model: 'Review', fk: 'userId' },
      usages: { kind: 'many', model: 'AiUsageLog', fk: 'userId' },
      auditLogs: { kind: 'many', model: 'AdminAuditLog', fk: 'adminId' },
    },
  },

  UserSettings: {
    key: 'userSettings',
    fields: {
      id: { type: 's' },
      userId: { type: 's' },
      stockCommissionRate: { type: 'f', def: 0.000074 },
      stockMinCommissionCents: { type: 'i', def: 0 },
      stampTaxRate: { type: 'f', def: 0.0005 },
      transferFeeRate: { type: 'f', def: 0.00001 },
      etfCommissionRate: { type: 'f', def: 0.00005 },
      etfMinCommissionCents: { type: 'i', def: 0 },
      complianceMode: { type: 'b', def: false },
      maxTradePerDay: { type: 'i', def: 6 },
      maxLossStreak: { type: 'i', def: 3 },
      singleStopLossCents: { type: 'i', def: -20000 },
      pendingMaxDays: { type: 'i', def: 5 },
      positionLimitPct: { type: 'i', def: 40 },
      feeErosionAlertPct: { type: 'i', def: 30 },
      aiEnablePreopen: { type: 'b', def: true },
      aiEnableIntraday: { type: 'b', def: true },
      aiEnableClose: { type: 'b', def: true },
    },
    uniques: [['id'], ['userId']],
    relations: {
      user: { kind: 'one', model: 'User', fk: 'userId', localKey: 'id', selfFk: true },
    },
  },

  Position: {
    key: 'positions',
    fields: {
      id: { type: 's' },
      userId: { type: 's' },
      code: { type: 's' },
      name: { type: 's' },
      type: { type: 'e', def: 'STOCK' },
      baseQty: { type: 'i', def: 0 },
      availableQty: { type: 'i', def: 0 },
      costPriceMills: { type: 'i', def: 0 },
      initialCostMills: { type: 'i', def: 0 },
      realizedProfitCents: { type: 'i', def: 0 },
      lastPriceMills: { type: 'i', def: null },
      updatedAt: { type: 'd', def: 'now', updatedAt: true },
      createdAt: { type: 'd', def: 'now' },
    },
    uniques: [['id'], ['userId', 'code']],
    relations: {
      user: { kind: 'one', model: 'User', fk: 'userId', localKey: 'id', selfFk: true },
      flows: { kind: 'many', model: 'TradeFlow', fk: 'positionId' },
    },
  },

  TradeFlow: {
    key: 'tradeFlows',
    fields: {
      id: { type: 's' },
      userId: { type: 's' },
      positionId: { type: 's', def: null },
      code: { type: 's' },
      side: { type: 'e' },
      priceMills: { type: 'i' },
      qty: { type: 'i' },
      remainingQty: { type: 'i' },
      amountCents: { type: 'i' },
      commissionCents: { type: 'i' },
      stampTaxCents: { type: 'i' },
      transferFeeCents: { type: 'i' },
      totalFeeCents: { type: 'i' },
      tradedAt: { type: 'd' },
      note: { type: 's', def: null },
      status: { type: 'e', def: 'PENDING' },
      createdAt: { type: 'd', def: 'now' },
    },
    uniques: [['id']],
    relations: {
      user: { kind: 'one', model: 'User', fk: 'userId', localKey: 'id', selfFk: true },
      position: { kind: 'one', model: 'Position', fk: 'positionId', localKey: 'id', selfFk: true },
      buyPairs: { kind: 'many', model: 'HedgePair', fk: 'buyFlowId' },
      sellPairs: { kind: 'many', model: 'HedgePair', fk: 'sellFlowId' },
    },
  },

  HedgePair: {
    key: 'hedgePairs',
    fields: {
      id: { type: 's' },
      userId: { type: 's' },
      code: { type: 's' },
      buyFlowId: { type: 's' },
      sellFlowId: { type: 's' },
      qty: { type: 'i' },
      buyPriceMills: { type: 'i' },
      sellPriceMills: { type: 'i' },
      grossProfitCents: { type: 'i' },
      totalFeeCents: { type: 'i' },
      netProfitCents: { type: 'i' },
      returnRate: { type: 'f', def: 0 },
      openDate: { type: 'd' },
      hedgeDate: { type: 'd' },
      createdAt: { type: 'd', def: 'now' },
    },
    uniques: [['id']],
    relations: {
      user: { kind: 'one', model: 'User', fk: 'userId', localKey: 'id', selfFk: true },
      buyFlow: { kind: 'one', model: 'TradeFlow', fk: 'buyFlowId', localKey: 'id', selfFk: true },
      sellFlow: { kind: 'one', model: 'TradeFlow', fk: 'sellFlowId', localKey: 'id', selfFk: true },
    },
  },

  AiAnalysis: {
    key: 'aiAnalyses',
    fields: {
      id: { type: 's' },
      userId: { type: 's' },
      kind: { type: 'e' },
      code: { type: 's', def: null },
      title: { type: 's' },
      summary: { type: 's' },
      content: { type: 's' },
      model: { type: 's' },
      dataSnapshot: { type: 'j', def: null },
      tokensIn: { type: 'i', def: 0 },
      tokensOut: { type: 'i', def: 0 },
      success: { type: 'b', def: true },
      errorMsg: { type: 's', def: null },
      hitEvaluated: { type: 'b', def: false },
      hitResult: { type: 's', def: null },
      hitNote: { type: 's', def: null },
      createdAt: { type: 'd', def: 'now' },
    },
    uniques: [['id']],
    relations: {
      user: { kind: 'one', model: 'User', fk: 'userId', localKey: 'id', selfFk: true },
    },
  },

  Plan: {
    key: 'plans',
    fields: {
      id: { type: 's' },
      userId: { type: 's' },
      code: { type: 's' },
      date: { type: 'd' },
      direction: { type: 's' },
      buyTriggerPriceMills: { type: 'i', def: null },
      sellTargetPriceMills: { type: 'i', def: null },
      stopLossPriceMills: { type: 'i', def: null },
      qty: { type: 'i', def: null },
      maxTimes: { type: 'i', def: 2 },
      reason: { type: 's', def: null },
      createdAt: { type: 'd', def: 'now' },
    },
    uniques: [['id']],
    relations: {
      user: { kind: 'one', model: 'User', fk: 'userId', localKey: 'id', selfFk: true },
    },
  },

  Review: {
    key: 'reviews',
    fields: {
      id: { type: 's' },
      userId: { type: 's' },
      date: { type: 'd' },
      aiContent: { type: 's', def: null },
      executedPlan: { type: 'b', def: false },
      deviationReason: { type: 's', def: null },
      mistakeTags: { type: 's', def: null },
      emotion: { type: 's', def: null },
      improvement: { type: 's', def: null },
      createdAt: { type: 'd', def: 'now' },
    },
    uniques: [['id'], ['userId', 'date']],
    relations: {
      user: { kind: 'one', model: 'User', fk: 'userId', localKey: 'id', selfFk: true },
    },
  },

  InviteCode: {
    key: 'inviteCodes',
    fields: {
      id: { type: 's' },
      code: { type: 's' },
      maxUses: { type: 'i', def: 1 },
      usedCount: { type: 'i', def: 0 },
      expiresAt: { type: 'd', def: null },
      createdBy: { type: 's', def: null },
      disabled: { type: 'b', def: false },
      note: { type: 's', def: null },
      createdAt: { type: 'd', def: 'now' },
    },
    uniques: [['id'], ['code']],
    relations: {},
  },

  AiUsageLog: {
    key: 'aiUsageLogs',
    fields: {
      id: { type: 's' },
      userId: { type: 's' },
      kind: { type: 's' },
      model: { type: 's' },
      tokensIn: { type: 'i', def: 0 },
      tokensOut: { type: 'i', def: 0 },
      success: { type: 'b', def: true },
      createdAt: { type: 'd', def: 'now' },
    },
    uniques: [['id']],
    relations: {
      user: { kind: 'one', model: 'User', fk: 'userId', localKey: 'id', selfFk: true },
    },
  },

  AdminAuditLog: {
    key: 'adminAuditLogs',
    fields: {
      id: { type: 's' },
      adminId: { type: 's' },
      action: { type: 's' },
      targetId: { type: 's', def: null },
      detail: { type: 's', def: null },
      createdAt: { type: 'd', def: 'now' },
    },
    uniques: [['id']],
    relations: {
      admin: { kind: 'one', model: 'User', fk: 'adminId', localKey: 'id', selfFk: true },
    },
  },
};

// Prisma 客户端上的属性名 → 模型名
const CLIENT_KEY_TO_MODEL = {
  user: 'User',
  userSettings: 'UserSettings',
  position: 'Position',
  tradeFlow: 'TradeFlow',
  hedgePair: 'HedgePair',
  aiAnalysis: 'AiAnalysis',
  plan: 'Plan',
  review: 'Review',
  inviteCode: 'InviteCode',
  aiUsageLog: 'AiUsageLog',
  adminAuditLog: 'AdminAuditLog',
};

// ---------------------------------------------------------------------------
// 二、工具函数
// ---------------------------------------------------------------------------

/** 生成类似 cuid 的唯一 ID（够用、无依赖、不会重复） */
function newId() {
  const t = Date.now().toString(36);
  const r = crypto.randomBytes(9).toString('hex');
  return `c${t}${r}`;
}

const toTime = (v) => (v instanceof Date ? v.getTime() : v == null ? null : new Date(v).getTime());

/** 值比较：日期按时间戳比，其余直接比 */
function eq(a, b) {
  if (a instanceof Date || b instanceof Date) return toTime(a) === toTime(b);
  if (a === null || a === undefined) return b === null || b === undefined;
  if (typeof a === 'object' && typeof b === 'object') return JSON.stringify(a) === JSON.stringify(b);
  return a === b;
}

function cmp(a, b) {
  const x = a instanceof Date || b instanceof Date ? toTime(a) : a;
  const y = a instanceof Date || b instanceof Date ? toTime(b) : b;
  if (x == null || y == null) return NaN;
  if (x < y) return -1;
  if (x > y) return 1;
  return 0;
}

/** 把外部传入的 Date / 字符串统一成 Date 对象（读出来给业务代码用） */
function reviveDate(v) {
  if (v == null) return null;
  return v instanceof Date ? v : new Date(v);
}

// ---------------------------------------------------------------------------
// 三、存储核心
// ---------------------------------------------------------------------------

class FileStore {
  constructor(file) {
    this.file = file;
    this.data = this._load();
    this._txDepth = 0;
  }

  _empty() {
    const out = {};
    Object.values(MODELS).forEach((m) => {
      out[m.key] = [];
    });
    return out;
  }

  _load() {
    try {
      if (!fs.existsSync(this.file)) return this._empty();
      const raw = fs.readFileSync(this.file, 'utf8').trim();
      if (!raw) return this._empty();
      const parsed = JSON.parse(raw);
      // 补齐缺失的表，避免旧文件缺表导致崩溃
      const base = this._empty();
      return { ...base, ...parsed };
    } catch (e) {
      // 文件损坏时不要静默丢数据：改名备份后重新开始，并明确报出来
      const bak = `${this.file}.broken-${Date.now()}`;
      try {
        fs.renameSync(this.file, bak);
      } catch (_) {}
      console.error(`[filestore] 数据文件解析失败，已备份为 ${bak}：${e.message}`);
      return this._empty();
    }
  }

  /** 原子落盘：先写临时文件再 rename，避免中途断电写坏 */
  _save() {
    const dir = path.dirname(this.file);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 0), 'utf8');
    fs.renameSync(tmp, this.file);
  }

  /**
   * 事务：整体快照 + 失败回滚（数据量小，简单可靠比性能重要）
   * @param fn 业务回调，参数 tx 必须是与 prisma 同形的客户端对象（含各模型 delegate），
   *           所以由外层 createFileStore 把组装好的 client 传进来，不能传引擎自身。
   */
  async $transaction(fn, txClient) {
    const snapshot = JSON.stringify(this.data);
    this._txDepth += 1;
    try {
      const result = await fn(txClient || this);
      this._txDepth -= 1;
      this._save();
      return result;
    } catch (e) {
      // 回滚
      this.data = JSON.parse(snapshot);
      this._txDepth -= 1;
      throw e;
    }
  }

  async $disconnect() {
    this._save();
  }
  async $connect() {}
}

// ---------------------------------------------------------------------------
// 四、查询语义实现
// ---------------------------------------------------------------------------

/** where 条件匹配 */
function matchWhere(row, where, model) {
  if (!where) return true;

  return Object.entries(where).every(([key, cond]) => {
    if (key === 'OR') {
      const list = Array.isArray(cond) ? cond : [cond];
      return list.some((c) => matchWhere(row, c, model));
    }
    if (key === 'AND') {
      const list = Array.isArray(cond) ? cond : [cond];
      return list.every((c) => matchWhere(row, c, model));
    }
    if (key === 'NOT') {
      const list = Array.isArray(cond) ? cond : [cond];
      return !list.some((c) => matchWhere(row, c, model));
    }

    // 复合唯一键：where: { userId_code: { userId, code } }
    if (cond && typeof cond === 'object' && !(cond instanceof Date) && !Array.isArray(cond)) {
      const isCompound = model.uniques.some((u) => u.length > 1 && u.join('_') === key);
      if (isCompound) {
        return Object.entries(cond).every(([subK, subV]) => eq(row[subK], subV));
      }
    }

    const val = row[key];

    if (cond === null) return val === null || val === undefined;
    if (cond instanceof Date) return eq(val, cond);

    if (Array.isArray(cond)) {
      return Array.isArray(val) && JSON.stringify(val) === JSON.stringify(cond);
    }

    if (typeof cond === 'object') {
      return Object.entries(cond).every(([op, operand]) => {
        switch (op) {
          case 'equals':
            return eq(val, operand);
          case 'not':
            if (operand && typeof operand === 'object' && !(operand instanceof Date)) {
              return !matchWhere({ [key]: val }, { [key]: operand }, model);
            }
            return !eq(val, operand);
          case 'gt':
            return cmp(val, operand) > 0;
          case 'gte':
            return cmp(val, operand) >= 0;
          case 'lt':
            return cmp(val, operand) < 0;
          case 'lte':
            return cmp(val, operand) <= 0;
          case 'in':
            return (operand || []).some((o) => eq(val, o));
          case 'notIn':
            return !(operand || []).some((o) => eq(val, o));
          case 'contains':
            return String(val ?? '').includes(String(operand));
          case 'startsWith':
            return String(val ?? '').startsWith(String(operand));
          case 'endsWith':
            return String(val ?? '').endsWith(String(operand));
          default:
            throw new Error(`[filestore] 暂不支持的查询运算符：${op}（字段 ${key}）`);
        }
      });
    }

    return eq(val, cond);
  });
}

/** orderBy 排序：支持 {a:'desc'} 或 [{a:'asc'},{b:'desc'}] */
function applyOrderBy(rows, orderBy) {
  if (!orderBy) return rows;
  const list = Array.isArray(orderBy) ? orderBy : [orderBy];
  const clean = list.filter(Boolean);
  if (!clean.length) return rows;
  return rows.slice().sort((a, b) => {
    for (const item of clean) {
      const [field, dir] = Object.entries(item)[0] || [];
      if (!field) continue;
      const c = cmp(a[field], b[field]);
      if (Number.isNaN(c) || c === 0) continue;
      return dir === 'desc' ? -c : c;
    }
    return 0;
  });
}

/** 把存储里的原始行还原成业务看到的样子（日期转 Date，Json 字段保持对象） */
function hydrate(row, model) {
  const out = {};
  for (const [f, meta] of Object.entries(model.fields)) {
    const v = row === undefined ? undefined : row[f];
    if (meta.type === 'd') out[f] = v == null ? null : reviveDate(v);
    else out[f] = v === undefined ? (meta.def === undefined ? null : meta.def) : v;
  }
  return out;
}

/** 计算 select / include / _count */
function shape(row, model, args, store) {
  const out = {};

  // ---- select：只保留指定字段（Prisma 语义是「白名单」）----
  if (args && args.select) {
    for (const [k, v] of Object.entries(args.select)) {
      if (k === '_count') {
        out._count = computeCount(row, model, v, store);
        continue;
      }
      if (!v) continue;
      const rel = model.relations[k];
      if (rel) {
        // select 里也能写关系（本项目暂未用到，保底实现）
        out[k] = resolveRelation(row, model, rel, store, typeof v === 'object' ? v : undefined);
      } else {
        out[k] = row[k];
      }
    }
    return out;
  }

  // ---- 默认：全部标量字段 ----
  Object.assign(out, row);

  // ---- include：附加关系 ----
  if (args && args.include) {
    for (const [k, v] of Object.entries(args.include)) {
      if (k === '_count') {
        out._count = computeCount(row, model, v, store);
        continue;
      }
      if (!v) continue;
      const rel = model.relations[k];
      if (!rel) continue;
      out[k] = resolveRelation(row, model, rel, store, typeof v === 'object' ? v : undefined);
    }
  }

  return out;
}

function computeCount(row, model, spec, store) {
  const out = {};
  const selects = (spec && spec.select) || {};
  for (const [k, v] of Object.entries(selects)) {
    if (!v) {
      out[k] = 0;
      continue;
    }
    const rel = model.relations[k];
    out[k] = rel ? countRelation(row, model, rel, store) : 0;
  }
  return out;
}

/** 取关系数据（one / many），可带子级 select */
function resolveRelation(row, model, rel, store, subArgs) {
  const target = MODELS[rel.model];
  const rows = store.data[target.key] || [];

  let found;
  if (rel.selfFk) {
    // 外键在本表：如 AdminAuditLog.adminId → User.id
    const fkVal = row[rel.fk];
    const hit = rows.find((r) => eq(r.id, fkVal));
    found = rel.kind === 'one' ? hit || null : hit ? [hit] : [];
  } else {
    // 外键在对方表：如 UserSettings.userId → User.id
    const localVal = row[rel.localKey || 'id'];
    const hits = rows.filter((r) => eq(r[rel.fk], localVal));
    found = rel.kind === 'one' ? hits[0] || null : hits;
  }

  if (found == null) return null;
  if (Array.isArray(found)) {
    return found.map((r) => shape(hydrate(r, target), target, subArgs, store));
  }
  return shape(hydrate(found, target), target, subArgs, store);
}

function countRelation(row, model, rel, store) {
  const target = MODELS[rel.model];
  const rows = store.data[target.key] || [];
  if (rel.selfFk) {
    const fkVal = row[rel.fk];
    return rows.filter((r) => eq(r.id, fkVal)).length;
  }
  const localVal = row[rel.localKey || 'id'];
  return rows.filter((r) => eq(r[rel.fk], localVal)).length;
}

// ---------------------------------------------------------------------------
// 五、模型 delegate（业务代码 prisma.user.xxx 直接用这套）
// ---------------------------------------------------------------------------

function makeDelegate(store, modelName) {
  const model = MODELS[modelName];
  const table = () => store.data[model.key] || (store.data[model.key] = []);

  /** 找出 findUnique 用的唯一键（返回条件对象里的那个字段组合） */
  function uniqueWhere(where) {
    for (const u of model.uniques) {
      const single = u.length === 1 ? u[0] : null;
      if (single && where[single] !== undefined) return { fields: u, values: [where[single]] };
      if (u.length > 1) {
        const compoundKey = u.join('_');
        if (where[compoundKey] !== undefined) {
          return { fields: u, values: u.map((f) => where[compoundKey][f]) };
        }
      }
    }
    // 没命中唯一键（Prisma 会直接报错，这里给出明确提示方便排查）
    throw new Error(
      `[filestore] ${modelName}.findUnique 需要一个唯一键（可用：${model.uniques
        .map((u) => u.join('_'))
        .join(' / ')}），实际传入：${JSON.stringify(Object.keys(where || {}))}`
    );
  }

  /** 写入前补默认值 + 生成 id */
  function buildRow(data) {
    const row = {};
    for (const [f, meta] of Object.entries(model.fields)) {
      if (data[f] !== undefined) {
        row[f] = meta.type === 'd' ? toTime(data[f]) : data[f];
      } else if (meta.def === 'now') {
        row[f] = Date.now();
      } else if (meta.def !== undefined) {
        row[f] = meta.def === null ? null : meta.def;
      } else {
        row[f] = null;
      }
    }
    if (!row.id) row.id = newId();
    return row;
  }

  return {
    async findMany(args = {}) {
      let rows = table().filter((r) => matchWhere(r, args.where, model));
      rows = applyOrderBy(rows, args.orderBy);
      if (args.skip) rows = rows.slice(args.skip);
      if (args.take !== undefined && args.take !== null) rows = rows.slice(0, args.take);
      return rows.map((r) => shape(hydrate(r, model), model, args, store));
    },

    async findFirst(args = {}) {
      const rows = await this.findMany({ ...args, take: 1 });
      return rows.length ? rows[0] : null;
    },

    async findUnique(args = {}) {
      const { fields, values } = uniqueWhere(args.where || {});
      const hit = table().find((r) => fields.every((f, i) => eq(r[f], values[i])));
      return hit ? shape(hydrate(hit, model), model, args, store) : null;
    },

    async count(args = {}) {
      return table().filter((r) => matchWhere(r, args.where, model)).length;
    },

    async create(args = {}) {
      const row = buildRow(args.data || {});
      table().push(row);
      if (!store._txDepth) store._save();
      return shape(hydrate(row, model), model, args, store);
    },

    async createMany(args = {}) {
      const list = Array.isArray(args.data) ? args.data : [args.data];
      const rows = list.map((d) => buildRow(d));
      table().push(...rows);
      if (!store._txDepth) store._save();
      return { count: rows.length };
    },

    async update(args = {}) {
      const { fields, values } = uniqueWhere(args.where || {});
      const hit = table().find((r) => fields.every((f, i) => eq(r[f], values[i])));
      if (!hit) throw new Error(`[filestore] ${modelName}.update 找不到记录：${JSON.stringify(args.where)}`);

      for (const [f, v] of Object.entries(args.data || {})) {
        if (v === undefined) continue;
        const meta = model.fields[f];
        if (!meta) continue; // 忽略未知字段，避免脏数据写进去
        hit[f] = meta.type === 'd' ? toTime(v) : v;
      }
      // @updatedAt 自动维护
      for (const [f, meta] of Object.entries(model.fields)) {
        if (meta.updatedAt) hit[f] = Date.now();
      }
      if (!store._txDepth) store._save();
      return shape(hydrate(hit, model), model, args, store);
    },

    async updateMany(args = {}) {
      const rows = table().filter((r) => matchWhere(r, args.where, model));
      for (const hit of rows) {
        for (const [f, v] of Object.entries(args.data || {})) {
          if (v === undefined) continue;
          const meta = model.fields[f];
          if (!meta) continue;
          hit[f] = meta.type === 'd' ? toTime(v) : v;
        }
        for (const [f, meta] of Object.entries(model.fields)) {
          if (meta.updatedAt) hit[f] = Date.now();
        }
      }
      if (!store._txDepth) store._save();
      return { count: rows.length };
    },

    async upsert(args = {}) {
      // upsert 的 where 一定是唯一键
      let found = null;
      try {
        const { fields, values } = uniqueWhere(args.where || {});
        found = table().find((r) => fields.every((f, i) => eq(r[f], values[i]))) || null;
      } catch (_) {
        found = null;
      }
      if (found) {
        return this.update({ where: args.where, data: args.update || {} });
      }
      // create 时要补上 where 里带的唯一键值（Prisma 语义）
      const data = { ...(args.create || {}) };
      const w = args.where || {};
      for (const u of model.uniques) {
        if (u.length === 1 && w[u[0]] !== undefined) data[u[0]] = w[u[0]];
        if (u.length > 1 && w[u.join('_')] !== undefined) {
          Object.assign(data, w[u.join('_')]);
        }
      }
      return this.create({ data });
    },

    async delete(args = {}) {
      const { fields, values } = uniqueWhere(args.where || {});
      const idx = table().findIndex((r) => fields.every((f, i) => eq(r[f], values[i])));
      if (idx < 0) throw new Error(`[filestore] ${modelName}.delete 找不到记录：${JSON.stringify(args.where)}`);
      const [removed] = table().splice(idx, 1);
      if (!store._txDepth) store._save();
      return shape(hydrate(removed, model), model, args, store);
    },

    async deleteMany(args = {}) {
      const list = table();
      const keep = [];
      let removed = 0;
      for (const r of list) {
        if (matchWhere(r, args.where, model)) removed += 1;
        else keep.push(r);
      }
      store.data[model.key] = keep;
      if (!store._txDepth) store._save();
      return { count: removed };
    },

    /** aggregate：本项目只用到 _sum 与 _count */
    async aggregate(args = {}) {
      const rows = table().filter((r) => matchWhere(r, args.where, model));
      const out = {};
      if (args._sum) {
        out._sum = {};
        for (const [f, v] of Object.entries(args._sum)) {
          if (!v) continue;
          out._sum[f] = rows.length
            ? rows.reduce((s, r) => s + Number(r[f] || 0), 0)
            : null; // Prisma 在无记录时 _sum 返回 null
        }
      }
      if (args._count) {
        if (args._count === true || args._count._all) out._count = rows.length;
        else {
          out._count = {};
          for (const [f, v] of Object.entries(args._count)) {
            if (v) out._count[f] = rows.filter((r) => r[f] != null).length;
          }
        }
      }
      if (args._avg) {
        out._avg = {};
        for (const [f, v] of Object.entries(args._avg)) {
          if (!v) continue;
          out._avg[f] = rows.length ? rows.reduce((s, r) => s + Number(r[f] || 0), 0) / rows.length : null;
        }
      }
      return out;
    },

    /** groupBy：本项目用到 { by:['code'], _count:{_all:true} } */
    async groupBy(args = {}) {
      const rows = table().filter((r) => matchWhere(r, args.where, model));
      const by = args.by || [];
      const groups = new Map();
      for (const r of rows) {
        const key = JSON.stringify(by.map((f) => r[f]));
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(r);
      }
      let out = [...groups.values()].map((groupRows) => {
        const item = {};
        for (const f of by) item[f] = hydrate(groupRows[0], model)[f];
        if (args._count) {
          if (args._count === true || args._count._all) item._count = { _all: groupRows.length };
          else {
            item._count = {};
            for (const [f, v] of Object.entries(args._count)) {
              if (v) item._count[f] = groupRows.filter((r) => r[f] != null).length;
            }
          }
        }
        if (args._sum) {
          item._sum = {};
          for (const [f, v] of Object.entries(args._sum)) {
            if (v) item._sum[f] = groupRows.reduce((s, r) => s + Number(r[f] || 0), 0);
          }
        }
        return item;
      });
      if (args.orderBy) out = applyOrderBy(out, args.orderBy);
      if (args.take !== undefined) out = out.slice(0, args.take);
      return out;
    },
  };
}

// ---------------------------------------------------------------------------
// 六、组装出「长得像 PrismaClient」的对象
// ---------------------------------------------------------------------------

function createFileStore(file) {
  const store = new FileStore(file);
  const client = {
    $transaction: (fn) => store.$transaction(fn, client),
    $disconnect: () => store.$disconnect(),
    $connect: () => store.$connect(),
    /** 便于排查：当前数据文件路径 */
    $dataFile: file,
    /** 危险操作：清空（仅脚本用） */
    $reset: () => {
      store.data = store._empty();
      store._save();
    },
  };
  for (const [clientKey, modelName] of Object.entries(CLIENT_KEY_TO_MODEL)) {
    client[clientKey] = makeDelegate(store, modelName);
  }
  return client;
}

module.exports = { createFileStore, MODELS, CLIENT_KEY_TO_MODEL };
