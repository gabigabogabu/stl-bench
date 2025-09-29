// https://www.printables.com/model?ordering=makes&period=all-time
import yargs from "yargs/yargs";
import { binaryStlToAscii, isBinaryStl } from "./bin2ascii";
import { mkdir as nodeMkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";

type ModelFile = {
  filename: string;
  url: string;
  description?: string;
  title?: string;
  savedAt?: string;
};

type ModelDetails = {
  modelUrl: string;
  title: string;
  description: string;
  summary: string;
  files: ModelFile[];
};

const BASE = "https://www.printables.com";
const API_URL = "https://api.printables.com/graphql/";
const FILES_ROOT = "https://files.printables.com";
const CLIENT_UID = randomUUID();

type Stl = { id: string; name: string; folder?: string | null; note?: string | null; fileSize?: number | null; filePreviewPath?: string | null; order?: number | null };
type GraphQLResponse<T> = { data?: T; errors?: Array<{ message?: string }> };
const PREVIEW_DIR_REGEX = /(?:^|\/)(media\/prints\/[0-9]+\/stls\/[^/]+\/)/;

function parseModelIdFromUrl(modelUrl: string): string | null {
  try {
    const u = new URL(modelUrl);
    const parts = u.pathname.split("/").filter(Boolean);
    const last = parts[parts.length - 1] || "";
    const firstSeg = last.split("-")[0] || "";
    return firstSeg && /^\d+$/.test(firstSeg) ? firstSeg : null;
  } catch {
    return null;
  }
}

// slug parsing not needed when using ID-only lookups

function sanitizeFilename(name: string): string {
  return name
    .replace(/[\u0000-\u001f]/g, " ")
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

// (no HTML fetching)

async function graphqlRequest<T>(query: string, variables: Record<string, unknown>, headers: Record<string, string>): Promise<T> {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/graphql-response+json, application/graphql+json, application/json",
      "accept-language": "en",
      "graphql-client-version": "v2.2.2",
      "client-uid": CLIENT_UID,
      origin: BASE,
      dnt: "1",
      "user-agent": "Mozilla/5.0 (compatible; stl-bench/1.0)",
      ...headers,
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`GraphQL request failed: ${res.status}`);
  const obj = (await res.json()) as GraphQLResponse<T>;
  const errs = Array.isArray(obj.errors) ? obj.errors : [];
  if (errs.length) throw new Error(`GraphQL errors: ${JSON.stringify(errs)}`);
  return (obj.data ?? ({} as T)) as T;
}

async function fetchPopularModelsGraphQL(limit: number, headers: Record<string, string>): Promise<string[]> {
  const query = `query ModelList($limit: Int!, $cursor: String, $ordering: String) { models: morePrints(limit: $limit, cursor: $cursor, ordering: $ordering) { cursor items { id slug name } } }`;
  type Gql = { models: { cursor: string | null; items: Array<{ id: string; slug: string; name: string }>; } };
  const data = await graphqlRequest<Gql>(query, { limit, cursor: null, ordering: "-makes_count" }, headers);
  return (data.models.items || []).map((it) => `${BASE}/model/${it.id}-${it.slug}`);
}

async function fetchModelDetailGraphQL(id: string, headers: Record<string, string>, referer?: string): Promise<{ title: string; description: string; summary: string; } | null> {
  const mergedHeaders = referer ? { ...headers, referer } : headers;

  const tryOne = async (rootField: "print" | "model" | "printable", idKind: "ID" | "Int"): Promise<{ title: string; description: string; summary: string } | null> => {
    const query = `query ModelDetail_${rootField}_${idKind}($id: ${idKind}!) { model: ${rootField}(id: $id) { name description summary } }`;
    const variables = idKind === "Int" ? { id: Number(id) } : { id };
    if (idKind === "Int" && !Number.isFinite((variables as { id: number }).id)) return null;
    try {
      type Gql = { model?: { name?: string; description?: string; summary?: string } };
      const data = await graphqlRequest<Gql>(query, variables as Record<string, unknown>, mergedHeaders);
      if (!data || !data.model) return null;
      return {
        title: String(data.model.name || ""),
        description: String(data.model.description || ""),
        summary: String(data.model.summary || ""),
      };
    } catch {
      return null;
    }
  };

  const attempts: Array<["print" | "model" | "printable", "ID" | "Int"]> = [
    ["print", "ID"],
    ["print", "Int"],
    ["model", "ID"],
    ["model", "Int"],
    ["printable", "ID"],
    ["printable", "Int"],
  ];

  for (const [root, kind] of attempts) {
    const got = await tryOne(root, kind);
    if (got) return got;
  }
  return null;
}

function stlsToModelFiles(stls: Stl[] | undefined, debug: boolean): ModelFile[] {
  if (!stls || stls.length === 0) return [];
  const files: ModelFile[] = [];
  let idx = 0;
  for (const s of stls) {
    const name = String(s.name || "").trim();
    if (debug && idx < 8) {
      const pv = String(s.filePreviewPath || "");
      console.log(`      [GQL file ${idx}] name='${name}' endsWithStl=${name.toLowerCase().endsWith(".stl")} previewPath='${pv.slice(0, 96)}${pv.length > 96 ? "…" : ""}'`);
    }
    if (!name.toLowerCase().endsWith(".stl")) { idx++; continue; }
    const preview = String(s.filePreviewPath || "");
    const m = preview.match(PREVIEW_DIR_REGEX);
    if (!m || typeof m[1] !== "string") {
      if (debug && idx < 8) console.log(`        ↪ preview regex miss for name='${name}' preview='${preview}'`);
      idx++;
      continue;
    }
    const baseRel = m[1].replace(/^\/+/, "");
    const url = `${FILES_ROOT}/${baseRel}${name}`;
    if (debug && idx < 8) console.log(`        ↪ url='${url}'`);
    files.push({ filename: sanitizeFilename(name), url, title: name.replace(/\.stl$/i, ""), description: s.note || undefined });
    idx++;
  }
  return files;
}

async function fetchModelFilesGraphQL(id: string, headers: Record<string, string>, referer?: string, debug: boolean = false): Promise<ModelFile[]> {
  const mergedHeaders = referer ? { ...headers, referer } : headers;

  type Gql = { model?: { id: string; filesType?: string; stls?: Stl[] } };

  const tryOne = async (rootField: "print" | "model" | "printable", idKind: "ID" | "Int"): Promise<ModelFile[] | null> => {
    const query = `query ModelFiles_${rootField}_${idKind}($id: ${idKind}!) { model: ${rootField}(id: $id) { id filesType stls { id name folder note fileSize filePreviewPath order } } }`;
    const variables = idKind === "Int" ? { id: Number(id) } : { id };
    if (idKind === "Int" && !Number.isFinite((variables as { id: number }).id)) return null;
    try {
      const data = await graphqlRequest<Gql>(query, variables as Record<string, unknown>, mergedHeaders);
      if (debug) {
        const filesType = data?.model?.filesType;
        const numStls = (data?.model?.stls || []).length;
        console.log(`    [GQL ${rootField}/${idKind}] filesType=${String(filesType)} stls=${numStls}`);
      }
      const files = stlsToModelFiles(data?.model?.stls, debug);
      if (files.length === 0) return null;
      return files;
    } catch {
      return null;
    }
  };


  const attempts: Array<["print" | "model" | "printable", "ID" | "Int"]> = [
    ["print", "ID"],
    ["print", "Int"],
    ["model", "ID"],
    ["model", "Int"],
    ["printable", "ID"],
    ["printable", "Int"],
  ];

  for (const [root, kind] of attempts) {
    const files = await tryOne(root, kind);
    if (files && files.length > 0) return files;
  }
  return [];
}

async function ensureDir(path: string): Promise<void> {
  await nodeMkdir(path, { recursive: true });
}

async function writeJson(path: string, data: unknown): Promise<void> {
  const json = JSON.stringify(data, null, 2);
  await Bun.write(path, json);
}

async function downloadToFile(url: string, destFilePath: string, init?: RequestInit): Promise<void> {
  const res = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; stl-bench/1.0; +https://example.invalid)",
      ...(init?.headers || {}),
    },
    redirect: "follow",
    ...init,
  });
  if (!res.ok) throw new Error(`Failed to download ${url}: ${res.status}`);
  const arr = new Uint8Array(await res.arrayBuffer());
  await Bun.write(destFilePath, arr);
}

