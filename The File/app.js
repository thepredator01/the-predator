import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import slowDown from 'express-slow-down';
import { v4 as uuidv4 } from 'uuid';
import cluster from 'cluster';
import os from 'os';
import path from 'path';
import fs from 'fs/promises';
import crypto from 'crypto';
import { fileTypeFromFile } from 'file-type';
import { Server } from 'socket.io';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { exec } from 'child_process';
import util from 'util';
import morgan from 'morgan';

const execPromise = util.promisify(exec);

class CosmicServer {
  constructor() {
    this.app = express();
    this.nodeId = crypto.randomBytes(4).toString('hex');
    this.startTime = new Date();
    this.clusterMode = process.env.CLUSTER_MODE === 'true';
    this.workerCount = process.env.WORKER_COUNT || os.cpus().length;
    this.conversionSessions = new Map();
    this.setupEnvironment();
  }

  async setupEnvironment() {
    // Validate and setup environment
    this.validateEnvironment();
    await this.ensureDirectories([
      process.env.TEMP_DIR,
      process.env.UPLOAD_DIR,
      process.env.CONVERTED_DIR,
      process.env.LOG_DIR
    ]);
    this.generateEncryptionKeys();
  }

  validateEnvironment() {
    const requiredVars = [
      'TEMP_DIR', 'UPLOAD_DIR', 'CONVERTED_DIR', 
      'MAX_FILE_SIZE', 'PORT', 'NODE_ENV'
    ];
    const missing = requiredVars.filter(v => !process.env[v]);
    if (missing.length > 0) {
      throw new Error(`Missing environment variables: ${missing.join(', ')}`);
    }
  }

  async ensureDirectories(dirs) {
    await Promise.all(
      dirs.map(dir => fs.mkdir(dir, { recursive: true }))
    );
  }

  generateEncryptionKeys() {
    this.encryptionKeys = {
      publicKey: crypto.randomBytes(32).toString('hex'),
      privateKey: crypto.randomBytes(64).toString('hex'),
      rotationTime: new Date(Date.now() + 24 * 60 * 60 * 1000)
    };
  }

  async rotateKeysIfNeeded() {
    if (new Date() > this.encryptionKeys.rotationTime) {
      this.generateEncryptionKeys();
      console.log('Quantum encryption keys rotated');
    }
  }

