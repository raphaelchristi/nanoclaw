import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { parse, stringify } from 'yaml';

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  [key: string]: unknown;
}

interface DockerComposeFile {
  version?: string;
  services?: Record<string, unknown>;
  [key: string]: unknown;
}

function compareVersionParts(a: string[], b: string[]): number {
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const aNum = parseInt(a[i] ?? '0', 10);
    const bNum = parseInt(b[i] ?? '0', 10);
    if (aNum !== bNum) return aNum - bNum;
  }
  return 0;
}

export function areRangesCompatible(
  existing: string,
  requested: string,
): { compatible: boolean; resolved: string } {
  if (existing === requested) {
    return { compatible: true, resolved: existing };
  }

  // Both start with ^
  if (existing.startsWith('^') && requested.startsWith('^')) {
    const eParts = existing.slice(1).split('.');
    const rParts = requested.slice(1).split('.');
    if (eParts[0] !== rParts[0]) {
      return { compatible: false, resolved: existing };
    }
    // Same major — take the higher version
    const resolved =
      compareVersionParts(eParts, rParts) >= 0 ? existing : requested;
    return { compatible: true, resolved };
  }

  // Both start with ~
  if (existing.startsWith('~') && requested.startsWith('~')) {
    const eParts = existing.slice(1).split('.');
    const rParts = requested.slice(1).split('.');
    if (eParts[0] !== rParts[0] || eParts[1] !== rParts[1]) {
      return { compatible: false, resolved: existing };
    }
    // Same major.minor — take higher patch
    const resolved =
      compareVersionParts(eParts, rParts) >= 0 ? existing : requested;
    return { compatible: true, resolved };
  }

  // Mismatched prefixes or anything else (exact, >=, *, etc.)
  return { compatible: false, resolved: existing };
}

export function mergeNpmDependencies(
  packageJsonPath: string,
  newDeps: Record<string, string>,
): void {
  const content = fs.readFileSync(packageJsonPath, 'utf-8');
  const pkg: PackageJson = JSON.parse(content);

  pkg.dependencies = pkg.dependencies || {};

  for (const [name, version] of Object.entries(newDeps)) {
    // Check both dependencies and devDependencies to avoid duplicates
    const existing = pkg.dependencies[name] ?? pkg.devDependencies?.[name];
    if (existing && existing !== version) {
      const result = areRangesCompatible(existing, version);
      if (!result.compatible) {
        throw new Error(
          `Dependency conflict: ${name} is already at ${existing}, skill wants ${version}`,
        );
      }
      pkg.dependencies[name] = result.resolved;
    } else {
      pkg.dependencies[name] = version;
    }
  }

  // Sort dependencies for deterministic output
  pkg.dependencies = Object.fromEntries(
    Object.entries(pkg.dependencies).sort(([a], [b]) => a.localeCompare(b)),
  );

  if (pkg.devDependencies) {
    pkg.devDependencies = Object.fromEntries(
      Object.entries(pkg.devDependencies).sort(([a], [b]) => a.localeCompare(b)),
    );
  }

  fs.writeFileSync(
    packageJsonPath,
    JSON.stringify(pkg, null, 2) + '\n',
    'utf-8',
  );
}

export function mergeEnvAdditions(
  envExamplePath: string,
  additions: string[],
): void {
  let content = '';
  if (fs.existsSync(envExamplePath)) {
    content = fs.readFileSync(envExamplePath, 'utf-8');
  }

  const existingVars = new Set<string>();
  for (const line of content.split('\n')) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=/);
    if (match) existingVars.add(match[1]);
  }

  const newVars = additions.filter((v) => !existingVars.has(v));
  if (newVars.length === 0) return;

  if (content && !content.endsWith('\n')) content += '\n';
  content += '\n# Added by skill\n';
  for (const v of newVars) {
    content += `${v}=\n`;
  }

  fs.writeFileSync(envExamplePath, content, 'utf-8');
}

function extractHostPort(portMapping: string): string | null {
  const str = String(portMapping);
  const parts = str.split(':');
  if (parts.length >= 2) {
    return parts[0];
  }
  return null;
}

export function mergeDockerComposeServices(
  composePath: string,
  services: Record<string, unknown>,
): void {
  let compose: DockerComposeFile;

  if (fs.existsSync(composePath)) {
    const content = fs.readFileSync(composePath, 'utf-8');
    compose = (parse(content) as DockerComposeFile) || {};
  } else {
    compose = { version: '3' };
  }

  compose.services = compose.services || {};

  // Collect host ports from existing services
  const usedPorts = new Set<string>();
  for (const [, svc] of Object.entries(compose.services)) {
    const service = svc as Record<string, unknown>;
    if (Array.isArray(service.ports)) {
      for (const p of service.ports) {
        const host = extractHostPort(String(p));
        if (host) usedPorts.add(host);
      }
    }
  }

  // Add new services, checking for port collisions
  for (const [name, definition] of Object.entries(services)) {
    if (compose.services[name]) continue; // skip existing

    const svc = definition as Record<string, unknown>;
    if (Array.isArray(svc.ports)) {
      for (const p of svc.ports) {
        const host = extractHostPort(String(p));
        if (host && usedPorts.has(host)) {
          throw new Error(
            `Port collision: host port ${host} from service "${name}" is already in use`,
          );
        }
        if (host) usedPorts.add(host);
      }
    }

    compose.services[name] = definition;
  }

  fs.writeFileSync(composePath, stringify(compose), 'utf-8');
}

export function runNpmInstall(): void {
  execSync('npm install --legacy-peer-deps', { stdio: 'inherit', cwd: process.cwd() });
}

// ─── Python Support ──────────────────────────────────────────────────────────

