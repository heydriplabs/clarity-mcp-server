import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { queryAnalyticsDashboardAsync, listSessionRecordingsAsync, queryDocumentationAsync } from '@microsoft/clarity-mcp-server/dist/tools.js';
import { SearchRequest, ListRequest } from '@microsoft/clarity-mcp-server/dist/types.js';
import { randomUUID } from 'crypto';

const PORT = process.env.PORT || 3000;

function createServer() {
  const server = new McpServer({
    name: 'clarity-mcp-server',
    version: '1.0.0',
    capabilities: { resources: {}, tools: {} }
  });

  server.tool('query-analytics-dashboard', 'Fetch Microsoft Clarity analytics data using a natural language query.', SearchRequest, async ({ query }) => {
    return await queryAnalyticsDashboardAsync(query, Intl.DateTimeFormat().resolvedOptions().timeZone);
  });

  server.tool('list-session-recordings', 'List Microsoft Clarity session recordings based on filters.', ListRequest, async ({ filters, sortBy, count }) => {
    const now = new Date();
    const endDate = new Date(filters?.date?.end || now.toISOString());
    const startDate = new Date(filters?.date?.start || now.toISOString());
    if (!filters?.date?.start) startDate.setDate(endDate.getDate() - 2);
    return await listSessionRecordingsAsync(startDate, endDate, filters, sortBy, count);
  });

  server.tool('query-documentation-resources', 'Retrieve Microsoft Clarity documentation snippets.', SearchRequest, async ({ query }) => {
    return await queryDocumentationAsync(query);
  });

  return server;
}

const app = express();
app.use(express.json());

app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'clarity-mcp-server' });
});

const sseTransports = {};

app.get('/sse', async (req, res) => {
  const transport = new SSEServerTransport('/messages', res);
  sseTransports[transport.sessionId] = transport;
  res.on('close', () => delete sseTransports[transport.sessionId]);
  const server = createServer();
  await server.connect(transport);
});

app.post('/messages', async (req, res) => {
  const sessionId = req.query.sessionId;
  const transport = sseTransports[sessionId];
  if (!transport) return res.status(404).json({ error: 'Session not found' });
  await transport.handlePostMessage(req, res, req.body);
});

const httpTransports = {};

app.post('/mcp', async (req, res) => {
  const sessionId = req.headers['mcp-session-id'];
  if (sessionId && httpTransports[sessionId]) {
    await httpTransports[sessionId].handleRequest(req, res, req.body);
    return;
  }
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: (id) => { httpTransports[id] = transport; }
  });
  transport.onclose = () => { if (transport.sessionId) delete httpTransports[transport.sessionId]; };
  const server = createServer();
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

app.get('/mcp', async (req, res) => {
  const sessionId = req.headers['mcp-session-id'];
  if (!sessionId || !httpTransports[sessionId]) return res.status(400).json({ error: 'Invalid session' });
  await httpTransports[sessionId].handleRequest(req, res);
});

app.delete('/mcp', async (req, res) => {
  const sessionId = req.headers['mcp-session-id'];
  if (sessionId && httpTransports[sessionId]) {
    await httpTransports[sessionId].handleRequest(req, res);
    delete httpTransports[sessionId];
  } else {
    res.status(404).json({ error: 'Session not found' });
  }
});

app.listen(PORT, () => {
  console.log(`Clarity MCP server running on port ${PORT}`);
});
