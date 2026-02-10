#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_SESSIONS_DIR = path.resolve(__dirname, "../../.user_sessions");
const DEFAULT_OUT_DIR = path.resolve(__dirname, "../../.profiles");
const DEFAULT_MODEL = "gemini-3-pro-preview";
const DEFAULT_PROMPT_SESSION_COUNT = 12;

const SYSTEM_PROMPT = `You are "Professor Gemini", a rigorous but fair evaluator of a coding student's development over time.

You receive:
- Session metrics and trends
- Visualization-derived evidence from vizPayload/stateSnapshot
- Narrative text previously generated per session (grader narratives)
- Validation findings for narrative consistency

Your task:
1) Produce a comprehensive natural-language report card that explains habits, strengths, fallback patterns, debugging style, and risk areas.
2) Explicitly use the grader narratives, but discount statements that conflict with measured metrics.
3) Include concrete references to evidence (numbers, trends, session IDs when useful).
4) Be specific, avoid fluff.

Respond only as valid JSON with this exact shape:
{
  "executiveSummary": "string",
  "reportCard": {
    "habits": ["string"],
    "strengths": ["string"],
    "fallbackPatterns": ["string"],
    "riskAreas": ["string"],
    "debuggingStyle": ["string"],
    "narrativeReliability": {
      "rating": "high|medium|low",
      "notes": ["string"]
    },
    "nextMilestones": ["string"]
  },
  "confidence": {
    "score": 0,
    "rationale": "string"
  }
}`;

function parseArgs(argv) {
  const args = {
    sessionsDir: DEFAULT_SESSIONS_DIR,
    sessionsFile: "",
    outDir: DEFAULT_OUT_DIR,
    model: DEFAULT_MODEL,
    apiKey: process.env.GEMINI_API_KEY || "",
    dryRun: false,
    validateOnly: false,
    maxPromptSessions: DEFAULT_PROMPT_SESSION_COUNT,
  };

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    const next = argv[i + 1];

    if (token === "--sessions-dir" && next) {
      args.sessionsDir = path.resolve(next);
      i++;
      continue;
    }
    if (token === "--sessions-file" && next) {
      args.sessionsFile = path.resolve(next);
      i++;
      continue;
    }
    if (token === "--out-dir" && next) {
      args.outDir = path.resolve(next);
      i++;
      continue;
    }
    if (token === "--model" && next) {
      args.model = next;
      i++;
      continue;
    }
    if (token === "--api-key" && next) {
      args.apiKey = next;
      i++;
      continue;
    }
    if (token === "--max-prompt-sessions" && next) {
      args.maxPromptSessions = Math.max(1, Number.parseInt(next, 10) || DEFAULT_PROMPT_SESSION_COUNT);
      i++;
      continue;
    }
    if (token === "--dry-run") {
      args.dryRun = true;
      continue;
    }
    if (token === "--validate-only") {
      args.validateOnly = true;
      continue;
    }
    if (token === "--help") {
      printHelp();
      process.exit(0);
    }
  }

  return args;
}

function printHelp() {
  console.log(`Profile Professor Agent\n\nUsage:\n  node scripts/profile-professor-agent.mjs [options]\n\nOptions:\n  --sessions-dir <path>         Directory with session_*.json or all_sessions.json\n  --sessions-file <path>        Explicit sessions JSON file (array or single object)\n  --out-dir <path>              Output directory for generated user profiles\n  --model <name>                Gemini model name (default: ${DEFAULT_MODEL})\n  --api-key <key>               Gemini API key (recommended: use GEMINI_API_KEY env var)\n  --max-prompt-sessions <n>     Max sessions included in model context per user\n  --validate-only               Skip Gemini call; only compute metrics + narrative validation\n  --dry-run                     Print summary without writing profile files\n  --help                        Show this help\n`);
}

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function loadSessions({ sessionsDir, sessionsFile }) {
  if (sessionsFile) {
    const parsed = await readJson(sessionsFile);
    if (Array.isArray(parsed)) return parsed;
    return [parsed];
  }

  const canonicalAll = path.join(sessionsDir, "all_sessions.json");
  if (await pathExists(canonicalAll)) {
    const parsed = await readJson(canonicalAll);
    return Array.isArray(parsed) ? parsed : [parsed];
  }

  const entries = await fs.readdir(sessionsDir);
  const sessionFiles = entries
    .filter((name) => /^session_\d+\.json$/i.test(name))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  const out = [];
  for (const name of sessionFiles) {
    const full = path.join(sessionsDir, name);
    const parsed = await readJson(full);
    out.push(parsed);
  }
  return out;
}

