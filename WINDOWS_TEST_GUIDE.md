# OB-Gyne Server Control Center — Windows 11 Test Guide

**Version:** 0.1.0-test
**Date:** 2026-11-26

---

## 1. Prerequisites

- Clean Windows 11 laptop (or VM)
- Administrator privileges for installation
- Second device (phone, tablet, or another laptop) on same Wi-Fi for LAN testing
- Internet connection for initial download only (test works offline after)

---

## 2. Installation

1. Download the TEST installer from GitHub Actions artifacts:
   - Go to: https://github.com/juarejunjoseph/obgyne-local-server-control-center/actions
   - Select latest "Build Windows test installer" run on `testing/electron-prototype` branch
   - Download `OB-Gyne-Server-Control-Center-TEST-0.1.0-test-Setup.exe`

2. Run the installer:
   - Double-click the `.exe`
   - Allow Windows SmartScreen / UAC prompts
   - Choose installation directory (default is fine)
   - Create desktop and Start Menu shortcuts (recommended)

3. Launch the app:
   - From Start Menu → "OB-Gyne Server Control Center TEST"
   - Or double-click desktop shortcut

---

## 3. First Run — Start Services

1. **Dashboard opens** showing "TEST MODE" badge and status "Checking..."

2. **Start PostgreSQL Database:**
   - Click **"Start database"** button
   - Status should change to "PostgreSQL on port 5432 — 0 patients, 0 visits, 0 docs"
   - Activity log shows "PostgreSQL: Mock mode: simulating server start"

3. **Start Portal:**
   - Click **"Start portal"** button
   - Status should change to "Online" (green pill)
   - Portal Service shows "Running"
   - Network panel shows your LAN IP and portal URL (e.g., `http://192.168.1.42:8787`)

4. **Open Portal locally:**
   - Click **"Open portal"** → opens `http://127.0.0.1:8787` in default browser
   - You should see the OB-Gyne login page with clinic logo

---

## 4. LAN Testing (Two-Device Test)

1. **On the server laptop:** Note the LAN portal URL from the dashboard (e.g., `http://192.168.1.42:8787`)

2. **On second device** (phone/tablet/laptop on same Wi-Fi):
   - Open browser and navigate to the LAN URL
   - Should see the same login page

3. **Test concurrent access:**
   - Log in as **doctor** / (any password) on server laptop
   - Log in as **secretary** / (any password) on second device
   - Both should access the portal simultaneously

---

## 5. Create Fictional Test Data

1. **Register a patient** (as secretary):
   - Click "New Patient" in portal
   - Fill in fictional data (use the test seed data as reference)
   - Save

2. **Doctor creates a chart** (as doctor):
   - Open the patient record
   - Click "New Chart" → "Initial Visit"
   - Fill clinical notes
   - Save

3. **Secretary previews and prints:**
   - Open the same patient on second device
   - Click the chart → "Preview"
   - Click "Print" → verify print preview opens correctly
   - Test "Save as PDF" from print dialog

4. **Verify data sync:**
   - Both devices should see the patient and chart immediately
   - Refresh both browsers → data persists

---

## 6. Test Multiple Document Types

Create and print each of these from the portal (doctor creates, secretary prints):

- [ ] Lab Request
- [ ] Radiology/Cardiology Request
- [ ] Ultrasound Request
- [ ] Rx Prescription
- [ ] Clinical Referral Letter
- [ ] Pap Smear Request
- [ ] Medical Certificate (verify blank signature line for handwritten signature)
- [ ] Hospital Admitting Orders
- [ ] Fertility Tracker
- [ ] Medication Schedule
- [ ] Delivery Bag Packing List
- [ ] Follow-up Check-up

**Verify:** Each prints with correct layout, logo, watermark, and signature placement matching the approved design.

---

## 7. Backup and Restore Test

1. **Create backup:**
   - In Control Center dashboard → "Create backup (pg_dump)"
   - Note the backup file path in activity log and backup list

2. **Verify backup file exists:**
   - Click "Open backup folder"
   - Confirm `.sql` file is present with recent timestamp

