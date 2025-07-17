import { spawn } from "node:child_process";
import { resolve, join, dirname } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { mkdirSync } from "node:fs";
import { watch } from "node:fs";
import { logger } from "@/ui/logger";
import { claudeCheckSession } from "./claudeCheckSession";

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function claudeLocal(opts: {
    abort: AbortSignal,
    sessionId: string | null,
    path: string,
    onSessionFound: (id: string) => void
}) {

    // Start a watcher for to detect the session id
    const projectName = resolve(opts.path).replace(/\//g, '-')
    const projectDir = join(homedir(), '.claude', 'projects', projectName);
    mkdirSync(projectDir, { recursive: true });
    const watcher = watch(projectDir);
    let resolvedSessionId: string | null = null;
    const detectedIdsRandomUUID = new Set<string>();
    const detectedIdsFileSystem = new Set<string>();
    watcher.on('change', (event, filename) => {
        if (typeof filename === 'string' && filename.toLowerCase().endsWith('.jsonl')) {
            logger.debug('change', event, filename);
            const sessionId = filename.replace('.jsonl', '');
            if (detectedIdsFileSystem.has(sessionId)) {
                return;
            }
            detectedIdsFileSystem.add(sessionId);

            // Try to match
            if (resolvedSessionId) {
                return;
            }

            // Try to match with random UUID
            if (detectedIdsRandomUUID.has(sessionId)) {
                resolvedSessionId = sessionId;
                opts.onSessionFound(sessionId);
            }
        }
    });

    // Check if session is valid
    let startFrom = opts.sessionId;
    if (opts.sessionId && !claudeCheckSession(opts.sessionId, opts.path)) {
        startFrom = null;
    }

    // Spawn the process
    try {
        // Start the interactive process
        process.stdin.pause();
        await new Promise<void>((r, reject) => {
            const args: string[] = []
            if (startFrom) {
                args.push('--resume', startFrom)
            }
            const child = spawn('node', [resolve(join(__dirname, '../scripts/interactiveLaunch.cjs')), ...args], {
                stdio: ['inherit', 'inherit', 'inherit', 'pipe'],
                signal: opts.abort,
                cwd: opts.path,
            });

            // Listen to the custom fd (fd 3) line by line
            if (child.stdio[3]) {
                const rl = createInterface({
                    input: child.stdio[3] as any,
                    crlfDelay: Infinity
                });

                rl.on('line', (line) => {
                    logger.debug('line', line);
                    const sessionMatch = line.match(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i);
                    if (sessionMatch) {
                        detectedIdsRandomUUID.add(sessionMatch[0]);

                        if (resolvedSessionId) {
                            return;
                        }

                        if (detectedIdsFileSystem.has(sessionMatch[0])) {
                            resolvedSessionId = sessionMatch[0];
                            opts.onSessionFound(sessionMatch[0]);
                        }
                    }
                });

                rl.on('error', (err) => {
                    console.error('Error reading from fd 3:', err);
                });
            }
            child.on('error', (error) => {
                // Ignore
            });
            child.on('exit', (code, signal) => {
                console.log('exit', code, signal);
                if (signal === 'SIGTERM' && opts.abort.aborted) {
                    // Normal termination due to abort signal
                    r();
                } else if (signal) {
                    reject(new Error(`Process terminated with signal: ${signal}`));
                } else {
                    r();
                }
            });
        });
    } finally {
        watcher.close();
        process.stdin.resume();
    }

    //
    // Double check that session is correct
    //

    return resolvedSessionId;
}