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

// Ensure logs directory exists
const logsDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir);
}

// Main log file
const logFile = path.join(logsDir, 'server.log');

// Clear existing log file on server start
fs.writeFileSync(logFile, `=== Server Started ${new Date().toISOString()} ===\n`);

// Internal logging function
function _writeToLog(message: string, includeConsole = true) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}\n`;
  
  // Append to log file
  fs.appendFileSync(logFile, logMessage);
  
  // Also log to console if requested
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
  
  log('error', message, errorStr, true);
}

/**
 * Create a category-specific logger
 */
export function createLogger(category: string) {
  return {
    log: (message: string, data?: any, force = false) => log(category, message, data, force),
    error: (message: string, error: Error | unknown) => logError(`[${category}] ${message}`, error)
  };
}

// Create some preset loggers
export const videoLogger = createLogger('video');
export const roomLogger = createLogger('room');
export const connectionLogger = createLogger('connection');
export const socketLogger = createLogger('socket');