3. **Test restore to separate database:**
   - Stop portal (keep PostgreSQL running)
   - Click backup's "Restore" button
   - Confirm restore succeeds
   - Start portal again
   - Verify all patient/chart data is intact

---

## 8. Offline Test (Internet Disconnected)

1. **Disconnect Wi-Fi** on server laptop (or unplug ethernet)
2. **Verify portal still works:**
   - Both devices can still access portal via LAN IP
   - Create new patient, chart, print document
3. **Reconnect Wi-Fi** → everything continues working

---

## 9. Reboot Test (Auto-Start)

1. **Enable auto-start:**
   - In dashboard → "Startup and firewall" panel
   - Toggle "Start on Windows login" ON

2. **Reboot Windows:**
   - Start → Power → Restart
   - Log in to Windows

3. **Verify services started automatically:**
   - Open Control Center from Start Menu
   - Dashboard should show PostgreSQL "Connected" and Portal "Running" without manual start
   - Open portal from browser → works immediately

---

## 10. Network Change Test (Clinic Branch Switch)

1. **Connect to different Wi-Fi** (simulate moving to Medicus/Eheadz branch)
2. **Observe dashboard:**
   - LAN IP updates to new subnet
   - Portal URL updates accordingly
3. **Test from second device on new network:**
   - Use new portal URL
   - Verify access works

---

## 11. Acceptance Checklist

| Test | Status | Notes |
|------|--------|-------|
| Installer runs without errors | ☐ | |
| PostgreSQL starts (mock mode) | ☐ | |
| Portal serves real assets (HTML/CSS/JS/images) | ☐ | |
| LAN access from second device | ☐ | |
| Concurrent doctor + secretary access | ☐ | |
| Patient registration → doctor sees → chart saved → secretary prints | ☐ | |
| All 12 document types print correctly | ☐ | |
| Medical Certificate has blank signature line | ☐ | |
| Backup creates `.sql` file | ☐ | |
| Restore replaces data correctly | ☐ | |
| Works offline (Wi-Fi disconnected) | ☐ | |
| Auto-start after reboot works | ☐ | |
| Network change updates LAN IP | ☐ | |
| Tray icon runs in background | ☐ | |
| Activity log records events | ☐ | |

---

## 12. Known Limitations (Test Prototype)

- **PostgreSQL runs in mock mode** — no real database on macOS/Linux development; Windows build will include bundled PostgreSQL binaries
- **No real firewall configuration** — "Configure firewall" button shows prototype notice
- **No Supabase sync** — online sync disabled by design
- **No real update mechanism** — "Check for updates" / "Apply update" are simulated
- **Authentication is mocked** — any username/password works
- **Print preview uses browser print** — no dedicated print engine yet

---

## 13. Troubleshooting

| Issue | Solution |
|-------|----------|
| Portal shows "Not found" for assets | Ensure `src/assets/icon.png` was packaged (check `extraResources` in package.json) |
| PostgreSQL won't start | On Windows, ensure bundled binaries are in `resources/postgresql/bin` |
| LAN access fails | Check Windows Firewall allows inbound on port 8787 for Private networks |
| Tray icon missing | App minimizes to tray on window close; check system tray (^) |
| Port 8787 in use | Change `portalPort` in `src/main.js` or stop conflicting service |

---

## 14. Files and Locations

| Data | Location |
|------|----------|
| App config / PostgreSQL data | `%APPDATA%\OB-Gyne Server Control Center TEST\` |
| Backups | `%APPDATA%\OB-Gyne Server Control Center TEST\backups\` |
| Portal assets (bundled) | Inside app.asar / unpacked resources |
| Logs | Activity log in dashboard; PostgreSQL log in data directory |

---

## 15. Reporting Test Results

After completing all tests, report:

1. **Which acceptance checks passed** (reference checklist above)
2. **Which features are simulated** (mock mode, firewall, updates, auth)
3. **Which require hands-on Windows 11 verification** (auto-start, firewall, network switching, bundled PostgreSQL)
4. **Any bugs or issues encountered** with steps to reproduce

---

**End of Test Guide**