type CliOptions = {
  count: number;
  outDir: string;
  cookie?: string;
  maxFilesPerModel: number; // -1 for all
  precision: number;
  debug: boolean;
};

function parseArgs(argv: string[]): CliOptions {
  const y = yargs(argv)
    .scriptName("download_stls")
    .usage("Usage: $0 [options]")
    .option("count", { type: "number", default: 2, describe: "Number of models" })
    .option("out", { type: "string", default: "downloads", describe: "Output directory" })
    .option("cookie", { type: "string", describe: "Cookie header to include" })
    .option("maxFilesPerModel", { type: "string", default: "1", describe: "Max files per model or 'all'" })
    .option("precision", { type: "number", default: 6, describe: "ASCII float precision (0..12)" })
    .option("debug", { type: "boolean", default: false, describe: "Enable verbose debug logging" })
    .strict()
    .help("h")
    .alias("h", "help");

  const parsed = y.parseSync();
  const count = Number(parsed.count);
  const outDir = String(parsed.out);
  const cookie = parsed.cookie ? String(parsed.cookie) : undefined;
  const maxFilesPerModelRaw = String(parsed.maxFilesPerModel);
  const maxFilesPerModel = maxFilesPerModelRaw === "all" ? -1 : Number(maxFilesPerModelRaw);
  const precision = Math.max(0, Math.min(12, Number(parsed.precision)));
  const debug = Boolean(parsed.debug);
  return { count, outDir, cookie, maxFilesPerModel, precision, debug };
}

