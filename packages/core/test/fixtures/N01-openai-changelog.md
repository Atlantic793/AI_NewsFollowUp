# Changelog

> For the complete documentation index, see [llms.txt](/llms.txt). Markdown versions of documentation pages are available by appending `.md` to the page URL.

> The latest features and updates to the OpenAI API.

Upcoming deprecations are listed on the [deprecations page](/api/docs/deprecations).

## November, 2026

### Nov 5

Feature · Model: gpt-6-cyber

Use [GPT-6-Cyber](https://developers.openai.com/api/docs/models/gpt-6-cyber) to investigate vulnerabilities, reproduce them in an authorized test environment, and verify fixes. See [Daybreak setup](https://developers.openai.com/api/docs/guides/daybreak#set-up-gpt-6-cyber) before sending your first request.

### Nov 4

Feature · Model: gpt-image-2.6-sunburst · Model: gpt-image-2.6-flare · API: v1/images/generations · API: v1/images/edits

Released [GPT-Image-2.6 Sunburst](https://developers.openai.com/api/docs/models/gpt-image-2.6-sunburst) and [GPT-Image-2.6 Flare](https://developers.openai.com/api/docs/models/gpt-image-2.6-flare) for image generation and editing, with adjustable complexity, SVG generation, and animated GIF generation. Added markup-guided editing for supported GPT Image 2.5 and 2.6 models.

See the [image generation guide](https://developers.openai.com/api/docs/guides/image-generation#gpt-image-26).

### Nov 2

Feature · Model: gpt-live-1 · API: v1/live/sessions

Outbound SIP calling is now available to all organizations through the Live API. Connect GPT-Live to a phone number through your SIP provider. See the [SIP guide](https://developers.openai.com/api/docs/guides/voice-sip?api=live#place-an-outbound-call).

## October, 2026

### Oct 30

Update · API: v1/agents · API: v1/agents/sessions

You can now [update the tools in an existing session](https://developers.openai.com/api/docs/guides/agents-api/configuration#update-settings-for-an-existing-session) in the Agents API public beta. Updates replace the full tool list. Function tools and MCP servers change on the next model call; built-in tools change by the next turn.

Context compaction now runs in the background by default. Set `compaction.async` to `false` for blocking compaction. Background compaction may increase token usage.

Added opt-in experimental time awareness. Set `experimental.time_awareness` to `true` to give the model periodic current-time reminders. It is disabled by default. See the [agent configuration reference](https://developers.openai.com/api/reference/resources/beta/subresources/agents/methods/create) for compaction and experimental settings.

### Oct 30

Feature · API: v1/agents/sessions

Added automatic review for eligible Agents API projects. Set the session's `review` field to `"auto_review"` to have a model approve or deny supported tool and permission requests based on conversation intent and risk. See the [automatic review guide](https://developers.openai.com/api/docs/guides/agents-api/sessions/approvals) for supported requests, limitations, and additional token billing.

### Oct 30

Feature · Model: gpt-6-rosalind

Released [GPT-6 Rosalind](https://developers.openai.com/api/docs/pricing#life-sciences-models), bringing specialized biological reasoning with scientific tool use to complex life sciences research. Access is available to organizations approved for Rosalind Research through the [trusted-access program](https://help.openai.com/en/articles/20001193-gpt-rosalind-for-life-sciences-research) for internal research by authorized users.

### Oct 28

Feature

Eligible ChatGPT Pro and Business subscribers can now claim up to $500 per month in free API credits as a subscription benefit. Activate the benefit from ChatGPT or API Platform by linking an API organization you own. See [API credits for ChatGPT subscribers](https://developers.openai.com/api/docs/guides/chatgpt-api-credits) for credit amounts, eligibility, and how to claim.

### Oct 26

Feature · Model: gpt-6.1-terra · API: v1/responses · API: v1/chat/completions

Released [GPT-6.1 Terra](https://developers.openai.com/api/docs/models/gpt-6.1-terra), a fast, efficient model for visual reasoning, precise computer use, and clear, natural writing.

See the [GPT-6 guide](https://developers.openai.com/api/docs/guides/latest-model?model=gpt-6-astra#gpt-61-terra) for prompting and migration guidance.

### Oct 23

Feature · API: v1/agents/automations

Added [scheduled automations](https://developers.openai.com/api/docs/guides/agents-api/sessions/automations) to the Agents API public beta. Schedule one-time or recurring tasks in new or existing sessions. Enable the `automations` tool to let an agent schedule its own follow-ups in the current session.

### Oct 22

Update · Model: gpt-6-luna · API: v1/decisions

The [Decisions API](https://developers.openai.com/api/docs/guides/decisions) is now generally available with `gpt-6-luna`. Cache shared input across requests for prompt-cache discounts, include images in individual question instructions, and pass structured data directly with `input_json`. Each request now supports up to 400 questions, increased from 200 in public beta. Review the [changes since public beta](https://developers.openai.com/api/docs/guides/decisions#whats-new).

### Oct 21

Feature

You can now choose which service tiers projects can use in Platform settings. Organization settings can restrict service tiers for all projects. See [service tier errors](https://developers.openai.com/api/docs/guides/error-codes).

### Oct 20

Feature · API: v1/responses

You can now choose 12-hour prompt caching in the API. 12-hour prompt caching keeps shared instructions, tools, and context cached longer to benefit from lower cached-input pricing, even when requests are hours apart. 12-hour cache writes cost 2.5x the input token price. Read more [here](https://developers.openai.com/api/docs/guides/prompt-caching).

### Oct 16

Feature · Model: gpt-live-1 · API: v1/audio/voices · API: v1/live/sessions

Released [prompt-to-voice](https://developers.openai.com/api/docs/guides/custom-voices#create-a-voice-from-a-description) for all API customers. Create a custom voice from a text description through the API or voice Playground, then reuse it in GPT-Live sessions. Creating a prompt-generated voice is free; speech generation uses regular GPT-Live session billing.

Added nine [natural voices for GPT-Live](https://developers.openai.com/api/docs/guides/live-conversations#voice-options): Nuri, Juni, and Flitz (German); Brise and Sillage (French); Nira (Hindi); Harema and Shida (Japanese); and Noeul (Korean).

### Oct 16

Feature · API: v1/agents

[OpenAI-hosted sandboxes](https://developers.openai.com/api/docs/guides/agents-api/environments/openai-hosted) in the Agents API now include the Artifact SDK and skills for creating and editing spreadsheets, presentations, and Word documents.

Added [Ultrafast mode](https://developers.openai.com/api/docs/guides/ultrafast-mode) to the Agents API. Set `agent.service_tier` to `ultrafast` with a supported model to reduce the time between generated tokens.

### Oct 15

Feature · Model: gpt-live-1 · Model: gpt-6-luna · API: v1/live/sessions

Added native [Decisions integration in GPT-Live](https://developers.openai.com/api/docs/guides/decisions-voice). Your app can act while your user is speaking or react to what Live says. Let Live call Decisions directly through native delegation, or trigger decisions as input or output transcript deltas arrive.

### Oct 9

Feature · API: v1/agents

You can now [pre-warm an OpenAI-hosted sandbox](https://developers.openai.com/api/docs/guides/agents-api/environments/prewarmed) before attaching it to an Agents API session. Prewarming improves latency by creating and configuring the sandbox before a user finishes sending their message. This means the user doesn't have to wait for all this work to complete.

OpenAI-hosted sandbox compute is now billed during active turns. You no longer pay for idle time between turns.

### Oct 8

Feature · Model: gpt-6.1-sol · API: v1/responses

Added [Ultrafast mode](https://developers.openai.com/api/docs/guides/ultrafast-mode) for [GPT-6.1 Sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol) in the Responses API. Use `gpt-6.1-sol` with `service_tier: "ultrafast"` to reduce the time between generated output tokens. It is available to all API users, subject to rate limits, with global processing and US and EU data residency. See [Ultrafast pricing](https://developers.openai.com/api/docs/pricing?latest-pricing=ultrafast).

### Oct 7

Update · Model: chat-latest

Updated the **chat-latest** snapshot, which points to the latest model available in ChatGPT for Plus, Pro, Business and Enterprise users. We recommend leveraging the [GPT-6 model family](https://developers.openai.com/api/docs/guides/latest-model) for production API usage, but feel free to use this model to test the latest improvements for chat use cases. The underlying model snapshot will be regularly updated. Read more [here](https://developers.openai.com/api/docs/models/chat-latest).

### Oct 6

Feature · Model: gpt-6-luna · API: v1/decisions

Released the [Decisions API](https://developers.openai.com/api/docs/guides/decisions) in beta with `gpt-6-luna`. Turn text and images into typed answers 10x faster than the Responses API.

### Oct 6

Update

Simplified API usage tiers from five to three: Build, Launch, and Grow. Organizations automatically upgrade as total credit purchases reach tier minimums. See [usage tiers](https://developers.openai.com/api/docs/guides/rate-limits#usage-tiers) for monthly usage limits and how to view rate limits for each model.

### Oct 5

Feature

Added an in-product flow for HIPAA compliance support in API [Organization settings > General](https://platform.openai.com/settings/organization/general). Admins of eligible organizations can now accept the standard Business Associate Agreement (BAA) and enable HIPAA compliance support for their organization. See the [Help Center](https://help.openai.com/en/articles/8660679-getting-a-business-associate-agreement-for-the-openai-api) for eligibility, covered services, and configuration requirements.

### Oct 2

Feature · API: v1/agents/sessions

Added [item history for individual root-agent turns](https://developers.openai.com/api/docs/guides/agents-api/sessions/events#fetch-items-and-turns) in the Agents API public beta. Retrieve a turn's messages and tool calls without listing the entire session's history.

## September, 2026

### Sep 29

Feature

Added [computer use](https://developers.openai.com/api/docs/guides/agents-api/tools/computer-use) to the Agents API. Agents can complete tasks in an OpenAI-hosted browser, with website access approvals and sign-in handled by your application.

### Sep 29

Feature · Model: gpt-6.1-sol · API: v1/responses · API: v1/chat/completions

Released [GPT-6.1 Sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol) (`gpt-6.1-sol`) for complex coding and professional work at a lower cost than GPT-6 Astra.

Standard pricing per 1M tokens for prompts with up to 272K input tokens is $2 input, $0.10 cached input, $2.50 cache write, and $10 output.

GPT-6.1 Sol also supports [Multi-agent](https://developers.openai.com/api/docs/guides/responses-multi-agent) in beta. Let the model delegate work to subagents in a Responses API request.

Use the Responses API for tool calling. See [GPT-6 model guidance](https://developers.openai.com/api/docs/guides/latest-model?model=gpt-6-astra#gpt-61-sol) for reasoning settings and [pricing](https://developers.openai.com/api/docs/pricing) for available processing tiers.

### Sep 29

Feature · Model: gpt-6-astra · API: v1/responses

Added [Ultrafast mode](https://developers.openai.com/api/docs/guides/ultrafast-mode) for GPT-6 Astra in the Responses API. Use `gpt-6-astra` with `service_tier: "ultrafast"` to reduce the time between generated output tokens. It is available to API customers, subject to rate limits, with global processing and US data residency. EU and other regional inference residency aren't supported. See [Ultrafast pricing](https://developers.openai.com/api/docs/pricing?latest-pricing=ultrafast).

### Sep 25

Fix · Model: gpt-6-sol · Model: gpt-6-luna

Fixed a bug in image encoding that degraded image understanding in [GPT-6 Sol](https://developers.openai.com/api/docs/models/gpt-6-sol) and [GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna). This update improves results on visual tasks in the API and Codex, including computer use.

If your use cases involve image inputs, we recommend rerunning your evaluations and retrying workflows affected by the issue.

### Sep 22

Feature · Model: gpt-6-sol · Model: gpt-6-luna · API: v1/responses · API: v1/chat/completions

Released [GPT-6 Sol](https://developers.openai.com/api/docs/models/gpt-6-sol) (`gpt-6-sol`) and [GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna) (`gpt-6-luna`).

These reasoning models accept text and image inputs and generate text through the Responses and Chat Completions APIs.

Standard pricing per 1M tokens for prompts with up to 272K input tokens:

- GPT-6 Sol: $2 input, $0.20 cached input, and $10 output.
- GPT-6 Luna: $0.10 input, $0.01 cached input, and $0.50 output.

Compare capabilities in the [model catalog](https://developers.openai.com/api/docs/models), and see [pricing](https://developers.openai.com/api/docs/pricing) for cache writes, longer prompts, and other processing tiers.

### Sep 15

Feature

Added API key creation governance controls at the organization and project levels. Administrators can allow only service-account keys, allow only user-owned project keys, or disable all new API key creation. Organization restrictions take precedence over project settings, and existing API keys are unaffected. See [production best practices](https://developers.openai.com/api/docs/guides/production-best-practices#api-keys) for details.

### Sep 10

Feature

You can now set expiration dates when creating project API keys. Administrators can also enforce a maximum key lifetime at the organization or project level in Platform settings, requiring newly created keys to expire within the configured limit. See [production best practices](https://developers.openai.com/api/docs/guides/production-best-practices#api-keys) for guidance on key expiration and rotation.

### Sep 10

Feature

Released the [Agents API](https://developers.openai.com/api/docs/guides/agents-api/overview) in public beta. Build agents with a managed Codex harness while OpenAI handles session orchestration, context compaction, and recovery.

Use durable sessions to continue work across turns, stream progress, and connect your own tools and MCP servers. Run agents in OpenAI-hosted sandboxes or connect a sandbox from your own infrastructure or a supported provider.

Start with the [Agents API quickstart](https://developers.openai.com/api/docs/guides/agents-api/quickstart).

### Sep 10

Feature · Model: gpt-live-1 · API: v1/live/sessions

[GPT-Live 1](https://developers.openai.com/api/docs/models/gpt-live-1) is now generally available in the API. Build full-duplex voice conversations that can continue while a backend model or agent handles reasoning and tools.

Use Responses delegation with an OpenAI model, or client delegation to connect your own backend. Voice sessions cost $0.05 per minute, billed per second; backend model and tool usage is charged separately.

Start with [GPT-Live](https://developers.openai.com/api/docs/guides/live), [prompting](https://developers.openai.com/api/docs/guides/live-prompting), and [migration guidance](https://developers.openai.com/api/docs/guides/live-migration). See [pricing](https://developers.openai.com/api/docs/pricing) for details.

### Sep 8

Feature · API: v1/responses

[Prompt Cache Diagnostics](https://developers.openai.com/api/docs/guides/prompt-caching/diagnostics) is now generally available in the Responses API for GPT-5.6 and later supported models.

Compare cache reuse against a previous response, identify reasons for cache misses, and follow troubleshooting guidance to improve cache reuse.

### Sep 8

Feature · Model: gpt-image-2.5-sunburst · Model: gpt-image-2.5-flare · API: v1/images · API: v1/responses

Released [GPT Image 2.5 Sunburst](https://developers.openai.com/api/docs/models/gpt-image-2.5-sunburst) and [GPT Image 2.5 Flare](https://developers.openai.com/api/docs/models/gpt-image-2.5-flare) for image generation and editing through the Image API and the Responses API image generation tool.

Use Sunburst for workflows where editing precision matters most, or Flare for fast, high-quality everyday image generation. Both models support the new `xhigh` and `max` quality settings and use GPT Image 2 token rates. See the [image generation guide](https://developers.openai.com/api/docs/guides/image-generation) and [pricing](https://developers.openai.com/api/docs/pricing#image-generation).

### Sep 8

Feature · Model: gpt-rosalind-research

GPT-Rosalind (`gpt-rosalind-research`) is now generally available through the [trusted-access program](https://help.openai.com/en/articles/20001193-gpt-rosalind-for-life-sciences-research) for approved internal life sciences research.