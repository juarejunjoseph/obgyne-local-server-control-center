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
    const dbConnected = status.database.connected;

    $('overallStatus').textContent = running ? 'Online' : 'Offline';
    $('overallStatus').className = 'status-pill ' + (running ? 'online' : 'offline');
    setTag($('appState'), running, 'Online', 'Stopped');
    setTag($('dbState'), dbConnected, 'Connected', 'Not detected');
    setTag($('networkState'), status.network.addresses.length > 0, 'Connected', 'No LAN address');
    $('portalService').textContent = running ? 'Running' : 'Stopped';
    $('databaseService').textContent = dbConnected
      ? `PostgreSQL on port ${status.database.port} — ${status.database.patients} patients, ${status.database.visits} visits, ${status.database.documents} docs`
      : 'Not detected';
    $('localIp').textContent = status.network.addresses.join(', ') || 'No active LAN IP';
    $('portalAddress').textContent = status.portal.lanUrls[0] || status.portal.localUrl;
    $('clientCount').textContent = status.clients.length;
    $('footerText').textContent = running ? 'Portal running. PostgreSQL ' + (dbConnected ? 'connected.' : 'not connected.') : 'Portal stopped.';
    $('startButton').disabled = running;
    $('stopButton').disabled = !running;

    // Database stats
    if (dbConnected) {
      $('dbPatients').textContent = status.database.patients;
      $('dbVisits').textContent = status.database.visits;
      $('dbDocuments').textContent = status.database.documents;
      $('dbLastBackup').textContent = status.database.lastBackup
        ? new Date(status.database.lastBackup).toLocaleString()
        : '—';
    } else {
      $('dbPatients').textContent = '—';
      $('dbVisits').textContent = '—';
      $('dbDocuments').textContent = '—';
      $('dbLastBackup').textContent = '—';
    }

    // Database buttons
    $('dbStartButton').disabled = dbConnected;
    $('dbStopButton').disabled = !dbConnected;

    // Backup list
    const backups = await window.controlCenter.listBackups();
    $('backupList').innerHTML = backups.length
      ? backups.map(b => `<div class="backup-item"><span>${b.name}</span><small>${new Date(b.mtime).toLocaleString()}</small><button class="small" data-restore="${b.path}">Restore</button></div>`).join('')
      : '<div class="empty">No backups yet.</div>';
    document.querySelectorAll('[data-restore]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (confirm('Restore from ' + btn.dataset.restore + '? This will replace current data.')) {
          await window.controlCenter.restoreBackup(btn.dataset.restore);
          refresh();
        }
      });
    });

    // Autostart toggle
    const autostart = await window.controlCenter.getAutostart();
    $('autostartToggle').checked = autostart.openAtLogin || false;

    // Firewall status
    const firewall = await window.controlCenter.getFirewallStatus();
    if ($('firewallStatus')) {
      setTag($('firewallStatus'), firewall.configured, 'Configured', 'Not configured');
    }

    $('clientList').innerHTML = status.clients.length
      ? status.clients.map(client => '<div class="client"><span>' + client.ip + '</span><strong>Connected recently</strong></div>').join('')
      : '<div class="empty">Open the portal from another device to test detection.</div>';

    $('activityRows').innerHTML = status.activity.length
      ? status.activity.map(item => '<tr><td>' + timeLabel(item.time) + '</td><td>' + item.event + '</td><td>' + item.details + '</td></tr>').join('')
      : '<tr><td colspan="3">No activity yet.</td></tr>';
  } finally {
    refreshing = false;
  }
}

// Button handlers
$('startButton').addEventListener('click', async () => { await window.controlCenter.start(); refresh(); });
$('stopButton').addEventListener('click', async () => { await window.controlCenter.stop(); refresh(); });
$('restartButton').addEventListener('click', async () => { await window.controlCenter.restart(); refresh(); });
$('openPortalButton').addEventListener('click', () => window.controlCenter.openPortal());

