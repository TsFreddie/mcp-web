# MCP Template with Stdio Transport

This is a template for creating an MCP (Model Context Protocol) server that communicates via stdio transport. The template includes a simple example tool to get you started.

## Features

- Stdio transport for communication with MCP clients
- Example echo tool that demonstrates basic functionality
- Proper TypeScript implementation using the official MCP SDK

## Structure

- `index.ts` - The main MCP server implementation
- `test-client.ts` - A simple client to test the server

## Usage

### Running the Server

```bash
bun run index.ts
```

### Testing the Server

```bash
bun run test-client.ts
```

## Adding Your Own Tools

To add your own tools to the server, modify `index.ts` and use the `server.registerTool()` method:

```typescript
server.registerTool(
  'your-tool-name',
  {
    title: 'Your Tool Title',
    description: 'Description of your tool',
    inputSchema: {
      // Define your input schema using Zod
    },
    outputSchema: {
      // Define your output schema using Zod
    }
  },
  async (args) => {
    // Your tool implementation here
    return {
      content: [{ type: 'text', text: 'Your response' }],
      structuredContent: { /* your structured response */ }
    };
  }
);
```

## Dependencies

- `@modelcontextprotocol/sdk` - The official Model Context Protocol SDK
- `zod` - For schema validation
- `bun` - JavaScript runtime (or Node.js)

## About MCP

The Model Context Protocol (MCP) is an open protocol that standardizes how applications provide context, data sources, and tools to Large Language Models (LLMs). It enables building agents and complex LLM workflows by offering a standardized way for AI models to integrate with various data and services.