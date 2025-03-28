import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { getRecentLogs, getLogsFromFile } from "./logger";

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});

// Add logs endpoint
app.get("/logs", (req, res) => {
  const limit = req.query.limit ? parseInt(req.query.limit as string) : 1000;
  const filter = req.query.filter as string | undefined;
  const source = req.query.source === 'file' ? 'file' : 'memory';
  
  // Get logs from memory (faster) or file (more complete)
  const logs = source === 'file' 
    ? getLogsFromFile({ limit, filter }) 
    : getRecentLogs(limit, filter);
  
  // Check if JSON format was requested
  if (req.query.format === 'json') {
    return res.json({ logs });
  }
  
  // Otherwise return HTML view
  const htmlContent = `
  <!DOCTYPE html>
  <html>
    <head>
      <title>Mafia Webcam Logs</title>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        body {
          font-family: monospace;
          margin: 0;
          padding: 20px;
          background-color: #1e1e1e;
          color: #ddd;
        }
        .header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 20px;
          flex-wrap: wrap;
        }
        .title {
          font-size: 24px;
          margin: 0;
        }
        .controls {
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
        }
        input, select, button {
          padding: 8px;
          border-radius: 4px;
          border: 1px solid #444;
          background-color: #2d2d2d;
          color: #ddd;
        }
        button {
          cursor: pointer;
          background-color: #0e639c;
        }
        button:hover {
          background-color: #1177bb;
        }
        .log-container {
          background-color: #252525;
          border-radius: 4px;
          border: 1px solid #444;
          padding: 10px;
          max-height: calc(100vh - 150px);
          overflow-y: auto;
          white-space: pre-wrap;
        }
        .log-line {
          margin: 0;
          padding: 3px 0;
          border-bottom: 1px solid #333;
        }
        .log-line:hover {
          background-color: #2a2a2a;
        }
        .highlight {
          background-color: #48473a;
        }
        .error {
          color: #ff6b6b;
        }
        .warning {
          color: #ffaf4f;
        }
        .success {
          color: #6bff6b;
        }
        .mafiaroom {
          color: #6bc5ff;
        }
        .signaling {
          color: #d69aff;
        }
        .mediasoup {
          color: #ffdb72;
        }
        .auto-refresh {
          display: flex;
          align-items: center;
          gap: 6px;
          margin-top: 10px;
        }
      </style>
    </head>
    <body>
      <div class="header">
        <h1 class="title">Mafia Webcam Server Logs</h1>
        <div class="controls">
          <input type="text" id="filter" placeholder="Filter logs..." value="${filter || ''}">
          <select id="source">
            <option value="memory" ${source === 'memory' ? 'selected' : ''}>In-Memory (faster)</option>
            <option value="file" ${source === 'file' ? 'selected' : ''}>From File (complete)</option>
          </select>
          <input type="number" id="limit" placeholder="Limit" value="${limit}" min="10" max="5000">
          <button id="refresh">Refresh</button>
        </div>
      </div>
      
      <div class="log-container" id="logs">
        ${logs.map(log => {
          let className = 'log-line';
          
          // Color-code by type
          if (log.includes('[ERROR]')) className += ' error';
          else if (log.includes('[MAFIAROOM]')) className += ' mafiaroom';
          else if (log.includes('[SIGNALING]')) className += ' signaling';
          else if (log.includes('[MEDIASOUP]')) className += ' mediasoup';
          
          // Highlight filtered content
          if (filter && log.toLowerCase().includes(filter.toLowerCase())) {
            className += ' highlight';
          }
          
          return `<div class="${className}">${log}</div>`;
        }).join('')}
      </div>
      
      <div class="auto-refresh">
        <input type="checkbox" id="autoRefresh">
        <label for="autoRefresh">Auto-refresh every</label>
        <input type="number" id="refreshInterval" value="5" min="1" max="60" style="width: 60px">
        <label for="refreshInterval">seconds</label>
      </div>
      
      <script>
        // Log filtering and refresh
        let autoRefreshTimer = null;
        
        function refreshLogs() {
          const filter = document.getElementById('filter').value;
          const source = document.getElementById('source').value;
          const limit = document.getElementById('limit').value;
          
          // Build URL with query parameters
          let url = '/logs?format=json';
          if (filter) url += \`&filter=\${encodeURIComponent(filter)}\`;
          if (source) url += \`&source=\${source}\`;
          if (limit) url += \`&limit=\${limit}\`;
          
          // Fetch logs
          fetch(url)
            .then(response => response.json())
            .then(data => {
              const logsContainer = document.getElementById('logs');
              logsContainer.innerHTML = '';
              
              data.logs.forEach(log => {
                let className = 'log-line';
                
                // Color-code by type
                if (log.includes('[ERROR]')) className += ' error';
                else if (log.includes('[MAFIAROOM]')) className += ' mafiaroom';
                else if (log.includes('[SIGNALING]')) className += ' signaling';
                else if (log.includes('[MEDIASOUP]')) className += ' mediasoup';
                
                // Highlight filtered content
                if (filter && log.toLowerCase().includes(filter.toLowerCase())) {
                  className += ' highlight';
                }
                
                const logElement = document.createElement('div');
                logElement.className = className;
                logElement.textContent = log;
                logsContainer.appendChild(logElement);
              });
              
              // Scroll to bottom
              logsContainer.scrollTop = logsContainer.scrollHeight;
            })
            .catch(error => {
              console.error('Error fetching logs:', error);
            });
        }
        
        // Set up event listeners
        document.getElementById('refresh').addEventListener('click', refreshLogs);
        
        // Auto-refresh functionality
        function toggleAutoRefresh() {
          const autoRefresh = document.getElementById('autoRefresh').checked;
          const interval = document.getElementById('refreshInterval').value;
          
          if (autoRefreshTimer) {
            clearInterval(autoRefreshTimer);
            autoRefreshTimer = null;
          }
          
          if (autoRefresh) {
            const seconds = parseInt(interval) || 5;
            autoRefreshTimer = setInterval(refreshLogs, seconds * 1000);
          }
        }
        
        document.getElementById('autoRefresh').addEventListener('change', toggleAutoRefresh);
        document.getElementById('refreshInterval').addEventListener('change', toggleAutoRefresh);
        
        // Handle filter with Enter key
        document.getElementById('filter').addEventListener('keyup', (e) => {
          if (e.key === 'Enter') refreshLogs();
        });
        
        // Scroll to bottom initially
        const logsContainer = document.getElementById('logs');
        logsContainer.scrollTop = logsContainer.scrollHeight;
      </script>
    </body>
  </html>
  `;
  
  res.send(htmlContent);
});

(async () => {
  const server = await registerRoutes(app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    throw err;
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // ALWAYS serve the app on port 5000
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = 5000;
  server.listen({
    port,
    host: "0.0.0.0",
    reusePort: true,
  }, () => {
    log(`serving on port ${port}`);
  });
})();
