import { createHash } from "node:crypto";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, relative } from "node:path";

export function testFingerprint(root = process.cwd()) {
  const files = [];
  function visit(directory) {
    if (!existsSync(resolve(root, directory))) return;
    for (const entry of readdirSync(resolve(root, directory), {
      withFileTypes: true,
    })) {
      const path = directory + "/" + entry.name;
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && !/^docs\/api-test-/.test(path))
        files.push(path);
    }
  }
  for (const directory of ["src", "tests", "scripts", "examples", "docs"])
    visit(directory);
  files.push(
    "package.json",
    "package-lock.json",
    "tsconfig.json",
    ".c8rc.json",
  );
  const hash = createHash("sha256");
  for (const file of files.sort())
    hash
      .update(relative(root, resolve(root, file)).replaceAll("\\", "/"))
      .update("\0")
      .update(readFileSync(resolve(root, file)))
      .update("\0");
  return hash.digest("hex");
}
