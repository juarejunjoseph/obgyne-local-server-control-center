const http = require('http');
const net = require('net');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { spawn, execFile } = require('child_process');
const { Client } = require('pg');

class ServerManager {
  constructor({ portalPort = 8787, databasePort = 5432, dataDirectory } = {}) {
    this.portalPort = portalPort;
    this.databasePort = databasePort;
    this.dataDirectory = dataDirectory || process.cwd();
    this.portalServer = null;
    this.pgProcess = null;
    this.pgDataDir = path.join(this.dataDirectory, 'postgresql', 'data');
    this.pgBinDir = path.join(this.dataDirectory, 'postgresql', 'bin');
    this.clients = new Map();
    this.activity = [];
    this.startedAt = null;
    this.pgPool = null;
  }

  log(event, details) {
    const entry = { time: new Date().toISOString(), event, details };
    this.activity.unshift(entry);
    this.activity = this.activity.slice(0, 100);
    return entry;
  }

  statusSync() {
    return {
      portal: {
        running: Boolean(this.portalServer),
        port: this.portalPort
      },
      database: {
        connected: this.mockMode ? (this.mockRunning === true) : false,
        port: this.databasePort
      }
    };
  }

  getLanAddresses() {
    const addresses = [];
    for (const interfaces of Object.values(os.networkInterfaces())) {
      for (const item of interfaces || []) {
        if (item.family === 'IPv4' && !item.internal) addresses.push(item.address);
      }
    }
    return [...new Set(addresses)];
  }

  normalizeAddress(address = '') {
    return address.replace(/^::ffff:/, '') || 'Unknown';
  }

  recordClient(address, userAgent = '') {
    const ip = this.normalizeAddress(address);
    this.clients.set(ip, { ip, userAgent, lastSeen: new Date().toISOString() });
  }

  activeClients(maxAgeMs = 5 * 60 * 1000) {
    const cutoff = Date.now() - maxAgeMs;
    return [...this.clients.values()].filter(client => Date.parse(client.lastSeen) >= cutoff);
  }

  // ============================================================
  // PostgreSQL Management
  // ============================================================

  async ensurePostgreSQL() {
    // Check if PostgreSQL data directory exists
    if (!fs.existsSync(this.pgDataDir)) {
      await this.initPostgreSQL();
    }
    return true;
  }

  async initPostgreSQL() {
    this.log('PostgreSQL', 'Initializing new database cluster...');

    // Create data directory
    fs.mkdirSync(this.pgDataDir, { recursive: true });

    // For the test, we'll use a simple approach - check if initdb exists
    // In production, we'd bundle PostgreSQL binaries or use a Windows installer
    const initdbPath = this.findPostgresBinary('initdb');
    if (!initdbPath) {
      this.log('PostgreSQL', 'initdb not found - PostgreSQL binaries need to be installed');
      // Development fallback: use mock mode
      if (process.platform !== 'win32') {
        this.log('PostgreSQL', 'Running in mock mode on non-Windows platform');
        return await this.initMockPostgreSQL();
      }
      throw new Error('PostgreSQL binaries not found. Please install PostgreSQL or bundle binaries.');
    }

    return new Promise((resolve, reject) => {
      const initdb = spawn(initdbPath, [
        '-D', this.pgDataDir,
        '--auth-local=trust',
        '--auth-host=md5',
        '--encoding=UTF8',
        '--locale=C'
      ], { stdio: 'pipe' });

      let output = '';
      initdb.stdout.on('data', data => output += data.toString());
      initdb.stderr.on('data', data => output += data.toString());

      initdb.on('close', code => {
        if (code === 0) {
          this.log('PostgreSQL', 'Database cluster initialized successfully');
          // Configure postgresql.conf for local connections
          this.configurePostgreSQL();
          resolve(true);
        } else {
          this.log('PostgreSQL', `initdb failed with code ${code}: ${output}`);
          reject(new Error(`initdb failed: ${output}`));
        }
      });
    });
  }

  async initMockPostgreSQL() {
    this.log('PostgreSQL', 'Mock mode: simulating database initialization');
    this.mockMode = true;
    this.mockData = {
      patients: [],
      visits: [],
      clinical_documents: [],
      clinic_users: [
        { id: 'doctor1', username: 'doctor', full_name: 'Dr. Test Doctor', role: 'doctor', status: 'Active', permissions: ['all'] },
        { id: 'secretary1', username: 'secretary', full_name: 'Test Secretary', role: 'staff', status: 'Active', permissions: ['patients', 'charts', 'appointments', 'print'] },
      ],
    };
    this.mockPort = this.databasePort;
    // Simulate successful init
    return true;
  }

