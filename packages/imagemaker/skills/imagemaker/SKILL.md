---
name: imagemaker
description: Use when the user asks to generate, revise, configure, manage, insert, or export images with the Lfcode ImageMaker plugin or its supported image-generation APIs.
---

# ImageMaker

Use `imagemaker_generate` to create images from a prompt. Include the desired visual content, style, composition, lighting, aspect ratio, and exclusions in the prompt or negative prompt. Do not invent an API key or expose provider credentials.

To revise an image created earlier in this conversation, use `imagemaker_edit` with its exact `image_id` from the generation result and a concise edit instruction. Image editing currently requires the configured OpenAI-compatible image provider; state that limitation clearly instead of silently switching providers.

If generation reports that no provider is configured, ask the user to open the plugin page, choose a provider, and save its API key. Supported profiles include OpenAI and compatible endpoints, Azure OpenAI, Stability AI, Replicate, BFL/FLUX, Gemini/Imagen, DashScope/Wanxiang, Volcengine Ark/Doubao, and declarative custom REST endpoints.

Generated images are saved in the plugin gallery and returned as rich conversation cards with image attachments. Preserve the user's prompt and provider choice when revising an image unless they request changes. There is no separate ImageMaker project or workspace.

For custom REST providers, use only declarative URL, method, headers, JSON body, and response-path configuration. Never execute user-provided scripts.
