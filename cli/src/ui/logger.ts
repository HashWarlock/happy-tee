/**
 * Design decisions:
 * - Logging should be done only through file for debugging, otherwise we might disturb the claude session when in interactive mode
 * - Use info for logs that are useful to the user - this is our UI
 * - File output location: ~/.handy/logs/<date time in local timezone>.log
 */

import chalk from 'chalk'
import { appendFileSync } from 'fs'
import { configuration } from '@/configuration'
import { mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

async function getSessionLogPath(): Promise<string> {
  if (!existsSync(configuration.logsDir)) {
    await mkdir(configuration.logsDir, { recursive: true })
  }
  
  // Create timestamp in local time, filename-safe format
  const now = new Date()
  // Weird format to get a format like 2025-07-16-12-34-56
  const timestamp = now.toLocaleString('sv-SE', { 
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    year: 'numeric',
    month: '2-digit', 
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).replace(/[: ]/g, '-').replace(/,/g, '')
  
  return join(configuration.logsDir, `${timestamp}.log`)
}

class Logger {
  constructor(
    public readonly logFilePathPromise: Promise<string> = getSessionLogPath()
  ) {}

  // Use local timezone for simplicity of locating the logs,
  // in practice you will not need absolute timestamps
  localTimezoneTimestamp(): string {
    return new Date().toLocaleTimeString('en-US', { 
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      fractionalSecondDigits: 3
    })
  }

  debug(message: string, ...args: unknown[]): void {
    this.logToFile(`[${this.localTimezoneTimestamp()}]`, message, ...args)

    // NOTE: @kirill does not think its a good ideas,
    // as it will break us using claude in interactive mode.
    // Instead simply open the debug file in a new editor window.
    //
    // Also log to console in development mode
    // if (process.env.DEBUG) {
    //   this.logToConsole('debug', '', message, ...args)
    // }
  }

  debugLargeJson(
    message: string,
    object: unknown,
    maxStringLength: number = 100,
    maxArrayLength: number = 10,
  ): void {
    if (!process.env.DEBUG) {
      this.debug(`In production, skipping message inspection`)
    }

    // Some of our messages are huge, but we still want to show them in the logs
    const truncateStrings = (obj: unknown): unknown => {
      if (typeof obj === 'string') {
        return obj.length > maxStringLength 
          ? obj.substring(0, maxStringLength) + '... [truncated for logs]'
          : obj
      }
      
      if (Array.isArray(obj)) {
        const truncatedArray = obj.map(item => truncateStrings(item)).slice(0, maxArrayLength)
        if (obj.length > maxArrayLength) {
          truncatedArray.push(`... [truncated array for logs up to ${maxArrayLength} items]` as unknown)
        }
        return truncatedArray
      }
      
      if (obj && typeof obj === 'object') {
        const result: Record<string, unknown> = {}
        for (const [key, value] of Object.entries(obj)) {
          if (key === 'usage') {
            // Drop usage, not generally useful for debugging
            continue
          }
          result[key] = truncateStrings(value)
        }
        return result
      }
      
      return obj
    }

    const truncatedObject = truncateStrings(object)
    const json = JSON.stringify(truncatedObject, null, 2)
    this.logToFile(`[${this.localTimezoneTimestamp()}]`, message, '\n', json)
  }
  
  info(message: string, ...args: unknown[]): void {
    this.logToConsole('info', '', message, ...args)
    this.debug(message, args)
  }
  
  infoDeveloper(message: string, ...args: unknown[]): void {
    // Always write to debug
    this.debug(message, ...args)
    
    // Write to info if DEBUG mode is on
    if (process.env.DEBUG) {
      this.logToConsole('info', '[DEV]', message, ...args)
    }
  }
  
  private logToConsole(level: 'debug' | 'error' | 'info' | 'warn', prefix: string, message: string, ...args: unknown[]): void {
    switch (level) {
      case 'debug': {
        console.log(chalk.gray(prefix), message, ...args)
        break
      }

      case 'error': {
        console.error(chalk.red(prefix), message, ...args)
        break
      }

      case 'info': {
        console.log(chalk.blue(prefix), message, ...args)
        break
      }

      case 'warn': {
        console.log(chalk.yellow(prefix), message, ...args)
        break
      }

      default: {
        this.debug('Unknown log level:', level)
        console.log(chalk.blue(prefix), message, ...args)
        break
      }
    }
  }

  private logToFile(prefix: string, message: string, ...args: unknown[]): void {
    const logLine = `${prefix} ${message} ${args.map(arg => 
      typeof arg === 'string' ? arg : JSON.stringify(arg)
    ).join(' ')}\n`
    
    // Handle async file path
    this.logFilePathPromise
      .then(logFilePath => {
        try {
          appendFileSync(logFilePath, logLine)
        } catch (appendError) {
          if (process.env.DEBUG) {
            console.error('Failed to append to log file:', appendError)
            throw appendError
          }
          // In production, fail silently to avoid disturbing Claude session
        }
      })
      .catch(error => {
        // NOTE: We should not fall back in production because we might disturb the claude session
        // Only ever write to our stdout when in remote mode
        if (process.env.DEBUG) {
          console.log('This message only visible in DEBUG mode, not in production')
          console.error('Failed to resolve log file path:', error)
          console.log(prefix, message, ...args)
        }
      })
  }
}

// Will be initialized immideately on startup
export let logger: Logger

export function initLoggerWithGlobalConfiguration() {
  logger = new Logger()
  
  // Print debug mode message if DEBUG is on
  if (process.env.DEBUG) {
    logger.logFilePathPromise.then(logPath => {
      logger.info(chalk.yellow('[DEBUG MODE] Debug logging enabled'))
      logger.info(chalk.gray(`Log file: ${logPath}`))
    })
  }
}
