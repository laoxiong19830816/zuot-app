#!/usr/bin/env node
/**
 * Dart 静态符号检查（无 Flutter SDK 时的兜底工具）
 * ------------------------------------------------------------
 * 目的：在本机没有 Flutter SDK 的情况下，尽可能提前发现
 *       `flutter analyze` 会报 error 的问题：
 *
 *   1) 引用了不存在的「类 / 顶层常量 / 顶层函数 / enum」
 *   2) 访问了不存在的成员：AppColors.x / Sp.x / Fs.x / Fw.x / Rd.x / Sz.x / Fmt.x
 *   3) 括号 / 方括号 / 花括号不配对（粗粒度）
 *   4) 常见坏味道：废弃字段 *PriceCents、金额用 double 等
 *
 * 用法：node scripts/dart-symcheck.js
 * 退出码：0 = 没发现问题；1 = 有问题
 */
const fs = require('fs');
const path = require('path');

const LIB = path.join(__dirname, '..', 'client', 'lib');

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.dart')) out.push(p);
  }
  return out;
}

const files = walk(LIB);
const src = new Map();
for (const f of files) src.set(f, fs.readFileSync(f, 'utf8'));

// ---------- 1. 收集顶层定义 ----------
const defined = new Set();
const classMembers = new Map(); // ClassName -> Set(member names)

for (const [f, s] of src) {
  // class / enum / mixin / typedef 名
  for (const m of s.matchAll(/^\s*(?:abstract\s+)?(?:class|enum|mixin|typedef|extension)\s+([A-Za-z_][A-Za-z0-9_]*)/gm)) {
    defined.add(m[1]);
  }
  // 顶层 const / final 变量（形如 `const double x = 1;` `static const int y = 2;`）
  for (const m of s.matchAll(/^\s*(?:static\s+)?(?:const|final)\s+[A-Za-z0-9_<>?,\s\[\]]*?\s+([A-Za-z_][A-Za-z0-9_]*)\s*=/gm)) {
    defined.add(m[1]);
  }
  // 顶层函数 / 方法名
  for (const m of s.matchAll(/^\s*(?:static\s+)?(?:void|String|int|double|bool|num|Future<[^>]*>|[A-Z][A-Za-z0-9_<>?,\s\[\]]*)\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/gm)) {
    defined.add(m[1]);
  }
}

