import { randomUUID } from "node:crypto";
import Fastify, { LogController, type FastifyInstance } from "fastify";
import { compareAccessDecisions } from "./access-decision.js";
import { pseudonymizeUid, sanitizedError } from "./observability.js";
import type { RuntimeConfig, StagingRepository, TokenVerifier } from "./types.js";

export interface AppDependencies {
  readonly config: RuntimeConfig;
  readonly repository: StagingRepository;
  readonly tokenVerifier: TokenVerifier;
  readonly logger?: boolean;
  readonly now?: () => number;
}

function bearerToken(header: string | undefined): string | null {
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  return token.length > 0 ? token : null;
}

function baseResponse(config: RuntimeConfig, requestId: string) {
  return { requestId, appVersion: config.appVersion };
}

export function buildApp(dependencies: AppDependencies): FastifyInstance {
  const { config, repository, tokenVerifier } = dependencies;
  const now = dependencies.now ?? Date.now;
  const app = Fastify({
    logger: dependencies.logger ?? true,
    requestIdHeader: false,
    logController: new LogController({ disableRequestLogging: true })
  });

  app.get("/health/live", () => ({ status: "LIVE" }));

  app.get("/health/version", () => ({
    version: config.appVersion,
    sha: config.releaseSha,
    environment: config.environment,
    buildTime: config.buildTime,
    shadowMode: config.shadowMode
  }));

  app.get("/health/ready", async (_request, reply) => {
    try {
      const health = await repository.getHealthState();
      const ready = health?.ready === true
        && health.environment === config.environment
        && health.schemaVersion === 1;
      return reply.code(ready ? 200 : 503).send({ status: ready ? "READY" : "NOT_READY" });
    } catch (error) {
      app.log.error({ event: "health_ready_failed", error: sanitizedError(error) });
      return reply.code(503).send({ status: "NOT_READY" });
    }
  });

  app.post("/v1/session/bootstrap", async (request, reply) => {
    const requestId = randomUUID();
    const startedAt = now();
    const body = request.body;
    if (body && (typeof body !== "object" || Array.isArray(body) || Object.keys(body).length > 0)) {
      return reply.code(400).send({
        ...baseResponse(config, requestId),
        result: "BLOCKED",
        reason: "BODY_MUST_BE_EMPTY",
        severity: "warning",
        recommendation: "REMOVE_CLIENT_IDENTITY_FIELDS"
      });
    }

    const token = bearerToken(request.headers.authorization);
    if (!token) {
      return reply.code(401).send({
        ...baseResponse(config, requestId),
        result: "BLOCKED",
        reason: "AUTH_REQUIRED",
        severity: "warning",
        recommendation: "SIGN_IN_WITH_STAGING_FIREBASE_AUTH"
      });
    }

    let uid = "";
    try {
      uid = (await tokenVerifier.verify(token)).uid;
      const [flags, snapshot] = await Promise.all([
        repository.getFeatureFlags(),
        repository.getAccessSnapshot(uid)
      ]);
      const decision = compareAccessDecisions(snapshot, flags, now());
      const latencyMs = Math.max(0, now() - startedAt);

      if (flags.observabilityV1) {
        app.log.info({
          event: "bootstrap_shadow",
          requestId,
          timestamp: new Date().toISOString(),
          environment: config.environment,
          version: config.appVersion,
          sha: config.releaseSha,
          result: decision.result,
          latencyMs,
          uidPseudonym: pseudonymizeUid(uid, config.uidPseudonymSecret),
          accountType: decision.accountType
        });
      }

      return reply.send({
        ...baseResponse(config, requestId),
        result: decision.result,
        reason: decision.reason,
        severity: decision.severity,
        recommendation: decision.recommendation
      });
    } catch (error) {
      const safeError = sanitizedError(error);
      app.log.error({
        event: "bootstrap_shadow_error",
        requestId,
        environment: config.environment,
        version: config.appVersion,
        sha: config.releaseSha,
        uidPseudonym: uid ? pseudonymizeUid(uid, config.uidPseudonymSecret) : "not-verified",
        latencyMs: Math.max(0, now() - startedAt),
        error: safeError
      });
      return reply.code(500).send({
        ...baseResponse(config, requestId),
        result: "ERROR",
        reason: "SHADOW_EVALUATION_FAILED",
        severity: "critical",
        recommendation: "REVIEW_SANITIZED_LOG"
      });
    }
  });

  return app;
}
