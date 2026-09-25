# Chrome Web Store listing — copy for the dashboard

Everything the Developer Dashboard asks for, written against the code as it ships.
Paste these into the corresponding fields.

**Keep this file in sync with the manifest.** A justification for a permission that
was removed, or a missing one for a permission that was added, is exactly what gets
a submission bounced.

---

## Privacy tab

### Single purpose

> WDIMTM explains text the user selects on a web page. The user highlights something
> they do not understand, clicks the button that appears, and receives a short
> explanation of that selection in place, without leaving the page.
>
> Everything in the extension serves that one purpose: the "lenses" change how the
> selection is explained (plain language, engineering, investing, and so on), the
> optional page chat continues the conversation about the same selection when one
> answer is not enough, and the optional memory lets the explanation account for
> context the user has told it about themselves. The extension does not browse,
> monitor, or collect anything on its own — it acts only on a selection the user
> makes and a button the user clicks.

### Permission justifications

Fill in one field per permission. The dashboard lists them from the manifest.

**`storage`**

> Stores the user's own settings on their device: which AI endpoint to call, their
> chosen lens, UI and answer language, answer depth, the per-site denylist, custom
> lenses they wrote, and any memories they explicitly chose to save. The extension
> has no server, so there is nowhere else for these to live. API keys are written to
> local (unsynced) storage specifically so they are not uploaded to the user's Google
> account by Chrome Sync.

**`identity`**

> WDIMTM Cloud is an optional, opt-in service mode. When the user chooses it, `identity`
> is used solely to run the Google sign-in that issues their Cloud session token, so their
> credit balance can be attached to an account. It is never used in the default local or
> bring-your-own-key modes, and no profile data beyond the sign-in result is read.

**`activeTab`**

> Powers the "Active on this site" switch in the toolbar popup, which turns WDIMTM
> off for the site the user is currently on. The switch needs the current tab's
> hostname to know which site it is writing to the denylist. `activeTab` grants that
> only for the tab the user just clicked the toolbar icon on, and only for that
> interaction — the extension gets no standing access to tabs or browsing history.
> Reading it is the whole use: no page content is read through this permission.

**Host permissions — one field for all of them**

The dashboard does not ask per host. It has a single host-permission box, capped at
**1000 characters**, and everything below has to live in it together — which is why
this is one justification and not six.

> WDIMTM explains text the user selects on whatever page they are reading, so the content script matches http://*/* and https://*/*: it cannot know in advance which sites those will be, and a fixed list would defeat the feature. It is dormant until the user selects text and clicks the button that appears. Nothing is read or sent before that click, and a denylist switches it off per site. all_frames is needed because article text is often inside an iframe; match_about_blank covers frames created without a URL.
>
> The other hosts answer the request. api.openai.com and api.anthropic.com are the two providers a user can point their own key at; exactly one is called per request. api.tavily.com, api.search.brave.com and google.serper.dev are optional search providers, off by default, reached only if the user enables search and gives a key for one. localhost, 127.0.0.1 and cloud.wdimtm.com are optional, requested only when the user configures a local model or opts into the hosted mode.

<details>
<summary>Per-host detail, kept for the next manifest change (not pasted anywhere)</summary>

- `https://api.openai.com/*` — default BYOK endpoint; carries the selection and bounded
  page context to generate the answer.
- `https://api.anthropic.com/*` — the second BYOK provider, for users with a Claude key.
  Exactly one provider is contacted per request.
- `https://api.tavily.com/*`, `https://api.search.brave.com/*`, `https://google.serper.dev/*`
  — optional search, off by default, only the one the user configured is ever called.
- `http://localhost/*`, `http://127.0.0.1/*` — optional, requested only when the user
  saves a loopback base URL. Match patterns carry no port, so these cover any port.
- `https://cloud.wdimtm.com/*` — optional, the only host we operate; requested only if
  the user switches to WDIMTM Cloud.
- `http://*/*`, `https://*/*` — content script. Dormant until a selection and a click.
  `all_frames` for article text inside iframes, `match_about_blank` for frames with no URL.

</details>

### Remote code

Select **"No, I am not using remote code."**

> All JavaScript is bundled in the package. The extension loads no scripts from any
> server, uses no CDN-hosted libraries, and never calls `eval()` or `new Function()`.
> Its network requests are data requests to an API endpoint; the responses are treated
> as text and rendered, never executed. Extension pages also load no remote fonts or
> stylesheets.

### Data usage disclosure

Tick these categories:

| Category | Tick | Why |
|---|---|---|
| **Website content** | ✅ | The selected text, the bounded surrounding context, and the page title are sent to the user's AI endpoint. |
| **Web history** | ✅ | The URL of the page is included with the explain request. It is one URL at the moment the user asks — not browsing history — but the URL does leave the device, so disclose it. |
| **Authentication information** | ✅ | The user's own API key is stored locally and sent as the auth header to the endpoint they configured. |
| **Personally identifiable information** | ✅ | The optional profile and memories are free text the user writes about themselves, and are sent with the request. They can contain personal information by design. |
| Financial and payment information | ❌ | Never handled. |
| Health information | ❌ | Never handled. |
| **Personal communications** | ✅ | Conversation import (#49) reads a ChatGPT or Claude export — the user's own chat history — and sends batches of it to their configured AI endpoint for distillation. It is explicitly user-initiated, shown as an itemized disclosure before a byte is sent, never written to disk, and never sent to a WDIMTM server. But it is unambiguously personal communications, so it is disclosed. |
| Location | ❌ | Never requested or derived. |
| User activity | ❌ | No click, scroll, keystroke, or network monitoring. |

If a field asks where the data goes, the answer depends on which service mode the user
picked, and both must be described:

- **BYOK (default):** to the third-party AI endpoint the user configures and pays for.
  Nothing reaches a WDIMTM server.
- **WDIMTM Cloud (opt-in, in development):** the request goes to the WDIMTM Cloud backend,
  which signs the user in with Google, meters credits, and forwards the request to a model
  provider. This path exists in the shipped extension and needs the `identity` permission,
  so the listing must describe it even while it is under development.

### Certifications

All three can be certified truthfully:

- **Not selling or transferring user data to third parties outside approved use cases** —
  the only transfer is to the AI endpoint the user chose, which is what performs the
  explanation, i.e. the approved "necessary to provide the single purpose" case.
- **Not using or transferring user data for purposes unrelated to the single purpose** —
  there is no other use; no analytics, no telemetry, no advertising, no model training.
- **Not using or transferring user data to determine creditworthiness or for lending** —
  never.

### Privacy policy URL

```
https://wdimtm.com/privacy
```

---

## Test instructions

The dashboard caps this field at **500 characters** — half what the permission boxes
get. Mind the key: `<PASTE TEST KEY HERE>` is 21 characters and a real `sk-proj-…`
is about 56, so the text grows by ~35 when it is filled in. Budget for that. Everything
cut from it is discoverable in the UI or already stated on the Privacy tab; what a
reviewer cannot discover is that the default runtime is a mock, so that goes first.

> The default runtime is a mock: without a key every answer is placeholder text, labelled "Sample answer".
>
> Options (right-click the toolbar icon) > AI access > "Use my own API key":
> Base URL: https://api.openai.com/v1
> Key: <PASTE TEST KEY HERE>
> Model: gpt-4o-mini
> Test connection, then Save.
>
> Select a sentence on any article, click the WDIMTM button beside it. The card has lenses and follow-ups.
>
> "WDIMTM Cloud" in Options is not open yet; ignore it.

### The key you paste in

Do not reuse a personal key. Create one that is safe to hand to a stranger:

- A dedicated OpenAI project key, not your main account key.
- A hard spend cap on that project (a few dollars is plenty).
- Scoped to `gpt-4o-mini` if your provider supports per-model restriction.
- Revoke it once the extension is published, and update these instructions before the
  next submission — a dead key in the test instructions stalls the next review.

---

## Store listing tab — copy

Name and summary come from `_locales/`; the dashboard fills them from the package.
The detailed description does not exist in the code and has to be written here.

| Field | Value |
|---|---|
| Category | **Productivity** |
| Language | English (add 中文 (简体) as a second listing locale) |
| Name (en) | `WDIMTM — What Does It Mean To Me?` |
| Name (zh_CN) | `WDIMTM — 于我何意` |
| Summary (en) | `Select text on any page and get a concise, context-aware explanation without leaving the flow.` |
| Summary (zh_CN) | `在网页上选中文字，无需离开当前页面即可获得简洁、贴合语境的解释。` |

### Detailed description (en)

> **Lead with the key requirement.** An extension that shows placeholder text until the
> user supplies a key earns one-star reviews if the listing does not say so first.

```text
WDIMTM explains what you are looking at — and why it matters to you.

Select something on a page, click the button that appears, and get a short
explanation in place. No copying, no switching to a chatbot, no writing a prompt.

REQUIRES YOUR OWN AI API KEY
This extension has no subscription and no bundled AI. You supply a key from
OpenAI, Anthropic, or any OpenAI-compatible provider, and you pay that provider
directly. Without a key the extension shows clearly-labelled sample answers.
Setup takes about a minute in the options page.

LENSES — the same text, read the way you need it
Explain, Sanity check, Fact check, Opportunities, Engineering, Investing. Switch
lens from the button and ask again, or pin one per site so x.com always gets the
sanity check. Write your own lens in plain language if none of them fit.

FOLLOW-UPS, THEN A REAL CONVERSATION
Every answer offers follow-ups drawn from what it just said, not a fixed row of
buttons: explain more, why it matters, verify, explain simpler. When a short
answer is not enough, Discuss further opens a page chat that keeps the same
selection and page context. You can paste a screenshot straight into it.

MEMORY YOU CONTROL
Tell it what you work on and it stops explaining things you already know.
Nothing is remembered unless you press Remember, everything is stored on your
own device, and you can read, edit, or delete any of it. You can also import an
existing ChatGPT or Claude export to start from what you have already told them
— reviewed item by item before anything is saved.

WHAT IT DOES NOT DO
It does not read pages you have not asked about. It does not run in the
background, watch your browsing, or collect analytics. When you do ask, it sends
the selected text, a bounded amount of surrounding text, the page title and the
URL — never the whole page — directly to the endpoint you configured. There is
no WDIMTM server in the way.

Open source: https://github.com/wdimtm/wdimtm-extension
Privacy policy: https://wdimtm.com/privacy
```

### Detailed description (zh_CN)

```text
WDIMTM 帮你理解眼前这段内容 —— 以及它跟你有什么关系。

在网页上选中一段文字，点出现的按钮，就地拿到一段简短解释。不用复制，不用切到
聊天窗口，不用自己写提示词。

需要你自己的 AI API Key
本扩展没有订阅，也不自带 AI。你填入 OpenAI、Anthropic 或任意 OpenAI 兼容服务的
Key，费用直接付给该服务商。没有 Key 时，扩展只会显示明确标注的示例答案。在设置页
配置大约需要一分钟。

透镜 —— 同一段文字，按你需要的角度读
通俗解释、有没有道理、核实主张、找机会、工程视角、投资视角。可以在按钮上随时切换
重问，也可以给特定网站固定一个透镜，比如 x.com 一律用「有没有道理」。都不合适的
话，用一句话写一个自己的透镜。

追问，然后是真正的对话
每个答案给出的追问都来自它刚说过的内容，而不是一排固定按钮：展开说明、为什么重要、
核实主张、讲简单点。一句话不够时，「深入对话」会展开成页面内对话，并保留同一段选区
和页面上下文。截图可以直接粘贴进去。

由你掌握的记忆
告诉它你在做什么，它就不会再解释你早就懂的东西。不按「记住」就什么都不会被记下，
所有内容存在你自己的设备上，随时可读、可改、可删。你也可以导入已有的 ChatGPT 或
Claude 导出记录，从你已经说过的话开始 —— 保存前会逐条让你审阅。

它不做什么
它不会读你没有问过的页面，不在后台运行，不监视你的浏览行为，也不收集任何分析数据。
你提问时，它只把选中的文字、一小段周围上下文、页面标题和网址发给你配置的服务端点
—— 从不发送整个页面。默认模式下没有 WDIMTM 服务器介入。

开源地址：https://github.com/wdimtm/wdimtm-extension
隐私政策：https://wdimtm.com/privacy
```

---

## Store listing tab — assets

Generated by `npm run store:assets` into `store-assets/`. See that directory's README.

| Field | File |
|---|---|
| Store icon (128×128) | `extension/icons/icon128.png` |
| Screenshots (1280×800) | `store-assets/screenshot-1-explain.png`, `-2-lenses.png`, `-3-chat.png`, `-4-memory.png` |
| Small promo tile (440×280) | `store-assets/promo-small-440x280.png` |
| Marquee promo tile (1400×560) | `store-assets/promo-marquee-1400x560.png` |

---

## Before submitting — checklist

`npm run package` enforces the mechanical half of this list and refuses to build a zip
when it fails. What is left is what only a human can do.

- [ ] Developer account registered, one-time fee paid
- [x] Privacy policy live at https://wdimtm.com/privacy
- [ ] Test key created, capped, and pasted into the test instructions
- [x] Permission justifications match the current manifest — checked by
      `npm run check:store`, and again by `npm run package`
- [x] Screenshots cover conversation import (`screenshot-4-memory.png`)
- [ ] `npm run store:assets` re-run if the UI changed since the last submission
- [ ] Version in `extension/manifest.json` bumped, and matching `package.json`
- [ ] `npm run package` re-run — it rebuilds `dist/` and zips it; never upload a zip
      made by hand from `extension/`
- [ ] Decide what to do about `oauth2.client_id`: a Google OAuth client for a Chrome
      extension needs the extension id, which only exists once an item has been created
      in the dashboard. Either upload a draft first and fill the id in before publishing,
      or ship this submission BYOK-only and accept that Cloud sign-in fails until the
      next version. `npm run package` warns while the placeholder is still there.
- [ ] Privacy policy re-read end to end: it must describe import and WDIMTM Cloud, and
      must not claim there is no server
