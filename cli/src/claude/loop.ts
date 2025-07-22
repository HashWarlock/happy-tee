import { ApiSessionClient } from "@/api/apiSession"
import { claudeRemote } from "./claudeRemote"
import { claudeLocal } from "./claudeLocal"
import { MessageQueue } from "@/utils/MessageQueue"
import { RawJSONLines } from "./types"
import { logger } from "@/ui/logger"
import { createSessionScanner } from "./scanner/sessionScanner"
import type { OnAssistantResultCallback } from "@/ui/messageFormatter"
import type { InterruptController } from "./InterruptController"

interface LoopOptions {
    path: string
    model?: string
    permissionMode?: 'auto' | 'default' | 'plan'
    startingMode?: 'interactive' | 'remote'
    mcpServers?: Record<string, any>
    permissionPromptToolName?: string
    onThinking?: (thinking: boolean) => void,
    session: ApiSessionClient
    onAssistantResult?: OnAssistantResultCallback
    interruptController?: InterruptController
}

/*
  When switching between modes or resuming sessions, we maintain a complete
  conversation history to properly deduplicate messages. This is necessary
  because Claude creates new session files when resuming with --resume,
  duplicating the conversation history in the new file.
  
  The new watcher uses full file reading and message deduplication to handle
  this correctly.
*/

export async function loop(opts: LoopOptions) {
    let mode: 'interactive' | 'remote' = opts.startingMode ?? 'interactive';
    let currentMessageQueue: MessageQueue = new MessageQueue();
    let sessionId: string | null = null;
    let onMessage: (() => void) | null = null;

    const sessionScanner = createSessionScanner({
        workingDirectory: opts.path,
        onMessage: (message) => {
            opts.session.sendClaudeSessionMessage(message);
        }
    });

    // Handle user messages
    opts.session.onUserMessage((message) => {
        sessionScanner.onRemoteUserMessageForDeduplication(message.content.text);

        currentMessageQueue.push(message.content.text);
        logger.debugLargeJson('User message pushed to queue:', message)

        if (onMessage) {
            onMessage();
        }
    });



    let onSessionFound = (newSessionId: string) => {
        sessionId = newSessionId;
        sessionScanner.onNewSession(newSessionId);
    }

    while (true) {
        // Switch to remote mode if there are messages waiting
        if (currentMessageQueue.size() > 0) {
            mode = 'remote';
            continue;
        }

        // Start local mode
        if (mode === 'interactive') {
            let abortedOutside = false;
            const interactiveAbortController = new AbortController();
            opts.session.setHandler('switch', () => {
                if (!interactiveAbortController.signal.aborted) {
                    abortedOutside = true;
                    mode = 'remote';
                    interactiveAbortController.abort();
                }
            });
            onMessage = () => {
                if (!interactiveAbortController.signal.aborted) {
                    abortedOutside = true;
                    mode = 'remote';
                    interactiveAbortController.abort();
                }
                onMessage = null;
            };
            await claudeLocal({
                path: opts.path,
                sessionId: sessionId,
                onSessionFound: onSessionFound,
                abort: interactiveAbortController.signal,
            });
            onMessage = null;
            if (!abortedOutside) {
                return;
            }
            if (mode !== 'interactive') {
                console.log('Switching to remote mode...');
            }
        }

        // Start remote mode
        if (mode === 'remote') {
            logger.debug('Starting ' + sessionId);
            const remoteAbortController = new AbortController();
            
            // Use the current queue for this session
            opts.session.setHandler('abort', () => {
                if (!remoteAbortController.signal.aborted) {
                    remoteAbortController.abort();
                }
            });
            const abortHandler = () => {
                if (!remoteAbortController.signal.aborted) {
                    mode = 'interactive';
                    remoteAbortController.abort();
                }
                if (process.stdin.isTTY) {
                    process.stdin.setRawMode(false);
                }
            };
            process.stdin.resume();
            if (process.stdin.isTTY) {
                process.stdin.setRawMode(true);
            }
            process.stdin.setEncoding("utf8");
            process.stdin.on('data', abortHandler);
            try {
                logger.debug(`Starting claudeRemote with messages: ${currentMessageQueue.size()}`);
                await claudeRemote({
                    abort: remoteAbortController.signal,
                    sessionId: sessionId,
                    path: opts.path,
                    mcpServers: opts.mcpServers,
                    permissionPromptToolName: opts.permissionPromptToolName,
                    onSessionFound: onSessionFound,
                    messages: currentMessageQueue,
                    onAssistantResult: opts.onAssistantResult,
                    interruptController: opts.interruptController
                });
            } finally {
                process.stdin.off('data', abortHandler);
                if (process.stdin.isTTY) {
                    process.stdin.setRawMode(false);
                }
                // Once we are done with this session, release the queue
                // otherwise an old watcher somehow maintains reference to it
                // and consumes our new message
                currentMessageQueue.close()
                currentMessageQueue = new MessageQueue();
            }
            if (mode !== 'remote') {
                console.log('Switching back to good old claude...');
            }
        }
    }
}
