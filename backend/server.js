const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const { exec } = require('child_process');
const path = require('path');
const cors = require('cors');

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

class HDHomeRunController {
  constructor() {
    this.devices = [];
    this.activeDevice = null;
    this.activeTuner = 0;
    this.monitoringInterval = null;
  }

  async discoverDevices() {
    return new Promise((resolve, reject) => {
      exec('hdhomerun_config discover', (error, stdout, stderr) => {
        if (error) {
          console.error('Discovery error:', error);
          resolve([]);
          return;
        }

        const devices = [];
        const lines = stdout.split('\n').filter(line => line.trim());
        
        lines.forEach(line => {
          const match = line.match(/hdhomerun device ([A-F0-9-]+) found at ([0-9.]+)/);
          if (match) {
            devices.push({
              id: match[1],
              ip: match[2],
              name: `HDHomeRun ${match[1]}`
            });
          }
        });

        this.devices = devices;
        resolve(devices);
      });
    });
  }

  async getDeviceInfo(deviceId) {
    return new Promise((resolve, reject) => {
      // Get both model and tuner count
      exec(`hdhomerun_config ${deviceId} get /sys/model`, (error, stdout) => {
        if (error) {
          resolve({ model: 'Unknown', tuners: 2 });
          return;
        }
        
        const model = stdout.trim();
        
        // Try to get actual tuner count by checking which tuners exist
        this.getTunerCount(deviceId).then(tunerCount => {
          resolve({ model, tuners: tunerCount });
        }).catch(() => {
          // Fallback to model-based detection
          let tuners = 2;
          if (model.includes('PRIME')) tuners = 3;
          else if (model.includes('QUATTRO') || model.includes('QUATRO')) tuners = 4;
          else if (model.includes('DUO')) tuners = 2;
          else if (model.includes('FLEX')) tuners = 2;
          else if (model.includes('CONNECT')) tuners = 2;
          
          resolve({ model, tuners });
        });
      });
    });
  }

  async getTunerCount(deviceId) {
    return new Promise((resolve, reject) => {
      // Check tuners 0-7 to see which ones exist
      const checkTuner = (tunerNum) => {
        return new Promise((resolveCheck) => {
          exec(`hdhomerun_config ${deviceId} get /tuner${tunerNum}/status`, (error, stdout) => {
            // If no error, tuner exists (even if status is 'none')
            resolveCheck(!error);
          });
        });
      };

      Promise.all([
        checkTuner(0), checkTuner(1), checkTuner(2), checkTuner(3),
        checkTuner(4), checkTuner(5), checkTuner(6), checkTuner(7)
      ]).then(results => {
        const tunerCount = results.filter(exists => exists).length;
        resolve(tunerCount > 0 ? tunerCount : 2); // Default to 2 if none found
      }).catch(() => {
        resolve(2); // Default fallback
      });
    });
  }

