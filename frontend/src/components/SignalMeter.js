import React, { useState, useEffect } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Button,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  LinearProgress,
  Grid,
  Chip,
  Paper,
  IconButton,
  Dialog,
  DialogTitle,
  List,
  ListItem,
  ListItemText,
  ListItemButton,
  CircularProgress,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Divider,
  Badge,
  TextField,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow
} from '@mui/material';
import {
  Refresh as RefreshIcon,
  Settings as SettingsIcon,
  KeyboardArrowLeft,
  KeyboardArrowRight,
  Radio as TuneIcon,
  SkipPrevious,
  SkipNext,
  Input as InputIcon,
  ExpandMore as ExpandMoreIcon,
  Tv as TvIcon,
  Stop as StopIcon,
  PowerOff as PowerOffIcon,
  GetApp as InstallIcon
} from '@mui/icons-material';
import axios from 'axios';
import io from 'socket.io-client';

const CHANNEL_MAPS = [
  { value: 'us-bcast', label: 'US Broadcast' },
  { value: 'us-cable', label: 'US Cable' },
  { value: 'us-hrc', label: 'US HRC' },
  { value: 'us-irc', label: 'US IRC' }
];

function SignalMeter() {
  const [devices, setDevices] = useState([]);
  const [selectedDevice, setSelectedDevice] = useState('');
  const [deviceInfo, setDeviceInfo] = useState(null);
  const [selectedTuner, setSelectedTuner] = useState(0);
  const [channelMap, setChannelMap] = useState('us-bcast');
  const [selectedChannel, setSelectedChannel] = useState('');
  const [tunerStatus, setTunerStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [socket, setSocket] = useState(null);
  const [directChannel, setDirectChannel] = useState('');
  const [currentChannelPrograms, setCurrentChannelPrograms] = useState([]);
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [showInstallButton, setShowInstallButton] = useState(false);

  useEffect(() => {
    discoverDevices();
    const newSocket = io();
    setSocket(newSocket);

    newSocket.on('tuner-status', (status) => {
      setTunerStatus(status);
    });

    // PWA install prompt handling
    const handleBeforeInstallPrompt = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setShowInstallButton(true);
    };

    const handleAppInstalled = () => {
      setShowInstallButton(false);
      setDeferredPrompt(null);
    };

    // Check if already installed
    if (window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone) {
      setShowInstallButton(false);
    } else {
      setShowInstallButton(true);
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      newSocket.close();
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  useEffect(() => {
    if (selectedDevice && socket) {
      socket.emit('start-monitoring', { 
        deviceId: selectedDevice, 
        tuner: selectedTuner 
      });
    }
    return () => {
      if (socket) {
        socket.emit('stop-monitoring');
      }
    };
  }, [selectedDevice, selectedTuner, socket]);

  // Update directChannel input field when tuner status changes
  useEffect(() => {
    if (tunerStatus?.channel) {
      if (tunerStatus.channel === 'none') {
        // Tuner is cleared/stopped
        setDirectChannel('');
        setCurrentChannelPrograms([]);
      } else {
        // Extract broadcast channel from status (e.g., "auto:4" -> "4", "13" -> "13")
        const channelMatch = tunerStatus.channel.match(/(?:auto:)?(\d+)/);
        if (channelMatch) {
          setDirectChannel(channelMatch[1]);
        }
      }
    }
  }, [tunerStatus?.channel]);

  const discoverDevices = async () => {
    setLoading(true);
    try {
      const response = await axios.get('/api/devices');
      setDevices(response.data);
      if (response.data.length > 0) {
        setSelectedDevice(response.data[0].id);
        await getDeviceInfo(response.data[0].id);
      }
    } catch (error) {
      console.error('Failed to discover devices:', error);
    }
    setLoading(false);
  };

  const getDeviceInfo = async (deviceId) => {
    try {
      const response = await axios.get(`/api/devices/${deviceId}/info`);
      setDeviceInfo(response.data);
    } catch (error) {
      console.error('Failed to get device info:', error);
    }
  };



  const tuneToDirectChannel = async (channel) => {
    if (!selectedDevice || !channel) return;
    
    try {
      await axios.post(`/api/devices/${selectedDevice}/tuner/${selectedTuner}/channel`, {
        channel
      });
      setSelectedChannel(channel);
      setDirectChannel('');
      // Wait a bit for the tuner to lock, then get programs
      setTimeout(async () => {
        await getCurrentChannelPrograms();
      }, 2000);
    } catch (error) {
      console.error('Failed to set channel:', error);
    }
  };

  const getCurrentChannelPrograms = async () => {
    if (!selectedDevice) return;
    
    try {
      const response = await axios.get(`/api/devices/${selectedDevice}/tuner/${selectedTuner}/programs`);
      setCurrentChannelPrograms(response.data);
    } catch (error) {
      console.error('Failed to get current channel programs:', error);
      setCurrentChannelPrograms([]);
    }
  };

  const incrementChannel = async () => {
    if (!selectedDevice) return;
    
    // Use the tracked directChannel state or extract from tuner status as fallback
    let currentChannelNum = parseInt(directChannel) || 1;
    
    // If directChannel is empty or invalid, try to extract from tuner status
    if (!currentChannelNum && tunerStatus?.channel) {
      const channelMatch = tunerStatus.channel.match(/(?:auto:)?(\d+)/);
      currentChannelNum = channelMatch ? parseInt(channelMatch[1]) : 1;
    }
    
    const nextChannel = Math.min(36, currentChannelNum + 1);
    
    try {
      await tuneToDirectChannel(nextChannel.toString());
    } catch (error) {
      console.error('Failed to increment channel:', error);
    }
  };

  const decrementChannel = async () => {
    if (!selectedDevice) return;
    
    // Use the tracked directChannel state or extract from tuner status as fallback
    let currentChannelNum = parseInt(directChannel) || 1;
    
    // If directChannel is empty or invalid, try to extract from tuner status
    if (!currentChannelNum && tunerStatus?.channel) {
      const channelMatch = tunerStatus.channel.match(/(?:auto:)?(\d+)/);
      currentChannelNum = channelMatch ? parseInt(channelMatch[1]) : 1;
    }
    
    const prevChannel = Math.max(1, currentChannelNum - 1);
    
    try {
      await tuneToDirectChannel(prevChannel.toString());
    } catch (error) {
      console.error('Failed to decrement channel:', error);
    }
  };

  const clearTuner = async () => {
    if (!selectedDevice) return;
    
    try {
      await axios.post(`/api/devices/${selectedDevice}/tuner/${selectedTuner}/clear`);
      setDirectChannel('');
      setCurrentChannelPrograms([]);
    } catch (error) {
      console.error('Failed to clear tuner:', error);
    }
  };

  const handleInstallClick = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      console.log(`User response to the install prompt: ${outcome}`);
      setDeferredPrompt(null);
      setShowInstallButton(false);
    }
  };

  const getSignalColor = (value) => {
    if (value >= 80) return '#4CAF50';
    if (value >= 60) return '#FF9800';
    return '#F44336';
  };

  const formatDataRate = (bps) => {
    if (!bps) return '0.000 Mbps';
    return (bps / 1000000).toFixed(3) + ' Mbps';
  };

  return (
    <Box>
      <Grid container spacing={1}>
        {/* Device Selection */}
        <Grid item xs={12}>
          <Card>
            <CardContent sx={{ py: 1, '&:last-child': { pb: 1 } }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                <FormControl sx={{ minWidth: 180, flex: 1 }} size="small">
                  <InputLabel>Device</InputLabel>
                  <Select
                    value={selectedDevice}
                    label="Device"
                    onChange={async (e) => {
                      setSelectedDevice(e.target.value);
                      await getDeviceInfo(e.target.value);
                    }}
                  >
                    {devices.map((device) => (
                      <MenuItem key={device.id} value={device.id}>
                        {device.id}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <Button
                  variant="outlined"
                  onClick={discoverDevices}
                  disabled={loading}
                  sx={{ minWidth: 'auto', px: 1 }}
                  size="small"
                >
                  <RefreshIcon />
                </Button>
                {showInstallButton && (
                  <Button
                    variant="contained"
                    onClick={handleInstallClick}
                    color="primary"
                    sx={{ minWidth: 'auto', px: 1 }}
                    size="small"
                  >
                    <InstallIcon />
                  </Button>
                )}
              </Box>
            </CardContent>
          </Card>
        </Grid>

        {/* Signal Display */}
        {selectedDevice && (
          <Grid item xs={12}>
            <Card>
              <CardContent sx={{ py: 1, '&:last-child': { pb: 1 } }}>
                {/* Channel Info and Controls */}
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1, flexWrap: 'wrap', gap: 1 }}>
                  <Typography variant="h6" sx={{ fontSize: '1.1rem', minWidth: 'fit-content' }}>
                    {!tunerStatus?.channel || tunerStatus.channel === 'none' ? 'Stopped' : tunerStatus.channel}
                  </Typography>
                  
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap' }}>
                    <TextField
                      label="CH"
                      variant="outlined"
                      size="small"
                      value={directChannel}
                      onChange={(e) => setDirectChannel(e.target.value)}
                      onKeyPress={(e) => {
                        if (e.key === 'Enter') {
                          tuneToDirectChannel(directChannel);
                        }
                      }}
                      placeholder="36"
                      sx={{ 
                        width: 60,
                        '& .MuiOutlinedInput-root': {
                          paddingLeft: 0,
                          paddingRight: 0,
                        },
                        '& .MuiOutlinedInput-input': {
                          padding: '6px 4px',
                          textAlign: 'center',
                          fontSize: '14px'
                        }
                      }}
                      disabled={!selectedDevice}
                      inputProps={{ maxLength: 2 }}
                    />
                    <Button variant="contained" onClick={() => tuneToDirectChannel(directChannel)} disabled={!selectedDevice || !directChannel} size="small" sx={{ minWidth: 'auto', px: 1 }}>
                      <TuneIcon />
                    </Button>
                    <Button variant="outlined" onClick={decrementChannel} disabled={!selectedDevice} size="small" sx={{ minWidth: 'auto', px: 1 }}>
                      <SkipPrevious />
                    </Button>
                    <Button variant="outlined" onClick={incrementChannel} disabled={!selectedDevice} size="small" sx={{ minWidth: 'auto', px: 1 }}>
                      <SkipNext />
                    </Button>
                    <Button variant="contained" color="error" onClick={clearTuner} disabled={!selectedDevice || tunerStatus?.channel === 'none'} size="small" sx={{ minWidth: 'auto', px: 1 }}>
                      <StopIcon />
                    </Button>
                  </Box>
                </Box>
                
                {/* Compact Signal Display */}
                {tunerStatus?.lock ? (
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center' }}>
                    <Box sx={{ flex: '1 1 120px', minWidth: 120 }}>
                      <Typography variant="body2" sx={{ fontSize: '0.75rem', mb: 0.5 }}>Signal: {tunerStatus.ss || 0}%</Typography>
                      <LinearProgress variant="determinate" value={tunerStatus.ss || 0} sx={{ height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.1)', '& .MuiLinearProgress-bar': { backgroundColor: getSignalColor(tunerStatus.ss || 0) } }} />
                    </Box>
                    <Box sx={{ flex: '1 1 120px', minWidth: 120 }}>
                      <Typography variant="body2" sx={{ fontSize: '0.75rem', mb: 0.5 }}>SNR: {tunerStatus.snq || 0}%</Typography>
                      <LinearProgress variant="determinate" value={tunerStatus.snq || 0} sx={{ height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.1)', '& .MuiLinearProgress-bar': { backgroundColor: getSignalColor(tunerStatus.snq || 0) } }} />
                    </Box>
                    <Box sx={{ flex: '1 1 120px', minWidth: 120 }}>
                      <Typography variant="body2" sx={{ fontSize: '0.75rem', mb: 0.5 }}>Sym: {tunerStatus.seq || 0}%</Typography>
                      <LinearProgress variant="determinate" value={tunerStatus.seq || 0} sx={{ height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.1)', '& .MuiLinearProgress-bar': { backgroundColor: getSignalColor(tunerStatus.seq || 0) } }} />
                    </Box>
                    <Box sx={{ flex: '1 1 100px', minWidth: 100, textAlign: 'right' }}>
                      <Typography variant="body2" sx={{ fontSize: '0.75rem' }}>Rate</Typography>
                      <Typography variant="body1" sx={{ fontSize: '0.9rem', fontWeight: 500 }}>{formatDataRate(tunerStatus.bps)}</Typography>
                    </Box>
                  </Box>
                ) : (
                  <Typography variant="body2" sx={{ textAlign: 'center', py: 1, color: 'text.secondary' }}>
                    No signal detected
                  </Typography>
                )}
              </CardContent>
            </Card>
          </Grid>
        )}

        {/* Controls */}
        {selectedDevice && (
          <Grid item xs={12}>
            <Card>
              <CardContent sx={{ py: 1, '&:last-child': { pb: 1 } }}>
                <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                  <FormControl sx={{ minWidth: 140, flex: 1 }} size="small">
                    <InputLabel>Channel Map</InputLabel>
                    <Select
                      value={channelMap}
                      label="Channel Map"
                      onChange={(e) => setChannelMap(e.target.value)}
                    >
                      {CHANNEL_MAPS.map((map) => (
                        <MenuItem key={map.value} value={map.value}>
                          {map.label}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>

                  {deviceInfo && (
                    <FormControl sx={{ minWidth: 100 }} size="small">
                      <InputLabel>Tuner</InputLabel>
                      <Select
                        value={selectedTuner}
                        label="Tuner"
                        onChange={(e) => setSelectedTuner(e.target.value)}
                      >
                        {Array.from({ length: deviceInfo.tuners }, (_, i) => (
                          <MenuItem key={i} value={i}>
                            Tuner {i}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  )}
                </Box>
              </CardContent>
            </Card>
          </Grid>
        )}

        {/* Current Channel Programs */}
        {selectedDevice && currentChannelPrograms.length > 0 && (
          <Grid item xs={12}>
            <Card>
              <CardContent sx={{ py: 1, '&:last-child': { pb: 1 } }}>
                <Typography variant="body1" sx={{ fontSize: '0.9rem', mb: 1, fontWeight: 500 }}>
                  Programs on Channel {tunerStatus?.channel?.split(':')[0] || 'Unknown'}
                </Typography>
                <TableContainer component={Paper} sx={{ backgroundColor: 'transparent', boxShadow: 'none' }}>
                  <Table size="small" sx={{ '& .MuiTableCell-root': { py: 0.5, fontSize: '0.8rem' } }}>
                    <TableHead>
                      <TableRow>
                        <TableCell sx={{ fontWeight: 600 }}>PID</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>Virtual</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>Call Sign</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>Status</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>Action</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {currentChannelPrograms.map((program, index) => (
                        <TableRow key={index}>
                          <TableCell>{program.programNum}</TableCell>
                          <TableCell>
                            <Chip 
                              label={program.virtualChannel} 
                              size="small" 
                              color="primary" 
                              variant="outlined"
                              sx={{ height: 20, fontSize: '0.7rem' }}
                            />
                          </TableCell>
                          <TableCell>{program.callsign}</TableCell>
                          <TableCell>
                            {program.encrypted && (
                              <Chip label="Encrypted" size="small" color="warning" sx={{ height: 18, fontSize: '0.65rem' }} />
                            )}
                            {program.status && !program.encrypted && (
                              <Chip label={program.status} size="small" sx={{ height: 18, fontSize: '0.65rem' }} />
                            )}
                          </TableCell>
                          <TableCell>
                            <Button
                              size="small"
                              variant="outlined"
                              onClick={() => tuneToDirectChannel(`${tunerStatus?.channel?.split(':')[0]}:${program.programNum}`)}
                              sx={{ minWidth: 'auto', px: 1, py: 0.25, fontSize: '0.7rem' }}
                            >
                              Tune
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </CardContent>
            </Card>
          </Grid>
        )}
      </Grid>

    </Box>
  );
}

export default SignalMeter;
