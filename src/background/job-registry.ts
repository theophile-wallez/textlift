/**
 * The map of the running jobs to their page.
 *
 * The offscreen document reports its progress with a job id, and it knows no
 * tab. This registry gives the service worker the frame to forward the notice to.
 *
 * The map lives in memory. A restart of the service worker also loses the promise
 * of the running scan, so a durable store would add nothing.
 */

import type { TabTarget } from "../shared/messaging.js";

const jobs = new Map<string, TabTarget>();

export const registerJob = (jobId: string, target: TabTarget): void => {
  jobs.set(jobId, target);
};

export const forgetJob = (jobId: string): void => {
  jobs.delete(jobId);
};

export const findJobTarget = (jobId: string): TabTarget | undefined => jobs.get(jobId);