function normalizeSession(doc) {
  const summary = doc?.summary || {};
  const runOutcomes = Array.isArray(summary.runOutcomes) ? summary.runOutcomes : [];
  const testCases = Array.isArray(summary.testCases) ? summary.testCases : [];
  const narratives = summary.narratives?.narrative || "";

  const finalRun = runOutcomes.length > 0 ? runOutcomes[runOutcomes.length - 1] : null;
  const finalFraction = finalRun && typeof finalRun.testsTotal === "number" && finalRun.testsTotal > 0
    ? finalRun.testsPassed / finalRun.testsTotal
    : 0;

  return {
    sessionId: doc?.sessionId || summary?.sessionId || "unknown",
    userId: doc?.userId || "unknown",
    email: doc?.email || "",
    createdAt: doc?.createdAt || null,
    artifact: doc?.artifact || {},
    raw: doc,
    summary,
    runOutcomes,
    testCases,
    narratives,
    finalRun,
    finalFraction,
    fullPass: !!(finalRun && finalRun.testsTotal > 0 && finalRun.testsPassed === finalRun.testsTotal),
  };
}

function inferInvariantIssues(snapshot) {
  if (!snapshot || typeof snapshot !== "object") return [];
  const issues = [];

  if (snapshot.type === "linked-list") {
    if (snapshot.tailNextIsNull === false) issues.push("linked-list tail.next is not null");
    if (snapshot.tailIsLastReachable === false) issues.push("linked-list tail is not last reachable node");
    if (snapshot.cycleDetected === true) issues.push("linked-list cycle detected");
    if (
      typeof snapshot.storedSize === "number" &&
      typeof snapshot.reachableNodes === "number" &&
      snapshot.storedSize !== snapshot.reachableNodes
    ) {
      issues.push(`linked-list size mismatch (stored=${snapshot.storedSize}, reachable=${snapshot.reachableNodes})`);
    }
  }

  if (snapshot.type === "arraylist") {
    if (snapshot.sizeInRange === false) issues.push("arraylist size out of range");
    if (
      typeof snapshot.storedSize === "number" &&
      typeof snapshot.capacity === "number" &&
      snapshot.storedSize > snapshot.capacity
    ) {
      issues.push(`arraylist size exceeds capacity (${snapshot.storedSize} > ${snapshot.capacity})`);
    }
  }

  if (snapshot.type === "circular-queue") {
    if (snapshot.indicesInRange === false) issues.push("circular queue indices out of range");
    if (snapshot.sizeInRange === false) issues.push("circular queue size out of range");
  }

  return issues;
}

function walkForVizPayloads(value, hits = []) {
  if (!value || typeof value !== "object") return hits;

  const asObj = value;
  const hasVizShape = typeof asObj.diagramType === "string" && asObj.structure;
  if (hasVizShape) {
    hits.push({ viz: asObj });
  }

  if (asObj.viz && typeof asObj.viz === "object" && typeof asObj.viz.diagramType === "string") {
    hits.push(asObj);
  }

  if (Array.isArray(asObj)) {
    for (const item of asObj) walkForVizPayloads(item, hits);
    return hits;
  }

  for (const child of Object.values(asObj)) {
    walkForVizPayloads(child, hits);
  }

  return hits;
}