  async scanChannels(deviceId, tuner = 0, channelMap = 'us-bcast') {
    return new Promise((resolve, reject) => {
      const command = `hdhomerun_config ${deviceId} scan /tuner${tuner} ${channelMap}`;
      
      exec(command, { timeout: 60000 }, (error, stdout, stderr) => {
        if (error) {
          console.error('Scan error:', error);
          resolve([]);
          return;
        }

        const channels = [];
        const lines = stdout.split('\n');
        
        lines.forEach(line => {
          const scanMatch = line.match(/SCANNING: (\d+) \(([^)]+)\)/);
          const lockMatch = line.match(/LOCK: (\w+) \(ss=(\d+) snq=(\d+) seq=(\d+)\)/);
          const programMatch = line.match(/PROGRAM (\d+): ([\d.]+) (.+)/);
          
          if (scanMatch && lockMatch) {
            const frequency = scanMatch[1];
            const channel = scanMatch[2];
            const modulation = lockMatch[1];
            const signalStrength = parseInt(lockMatch[2]);
            const snr = parseInt(lockMatch[3]);
            const symbolQuality = parseInt(lockMatch[4]);
            
            channels.push({
              frequency,
              channel,
              modulation,
              signalStrength,
              snr,
              symbolQuality,
              programs: []
            });
          }
          
          if (programMatch && channels.length > 0) {
            const programNum = programMatch[1];
            const virtualChannel = programMatch[2];
            const name = programMatch[3];
            
            channels[channels.length - 1].programs.push({
              programNum,
              virtualChannel,
              name
            });
          }
        });

        resolve(channels);
      });
    });
  }

  async getTunerStatus(deviceId, tuner = 0) {
    return new Promise((resolve, reject) => {
      exec(`hdhomerun_config ${deviceId} get /tuner${tuner}/status`, (error, stdout) => {
        if (error) {
          resolve(null);
          return;
        }

        const status = {};
        const statusLine = stdout.trim();
        
        if (statusLine === 'none') {
          resolve({ channel: 'none', lock: false });
          return;
        }

        const patterns = {
          channel: /ch=([^\s]+)/,
          lock: /lock=([^\s]+)/,
          ss: /ss=(\d+)/,
          snq: /snq=(\d+)/,
          seq: /seq=(\d+)/,
          bps: /bps=(\d+)/,
          pps: /pps=(\d+)/
        };

        Object.entries(patterns).forEach(([key, pattern]) => {
          const match = statusLine.match(pattern);
          if (match) {
            status[key] = key === 'lock' ? match[1] : 
                         ['ss', 'snq', 'seq', 'bps', 'pps'].includes(key) ? 
                         parseInt(match[1]) : match[1];
          }
        });

        status.lock = status.lock !== undefined;
        resolve(status);
      });
    });
  }

  async getCurrentProgram(deviceId, tuner = 0) {
    return new Promise((resolve, reject) => {
      exec(`hdhomerun_config ${deviceId} get /tuner${tuner}/program`, (error, stdout) => {
        if (error) {
          resolve(null);
          return;
        }

        const program = stdout.trim();
        if (program && program !== 'none') {
          resolve(program);
        } else {
          resolve(null);
        }
      });
    });
  }

  async getCurrentChannelPrograms(deviceId, tuner = 0) {
    return new Promise((resolve, reject) => {
      exec(`hdhomerun_config ${deviceId} get /tuner${tuner}/streaminfo`, (error, stdout) => {
        if (error) {
          resolve([]);
          return;
        }

        const programs = [];
        const lines = stdout.split('\n').filter(line => line.trim());
        
        lines.forEach(line => {
          // Parse streaminfo output for program information
          // Format: tsid=0x0001 program=1: 12.1 WHYY (encrypted)
          const programMatch = line.match(/program=(\d+):\s*([\d.]+)\s+(.+?)(?:\s+\(([^)]+)\))?$/);
          if (programMatch) {
            const programNum = programMatch[1];
            const virtualChannel = programMatch[2];
            const name = programMatch[3].trim();
            const status = programMatch[4] || '';
            
            programs.push({
              programNum,
              virtualChannel,
              name,
              callsign: name,
              status,
              encrypted: status.includes('encrypted')
            });
          } else {
            // Try alternative format parsing for different output formats
            const altMatch = line.match(/(\d+):\s*([\d.]+)\s+(.+)/);
            if (altMatch) {
              programs.push({
                programNum: altMatch[1],
                virtualChannel: altMatch[2],
                name: altMatch[3].trim(),
                callsign: altMatch[3].trim(),
                status: '',
                encrypted: false
              });
            }
          }
        });

        resolve(programs);
      });
    });
  }

  async setChannel(deviceId, tuner, channel) {
    return new Promise((resolve, reject) => {
      exec(`hdhomerun_config ${deviceId} set /tuner${tuner}/channel ${channel}`, (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(stdout.trim());
      });
    });
  }

  async incrementChannel(deviceId, tuner) {
    return new Promise((resolve, reject) => {
      exec(`hdhomerun_config ${deviceId} set /tuner${tuner}/channel +`, (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(stdout.trim());
      });
    });
  }

  async decrementChannel(deviceId, tuner) {
    return new Promise((resolve, reject) => {
      exec(`hdhomerun_config ${deviceId} set /tuner${tuner}/channel -`, (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(stdout.trim());
      });
    });
  }

  async clearTuner(deviceId, tuner) {
    return new Promise((resolve, reject) => {
      exec(`hdhomerun_config ${deviceId} set /tuner${tuner}/channel none`, (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(stdout.trim());
      });
    });
  }

  startMonitoring(socket, deviceId, tuner) {
    this.stopMonitoring();
    
    this.monitoringInterval = setInterval(async () => {
      try {
        const status = await this.getTunerStatus(deviceId, tuner);
        const currentProgram = await this.getCurrentProgram(deviceId, tuner);
        
        socket.emit('tuner-status', {
          ...status,
          currentProgram
        });
      } catch (error) {
        console.error('Monitoring error:', error);
      }
    }, 1000);
  }

  stopMonitoring() {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }
  }
}

const hdhrController = new HDHomeRunController();

// API Routes
app.get('/api/devices', async (req, res) => {
  try {
    const devices = await hdhrController.discoverDevices();
    res.json(devices);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/devices/:id/info', async (req, res) => {
  try {
    const info = await hdhrController.getDeviceInfo(req.params.id);
    res.json(info);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/devices/:id/scan/:tuner', async (req, res) => {
  try {
    const { id, tuner } = req.params;
    const { channelMap = 'us-bcast' } = req.query;
    const channels = await hdhrController.scanChannels(id, tuner, channelMap);
    res.json(channels);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/devices/:id/tuner/:tuner/status', async (req, res) => {
  try {
    const { id, tuner } = req.params;
    const status = await hdhrController.getTunerStatus(id, tuner);
    res.json(status);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/devices/:id/tuner/:tuner/programs', async (req, res) => {
  try {
    const { id, tuner } = req.params;
    const programs = await hdhrController.getCurrentChannelPrograms(id, tuner);
    res.json(programs);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/devices/:id/tuner/:tuner/channel', async (req, res) => {
  try {
    const { id, tuner } = req.params;
    const { channel } = req.body;
    const result = await hdhrController.setChannel(id, tuner, channel);
    res.json({ success: true, result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/devices/:id/tuner/:tuner/channel/up', async (req, res) => {
  try {
    const { id, tuner } = req.params;
    const result = await hdhrController.incrementChannel(id, tuner);
    res.json({ success: true, result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/devices/:id/tuner/:tuner/channel/down', async (req, res) => {
  try {
    const { id, tuner } = req.params;
    const result = await hdhrController.decrementChannel(id, tuner);
    res.json({ success: true, result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/devices/:id/tuner/:tuner/clear', async (req, res) => {
  try {
    const { id, tuner } = req.params;
    const result = await hdhrController.clearTuner(id, tuner);
    res.json({ success: true, result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Socket.IO for real-time updates
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('start-monitoring', ({ deviceId, tuner }) => {
    console.log(`Starting monitoring for device ${deviceId}, tuner ${tuner}`);
    hdhrController.startMonitoring(socket, deviceId, tuner);
  });

  socket.on('stop-monitoring', () => {
    console.log('Stopping monitoring');
    hdhrController.stopMonitoring();
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    hdhrController.stopMonitoring();
  });
});

// Serve React app for all other routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`HDHomeRun Signal server running on port ${PORT}`);
});