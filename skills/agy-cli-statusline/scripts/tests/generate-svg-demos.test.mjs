import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { generateDemoSvg } from '../generate-svg-demos.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '../../../..');
const imagesDir = path.join(projectRoot, 'docs', 'images');
// Audit #6：預期版本標籤一律動態讀自 plugin.json，避免每次發版都要手動改測試
const pluginJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'plugin.json'), 'utf8'));
const expectedPluginTag = `v${String(pluginJson.version).replace(/^v/i, '')}`;

console.log('=== Running tests/generate-svg-demos.test.mjs ===');

const languages = ['us', 'zh-tw', 'zh-cn', 'jp'];

for (const lang of languages) {
  console.log(`[Test] Verifying generateDemoSvg for language '${lang}'...`);
  const svg = generateDemoSvg(lang);

  // 1. Root structure and xml:space="preserve"
  assert.ok(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'), `${lang}: SVG must start with <svg xmlns`);
  assert.ok(svg.includes('xml:space="preserve"'), `${lang}: SVG must specify xml:space="preserve" for monospace terminal preservation`);
  assert.ok(svg.includes('role="img"'), `${lang}: SVG must include role="img" for accessibility`);
  assert.ok(svg.includes('aria-label='), `${lang}: SVG must include aria-label`);

  // 2. All 9 frames must exist in CSS @keyframes and elements
  for (let i = 0; i <= 8; i++) {
    assert.ok(svg.includes(`@keyframes f${i}`), `${lang}: CSS must define @keyframes f${i}`);
    assert.ok(svg.includes(`class="f f${i}"`), `${lang}: SVG must contain frame group <g class="f f${i}">`);
    assert.ok(svg.includes(`.f${i} {`), `${lang}: CSS must define .f${i} class`);
  }

  // 3. Wizard 5 layers: Question 1/5 through 5/5
  for (let c = 1; c <= 5; c++) {
    assert.ok(svg.includes(`Question ${c}/5:`), `${lang}: SVG must include Question ${c}/5: for category ${c}`);
  }

  // 4. Wizard options checkmarks [✓]
  const checkmarks = (svg.match(/\[✓\]/g) || []).length;
  assert.strictEqual(checkmarks, 36, `${lang}: SVG must visibly render all 36 options checked across 5 categories, got ${checkmarks}`);

  // 5. Monospace column spacing & anti-collision: checkmark for Node.js must be at x="370"
  assert.ok(svg.includes('<text x="370" y="158" fill="#5cdb6d" font-weight="700">✓</text>'), `${lang}: Node.js checkmark must be at x=370 to prevent text overlap`);
  assert.ok(svg.includes('<text x="390" y="158" fill="#8b949e">Node.js v20.18.0 detected</text>'), `${lang}: Node.js text must be at x=390`);

  // 6. Metric 14, 15, 26 in Frame 6 reference table and complete removal of Argon quota indicators
  assert.ok(svg.includes('│ <tspan fill="#57caff" font-weight="700">14</tspan> │'), `${lang}: Reference table must include metric 14`);
  assert.ok(svg.includes('│ <tspan fill="#57caff" font-weight="700">15</tspan> │'), `${lang}: Reference table must include metric 15`);
  assert.ok(svg.includes('│ <tspan fill="#57caff" font-weight="700">26</tspan> │'), `${lang}: Reference table must include metric 26`);
  assert.ok(!svg.includes('quota-argon'), `${lang}: SVG must not include removed quota-argon indicator`);
  assert.ok(!svg.includes('Argon 可用'), `${lang}: SVG must not include Argon 可用`);
  assert.ok(!svg.includes('Argon Available'), `${lang}: SVG must not include Argon Available`);
  assert.ok(!svg.includes('Argon 残量'), `${lang}: SVG must not include Argon 残量`);

  // 7. Frame 7 cursor position must not be floating in empty space at x=650 or overlapping text
  assert.ok(!svg.includes('<rect class="cur" x="650" y="255"'), `${lang}: Frame 7 cursor must not be floating at x=650`);
  assert.ok(svg.includes('<rect class="cur" x="830" y="384"'), `${lang}: Frame 6 cursor must be at x=830 y=384`);

  // 8. Frame 7 & 8 must render 10 rows of statusline telemetry ending at y=522
  assert.ok(svg.includes('y="522"'), `${lang}: Frame 7/8 must render up to 10 statusline rows ending at y=522`);
  assert.ok(svg.includes('<text x="24" y="389"> </text>'), `${lang}: Frame 7/8 must preserve empty row 2 for n,n`);
  assert.ok(svg.includes('<text x="24" y="465"> </text>'), `${lang}: Frame 7/8 must preserve empty row 6 for n,n`);

  // 9. Frame 7 & 8 prompt box docking
  assert.ok(svg.includes('<line x1="24" y1="294" x2="936" y2="294" stroke="#383e5a" stroke-width="1"/>'), `${lang}: Prompt box top border at y=294`);
  assert.ok(svg.includes('<text x="24" y="314" fill="#57caff">&gt;</text>'), `${lang}: Prompt > at y=314`);
  assert.ok(svg.includes('<line x1="24" y1="330" x2="936" y2="330" stroke="#383e5a" stroke-width="1"/>'), `${lang}: Statusline top divider at y=330`);
  assert.ok(svg.includes('<rect class="cur" x="40" y="301" width="8" height="15" fill="#e6edf3"/>'), `${lang}: Frame 8 prompt cursor at x=40 y=301`);

  // 10. Terminal container styling and buttons
  assert.ok(svg.includes('<rect width="960" height="640" rx="10" fill="#282c34"/>'), `${lang}: Terminal background must be #282c34`);
  assert.ok(svg.includes('<circle cx="18" cy="18" r="5.5" fill="#ff5f56"/>'), `${lang}: Traffic light red button at cx=18`);
  assert.ok(svg.includes('<circle cx="38" cy="18" r="5.5" fill="#ffbd2e"/>'), `${lang}: Traffic light yellow button at cx=38`);
  assert.ok(svg.includes('<circle cx="58" cy="18" r="5.5" fill="#27c93f"/>'), `${lang}: Traffic light green button at cx=58`);
  assert.ok(!svg.includes('font-size:15px'), `${lang}: Banner must use standard monospace font size`);

  // 12. Bottom-right model in default footer must be Gemini 3.8 Flash (Low)
  assert.ok(svg.includes('<text x="936" y="554" fill="#6e7681" text-anchor="end">Gemini 3.8 Flash (Low)</text>'), `${lang}: Bottom-right model must be Gemini 3.8 Flash (Low)`);

  // 13. Statusline telemetry must render Agy CLI Version, Agy 2.0 Version, and Statusline Version labels
  const expectedCliVersionLabel = lang === 'us' ? 'Agy CLI Version:' : (lang === 'jp' ? 'Agy CLI バージョン:' : 'Agy CLI 版本:');
  const expectedAppVersionLabel = lang === 'us' ? 'Agy 2.0 Version:' : (lang === 'jp' ? 'Agy 2.0 バージョン:' : 'Agy 2.0 版本:');
  const expectedPluginVersionLabel = lang === 'zh-tw' ? '狀態列版本:' : (lang === 'zh-cn' ? '状态栏版本:' : (lang === 'jp' ? 'ステータスライン版:' : 'Statusline Version:'));
  assert.ok(svg.includes(expectedCliVersionLabel), `${lang}: Statusline must include ${expectedCliVersionLabel}`);
  assert.ok(svg.includes(expectedAppVersionLabel), `${lang}: Statusline must include ${expectedAppVersionLabel}`);
  assert.ok(svg.includes(expectedPluginVersionLabel), `${lang}: Statusline must include ${expectedPluginVersionLabel}`);
  assert.ok(svg.includes(expectedPluginTag), `${lang}: Statusline must include plugin version ${expectedPluginTag}`);

  // 11. Frame 6 reference table alignment: all 4 rows must have display width 91
  function charWidth(ch) {
    const cp = ch.codePointAt(0);
    if (ch === '\ufe0f' || ch === '\ufe0e') return 0;
    if (cp >= 0x2500 && cp <= 0x257f) return 1;
    if (cp >= 0x2190 && cp <= 0x21ff) return 1;
    if (cp > 0x1f000 && cp < 0x1faff) return 2;
    if (['⚡', '⏱', '⚙', '⏰', '✨', '🤖', '🔀', '🪪', '🔍', '🗃', '💾'].includes(ch)) return 2;
    if ((cp >= 0x4e00 && cp <= 0x9fff) || (cp >= 0x3400 && cp <= 0x4dbf) || (cp >= 0x3040 && cp <= 0x30ff) || (cp >= 0xff01 && cp <= 0xff60)) return 2;
    return 1;
  }
  function strWidth(str) {
    let w = 0;
    for (const ch of str) w += charWidth(ch);
    return w;
  }
  const tableMatches = svg.match(/<text x="24" y="(?:192|210|228|246)" fill="#c9d1d9">.*?<\/text>/g);
  assert.ok(tableMatches && tableMatches.length === 4, `${lang}: Must find 4 table rows in Frame 6`);
  for (const tm of tableMatches) {
    const rawText = tm.replace(/<[^>]+>/g, '');
    const w = strWidth(rawText);
    assert.strictEqual(w, 91, `${lang}: Table row display width must be 91, got ${w}: ${rawText}`);
  }

  console.log(`  -> ${lang}: SVG verified successfully.`);
}

// 9. XML validation with xmllint if available
const xmllintCheck = spawnSync('which', ['xmllint']);
if (xmllintCheck.status === 0) {
  console.log('[Test] Running xmllint XML syntax validation...');
  const files = [
    'statusline-demo.svg',
    'statusline-demo-en.svg',
    'statusline-demo-zh-tw.svg',
    'statusline-demo-zh-cn.svg',
    'statusline-demo-jp.svg'
  ];

  for (const file of files) {
    const fullPath = path.join(imagesDir, file);
    assert.ok(fs.existsSync(fullPath), `Target SVG file must exist: ${file}`);
    const res = spawnSync('xmllint', ['--noout', fullPath], { encoding: 'utf8' });
    assert.strictEqual(res.status, 0, `xmllint failed for ${file}:\n${res.stderr}`);
  }
  console.log('  -> All 5 demo SVG files passed xmllint with 0 errors.');
}

console.log('\n🎉 generate-svg-demos.test.mjs passed all tests successfully!');
