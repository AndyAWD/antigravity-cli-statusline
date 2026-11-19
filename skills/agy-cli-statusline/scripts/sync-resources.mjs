import path from 'path';
import { fileURLToPath } from 'url';
import { isDirectExecution, writeJsonAndVerifyNoBOMSync } from './lib/core/fs-utils.mjs';
import { buildPromptsJsonObject, buildQuestionsJsonObject } from './lib/metrics/registry.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_SKILL_DIR = path.resolve(__dirname, '..');

/**
 * 依單一真實來源同步產生 resources/questions.json 與 resources/prompts.json（無 UTF-8 BOM）。
 * @param {string} [baseDir=DEFAULT_SKILL_DIR] 技能目錄路徑（其下包含 resources/ 子目錄）
 * @returns {{ questionsPath: string, promptsPath: string, questions: object, prompts: object }}
 */
export function syncResources(baseDir = DEFAULT_SKILL_DIR) {
  const targetDir = baseDir || DEFAULT_SKILL_DIR;
  const resourcesDir = path.join(targetDir, 'resources');
  const questionsPath = path.join(resourcesDir, 'questions.json');
  const promptsPath = path.join(resourcesDir, 'prompts.json');

  const questions = buildQuestionsJsonObject();
  const prompts = buildPromptsJsonObject();

  writeJsonAndVerifyNoBOMSync(questionsPath, questions);
  writeJsonAndVerifyNoBOMSync(promptsPath, prompts);

  return { questionsPath, promptsPath, questions, prompts };
}

if (isDirectExecution(import.meta.url)) {
  const { questionsPath, promptsPath } = syncResources();
  console.log(`[sync-resources] 已同步寫入資源檔案：\n- ${questionsPath}\n- ${promptsPath}`);
}
