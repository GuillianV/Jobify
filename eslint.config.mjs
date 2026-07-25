import js from "@eslint/js";
import globals from "globals";
import jsdoc from "eslint-plugin-jsdoc";
import react from "eslint-plugin-react";

const EMOJI_PATTERN = /\p{Extended_Pictographic}/u;
const EMOJI_MESSAGE = "Emoji are not allowed (code, strings or comments).";
const MAGIC_NUMBER_ALLOWLIST = [-1, 0, 1];

/**
 * Local ESLint plugin providing a rule that forbids emoji anywhere in the
 * source: string literals, template literals and comments.
 */
const noEmojiPlugin = {
  rules: {
    "no-emoji": {
      meta: {
        type: "problem",
        docs: {
          description: "Disallow emoji in code, strings and comments.",
        },
        schema: [],
      },
      create(context) {
        const sourceCode = context.sourceCode;

        /**
         * Report the given node as containing a forbidden emoji.
         * @param {object} node - The offending AST node or comment.
         * @returns {void}
         */
        function report(node) {
          context.report({ node, message: EMOJI_MESSAGE });
        }

        /**
         * Tell whether a value contains at least one emoji character.
         * @param {unknown} value - Candidate value to inspect.
         * @returns {boolean} True when an emoji is present.
         */
        function containsEmoji(value) {
          return typeof value === "string" && EMOJI_PATTERN.test(value);
        }

        return {
          Literal(node) {
            if (containsEmoji(node.value)) {
              report(node);
            }
          },
          TemplateElement(node) {
            if (containsEmoji(node.value.raw)) {
              report(node);
            }
          },
          Program() {
            const comments = sourceCode.getAllComments();
            for (const comment of comments) {
              if (containsEmoji(comment.value)) {
                report(comment);
              }
            }
          },
        };
      },
    },
  },
};

const conventionRules = {
  "no-magic-numbers": [
    "error",
    {
      ignore: MAGIC_NUMBER_ALLOWLIST,
      ignoreArrayIndexes: true,
      enforceConst: true,
    },
  ],
  curly: ["error", "all"],
  "brace-style": ["error", "1tbs"],
  "nonblock-statement-body-position": ["error", "below"],
  "arrow-body-style": ["error", "always"],
  "func-style": ["error", "declaration"],
  camelcase: ["error", { properties: "never" }],
  "new-cap": ["error", { capIsNew: false }],
  "jsdoc/require-jsdoc": [
    "error",
    {
      require: {
        FunctionDeclaration: true,
        MethodDefinition: true,
        ClassDeclaration: true,
      },
    },
  ],
  "jsdoc/require-description": "error",
};

export default [
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/dist-electron/**",
      "**/build/**",
      "**/out/**",
    ],
  },
  js.configs.recommended,
  {
    plugins: { "no-emoji": noEmojiPlugin },
    rules: { "no-emoji/no-emoji": "error" },
  },
  {
    files: ["server/**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { ...globals.node },
    },
    plugins: { jsdoc },
    rules: { ...conventionRules },
  },
  {
    files: ["desktop/src/**/*.{js,jsx}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser },
    },
    plugins: { jsdoc, react },
    rules: {
      ...conventionRules,
      "func-style": "off",
      "react/jsx-uses-react": "error",
      "react/jsx-uses-vars": "error",
    },
  },
  {
    files: ["desktop/electron/**/*.cjs"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "commonjs",
      globals: { ...globals.node },
    },
    plugins: { jsdoc },
    rules: { ...conventionRules },
  },
  {
    files: [
      "**/config/**",
      "**/constants/**",
      "**/*Config.js",
      "**/*Config.cjs",
    ],
    rules: { "no-magic-numbers": "off" },
  },
  {
    files: ["**/scripts/**", "**/vite.config.js", "eslint.config.mjs"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { ...globals.node },
    },
    rules: {
      "no-magic-numbers": "off",
      "arrow-body-style": "off",
      "func-style": "off",
      "jsdoc/require-jsdoc": "off",
      "jsdoc/require-description": "off",
    },
  },
];
