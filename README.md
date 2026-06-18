# WordPress MCP Server

[![MCP](https://img.shields.io/badge/MCP-1.0-blue)](https://modelcontextprotocol.io)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue)](https://www.typescriptlang.org)
[![License](https://img.shields.io/badge/License-MIT-yellow)](LICENSE)

A Model Context Protocol (MCP) server that connects Claude Desktop (and other MCP clients) to self-hosted WordPress sites via the REST API and Application Passwords — list posts, create drafts, publish, upload media, and manage comments.

## Features

### 11 WordPress Tools

**SENSE (read-only):**
| Tool | Description |
|------|-------------|
| `wp_get_site_info` | Site information — name, URL, description, namespaces, auth status |
| `wp_list_posts` | List posts filtered by status, keyword search |
| `wp_get_post` | Full post content, title, status, categories, tags, metadata |
| `wp_list_comments` | Comments on posts, optionally filtered by post ID |
| `wp_list_categories` | List categories (find IDs before creating posts) |
| `wp_list_tags` | List tags (find IDs before creating posts) |

**ACT (write):**
| Tool | Description |
|------|-------------|
| `wp_create_post` | Create a new post (defaults to draft — human review before publish) |
| `wp_update_post` | Update an existing post (also how you publish a draft) |
| `wp_delete_post` | Delete a post by ID (irreversible) |
| `wp_create_comment` | Create a comment on a post |
| `wp_upload_media` | Upload an image from URL to the media library |

### Built-in Reliability

- **Token-bucket rate limiting** — separate read (600/min) and write (120/min) buckets to avoid tripping hosting WAFs
- **Exponential backoff retry** — automatic retry with backoff on HTTP 429 and 5xx errors
- **Structured logging** — pino logger with credential redaction
- **Prompt injection protection** — wraps external API data in randomized markers

## Quick Start

### Prerequisites

- Node.js 18+
- A self-hosted WordPress 5.6+ site (WordPress.com hosted sites are not supported)
- An [Application Password](https://make.wordpress.org/core/2020/11/05/application-passwords-integration-guide/) for your WordPress user

### Creating an Application Password

1. Log in to your WordPress admin dashboard
2. Go to **Users → Profile**
3. Scroll to **Application Passwords**
4. Enter a name (e.g., "MCP Server") and click **Add New Application Password**
5. Copy the generated password (shown only once)

### Installation

```bash
git clone https://github.com/luminarylane/wordpress-mcp-server.git
cd wordpress-mcp-server
npm install
npm run build
```

### Configuration

**Claude Desktop (`claude_desktop_config.json`):**
```json
{
  "mcpServers": {
    "wordpress": {
      "command": "node",
      "args": ["/path/to/wordpress-mcp-server/dist/index.js"],
      "env": {
        "WORDPRESS_URL": "https://your-site.com",
        "WORDPRESS_USERNAME": "admin",
        "WORDPRESS_APP_PASSWORD": "xxxx xxxx xxxx xxxx xxxx xxxx"
      }
    }
  }
}
```

**Environment variables:**

| Variable | Required | Description |
|----------|----------|-------------|
| `WORDPRESS_URL` | Yes | Your WordPress site URL (e.g., `https://example.com`) |
| `WORDPRESS_USERNAME` | Yes | WordPress username |
| `WORDPRESS_APP_PASSWORD` | Yes | Application Password (spaces are stripped automatically) |
| `LOG_LEVEL` | No | Logging level (default: `info`) |

## Usage Examples

Once configured, ask Claude to:

- "List my WordPress drafts"
- "Create a blog post about AI trends in 2025" (creates as draft by default)
- "Show me the full content of post #42"
- "Publish my draft post #123"
- "Upload this image and set it as the featured image for post #42"
- "What categories do I have on my site?"
- "List the comments on my latest post"
- "Delete post #99"

## Permissions

The Application Password inherits the WordPress user's role. For full functionality:

- **Administrator** or **Editor** role is recommended
- At minimum, the user needs `edit_posts`, `publish_posts`, `upload_files`, and `moderate_comments` capabilities

## Contributing

1. Fork the repo
2. Create a feature branch (`git checkout -b feat/my-feature`)
3. Make changes and test locally
4. Submit a pull request

## License

MIT License — see [LICENSE](LICENSE) for details.

## Acknowledgments

- [Anthropic](https://anthropic.com) for the MCP specification
- [WordPress REST API](https://developer.wordpress.org/rest-api/) for the underlying API
