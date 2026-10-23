// Commit message convention: Conventional Commits with English subjects and
// English scopes (e.g. "feat(schedule): add month view").
// 提交信息规范:Conventional Commits,英文主题与英文 scope
// (如 "feat(schedule): add month view")。
/** @type {import('@commitlint/types').UserConfig} */
export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    // AGENTS.md requires a single subject line: no body, no trailers.
    // AGENTS.md 要求单行提交:无正文、无尾注。
    "body-empty": [2, "always"],
    "footer-empty": [2, "always"],
    "scope-case": [2, "always", "lower-case"],
  },
};
