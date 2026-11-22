import { AiProviderService } from "./ai-provider.service";

describe("AiProviderService image generation", () => {
  const s3 = { uploadBuffer: jest.fn(), getPresignedUrl: jest.fn() };
  const integrations = { getOpenAiConfig: jest.fn() };
  let provider: AiProviderService;
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    integrations.getOpenAiConfig.mockResolvedValue({
      apiKey: "test-key",
      isConfigured: true,
      isEnabled: true,
    });
    s3.uploadBuffer.mockResolvedValue({
      imageKey: "generated.png",
      imageUrl: "https://cdn.example/generated.png",
    });
    s3.getPresignedUrl.mockResolvedValue("https://cdn.example/generated.png");
    provider = new AiProviderService(s3 as any, integrations as any);
    fetchSpy = jest.spyOn(global, "fetch");
  });

  afterEach(() => fetchSpy.mockRestore());

  it("uses the configured current GPT Image model and supported image options", async () => {
    integrations.getOpenAiConfig.mockResolvedValue({
      apiKey: "test-key",
      imageModel: "gpt-image-2.6-flare",
      isConfigured: true,
      isEnabled: true,
    });
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [{ b64_json: Buffer.from("image").toString("base64") }],
        }),
        { status: 200 },
      ),
    );

    const result = await provider.generateImage({ product: "coffee" });
    const request = JSON.parse(String(fetchSpy.mock.calls[0][1]?.body));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][0]).toBe(
      "https://api.openai.com/v1/images/generations",
    );
    expect(request).toMatchObject({
      model: "gpt-image-2.6-flare",
      n: 1,
      size: "1024x1024",
      quality: "auto",
      output_format: "png",
    });
    expect(result).toMatchObject({
      url: "https://cdn.example/generated.png",
      model: "gpt-image-2.6-flare",
      width: 1024,
      height: 1024,
    });
  });

  it("does not fall back to obsolete or other providers when OpenAI rejects a model", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: { code: "model_not_found", message: "model does not exist" },
        }),
        { status: 400 },
      ),
    );
    await expect(provider.generateImage({ product: "coffee" })).rejects.toThrow(
      "Select a supported GPT Image model",
    );
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid configured image models before making an API request", async () => {
    integrations.getOpenAiConfig.mockResolvedValue({
      apiKey: "test-key",
      imageModel: "gpt-4o-mini",
      isConfigured: true,
      isEnabled: true,
    });
    await expect(provider.generateImage({ product: "coffee" })).rejects.toThrow(
      "Unsupported OpenAI image model",
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("maps invalid API keys and rate limits to safe client errors", async () => {
    fetchSpy.mockResolvedValueOnce(new Response("{}", { status: 401 }));
    await expect(provider.generateImage({ product: "coffee" })).rejects.toThrow(
      "OpenAI rejected the configured API key",
    );
    fetchSpy.mockResolvedValueOnce(new Response("{}", { status: 429 }));
    await expect(provider.generateImage({ product: "coffee" })).rejects.toThrow(
      "rate limited or the account has insufficient quota",
    );
  });

  it("does not log prompt or provider error details", async () => {
    const logger = jest
      .spyOn((provider as any).logger, "log")
      .mockImplementation();
    const warning = jest
      .spyOn((provider as any).logger, "warn")
      .mockImplementation();
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: {
            code: "invalid_api_key",
            message: "sensitive provider detail",
          },
        }),
        { status: 401 },
      ),
    );
    await expect(
      provider.generateImage({ product: "private prompt text" }),
    ).rejects.toThrow();
    expect(logger.mock.calls.flat().join(" ")).not.toContain(
      "private prompt text",
    );
    expect(warning.mock.calls.flat().join(" ")).not.toContain(
      "sensitive provider detail",
    );
  });
});
