// core 统一出口（浏览器本地模式与 Worker 共用）
export * from './types';
export { tokenize, normalizeText, charBigramSet, jaccard, extendDictionary, FINANCE_TERMS } from './tokenize';
export { parseFrontMatter, normalizeMeta, buildFrontMatter, chunkDocument, splitSentences, MAX_CHUNK_CHARS } from './chunk';
export { buildKeywordIndex, createKeywordRetriever, createHybridRetriever, keywordSearch, cosine, HYBRID_W_KW, HYBRID_W_VEC } from './retrieve';
export { analyzeInput, scanOutput, checkInput, maskPII, splitClauses, isViolation } from './compliance';
export { computeConfidence, computeGrounding, decideByConfidence, validateCitations, extractCitations, matchSuitability, maxProductRisk, normalizeRetrieval, T_ANSWER, T_CAVEAT } from './confidence';
export { buildScriptBook, DEFAULT_SCRIPTS, fillTicket, suitabilityNotice, CAVEAT_TEXT } from './templates';
export { runPipeline, sanitizeInput, parseLlmJson, stripThink, buildMessages, extractiveAnswer, refusalFor, SYSTEM_PROMPT, MAX_INPUT, T_UNKNOWN_HYBRID, T_UNKNOWN_KEYWORD } from './pipeline';
export { normalizeQuestion, questionSimilarity, findMergeTarget, GAP_MERGE_THRESHOLD } from './gaps';
export { judge, summarize, type EvalQuestion, type EvalResult } from './eval';
