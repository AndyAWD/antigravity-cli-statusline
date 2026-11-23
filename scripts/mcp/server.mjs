import { randomBytes, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HOOK_VERSION } from '../../skills/agy-cli-statusline/scripts/lib/core/constants.mjs';
import { isDirectExecution } from '../../skills/agy-cli-statusline/scripts/lib/core/fs-utils.mjs';
import { StatuslineService } from './statusline-service.mjs';

const RESOURCE_URI = 'ui://statusline/app.html';
const RESOURCE_MIME = 'text/html;profile=mcp-app';

function getDefaultAppHtmlPath() {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), 'statusline-app.html');
}

function constantTimeTokenMatch(provided, expected) {
  if (typeof provided !== 'string' || typeof expected !== 'string' || !provided || !expected) {
    return false;
  }
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

export class StatuslineMcpHandler {
  constructor(options = {}) {
    this.service = options.service || new StatuslineService(options);
    this.appHtmlPath = options.appHtmlPath || getDefaultAppHtmlPath();
    this.clientSupportsMcpApps = false;
    this.uiSessionToken = randomBytes(24).toString('hex');
  }

  _readAppHtml() {
    const overridePath = typeof process.env.STATUSLINE_APP_HTML === 'string' && process.env.STATUSLINE_APP_HTML.trim()
      ? process.env.STATUSLINE_APP_HTML.trim()
      : '';
    const target = overridePath || this.appHtmlPath;
    if (!fs.existsSync(target)) {
      return '<!doctype html><html><body><p>Statusline App HTML not built. Run npm run build:app.</p></body></html>';
    }
    return fs.readFileSync(target, 'utf8').replace(/^\uFEFF/, '');
  }

  async handleMessage(msg) {
    if (!msg || typeof msg !== 'object') {
      return { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } };
    }

    const { id, method, params } = msg;
    const hasId = id !== undefined && id !== null;

    if (method === 'notifications/initialized' || method === 'notifications/cancelled') {
      return null;
    }

    try {
      if (method === 'initialize') {
        const clientExts = params?.capabilities?.extensions;
        this.clientSupportsMcpApps = Boolean(clientExts && clientExts['io.modelcontextprotocol/ui']);
        const result = {
          protocolVersion: params?.protocolVersion || '2025-03-26',
          capabilities: {
            tools: {},
            resources: {},
            ...(this.clientSupportsMcpApps
              ? { extensions: { 'io.modelcontextprotocol/ui': {} } }
              : {})
          },
          serverInfo: {
            name: 'antigravity-cli-statusline',
            version: HOOK_VERSION
          }
        };
        return hasId ? { jsonrpc: '2.0', id, result } : null;
      }

      if (method === 'ping') {
        return hasId ? { jsonrpc: '2.0', id, result: {} } : null;
      }

      if (method === 'resources/list') {
        return hasId ? {
          jsonrpc: '2.0',
          id,
          result: {
            resources: [
              {
                uri: RESOURCE_URI,
                name: 'Statusline Dashboard',
                description: 'Interactive Antigravity Statusline monitor and visual layout editor.',
                mimeType: RESOURCE_MIME
              }
            ]
          }
        } : null;
      }

      if (method === 'resources/read') {
        if (params?.uri !== RESOURCE_URI) {
          return hasId ? {
            jsonrpc: '2.0',
            id,
            error: { code: -32602, message: `Unknown resource URI: ${String(params?.uri || '')}` }
          } : null;
        }
        return hasId ? {
          jsonrpc: '2.0',
          id,
          result: {
            contents: [
              {
                uri: RESOURCE_URI,
                mimeType: RESOURCE_MIME,
                text: this._readAppHtml(),
                _meta: {
                  ui: {
                    prefersBorder: false,
                    csp: {
                      connectDomains: [],
                      resourceDomains: []
                    }
                  }
                }
              }
            ]
          }
        } : null;
      }

      if (method === 'tools/list') {
        const tools = [
          {
            name: 'statusline_dashboard',
            description: 'Open the interactive Statusline monitor and visual layout editor in Antigravity App, or return a plain-text status summary.',
            inputSchema: {
              type: 'object',
              properties: {
                conversationId: { type: 'string', description: 'Optional conversation ID to inspect.' },
                forceRefresh: { type: 'boolean', description: 'Bypass short-lived memory cache.' },
                checkUpdate: { type: 'boolean', description: 'Force check GitHub Releases for plugin updates.' },
                hostLocale: { type: 'string', description: 'Optional host locale hint.' }
              },
              additionalProperties: false
            },
            annotations: {
              readOnlyHint: true,
              destructiveHint: false,
              idempotentHint: true
            },
            _meta: {
              ui: {
                resourceUri: RESOURCE_URI
              },
              'com.google.antigravity/ui': {
                entrypoints: [
                  { type: 'aux_pane', title: 'Statusline' },
                  { type: 'global', title: 'Statusline' }
                ]
              }
            }
          }
        ];

        // 僅對支援 MCP Apps UI 的宿主暴露設定寫入工具，CLI 端完全隱藏
        if (this.clientSupportsMcpApps) {
          tools.push({
            name: 'statusline_save_config',
            description: 'App-only tool to persist panel preferences in PLUGIN_DATA, or (with save-both) write CLI settings.json and automatically update outdated CLI hook scripts.',
            inputSchema: {
              type: 'object',
              properties: {
                uiSessionToken: { type: 'string' },
                action: {
                  type: 'string',
                  enum: ['save-panel', 'save-both', 'save-prefs', 'reset-from-cli', 'parse-order-expression']
                },
                layout: { type: 'object' },
                panelPrefs: { type: 'object' },
                deployHooks: { type: 'boolean' },
                orderExpression: { type: 'string' },
                workspacePath: { type: 'string' }
              },
              required: ['uiSessionToken', 'action'],
              additionalProperties: false
            },
            annotations: {
              readOnlyHint: false,
              destructiveHint: true,
              idempotentHint: true
            },
            _meta: {
              ui: {
                visibility: ['app']
              }
            }
          });
        }

        return hasId ? { jsonrpc: '2.0', id, result: { tools } } : null;
      }

      if (method === 'tools/call') {
        const toolName = params?.name;
        const args = (params?.arguments && typeof params.arguments === 'object') ? params.arguments : {};
        const metaConvId = params?._meta?.['antigravity.google/conversation_id'] || '';

        if (toolName === 'statusline_dashboard') {
          const { snapshot, plainText } = await this.service.getDashboardSnapshot({
            conversationId: typeof args.conversationId === 'string' ? args.conversationId : '',
            metaConversationId: typeof metaConvId === 'string' ? metaConvId : '',
            forceRefresh: Boolean(args.forceRefresh),
            checkUpdate: Boolean(args.checkUpdate),
            hostLocale: typeof args.hostLocale === 'string' ? args.hostLocale : ''
          });
          const structuredContent = {
            ...snapshot,
            ...(this.clientSupportsMcpApps ? { uiSessionToken: this.uiSessionToken } : {})
          };
          return hasId ? {
            jsonrpc: '2.0',
            id,
            result: {
              content: [{ type: 'text', text: plainText }],
              structuredContent
            }
          } : null;
        }

        if (toolName === 'statusline_save_config') {
          if (!this.clientSupportsMcpApps) {
            return hasId ? {
              jsonrpc: '2.0',
              id,
              result: {
                isError: true,
                content: [{ type: 'text', text: 'statusline_save_config is only available in Antigravity App UI. On CLI, please run /antigravity-cli-statusline:agy-cli-statusline.' }]
              }
            } : null;
          }
          if (!constantTimeTokenMatch(args.uiSessionToken, this.uiSessionToken)) {
            return hasId ? {
              jsonrpc: '2.0',
              id,
              result: {
                isError: true,
                content: [{ type: 'text', text: 'Invalid or missing uiSessionToken.' }]
              }
            } : null;
          }
          const saveRes = await this.service.saveConfig({
            action: args.action,
            layout: args.layout,
            panelPrefs: args.panelPrefs,
            deployHooks: args.deployHooks,
            orderExpression: args.orderExpression,
            workspacePath: args.workspacePath
          });
          return hasId ? {
            jsonrpc: '2.0',
            id,
            result: {
              content: [{ type: 'text', text: JSON.stringify(saveRes) }],
              structuredContent: saveRes
            }
          } : null;
        }

        return hasId ? {
          jsonrpc: '2.0',
          id,
          error: { code: -32601, message: `Unknown tool: ${String(toolName || '')}` }
        } : null;
      }

      return hasId ? {
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `Method not found: ${String(method || '')}` }
      } : null;
    } catch (err) {
      return hasId ? {
        jsonrpc: '2.0',
        id,
        error: { code: -32603, message: err?.message || 'Internal error' }
      } : null;
    }
  }
}

