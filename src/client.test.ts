import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { WordPressClient, type WPConfig } from "./client.js";

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
    headers: { get: () => null },
  };
}

function textErrorResponse(text: string, status: number) {
  return {
    ok: false,
    status,
    text: async () => text,
    headers: { get: () => null },
  };
}

function binaryResponse(
  contentType: string | null,
  status = 200,
  bytes: Uint8Array = new Uint8Array([1, 2, 3]),
) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (key: string) =>
        key.toLowerCase() === "content-type" ? contentType : null,
    },
    arrayBuffer: async () => bytes.buffer,
    text: async () => "",
  };
}

function makeClient(overrides?: Partial<WPConfig>) {
  return new WordPressClient({
    siteUrl: "https://example.com",
    username: "admin",
    appPassword: "abcd 1234 efgh 5678",
    ...overrides,
  });
}

function authHeaderOf(call: unknown): string {
  const [, init] = call as [string, RequestInit];
  const headers = init.headers as Record<string, string>;
  return headers.Authorization;
}

function urlOf(call: unknown): string {
  const [url] = call as [string, RequestInit];
  return url;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("WordPressClient construction", () => {
  it("builds the base URL from the site URL, stripping trailing slashes", async () => {
    fetchMock.mockResolvedValue(jsonResponse([]));
    const client = makeClient({ siteUrl: "https://example.com///" });
    await client.listPosts();
    expect(urlOf(fetchMock.mock.calls[0])).toBe(
      "https://example.com/wp-json/wp/v2/posts",
    );
  });

  it("encodes username and app password as Basic auth, stripping whitespace", async () => {
    fetchMock.mockResolvedValue(jsonResponse([]));
    const client = makeClient({
      username: "admin",
      appPassword: "abcd 1234 efgh 5678",
    });
    await client.listPosts();
    const expected = `Basic ${Buffer.from("admin:abcd1234efgh5678").toString("base64")}`;
    expect(authHeaderOf(fetchMock.mock.calls[0])).toBe(expected);
  });
});

describe("listPosts", () => {
  it("requests /posts with no query string when no params given", async () => {
    fetchMock.mockResolvedValue(jsonResponse([]));
    const client = makeClient();
    await client.listPosts();
    expect(urlOf(fetchMock.mock.calls[0])).toBe(
      "https://example.com/wp-json/wp/v2/posts",
    );
  });

  it("builds a query string from per_page, status, and search", async () => {
    fetchMock.mockResolvedValue(jsonResponse([]));
    const client = makeClient();
    await client.listPosts({ per_page: 5, status: "draft", search: "hello" });
    const url = urlOf(fetchMock.mock.calls[0]);
    expect(url).toContain("per_page=5");
    expect(url).toContain("status=draft");
    expect(url).toContain("search=hello");
  });

  it("returns the parsed JSON body", async () => {
    const posts = [{ id: 1, title: "Hello" }];
    fetchMock.mockResolvedValue(jsonResponse(posts));
    const client = makeClient();
    await expect(client.listPosts()).resolves.toEqual(posts);
  });
});

describe("getPost", () => {
  it("requests /posts/:id", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: 42 }));
    const client = makeClient();
    await client.getPost(42);
    expect(urlOf(fetchMock.mock.calls[0])).toBe(
      "https://example.com/wp-json/wp/v2/posts/42",
    );
  });
});

describe("createPost", () => {
  it("POSTs to /posts with the given data as JSON", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: 1 }));
    const client = makeClient();
    await client.createPost({
      title: "Hi",
      content: "<p>Body</p>",
      status: "draft",
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://example.com/wp-json/wp/v2/posts");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      title: "Hi",
      content: "<p>Body</p>",
      status: "draft",
    });
  });
});

describe("updatePost", () => {
  it("PATCHes /posts/:id with only the provided fields", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: 7 }));
    const client = makeClient();
    await client.updatePost(7, { status: "publish" });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://example.com/wp-json/wp/v2/posts/7");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toEqual({ status: "publish" });
  });
});

describe("deletePost", () => {
  it("DELETEs /posts/:id", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ deleted: true }));
    const client = makeClient();
    await client.deletePost(9);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://example.com/wp-json/wp/v2/posts/9");
    expect(init.method).toBe("DELETE");
  });
});

describe("listComments", () => {
  it("builds a query string from post and per_page", async () => {
    fetchMock.mockResolvedValue(jsonResponse([]));
    const client = makeClient();
    await client.listComments({ post: 3, per_page: 20 });
    const url = urlOf(fetchMock.mock.calls[0]);
    expect(url).toContain("post=3");
    expect(url).toContain("per_page=20");
  });

  it("requests /comments with no query string when no params given", async () => {
    fetchMock.mockResolvedValue(jsonResponse([]));
    const client = makeClient();
    await client.listComments();
    expect(urlOf(fetchMock.mock.calls[0])).toBe(
      "https://example.com/wp-json/wp/v2/comments",
    );
  });
});