// Database buttons
$('dbStartButton').addEventListener('click', async () => { await window.controlCenter.startDatabase(); refresh(); });
$('dbStopButton').addEventListener('click', async () => { await window.controlCenter.stopDatabase(); refresh(); });

// Backup buttons
$('backupButton').addEventListener('click', async () => {
  const file = await window.controlCenter.createBackup();
  $('backupMessage').textContent = 'Backup created: ' + file;
  refresh();
});
$('testBackupButton').addEventListener('click', async () => {
  const file = await window.controlCenter.createTestBackup();
  $('backupMessage').textContent = 'Test backup marker created: ' + file;
  refresh();
});
$('backupFolderButton').addEventListener('click', () => window.controlCenter.showBackupFolder());

// Seed button
$('seedButton').addEventListener('click', async () => {
  const file = prompt('Enter path to backup JSON file for seeding:');
  if (file) {
    try {
      await window.controlCenter.seedDatabase(file);
      $('backupMessage').textContent = 'Database seeded successfully.';
      refresh();
    } catch (e) {
      $('backupMessage').textContent = 'Seed failed: ' + e.message;
    }
  }
});

// Autostart toggle
$('autostartToggle').addEventListener('change', async (e) => {
  await window.controlCenter.setAutostart(e.target.checked);
});

// Firewall button
$('firewallButton').addEventListener('click', () => window.controlCenter.prototypeNotice('Configure firewall'));

// Update buttons
$('checkUpdateButton').addEventListener('click', async () => {
  const updates = await window.controlCenter.checkForUpdates();
  if (updates.available) {
    if (confirm(`Update available: v${updates.latest}. Install from ${updates.url}?`)) {
      window.open(updates.url, '_blank');
    }
  } else {
    alert('No update available.');
  }
  $('latestVersion').textContent = updates.latest || updates.current || 'Check failed';
});
$('applyUpdateButton').addEventListener('click', () => window.controlCenter.prototypeNotice('Apply update'));

// Google Drive buttons
$('configureDriveButton').addEventListener('click', () => {
  const token = prompt('Enter Google Drive OAuth token:');
  const folderId = prompt('Enter Google Drive folder ID (optional):') || null;
  if (token) {
    window.controlCenter.configureGoogleDrive(token, folderId).then(r => {
      refresh();
    }).catch(e => alert('Configure failed: ' + e.message));
  }
});
$('uploadToDriveButton').addEventListener('click', async () => {
  const file = await window.controlCenter.createBackup();
  const result = await window.controlCenter.uploadToGoogleDrive(file);
  if (result) {
    alert('Uploaded to Google Drive:\n' + result.name + '\n' + result.webViewLink);
    refresh();
  } else {
    alert('Upload failed. Check configuration.');
  }
});

// Recent activity display
function updateRecentActivity() {
  const activity = $('activityRows').querySelectorAll('tbody tr')[0] ?
    Array.from($('activityRows').querySelectorAll('tbody tr')) : [];
  const recent = activity.slice(0, 5);
  $('recentActivity').innerHTML = recent.length
    ? recent.map(r => r.outerHTML).join('')
    : '<div class="empty">No recent activity.</div>';
}

document.querySelectorAll('[data-restore]').forEach(button => {
  button.addEventListener('click', async () => {
    if (confirm('Restore from ' + button.dataset.restore + '? This will replace current data.')) {
      await window.controlCenter.restoreBackup(button.dataset.restore);
      refresh();
    }
  });
});

// Google Drive config status
async function updateDriveStatus() {
  const config = await window.controlCenter.getGoogleDriveConfig();
  $('driveConfigured').textContent = config.configured ? 'Yes' : 'No';
  $('driveConfigured').className = 'tag ' + (config.configured ? 'good' : 'neutral');
  const backups = await window.controlCenter.listBackups();
  $('driveUploadCount').textContent = backups.length > 0 ? backups.length : '—';
}

refresh();
updateDriveStatus();
setInterval(refresh, 2500);