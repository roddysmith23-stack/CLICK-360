import { z } from "zod";
import type { RuntimeConfig } from "./types.js";

export const STAGING_PROJECT_ID = "click360-staging-7620168025";

const schema = z.object({
  GOOGLE_CLOUD_PROJECT: z.literal(STAGING_PROJECT_ID),
  CLICK360_ENVIRONMENT: z.literal("staging"),
  APP_VERSION: z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/),
  RELEASE_SHA: z.string().regex(/^[a-f0-9]{7,40}$/),
  BUILD_TIME: z.string().datetime(),
  SHADOW_MODE: z.literal("true"),
  UID_PSEUDONYM_SECRET: z.string().min(32),
  PORT: z.coerce.number().int().positive().max(65535).default(8080)
});

export function loadConfig(source: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const parsed = schema.parse(source);
  return {
    projectId: parsed.GOOGLE_CLOUD_PROJECT,
    environment: parsed.CLICK360_ENVIRONMENT,
    appVersion: parsed.APP_VERSION,
    releaseSha: parsed.RELEASE_SHA,
    buildTime: parsed.BUILD_TIME,
    shadowMode: true,
    uidPseudonymSecret: parsed.UID_PSEUDONYM_SECRET,
    port: parsed.PORT
  };
}
