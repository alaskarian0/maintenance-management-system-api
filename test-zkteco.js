/**
 * ZKTeco Device Connection Test
 * 
 * Usage: node test-zkteco.js [IP] [PORT]
 * Default: 192.168.1.123:4370
 */

const ZKAttendanceClient = require('zk-attendance-sdk');

const ip = process.argv[2] || '192.168.1.123';
const port = parseInt(process.argv[3] || '4370', 10);

console.log('========================================');
console.log('  ZKTeco Device Connection Test');
console.log('========================================');
console.log(`  Target: ${ip}:${port}`);
console.log(`  Time:   ${new Date().toISOString()}`);
console.log('========================================\n');

// Catch unhandled rejections from SDK
process.on('unhandledRejection', (reason) => {
  // Silently ignore - we handle errors per-call
});

const client = new ZKAttendanceClient(ip, port, 5200, 5000);

function errStr(e) {
  if (!e) return 'Unknown error';
  if (e.message) return e.message;
  if (typeof e === 'string') return e;
  return String(e);
}

async function safeCall(label, fn) {
  try {
    const result = await fn();
    return result;
  } catch (e) {
    console.log(`       ${label}: ${errStr(e)}`);
    return null;
  }
}

async function testConnection() {
  try {
    console.log('[1/6] Attempting to connect...');
    await client.createSocket();
    console.log('       SUCCESS: Connected to device via TCP!\n');

    console.log(`[2/6] Connection type: ${client.getConnectionType()}\n`);

    // Device info
    console.log('[3/6] Fetching device information...');
    const info = await safeCall('Could not fetch device info', () => client.getInfo());
    if (info) console.log('       Device info:', JSON.stringify(info, null, 2));
    console.log();

    // Device details
    console.log('[4/6] Fetching device details...');
    const name = await safeCall('Name unavailable', () => client.getDeviceName());
    if (name !== null) console.log(`       Device name:   ${name}`);

    const serial = await safeCall('Serial unavailable', () => client.getSerialNumber());
    if (serial !== null) console.log(`       Serial number: ${serial}`);

    const fw = await safeCall('Firmware unavailable', () => client.getFirmware());
    if (fw !== null) console.log(`       Firmware:      ${fw}`);

    const ver = await safeCall('Version unavailable', () => client.getDeviceVersion());
    if (ver !== null) console.log(`       Version:       ${ver}`);

    const plat = await safeCall('Platform unavailable', () => client.getPlatform());
    if (plat !== null) console.log(`       Platform:      ${plat}`);

    const os = await safeCall('OS unavailable', () => client.getOS());
    if (os !== null) console.log(`       OS:            ${os}`);

    const time = await safeCall('Time unavailable', () => client.getTime());
    if (time !== null) console.log(`       Device time:   ${time}`);
    console.log();

    // Users
    console.log('[5/6] Fetching users...');
    const usersResult = await safeCall('Could not fetch users', () => client.getUsers());
    if (usersResult && usersResult.data) {
      console.log(`       Total users on device: ${usersResult.data.length}`);
      if (usersResult.data.length > 0) {
        console.log('       Sample users:');
        usersResult.data.slice(0, 5).forEach(u => {
          console.log(`         - UID:${u.uid} | ID:${u.userid} | Name:${u.name || 'N/A'}`);
        });
      }
    }
    console.log();

    // Attendance logs
    console.log('[6/6] Fetching attendance logs...');
    const logsResult = await safeCall('Could not fetch attendance', () => client.getAttendances());
    if (logsResult && logsResult.data) {
      console.log(`       Total attendance records: ${logsResult.data.length}`);
      if (logsResult.data.length > 0) {
        console.log('       Recent logs:');
        logsResult.data.slice(-5).forEach(l => {
          console.log(`         - User:${l.deviceUserId} | Time:${l.recordTime} | Type:${l.recordType || 'N/A'}`);
        });
      }
    }
    console.log();

    // Disconnect
    console.log('Disconnecting...');
    try { await client.disconnect(); } catch (_) {}

    console.log('\n========================================');
    console.log('  CONNECTION TEST: PASSED');
    console.log('  Device is reachable and responding');
    console.log('========================================');

    process.exit(0);
  } catch (error) {
    console.error('\n========================================');
    console.error('  CONNECTION TEST: FAILED');
    console.error('========================================');
    console.error('  Error:', errStr(error));
    console.error();
    console.error('  Troubleshooting:');
    console.error('  1. Check device is powered on');
    console.error('  2. Verify IP address is correct (ping ' + ip + ')');
    console.error('  3. Ensure port 4370 is open on the device');
    console.error('  4. Check firewall allows TCP/UDP to device');
    console.error('  5. Verify you are on the same network');
    console.error('========================================');

    process.exit(1);
  }
}

testConnection();
