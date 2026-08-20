/**
 * sweep-rules.mjs — the DETECTION manifest for the public mirror gate.
 *
 * PUBLISHED to mutagent-io/examples. It carries detection patterns ONLY — no rewrite
 * rules — so the public repo can re-run the same gate on its own pushes and on outside
 * PRs without shipping the private rewrite manifest. The rewrite half lives in
 * scrub-rules.mjs, which is DENIED from publishing.
 *
 * EVERY denied term is base64-encoded, without exception. Not because the terms are all
 * secret, but because this file ships to the public repo and must therefore pass its own
 * gate — a plaintext denylist would flag itself forever. Same reasoning as the NDA list in
 * mutagent-system/scripts/release/prepublish-guard.mjs: a gate must never leak what it guards.
 *
 * To read or edit the denylist:
 *     node -e 'console.log(Buffer.from("<the base64>","base64").toString())'
 *     node -e 'console.log(Buffer.from("term,term","utf8").toString("base64"))'
 *
 * Ported from mutagent-system/scripts/release/public-scrub/scrub-rules.mjs.
 * Pure data, zero deps.
 */

const dec = (b) => Buffer.from(b, "base64").toString("utf8").split(",");
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// ── Denied terms, by category ────────────────────────────────────────────────
const GROUPS = [
  // the private GitHub org and its slug
  { name: "private-org", terms: dec("YXJjaGl0ZWNoLHByaW50d29ya3M=") },
  // a prior employer's domain, present in this repo's old commit authorship
  { name: "prior-employer", terms: dec("YmVhbS5haQ==") },
  // retired internal engine + the internal spelling of the lifecycle acronym
  { name: "retired-internal", terms: dec("bWV0YXR1bmVyLGFkbGM=") },
  // client identities under NDA (lifted from prepublish-guard.mjs)
  { name: "client-identity", terms: dec("Y2xlb24sY2xlcmEsa2FsYXNhcixiNGMxNDY1MCxwZmxlZ2UsZ2VuZXJhdGVkcmFmdG1lc3NhZ2Usa2FsYXNhcl9sYW5nZnVzZSxob29rX3VzZWQsZGFmdGFyaQ==") },
];
// short tokens — word-boundary matched, else they hit inside ordinary words
const GROUPS_WB = [
  { name: "client-identity", terms: dec("bGVvLHJvb2Zpbmc=") },
];

// ── The internal coded-ref token ─────────────────────────────────────────────
// Internal bookkeeping families: tracked-item ids, decision/ruling codes, wave codes.
// [DNFR]\d{1,2} is deliberately broad and therefore noisy — see EXEMPT_PATHS + codedRefExt.
export const REF_TOKEN = String.raw`(?:(?:FU|ORCH|EV|KP|REQ|PR|OP-PR|DC|SPEC|DP)-[A-Z0-9]+|[DNFR]\d{1,2}|Wave-?\d+[A-Z]?|W\d+I\d+|Model-[A-Z])`;

// ── Paths where a rule is too noisy to apply ─────────────────────────────────
// A CAD harness legitimately names its parts with a letter-and-digit scheme, and source
// code legitimately names variables the same way. The coded-ref rule is therefore scoped
// to prose and config by extension, and these paths are skipped entirely.
export const EXEMPT_PATHS = [
  /(^|\/)node_modules\//,
  /(^|\/)\.git\//,
  /(^|\/)\.venv\//,
];

export const SWEEP = {
  terms: [
    ...GROUPS.flatMap((g) => g.terms.map((t) => ({ name: g.name, re: new RegExp(esc(t), "i") }))),
    ...GROUPS_WB.flatMap((g) => g.terms.map((t) => ({ name: g.name, re: new RegExp(`\\b${esc(t)}\\b`, "i") }))),
    // internal product taxonomy that never got public definitions
    { name: "internal-taxonomy", re: /\bPATH\s+[AB]\b/ },
    // the private umbrella repo, hyphenated or spaced, in any casing
    { name: "private-repo", re: new RegExp(esc(dec("bXV0YWdlbnQ=")[0]) + String.raw`[\s-]+monorepo`, "i") },
  ],

  // Path shapes that betray the internal customer-data pipeline
  paths: [
    { name: "customer-slot", re: new RegExp(esc(dec("ZGF0YXNldHMvY3VzdG9tZXIt")[0]) + String.raw`\d+`, "i") },
    { name: "internal-analysis", re: /(^|\/)\.analysis\// },
  ],

  // Internal bookkeeping refs — prose and config only
  codedRef: new RegExp(String.raw`\b${REF_TOKEN}\b`),
  codedRefExt: new Set([".md", ".yaml", ".yml", ".txt", ".html"]),

  secrets:
    /ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-ant-[A-Za-z0-9_-]{20,}|sk-proj-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,}|xox[baprs]-[A-Za-z0-9-]{10,}|-----BEGIN [A-Z ]+PRIVATE KEY-----/,

  // KEPT as public vocabulary, never flagged: "ADL" / "Agentic Development Lifecycle",
  // the circled stage numerals ①..⑥, and real product/command names. The ban is on
  // internal bookkeeping codes, not domain terms.
  exemptPaths: EXEMPT_PATHS,
};
