/** @type {import("@commitlint/types").UserConfig} */
const config = {
  extends: ["@commitlint/config-conventional"],
  rules: {
    // Keep subjects readable in `git log --oneline` and on GitHub.
    "header-max-length": [2, "always", 72],
    "body-max-line-length": [2, "always", 100],
  },
};

export default config;
