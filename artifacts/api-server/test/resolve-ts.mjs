// Lets node:test import the API sources, which use extensionless ESM specifiers.
export async function resolve(specifier, context, nextResolve) {
  if (
    (specifier.startsWith("./") || specifier.startsWith("../")) &&
    !specifier.endsWith(".ts") &&
    !specifier.endsWith(".js") &&
    !specifier.endsWith(".mjs") &&
    !specifier.endsWith(".json")
  ) {
    try {
      return await nextResolve(`${specifier}.ts`, context);
    } catch {
      try {
        return await nextResolve(`${specifier}/index.ts`, context);
      } catch {
        // Fall through to the default resolver.
      }
    }
  }
  return nextResolve(specifier, context);
}
