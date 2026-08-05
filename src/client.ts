/**
 * WordPress REST API client using Application Passwords.
 *
 * Self-hosted WordPress 5.6+ only — uses /wp-json/wp/v2/ endpoints.
 * WordPress.com hosted sites need OAuth 2.1 (separate integration).
 */

export interface WPConfig {
  siteUrl: string;
  username: string;
  appPassword: string;
}

export class WordPressClient {
  private readonly baseUrl: string;
  private readonly authHeader: string;

  constructor(config: WPConfig) {
    this.baseUrl = config.siteUrl.replace(/\/+$/, "") + "/wp-json/wp/v2";
    const credentials = `${config.username}:${config.appPassword.replace(/\s+/g, "")}`;
    this.authHeader = `Basic ${Buffer.from(credentials).toString("base64")}`;
  }

  private async request<T = unknown>(
    endpoint: string,
    options: RequestInit = {},
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: this.authHeader,
        "Content-Type": "application/json",
        ...options.headers,
      },
    });

    const body = await response.text();
    if (!response.ok) {
      throw new Error(
        `WordPress API ${response.status}: ${body.substring(0, 300)}`,
      );
    }
    return JSON.parse(body) as T;
  }

  // ── Posts ──────────────────────────────────────────────

  async listPosts(params?: {
    per_page?: number;
    status?: string;
    search?: string;
  }) {
    const query = new URLSearchParams();
    if (params?.per_page) query.set("per_page", String(params.per_page));
    if (params?.status) query.set("status", params.status);
    if (params?.search) query.set("search", params.search);
    const qs = query.toString();
    return this.request(`/posts${qs ? `?${qs}` : ""}`);
  }

  async getPost(id: number) {
    return this.request(`/posts/${id}`);
  }

  async createPost(data: {
    title: string;
    content: string;
    status?: string;
    featured_media?: number;
    categories?: number[];
    tags?: number[];
  }) {
    return this.request("/posts", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async updatePost(
    id: number,
    data: {
      title?: string;
      content?: string;
      status?: string;
      featured_media?: number;
      categories?: number[];
      tags?: number[];
    },
  ) {
    return this.request(`/posts/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
  }

  async deletePost(id: number) {
    return this.request(`/posts/${id}`, { method: "DELETE" });
  }

  // ── Media ─────────────────────────────────────────────

  async uploadMedia(data: {
    url: string;
    title?: string;
    alt_text?: string;
    caption?: string;
  }) {
    // Download the image from URL, then upload to WordPress
    const imageResponse = await fetch(data.url);
    if (!imageResponse.ok) {
      throw new Error(
        `Failed to download image from ${data.url}: ${imageResponse.status}`,
      );
    }
    const contentType =
      imageResponse.headers.get("content-type") ?? "image/jpeg";
    const buffer = Buffer.from(await imageResponse.arrayBuffer());

    // Derive filename with proper extension from content-type
    const extMap: Record<string, string> = {
      "image/jpeg": ".jpg",
      "image/png": ".png",
      "image/gif": ".gif",
      "image/webp": ".webp",
      "image/svg+xml": ".svg",
      "video/mp4": ".mp4",
      "video/webm": ".webm",
    };
    const ext = extMap[contentType] ?? ".jpg";
    const urlPath = new URL(data.url).pathname;
    const baseName = urlPath.split("/").pop()?.replace(/\.[^.]+$/, "") ?? `upload-${Date.now()}`;
    const filename = baseName.includes(".") ? baseName : `${baseName}${ext}`;

    const uploadUrl = `${this.baseUrl}/media`;
    const response = await fetch(uploadUrl, {
      method: "POST",
      headers: {
        Authorization: this.authHeader,
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
      body: buffer,
    });

    const body = await response.text();
    if (!response.ok) {
      throw new Error(
        `WordPress API ${response.status}: ${body.substring(0, 300)}`,
      );
    }

    const media = JSON.parse(body);

    // Set title, alt_text, caption if provided
    const meta: Record<string, string> = {};
    if (data.title) meta.title = data.title;
    if (data.alt_text) meta.alt_text = data.alt_text;
    if (data.caption) meta.caption = data.caption;

    if (Object.keys(meta).length > 0) {
      return this.request(`/media/${media.id}`, {
        method: "POST",
        body: JSON.stringify(meta),
      });
    }

    return media;
  }

  // ── Comments ──────────────────────────────────────────

  async listComments(params?: { post?: number; per_page?: number }) {
    const query = new URLSearchParams();
    if (params?.post) query.set("post", String(params.post));
    if (params?.per_page) query.set("per_page", String(params.per_page));
    const qs = query.toString();
    return this.request(`/comments${qs ? `?${qs}` : ""}`);
  }

  async createComment(data: {
    post: number;
    content: string;
    author_name?: string;
    author_email?: string;
  }) {
    return this.request("/comments", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  // ── Taxonomy ──────────────────────────────────────────

  async listCategories(params?: { per_page?: number; search?: string }) {
    const query = new URLSearchParams();
    if (params?.per_page) query.set("per_page", String(params.per_page));
    if (params?.search) query.set("search", params.search);
    const qs = query.toString();
    return this.request(`/categories${qs ? `?${qs}` : ""}`);
  }

  async listTags(params?: { per_page?: number; search?: string }) {
    const query = new URLSearchParams();
    if (params?.per_page) query.set("per_page", String(params.per_page));
    if (params?.search) query.set("search", params.search);
    const qs = query.toString();
    return this.request(`/tags${qs ? `?${qs}` : ""}`);
  }

  // ── Site Info ─────────────────────────────────────────

  async getSiteInfo() {
    // Use the root /wp-json/ endpoint (outside /wp/v2/)
    const baseUrl = this.baseUrl.replace(/\/wp\/v2$/, "");
    const response = await fetch(baseUrl, {
      headers: { Authorization: this.authHeader },
    });
    const body = await response.text();
    if (!response.ok) {
      throw new Error(
        `WordPress API ${response.status}: ${body.substring(0, 300)}`,
      );
    }
    return JSON.parse(body);
  }
}
