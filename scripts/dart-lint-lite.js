#!/usr/bin/env node
/**
 * 极简 Dart 冒烟检查（本机没有 Flutter SDK 时的兜底手段）
 * ------------------------------------------------------------
 * 不能替代 `flutter analyze`，但能抓出最致命的低级错误：
 *   1. 大括号 / 小括号 / 方括号不配对
 *   2. 字符串引号未闭合
 *   3. 常见笔误：把 GradientButton 的 onPressed 写成 onTap 之类（白名单校验）
 *   4. 仍在引用已废弃的「分」价格字段（*PriceCents / *Cents 价格类）
 *
 * 用法：node scripts/dart-lint-lite.js [目录]
 */
const fs = require('fs');
const path = require('path');

const ROOT = process.argv[2] || path.join(__dirname, '..', 'client', 'lib');

/** 已废弃的价格字段（后端已全面改 Mills「厘」，前端必须同步） */
const DEPRECATED_PRICE_FIELDS = [
  'costPriceCents',
  'initialCostCents',
  'lastPriceCents',
  'priceCents',
  'buyPriceCents',
  'sellPriceCents',
  'counterpartPriceCents',
  'spreadCents',
  'breakEvenSpreadCents',
];

/** 组件参数名白名单：ctor -> 允许的参数名集合（防止 onPressed/onTap 写反） */
const PARAM_WHITELIST = [
  { re: /GradientButton\s*\(/, allowed: ['onPressed'], forbidden: ['onTap'] },
  { re: /AppCard\s*\(/, allowed: ['onTap'], forbidden: ['onPressed'] },
  { re: /EmptyState\s*\(/, allowed: ['onAction'], forbidden: ['onPressed', 'onTap'] },
];

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (name.endsWith('.dart')) out.push(p);
  }
  return out;
}

/** 去掉注释与字符串字面量后的「骨架」，用于括号计数 */
function skeleton(src) {
  let s = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const c2 = src[i + 1];
    if (c === '/' && c2 === '/') {
      while (i < n && src[i] !== '\n') i += 1;
      continue;
    }
    if (c === '/' && c2 === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'") {
      const quote = c;
      // 三引号（Dart 的 ''' 或 """）
      if (src[i + 1] === quote && src[i + 2] === quote) {
        i += 3;
        while (i < n && !(src[i] === quote && src[i + 1] === quote && src[i + 2] === quote)) i += 1;
        i += 3;
        continue;
      }
      i += 1;
      let closed = false;
      while (i < n) {
        if (src[i] === '\\') {
          i += 2;
          continue;
        }
        if (src[i] === quote) {
          i += 1;
          closed = true;
          break;
        }
        if (src[i] === '\n') break; // 单引号字符串不跨行
        i += 1;
      }
      if (!closed) return { error: `第 ${src.slice(0, i).split('\n').length} 行：字符串未闭合（${quote}）` };
      s += '""';
      continue;
    }
    s += c;
    i += 1;
  }
  return { src: s };
}

function checkBrackets(src, file) {
  const sk = skeleton(src);
  if (sk.error) return [sk.error];
  const s = sk.src;
  const pairs = { ')': '(', ']': '[', '}': '{' };
  const stack = [];
  const lineOf = (idx) => s.slice(0, idx).split('\n').length;
  const errs = [];
  for (let i = 0; i < s.length; i += 1) {
    const c = s[i];
    if (c === '(' || c === '[' || c === '{') stack.push({ c, i });
    else if (c in pairs) {
      const top = stack.pop();
      if (!top || top.c !== pairs[c]) {
        errs.push(`第 ${lineOf(i)} 行：多余的 "${c}"${top ? `，期望匹配 "${top.c}"（开于第 ${lineOf(top.i)} 行）` : ''}`);
        if (errs.length > 4) break;
      }
    }
  }
  if (stack.length) {
    for (const t of stack.slice(0, 5)) {
      errs.push(`第 ${lineOf(t.i)} 行：未闭合的 "${t.c}"`);
    }
  }
  return errs.map((e) => `${file} → ${e}`);
}

function checkDeprecated(src, file) {
  const lines = src.split('\n');
  const errs = [];
  lines.forEach((line, idx) => {
    if (line.trimStart().startsWith('//')) return;
    for (const f of DEPRECATED_PRICE_FIELDS) {
      // 允许出现在注释里说明「不要用 X」的情况
      if (line.includes(f) && !line.includes('已废弃')) {
        errs.push(`${file}:${idx + 1} 仍在引用废弃字段 ${f}（后端已改 Mills，请改用 Fmt.price + *Mills）`);
      }
    }
  });
  return errs;
}

function checkParams(src, file) {
  const errs = [];
  for (const rule of PARAM_WHITELIST) {
    const m = src.match(rule.re);
    if (!m) continue;
    // 粗略截取构造调用后 600 字符
    const seg = src.slice(m.index, m.index + 600);
    for (const bad of rule.forbidden) {
      if (new RegExp(`\\b${bad}\\s*:`).test(seg)) {
        errs.push(`${file} → ${m[0].replace('(', '')} 不支持参数 "${bad}"，应为 ${rule.allowed.join(' / ')}`);
      }
    }
  }
  return errs;
}

const files = walk(ROOT);
const all = [];
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  all.push(...checkBrackets(src, f));
  all.push(...checkDeprecated(src, f));
  all.push(...checkParams(src, f));
}

if (all.length === 0) {
  console.log(`✅ 冒烟检查通过：${files.length} 个 Dart 文件，括号配对 / 字符串闭合 / 废弃字段 / 组件参数 均无问题`);
  process.exit(0);
}
console.log(`❌ 发现 ${all.length} 个问题：`);
all.forEach((e) => console.log('   ' + e));
process.exit(1);