export async function run(): Promise<void> {
  const opts = parseArgs(Bun.argv.slice(2));
  const headers: Record<string, string> = {};
  if (opts.cookie) headers["cookie"] = opts.cookie;

  console.log(`[stl-bench] Starting run`);
  console.log(`  count=${opts.count} outDir=${opts.outDir} maxFilesPerModel=${opts.maxFilesPerModel} precision=${opts.precision}`);
  if (opts.debug) console.log(`  debug=true`);

  let modelUrls: string[] = [];
  console.log(`[stl-bench] Fetching popular models via GraphQL`);
  modelUrls = await fetchPopularModelsGraphQL(opts.count, headers);
  console.log(`[stl-bench] Found ${modelUrls.length} model URLs`);

  await ensureDir(opts.outDir);

  let i = 0;
  for (const modelUrl of modelUrls) {
    console.log(`[stl-bench] [${i + 1}/${modelUrls.length}] Model: ${modelUrl}`);
    try {
      // Fetch model detail via GraphQL only
      let details: ModelDetails | null = null;
      const id = parseModelIdFromUrl(modelUrl);
      if (id) {
        const gql = await fetchModelDetailGraphQL(id, headers, modelUrl);
        if (gql) {
          details = {
            modelUrl,
            title: gql.title,
            description: gql.description,
            summary: gql.summary,
            files: [],
          };
        }
      }
      if (!details) throw new Error("Missing model details from GraphQL");
      console.log(`  Title: ${details.title}`);

      const modelFolderName = sanitizeFilename(details.title || modelUrl.split("/").pop() || `model-${i + 1}`);
      const modelDir = `${opts.outDir}/${modelFolderName}`;
      await ensureDir(modelDir);
      console.log(`  Output dir: ${modelDir}`);

      let files = details.files;
      if (files.length === 0 && id) {
        const gqlFiles = await fetchModelFilesGraphQL(id, headers, modelUrl, opts.debug);
        files = gqlFiles;
        console.log(`  Files from GraphQL: ${files.length}`);
        if (opts.debug && files.length === 0) {
          console.log(`    No .stl files resolved via GraphQL for id=${id}`);
        }
      }

      files = opts.maxFilesPerModel === -1 ? files : files.slice(0, Math.max(0, opts.maxFilesPerModel));
      const downloaded: ModelFile[] = [];
      for (const f of files) {
        const dest = `${modelDir}/${f.filename}`;
        try {
          if (await Bun.file(dest).exists()) {
            console.log(`    ↩ Skipping (already exists): ${f.filename}`);
            downloaded.push({ ...f });
            continue;
          }
          console.log(`    ↓ Downloading: ${f.filename}`);
          await downloadToFile(f.url, dest, { headers });
          // Always convert binary STL to ASCII when needed
          if (/\.stl$/i.test(dest)) {
            const buf = await Bun.file(dest).arrayBuffer();
            if (isBinaryStl(buf)) {
              console.log(`    ↻ Converting binary → ASCII: ${f.filename}`);
              const solidName = f.title ?? f.filename.replace(/\.stl$/i, "");
              const ascii = binaryStlToAscii(buf, solidName, Math.max(0, Math.min(12, opts.precision)));
              await Bun.write(dest, ascii);
            } else {
              console.log(`    ✔ Already ASCII: ${f.filename}`);
            }
          }
          downloaded.push({ ...f, savedAt: new Date().toISOString() });
        } catch (err) {
          console.warn(`    ⚠ Failed file ${f.filename}:`, err instanceof Error ? err.message : String(err));
        }
      }

      const metadata: ModelDetails = {
        modelUrl,
        title: details.title,
        description: details.description,
        summary: details.summary,
        files: downloaded,
      };
      await writeJson(`${modelDir}/metadata.json`, metadata);
      console.log(`  Wrote metadata.json (${downloaded.length} file(s))`);
    } catch (err) {
      console.warn(`  ⚠ Failed model:`, err instanceof Error ? err.message : String(err));
    }
    i++;
  }
  console.log(`[stl-bench] Done.`);
}

if (import.meta.main) {
  run().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}