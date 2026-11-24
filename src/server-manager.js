const http = require('http');
const net = require('net');
const os = require('os');
const fs = require('fs');
const path = require('path');

class ServerManager {
  constructor({ portalPort = 8787, databasePort = 5432, dataDirectory } = {}) {
    this.portalPort = portalPort;
    this.databasePort = databasePort;
    this.dataDirectory = dataDirectory || process.cwd();
    this.portalServer = null;
    this.clients = new Map();
    this.activity = [];
    this.startedAt = null;
  }

  log(event, details) {
    const entry = { time: new Date().toISOString(), event, details };
    this.activity.unshift(entry);
    this.activity = this.activity.slice(0, 100);
    return entry;
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

  demoPortalHtml() {
    return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>OB-Gyne Local Portal TEST</title><style>body{font-family:Arial,sans-serif;background:#f4f7f7;color:#10252a;margin:0}.top{background:#006f70;color:white;padding:18px 28px}.card{max-width:520px;margin:70px auto;background:white;border:1px solid #d8e0e2;padding:32px;box-shadow:0 8px 24px #00000012}h1{margin-top:0}label{display:block;margin:16px 0 6px}input{width:100%;box-sizing:border-box;padding:12px;border:1px solid #b8c6ca}button{margin-top:22px;width:100%;padding:13px;background:#007f80;color:white;border:0;font-weight:700}.test{background:#fff4cf;border:1px solid #e1bd45;padding:10px;margin-bottom:22px}</style></head><body><div class="top"><strong>OB-Gyne Local Portal</strong></div><main class="card"><div class="test">TEST MODE — fictional data only</div><h1>Clinic login</h1><p>The local server is online and reachable on this network.</p><label>Username</label><input placeholder="Test username"><label>Password</label><input type="password" placeholder="Test password"><button type="button">Log in (demo)</button></main></body></html>';
  }

  startPortal() {
    if (this.portalServer) return Promise.resolve(false);
    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => {
        this.recordClient(req.socket.remoteAddress, req.headers['user-agent']);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(this.demoPortalHtml());
      });
      server.once('error', reject);
      server.listen(this.portalPort, '0.0.0.0', () => {
        this.portalServer = server;
        this.startedAt = new Date().toISOString();
        this.log('Service', 'Demo portal started on port ' + this.portalPort);
        resolve(true);
      });
    });
  }

  stopPortal() {
    if (!this.portalServer) return Promise.resolve(false);
    return new Promise(resolve => {
      this.portalServer.close(() => {
        this.portalServer = null;
        this.log('Service', 'Demo portal stopped');
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
        connected: await this.checkPort(this.databasePort),
        port: this.databasePort,
        label: 'PostgreSQL'
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
}

module.exports = { ServerManager };