function summarizeVizEvidence(userSessions) {
  const diagramTypeCounts = {};
  const invariantIssues = [];
  let truncatedCount = 0;
  let payloadCount = 0;

  for (const session of userSessions) {
    const hits = walkForVizPayloads(session.summary, []);
    const artifactHits = walkForVizPayloads(session.artifact, []);
    const rawHits = walkForVizPayloads(session.raw, []);
    const allHits = [...hits, ...artifactHits, ...rawHits];

    for (const hit of allHits) {
      payloadCount += 1;
      const viz = hit.viz || hit;
      const diagramType = viz?.diagramType;
      if (typeof diagramType === "string") {
        diagramTypeCounts[diagramType] = (diagramTypeCounts[diagramType] || 0) + 1;
      }
      if (viz?.truncated === true) truncatedCount += 1;
      const issues = inferInvariantIssues(viz?.stateSnapshot);
      for (const issue of issues) {
        invariantIssues.push({
          sessionId: session.sessionId,
          issue,
          snapshotType: viz?.stateSnapshot?.type || "unknown",
        });
      }
    }
  }

  return {
    payloadCount,
    truncatedCount,
    diagramTypeCounts,
    invariantIssueCount: invariantIssues.length,
    invariantIssues,
  };
}

function validateNarrative(session) {
  const flags = [];
  const narrative = (session.narratives || "").toLowerCase();
  const finalRun = session.finalRun;
  const finalPassedAll = !!(finalRun && finalRun.testsTotal > 0 && finalRun.testsPassed === finalRun.testsTotal);

  if (!session.narratives || session.narratives.trim().length === 0) {
    return { sessionId: session.sessionId, flags: ["missing narrative"], score: 0.4 };
  }

  const claimsAllPass = /all tests pass|all tests passed|full pass|session ended successfully|final outcome:\s*5\/5/.test(narrative);
  if (claimsAllPass && !finalPassedAll) {
    flags.push("narrative claims full pass but final run did not pass all tests");
  }

  const claimsFailure = /did not pass|ended with some tests not passing|not passing/.test(narrative);
  if (claimsFailure && finalPassedAll) {
    flags.push("narrative claims unresolved failures but final run passed all tests");
  }

  const progress = Number(session.summary?.iteration?.progressPerIteration ?? 0);
  const mentionsConvergent = /classification:\s*convergent|\bconvergent\b/.test(narrative);
  if (mentionsConvergent && progress < 0) {
    flags.push("narrative says convergent while progressPerIteration is negative");
  }

  const concepts = Array.isArray(session.summary?.conceptsFetched) ? session.summary.conceptsFetched : [];
  const saysNoResources = /no learning resources consulted/.test(narrative);
  if (saysNoResources && concepts.length > 0) {
    flags.push("narrative says no resources consulted but conceptsFetched is non-empty");
  }

  const lastError = finalRun?.errorSnippet || "";
  if (lastError && narrative.includes("last error") && !narrative.includes(lastError.toLowerCase())) {
    flags.push("narrative references last error but omits/mismatches final error snippet");
  }

  const score = Math.max(0, 1 - flags.length * 0.2);
  return { sessionId: session.sessionId, flags, score };
}

