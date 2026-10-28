import { writeFile } from 'node:fs/promises';
import { test, expect } from './fixtures/canvas-page';

const ELEMENT_COUNT = 10_011;
const WARMUP_COUNT = 15;
const SAMPLE_COUNT = 90;
const P95_BUDGET_MS = 4_695;
const MUTATION_P95_BUDGET_MS = 2;

interface Measurement {
  frameCount: number;
  lastFrameMs: number;
  mutationMs: number;
}

interface BenchmarkResult {
  elementCount: number;
  warmupCount: number;
  sampleCount: number;
  samples: number[];
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
  budgetMs: number;
  mutationSamples: number[];
  mutationP50Ms: number;
  mutationP95Ms: number;
  mutationMaxMs: number;
  mutationBudgetMs: number;
  browser: { name: string; version: string };
  playwrightProject: string;
  nodeVersion: string;
  architecture: string;
  runner: { os: string; name: string };
  commit: string | null;
  timestamp: string;
}

function percentile(samples: readonly number[], percentile: number): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * percentile) - 1] ?? 0;
}

test.describe('10,000 element performance gate', () => {
  test.describe.configure({ retries: 0 });

  test('measures a live stroke update within the p95 budget', async ({ page }, testInfo) => {
    test.setTimeout(300_000);
    test.skip(
      testInfo.project.name !== 'desktop-chrome',
      'The nightly performance gate runs only desktop-chrome.',
    );

    await page.goto('/?bench=10000');
    await page.waitForSelector('#canvas canvas');
    await page.waitForFunction((count) => {
      const viewport = (window as unknown as Record<string, unknown>).__fieldnotes_viewport as
        | {
            store: { count: number; getElementsByType: (type: string) => { id: string }[] };
            getRenderStats: () => { frameCount: number };
          }
        | undefined;
      return (
        viewport?.store.count === count &&
        viewport.store.getElementsByType('stroke').length > 0 &&
        viewport.getRenderStats().frameCount > 0
      );
    }, ELEMENT_COUNT);

    const stroke = await page.evaluate(() => {
      const viewport = (window as unknown as Record<string, unknown>).__fieldnotes_viewport as {
        store: {
          getElementsByType: (type: string) => { id: string; position: { x: number } }[];
        };
      };
      const stroke = viewport.store.getElementsByType('stroke')[0];
      if (!stroke) throw new Error('The seeded board has no stroke');
      return { id: stroke.id, x: stroke.position.x };
    });

    const mutateAndMeasure = async (x: number): Promise<Measurement> =>
      page.evaluate(
        async ({ id, x }) => {
          const viewport = (window as unknown as Record<string, unknown>).__fieldnotes_viewport as {
            store: {
              getById: (id: string) => { position: { x: number; y: number } } | undefined;
              update: (id: string, partial: { position: { x: number; y: number } }) => void;
            };
            requestRender: () => void;
            getRenderStats: () => { frameCount: number; lastFrameMs: number };
          };
          const before = viewport.getRenderStats().frameCount;
          const stroke = viewport.store.getById(id);
          if (!stroke) throw new Error('The seeded stroke is missing');
          const mutationStart = performance.now();
          viewport.store.update(id, {
            position: { x, y: stroke.position.y },
          });
          const mutationMs = performance.now() - mutationStart;
          viewport.requestRender();

          return new Promise<Measurement>((resolve, reject) => {
            let frames = 0;
            const waitForFrame = (): void => {
              if (viewport.getRenderStats().frameCount > before) {
                resolve({ ...viewport.getRenderStats(), mutationMs });
                return;
              }
              frames++;
              if (frames === 120) {
                reject(new Error('Render frame did not advance within 120 animation frames'));
                return;
              }
              requestAnimationFrame(waitForFrame);
            };
            requestAnimationFrame(waitForFrame);
          });
        },
        { id: stroke.id, x },
      );

    let mutation = 0;
    const nextX = (): number => {
      mutation++;
      return mutation % 2 === 0 ? stroke.x : stroke.x + 1;
    };

    for (let i = 0; i < WARMUP_COUNT; i++) {
      await mutateAndMeasure(nextX());
    }

    const samples: number[] = [];
    const mutationSamples: number[] = [];
    for (let i = 0; i < SAMPLE_COUNT; i++) {
      const measurement = await mutateAndMeasure(nextX());
      samples.push(measurement.lastFrameMs);
      mutationSamples.push(measurement.mutationMs);
    }

    const browser = page.context().browser();
    const result: BenchmarkResult = {
      elementCount: ELEMENT_COUNT,
      warmupCount: WARMUP_COUNT,
      sampleCount: samples.length,
      samples,
      p50Ms: percentile(samples, 0.5),
      p95Ms: percentile(samples, 0.95),
      maxMs: Math.max(...samples),
      budgetMs: P95_BUDGET_MS,
      mutationSamples,
      mutationP50Ms: percentile(mutationSamples, 0.5),
      mutationP95Ms: percentile(mutationSamples, 0.95),
      mutationMaxMs: Math.max(...mutationSamples),
      mutationBudgetMs: MUTATION_P95_BUDGET_MS,
      browser: {
        name: testInfo.project.use.browserName ?? 'chromium',
        version: browser?.version() ?? 'unknown',
      },
      playwrightProject: testInfo.project.name,
      nodeVersion: process.version,
      architecture: process.arch,
      runner: {
        os: process.env.RUNNER_OS ?? process.platform,
        name: process.env.RUNNER_NAME ?? 'local',
      },
      commit: process.env.GITHUB_SHA ?? null,
      timestamp: new Date().toISOString(),
    };
    const evidencePath = testInfo.outputPath('performance-gate.json');
    await writeFile(evidencePath, JSON.stringify(result, null, 2));
    await testInfo.attach('performance-gate.json', {
      path: evidencePath,
      contentType: 'application/json',
    });

    expect(result.p95Ms).toBeLessThanOrEqual(P95_BUDGET_MS);
    expect(result.mutationP95Ms).toBeLessThanOrEqual(MUTATION_P95_BUDGET_MS);
  });
});
