import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  mergePyprojectDependencies,
  mergeRequirementsTxt,
  mergeLanggraphJson,
} from '../structured.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aod-py-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('mergePyprojectDependencies', () => {
  it('adds new dependencies to pyproject.toml', () => {
    const pyprojectPath = path.join(tmpDir, 'pyproject.toml');
    fs.writeFileSync(
      pyprojectPath,
      `[project]
name = "test-project"
version = "0.1.0"
dependencies = [
    "langgraph>=0.2.0",
    "langchain-core>=0.3.0",
]
`,
    );

    mergePyprojectDependencies(pyprojectPath, [
      'fastapi>=0.104.0',
      'uvicorn>=0.24.0',
    ]);

    const result = fs.readFileSync(pyprojectPath, 'utf-8');
    expect(result).toContain('fastapi>=0.104.0');
    expect(result).toContain('uvicorn>=0.24.0');
    expect(result).toContain('langgraph>=0.2.0');
    expect(result).toContain('langchain-core>=0.3.0');
  });

  it('deduplicates by package name', () => {
    const pyprojectPath = path.join(tmpDir, 'pyproject.toml');
    fs.writeFileSync(
      pyprojectPath,
      `[project]
name = "test"
dependencies = [
    "langgraph>=0.2.0",
]
`,
    );

    mergePyprojectDependencies(pyprojectPath, ['langgraph>=0.2.0']);

    const result = fs.readFileSync(pyprojectPath, 'utf-8');
    const matches = result.match(/langgraph/g);
    expect(matches).toHaveLength(1);
  });

  it('resolves conflicts by taking higher version', () => {
    const pyprojectPath = path.join(tmpDir, 'pyproject.toml');
    fs.writeFileSync(
      pyprojectPath,
      `[project]
name = "test"
dependencies = [
    "langgraph>=0.2.0",
]
`,
    );

    mergePyprojectDependencies(pyprojectPath, ['langgraph>=0.3.0']);

    const result = fs.readFileSync(pyprojectPath, 'utf-8');
    expect(result).toContain('langgraph>=0.3.0');
    expect(result).not.toContain('langgraph>=0.2.0');
  });

  it('sorts dependencies alphabetically', () => {
    const pyprojectPath = path.join(tmpDir, 'pyproject.toml');
    fs.writeFileSync(
      pyprojectPath,
      `[project]
name = "test"
dependencies = [
    "zod-like>=1.0.0",
    "alpha>=1.0.0",
]
`,
    );

    mergePyprojectDependencies(pyprojectPath, ['middle>=1.0.0']);

    const result = fs.readFileSync(pyprojectPath, 'utf-8');
    const alphaIdx = result.indexOf('alpha');
    const middleIdx = result.indexOf('middle');
    const zodIdx = result.indexOf('zod-like');
    expect(alphaIdx).toBeLessThan(middleIdx);
    expect(middleIdx).toBeLessThan(zodIdx);
  });
});

describe('mergeRequirementsTxt', () => {
  it('creates file if it does not exist', () => {
    const reqPath = path.join(tmpDir, 'requirements.txt');
    mergeRequirementsTxt(reqPath, ['langgraph>=0.2.0', 'fastapi>=0.104.0']);

    const result = fs.readFileSync(reqPath, 'utf-8');
    expect(result).toContain('langgraph>=0.2.0');
    expect(result).toContain('fastapi>=0.104.0');
  });

  it('deduplicates by package name', () => {
    const reqPath = path.join(tmpDir, 'requirements.txt');
    fs.writeFileSync(reqPath, 'langgraph>=0.2.0\n');

    mergeRequirementsTxt(reqPath, ['langgraph>=0.3.0']);

    const result = fs.readFileSync(reqPath, 'utf-8');
    const matches = result.match(/langgraph/g);
    expect(matches).toHaveLength(1); // Only the original
  });

  it('appends new dependencies', () => {
    const reqPath = path.join(tmpDir, 'requirements.txt');
    fs.writeFileSync(reqPath, 'langgraph>=0.2.0\n');

    mergeRequirementsTxt(reqPath, ['fastapi>=0.104.0']);

    const result = fs.readFileSync(reqPath, 'utf-8');
    expect(result).toContain('langgraph>=0.2.0');
    expect(result).toContain('fastapi>=0.104.0');
  });

  it('skips if all deps already exist', () => {
    const reqPath = path.join(tmpDir, 'requirements.txt');
    const original = 'langgraph>=0.2.0\nfastapi>=0.104.0\n';
    fs.writeFileSync(reqPath, original);

    mergeRequirementsTxt(reqPath, ['langgraph>=0.2.0']);

    const result = fs.readFileSync(reqPath, 'utf-8');
    expect(result).toBe(original);
  });
});

describe('mergeLanggraphJson', () => {
  it('creates file with graphs if it does not exist', () => {
    const lgPath = path.join(tmpDir, 'langgraph.json');
    mergeLanggraphJson(lgPath, { main: 'graph:graph' });

    const result = JSON.parse(fs.readFileSync(lgPath, 'utf-8'));
    expect(result.graphs.main).toBe('graph:graph');
  });

  it('adds new graphs to existing file', () => {
    const lgPath = path.join(tmpDir, 'langgraph.json');
    fs.writeFileSync(lgPath, JSON.stringify({ graphs: { main: 'graph:graph' } }));

    mergeLanggraphJson(lgPath, {
      carteira: 'graphs.domains.carteira.supervisor:carteira_supervisor',
    });

    const result = JSON.parse(fs.readFileSync(lgPath, 'utf-8'));
    expect(result.graphs.main).toBe('graph:graph');
    expect(result.graphs.carteira).toBe(
      'graphs.domains.carteira.supervisor:carteira_supervisor',
    );
  });

  it('does not overwrite existing graphs', () => {
    const lgPath = path.join(tmpDir, 'langgraph.json');
    fs.writeFileSync(
      lgPath,
      JSON.stringify({ graphs: { main: 'original:graph' } }),
    );

    mergeLanggraphJson(lgPath, { main: 'new:graph' });

    const result = JSON.parse(fs.readFileSync(lgPath, 'utf-8'));
    expect(result.graphs.main).toBe('original:graph');
  });
});
