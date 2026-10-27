#!/usr/bin/env node
// 把 shell.html + 各方向的 art 合成自包含 HTML。
// 产出：demos/office/chars/d1.html / d2.html
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(HERE, '..');
const shell = fs.readFileSync(path.join(HERE, 'shell.html'), 'utf8');

const chips = (...a) => a.map((x) => `<span class="spec">${x}</span>`).join('');

const DIRS = [
  {
    file: 'd1.html',
    art: 'd1.art.js',
    title: '圆角小人',
    kicker: '方向 A · 员工办公室 / 侧栏角色',
    lede: '把「人」放在第一眼：大头、亮脸、实心眼，家具只留一把椅背。衣服和头饰各一个颜色，皮肤永远是最亮的底色 —— 所以暗色主题下也不会糊成一团灰。',
    specs: chips('头身 <b>1:1.4</b>', '头宽 <b>1.15×</b> 身宽', '描边 <b>2@64</b>', '眼 <b>2.8px@32</b>', '对比 <b>12:1</b>', '8 角色 / 7 态'),
    notes: `
      <div><h3>为什么这样画</h3>
        <p>先定「脸是整张图最亮的地方」。头发只压住头顶，五官全落在亮部；脖子留 1.5px 的可见段，肩-肘-手分段，胸口一个口袋、腰侧一道褶 —— 这几笔是为了把「连体衣」拆开。光从左上来：头顶一块高光、身体左上一条亮带、椅面一块接触阴影，人就不再是贴纸。</p></div>
      <div><h3>32px 靠什么保住可读性</h3>
        <ul>
          <li>眼睛 <b>6.2×7.4 单位</b> = 3.1×3.7px，纯 <code>#2C2531</code>，对皮肤 <b>≈12:1</b></li>
          <li>主形描边 <b>2 单位 = 1px@32</b>，圆头圆角；没有 1 单位以下的笔画</li>
          <li>体形差：老后 bulky+1.05、老运 chub+1.02；小研 0.86、小审 0.90 —— 32px 下也能一眼分出胖矮</li>
          <li>道具伸出轮廓 ≥4 单位：便签 / 耳机 / 放大镜 / 书堆 / 画笔 / 扳手 / 钢笔</li>
        </ul></div>
      <div><h3>我自己觉得最弱的一点</h3>
        <p>8 个人共用一套身体几何，靠宽窄、身高、头饰和道具区分 —— 远看还是一家人。手部只做到「有形状」，没有指节；放大到 128px 看，袖口和手的关系还偏简。下一步该给每人一条不同的肩线（溜肩 / 平肩 / 前倾）。</p></div>`,
  },
  {
    file: 'd2.html',
    art: 'd2.art.js',
    title: '团子兽',
    kicker: '方向 B · 员工办公室 / 侧栏角色',
    lede: '重画，不是修。扁平色块 + 统一 2 单位墨线，像贴纸；耳朵和尾巴是剪影主通道，8 个物种没有一只靠颜色区分。表情比 A 夸张一档 —— 团子没有脖子和手，脸就是全部表演。',
    specs: chips('头身 <b>1:1.3</b>', '头宽 <b>1.15×</b> 身宽', '墨线 <b>2@64</b>', '眼 <b>3.4px@32</b>', '8 物种', '8 角色 / 7 态'),
    notes: `
      <div><h3>为什么这样画</h3>
        <p>上一版团子死在「一整坨近黑」：没有描边、没有亮色块、没有耳朵剪影。这版把三件事钉死 —— <b>亮毛色 + 统一墨线 + 轮廓外的大耳朵/尾巴</b>。物种先定剪影（尖耳/垂耳/长耳/圆耳/卷角/环尾/呆毛），再谈表情。颜色只做身份，不做物种。</p></div>
      <div><h3>32px 靠什么保住可读性</h3>
        <ul>
          <li>眼 <b>6.8 单位</b> = 3.4px，比 A 大 20%；嘴宽 8–10 单位，表情靠形状不靠色</li>
          <li>墨线 <b>2 单位 = 1px@32</b>，把每个色块钉住，缩到 32px 也不会糊成渐变色</li>
          <li>耳朵/尾巴伸出身体 ≥ 5 单位，剪影两两可分</li>
          <li>亮毛色在暗色主题下反而更亮，不会发灰</li>
        </ul></div>
      <div><h3>我自己觉得最弱的一点</h3>
        <p>粗描边在 128px 下「贴纸感」偏重，精致度不如 A；羊角、浣熊环尾这类细节在 32px 会糊成一个凸起，只能靠大形。另外团子没有手，「手在键盘上」只能画两只小爪子搭在桌沿，动作表达比 A 弱。</p></div>`,
  },
];

for (const d of DIRS) {
  const artPath = path.join(HERE, d.art);
  if (!fs.existsSync(artPath)) { console.log(d.file, 'skipped (no art yet)'); continue; }
  const art = fs.readFileSync(artPath, 'utf8');
  const html = shell
    .replace('<!--TITLE-->', () => d.title)
    .replace('<!--KICKER-->', () => d.kicker)
    .replace('<!--LEDE-->', () => d.lede)
    .replace('<!--SPECS-->', () => d.specs)
    .replace('<!--NOTES-->', () => d.notes)
    .replace('/*ART*/', () => art);
  fs.writeFileSync(path.join(OUT, d.file), html);
  console.log(d.file, (html.length / 1024).toFixed(1) + 'KB');
}
