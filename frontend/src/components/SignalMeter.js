// backend/server.js
/* eslint-disable no-console */
/* const path = require('path'); */
const express = require('express');
/* const cors = require('cors'); */
const http = require('http');
const { Server } = require('socket.io');
const { execFile } = require('child_process');
const bodyParser = require('body-parser');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(bodyParser.json());

// ------------------------
// Helpers
// ------------------------
function execHdhr(args, { timeout = 8000 } = {}) {
  return new Promise((resolve, reject) => {
    execFile('hdhomerun_config', args, { timeout }, (err, stdout, stderr) => {
      if (err) {
        err.stdout = stdout?.toString() || '';
        err.stderr = stderr?.toString() || '';
        return reject(err);
      }
      resolve(stdout.toString());
    });
  });
}

function parseDiscover(output) {
  // lines like: "hdhomerun device 12345678 found at 192.168.1.50"
  const devices = [];
  output.split('\n').forEach((line) => {
    const m = line.match(/hdhomerun device ([0-9A-Fa-f]+) found at ([0-9.]+)/);
    if (m) devices.push({ id: m[1], ip: m[2] });
  });
  return devices;
}

async function countTuners(deviceId) {
  // Probe tuner indices until an error occurs
  let count = 0;
  // Many units have up to 4 tuners; probe conservatively up to 8
  // Stop on first failure.
  for (let i = 0; i < 8; i += 1) {
    try {
      await execHdhr([deviceId, 'get', `/tuner${i}/status`]);
      count += 1;
    } catch {
      break;
    }
  }
  return count || 2; // default guess
}

function parseStatus(output) {
  // Example DVB-T/T2 or ATSC line typically includes:
  // channel=auto:650000000 lock=8vsb ss=85 snq=92 seq=100 bps=12345678 pps=123
  const obj = {};
  const parts = output.trim().split(/\s+/);
  parts.forEach((kv) => {
    const [k, v] = kv.split('=');
    obj[k] = v;
  });
  // Normalize numbers
  ['ss', 'snq', 'seq', 'bps', 'pps'].forEach((k) => {
    if (obj[k] != null) obj[k] = Number(String(obj[k]).replace(/[^0-9.-]/g, '')) || 0;
  });
  obj.channel = obj.channel || 'none';
  obj.lock = obj.lock || '';
  return obj;
}

function parseStreamInfo(output) {
  // Try to extract program list from `get /tunerX/streaminfo`
  // Lines often include things like:
  // "program 101:  virtual 3.1  (CALLSIGN)  type=Video ...  encrypted=1/0"
  const programs = [];
  const lines = output.split('\n');
  lines.forEach((line) => {
    const m = line.match(/program\s+(\d+).*?virtual\s+([0-9.]+)?\s*\(?([A-Za-z0-9 _.-]+)?\)?/i);
    if (m) {
      const encrypted = /encrypted\s*=\s*1/i.test(line);
      // status hint (e.g., "ok", "partial", etc.) if present
      const status = (/status\s*=\s*([A-Za-z0-9_-]+)/i.exec(line) || [])[1];
      programs.push({
        programNum: Number(m[1]),
        virtualChannel: m[2] || '',
        callsign: (m[3] || '').trim(),
        encrypted,
        status: status || ''
      });
    }
  });
  return programs;
}

function parseSysModel(output) {
  const m = output.match(/Model\s*:\s*(.+)/i);
  return m ? m[1].trim() : 'Unknown';
}

// ------------------------
// REST API
// ------------------------

// Discover devices
app.get('/api/devices', async (req, res) => {
  try {
    const out = await execHdhr(['discover']);
    const devices = parseDiscover(out);
    res.json(devices);
  } catch (e) {
    console.error('discover error:', e.stderr || e.message);
    res.status(500).json({ error: 'Failed to discover devices', detail: e.stderr || e.message });
  }
});

// Device info (model + tuner count)
app.get('/api/devices/:id/info', async (req, res) => {
  const { id } = req.params;
  try {
    const sysInfo = await execHdhr([id, 'get', '/sys/model']).catch(async () => {
      // some firmware prints model inside /sys/debug
      const dbg = await execHdhr([id, 'get', '/sys/debug']);
      return parseSysModel(dbg);
    });
    const model = (sysInfo || '').toString().trim().replace(/^model\s*=/i, '') || parseSysModel(sysInfo);
    const tuners = await countTuners(id);
    res.json({ id, model, tuners });
  } catch (e) {
    console.error('info error:', e.stderr || e.message);
    res.status(500).json({ error: 'Failed to get device info', detail: e.stderr || e.message });
  }
});