function computeMetrics(userSessions) {
  const sorted = [...userSessions].sort((a, b) => {
    const aTs = Number(a.summary?.startedAt || 0);
    const bTs = Number(b.summary?.startedAt || 0);
    return aTs - bTs;
  });

  const sessionCount = sorted.length;
  const totalRuns = sorted.reduce((sum, s) => sum + Number(s.summary?.runCount || s.runOutcomes.length || 0), 0);
  const totalActiveSeconds = sorted.reduce((sum, s) => sum + Number(s.summary?.activeSeconds || 0), 0);
  const avgActiveSeconds = sessionCount > 0 ? totalActiveSeconds / sessionCount : 0;
  const fullPassSessions = sorted.filter((s) => s.fullPass).length;

  const finalFractions = sorted.map((s) => s.finalFraction);
  const avgFinalPassFraction = finalFractions.length > 0
    ? finalFractions.reduce((a, b) => a + b, 0) / finalFractions.length
    : 0;

  const firstFinalFraction = finalFractions[0] ?? 0;
  const lastFinalFraction = finalFractions[finalFractions.length - 1] ?? 0;

  const endReasons = {};
  const iterationClasses = {};
  let conceptsCount = 0;
  let helpEventsCount = 0;
  let avgProgressPerIteration = 0;

  for (const s of sorted) {
    const endReason = s.summary?.endReason || "unknown";
    endReasons[endReason] = (endReasons[endReason] || 0) + 1;

    const cls = s.summary?.iteration?.classification || "unknown";
    iterationClasses[cls] = (iterationClasses[cls] || 0) + 1;

    conceptsCount += Array.isArray(s.summary?.conceptsFetched) ? s.summary.conceptsFetched.length : 0;
    helpEventsCount += Number(s.summary?.helpEventsCount || 0);
    avgProgressPerIteration += Number(s.summary?.iteration?.progressPerIteration || 0);
  }

  if (sessionCount > 0) {
    avgProgressPerIteration /= sessionCount;
  }

  const narrativeChecks = sorted.map(validateNarrative);
  const narrativeFlagCount = narrativeChecks.reduce((sum, item) => sum + item.flags.length, 0);
  const narrativeQualityScore = narrativeChecks.length > 0
    ? narrativeChecks.reduce((sum, item) => sum + item.score, 0) / narrativeChecks.length
    : 0;

  return {
    sessionCount,
    totalRuns,
    totalActiveSeconds,
    avgActiveSeconds,
    fullPassSessions,
    fullPassRate: sessionCount > 0 ? fullPassSessions / sessionCount : 0,
    avgFinalPassFraction,
    trajectory: {
      firstFinalPassFraction: firstFinalFraction,
      lastFinalPassFraction: lastFinalFraction,
      delta: lastFinalFraction - firstFinalFraction,
    },
    endReasons,
    iterationClasses,
    avgProgressPerIteration,
    conceptsCount,
    helpEventsCount,
    narrativeValidation: {
      sessionsWithNarratives: sorted.filter((s) => (s.narratives || "").trim().length > 0).length,
      checks: narrativeChecks,
      totalFlags: narrativeFlagCount,
      averageQualityScore: narrativeQualityScore,
    },
  };
}

function clampText(value, max = 1200) {
  if (!value || typeof value !== "string") return "";
  if (value.length <= max) return value;
  return `${value.slice(0, max)}... [truncated]`;
}

function buildProfessorInput({ userId, email, sessions, metrics, vizEvidence, maxPromptSessions }) {
  const recentSessions = [...sessions]
    .sort((a, b) => Number(b.summary?.startedAt || 0) - Number(a.summary?.startedAt || 0))
    .slice(0, maxPromptSessions)
    .map((s) => ({
      sessionId: s.sessionId,
      startedAt: s.summary?.startedAt || null,
      endedAt: s.summary?.endedAt || null,
      runCount: s.summary?.runCount || s.runOutcomes.length,
      activeSeconds: s.summary?.activeSeconds || 0,
      endReason: s.summary?.endReason || "unknown",
      firstAttempt: s.summary?.firstAttempt || {},
      iteration: s.summary?.iteration || {},
      debugging: s.summary?.debugging || {},
      finalRun: s.finalRun
        ? {
            testsPassed: s.finalRun.testsPassed,
            testsTotal: s.finalRun.testsTotal,
            passed: s.finalRun.passed,
            errorSnippet: s.finalRun.errorSnippet || "",
          }
        : null,
      graderNarrative: clampText(s.narratives, 1200),
      narrativeValidationFlags: metrics.narrativeValidation.checks.find((c) => c.sessionId === s.sessionId)?.flags || [],
    }));

  return {
    user: { userId, email },
    aggregateMetrics: metrics,
    vizEvidence,
    sessionEvidence: recentSessions,
  };
}

