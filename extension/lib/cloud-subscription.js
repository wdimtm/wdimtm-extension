/**
 * What the Settings page shows for a Cloud subscription (#156).
 *
 * Agentaab sells the subscription and grants `subscription_access`; Cloud
 * reports it as `cloudAccess.kind === "subscription"`. Kept free of the DOM
 * so it can be tested; options.js renders the result.
 */

/**
 * @typedef {{
 *   id: string,
 *   name: string,
 *   currency: string,
 *   amount_minor: number,
 *   currency_decimals?: number,
 *   interval: 'month' | 'year',
 *   trial_days?: number,
 * }} SubscriptionOffer
 */

/**
 * @param {SubscriptionOffer} offer
 * @param {string} locale BCP 47, e.g. "en-US"
 */
export function formatOfferPrice(offer, locale) {
  const decimals = Number.isInteger(offer.currency_decimals) ? Number(offer.currency_decimals) : 2;
  const amount = (Number(offer.amount_minor) || 0) / 10 ** decimals;
  const currency = String(offer.currency || "USD").toUpperCase();
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: decimals }).format(
      amount
    );
  } catch {
    return `${amount.toFixed(decimals)} ${currency}`;
  }
}

/**
 * @param {{
 *   account?: { cloudAccess?: { active?: boolean, source?: string | null, kind?: string | null, until?: string | null, subscriptionUntil?: string | null } } | null,
 *   catalog?: { offers?: SubscriptionOffer[], checkout_available?: boolean } | null,
 *   signedIn: boolean,
 * }} input
 * @param {{ t: (key: string) => string, formatInstant: (iso: string) => string, locale: string }} ui
 * @returns {{
 *   status: string | null,
 *   offers: Array<{ id: string, title: string, price: string, meta: string, canSubscribe: boolean, hint: string }>,
 * }}
 *   `status` describes access the account already has; `offers` is empty
 *   then, since there is nothing to subscribe to.
 */
export function subscriptionView({ account, catalog, signedIn }, { t, formatInstant, locale }) {
  const access = account?.cloudAccess;
  if (access?.active && access.source === "entitlement" && access.kind === "subscription") {
    // Agentaab keeps a subscription that is set to cancel `active` until the
    // period ends, so "through" is true whether or not it will renew.
    return {
      status: access.subscriptionUntil
        ? t("cloudSubscriptionActiveUntil").replace("{date}", formatInstant(access.subscriptionUntil))
        : t("cloudSubscriptionActive"),
      offers: [],
    };
  }
  // A paid plan set on the account already is Cloud; there is nothing to sell.
  if (access?.active && access.source === "plan") return { status: null, offers: [] };

  const offers = Array.isArray(catalog?.offers) ? catalog.offers : [];
  const available = catalog?.checkout_available !== false;
  return {
    status: null,
    offers: offers.map((offer) => {
      const per = offer.interval === "year" ? t("cloudSubscriptionPerYear") : t("cloudSubscriptionPerMonth");
      const trial =
        Number(offer.trial_days) > 0
          ? ` · ${t("cloudSubscriptionTrial").replace("{days}", String(offer.trial_days))}`
          : "";
      const canSubscribe = signedIn && available;
      return {
        id: offer.id,
        title: offer.name,
        price: `${formatOfferPrice(offer, locale)}${per}`,
        meta: `${t("cloudSubscriptionIncludes")}${trial}`,
        canSubscribe,
        hint: !signedIn ? t("cloudNeedSignIn") : !available ? t("cloudPackagesPreview") : "",
      };
    }),
  };
}