interface PyprojectToml {
  project?: {
    dependencies?: string[];
    'optional-dependencies'?: Record<string, string[]>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

interface LanggraphJson {
  graphs?: Record<string, string>;
  [key: string]: unknown;
}

/**
 * Parse a PEP 508 dependency string to extract the package name.
 */
function parsePepPackageName(dep: string): string {
  // "langgraph>=0.2.0" → "langgraph"
  // "langchain-core[all]>=0.3.0" → "langchain-core"
  const match = dep.match(/^([a-zA-Z0-9_-]+)/);
  return match ? match[1].toLowerCase() : dep.toLowerCase();
}

/**
 * Compare PEP 440 version specifiers to take the higher minimum.
 * Simple heuristic: keeps the one with the higher version number.
 */
function resolveDepConflict(existing: string, requested: string): string {
  const existingVersion = existing.match(/>=?\s*([0-9.]+)/);
  const requestedVersion = requested.match(/>=?\s*([0-9.]+)/);

  if (!existingVersion || !requestedVersion) return existing;

  const eParts = existingVersion[1].split('.').map(Number);
  const rParts = requestedVersion[1].split('.').map(Number);

  const cmp = compareVersionParts(
    eParts.map(String),
    rParts.map(String),
  );

  return cmp >= 0 ? existing : requested;
}

/**
 * Merge Python dependencies into pyproject.toml.
 *
 * Reads [project.dependencies], deduplicates by package name,
 * and takes the higher version when conflicts arise.
 */
export function mergePyprojectDependencies(
  pyprojectPath: string,
  newDeps: string[],
): void {
  // Read raw TOML as text (we use simple regex parsing to avoid
  // needing a TOML library — the structure is predictable)
  const content = fs.readFileSync(pyprojectPath, 'utf-8');

  // Parse existing dependencies from [project.dependencies]
  const depsMatch = content.match(
    /\[project\]\s*[\s\S]*?dependencies\s*=\s*\[([\s\S]*?)\]/,
  );

  const existingDeps: string[] = [];
  if (depsMatch) {
    const depsBlock = depsMatch[1];
    for (const line of depsBlock.split('\n')) {
      const trimmed = line.trim().replace(/^["']|["'],?$/g, '');
      if (trimmed && !trimmed.startsWith('#')) {
        existingDeps.push(trimmed);
      }
    }
  }

  // Build a map of existing deps by package name
  const depMap = new Map<string, string>();
  for (const dep of existingDeps) {
    depMap.set(parsePepPackageName(dep), dep);
  }

  // Merge new deps
  for (const dep of newDeps) {
    const name = parsePepPackageName(dep);
    const existing = depMap.get(name);
    if (existing && existing !== dep) {
      depMap.set(name, resolveDepConflict(existing, dep));
    } else if (!existing) {
      depMap.set(name, dep);
    }
  }

  // Sort and format
  const sortedDeps = Array.from(depMap.values()).sort((a, b) =>
    parsePepPackageName(a).localeCompare(parsePepPackageName(b)),
  );
  const depsStr = sortedDeps.map((d) => `    "${d}",`).join('\n');

  // Replace the dependencies array in the file
  let newContent: string;
  if (depsMatch) {
    newContent = content.replace(
      /dependencies\s*=\s*\[[\s\S]*?\]/,
      `dependencies = [\n${depsStr}\n]`,
    );
  } else {
    // No dependencies section found — append after [project]
    newContent = content.replace(
      /\[project\]/,
      `[project]\ndependencies = [\n${depsStr}\n]`,
    );
  }

  fs.writeFileSync(pyprojectPath, newContent, 'utf-8');
}

/**
 * Merge dependencies into requirements.txt (append with dedup).
 */
export function mergeRequirementsTxt(
  requirementsPath: string,
  newDeps: string[],
): void {
  let content = '';
  if (fs.existsSync(requirementsPath)) {
    content = fs.readFileSync(requirementsPath, 'utf-8');
  }

  const existingNames = new Set<string>();
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      existingNames.add(parsePepPackageName(trimmed));
    }
  }

  const toAdd = newDeps.filter(
    (dep) => !existingNames.has(parsePepPackageName(dep)),
  );

  if (toAdd.length === 0) return;

  if (content && !content.endsWith('\n')) content += '\n';
  content += '\n# Added by skill\n';
  for (const dep of toAdd) {
    content += `${dep}\n`;
  }

  fs.writeFileSync(requirementsPath, content, 'utf-8');
}

/**
 * Merge graphs into langgraph.json.
 */
export function mergeLanggraphJson(
  langgraphPath: string,
  newGraphs: Record<string, string>,
): void {
  let langgraph: LanggraphJson;

  if (fs.existsSync(langgraphPath)) {
    const content = fs.readFileSync(langgraphPath, 'utf-8');
    langgraph = JSON.parse(content);
  } else {
    langgraph = {};
  }

  langgraph.graphs = langgraph.graphs || {};

  for (const [name, path] of Object.entries(newGraphs)) {
    if (!langgraph.graphs[name]) {
      langgraph.graphs[name] = path;
    }
  }

  fs.writeFileSync(
    langgraphPath,
    JSON.stringify(langgraph, null, 2) + '\n',
    'utf-8',
  );
}

/**
 * Run pip install in the project (if venv exists, uses it).
 */
export function runPipInstall(): void {
  try {
    // Try venv first
    if (fs.existsSync(path.join(process.cwd(), '.venv'))) {
      execSync('.venv/bin/pip install -e .', { stdio: 'inherit', cwd: process.cwd() });
    } else {
      execSync('pip install -e .', { stdio: 'inherit', cwd: process.cwd() });
    }
  } catch {
    // Non-fatal — user may not have a venv set up
    console.log('Warning: pip install failed. You may need to install dependencies manually.');
  }
}
