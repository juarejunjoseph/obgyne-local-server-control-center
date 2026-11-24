const $ = id => document.getElementById(id);
let refreshing = false;

function setTag(element, good, goodText, badText) {
  element.textContent = good ? goodText : badText;
  element.className = 'tag ' + (good ? 'good' : 'bad');
}

function timeLabel(value) {
  if (!value) return '—';
  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

async function refresh() {
  if (refreshing) return;
  refreshing = true;
  try {
    const status = await window.controlCenter.getStatus();
    const running = status.portal.running;
    $('overallStatus').textContent = running ? 'Online' : 'Offline';
    $('overallStatus').className = 'status-pill ' + (running ? 'online' : 'offline');
    setTag($('appState'), running, 'Online', 'Stopped');
    setTag($('dbState'), status.database.connected, 'Connected', 'Not detected');
    setTag($('networkState'), status.network.addresses.length > 0, 'Connected', 'No LAN address');
    $('portalService').textContent = running ? 'Running' : 'Stopped';
    $('databaseService').textContent = status.database.connected ? 'Detected on port 5432' : 'Not detected';
    $('localIp').textContent = status.network.addresses.join(', ') || 'No active LAN IP';
    $('portalAddress').textContent = status.portal.lanUrls[0] || status.portal.localUrl;
    $('clientCount').textContent = status.clients.length;
    $('footerText').textContent = running ? 'Demo server running in background.' : 'Demo server is stopped.';
    $('startButton').disabled = running;
    $('stopButton').disabled = !running;

    $('clientList').innerHTML = status.clients.length
      ? status.clients.map(client => '<div class="client"><span>' + client.ip + '</span><strong>Connected recently</strong></div>').join('')
      : '<div class="empty">Open the demo portal from another device to test detection.</div>';

    $('activityRows').innerHTML = status.activity.length
      ? status.activity.map(item => '<tr><td>' + timeLabel(item.time) + '</td><td>' + item.event + '</td><td>' + item.details + '</td></tr>').join('')
      : '<tr><td colspan="3">No activity yet.</td></tr>';
  } finally {
    refreshing = false;
  }
}

$('startButton').addEventListener('click', async () => { await window.controlCenter.start(); refresh(); });
$('stopButton').addEventListener('click', async () => { await window.controlCenter.stop(); refresh(); });
$('restartButton').addEventListener('click', async () => { await window.controlCenter.restart(); refresh(); });
$('openPortalButton').addEventListener('click', () => window.controlCenter.openPortal());
$('backupButton').addEventListener('click', async () => {
  const file = await window.controlCenter.createBackup();
  $('backupMessage').textContent = 'Test backup marker created: ' + file;
  refresh();
});
$('backupFolderButton').addEventListener('click', () => window.controlCenter.showBackupFolder());
document.querySelectorAll('[data-disabled]').forEach(button => {
  button.addEventListener('click', () => window.controlCenter.prototypeNotice(button.dataset.disabled));
});

refresh();
setInterval(refresh, 2500);