// Set channel map (e.g., eu-bcast, us-bcast, etc.)
app.post('/api/devices/:id/tuner/:tuner/channelmap', async (req, res) => {
  const { id, tuner } = req.params;
  const { map } = req.body;
  if (!map) return res.status(400).json({ error: 'map is required' });
  try {
    await execHdhr([id, 'set', `/tuner${tuner}/channelmap`, map]);
    res.json({ ok: true });
  } catch (e) {
    console.error('set channelmap error:', e.stderr || e.message);
    res.status(500).json({ error: 'Failed to set channel map', detail: e.stderr || e.message });
  }
});

// Tune channel (accepts channel formats: "21", "auto:650000000", "auto:650000000:101", "21:101")
app.post('/api/devices/:id/tuner/:tuner/channel', async (req, res) => {
  const { id, tuner } = req.params;
  let { channel } = req.body;
  if (!channel) return res.status(400).json({ error: 'channel is required' });

  try {
    // Support combined "channel:program"
    let program = null;
    if (channel.includes(':')) {
      const parts = channel.split(':');
      if (parts.length >= 3) {
        // e.g., "auto:650000000:101"
        program = parts[2];
        channel = `${parts[0]}:${parts[1]}`;
      } else if (parts.length === 2 && /^\d+$/.test(parts[1])) {
        // e.g., "21:101"
        program = parts[1];
        channel = parts[0];
      }
    }

    // Set channel
    await execHdhr([id, 'set', `/tuner${tuner}/channel`, channel]);

    // If a program number is provided, set it
    if (program) {
      await execHdhr([id, 'set', `/tuner${tuner}/program`, String(program)]);
    }

    res.json({ ok: true, channel, program: program ? Number(program) : null });
  } catch (e) {
    console.error('set channel error:', e.stderr || e.message);
    res.status(500).json({ error: 'Failed to set channel', detail: e.stderr || e.message });
  }
});

// Clear tuner
app.post('/api/devices/:id/tuner/:tuner/clear', async (req, res) => {
  const { id, tuner } = req.params;
  try {
    await execHdhr([id, 'set', `/tuner${tuner}/channel`, 'none']);
    await execHdhr([id, 'set', `/tuner${tuner}/program`, 'none']).catch(() => {});
    res.json({ ok: true });
  } catch (e) {
    console.error('clear tuner error:', e.stderr || e.message);
    res.status(500).json({ error: 'Failed to clear tuner', detail: e.stderr || e.message });
  }
});

// Current channel programs
app.get('/api/devices/:id/tuner/:tuner/programs', async (req, res) => {
  const { id, tuner } = req.params;
  try {
    // streaminfo is light-weight and usually available when tuned
    const out = await execHdhr([id, 'get', `/tuner${tuner}/streaminfo`]);
    const programs = parseStreamInfo(out);
    res.json(programs);
  } catch (e) {
    console.warn('streaminfo failed, returning empty list:', e.stderr || e.message);
    res.json([]); // safe fallback
  }
});

// ------------------------
// Socket.IO – live tuner status
// ------------------------
const monitorState = new Map(); // socket.id -> interval handle

io.on('connection', (socket) => {
  socket.on('start-monitoring', ({ deviceId, tuner }) => {
    // Clear existing interval if any
    const prev = monitorState.get(socket.id);
    if (prev) clearInterval(prev);

    const handle = setInterval(async () => {
      try {
        const out = await execHdhr([deviceId, 'get', `/tuner${tuner}/status`], { timeout: 4000 });
        const status = parseStatus(out);
        socket.emit('tuner-status', status);
      } catch (e) {
        // If tuner is idle or device not reachable, emit a minimal status
        socket.emit('tuner-status', { channel: 'none', lock: '', ss: 0, snq: 0, seq: 0, bps: 0, pps: 0 });
      }
    }, 1000);

    monitorState.set(socket.id, handle);
  });

  socket.on('stop-monitoring', () => {
    const handle = monitorState.get(socket.id);
    if (handle) clearInterval(handle);
    monitorState.delete(socket.id);
  });

  socket.on('disconnect', () => {
    const handle = monitorState.get(socket.id);
    if (handle) clearInterval(handle);
    monitorState.delete(socket.id);
  });
});

// ------------------------
// Serve frontend (if building a single image)
// ------------------------
const FRONTEND_BUILD = path.join(__dirname, '..', 'frontend', 'build');
app.use(express.static(FRONTEND_BUILD));
app.get('*', (req, res) => {
  res.sendFile(path.join(FRONTEND_BUILD, 'index.html'));
});

// ------------------------
// Start server
// ------------------------
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`HDHomeRun Signal backend listening on port ${PORT}`);
});
