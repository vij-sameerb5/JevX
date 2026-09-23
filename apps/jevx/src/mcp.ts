// jevx-mcp entry: stdio MCP server. Logs go to stderr — stdout belongs to the protocol.
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadEnvFile } from "./env.js";
import { VERSION, createServer } from "./server.js";

// Claude Desktop (.mcpb) passes optional settings as env; an unset one can arrive as the literal
// "${user_config.x}" placeholder — treat that as not set.
for (const [k, v] of Object.entries(process.env)) if (typeof v === "string" && /^\$\{user_config\.[\w-]+\}$/.test(v.trim())) delete process.env[k];
for (const k of ["JEVX_ROOT", "TYPESAFE_API_KEY"]) if (process.env[k] !== undefined && !process.env[k]!.trim()) delete process.env[k];
loadEnvFile();

const server = createServer();
await server.connect(new StdioServerTransport());
process.stderr.write(`jevx-mcp ${VERSION} ready (root: ${process.env.JEVX_ROOT ?? process.cwd()})\n`);
