import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import yargs from 'yargs/yargs';
import { hideBin } from 'yargs/helpers';

import { parseAsciiStl, aabbOfTriangles, aabbIou, surfaceArea, signedVolume, sampleSurfacePoints, chamferDistance, aabbDiagonal } from './stl_utils';
import { generateAsciiStlFromDescription } from './generate_stl';

type Metrics = {
  aabbIou: number;
  surfaceAreaRatio: number;
  volumeRatio: number;
  chamfer: {
    meanAB: number; meanBA: number; p95AB: number; p95BA: number; maxAB: number; maxBA: number;
  };
};

type BenchResult = Metrics & {
  modelDir: string;
  file: string;
};

async function readAsciiStlFile(filePath: string): Promise<string> {
  return await readFile(filePath, 'utf8');
}

async function generateAsciiStl(description: string, solidName: string, modelId: string): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is required');
  return await generateAsciiStlFromDescription(description, solidName, { apiKey, modelId, temperature: 0.2 });
}

async function compareAsciiStlText(srcText: string, genText: string): Promise<Metrics> {
  const srcTris = parseAsciiStl(srcText);
  const genTris = parseAsciiStl(genText);

  const aabbSrc = aabbOfTriangles(srcTris);
  const aabbGen = aabbOfTriangles(genTris);
  const iou = aabbIou(aabbSrc, aabbGen);

  const areaSrc = surfaceArea(srcTris);
  const areaGen = surfaceArea(genTris);
  const volSrc = Math.abs(signedVolume(srcTris));
  const volGen = Math.abs(signedVolume(genTris));

  const sampleN = 2000;
  const ptsSrc = sampleSurfacePoints(srcTris, sampleN);
  const ptsGen = sampleSurfacePoints(genTris, sampleN);
  const chamfer = chamferDistance(ptsSrc, ptsGen);

  // Normalize distances by overall scale (AABB diagonal) for comparability
  const diag = Math.max(1e-9, Math.max(aabbDiagonal(aabbSrc), aabbDiagonal(aabbGen)));
  const scaledChamfer = {
    meanAB: chamfer.meanAB / diag,
    meanBA: chamfer.meanBA / diag,
    p95AB: chamfer.p95AB / diag,
    p95BA: chamfer.p95BA / diag,
    maxAB: chamfer.maxAB / diag,
    maxBA: chamfer.maxBA / diag,
  };

  return {
    aabbIou: iou,
    surfaceAreaRatio: areaGen > 0 && areaSrc > 0 ? Math.min(areaGen, areaSrc) / Math.max(areaGen, areaSrc) : 0,
    volumeRatio: volGen > 0 && volSrc > 0 ? Math.min(volGen, volSrc) / Math.max(volGen, volSrc) : 0,
    chamfer: scaledChamfer,
  };
}

async function run(): Promise<void> {
  const argv = yargs(hideBin(process.argv))
    .scriptName('bench')
    .usage('Usage: $0 [options]')
    .option('downloads', { type: 'string', default: 'downloads', describe: 'Downloads root folder' })
    .option('pattern', { type: 'string', default: '*', describe: 'Folder name substring filter' })
    .option('model', { type: 'string', default: 'x-ai/grok-4-fast:free', describe: 'OpenRouter model id' })
    .option('limit', { type: 'number', default: 3, describe: 'Max folders to process' })
    .option('samples', { type: 'number', default: 2000, describe: 'Surface sample count per mesh' })
    .strict()
    .help('h')
    .alias('h', 'help')
    .parseSync();

  const root = String(argv.downloads);
  const filter = String(argv.pattern).toLowerCase();
  const modelId = String(argv.model);

  const entries = await readdir(root, { withFileTypes: true });
  const dirs = entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((name: string) => (filter === '*' ? true : name.toLowerCase().includes(filter)))
    .slice(0, Number(argv.limit));

  const results: BenchResult[] = [];
  for (const dir of dirs) {
    const dirPath = path.join(root, dir);
    const metadataPath = path.join(dirPath, 'metadata.json');
    let meta: any = null;
    try {
      meta = JSON.parse(await readFile(metadataPath, 'utf8'));
    } catch {}

    const files = await readdir(dirPath);
    const stlFiles = files.filter((f) => f.toLowerCase().endsWith('.stl'));
    if (stlFiles.length === 0) continue;

    const srcFile = stlFiles[0]!;
    const srcPath = path.join(dirPath, srcFile);
    const description = meta?.description || meta?.summary || dir;
    const solidName = path.parse(srcPath).name;

    const srcText = await readAsciiStlFile(srcPath);
    const genText = await generateAsciiStl(description, solidName, modelId);

    const cmp = await compareAsciiStlText(srcText, genText);
    results.push({ modelDir: dir, file: srcFile, ...cmp });

    console.log(`[bench] ${dir}`);
    console.log(`  AABB IoU: ${cmp.aabbIou.toFixed(4)}`);
    console.log(`  Surface area ratio: ${cmp.surfaceAreaRatio.toFixed(4)}`);
    console.log(`  Volume ratio: ${cmp.volumeRatio.toFixed(4)}`);
    console.log(`  Chamfer meanAB/meanBA: ${cmp.chamfer.meanAB.toFixed(4)} / ${cmp.chamfer.meanBA.toFixed(4)}`);
    console.log(`  Chamfer p95AB/p95BA: ${cmp.chamfer.p95AB.toFixed(4)} / ${cmp.chamfer.p95BA.toFixed(4)}`);
  }

  // Optionally: write results to JSON for later analysis
  await Bun.write('bench_results.json', JSON.stringify({ results }, null, 2));
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
