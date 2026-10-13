/**
 * What the Settings page says and does after `POST /v1/redeem` (#135).
 *
 * Kept free of the DOM so it can be tested; options.js renders the result.
 */

import { redeemErrorKey } from "./options-i18n.js";

/**
 * @param {{
 *   ok: boolean,
 *   error?: string,
 *   retryAfterSeconds?: number,
 *   entitlement?: { endsAt?: string },
 *   cloudAccess?: { until?: string | null },
 * }} result what redeemCloudCode returned
 * @param {{ t: (key: string) => string, formatInstant: (iso: string) => string }} ui
 * @returns {{ message: string, isError: boolean, clearInput: boolean, refreshAccount: boolean }}
 */
export function redeemResultView(result, { t, formatInstant }) {
  if (result.ok) {
    const until = result.entitlement?.endsAt || result.cloudAccess?.until || "";
    return {
      message: t("cloudRedeemSuccess").replace("{date}", formatInstant(until)),
      isError: false,
      clearInput: true,
      refreshAccount: true,
    };
  }
  const minutes = Math.max(1, Math.ceil(Number(result.retryAfterSeconds || 900) / 60));
  return {
    message: t(redeemErrorKey(result.error)).replace("{minutes}", String(minutes)),
    isError: true,
    clearInput: false,
    // A retry after a lost response answers already_redeemed, and an
    // unconfirmed attempt may have gone through: show the account as it is.
    refreshAccount: result.error === "already_redeemed" || result.error === "redeem_unconfirmed",
  };
}
