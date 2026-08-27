/**
 * Service modes and capability availability (Issue #50 / #51).
 *
 * WDIMTM ships ONE client. Free vs paid differs by *service mode*, never by
 * client edition. A capability is available when the current service mode can
 * actually provide it — and when it cannot, the UI must explain *why the cloud
 * is required*, not render "Upgrade to Pro".
 *
 * See docs/business-model.md and docs/cloud-api-contract.md.
 */

/** @typedef {'local' | 'byok' | 'cloud'} ServiceMode */
/** @typedef {'full' | 'partial' | 'unavailable'} AvailabilityLevel */

export const SERVICE_MODES = /** @type {const} */ (["local", "byok", "cloud"]);

/**
 * The four reasons a backend is allowed to exist. If none applies, do not
 * introduce one (docs/business-model.md#four-triggers-for-a-backend).
 */
export const CLOUD_TRIGGERS = /** @type {const} */ ([
  {
    id: "persistence",
    label: "Persistence",
    labelZh: "持久化",
    why: "The task must keep running after the browser is closed, so it needs a server that outlives the tab.",
    whyZh: "任务需要在浏览器关闭后继续执行，只有服务端能活得比标签页更久。",
  },
  {
    id: "orchestration",
    label: "Orchestration",
    labelZh: "编排",
    why: "The task is multi-step and long-running, with tool calls, retries, timeouts and a budget to enforce.",
    whyZh: "任务是多步骤、长时间的，需要工具调用、重试、超时和预算控制。",
  },
  {
    id: "synchronization",
    label: "Synchronization",
    labelZh: "同步",
    why: "The same personal context has to be readable and writable from more than one device.",
    whyZh: "同一份个人上下文需要在多台设备上读写。",
  },
  {
    id: "trust",
    label: "Trust / commerce",
    labelZh: "信任与商业",
    why: "Provider secrets, accounts, quota and billing cannot be held safely inside the browser.",
    whyZh: "服务商密钥、账号、额度与计费无法安全地放在浏览器里。",
  },
]);

/**
 * @typedef {Object} Capability
 * @property {string} id
 * @property {string} label
 * @property {string} labelZh
 * @property {'cloud' | null} requires        Hard requirement, if any.
 * @property {string} [trigger]               Which CLOUD_TRIGGERS id justifies the cloud.
 * @property {Partial<Record<ServiceMode, AvailabilityLevel>>} modes
 * @property {string} [note]                  Why a mode is only partial.
 * @property {string} [noteZh]
 * @property {'shipped' | 'planned'} [status]  Defaults to shipped. `planned` means the
 *   service mode *could* provide it but WDIMTM has not built it — the matrix describes the
 *   business model and also ships in the client, so the two must not be conflated.
 * @property {string} [plannedNote]
 * @property {string} [plannedNoteZh]
 */

