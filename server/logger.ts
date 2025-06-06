/**
 * Logger utility for server-side debugging
 * Includes throttled logging to prevent excessive output
 */

import fs from 'fs';
import path from 'path';

// Keep track of last log time for each category to throttle frequent logs
const lastLogTime: Record<string, number> = {};
const LOG_THROTTLE_MS: Record<string, number> = {
  default: 1000, // Default throttle: 1 second
  video: 5000,   // Video logs throttle: 5 seconds
  room: 1000,    // Room updates throttle: 1 second
  connection: 500, // Connection logs throttle: 500ms
  socket: 2000,  // Socket events throttle: 2 seconds
  error: 0       // Never throttle errors
};

// Store the most recent logs in memory for faster access through the API
// This avoids having to read the log file for every request
const MAX_IN_MEMORY_LOGS = 1000;
const inMemoryLogs: string[] = [];

// Ensure logs directory exists
const logsDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir);
}

// Main log file
const logFile = path.join(logsDir, 'server.log');

// Clear existing log file on server start
fs.writeFileSync(logFile, `=== Server Started ${new Date().toISOString()} ===\n`);
// Add first log to memory
inMemoryLogs.push(`=== Server Started ${new Date().toISOString()} ===`);

// Internal logging function
// Reduce log verbosity in console by only showing a small percentage of logs
// This helps keep the console clean while still logging everything to files
function _writeToLog(message: string, includeConsole = false) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}`;
  const fileLogMessage = logMessage + '\n';
  
  // Append to log file
  fs.appendFileSync(logFile, fileLogMessage);
  
  // Add to in-memory logs
  inMemoryLogs.push(logMessage);
  // Keep in-memory logs capped to avoid memory issues
  if (inMemoryLogs.length > MAX_IN_MEMORY_LOGS) {
    inMemoryLogs.shift(); // Remove oldest log
  }
  
  // Only log to console very selectively to reduce clutter
  // We always write to log files, but console output is minimal
  if (includeConsole) {
    console.log(message);
  }
}

/**
 * Log a message with throttling based on category
 */
export function log(
  category: string, 
  message: string, 
  data?: any, 
  forceLog = false,
  includeConsole = true
) {
  const now = Date.now();
  const throttleTime = LOG_THROTTLE_MS[category] || LOG_THROTTLE_MS.default;
  
  // Check if we should throttle this log
  if (
    forceLog || 
    category === 'error' || 
    !lastLogTime[category] || 
    (now - lastLogTime[category] > throttleTime)
  ) {
    // Format the log message
    let logMessage = `[${category.toUpperCase()}] ${message}`;
    
    // Add data if provided
    if (data) {
      try {
        // Only stringify if it's not already a string
        const dataStr = typeof data === 'string' 
          ? data 
          : JSON.stringify(data, null, 2);
        
        // Keep data logs compact for simple objects
        if (dataStr.length < 100) {
          logMessage += `: ${dataStr}`;
        } else {
          logMessage += `:\n${dataStr}`;
        }
      } catch (err) {
        logMessage += ` (data could not be stringified: ${err})`;
      }
    }
    
    // Write to log file
    _writeToLog(logMessage, includeConsole);
    
    // Update last log time for this category
    lastLogTime[category] = now;
  }
}

/**
 * Log an error with stack trace
 */
export function logError(message: string, error: Error | unknown) {
  let errorStr = 'Unknown error';
  
  if (error instanceof Error) {
    errorStr = `${error.name}: ${error.message}\n${error.stack || 'No stack trace'}`;
  } else if (error) {
    try {
      errorStr = JSON.stringify(error);
    } catch (e) {
      errorStr = String(error);
    }
  }
  
  // Always show errors in console (true for includeConsole)
  log('error', message, errorStr, true, true);
}

/**
 * Create a category-specific logger
 */
export function createLogger(category: string) {
  // Default console output to false for most messages - they'll still be written to log files
  // Only errors will be shown in console to keep it clean
  return {
    log: (message: string, data?: any, force = false) => log(category, message, data, force, false),
    error: (message: string, error: Error | unknown) => logError(`[${category}] ${message}`, error)
  };
}

/**
 * Get the recent logs from memory
 * @param limit Number of logs to retrieve (defaults to all in-memory logs)
 * @param filter Optional filter string to find specific logs
 */
export function getRecentLogs(limit = MAX_IN_MEMORY_LOGS, filter?: string): string[] {
  if (filter) {
    const filterLower = filter.toLowerCase();
    const filtered = inMemoryLogs.filter(log => log.toLowerCase().includes(filterLower));
    return filtered.slice(-limit);
  }
  return inMemoryLogs.slice(-limit);
}

/**
 * Get logs from file with more options
 * @param options Optional parameters for retrieving logs
 */
export function getLogsFromFile(options: {
  limit?: number;
  filter?: string;
  tail?: boolean; // If true, returns the last N lines
} = {}): string[] {
  try {
    const { limit = 1000, filter, tail = true } = options;
    
    // Read the file
    const content = fs.readFileSync(logFile, 'utf8');
    const lines = content.split('\n').filter(line => line.trim());
    
    // Apply filters
    let result = lines;
    if (filter) {
      const filterLower = filter.toLowerCase();
      result = result.filter(line => line.toLowerCase().includes(filterLower));
    }
    
    // Apply tail or head
    if (tail) {
      return result.slice(-limit);
    } else {
      return result.slice(0, limit);
    }
  } catch (error) {
    console.error('Error reading log file:', error);
    return ['Error reading log file'];
  }
}

// Create some preset loggers
export const videoLogger = createLogger('video');
export const roomLogger = createLogger('room');
export const connectionLogger = createLogger('connection');
export const socketLogger = createLogger('socket');