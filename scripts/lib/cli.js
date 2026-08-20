/**
 * Shared CLI utilities for physics book scripts.
 *
 * This module provides consistent command-line argument parsing
 * and help text generation across all scripts.
 */

const EXIT_CODES = { SUCCESS: 0, FAILURE: 1 };
import { printHelp } from './reporter.js';

/**
 * Parse command-line arguments.
 * @param {Array<string>} args - process.argv.slice(2)
 * @param {Object} config - Configuration for parsing
 * @returns {Object} - Parsed options
 */
export function parseArgs(args, config = {}) {
  const { flags = {}, positional = null, defaultDirectory = 'contents' } = config;

  const options = {
    // Set defaults from flags config
    ...Object.fromEntries(Object.entries(flags).map(([key, def]) => [key, def.default ?? false])),
  };

  // Parse flags
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    // Check known flags
    for (const [key, def] of Object.entries(flags)) {
      const flagNames = Array.isArray(def.flag) ? def.flag : [def.flag];

      if (flagNames.includes(arg)) {
        if (def.type === 'string' || def.type === 'number') {
          // Value-taking flag
          const value = args[i + 1];
          if (value && !value.startsWith('-')) {
            options[key] = def.type === 'number' ? parseInt(value, 10) : value;
            i++;
          }
        } else if (def.type === 'array') {
          // Comma-separated values
          const value = args[i + 1];
          if (value && !value.startsWith('-')) {
            options[key] = value.split(',').map(s => s.trim());
            i++;
          }
        } else {
          // Boolean flag
          options[key] = true;
        }
        break;
      }
    }

    // Collect positional argument (directory)
    if (!arg.startsWith('-') && positional !== false) {
      options.directory = arg;
    }
  }

  // Set default directory if not specified
  if (!options.directory) {
    options.directory = defaultDirectory;
  }

  return options;
}

/**
 * Check if help flag is present.
 * @param {Array<string>} args - process.argv.slice(2)
 * @returns {boolean}
 */
export function hasHelpFlag(args) {
  return args.includes('--help') || args.includes('-h');
}

/**
 * Handle the standard CLI workflow.
 * @param {Object} config - CLI configuration
 * @returns {Promise<void>}
 */
export async function runCli(config) {
  const {
    name,
    description,
    flags = {},
    examples = [],
    run,
    defaultDirectory = 'contents',
  } = config;

  const args = process.argv.slice(2);

  // Handle help flag
  if (hasHelpFlag(args)) {
    const flagOptions = Object.entries(flags).map(([_key, def]) => ({
      flag: Array.isArray(def.flag) ? def.flag.join(', ') : def.flag,
      description: def.description,
    }));

    // Always add help flag
    flagOptions.push({
      flag: '--help, -h',
      description: 'Show this help message',
    });

    printHelp({
      usage: `node scripts/${name}.js [options] [directory]`,
      description,
      options: flagOptions,
      examples,
    });

    process.exit(EXIT_CODES.SUCCESS);
  }

  // Parse arguments
  const options = parseArgs(args, { flags, defaultDirectory });

  // Run the script
  try {
    const success = await run(options);
    process.exit(success ? EXIT_CODES.SUCCESS : EXIT_CODES.FAILURE);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(EXIT_CODES.FAILURE);
  }
}

/**
 * Standard flag definitions used across scripts.
 */
export const STANDARD_FLAGS = {
  strict: {
    flag: '--strict',
    description: 'Enable stricter validation',
    default: false,
  },
  apply: {
    flag: '--apply',
    description: 'Apply fixes to files (default is dry run)',
    default: false,
  },
  fix: {
    flag: '--fix',
    description: 'Apply fixes to files (default is dry run)',
    default: false,
  },
  dryRun: {
    flag: '--dry-run',
    description: 'Preview changes without modifying files',
    default: false,
  },
  verbose: {
    flag: ['-v', '--verbose'],
    description: 'Show verbose output',
    default: false,
  },
  quiet: {
    flag: ['-q', '--quiet'],
    description: 'Suppress non-essential output',
    default: false,
  },
};

/**
 * Create a combined check+fix script configuration.
 * @param {Object} baseFlags - Base flags for the script
 * @returns {Object} - Combined flags with mode detection
 */
export function createCheckFixFlags(baseFlags = {}) {
  return {
    check: {
      flag: '--check',
      description: 'Run in check mode only (no fixes)',
      default: false,
    },
    fix: {
      flag: '--fix',
      description: 'Apply fixes to files',
      default: false,
    },
    strict: STANDARD_FLAGS.strict,
    ...baseFlags,
  };
}

/**
 * Determine the mode based on parsed options.
 * @param {Object} options - Parsed options
 * @returns {'check' | 'fix' | 'both'}
 */
export function getMode(options) {
  if (options.fix && !options.check) {
    return 'fix';
  }
  if (options.check && !options.fix) {
    return 'check';
  }
  // Default: check only (unless --fix is explicitly provided)
  return options.fix ? 'both' : 'check';
}