/** @type {Capability[]} */
export const CAPABILITIES = [
  {
    id: "explain",
    label: "Explain / Why it matters",
    labelZh: "解释 / 与我有何关系",
    requires: null,
    modes: { local: "full", byok: "full", cloud: "full" },
  },
  {
    id: "local_memory",
    label: "Local memory",
    labelZh: "本地记忆",
    requires: null,
    modes: { local: "full", byok: "full", cloud: "full" },
  },
  {
    id: "chat_import",
    label: "Chat history import",
    labelZh: "对话历史导入",
    requires: null,
    status: "planned",
    plannedNote: "Not built yet — memory cold start is issue #49.",
    plannedNoteZh: "尚未实现 — 记忆冷启动见 issue #49。",
    modes: { local: "full", byok: "full", cloud: "full" },
  },
  {
    id: "custom_lens",
    label: "Custom lens",
    labelZh: "自定义视角",
    requires: null,
    modes: { local: "full", byok: "full", cloud: "full" },
  },
  {
    id: "own_model",
    label: "Your own model",
    labelZh: "使用自己的模型",
    requires: null,
    modes: { local: "full", byok: "full", cloud: "partial" },
    note: "Cloud can route to a managed model; pointing it at your own endpoint stays a BYOK feature.",
    noteZh: "云端会路由到托管模型；指向你自己的端点仍属于 BYOK 能力。",
  },
  {
    id: "no_api_key",
    label: "No API key required",
    labelZh: "无需 API Key",
    requires: "cloud",
    trigger: "trust",
    modes: { local: "unavailable", byok: "unavailable", cloud: "full" },
  },
  {
    id: "memory_sync",
    label: "Cloud memory sync",
    labelZh: "云端记忆同步",
    requires: "cloud",
    trigger: "synchronization",
    modes: { local: "unavailable", byok: "unavailable", cloud: "full" },
  },
  {
    id: "cross_device_context",
    label: "Cross-device context",
    labelZh: "跨设备上下文",
    requires: "cloud",
    trigger: "synchronization",
    modes: { local: "unavailable", byok: "unavailable", cloud: "full" },
  },
  {
    id: "managed_routing",
    label: "Managed model routing",
    labelZh: "托管模型路由",
    requires: "cloud",
    trigger: "trust",
    modes: { local: "unavailable", byok: "unavailable", cloud: "full" },
  },
  {
    id: "deep_research",
    label: "Deep research",
    labelZh: "深度研究",
    requires: "cloud",
    trigger: "orchestration",
    modes: { local: "unavailable", byok: "partial", cloud: "full" },
    note: "BYOK can run one search-and-synthesize pass; a durable multi-step job needs the cloud.",
    noteZh: "BYOK 可以做一次搜索加综合；持久的多步骤任务需要云端。",
  },
  {
    id: "watch",
    label: "Watch / monitor",
    labelZh: "持续监控",
    requires: "cloud",
    trigger: "persistence",
    status: "planned",
    plannedNote: "Not built yet — scheduled watch is issue #53.",
    plannedNoteZh: "尚未实现 — 定时监控见 issue #53。",
    modes: { local: "unavailable", byok: "unavailable", cloud: "full" },
  },
  {
    id: "durable_agent",
    label: "Durable background agent",
    labelZh: "持久后台 Agent",
    requires: "cloud",
    trigger: "persistence",
    status: "planned",
    plannedNote:
      "Research jobs (#52) are the first durable job; scheduled, self-directed agents are not built.",
    plannedNoteZh: "研究任务（#52）是第一个持久任务；定时、自主的 Agent 尚未实现。",
    modes: { local: "unavailable", byok: "unavailable", cloud: "full" },
  },
];

const SERVICE_MODE_LABELS = {
  local: { en: "Local", zh_CN: "本地" },
  byok: { en: "Bring your own key", zh_CN: "自带密钥（BYOK）" },
  cloud: { en: "WDIMTM Cloud", zh_CN: "WDIMTM Cloud" },
};

/**
 * Which service mode the current settings put the user in.
 *
 * PromptaaS is a *user-configured external endpoint* — it is someone else's
 * hosted app, not WDIMTM Cloud — so it resolves to `byok`.
 *
 * @param {{ runtime?: string } | null | undefined} settings
 * @returns {ServiceMode}
 */
export function resolveServiceMode(settings) {
  const runtime = settings?.runtime || "mock";
  if (runtime === "wdimtm-cloud") return "cloud";
  // Legacy client runtime that pointed at Agentaab directly — product path is Cloud.
  if (runtime === "promptaas") return "cloud";
  if (runtime === "openai-compatible" || runtime === "anthropic") return "byok";
  return "local";
}

/**
 * @param {ServiceMode | string} mode
 * @param {'en' | 'zh_CN' | string} [locale]
 */
export function serviceModeLabel(mode, locale = "en") {
  const entry = SERVICE_MODE_LABELS[mode] || SERVICE_MODE_LABELS.local;
  return locale === "zh_CN" ? entry.zh_CN : entry.en;
}

