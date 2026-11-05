import { describe, expect, it } from "vitest";

import { normalizeProviderBaseUrl, parseConnectionText } from "./parseConnectionText";

/** 与站点生成深链的方式一致：UTF-8 字节再 base64 再 urlsafe 替换。 */
function urlSafeBase64(value: string): string {
  return btoa(String.fromCharCode(...new TextEncoder().encode(value)))
    .replaceAll("+", "-")
    .replaceAll("/", "_");
}

describe("normalizeProviderBaseUrl", () => {
  it.each([
    ["https://api.relay.site", "https://api.relay.site/v1"],
    ["https://api.relay.site/v1", "https://api.relay.site/v1"],
    ["https://api.relay.site/v1/", "https://api.relay.site/v1"],
    ["https://generativelanguage.googleapis.com/v1beta", "https://generativelanguage.googleapis.com/v1beta"],
    ['"https://api.relay.site"', "https://api.relay.site/v1"],
  ])("规范化 %s → %s", (input, expected) => {
    expect(normalizeProviderBaseUrl(input)).toBe(expected);
  });

  it("非法 URL 返回 null", () => {
    expect(normalizeProviderBaseUrl("not a url")).toBeNull();
    expect(normalizeProviderBaseUrl("")).toBeNull();
  });
});

describe("parseConnectionText", () => {
  it("解析 New API 连接串并给站点根地址补 /v1", () => {
    const draft = parseConnectionText(
      '{"_type":"newapi_channel_conn","key":"sk-abc123def45678","url":"https://api.relay.site"}',
    );
    expect(draft).toEqual({ apiKey: "sk-abc123def45678", baseUrl: "https://api.relay.site/v1" });
  });

  it("解析 cherry 深链的 urlsafe-base64 载荷", () => {
    const payload = JSON.stringify({
      id: "custom-openai",
      name: "我的中转",
      baseUrl: "https://api.relay.site/v1",
      apiKey: "sk-abc123def45678",
    });
    const draft = parseConnectionText(`cherrystudio://providers/api-keys?v=1&data=${urlSafeBase64(payload)}`);
    expect(draft).toEqual({ apiKey: "sk-abc123def45678", baseUrl: "https://api.relay.site/v1", name: "我的中转" });
  });

  it("解析 ccswitch 深链的查询参数", () => {
    const draft = parseConnectionText(
      "ccswitch://v1/import?resource=provider&app=claude&name=My%20Relay&apiKey=sk-abc123def45678&endpoint=https%3A%2F%2Fapi.relay.site",
    );
    expect(draft).toEqual({ apiKey: "sk-abc123def45678", baseUrl: "https://api.relay.site/v1", name: "My Relay" });
  });

  it("解析环境变量对（含 export 前缀与引号值）", () => {
    const draft = parseConnectionText(
      'export OPENAI_BASE_URL="https://api.relay.site"\nexport OPENAI_API_KEY=sk-abc123def45678',
    );
    expect(draft).toEqual({ apiKey: "sk-abc123def45678", baseUrl: "https://api.relay.site/v1" });
  });

  it("解析朴素多行文本，地址与密钥任意顺序", () => {
    expect(parseConnectionText("https://api.relay.site\nsk-abc123def45678")).toEqual({
      apiKey: "sk-abc123def45678",
      baseUrl: "https://api.relay.site/v1",
    });
    expect(parseConnectionText("sk-abc123def45678\nhttps://api.relay.site")).toEqual({
      apiKey: "sk-abc123def45678",
      baseUrl: "https://api.relay.site/v1",
    });
  });

  it("解析 Gemini 原生密钥", () => {
    const key = `AIza${"a1".repeat(18)}`;
    expect(parseConnectionText(`https://generativelanguage.googleapis.com/v1beta\n${key}`)).toEqual({
      apiKey: key,
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    });
  });

  it("纯地址 / 纯密钥只填对应字段", () => {
    expect(parseConnectionText("https://api.relay.site/v1")).toEqual({ baseUrl: "https://api.relay.site/v1" });
    expect(parseConnectionText("sk-abc123def45678")).toEqual({ apiKey: "sk-abc123def45678" });
  });

  it("URL 查询参数里的长 base64 不会被误判为密钥", () => {
    const draft = parseConnectionText("https://relay.test/callback?state=abcdefghijabcdefghijabcdefghijabcdefghij");
    expect(draft).toEqual({ baseUrl: "https://relay.test/callback?state=abcdefghijabcdefghijabcdefghijabcdefghij" });
  });

  it("无法识别的文本返回 null", () => {
    expect(parseConnectionText("随便一段没有地址和密钥的说明文字")).toBeNull();
    expect(parseConnectionText("   ")).toBeNull();
    expect(parseConnectionText("12345")).toBeNull();
  });
});
