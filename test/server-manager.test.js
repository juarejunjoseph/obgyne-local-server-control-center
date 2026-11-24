const test = require('node:test');
const assert = require('node:assert/strict');
const { ServerManager } = require('../src/server-manager');

test('normalizes IPv4-mapped addresses', () => {
  const manager = new ServerManager();
  assert.equal(manager.normalizeAddress('::ffff:192.168.1.10'), '192.168.1.10');
});

test('tracks active clients', () => {
  const manager = new ServerManager();
  manager.recordClient('::ffff:192.168.1.20', 'Test browser');
  assert.equal(manager.activeClients().length, 1);
  assert.equal(manager.activeClients()[0].ip, '192.168.1.20');
});

test('keeps the activity log bounded', () => {
  const manager = new ServerManager();
  for (let i = 0; i < 120; i += 1) manager.log('Test', String(i));
  assert.equal(manager.activity.length, 100);
  assert.equal(manager.activity[0].details, '119');
});