/**
 * Cloud endpoint reachability is about configuration, not about the currently
 * selected runtime — a BYOK user may still have a cloud account for sync.
 * @param {{ cloudBaseUrl?: string } | null | undefined} settings
 */
export function isCloudConfigured(settings) {
  // Production base URL is the default — empty settings still mean "Cloud is
  // reachable" for the product path. Self-hosters override cloudBaseUrl.
  return Boolean(String(settings?.cloudBaseUrl || "https://cloud.wdimtm.com").trim());
}

/**
 * @param {string} capabilityId
 * @returns {Capability | null}
 */
export function findCapability(capabilityId) {
  return CAPABILITIES.find((c) => c.id === capabilityId) || null;
}

/**
 * The trigger that justifies moving a capability to the cloud, if any.
 * @param {string} capabilityId
 * @returns {(typeof CLOUD_TRIGGERS)[number] | null}
 */
export function cloudTriggerFor(capabilityId) {
  const cap = findCapability(capabilityId);
  if (!cap?.trigger) return null;
  return CLOUD_TRIGGERS.find((t) => t.id === cap.trigger) || null;
}

/**
 * @typedef {Object} CapabilityState
 * @property {string} id
 * @property {AvailabilityLevel} level
 * @property {'cloud' | null} requires
 * @property {string | null} trigger
 * @property {string} why            Plain-language reason (never "Upgrade to Pro").
 * @property {string} label
 */

/**
 * @param {string} capabilityId
 * @param {ServiceMode | string} serviceMode
 * @param {'en' | 'zh_CN' | string} [locale]
 * @returns {CapabilityState}
 */
export function capabilityAvailability(capabilityId, serviceMode, locale = "en") {
  const zh = locale === "zh_CN";
  const cap = findCapability(capabilityId);
  if (!cap) {
    return {
      id: capabilityId,
      level: "unavailable",
      requires: null,
      trigger: null,
      why: zh ? "未知能力。" : "Unknown capability.",
      label: capabilityId,
    };
  }

  const mode = /** @type {ServiceMode} */ (
    SERVICE_MODES.includes(/** @type {any} */ (serviceMode)) ? serviceMode : "local"
  );
  const level = cap.modes[mode] || "unavailable";
  const trigger = cloudTriggerFor(cap.id);

  const status = cap.status === "planned" ? "planned" : "shipped";

  let why;
  if (status === "planned") {
    // Being possible in this mode is not the same as being usable today.
    why =
      (zh ? cap.plannedNoteZh : cap.plannedNote) ||
      (zh ? "尚未实现。" : "Not built yet.");
  } else if (level === "full") {
    why = zh ? "当前服务模式已支持。" : "Available in the current service mode.";
  } else if (level === "partial") {
    why = (zh ? cap.noteZh : cap.note) || (zh ? "支持有限。" : "Limited support.");
  } else if (trigger) {
    why = zh ? trigger.whyZh : trigger.why;
  } else {
    why = zh ? "当前服务模式无法提供。" : "The current service mode cannot provide this.";
  }

  return {
    id: cap.id,
    level,
    status,
    /** The only field a UI should gate on: built *and* provided by this mode. */
    available: status === "shipped" && level !== "unavailable",
    requires: cap.requires,
    trigger: trigger?.id || null,
    why,
    label: zh ? cap.labelZh : cap.label,
  };
}

/**
 * Full capability × service-mode table (docs and options UI).
 * @param {'en' | 'zh_CN' | string} [locale]
 */
export function capabilityMatrix(locale = "en") {
  return CAPABILITIES.map((cap) => ({
    id: cap.id,
    label: locale === "zh_CN" ? cap.labelZh : cap.label,
    requires: cap.requires,
    trigger: cap.trigger || null,
    status: cap.status === "planned" ? "planned" : "shipped",
    modes: Object.fromEntries(
      SERVICE_MODES.map((m) => [m, capabilityAvailability(cap.id, m, locale).level])
    ),
  }));
}
