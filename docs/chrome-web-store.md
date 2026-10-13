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

> Stores the user's own settings on their device: which service mode and AI endpoint
> to use, their chosen lens, UI and answer language, answer depth, the per-site
> denylist, custom lenses they wrote, any memories they explicitly chose to save, and
> the WDIMTM Cloud session token after they sign in. API keys and the session token
> are written to local (unsynced) storage so Chrome Sync never uploads them to the
> user's Google account.

**`identity`**

> WDIMTM Cloud, the default service mode, needs an account so the user's credit balance
> and optional sync can be attached to it. `identity` runs the Google sign-in
> (launchWebAuthFlow) when the user clicks Sign in; the token is exchanged once with
> cloud.wdimtm.com for a WDIMTM session. Scopes are openid, email and profile; only the
> email address and Google account id are kept. It is never used in bring-your-own-key
> mode.

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
> The other hosts answer the request. api.openai.com and api.anthropic.com are the two providers a user can point their own key at; exactly one is called per request. api.tavily.com, api.search.brave.com and google.serper.dev are optional search providers, off by default, reached only if the user enables search and gives a key for one. cloud.wdimtm.com (our hosted mode) is requested at Cloud sign-in; localhost and 127.0.0.1 only when the user sets up a local model.

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
- `https://cloud.wdimtm.com/*` — the only host we operate, and the default service mode.
  Optional in the manifest: requested when the user signs in to WDIMTM Cloud.
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
| **Website content** | ✅ | The selected text, the bounded surrounding context, and the page title are sent to WDIMTM Cloud or the user's own AI endpoint. |
| **Web history** | ✅ | The URL of the page is included with the explain request. It is one URL at the moment the user asks — not browsing history — but the URL does leave the device, so disclose it. |
| **Authentication information** | ✅ | WDIMTM Cloud: Google sign-in, and the WDIMTM session token it issues (stored hashed on the server). BYOK: the user's own API key, stored locally and sent as the auth header to the endpoint they configured. |
| **Personally identifiable information** | ✅ | WDIMTM Cloud keeps the user's email address and Google account id. The optional profile and memories are free text the user writes about themselves, sent with requests and, if sync is on, stored in WDIMTM Cloud. |
| **Financial and payment information** | ✅ | WDIMTM Cloud keeps a purchase history (credits bought or refunded, and when). Payment itself happens on an Agentaab/Stripe checkout page; card details never reach the extension or WDIMTM Cloud. |
| Health information | ❌ | Never handled. |
| **Personal communications** | ✅ | Conversation import (#49) reads a ChatGPT or Claude export — the user's own chat history — and sends batches of it to their configured AI endpoint for distillation. It is explicitly user-initiated, shown as an itemized disclosure before a byte is sent, never written to disk, and never sent to a WDIMTM server. But it is unambiguously personal communications, so it is disclosed. |
| Location | ❌ | Never requested or derived. IP addresses are used transiently for rate limiting and not stored. |
| User activity | ❌ | No click, scroll, keystroke, or network monitoring. |

If a field asks where the data goes, the answer depends on which service mode the user
picked, and both must be described:

- **WDIMTM Cloud (default):** the request goes to cloud.wdimtm.com, which signs the user
  in with Google, meters credits, and forwards the request to a model provider through
  Agentaab. Explain and chat content is not stored; research jobs and, if sync is on,
  memories are. Purchases go through Agentaab and Stripe. The user can download or
  delete everything WDIMTM Cloud stores from Settings → Account.
- **BYOK:** to the third-party AI endpoint the user configures and pays for. Nothing
  reaches a WDIMTM server.

### Certifications

All three can be certified truthfully:

- **Not selling or transferring user data to third parties outside approved use cases** —
  the only transfers are to the model provider that performs the explanation (directly
  in BYOK, through WDIMTM Cloud and Agentaab otherwise) and to the payment processor
  when the user buys credits, i.e. the approved "necessary to provide the single
  purpose" case.
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
get. Everything cut from it is discoverable in the UI or already stated on the Privacy
tab.

Cloud sign-in only works for a reviewer once the OAuth consent screen is **published**
(Google Auth Platform → Audience). While it is in Testing, only listed test users can
sign in: either publish it before submitting, or add a reviewer account as a test user
and put its address in these instructions.

> New installs start on WDIMTM Cloud. Options opens on install (or right-click the toolbar icon > Options).
>
> AI access > WDIMTM Cloud > Sign in with Google. Every account gets 50 free credits a month; no purchase is needed to test.
>
> Select a sentence on any article, click the WDIMTM button beside it. The card has lenses and follow-ups; Discuss further opens page chat.
>
> Settings > Account has Download my Cloud data and Delete Cloud account.

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

> **Say up front what it costs.** Cloud works after a Google sign-in with a free monthly
> allowance; say so, and say that an own key is the other way in.

```text
WDIMTM explains what you are looking at — and why it matters to you.

Select something on a page, click the button that appears, and get a short
explanation in place. No copying, no switching to a chatbot, no writing a prompt.

WORKS AFTER ONE SIGN-IN
WDIMTM Cloud is the default: sign in with Google and you get 50 free credits
every month, enough for everyday explains. Buy credit packs when you need more;
there is no subscription. Prefer your own provider? Paste a key from OpenAI,
Anthropic, or any OpenAI-compatible service and pay that provider directly.

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
Nothing is remembered unless you press Remember, memories live on your own
device (and in WDIMTM Cloud only if you turn on sync), and you can read, edit,
or delete any of it. You can also import an
existing ChatGPT or Claude export to start from what you have already told them
— reviewed item by item before anything is saved.

WHAT IT DOES NOT DO
It does not read pages you have not asked about. It does not run in the
background, watch your browsing, or collect analytics. When you do ask, it sends
the selected text, a bounded amount of surrounding text, the page title and the
URL — never the whole page — to WDIMTM Cloud, or with your own key straight to
your provider. You can download or delete your Cloud account and its data from
Settings at any time.

Open source: https://github.com/wdimtm/wdimtm-extension
Privacy policy: https://wdimtm.com/privacy
```

### Detailed description (zh_CN)

```text
WDIMTM 帮你理解眼前这段内容 —— 以及它跟你有什么关系。

在网页上选中一段文字，点出现的按钮，就地拿到一段简短解释。不用复制，不用切到
聊天窗口，不用自己写提示词。

登录即可使用
默认使用 WDIMTM Cloud：用 Google 登录，每月赠送 50 点额度，足够日常解释使用。
需要更多时可以购买点数包，没有订阅。更想用自己的服务商？填入 OpenAI、Anthropic
或任意 OpenAI 兼容服务的 Key，费用直接付给该服务商。

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
记忆保存在你自己的设备上（只有开启同步时才会存到 WDIMTM Cloud），随时可读、可改、可删。你也可以导入已有的 ChatGPT 或
Claude 导出记录，从你已经说过的话开始 —— 保存前会逐条让你审阅。

它不做什么
它不会读你没有问过的页面，不在后台运行，不监视你的浏览行为，也不收集任何分析数据。
你提问时，它只把选中的文字、一小段周围上下文、页面标题和网址发给 WDIMTM Cloud，
或用你自己的 Key 直接发给你的服务商 —— 从不发送整个页面。你可以随时在设置里下载
或删除你的云端账户及其数据。

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

## Uploading a package

`npm run package` only builds the zip. The Chrome Web Store API sends it, and reads
these environment variables. They are not files in the repo. The refresh token is
the credential that can publish.

| Variable | What |
|---|---|
| `CWS_CLIENT_ID` | OAuth client id |
| `CWS_CLIENT_SECRET` | OAuth client secret |
| `CWS_REFRESH_TOKEN` | Refresh token for `https://www.googleapis.com/auth/chromewebstore` |
| `CWS_PUBLISHER_ID` | Developer Dashboard → Publisher → Settings |
| `CWS_EXTENSION_ID` | The item id, created once in the dashboard |

`npm run store:upload` rebuilds the zip from the public tree and uploads it as a
draft. `npm run store:publish` submits that draft for review and does not upload
again — a second upload of the same manifest version is rejected.
`npm run store:upload -- --submit` uploads and submits in one step.

The first item, the listing text, and the privacy tab are still filled in on the
dashboard. The script updates an item that already exists.

## Before submitting — checklist

`npm run package` enforces the mechanical half of this list and refuses to build a zip
when it fails. `npm run store:upload` runs that check before it uploads. What is
left is what only a human can do.

- [ ] Developer account registered, one-time fee paid
- [x] Privacy policy live at https://wdimtm.com/privacy
- [ ] OAuth consent screen published, or a reviewer test user added and named in the
      test instructions
- [x] Permission justifications match the current manifest — checked by
      `npm run check:store`, and again by `npm run package`
- [x] Screenshots cover conversation import (`screenshot-4-memory.png`)
- [ ] `npm run store:assets` re-run if the UI changed since the last submission
- [ ] Version in `extension/manifest.json` bumped, and matching `package.json`
- [ ] `npm run store:upload` — rebuilds the public-tree zip and uploads that draft.
      Never upload a zip made by hand from `extension/`
- [x] Store item id matches the OAuth redirect: the store item is
      `jgjbkfelaamlhknmccbbimihhhcimocn`, the manifest `key` is its public key, and the
      Web client allows `https://jgjbkfelaamlhknmccbbimihhhcimocn.chromiumapp.org/google`
      (`tests/unit/manifest-key.test.mjs` fails if the key stops matching)
- [x] Privacy policy describes import and WDIMTM Cloud, and does not claim there is no
      server
