/**
 * One-click connectivity tests ("Test connection").
 *
 * Each ping lives with the runtime that speaks the protocol; this module is the
 * product-facing surface over them. It answers two things the runtime modules
 * should not have to know: which *access mode* the UI meant, and how a form
 * payload overlays the saved settings.
 */

import { SECRET_KEYS } from "./settings-defaults.js";
import { getRuntime } from "./runtime/registry.js";

/**
 * The UI speaks in access modes ("byok", "cloud"); the registry speaks in
 * runtime ids. Legacy runtime ids are accepted too, because the TEST_RUNTIME
 * message has always taken either.
 *
 * Note this is deliberately *not* `accessModeToRuntime`: that maps the retired
 * `promptaas` access mode onto WDIMTM Cloud, whereas testing "promptaas" has
 * always pinged the agent endpoint itself.
 *
 * @param {string} mode
 * @returns {string}
 */
export function runtimeIdForTestMode(mode) {
  switch (String(mode || "")) {
    case "mock":
      return "mock";
    case "anthropic":
      return "anthropic";
    case "promptaas":
      return "promptaas";
    case "cloud":
    case "wdimtm-cloud":
      return "wdimtm-cloud";
    default:
      // byok | openai-compatible | anything unrecognized
      return "openai-compatible";
  }
}

/**
 * Test whichever runtime the caller named, against the saved settings with the
 * form's unsaved edits laid over them.
 *
 * The overlay reproduces what the four call sites did by hand: a blank text
 * field falls back to the saved value, while a blank secret is taken at face
 * value — clearing a key and testing it has to report the missing key rather
 * than quietly testing the stored one.
 *
 * @param {string} mode access mode or runtime id
 * @param {Record<string, any>} [settings] saved settings
 * @param {Record<string, any>} [overrides] unsaved form values, if any
 * @returns {Promise<{ ok: boolean, message: string, code?: string, runtime: string }>}
 */
export async function testRuntimeConnection(mode, settings = {}, overrides = {}) {
  const runtimeId = runtimeIdForTestMode(mode);
  const entry = getRuntime(runtimeId);
  if (!entry) {
    return {
      ok: false,
      code: "unknown",
      message: `Unknown runtime: ${runtimeId}`,
      runtime: runtimeId,
    };
  }
  const result = await entry.ping(entry.configFromSettings(overlay(settings, overrides)));
  return { ...result, runtime: runtimeId };
}

/**
 * @param {Record<string, any>} settings
 * @param {Record<string, any>} overrides
 */
function overlay(settings, overrides) {
  const out = { ...settings };
  for (const [key, value] of Object.entries(overrides)) {
    if (key === "mode" || value === undefined || value === null) continue;
    if (value !== "" || SECRET_KEYS.includes(key)) out[key] = value;
  }
  return out;
}