// ---------- 2. 收集「类.成员」形式的可用成员 ----------
// 针对 AppColors / Sp / Fs / Fw / Rd / Sz / Fmt / Sh 这类常量容器
const containerMembers = new Map();
for (const [f, s] of src) {
  const classBodies = [...s.matchAll(/(?:abstract\s+)?class\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{([\s\S]*?)\n\}/g)];
  for (const [, cls, body] of classBodies) {
    if (!classMembers.has(cls)) classMembers.set(cls, new Set());
    const set = classMembers.get(cls);
    for (const m of body.matchAll(/^\s*(?:static\s+)?(?:const|final|late\s+final)?\s*[A-Za-z0-9_<>?,\s\[\]]*?\s+([A-Za-z_][A-Za-z0-9_]*)\s*[=;(]/gm)) {
      set.add(m[1]);
    }
    for (const m of body.matchAll(/^\s*(?:static\s+)?(?:const\s+)?[A-Za-z0-9_<>?,\s\[\]]*?\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/gm)) {
      set.add(m[1]);
    }
    containerMembers.set(cls, set);
  }
}

const problems = [];
const warnings = [];

// ---------- 3. 检查 Xxx.member 引用 ----------
const KNOWN_CONTAINERS = new Set(Object.keys(Object.fromEntries(containerMembers)));
for (const [f, s] of src) {
  const rel = path.relative(LIB, f);
  for (const m of s.matchAll(/\b([A-Z][A-Za-z0-9_]*)\.([a-z][A-Za-z0-9_]*)/g)) {
    const [, cls, member] = m;
    if (!KNOWN_CONTAINERS.has(cls)) continue;
    const avail = containerMembers.get(cls);
    if (!avail.has(member)) {
      // 可能是 Color/Theme 之类的 Flutter 内部成员，跳过常见误报
      if (['of', 'maybeOf', 'from', 'lerp', 'values', 'parse', 'now'].includes(member)) continue;
      problems.push(`${rel}: 找不到 ${cls}.${member}（该类里没有这个成员）`);
    }
  }
}

// ---------- 4. 检查大驼峰标识符是否有定义 ----------
const DART_BUILTIN = new Set([
  'String', 'int', 'double', 'bool', 'num', 'List', 'Map', 'Set', 'Future', 'Object', 'dynamic',
  'Iterable', 'DateTime', 'Duration', 'RegExp', 'Null', 'VoidCallback', 'Function', 'Type',
  'MaterialApp', 'Scaffold', 'AppBar', 'Text', 'Column', 'Row', 'Padding', 'SizedBox', 'Center',
  'Container', 'ListView', 'Expanded', 'Flexible', 'Stack', 'Positioned', 'Wrap', 'Card', 'Icon',
  'Icons', 'Colors', 'Theme', 'ThemeData', 'TextStyle', 'FontWeight', 'Color', 'EdgeInsets',
  'EdgeInsetsGeometry', 'BorderRadius', 'Radius', 'Border', 'BorderSide', 'BoxDecoration', 'BoxShadow',
  'LinearGradient', 'Alignment', 'MainAxisAlignment', 'CrossAxisAlignment', 'MainAxisSize',
  'TextEditingController', 'TextField', 'InputDecoration', 'InputBorder', 'OutlineInputBorder',
  'ElevatedButton', 'TextButton', 'FilledButton', 'OutlinedButton', 'ButtonStyle', 'IconButton',
  'SnackBar', 'ScaffoldMessenger', 'Navigator', 'MaterialPageRoute', 'PageRoute', 'Route',
  'BuildContext', 'Widget', 'StatelessWidget', 'StatefulWidget', 'State', 'Key', 'ValueKey',
  'GlobalKey', 'Form', 'FormState', 'GlobalKey', 'Tab', 'DefaultTabController', 'TabBar', 'TabBarView',
  'RefreshIndicator', 'CircularProgressIndicator', 'LinearProgressIndicator', 'Divider',
  'AlertDialog', 'Dialog', 'showDialog', 'showModalBottomSheet', 'Switch', 'Checkbox', 'RadioListTile',
  'Radio', 'DropdownButton', 'DropdownMenuItem', 'PopupMenuButton', 'PopupMenuItem', 'ClipRRect',
  'InkWell', 'GestureDetector', 'SingleChildScrollView', 'SafeArea', 'BottomNavigationBar',
  'NavigationBar', 'NavigationDestination', 'FloatingActionButton', 'Tooltip', 'Spacer', 'Opacity',
  'AnimatedContainer', 'AnimatedOpacity', 'Transform', 'RotatedBox', 'FittedBox', 'AspectRatio',
  'TextAlign', 'TextOverflow', 'TextWidthBasis', 'BoxConstraints', 'BoxFit', 'Image', 'AssetImage',
  'DecorationImage', 'FontFeature', 'TextDirection', 'Locale', 'Locale', 'Brightness', 'MaterialColor',
  'ColorScheme', 'CardTheme', 'AppBarTheme', 'VisualDensity', 'TargetPlatform', 'Platform', 'ThemeMode',
  'TextTheme', 'ElevationOverlay', 'NoImplicitAnimations', 'IconData', 'Curve', 'Curves', 'Animation',
  'AnimationController', 'TickerProvider', 'SingleTickerProviderStateMixin', 'Tween', 'ColorTween',
  'Offset', 'Size', 'Rect', 'FractionalOffset', 'TextSpan', 'RichText', 'TextPainter', 'mustCallSuper',
  'visibleForTesting', 'protected', 'immutable', 'Deprecated', 'optionalTypeArgs', 'nonVirtual',
  'Decimal', 'Random', 'StringBuffer', 'Comparable', 'Exception', 'Error', 'FormatException',
  'ArgumentError', 'StateError', 'UnsupportedError', 'AssertionError', 'RangeError', 'StackTrace',
  'WidgetsBinding', 'SchedulerBinding', 'FutureBuilder', 'StreamBuilder', 'Stream', 'StreamController',
  'Timer', 'Completer', 'print', 'assert', 'identical', 'hashCode', 'toString', 'runtimeType',
  'JsonCodec', 'jsonDecode', 'jsonEncode', 'utf8', 'base64', 'Uint8List', 'ByteData',
  'ChangeNotifier', 'Listenable', 'ValueNotifier', 'InheritedWidget', 'LayoutBuilder',
  'SliverList', 'SliverToBoxAdapter', 'CustomScrollView', 'NestedScrollView', 'ScrollController',
  'NotificationListener', 'ScrollNotification', 'WillPopScope', 'BackButton', 'CloseButton',
  'CupertinoColors', 'CupertinoThemeData', 'ButtonStyleButton', 'MaterialStateProperty',
  'WidgetStateProperty', 'MaterialState', 'WidgetState', 'BorderRadiusGeometry', 'ShapeBorder',
  'RoundedRectangleBorder', 'StadiumBorder', 'CircleBorder', 'ContinuousRectangleBorder',
  'LinearBorder', 'OutlinedBorder', 'TextScaler', 'MediaQuery', 'MediaQueryData', 'FocusScope',
  'FocusNode', 'TextInputType', 'TextInputAction', 'TextCapitalization', 'FilteringTextInputFormatter',
  'TextInputFormatter', 'LengthLimitingTextInputFormatter', 'AutovalidateMode', 'FormFieldValidator',
  'SelectableText', 'Semantics', 'ExcludeSemantics', 'MergeSemantics', 'BlockSemantics',
  'IndexedWidgetBuilder', 'WidgetBuilder', 'TransitionBuilder', 'ValueChanged', 'ValueGetter',
  'AsyncWidgetBuilder', 'AsyncSnapshot', 'ConnectionState', 'RouteSettings', 'ModalRoute',
  'PageController', 'PageView', 'IndexedStack', 'Offstage', 'AbsorbPointer', 'IgnorePointer',
  'FractionallySizedBox', 'IntrinsicHeight', 'IntrinsicWidth', 'UnconstrainedBox', 'Baseline',
  'ConstrainedBox', 'DecoratedBox', 'FractionalTranslation', 'LimitedBox', 'OverflowBox',
  'SizedOverflowBox', 'BackdropFilter', 'ImageFiltered', 'ShaderMask', 'Banner', 'CircleAvatar',
  'ColoredBox', 'CustomPaint', 'CustomSingleChildLayout', 'Directionality', 'Flow', 'GridPaper',
  'ListBody', 'ListWheelScrollView', 'Placeholder', 'RichText', 'RotatedBox', 'Table', 'TableView',
  'TwoDimensionalScrollView', 'WidgetInspector', 'AndroidViewSurface', 'PlatformViewSurface',
  'SliverPadding', 'SliverPersistentHeader', 'SliverAppBar', 'SliverGrid', 'SliverFillRemaining',
  'SliverSafeArea', 'SliverOverlapAbsorber', 'SliverVisibility', 'ReorderableListView',
  'Dismissible', 'DragTarget', 'Draggable', 'LongPressDraggable', 'AnimatedList',
  'AnimatedSwitcher', 'Hero', 'SlideTransition', 'FadeTransition', 'ScaleTransition',
  'SizeTransition', 'RotationTransition', 'PositionedTransition', 'AlignTransition',
  'DefaultTextStyle', 'AnimatedDefaultTextStyle', 'IconTheme', 'IconThemeData', 'DefaultAssetBundle',
  'RepaintBoundary', 'CompositedTransformTarget', 'CompositedTransformFollower', 'Overlay',
  'OverlayEntry', 'BannerLocation', 'Scrollbar', 'ScrollbarThemeData', 'CupertinoScrollbar',
  'Title', 'Shortcuts', 'Actions', 'CallbackShortcuts', 'UndoHistory', 'RestorationScope',
  'UnmanagedRestorationScope', 'RestorationBucket', 'FormField', 'TextFormField', 'DropdownButtonFormField',
  'Focus', 'FocusTraversalGroup', 'FocusOrder', 'NumericFocusOrder', 'LexicalFocusOrder',
  'DefaultFocusTraversal', 'ReadingOrderTraversalPolicy', 'OrderedTraversalPolicy',
  'TextSelectionTheme', 'InputDecorator', 'InputDecorationTheme', 'MaterialBanner', 'TooltipTheme',
  'TextButtonTheme', 'ElevatedButtonTheme', 'OutlinedButtonTheme', 'FilledButtonTheme',
  'IconButtonTheme', 'MenuAnchor', 'MenuBar', 'SubmenuButton', 'MenuItemButton', 'CheckboxTheme',
  'RadioTheme', 'SwitchTheme', 'SliderTheme', 'Slider', 'RangeSlider', 'ProgressIndicatorTheme',
  'Drawer', 'DrawerHeader', 'NavigationDrawer', 'NavigationRail', 'BottomAppBar', 'BottomSheet',
  'BottomSheetTheme', 'showBottomSheet', 'DatePicker', 'showDatePicker', 'TimePicker', 'showTimePicker',
  'DateRangePicker', 'showDateRangePicker', 'CalendarDatePicker', 'Stepper', 'Step', 'ExpansionPanel',
  'ExpansionPanelList', 'ExpansionTile', 'Chip', 'ChipTheme', 'InputChip', 'ChoiceChip',
  'FilterChip', 'ActionChip', 'CircleBorder', 'Tooltip', 'Card', 'DataTable', 'DataRow',
  'DataColumn', 'DataCell', 'PaginatedDataTable', 'TableRow', 'TableCell', 'TableBorder',
  'GridTile', 'GridTileBar', 'SliverGridDelegate', 'SliverGridDelegateWithFixedCrossAxisCount',
  'SliverGridDelegateWithMaxCrossAxisExtent', 'ScrollPhysics', 'AlwaysScrollableScrollPhysics',
  'NeverScrollableScrollPhysics', 'BouncingScrollPhysics', 'ClampingScrollPhysics',
  'RangeMaintainingScrollPhysics', 'PageScrollPhysics', 'FixedExtentScrollPhysics',
  'SafeArea', 'SliverLayoutBuilder', 'ScrollConfiguration', 'ScrollBehavior',
  'Notification', 'LayoutChangedNotification', 'SizeChangedLayoutNotification',
  'KeepAliveNotification', 'KeepAliveHandle', 'AutomaticKeepAliveClientMixin', 'KeepAlive',
  'AutofillGroup', 'AutofillHints', 'AutofillClient', 'SpellCheckConfiguration',
  'TextEditingValue', 'TextSelection', 'TextPosition', 'TextRange', 'TextAffinity',
  'TextInputClient', 'TextInputConnection', 'TextInputConfiguration', 'IME',
  'SystemChannels', 'SystemChrome', 'SystemUiOverlayStyle', 'SystemUiMode', 'DeviceOrientation',
  'ApplicationSwitcherDescription', 'HapticFeedback', 'FontLoader', 'ShaderWarmUp',
]);

for (const [f, s] of src) {
  const rel = path.relative(LIB, f);
  // 去掉字符串字面量和注释，减少误报
  const stripped = s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/r?'''[\s\S]*?'''/g, "''")
    .replace(/r?"""[\s\S]*?"""/g, '""');

  for (const m of stripped.matchAll(/\b([A-Z][A-Za-z0-9_]*)\b/g)) {
    const name = m[1];
    if (defined.has(name)) continue;
    if (DART_BUILTIN.has(name)) continue;
    if (KNOWN_CONTAINERS.has(name)) continue;
    problems.push(`${rel}: 引用了未定义的类型/常量 ${name}`);
  }
}

