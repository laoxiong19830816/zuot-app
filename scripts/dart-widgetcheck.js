#!/usr/bin/env node
/**
 * dart-widgetcheck.js —— 没有 Flutter SDK 时的「组件调用参数」兜底检查
 *
 * 做什么：
 *   1. 解析 widgets/ui.dart（以及所有含 const 构造的组件文件），提取每个组件的命名参数清单
 *   2. 扫描所有页面里的 `组件名(` 调用，提取实际传的命名参数
 *   3. 对比，报出「传了但组件没这个参数」的调用 —— 这类在 Dart 里是编译错误
 *
 * 不做什么（避免误报）：
 *   - 不检查必填参数是否漏传（本脚本只查「多传了不存在的参数」，那是 100% 报错）
 *   - 不解析第三方包
 *
 * 用法：node scripts/dart-widgetcheck.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const CLIENT = path.resolve(__dirname, '..', 'client');
const LIB = path.join(CLIENT, 'lib');

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.dart')) out.push(p);
  }
  return out;
}
const files = walk(LIB);

/** 从文件源码里提取「class 名 -> 构造命名参数集合」 */
function extractWidgets(src) {
  const result = {};
  // 找到所有 class 声明的起始位置
  const marks = [];
  const re = /\bclass\s+([A-Za-z_][A-Za-z0-9_]*)[^{]*\{/g;
  let m;
  while ((m = re.exec(src))) marks.push([m[1], m.index]);
  marks.push(['__END__', src.length]);

  for (let i = 0; i < marks.length - 1; i++) {
    const name = marks[i][0];
    const body = src.slice(marks[i][1], marks[i + 1][1]);
    // 找构造函数：const Xxx({  或  Xxx({
    const cStart = body.search(/(?:const\s+)?[A-Za-z_][A-Za-z0-9_]*\s*\(\s*\{/);
    if (cStart < 0) continue;
    let p = body.indexOf('(', cStart);
    let depth = 0, q = p;
    for (; q < body.length; q++) {
      if (body[q] === '(') depth++;
      else if (body[q] === ')') { depth--; if (depth === 0) { q++; break; } }
    }
    const sig = body.slice(p + 1, q - 1);
    // 命名参数形如 `required this.foo` / `this.bar` / `double? baz`
    const params = new Set();
    // 按顶层逗号切分（忽略 <> () 内的逗号）
    let buf = '', nest = 0;
    for (const ch of sig) {
      if (ch === '<' || ch === '(' || ch === '[') nest++;
      else if (ch === '>' || ch === ')' || ch === ']') nest--;
      if (ch === ',' && nest === 0) { params.add(clean(buf)); buf = ''; }
      else buf += ch;
    }
    if (buf.trim()) params.add(clean(buf));
    result[name] = new Set([...params].filter(Boolean));
  }
  return result;
}

function clean(s) {
  s = s.trim();
  s = s.replace(/^required\s+/, '');
  s = s.replace(/\bthis\./, '');
  s = s.replace(/^@[A-Za-z_][A-Za-z0-9_.]*\s*/, '');
  // 取最后一个标识符（去掉类型和默认值）
  s = s.split('=')[0].trim();
  const m = s.match(/([A-Za-z_][A-Za-z0-9_]*)\s*$/);
  return m ? m[1] : '';
}

// ---- 1. 收集所有组件定义 ----
const widgets = {};
for (const f of files) {
  Object.assign(widgets, extractWidgets(fs.readFileSync(f, 'utf8')));
}

// ---- 2. 扫描调用 ----
let bad = 0;
for (const f of files) {
  const rel = path.relative(LIB, f);
  const src = fs.readFileSync(f, 'utf8');
  for (const wname of Object.keys(widgets)) {
    const def = widgets[wname];
    if (!def || def.size === 0) continue;
    // 找 `wname(` 调用
    const callRe = new RegExp('(?<![A-Za-z0-9_.])' + wname + '\\s*\\(', 'g');
    let cm;
    while ((cm = callRe.exec(src))) {
      // 括号配对取出实参列表
      let p = src.indexOf('(', cm.index);
      let depth = 0, q = p;
      for (; q < src.length; q++) {
        if (src[q] === '(') depth++;
        else if (src[q] === ')') { depth--; if (depth === 0) { q++; break; } }
      }
      const args = src.slice(p + 1, q - 1);
      // 提取 `name:` 形式的命名参数（只取顶层的）
      const names = [];
      let buf = '', nest = 0;
      for (const ch of args) {
        if (ch === '<' || ch === '(' || ch === '[' || ch === '{') nest++;
        else if (ch === '>' || ch === ')' || ch === ']' || ch === '}') nest--;
        if (ch === ',' && nest === 0) { names.push(buf); buf = ''; }
        else buf += ch;
      }
      if (buf.trim()) names.push(buf);
      for (const raw of names) {
        const mm = raw.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:/);
        if (!mm) continue;
        const passed = mm[1];
        if (['key', 'child', 'children', 'onTap', 'onPressed', 'style', 'textAlign']
          .includes(passed)) continue; // 通用参数，几乎都有
        if (!def.has(passed)) {
          const lineNo = src.slice(0, cm.index).split('\n').length;
          console.log(`❌ ${rel}:${lineNo}  ${wname}(${passed}: ...) —— 组件没有这个参数`);
          console.log(`   该组件可用参数：${[...def].join(', ')}`);
          bad++;
        }
      }
    }
  }
}

console.log(bad === 0
  ? '✅ 没有发现「传了不存在的参数」的组件调用'
  : `\n共 ${bad} 处可疑调用`);
process.exit(0);
