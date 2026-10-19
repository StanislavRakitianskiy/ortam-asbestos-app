// Lets Node's built-in TypeScript support run scripts that import the app's own modules (`@/…` and extensionless
// relative imports, which Next.js and Vitest resolve but Node does not). Used as `node --import ./scripts/ts-hooks.mjs`.
// Only specifiers that point into this repository are rewritten; packages resolve as usual.
import { existsSync, statSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const SRC = new URL("../src/", import.meta.url);
const EXTENSIONS = [".ts", ".tsx", "/index.ts"];

const isFile = (url) => existsSync(url) && statSync(url).isFile();

/** The .ts file a specifier means, or null when it is not one of ours. */
function localFile(specifier, parentURL) {
  let base;
  if (specifier.startsWith("@/")) base = new URL(specifier.slice(2), SRC);
  else if ((specifier.startsWith("./") || specifier.startsWith("../")) && parentURL?.startsWith("file:") && !parentURL.includes("/node_modules/")) {
    base = new URL(specifier, parentURL);
  } else return null;
  if (isFile(base)) return base;
  for (const extension of EXTENSIONS) {
    const candidate = pathToFileURL(fileURLToPath(base) + extension);
    if (isFile(candidate)) return candidate;
  }
  return null;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    const file = localFile(specifier, context.parentURL);
    return file === null ? nextResolve(specifier, context) : nextResolve(file.href, context);
  },
});
