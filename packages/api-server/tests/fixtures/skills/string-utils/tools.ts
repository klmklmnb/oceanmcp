export default {
  transformString: {
    id: "transformString",
    name: "Transform String",
    description:
      "Transform a string's case or format. " +
      "Supports: uppercase, lowercase, camelCase, snake_case, kebab-case, Title Case.",
    type: "code",
    operationType: "read",
    code: `
      const { text, transform } = args;
      let result;
      switch (transform) {
        case "uppercase":
          result = text.toUpperCase();
          break;
        case "lowercase":
          result = text.toLowerCase();
          break;
        case "camelCase": {
          const words = text.replace(/[^a-zA-Z0-9]+/g, " ").trim().split(/\\s+/);
          result = words[0].toLowerCase() + words.slice(1).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join("");
          break;
        }
        case "snake_case":
          result = text.replace(/[^a-zA-Z0-9]+/g, " ").trim().split(/\\s+/).map(w => w.toLowerCase()).join("_");
          break;
        case "kebab-case":
          result = text.replace(/[^a-zA-Z0-9]+/g, " ").trim().split(/\\s+/).map(w => w.toLowerCase()).join("-");
          break;
        case "titleCase":
          result = text.replace(/[^a-zA-Z0-9]+/g, " ").trim().split(/\\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");
          break;
        default:
          return { error: "Unknown transform: " + transform };
      }
      return { original: text, transform, result };
    `,
    parameters: [
      {
        name: "text",
        type: "string",
        description: "The text to transform",
        required: true,
      },
      {
        name: "transform",
        type: "string",
        description: "Transform type to apply",
        required: true,
        enumMap: {
          uppercase: "UPPERCASE",
          lowercase: "lowercase",
          camelCase: "camelCase",
          snake_case: "snake_case",
          "kebab-case": "kebab-case",
          titleCase: "Title Case",
        },
      },
    ],
  },

  analyzeString: {
    id: "analyzeString",
    name: "Analyze String",
    description:
      "Analyze a string: count characters, words, lines, sentences, " +
      "and detect if it contains numbers, emails, or URLs.",
    type: "code",
    operationType: "read",
    code: `
      const { text } = args;
      const chars = text.length;
      const words = text.trim() ? text.trim().split(/\\s+/).length : 0;
      const lines = text.split(/\\n/).length;
      const sentences = (text.match(/[.!?]+/g) || []).length;
      const hasNumbers = /\\d/.test(text);
      const hasEmails = /[\\w.-]+@[\\w.-]+\\.\\w+/.test(text);
      const hasUrls = /https?:\\/\\/[^\\s]+/.test(text);

      return {
        characters: chars,
        words,
        lines,
        sentences,
        hasNumbers,
        hasEmails,
        hasUrls,
      };
    `,
    parameters: [
      {
        name: "text",
        type: "string",
        description: "The text to analyze",
        required: true,
      },
    ],
  },
};
