import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import { isDirectExecution, writeFileSyncAndVerifyNoBOM } from '../skills/agy-cli-statusline/scripts/lib/core/fs-utils.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SRC_APP_DIR = path.join(ROOT, 'src', 'app');
const OUT_HTML_PATH = path.join(ROOT, 'scripts', 'mcp', 'statusline-app.html');

export function computeSrcAppSha256(srcDir = SRC_APP_DIR) {
  const files = fs.readdirSync(srcDir).sort();
  const hash = createHash('sha256');
  for (const f of files) {
    const full = path.join(srcDir, f);
    if (fs.statSync(full).isFile()) {
      hash.update(f);
      hash.update('\0');
      hash.update(fs.readFileSync(full));
      hash.update('\0');
    }
  }
  return hash.digest('hex');
}

export async function buildAppHtml() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const pkgVersion = String(pkg.version || '1.13.0');

  const result = await esbuild.build({
    entryPoints: [path.join(SRC_APP_DIR, 'main.js')],
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    target: ['es2022'],
    minify: true,
    define: {
      __APP_VERSION__: JSON.stringify(pkgVersion)
    }
  });

  const jsBundle = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
  const cssText = fs.readFileSync(path.join(SRC_APP_DIR, 'styles.css'), 'utf8').replace(/<\/style/gi, '<\\/style');
  const srcHash = computeSrcAppSha256(SRC_APP_DIR);

  const html = [
    '<!doctype html>',
    `<!-- app-version: ${pkgVersion} -->`,
    `<!-- source-sha256: ${srcHash} -->`,
    '<html lang="en">',
    '<head>',
    '  <meta charset="utf-8">',
    '  <meta name="viewport" content="width=device-width, initial-scale=1">',
    '  <title>Statusline</title>',
    `  <style>\n${cssText}\n  </style>`,
    '</head>',
    '<body>',
    '  <div id="app" class="app-shell"></div>',
    `  <script>\n${jsBundle}\n  </script>`,
    '</body>',
    '</html>',
    ''
  ].join('\n');

  const byteLen = Buffer.byteLength(html, 'utf8');
  if (byteLen >= 1024 * 1024) {
    throw new Error(`Built HTML exceeds 1 MiB limit (${byteLen} bytes)`);
  }
  if (/<script[^>]+src=/i.test(html) || /<link[^>]+href=/i.test(html)) {
    throw new Error('Built HTML must not reference external script or link tags');
  }

  writeFileSyncAndVerifyNoBOM(OUT_HTML_PATH, html);
  console.log(`[build-app] Built ${OUT_HTML_PATH} (${byteLen} bytes, sha256=${srcHash.slice(0, 12)}...)`);
  return { outPath: OUT_HTML_PATH, byteLen, srcHash };
}

if (isDirectExecution(import.meta.url)) {
  buildAppHtml().catch((err) => {
    console.error('[build-app] Failed:', err);
    process.exit(1);
  });
}