describe("createComment", () => {
  it("POSTs to /comments with the given data", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: 1 }));
    const client = makeClient();
    await client.createComment({ post: 3, content: "Nice post!" });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://example.com/wp-json/wp/v2/comments");
    expect(JSON.parse(init.body as string)).toEqual({
      post: 3,
      content: "Nice post!",
    });
  });
});

describe("listCategories / listTags", () => {
  it("builds a query string from per_page and search for categories", async () => {
    fetchMock.mockResolvedValue(jsonResponse([]));
    const client = makeClient();
    await client.listCategories({ per_page: 15, search: "news" });
    const url = urlOf(fetchMock.mock.calls[0]);
    expect(url).toContain("/categories?");
    expect(url).toContain("per_page=15");
    expect(url).toContain("search=news");
  });

  it("builds a query string from per_page and search for tags", async () => {
    fetchMock.mockResolvedValue(jsonResponse([]));
    const client = makeClient();
    await client.listTags({ search: "ai" });
    const url = urlOf(fetchMock.mock.calls[0]);
    expect(url).toContain("/tags?");
    expect(url).toContain("search=ai");
  });

  it("requests /categories with no query string when no params given", async () => {
    fetchMock.mockResolvedValue(jsonResponse([]));
    const client = makeClient();
    await client.listCategories();
    expect(urlOf(fetchMock.mock.calls[0])).toBe(
      "https://example.com/wp-json/wp/v2/categories",
    );
  });

  it("requests /tags with only per_page when search is omitted", async () => {
    fetchMock.mockResolvedValue(jsonResponse([]));
    const client = makeClient();
    await client.listTags({ per_page: 25 });
    const url = urlOf(fetchMock.mock.calls[0]);
    expect(url).toContain("per_page=25");
    expect(url).not.toContain("search=");
  });
});

describe("getSiteInfo", () => {
  it("requests the root wp-json endpoint, not /wp/v2", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ name: "My Blog" }));
    const client = makeClient();
    await client.getSiteInfo();
    expect(urlOf(fetchMock.mock.calls[0])).toBe("https://example.com/wp-json");
  });

  it("sends only the Authorization header, no Content-Type", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ name: "My Blog" }));
    const client = makeClient();
    await client.getSiteInfo();
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBeDefined();
    expect(headers["Content-Type"]).toBeUndefined();
  });

  it("returns the parsed JSON body", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ name: "My Blog" }));
    const client = makeClient();
    await expect(client.getSiteInfo()).resolves.toEqual({ name: "My Blog" });
  });

  it("throws on a non-ok response", async () => {
    fetchMock.mockResolvedValue(textErrorResponse("Forbidden", 403));
    const client = makeClient();
    await expect(client.getSiteInfo()).rejects.toThrow(
      "WordPress API 403: Forbidden",
    );
  });
});

describe("request error handling", () => {
  it("throws an Error including the status and response body", async () => {
    fetchMock.mockResolvedValue(textErrorResponse("Post not found", 404));
    const client = makeClient();
    await expect(client.getPost(999)).rejects.toThrow(
      "WordPress API 404: Post not found",
    );
  });

  it("truncates long error bodies to 300 characters", async () => {
    const longBody = "x".repeat(500);
    fetchMock.mockResolvedValue(textErrorResponse(longBody, 500));
    const client = makeClient();
    try {
      await client.getPost(1);
      expect.unreachable();
    } catch (e) {
      const message = (e as Error).message;
      expect(message).toContain("x".repeat(300));
      expect(message).not.toContain("x".repeat(301));
    }
  });
});

