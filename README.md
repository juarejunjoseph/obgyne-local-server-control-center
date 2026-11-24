# OB-Gyne Local Server Control Center

Test-only Electron prototype for monitoring and controlling a future local OB-Gyne clinic server.

## Current prototype

- Starts a fictional local portal on port 8787.
- Displays current LAN addresses and portal URLs.
- Detects whether PostgreSQL is listening on local port 5432.
- Shows recently connected client IP addresses.
- Provides functional start, stop, restart, and open-portal controls.
- Creates safe test backup marker files containing no patient data.
- Keeps SQL import, SQL restore, firewall changes, and Supabase sync disabled.

## Run locally

Install dependencies and run:

    npm install
    npm start

## Build targets

    npm run dist:win
    npm run dist:mac

The Windows installer must be tested on a clean Windows 11 computer before production work.

## Safety

This branch is for fictional test data only. It does not connect to the production OB-Gyne repository, Netlify, or Supabase.
