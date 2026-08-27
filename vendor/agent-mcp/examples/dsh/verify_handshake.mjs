// DSH 同款 MCP SDK 真实握手验证：initialize → tools/list → tools/call
// 与 DSH 的 @deepseek-ai/dsh-mcp-client 使用完全相同的客户端 SDK 与请求序列。
//
// 用法（DSH_SDK_DIR 指向 DSH 仓库 node_modules 下的 SDK 包目录，或先 pnpm i）：
//   DSH_SDK_DIR=/path/to/deepseek-harness/node_modules/.pnpm/@modelcontextprotocol+sdk@1.29.0_zod@4.4.3/node_modules/@modelcontextprotocol/sdk \
//   node examples/dsh/verify_handshake.mjs /abs/path/agent-mcp/mcp_server.py
import { pathToFileURL } from 'node:url'

const sdkDir = process.env.DSH_SDK_DIR
if (!sdkDir) {
  console.error('✗ 缺少 DSH_SDK_DIR 环境变量（DSH 仓库内 MCP SDK 包目录）')
  process.exit(2)
}
const { Client } = await import(pathToFileURL(`${sdkDir}/dist/esm/client/index.js`).href)
const { StdioClientTransport } = await import(
  pathToFileURL(`${sdkDir}/dist/esm/client/stdio.js`).href)
const serverPath = process.argv[2] ?? 'mcp_server.py'

const transport = new StdioClientTransport({
  command: 'python3',
  args: [serverPath],
  stderr: 'inherit',
})

const client = new Client({ name: 'dsh-mcp-client', version: '0.0.1' }, { capabilities: {} })
await client.connect(transport)
console.log('✓ initialize: clientInfo=dsh-mcp-client connected')

const tools = await client.listTools()
console.log(`✓ tools/list: ${tools.tools.length} tools`)
const names = tools.tools.map(t => t.name)
for (const expect of ['spawn_agent','wait_agent','estimate_complexity','send_message',
  'steer_agent','followup_task','interrupt_agent','list_agents','get_agent_activity',
  'get_token_usage','memory_store','memory_recall','orchestrate_task','policy_list',
  'policy_add','policy_state']) {
  if (!names.includes(expect)) { console.error(`✗ missing tool: ${expect}`); process.exit(1) }
}
console.log('✓ all 16 core+policy tools present')

const est = await client.callTool({ name: 'estimate_complexity', arguments: {
  task: '在 docs/ 下新增一份 DSH 接入指南，涉及单文件编辑' } })
const text = est.content.filter(b => b.type === 'text').map(b => b.text).join('\n')
const body = JSON.parse(text)
console.log(`✓ tools/call estimate_complexity: level=${body.level}`)
if (!['S','M','L'].includes(body.level)) { console.error('✗ bad level'); process.exit(1) }
console.log('✓ structuredContent:', est.structuredContent?.level)

await client.close()
console.log('\nALL DSH-SDK HANDSHAKE CHECKS PASSED')