describe("uploadMedia", () => {
  it("downloads the image and uploads it, returning the media object when no metadata given", async () => {
    fetchMock
      .mockResolvedValueOnce(binaryResponse("image/png"))
      .mockResolvedValueOnce(
        jsonResponse({ id: 55, source_url: "https://example.com/img.png" }),
      );

    const client = makeClient();
    const media = await client.uploadMedia({
      url: "https://cdn.example.com/photo.png",
    });

    expect(media).toEqual({
      id: 55,
      source_url: "https://example.com/img.png",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const [downloadUrl] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(downloadUrl).toBe("https://cdn.example.com/photo.png");

    const [uploadUrl, uploadInit] = fetchMock.mock.calls[1] as [
      string,
      RequestInit,
    ];
    expect(uploadUrl).toBe("https://example.com/wp-json/wp/v2/media");
    expect(uploadInit.method).toBe("POST");
    const uploadHeaders = uploadInit.headers as Record<string, string>;
    expect(uploadHeaders["Content-Type"]).toBe("image/png");
    expect(uploadHeaders["Content-Disposition"]).toContain("photo.png");
  });

  it("makes a follow-up request to set title, alt_text, and caption when provided", async () => {
    fetchMock
      .mockResolvedValueOnce(binaryResponse("image/jpeg"))
      .mockResolvedValueOnce(jsonResponse({ id: 10 }))
      .mockResolvedValueOnce(
        jsonResponse({ id: 10, title: { rendered: "Sunset" } }),
      );

    const client = makeClient();
    const media = await client.uploadMedia({
      url: "https://cdn.example.com/sunset.jpg",
      title: "Sunset",
      alt_text: "A sunset over the ocean",
      caption: "Golden hour",
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const [metaUrl, metaInit] = fetchMock.mock.calls[2] as [
      string,
      RequestInit,
    ];
    expect(metaUrl).toBe("https://example.com/wp-json/wp/v2/media/10");
    expect(JSON.parse(metaInit.body as string)).toEqual({
      title: "Sunset",
      alt_text: "A sunset over the ocean",
      caption: "Golden hour",
    });
    expect(media).toEqual({ id: 10, title: { rendered: "Sunset" } });
  });

  it.each([
    ["image/jpeg", "fallback.jpg"],
    ["image/png", "fallback.png"],
    ["image/gif", "fallback.gif"],
    ["image/webp", "fallback.webp"],
    ["image/svg+xml", "fallback.svg"],
    ["video/mp4", "fallback.mp4"],
    ["video/webm", "fallback.webm"],
  ])(
    "derives a %s filename from the content-type when the URL has no extension",
    async (contentType, expectedFilename) => {
      fetchMock
        .mockResolvedValueOnce(binaryResponse(contentType))
        .mockResolvedValueOnce(jsonResponse({ id: 1 }));

      const client = makeClient();
      await client.uploadMedia({ url: "https://cdn.example.com/fallback" });

      const [, uploadInit] = fetchMock.mock.calls[1] as [string, RequestInit];
      const headers = uploadInit.headers as Record<string, string>;
      expect(headers["Content-Disposition"]).toContain(expectedFilename);
    },
  );

  it("defaults to .jpg for an unrecognized content-type", async () => {
    fetchMock
      .mockResolvedValueOnce(binaryResponse("application/octet-stream"))
      .mockResolvedValueOnce(jsonResponse({ id: 1 }));

    const client = makeClient();
    await client.uploadMedia({ url: "https://cdn.example.com/mystery" });

    const [, uploadInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    const headers = uploadInit.headers as Record<string, string>;
    expect(headers["Content-Disposition"]).toContain("mystery.jpg");
  });

  it("preserves the original filename when the URL path already has an extension", async () => {
    fetchMock
      .mockResolvedValueOnce(binaryResponse("image/png"))
      .mockResolvedValueOnce(jsonResponse({ id: 1 }));

    const client = makeClient();
    await client.uploadMedia({
      url: "https://cdn.example.com/path/to/hero.png",
    });

    const [, uploadInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    const headers = uploadInit.headers as Record<string, string>;
    expect(headers["Content-Disposition"]).toContain('filename="hero.png"');
  });

  it("throws when the image download fails", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 404,
      headers: { get: () => null },
      text: async () => "",
    });

    const client = makeClient();
    await expect(
      client.uploadMedia({ url: "https://cdn.example.com/missing.png" }),
    ).rejects.toThrow(
      "Failed to download image from https://cdn.example.com/missing.png: 404",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("throws when the WordPress upload response is not ok", async () => {
    fetchMock
      .mockResolvedValueOnce(binaryResponse("image/png"))
      .mockResolvedValueOnce(textErrorResponse("Payload too large", 413));

    const client = makeClient();
    await expect(
      client.uploadMedia({ url: "https://cdn.example.com/big.png" }),
    ).rejects.toThrow("WordPress API 413: Payload too large");
  });

  it("defaults to image/jpeg when the download response has no content-type", async () => {
    fetchMock
      .mockResolvedValueOnce(binaryResponse(null))
      .mockResolvedValueOnce(jsonResponse({ id: 1 }));

    const client = makeClient();
    await client.uploadMedia({ url: "https://cdn.example.com/no-type" });

    const [, uploadInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    const headers = uploadInit.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("image/jpeg");
    expect(headers["Content-Disposition"]).toContain("no-type.jpg");
  });
});
