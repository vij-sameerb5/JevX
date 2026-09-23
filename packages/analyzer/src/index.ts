// @jevx/analyzer — the Phase 1 decision-boundary engine (TypeScript / JavaScript).
// Structural analysis → candidate generators → deterministic filtering → decision representation.
// Offline and deterministic. Does not depend on the legacy text-matching detector.
export { ANALYSIS_VERSION, analyzeFile, analyzeProject, type AnalyzeOptions } from "./analyze.js";
export { collectFacts, provenanceOf, isClosedType, type UnitFacts, type ConditionFact, type ArmSet } from "./facts.js";
export { GENERATORS, runGenerators } from "./generators.js";
export { triage } from "./triage.js";
export { explain, inputsOf, outcomesOf, suggestPrimitive } from "./represent.js";
export { fileRole, readPackageInfo, languageOf, type FileRole } from "./project.js";
export { RepoIndex, type RepoIndexOptions } from "./repo-index.js";
export { findJevUsage, JEV_FINDER_VERSION, JEV_SDK_MODULES, JEV_AI_SDK_PROVIDER, type FindJevUsageOptions } from "./jev-usage.js";