// ---------- 5. 括号配对 ----------
for (const [f, s] of src) {
  const rel = path.relative(LIB, f);
  const stripped = s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""');
  const pairs = [['(', ')'], ['[', ']'], ['{', '}']];
  for (const [open, close] of pairs) {
    const a = (stripped.match(new RegExp('\\' + open, 'g')) || []).length;
    const b = (stripped.match(new RegExp('\\' + close, 'g')) || []).length;
    if (a !== b) problems.push(`${rel}: ${open}${close} 数量不配对（${a} vs ${b}）`);
  }
}

// ---------- 6. 坏味道 ----------
for (const [f, s] of src) {
  const rel = path.relative(LIB, f);
  if (/\w*PriceCents|spreadCents\s*[:=]|costPriceCents/.test(s)) {
    warnings.push(`${rel}: 还在用废弃的 *Cents 价格字段（应改为 *Mills）`);
  }
}

// ---------- 输出 ----------
const uniq = [...new Set(problems)];
const uniqW = [...new Set(warnings)];
console.log(`扫描 ${files.length} 个 Dart 文件，收集到 ${defined.size} 个顶层符号、${KNOWN_CONTAINERS.size} 个常量容器\n`);
if (uniqW.length) {
  console.log('⚠️  坏味道：');
  for (const w of uniqW) console.log('  - ' + w);
  console.log('');
}
if (uniq.length) {
  console.log(`❌ 发现 ${uniq.length} 处可疑问题：`);
  for (const p of uniq.slice(0, 60)) console.log('  - ' + p);
  if (uniq.length > 60) console.log(`  ...还有 ${uniq.length - 60} 处`);
  process.exit(1);
} else {
  console.log('✅ 未发现明显的未定义符号 / 括号不配对问题');
}