async function callGeminiProfessor({ apiKey, model, payload }) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const body = {
    systemInstruction: {
      parts: [{ text: SYSTEM_PROMPT }],
    },
    contents: [
      {
        role: "user",
        parts: [
          {
            text: `Student evidence payload:\n${JSON.stringify(payload)}\n\nReturn only JSON matching the required schema.`,
          },
        ],
      },
    ],
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0.4,
      topP: 0.95,
    },
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const raw = await response.text();

    if (!response.ok) {
      throw new Error(`Gemini API request failed (${response.status}): ${raw.slice(0, 800)}`);
    }

    const parsed = JSON.parse(raw);
    const text =
      parsed?.candidates?.[0]?.content?.parts
        ?.map((part) => part?.text || "")
        .join("\n")
        .trim() || "";

    if (!text) {
      throw new Error("Gemini response did not include text content");
    }

    const cleaned = stripFence(text);
    return JSON.parse(cleaned);
  } finally {
    clearTimeout(timeout);
  }
}

function stripFence(value) {
  const trimmed = value.trim();
  if (!trimmed.startsWith("```")) return trimmed;
  return trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function buildFallbackProfessorReport(metrics, vizEvidence) {
  const lowReliability = metrics.narrativeValidation.totalFlags > Math.max(1, Math.floor(metrics.sessionCount / 2));
  const reliability = lowReliability ? "low" : metrics.narrativeValidation.totalFlags > 0 ? "medium" : "high";

  return {
    executiveSummary:
      "Rule-based fallback report: model response unavailable. This profile is generated from deterministic session metrics and narrative checks.",
    reportCard: {
      habits: [
        `Completed ${metrics.sessionCount} sessions with ${metrics.totalRuns} total runs.`,
        `Average active time per session: ${metrics.avgActiveSeconds.toFixed(1)} seconds.`,
      ],
      strengths: [
        `Full-pass sessions: ${metrics.fullPassSessions}/${metrics.sessionCount}.`,
        `Final pass-fraction trend delta: ${metrics.trajectory.delta.toFixed(2)}.`,
      ],
      fallbackPatterns: [
        `Narrative inconsistencies flagged: ${metrics.narrativeValidation.totalFlags}.`,
        `Average progress per iteration: ${metrics.avgProgressPerIteration.toFixed(3)}.`,
      ],
      riskAreas: [
        `Visualization invariant issues detected: ${vizEvidence.invariantIssueCount}.`,
        `Truncated visualization payloads: ${vizEvidence.truncatedCount}.`,
      ],
      debuggingStyle: [
        `Help events count: ${metrics.helpEventsCount}.`,
        `Concept/resource references used: ${metrics.conceptsCount}.`,
      ],
      narrativeReliability: {
        rating: reliability,
        notes: [
          `Narrative quality score: ${metrics.narrativeValidation.averageQualityScore.toFixed(2)}.`,
          "Narratives were treated as grader evidence and validated against measured outcomes.",
        ],
      },
      nextMilestones: [
        "Reduce contradiction rate between narrative claims and final run outcomes.",
        "Stabilize test progression so solved cases do not regress between runs.",
      ],
    },
    confidence: {
      score: 0.55,
      rationale: "Fallback confidence is moderate because LLM synthesis was unavailable.",
    },
  };
}

async function loadExistingProfile(filePath) {
  if (!(await pathExists(filePath))) return null;
  try {
    return await readJson(filePath);
  } catch {
    return null;
  }
}

async function writeProfile({ outDir, userId, profile, dryRun }) {
  const profilePath = path.join(outDir, `user_${userId}.json`);
  if (dryRun) {
    return profilePath;
  }

  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(profilePath, `${JSON.stringify(profile, null, 2)}\n`, "utf8");
  return profilePath;
}

function groupByUser(sessions) {
  const map = new Map();
  for (const session of sessions) {
    const normalized = normalizeSession(session);
    if (!normalized.userId || normalized.userId === "unknown") continue;

    if (!map.has(normalized.userId)) {
      map.set(normalized.userId, {
        userId: normalized.userId,
        email: normalized.email,
        sessions: [],
      });
    }
    map.get(normalized.userId).sessions.push(normalized);
  }
  return map;
}

async function run() {
  const args = parseArgs(process.argv.slice(2));

  const sessions = await loadSessions({
    sessionsDir: args.sessionsDir,
    sessionsFile: args.sessionsFile,
  });

  if (!Array.isArray(sessions) || sessions.length === 0) {
    throw new Error("No sessions were loaded. Check --sessions-dir/--sessions-file.");
  }

  const users = groupByUser(sessions);
  if (users.size === 0) {
    throw new Error("No valid userId values found in sessions.");
  }

  if (!args.validateOnly && !args.apiKey) {
    throw new Error("GEMINI_API_KEY is required unless --validate-only is used.");
  }

  const indexSummary = [];

  for (const user of users.values()) {
    const metrics = computeMetrics(user.sessions);
    const vizEvidence = summarizeVizEvidence(user.sessions);

    const professorInput = buildProfessorInput({
      userId: user.userId,
      email: user.email,
      sessions: user.sessions,
      metrics,
      vizEvidence,
      maxPromptSessions: args.maxPromptSessions,
    });

    const profilePath = path.join(args.outDir, `user_${user.userId}.json`);
    const previous = await loadExistingProfile(profilePath);
    const nextVersion = previous?.version ? Number(previous.version) + 1 : 1;

    let professorReport;
    let generationMode = "llm";
    let llmError = "";

    if (args.validateOnly) {
      generationMode = "validate-only";
      professorReport = buildFallbackProfessorReport(metrics, vizEvidence);
    } else {
      try {
        professorReport = await callGeminiProfessor({
          apiKey: args.apiKey,
          model: args.model,
          payload: professorInput,
        });
      } catch (err) {
        generationMode = "fallback";
        llmError = err instanceof Error ? err.message : String(err);
        professorReport = buildFallbackProfessorReport(metrics, vizEvidence);
      }
    }

    const profile = {
      profileType: "professor_report_card",
      version: nextVersion,
      userId: user.userId,
      email: user.email,
      generatedAt: new Date().toISOString(),
      model: args.model,
      generationMode,
      llmError: llmError || undefined,
      source: {
        sessionsDir: args.sessionsDir,
        sessionsLoaded: user.sessions.length,
        includesVizPayloadDerivedData: true,
      },
      aggregateMetrics: metrics,
      vizEvidence,
      professorInputSnapshot: {
        user: professorInput.user,
        aggregateMetrics: professorInput.aggregateMetrics,
        vizEvidence: {
          payloadCount: professorInput.vizEvidence.payloadCount,
          invariantIssueCount: professorInput.vizEvidence.invariantIssueCount,
        },
        sessionEvidenceCount: professorInput.sessionEvidence.length,
      },
      report: professorReport,
      previousVersion: previous
        ? {
            version: previous.version,
            generatedAt: previous.generatedAt,
          }
        : null,
    };

    const wroteTo = await writeProfile({
      outDir: args.outDir,
      userId: user.userId,
      profile,
      dryRun: args.dryRun,
    });

    indexSummary.push({
      userId: user.userId,
      email: user.email,
      version: nextVersion,
      sessions: user.sessions.length,
      fullPassRate: Number(metrics.fullPassRate.toFixed(3)),
      narrativeFlags: metrics.narrativeValidation.totalFlags,
      generationMode,
      output: wroteTo,
    });
  }

  if (!args.dryRun) {
    await fs.mkdir(args.outDir, { recursive: true });
    await fs.writeFile(
      path.join(args.outDir, "index.json"),
      `${JSON.stringify({ generatedAt: new Date().toISOString(), users: indexSummary }, null, 2)}\n`,
      "utf8"
    );
  }

  console.log(JSON.stringify({
    ok: true,
    usersProcessed: indexSummary.length,
    outDir: args.outDir,
    dryRun: args.dryRun,
    index: indexSummary,
  }, null, 2));
}

run().catch((err) => {
  console.error(`[profile-professor-agent] ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
