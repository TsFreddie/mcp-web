# mcp-web

A DuckDuckGo search and browse MCP (Model Context Protocol) server that works under human intent. This server provides tools for searching the web and fetching content from URLs, with special handling for CAPTCHA challenges that require human intervention.

## Overview

This MCP server allows AI agents to search DuckDuckGo and fetch web content, with no sophisticated CAPTCHA bypassing. Although the browsing is automated by an AI agent, it is still designed for a human to initiate the search and pass CAPTCHAs as needed.

The server send requests to `https://html.duckduckgo.com` and the bot has the ability to navigate any server rendered articles. It also makes no attempt to bypass any bot detection mechanisms when fetching web content.

## Usage

Only support `npx` / stdio mode, since it is designed to be used on your own machine. Hosting it on a server or expecting it to be fully automated defeats the purpose of this project.

```json
{
  "mcpServers": {
    "web": {
      "command": "npx",
      "args": ["-y", "@tsfreddie/mcp-web"]
    }
  }
}
```

## License

MIT
