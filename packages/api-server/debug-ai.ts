import * as ai from "ai";

console.log("--- AI Package Exports ---");
const exports = Object.keys(ai);
console.log(
  "convertToCoreMessages:",
  exports.includes("convertToCoreMessages"),
);
console.log("streamText:", exports.includes("streamText"));
console.log(
  "createDataStreamResponse:",
  exports.includes("createDataStreamResponse"),
);
console.log("Message:", exports.includes("Message"));
console.log("CoreMessage:", exports.includes("CoreMessage")); // Type export won't show up in runtime unless emitted? No, types don't show up.

// Check prototype of streamText result?
// We need to call it to see result shape, but that requires model provider setup.
// We can just inspect the type definition file location.
console.log("--- End ---");