  async startMockPostgreSQL() {
    this.log('PostgreSQL', 'Mock mode: simulating server start');
    this.mockRunning = true;
    return true;
  }

  async stopMockPostgreSQL() {
    this.log('PostgreSQL', 'Mock mode: simulating server stop');
    this.mockRunning = false;
    return true;
  }

  async getMockDatabaseStats() {
    return {
      patients: this.mockData.patients.length,
      visits: this.mockData.visits.length,
      documents: this.mockData.clinical_documents.length,
      lastBackup: null,
    };
  }

  findPostgresBinary(binary) {
    // Check common Windows PostgreSQL installation paths
    const possiblePaths = [
      path.join(this.pgBinDir, binary + '.exe'),
      `C:\\Program Files\\PostgreSQL\\16\\bin\\${binary}.exe`,
      `C:\\Program Files\\PostgreSQL\\15\\bin\\${binary}.exe`,
      `C:\\Program Files\\PostgreSQL\\14\\bin\\${binary}.exe`,
      `C:\\Program Files\\PostgreSQL\\13\\bin\\${binary}.exe`,
    ];

    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        this.pgBinDir = path.dirname(p);
        return p;
      }
    }
    return null;
  }

  configurePostgreSQL() {
    const confPath = path.join(this.pgDataDir, 'postgresql.conf');
    let conf = fs.readFileSync(confPath, 'utf8');

    // Ensure we listen on localhost only
    conf = conf.replace(/^#?listen_addresses\s*=.*$/m, "listen_addresses = '127.0.0.1'");
    conf = conf.replace(/^#?port\s*=.*$/m, `port = ${this.databasePort}`);
    conf = conf.replace(/^#?max_connections\s*=.*$/m, 'max_connections = 50');
    conf = conf.replace(/^#?shared_buffers\s*=.*$/m, 'shared_buffers = 64MB');

    fs.writeFileSync(confPath, conf);

    // Configure pg_hba.conf for local trust, LAN md5
    const hbaPath = path.join(this.pgDataDir, 'pg_hba.conf');
    let hba = fs.readFileSync(hbaPath, 'utf8');

    // Replace with our configuration
    hba = `# TYPE  DATABASE        USER            ADDRESS                 METHOD
# Local connections - trust for local server management
local   all             all                                     trust
# IPv4 local connections
host    all             all             127.0.0.1/32            trust
# LAN connections from clinic network - password required
host    all             all             192.168.0.0/16          md5
host    all             all             10.0.0.0/8              md5
host    all             all             172.16.0.0/12           md5
`;
    fs.writeFileSync(hbaPath, hba);
  }

  async startPostgreSQL() {
    await this.ensurePostgreSQL();

    // Mock mode for development
    if (this.mockMode) {
      return this.startMockPostgreSQL();
    }

    const pgCtlPath = this.findPostgresBinary('pg_ctl');
    if (!pgCtlPath) {
      throw new Error('pg_ctl not found. PostgreSQL binaries need to be installed.');
    }

    // Check if already running
    const connected = await this.checkPort(this.databasePort);
    if (connected) {
      this.log('PostgreSQL', 'Already running on port ' + this.databasePort);
      return true;
    }

    this.log('PostgreSQL', 'Starting PostgreSQL server...');

    return new Promise((resolve, reject) => {
      const pgCtl = spawn(pgCtlPath, [
        '-D', this.pgDataDir,
        '-l', path.join(this.pgDataDir, 'postgresql.log'),
        'start'
      ], { stdio: 'pipe' });

      let output = '';
      pgCtl.stdout.on('data', data => output += data.toString());
      pgCtl.stderr.on('data', data => output += data.toString());

      pgCtl.on('close', async code => {
        if (code === 0) {
          // Wait for PostgreSQL to be ready
          for (let i = 0; i < 30; i++) {
            await new Promise(r => setTimeout(r, 500));
            const ready = await this.checkPort(this.databasePort);
            if (ready) {
              this.log('PostgreSQL', 'Server started successfully');
              await this.initDatabaseSchema();
              resolve(true);
              return;
            }
          }
          reject(new Error('PostgreSQL started but not accepting connections'));
        } else {
          this.log('PostgreSQL', `pg_ctl start failed with code ${code}: ${output}`);
          reject(new Error(`Failed to start PostgreSQL: ${output}`));
        }
      });
    });
  }

  async stopPostgreSQL() {
    // Mock mode for development
    if (this.mockMode) {
      return this.stopMockPostgreSQL();
    }

    const pgCtlPath = this.findPostgresBinary('pg_ctl');
    if (!pgCtlPath) {
      this.log('PostgreSQL', 'pg_ctl not found, cannot stop gracefully');
      return false;
    }

    this.log('PostgreSQL', 'Stopping PostgreSQL server...');

    return new Promise(resolve => {
      const pgCtl = spawn(pgCtlPath, [
        '-D', this.pgDataDir,
        'stop', '-m', 'fast'
      ], { stdio: 'pipe' });

      pgCtl.on('close', code => {
        if (code === 0) {
          this.log('PostgreSQL', 'Server stopped successfully');
          if (this.pgPool) {
            this.pgPool.end().catch(() => {});
            this.pgPool = null;
          }
          resolve(true);
        } else {
          this.log('PostgreSQL', `pg_ctl stop returned code ${code}`);
          resolve(false);
        }
      });
    });
  }

  async initDatabaseSchema() {
    if (!this.pgPool) {
      this.pgPool = new pg.Pool({
        host: '127.0.0.1',
        port: this.databasePort,
        database: 'postgres',
        user: 'postgres',
        password: '',
        max: 10,
        idleTimeoutMillis: 30000,
      });
    }

    try {
      // Create the obgyne database if it doesn't exist
      await this.pgPool.query('CREATE DATABASE obgyne');
      this.log('PostgreSQL', 'Created database: obgyne');
    } catch (e) {
      if (!e.message.includes('already exists')) {
        this.log('PostgreSQL', `Database creation note: ${e.message}`);
      }
    }

    // Connect to obgyne database
    this.pgPool.end();
    this.pgPool = new pg.Pool({
      host: '127.0.0.1',
      port: this.databasePort,
      database: 'obgyne',
      user: 'postgres',
      password: '',
      max: 10,
      idleTimeoutMillis: 30000,
    });

    // Run schema
    const schemaPath = path.join(__dirname, '..', '..', 'obgyne-supabase', 'database', 'schema.sql');
    if (fs.existsSync(schemaPath)) {
      const schema = fs.readFileSync(schemaPath, 'utf8');
      await this.pgPool.query(schema);
      this.log('PostgreSQL', 'Schema applied successfully');
    }

    // Run seed support migration
    const supportPath = path.join(__dirname, '..', '..', 'obgyne-supabase', 'database', 'migrations', '002_backup_seed_support.sql');
    if (fs.existsSync(supportPath)) {
      const support = fs.readFileSync(supportPath, 'utf8');
      await this.pgPool.query(support);
      this.log('PostgreSQL', 'Seed support migration applied');
    }

    // Insert test users
    await this.seedTestUsers();
  }

  async seedTestUsers() {
    const users = [
      { id: 'doctor1', username: 'doctor', full_name: 'Dr. Test Doctor', role: 'doctor', status: 'Active', permissions: ['all'] },
      { id: 'secretary1', username: 'secretary', full_name: 'Test Secretary', role: 'staff', status: 'Active', permissions: ['patients', 'charts', 'appointments', 'print'] },
    ];

    for (const u of users) {
      await this.pgPool.query(
        `INSERT INTO public.clinic_users (id, username, full_name, role, status, permissions, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
         ON CONFLICT (id) DO UPDATE SET username=$2, full_name=$3, role=$4, status=$5, permissions=$6, updated_at=NOW()`,
        [u.id, u.username, u.full_name, u.role, u.status, JSON.stringify(u.permissions)]
      );
    }
    this.log('PostgreSQL', 'Test users seeded');
  }

  async getDatabaseStats() {
    // Mock mode for development
    if (this.mockMode) {
      return this.getMockDatabaseStats();
    }

    if (!this.pgPool) return { patients: 0, visits: 0, documents: 0, lastBackup: null };

    try {
      const [patients, visits, documents, lastBackup] = await Promise.all([
        this.pgPool.query("SELECT count(*)::int as count FROM public.patients WHERE deleted_at IS NULL"),
        this.pgPool.query("SELECT count(*)::int as count FROM public.visits WHERE deleted_at IS NULL"),
        this.pgPool.query("SELECT count(*)::int as count FROM public.clinical_documents WHERE deleted_at IS NULL"),
        this.pgPool.query("SELECT max(created_at) as last_backup FROM public.migration_imports"),
      ]);

      return {
        patients: patients.rows[0]?.count || 0,
        visits: visits.rows[0]?.count || 0,
        documents: documents.rows[0]?.count || 0,
        lastBackup: lastBackup.rows[0]?.last_backup || null,
      };
    } catch (e) {
      this.log('PostgreSQL', `Stats query error: ${e.message}`);
      return { patients: 0, visits: 0, documents: 0, lastBackup: null, error: e.message };
    }
  }

  async createBackup() {
    // Mock mode for development
    if (this.mockMode) {
      return this.createMockBackup();
    }

    if (!this.pgPool) throw new Error('Database not connected');

    const backupDir = path.join(this.dataDirectory, 'backups');
    fs.mkdirSync(backupDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFile = path.join(backupDir, `obgyne-backup-${timestamp}.sql`);

    const pgDumpPath = this.findPostgresBinary('pg_dump');
    if (!pgDumpPath) {
      throw new Error('pg_dump not found. PostgreSQL binaries need to be installed.');
    }

    return new Promise((resolve, reject) => {
      const pgDump = spawn(pgDumpPath, [
        '-h', '127.0.0.1',
        '-p', String(this.databasePort),
        '-U', 'postgres',
        '-d', 'obgyne',
        '-f', backupFile,
        '--no-password',
        '--verbose',
        '--format=plain',
        '--no-owner',
        '--no-privileges'
      ], { env: { ...process.env, PGPASSWORD: '' } });

      let stderr = '';
      pgDump.stderr.on('data', data => stderr += data.toString());

      pgDump.on('close', code => {
        if (code === 0) {
          this.log('Backup', `Backup created: ${path.basename(backupFile)}`);
          resolve(backupFile);
        } else {
          this.log('Backup', `pg_dump failed: ${stderr}`);
          reject(new Error(`Backup failed: ${stderr}`));
        }
      });
    });
  }

  async createMockBackup() {
    const backupDir = path.join(this.dataDirectory, 'backups');
    fs.mkdirSync(backupDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFile = path.join(backupDir, `obgyne-mock-backup-${timestamp}.sql`);

    // Create a simple mock SQL file
    const mockSql = `-- Mock backup for testing
-- Created: ${new Date().toISOString()}
-- Patients: ${this.mockData.patients.length}
-- Visits: ${this.mockData.visits.length}
-- Documents: ${this.mockData.clinical_documents.length}
`;

    fs.writeFileSync(backupFile, mockSql);
    this.log('Backup', `Mock backup created: ${path.basename(backupFile)}`);
    return backupFile;
  }

  async restoreBackup(backupFile) {
    // Mock mode for development
    if (this.mockMode) {
      return this.restoreMockBackup(backupFile);
    }

    if (!fs.existsSync(backupFile)) throw new Error('Backup file not found');

    const pgRestorePath = this.findPostgresBinary('psql');
    if (!pgRestorePath) {
      throw new Error('psql not found. PostgreSQL binaries need to be installed.');
    }

    // For plain SQL format, use psql
    return new Promise((resolve, reject) => {
      const psql = spawn(pgRestorePath, [
        '-h', '127.0.0.1',
        '-p', String(this.databasePort),
        '-U', 'postgres',
        '-d', 'obgyne',
        '-f', backupFile,
        '--no-password',
        '-v', 'ON_ERROR_STOP=1'
      ], { env: { ...process.env, PGPASSWORD: '' } });

      let stderr = '';
      psql.stderr.on('data', data => stderr += data.toString());

      psql.on('close', code => {
        if (code === 0) {
          this.log('Restore', `Backup restored from: ${path.basename(backupFile)}`);
          resolve(true);
        } else {
          this.log('Restore', `psql restore failed: ${stderr}`);
          reject(new Error(`Restore failed: ${stderr}`));
        }
      });
    });
  }

  async restoreMockBackup(backupFile) {
    if (!fs.existsSync(backupFile)) throw new Error('Backup file not found');
    this.log('Restore', `Mock restore from: ${path.basename(backupFile)}`);
    return true;
  }

  listBackups() {
    const backupDir = path.join(this.dataDirectory, 'backups');
    if (!fs.existsSync(backupDir)) return [];
    return fs.readdirSync(backupDir)
      .filter(f => f.endsWith('.sql') || f.endsWith('.json'))
      .map(f => ({ name: f, path: path.join(backupDir, f), mtime: fs.statSync(path.join(backupDir, f)).mtime }))
      .sort((a, b) => b.mtime - a.mtime);
  }

  // ============================================================
  // Portal Serving
  // ============================================================

  getPortalAssets() {
    const portalRoot = path.join(__dirname, '..', '..', 'obgyne-supabase');
    const assets = {
      html: path.join(portalRoot, 'index.html'),
      styles: path.join(portalRoot, 'styles.css'),
      inventoryCss: path.join(portalRoot, 'inventory.css'),
      dispensingCss: path.join(portalRoot, 'dispensing.css'),
      manifest: path.join(portalRoot, 'manifest.json'),
      sw: path.join(portalRoot, 'service-worker.js'),
      appJs: path.join(portalRoot, 'app.js'),
      storageJs: path.join(portalRoot, 'storage.js'),
      usersJs: path.join(portalRoot, 'users.js'),
      syncJs: path.join(portalRoot, 'sync.js'),
      cloudDbJs: path.join(portalRoot, 'cloud-database.js'),
      inventoryJs: path.join(portalRoot, 'inventory.js'),
      dispensingJs: path.join(portalRoot, 'dispensing.js'),
      assetsDir: path.join(portalRoot, 'assets'),
    };
    return assets;
  }

  servePortalAsset(req, res, assetPath) {
    const ext = path.extname(assetPath).toLowerCase();
    const mimeTypes = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
      '.mjs': 'text/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.svg': 'image/svg+xml',
      '.ico': 'image/x-icon',
      '.webmanifest': 'application/manifest+json',
    };

    const noStoreExts = new Set(['.html', '.js', '.mjs', '.css', '.json', '.webmanifest']);

    if (!fs.existsSync(assetPath) || fs.statSync(assetPath).isDirectory()) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end('Not found');
    }

    res.writeHead(200, {
      'content-type': mimeTypes[ext] || 'application/octet-stream',
      'cache-control': noStoreExts.has(ext) ? 'no-store, max-age=0' : 'private, max-age=3600'
    });
    fs.createReadStream(assetPath).pipe(res);
  }

  portalHtml() {
    const assets = this.getPortalAssets();
    // Read and serve the actual portal index.html
    try {
      let html = fs.readFileSync(assets.html, 'utf8');
      // Replace version query strings to avoid cache issues during development
      html = html.replace(/\?v=[^"']+/g, '');
      return html;
    } catch (e) {
      return this.demoPortalHtml();
    }
  }

  demoPortalHtml() {
    return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>OB-Gyne Local Portal TEST</title><style>body{font-family:Arial,sans-serif;background:#f4f7f7;color:#10252a;margin:0}.top{background:#006f70;color:white;padding:18px 28px}.card{max-width:520px;margin:70px auto;background:white;border:1px solid #d8e0e2;padding:32px;box-shadow:0 8px 24px #00000012}h1{margin-top:0}label{display:block;margin:16px 0 6px}input{width:100%;box-sizing:border-box;padding:12px;border:1px solid #b8c6ca}button{margin-top:22px;width:100%;padding:13px;background:#007f80;color:white;border:0;font-weight:700}.test{background:#fff4cf;border:1px solid #e1bd45;padding:10px;margin-bottom:22px}</style></head><body><div class="top"><strong>OB-Gyne Local Portal</strong></div><main class="card"><div class="test">TEST MODE — fictional data only</div><h1>Clinic login</h1><p>The local server is online and reachable on this network.</p><label>Username</label><input placeholder="Test username"><label>Password</label><input type="password" placeholder="Test password"><button type="button">Log in (demo)</button></main></body></html>';
  }

  startPortal() {
    if (this.portalServer) return Promise.resolve(false);

    return new Promise((resolve, reject) => {
      const server = http.createServer(async (req, res) => {
        this.recordClient(req.socket.remoteAddress, req.headers['user-agent']);

        const url = new URL(req.url, 'http://localhost');
        const assets = this.getPortalAssets();

        // API endpoints for the portal
        if (url.pathname.startsWith('/api/')) {
          await this.handleApiRequest(req, res, url);
          return;
        }

        // Static assets
        if (url.pathname === '/' || url.pathname === '/index.html') {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
          return res.end(this.portalHtml());
        }

        // Map portal asset paths
        let assetPath = null;
        if (url.pathname === '/styles.css') assetPath = assets.styles;
        else if (url.pathname === '/inventory.css') assetPath = assets.inventoryCss;
        else if (url.pathname === '/dispensing.css') assetPath = assets.dispensingCss;
        else if (url.pathname === '/manifest.json') assetPath = assets.manifest;
        else if (url.pathname === '/service-worker.js') assetPath = assets.sw;
        else if (url.pathname === '/app.js') assetPath = assets.appJs;
        else if (url.pathname === '/storage.js') assetPath = assets.storageJs;
        else if (url.pathname === '/users.js') assetPath = assets.usersJs;
        else if (url.pathname === '/sync.js') assetPath = assets.syncJs;
        else if (url.pathname === '/cloud-database.js') assetPath = assets.cloudDbJs;
        else if (url.pathname === '/inventory.js') assetPath = assets.inventoryJs;
        else if (url.pathname === '/dispensing.js') assetPath = assets.dispensingJs;
        else if (url.pathname.startsWith('/assets/')) {
          assetPath = path.join(assets.assetsDir, url.pathname.replace('/assets/', ''));
        }

        if (assetPath) {
          this.servePortalAsset(req, res, assetPath);
        } else {
          res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
          res.end('Not found');
        }
      });

      server.once('error', reject);
      server.listen(this.portalPort, '0.0.0.0', () => {
        this.portalServer = server;
        this.startedAt = new Date().toISOString();
        this.log('Service', 'Portal started on port ' + this.portalPort);
        resolve(true);
      });
    });
  }

  async handleApiRequest(req, res, url) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');

    try {
      if (url.pathname === '/api/health') {
        const stats = await this.getDatabaseStats();
        return res.end(JSON.stringify({
          ok: true,
          service: 'OB-Gyne Local Portal',
          version: '27.0.0-alpha.28',
          mode: 'clinic-lan',
          database: { connected: true, ...stats },
        }));
      }

      if (url.pathname === '/api/patients' && req.method === 'GET') {
        const result = await this.pgPool.query(
          "SELECT * FROM public.patients WHERE deleted_at IS NULL ORDER BY updated_at DESC LIMIT 100"
        );
        return res.end(JSON.stringify({ ok: true, patients: result.rows }));
      }

      if (url.pathname === '/api/patients' && req.method === 'POST') {
        let body = '';
        for await (const chunk of req) body += chunk;
        const data = JSON.parse(body || '{}');
        // Insert patient logic here
        return res.end(JSON.stringify({ ok: true, message: 'Patient API not fully implemented' }));
      }

      res.writeHead(404);
      res.end(JSON.stringify({ ok: false, error: 'API endpoint not found' }));
    } catch (e) {
      res.writeHead(500);
      res.end(JSON.stringify({ ok: false, error: e.message }));
    }
  }

  stopPortal() {
    if (!this.portalServer) return Promise.resolve(false);
    return new Promise(resolve => {
      this.portalServer.close(() => {
        this.portalServer = null;
        this.log('Service', 'Portal stopped');
        resolve(true);
      });
    });
  }

  async restartPortal() {
    await this.stopPortal();
    return this.startPortal();
  }

  checkPort(port, host = '127.0.0.1', timeout = 500) {
    return new Promise(resolve => {
      const socket = net.createConnection({ port, host });
      const finish = value => { socket.destroy(); resolve(value); };
      socket.setTimeout(timeout);
      socket.once('connect', () => finish(true));
      socket.once('timeout', () => finish(false));
      socket.once('error', () => finish(false));
    });
  }

  async status() {
    const addresses = this.getLanAddresses();

    // Mock mode: database is "connected" if mock is running
    let dbConnected, dbStats;
    if (this.mockMode) {
      dbConnected = this.mockRunning === true;
      dbStats = await this.getMockDatabaseStats();
    } else {
      dbConnected = await this.checkPort(this.databasePort);
      dbStats = dbConnected ? await this.getDatabaseStats() : { patients: 0, visits: 0, documents: 0, lastBackup: null };
    }

    return {
      testMode: true,
      portal: {
        running: Boolean(this.portalServer),
        port: this.portalPort,
        localUrl: 'http://127.0.0.1:' + this.portalPort,
        lanUrls: addresses.map(ip => 'http://' + ip + ':' + this.portalPort),
        startedAt: this.startedAt
      },
      database: {
        connected: dbConnected,
        port: this.databasePort,
        label: 'PostgreSQL',
        ...dbStats
      },
      network: { addresses },
      clients: this.activeClients(),
      activity: this.activity
    };
  }

  createTestBackup() {
    const directory = path.join(this.dataDirectory, 'backups');
    fs.mkdirSync(directory, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const file = path.join(directory, 'obgyne-test-backup-' + stamp + '.json');
    fs.writeFileSync(file, JSON.stringify({
      testMode: true,
      createdAt: new Date().toISOString(),
      note: 'Prototype backup marker only. No patient data or PostgreSQL dump is included.'
    }, null, 2));
    this.log('Backup', 'Test backup marker created: ' + path.basename(file));
    return file;
  }

  // ============================================================
  // Google Drive Upload (requires user configuration)
  // ============================================================

  async uploadToGoogleDrive(localPath, folderId = null) {
    if (!fs.existsSync(localPath)) throw new Error('Backup file not found');

    // Check for Google Drive configuration
    const configPath = path.join(this.dataDirectory, 'gdrive-config.json');
    if (!fs.existsSync(configPath)) {
      throw new Error('Google Drive not configured. Set up credentials first via settings.');
    }

    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const token = config.accessToken;

    if (!token) {
      throw new Error('Authentication required. Please sign in to Google Drive.');
    }

    const fileName = path.basename(localPath);
    const fileContent = fs.readFileSync(localPath);
    const fileSize = fileContent.length;

    // Upload using Google Drive REST API
    const fetch = (await import('node-fetch')).default;

    const metadata = {
      name: fileName,
      mimeType: 'application/sql'
    };
    if (folderId) metadata.parents = [folderId];

    try {
      const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': `multipart/related; boundary=foo_bar_baz`
        },
        body: `
--foo_bar_baz
Content-Type: application/json; charset=UTF-8

${JSON.stringify(metadata)}
--foo_bar_baz
Content-Type: application/sql

${fileContent}
--foo_bar_baz--`
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(`Upload failed: ${error.message || response.statusText}`);
      }

      const result = await response.json();
      this.log('Upload', `Database uploaded to Google Drive: ${fileName}`);

      return {
        id: result.id,
        name: result.name,
        webViewLink: result.webViewLink
      };
    } catch (e) {
      this.log('Upload', `Failed: ${e.message}`);
      throw e;
    }
  }

  async listGoogleDriveBackups(folderId = null) {
    const configPath = path.join(this.dataDirectory, 'gdrive-config.json');
    if (!fs.existsSync(configPath)) return [];

    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const token = config.accessToken;

    if (!token) return [];

    const fetch = (await import('node-fetch')).default;

    try {
      let url = 'https://www.googleapis.com/drive/v3/files?q=mimeType=\'application/sql\'';
      if (folderId) {
        url += `+and+\'${folderId}'\ in+parents`;
      }
      url += '&fields=files(id,name,createdTime,webViewLink)&orderBy=createdTime desc';

      const response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (!response.ok) return [];

      const data = await response.json();
      return data.files || [];
    } catch {
      return [];
    }
  }

  // ============================================================
  // GitHub Release Updates (for installer updates)
  // ============================================================

  async checkForUpdates(currentVersion, repo = 'juarejunjoseph/obgyne-local-server-control-center') {
    const fetch = (await import('node-fetch')).default;

    try {
      const response = await fetch(`https://api.github.com/repos/${repo}/releases/latest`);
      if (!response.ok) return { available: false };

      const release = await response.json();
      const latest = release.tag_name.replace(/^v/, '');

      if (latest === currentVersion) {
        return { available: false, current: currentVersion };
      }

      return {
        available: true,
        current: currentVersion,
        latest,
        notes: release.body || '',
        url: release.html_url
      };
    } catch (e) {
      return { available: false, error: e.message };
    }
  }
}

module.exports = { ServerManager };