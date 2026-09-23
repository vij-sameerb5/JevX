// jevx-mcp entry: stdio MCP server. Logs go to stderr — stdout belongs to the protocol.
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { VERSION, createServer } from "./server.js";

const server = createServer();
await server.connect(new StdioServerTransport());
process.stderr.write(`jevx-mcp ${VERSION} ready (root: ${process.env.JEVX_ROOT ?? process.cwd()})\n`);
