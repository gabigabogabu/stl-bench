import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { generateText } from 'ai';

export type GenerateOptions = {
  apiKey?: string;
  modelId?: string;
  temperature?: number;
};

export function buildSystemPrompt(): string {
  return [
    'You are an expert CAD assistant that emits valid ASCII STL files.',
    'Output only the raw ASCII STL content. Do not include code fences or commentary.',
    'Use millimeters as the implied unit. Ensure the file starts with "solid <name>" and ends with "endsolid <name>".',
    'Keep triangle count modest but sufficient to represent the described shape. Avoid degenerate triangles.',
  ].join(' ');
}

export function buildUserPrompt(description: string, solidName: string): string {
  return [
    `Generate an ASCII STL for a 3D model described as: "${description}".`,
    `Use the STL solid name: ${solidName}.`,
    'Return only the STL text. No explanations.',
  ].join('\n');
}

export function cleanStlText(raw: string): string {
  let text = raw
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter((line) => !/^```/.test(line.trim()))
    .join('\n')
    .trim();
  const startIdx = text.toLowerCase().indexOf('solid ');
  const endIdx = text.toLowerCase().lastIndexOf('endsolid');
  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    const endLineBreak = text.indexOf('\n', endIdx);
    text = text.slice(startIdx, endLineBreak === -1 ? text.length : endLineBreak).trim();
  }
  return text;
}

export async function generateAsciiStlFromDescription(description: string, solidName: string, opts: GenerateOptions = {}): Promise<string> {
  const apiKey = opts.apiKey ?? process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is required');
  const modelId = opts.modelId ?? process.env.OPENROUTER_MODEL ?? 'openai/gpt-4o-mini';
  const temperature = opts.temperature ?? 0.2;

  const openrouter = createOpenRouter({ apiKey });
  const model = openrouter(modelId);
  const system = buildSystemPrompt();
  const prompt = buildUserPrompt(description, solidName);
  const { text } = await generateText({ model, system, prompt, temperature });
  const stl = cleanStlText(text);
  return stl;
}


