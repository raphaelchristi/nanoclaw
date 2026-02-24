export const AOD_DIR = '.aod';
export const STATE_FILE = 'state.yaml';
export const BASE_DIR = '.aod/base';
export const BACKUP_DIR = '.aod/backup';
export const LOCK_FILE = '.aod/lock';
export const CUSTOM_DIR = '.aod/custom';
export const RESOLUTIONS_DIR = '.aod/resolutions';
export const SHIPPED_RESOLUTIONS_DIR = '.claude/resolutions';
export const SKILLS_SCHEMA_VERSION = '0.1.0';

// Top-level paths to include in base snapshot and upstream extraction.
// Add new entries here when new root-level directories/files need tracking.
export const BASE_INCLUDES = [
  'main.py',
  'graph.py',
  'state.py',
  'pyproject.toml',
  'langgraph.json',
  '.env.example',
  'Dockerfile',
  'docker-compose.yml',
  'config/',
];
