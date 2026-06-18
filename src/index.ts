#!/usr/bin/env node
/**
 * WordPress MCP Server — self-hosted WordPress via REST API + Application Passwords.
 *
 * Usage:
 *   WORDPRESS_URL=https://example.com WORDPRESS_USERNAME=admin WORDPRESS_APP_PASSWORD=xxxx \
 *     node dist/index.js
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import logger from "./lib/logger.js";
import { WordPressClient } from "./client.js";
import { textResult, errorResult, senseResult } from "./response.js";
import {
  waitForRateLimit,
  withRetry,
  WRITE_TOOL_NAMES,
} from "./rate-limiter.js";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { version } = require("../package.json") as { version: string };

// ── Credentials ────────────────────────────────────────
const SITE_URL = process.env.WORDPRESS_URL;
const USERNAME = process.env.WORDPRESS_USERNAME;
const APP_PASSWORD = process.env.WORDPRESS_APP_PASSWORD;

function getClient(): WordPressClient {
  if (!SITE_URL || !USERNAME || !APP_PASSWORD) {
    throw new Error(
      "Missing WordPress credentials. Set WORDPRESS_URL, WORDPRESS_USERNAME, and WORDPRESS_APP_PASSWORD environment variables.",
    );
  }
  return new WordPressClient({
    siteUrl: SITE_URL,
    username: USERNAME,
    appPassword: APP_PASSWORD,
  });
}

let client: WordPressClient | null = null;

function ensureClient(): WordPressClient {
  if (!client) {
    client = getClient();
  }
  return client;
}

// ── Types ──────────────────────────────────────────────
interface ToolResult {
  content: { type: "text"; text: string }[];
  isError?: boolean;
  [key: string]: unknown;
}

// ── Safe handler wrapper ───────────────────────────────
type ToolHandler = (args: Record<string, unknown>) => Promise<ToolResult>;

function safeHandler(toolName: string, fn: ToolHandler) {
  return async (args: Record<string, unknown>): Promise<ToolResult> => {
    const category = WRITE_TOOL_NAMES.has(toolName) ? "write" : "read";

    const limit = await waitForRateLimit(category);
    if (!limit.allowed) {
      const retryAfterSeconds = Math.ceil(limit.retryAfterMs / 1000);
      return errorResult(
        "Rate limited",
        `WordPress API rate limit reached. Retry after ${retryAfterSeconds} seconds.`,
        { retryAfterSeconds },
      );
    }

    try {
      const wp = ensureClient();
      return await withRetry(() => fn.call(null, { ...args, _client: wp }));
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);

      // Parse WordPress REST API errors for actionable messages
      if (message.includes("WordPress API 401")) {
        return errorResult(
          "Authentication failed",
          "WordPress rejected the credentials. The Application Password may be invalid or revoked. " +
            "Check WORDPRESS_USERNAME and WORDPRESS_APP_PASSWORD.",
          { httpStatus: 401 },
        );
      }
      if (message.includes("WordPress API 403")) {
        return errorResult(
          "Permission denied",
          "The WordPress user does not have permission for this action. " +
            "Ensure the user has the 'Administrator' or 'Editor' role.",
          { httpStatus: 403 },
        );
      }
      if (message.includes("WordPress API 404")) {
        return errorResult(
          "Not found",
          "The requested resource was not found. Check that the post/page/comment ID exists.",
          { httpStatus: 404 },
        );
      }
      if (
        message.includes("ECONNREFUSED") ||
        message.includes("ENOTFOUND") ||
        message.includes("fetch failed")
      ) {
        return errorResult(
          "Connection failed",
          `Cannot reach WordPress at ${SITE_URL}. Check that WORDPRESS_URL is correct and the site is online.`,
          { siteUrl: SITE_URL },
        );
      }

      return errorResult("WordPress API error", message);
    }
  };
}

// ── Server setup ───────────────────────────────────────
const server = new McpServer({
  name: "wordpress-mcp-server",
  version,
});

// ── SENSE tools (read-only) ────────────────────────────

server.tool(
  "wp_get_site_info",
  "Get WordPress site information — name, URL, description, namespaces, and authentication status.",
  {},
  safeHandler("wp_get_site_info", async ({ _client }) => {
    const wp = _client as WordPressClient;
    const info = await wp.getSiteInfo();
    return senseResult(info, "WordPress");
  }),
);

server.tool(
  "wp_list_posts",
  "List WordPress posts. Use status='draft' to see drafts, status='publish' for published. Returns title, ID, status, date, and excerpt.",
  {
    per_page: z.number().optional().describe("Number of posts to return (default 10, max 100)"),
    status: z.string().optional().describe("Filter by status: publish, draft, pending, private (default: publish)"),
    search: z.string().optional().describe("Search posts by keyword"),
  },
  safeHandler("wp_list_posts", async ({ _client, per_page, status, search }) => {
    const wp = _client as WordPressClient;
    const posts = await wp.listPosts({
      per_page: per_page as number | undefined,
      status: status as string | undefined,
      search: search as string | undefined,
    });
    return senseResult(posts, "WordPress");
  }),
);

server.tool(
  "wp_get_post",
  "Get a single WordPress post by ID. Returns full content, title, status, categories, tags, and metadata.",
  {
    id: z.number().describe("Post ID"),
  },
  safeHandler("wp_get_post", async ({ _client, id }) => {
    const wp = _client as WordPressClient;
    const post = await wp.getPost(id as number);
    return senseResult(post, "WordPress");
  }),
);

server.tool(
  "wp_list_comments",
  "List comments on WordPress posts. Optionally filter by post ID.",
  {
    post: z.number().optional().describe("Filter comments by post ID"),
    per_page: z.number().optional().describe("Number of comments to return (default 10, max 100)"),
  },
  safeHandler("wp_list_comments", async ({ _client, post, per_page }) => {
    const wp = _client as WordPressClient;
    const comments = await wp.listComments({
      post: post as number | undefined,
      per_page: per_page as number | undefined,
    });
    return senseResult(comments, "WordPress");
  }),
);

server.tool(
  "wp_list_categories",
  "List WordPress categories. Use to find category IDs before creating posts.",
  {
    per_page: z.number().optional().describe("Number of categories to return (default 10, max 100)"),
    search: z.string().optional().describe("Search categories by name"),
  },
  safeHandler("wp_list_categories", async ({ _client, per_page, search }) => {
    const wp = _client as WordPressClient;
    const categories = await wp.listCategories({
      per_page: per_page as number | undefined,
      search: search as string | undefined,
    });
    return textResult(categories);
  }),
);

server.tool(
  "wp_list_tags",
  "List WordPress tags. Use to find tag IDs before creating posts.",
  {
    per_page: z.number().optional().describe("Number of tags to return (default 10, max 100)"),
    search: z.string().optional().describe("Search tags by name"),
  },
  safeHandler("wp_list_tags", async ({ _client, per_page, search }) => {
    const wp = _client as WordPressClient;
    const tags = await wp.listTags({
      per_page: per_page as number | undefined,
      search: search as string | undefined,
    });
    return textResult(tags);
  }),
);

// ── ACT tools (write) ──────────────────────────────────

server.tool(
  "wp_create_post",
  "Create a new WordPress blog post. Content should be HTML. ALWAYS set status='draft' unless explicitly told to publish — human review before going live.",
  {
    title: z.string().describe("Post title"),
    content: z.string().describe("Post content in HTML — use <h2>, <h3>, <p>, <ul> etc."),
    status: z
      .enum(["draft", "publish", "pending", "private"])
      .optional()
      .describe("Post status (default: draft). ALWAYS use 'draft' unless explicitly told to publish."),
    categories: z
      .array(z.number())
      .optional()
      .describe("Category IDs — use wp_list_categories to find IDs first"),
    tags: z
      .array(z.number())
      .optional()
      .describe("Tag IDs — use wp_list_tags to find IDs first"),
    featured_media: z
      .number()
      .optional()
      .describe("Media ID for featured/hero image — upload first with wp_upload_media, then pass the returned ID here"),
  },
  safeHandler("wp_create_post", async ({ _client, title, content, status, featured_media, categories, tags }) => {
    const wp = _client as WordPressClient;
    const post = await wp.createPost({
      title: title as string,
      content: content as string,
      status: (status as string) ?? "draft",
      featured_media: featured_media as number | undefined,
      categories: categories as number[] | undefined,
      tags: tags as number[] | undefined,
    });
    return textResult(post);
  }),
);

server.tool(
  "wp_update_post",
  "Update an existing WordPress post. This is also how you PUBLISH a draft: set status='publish'. Only pass fields you want to change.",
  {
    id: z.number().describe("Post ID to update"),
    title: z.string().optional().describe("New post title"),
    content: z.string().optional().describe("New post content in HTML"),
    status: z
      .enum(["draft", "publish", "pending", "private"])
      .optional()
      .describe("New post status"),
    categories: z.array(z.number()).optional().describe("New category IDs"),
    tags: z.array(z.number()).optional().describe("New tag IDs"),
    featured_media: z.number().optional().describe("Media ID for featured image — use wp_upload_media first"),
  },
  safeHandler("wp_update_post", async ({ _client, id, title, content, status, featured_media, categories, tags }) => {
    const wp = _client as WordPressClient;
    const data: Record<string, unknown> = {};
    if (title !== undefined) data.title = title;
    if (content !== undefined) data.content = content;
    if (status !== undefined) data.status = status;
    if (featured_media !== undefined) data.featured_media = featured_media;
    if (categories !== undefined) data.categories = categories;
    if (tags !== undefined) data.tags = tags;
    const post = await wp.updatePost(id as number, data);
    return textResult(post);
  }),
);

server.tool(
  "wp_create_comment",
  "Create a comment on a WordPress post. Requires post ID and comment content.",
  {
    post: z.number().describe("Post ID to comment on"),
    content: z.string().describe("Comment text"),
    author_name: z.string().optional().describe("Comment author name (if not logged in)"),
    author_email: z.string().optional().describe("Comment author email (if not logged in)"),
  },
  safeHandler("wp_create_comment", async ({ _client, post, content, author_name, author_email }) => {
    const wp = _client as WordPressClient;
    const comment = await wp.createComment({
      post: post as number,
      content: content as string,
      author_name: author_name as string | undefined,
      author_email: author_email as string | undefined,
    });
    return textResult(comment);
  }),
);

server.tool(
  "wp_delete_post",
  "Delete a WordPress post by ID. This is irreversible.",
  {
    id: z.number().describe("Post ID to delete"),
  },
  safeHandler("wp_delete_post", async ({ _client, id }) => {
    const wp = _client as WordPressClient;
    const result = await wp.deletePost(id as number);
    return textResult(result);
  }),
);

server.tool(
  "wp_upload_media",
  "Upload an image to WordPress media library from a URL. Returns the media ID which can be used as featured_media when creating or updating posts. Use for featured images (1200x630 landscape for OG tags) and inline images.",
  {
    url: z.string().describe("URL of the image to upload"),
    title: z.string().optional().describe("Media title for WordPress library"),
    alt_text: z.string().optional().describe("Alt text for accessibility and SEO"),
    caption: z.string().optional().describe("Image caption"),
  },
  safeHandler("wp_upload_media", async ({ _client, url, title, alt_text, caption }) => {
    const wp = _client as WordPressClient;
    const media = await wp.uploadMedia({
      url: url as string,
      title: title as string | undefined,
      alt_text: alt_text as string | undefined,
      caption: caption as string | undefined,
    });
    return textResult(media);
  }),
);

// ── Start ──────────────────────────────────────────────
async function main() {
  // Validate credentials at startup
  if (!SITE_URL || !USERNAME || !APP_PASSWORD) {
    logger.error(
      "Error: Set WORDPRESS_URL, WORDPRESS_USERNAME, and WORDPRESS_APP_PASSWORD environment variables.",
    );
    process.exit(1);
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);

  logger.error(`WordPress MCP Server v${version} running on stdio`);
  logger.error(`Site URL: ${SITE_URL}`);
  logger.error("Ready for MCP client");
}

main().catch((error) => {
  logger.error({ err: error }, "Fatal error");
  process.exit(1);
});
