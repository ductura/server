import { createHash } from "node:crypto";
import { open, readdir } from "node:fs/promises";
import { resolve } from "node:path";

import { parseDeclarationFormFile, type FormReader } from "../../database/index.ts";

const MAX_FILE_BYTES = 128_000;
const FILE_VERSION = /^([1-9][0-9]{0,9})\.json$/u;

/** Each institution publishes numbered form files in Git. The highest number is active. */
export function createFormReader(root: string): FormReader {
  return async (slug) => {
    if (!/^[a-z0-9-]{2,32}$/u.test(slug)) throw new Error("Invalid institution slug");
    const dir = resolve(root, slug, "declaration");
    let names: string[];
    try {
      names = await readdir(dir);
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return null;
      }
      throw error;
    }
    const version = Math.max(0, ...names.map((name) => Number(FILE_VERSION.exec(name)?.[1] ?? 0)));
    if (version === 0) return null;
    const handle = await open(resolve(dir, `${version}.json`), "r");
    try {
      const metadata = await handle.stat();
      if (!metadata.isFile() || metadata.size > MAX_FILE_BYTES)
        throw new Error("Invalid declaration form file");
      const bytes = await handle.readFile();
      if (bytes.length > MAX_FILE_BYTES) throw new Error("Invalid declaration form file");
      const parsed = parseDeclarationFormFile(bytes);
      if (!parsed.ok || parsed.form.formVersion !== version)
        throw new Error("Invalid declaration form file");
      return {
        file: bytes.toString("utf8"),
        form: {
          ...parsed.form,
          text: parsed.file.text,
          formSha256: createHash("sha256").update(bytes).digest("hex"),
        },
      };
    } finally {
      await handle.close();
    }
  };
}
