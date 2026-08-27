/**
 * Extension-side research client (Issue #52).
 *
 * The extension knows exactly three endpoints and nothing about how research is
 * executed:
 *
 *   POST /v1/research
 *   GET  /v1/jobs/:id
 *   POST /v1/jobs/:id/cancel
 *
 * No PromptaaS identifiers, no capability ids, no runtime routing hints ever
 * leave the browser — that is what makes the runtime replaceable.
 */

import { buildResearchInput, toResearchMode } from "./agent-job.js";
import { cloudFetch } from "./cloud.js";

/**
 * @param {{ baseUrl?: string, accessToken?: string }} config
 */
function requireCloud(config) {
  if (!String(config?.baseUrl || "").trim()) {
    throw new Error(
      "WDIMTM Cloud is required for research jobs: a durable job has to outlive this tab. Configure the cloud base URL in options."
    );
  }
}

/**
 * @param {unknown} data
 * @returns {import('./agent-job.js').AgentJob}
 */
function unwrapJob(data) {
  const job = /** @type {any} */ (data)?.job || data;
  if (!job?.id) throw new Error("WDIMTM Cloud returned no research job.");
  return job;
}

/**
 * Start a durable research job.
 * @param {{ baseUrl?: string, accessToken?: string }} config
 * @param {object} input  from buildResearchInput()
 * @returns {Promise<import('./agent-job.js').AgentJob>}
 */
export async function startResearch(config, input) {
  requireCloud(config);
  const res = await cloudFetch(config, "/research", {
    method: "POST",
    body: { input },
  });
  return unwrapJob(await res.json());
}

/**
 * @param {{ baseUrl?: string, accessToken?: string }} config
 * @param {string} jobId  WDIMTM job id — never a runtime execution id.
 */
export async function getResearchJob(config, jobId) {
  requireCloud(config);
  const res = await cloudFetch(config, `/jobs/${encodeURIComponent(jobId)}`);
  return unwrapJob(await res.json());
}

/**
 * @param {{ baseUrl?: string, accessToken?: string }} config
 * @param {string} jobId
 */
export async function cancelResearchJob(config, jobId) {
  requireCloud(config);
  const res = await cloudFetch(config, `/jobs/${encodeURIComponent(jobId)}/cancel`, {
    method: "POST",
    body: {},
  });
  return unwrapJob(await res.json());
}

/**
 * Recent jobs for this account. A durable job has to be reachable after the tab
 * that started it is gone, so the list is part of the product, not a debug view.
 * @param {{ baseUrl?: string, accessToken?: string }} config
 * @returns {Promise<Array<object>>}
 */
export async function listResearchJobs(config) {
  requireCloud(config);
  const res = await cloudFetch(config, "/jobs");
  const data = await res.json();
  return Array.isArray(data?.jobs) ? data.jobs : [];
}

/**
 * Explain → Research escalation: take the moment the user is already looking at
 * and turn it into a durable job, carrying the same lens, profile and memories
 * that produced the explanation.
 *
 * @param {{ baseUrl?: string, accessToken?: string }} config
 * @param {{
 *   selection: string,
 *   page: { url: string, title: string, context?: string },
 *   lens?: { id?: string, instructions?: string },
 *   profile?: string,
 *   memories?: Array<{ type?: string, content?: string }>,
 *   mode?: string,
 *   goal?: string,
 *   question?: string,
 *   budget?: object,
 * }} moment
 */
export async function createResearchJobFromExplain(config, moment) {
  const input = buildResearchInput({
    ...moment,
    mode: toResearchMode(moment?.mode),
  });
  return startResearch(config, input);
}