  setupMiddleware() {
    // Security middleware
    this.app.use(helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:", "blob:"],
          connectSrc: ["'self'", `ws://localhost:${process.env.PORT}`]
        }
      },
      crossOriginEmbedderPolicy: false
    }));

    // Rate limiting
    const limiter = rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 500,
      standardHeaders: true,
      legacyHeaders: false,
      keyGenerator: (req) => req.headers['x-forwarded-for'] || req.ip
    });

    const speedLimiter = slowDown({
      windowMs: 15 * 60 * 1000,
      delayAfter: 100,
      delayMs: 500,
      maxDelayMs: 5000
    });

    this.app.use(limiter);
    this.app.use(speedLimiter);
    this.app.use(cors({
      origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
      methods: ['GET', 'POST', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
      credentials: true
    }));

    // Body parsing
    this.app.use(express.json({ limit: process.env.MAX_FILE_SIZE }));
    this.app.use(express.urlencoded({ extended: true, limit: process.env.MAX_FILE_SIZE }));

    // Request logging
    this.app.use(morgan('combined', {
      stream: fs.createWriteStream(
        path.join(process.env.LOG_DIR, 'access.log'), 
        { flags: 'a' }
      )
    }));

    // Request tracking
    this.app.use((req, res, next) => {
      req.requestId = uuidv4();
      req.startTime = process.hrtime();
      next();
    });

    // Response time tracking
    this.app.use((req, res, next) => {
      res.on('finish', () => {
        const [seconds, nanoseconds] = process.hrtime(req.startTime);
        const milliseconds = (seconds * 1000) + (nanoseconds / 1000000);
        res.setHeader('X-Response-Time', `${milliseconds.toFixed(2)}ms`);
      });
      next();
    });
  }

  async setupRoutes() {
    try {
      // Health check endpoint
      this.app.get('/quantum-health', (req, res) => {
        res.json({
          status: 'quantum_entangled',
          nodeId: this.nodeId,
          uptime: process.uptime(),
          memoryUsage: process.memoryUsage(),
          cpuUsage: process.cpuUsage(),
          conversionsInProgress: this.conversionSessions.size,
          quantumKeysAge: Math.floor(
            (new Date() - this.encryptionKeys.rotationTime) / (1000 * 60 * 60)
          )
        });
      });

      // Import routes in parallel
      const [convertRouter, uploadRouter, downloadRouter] = await Promise.all([
        import('./routes/convert.js'),
        import('./routes/upload.js'),
        import('./routes/download.js')
      ]);

      // Setup API routes
      this.app.use('/api/convert', convertRouter.default);
      this.app.use('/api/upload', uploadRouter.default);
      this.app.use('/api/download', downloadRouter.default);

    } catch (error) {
      console.error('Route setup failed:', error);
      throw error;
    }
  }

  setupWebSockets() {
    this.httpServer = createServer(this.app);
    this.io = new Server(this.httpServer, {
      cors: {
        origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
        methods: ['GET', 'POST']
      },
      transports: ['websocket', 'polling'],
      pingInterval: 10000,
      pingTimeout: 5000
    });

    this.wss = new WebSocketServer({
      server: this.httpServer,
      path: '/binary',
      maxPayload: parseInt(process.env.MAX_FILE_SIZE)
    });

    this.io.on('connection', (socket) => {
      console.log(`New quantum connection: ${socket.id}`);
      
      socket.on('conversion-progress', (data) => {
        this.handleConversionProgress(socket, data);
      });
      
      socket.on('disconnect', () => {
        console.log(`Quantum tunnel closed: ${socket.id}`);
      });
    });

    this.wss.on('connection', (ws) => {
      console.log('Binary WebSocket connection established');
      ws.on('message', (message) => {
        this.handleBinaryMessage(ws, message);
      });
    });
  }

  handleConversionProgress(socket, data) {
    const { sessionId, progress, fileIndex } = data;
    const session = this.conversionSessions.get(sessionId);
    if (session) {
      session.progress = progress;
      session.lastUpdate = new Date();
      socket.emit('progress-update', { sessionId, progress, fileIndex });
    }
  }

  handleBinaryMessage(ws, message) {
    // Process binary data streams
  }

  async startCleanupService() {
    // Setup periodic cleanup
    setInterval(async () => {
      await this.cleanTempDirectories();
    }, 60 * 60 * 1000);
  }

  async cleanTempDirectories() {
    const tempDirs = [
      path.join(process.env.TEMP_DIR, 'uploads'),
      path.join(process.env.TEMP_DIR, 'converted'),
      path.join(process.env.TEMP_DIR, 'zips')
    ];
    
    await Promise.all(
      tempDirs.map(dir => this.cleanDirectory(dir))
    );
  }

  async cleanDirectory(directory) {
    try {
      const files = await fs.readdir(directory);
      const now = Date.now();
      const cutoff = now - (24 * 60 * 60 * 1000); // 24 hours
      
      await Promise.all(
        files.map(async (file) => {
          const filePath = path.join(directory, file);
          const stats = await fs.stat(filePath);
          if (stats.mtimeMs < cutoff) {
            await fs.unlink(filePath);
          }
        })
      );
    } catch (error) {
      console.error(`Cleanup failed for ${directory}:`, error);
    }
  }

  async start() {
    if (this.clusterMode && cluster.isPrimary) {
      console.log(`Master quantum node ${process.pid} is running`);
      
      // Fork workers
      for (let i = 0; i < this.workerCount; i++) {
        cluster.fork({
          WORKER_ID: i + 1,
          NODE_ID: this.nodeId
        });
      }
      
      cluster.on('exit', (worker, code, signal) => {
        console.log(`Worker ${worker.process.pid} collapsed. Restarting...`);
        cluster.fork();
      });
    } else {
      await this.setupMiddleware();
      await this.setupRoutes();
      this.setupWebSockets();
      await this.startCleanupService();
      
      const port = process.env.PORT || 3000;
      this.httpServer.listen(port, () => {
        console.log(`
          ██████╗ ██████╗ ███████╗███╗   ███╗██╗ ██████╗
          ██╔═══██╗██╔══██╗██╔════╝████╗ ████║██║██╔════╝
          ██║   ██║██████╔╝█████╗  ██╔████╔██║██║██║     
          ██║   ██║██╔═══╝ ██╔══╝  ██║╚██╔╝██║██║██║     
          ╚██████╔╝██║     ███████╗██║ ╚═╝ ██║██║╚██████╗
           ╚═════╝ ╚═╝     ╚══════╝╚═╝     ╚═╝╚═╝ ╚═════╝
          
          Quantum Core ${this.nodeId} active on port ${port}
          Worker ${process.env.WORKER_ID || 'standalone'}
          Startup Time: ${this.startTime.toISOString()}
          Temp Directory: ${process.env.TEMP_DIR}
          Conversion Engine: v2.4.1
          Security Level: Quantum-Entangled
        `);
      });
    }
  }
}

// Start the cosmic journey
const cosmicServer = new CosmicServer();
cosmicServer.start().catch(err => {
  console.error('Quantum collapse detected:', err);
  process.exit(1);
});

// Quantum error handling
process.on('uncaughtException', (err) => {
  console.error('Uncaught quantum fluctuation:', err);
  setTimeout(() => process.exit(1), 1000);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled quantum rejection at:', promise, 'reason:', reason);
});

// Graceful shutdown
const shutdown = async () => {
  console.log('Initiating quantum shutdown sequence...');
  if (cosmicServer.httpServer) {
    await new Promise(resolve => cosmicServer.httpServer.close(resolve));
  }
  await cosmicServer.cleanTempDirectories();
  console.log('Quantum shutdown complete');
  process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);