/**
 * 啟動雙模 stdio JSON-RPC 2.0 伺服器（相容換行分隔與 Content-Length 封裝）。
 */
export function startMcpStdioServer(handler = new StatuslineMcpHandler()) {
  let buffer = Buffer.alloc(0);

  const writeResponse = (res, useContentLength) => {
    const json = JSON.stringify(res);
    if (useContentLength) {
      const byteLen = Buffer.byteLength(json, 'utf8');
      process.stdout.write(`Content-Length: ${byteLen}\r\n\r\n${json}`);
    } else {
      process.stdout.write(`${json}\n`);
    }
  };

  const dispatchParsed = (rawJson, useContentLength) => {
    const trimmed = rawJson.trim();
    if (!trimmed) return;
    let parsed;
    try {
      parsed = JSON.parse(trimmed);
    } catch (_) {
      writeResponse({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, useContentLength);
      return;
    }
    void handler.handleMessage(parsed).then((res) => {
      if (res) writeResponse(res, useContentLength);
    });
  };

  const drainBuffer = () => {
    while (buffer.length > 0) {
      const preview = buffer.subarray(0, Math.min(buffer.length, 32)).toString('utf8');
      if (preview.startsWith('Content-Length:')) {
        const headerEnd = buffer.indexOf('\r\n\r\n');
        if (headerEnd === -1) return;
        const headerStr = buffer.subarray(0, headerEnd).toString('utf8');
        const match = /Content-Length:\s*(\d+)/i.exec(headerStr);
        const contentLen = match ? Number(match[1]) : 0;
        const totalLen = headerEnd + 4 + contentLen;
        if (buffer.length < totalLen) return;
        const bodyStr = buffer.subarray(headerEnd + 4, totalLen).toString('utf8');
        buffer = buffer.subarray(totalLen);
        dispatchParsed(bodyStr, true);
      } else {
        const nlIdx = buffer.indexOf(0x0a);
        if (nlIdx === -1) return;
        const lineStr = buffer.subarray(0, nlIdx).toString('utf8');
        buffer = buffer.subarray(nlIdx + 1);
        dispatchParsed(lineStr, false);
      }
    }
  };

  process.stdin.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    drainBuffer();
  });
  process.stdin.on('end', () => process.exit(0));
}

if (isDirectExecution(import.meta.url)) {
  startMcpStdioServer();
}
