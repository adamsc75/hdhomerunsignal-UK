import React, { useState, useEffect } from 'react';
import {
  ThemeProvider,
  createTheme,
  CssBaseline,
  Container,
  AppBar,
  Toolbar,
  Typography,
  Box
} from '@mui/material';
import SignalMeter from './components/SignalMeter';

const darkTheme = createTheme({
  palette: {
    mode: 'dark',
    primary: {
      main: '#4CAF50',
    },
    secondary: {
      main: '#FF9800',
    },
    background: {
      default: '#1e1e1e',
      paper: '#2d2d2d',
    },
  },
  components: {
    MuiAppBar: {
      styleOverrides: {
        root: {
          background: 'linear-gradient(135deg, #2d2d2d 0%, #3d3d3d 100%)',
        },
      },
    },
  },
});

function App() {
  return (
    <ThemeProvider theme={darkTheme}>
      <CssBaseline />
      <Box sx={{ flexGrow: 1 }}>
        <AppBar position="static" elevation={0}>
          <Toolbar sx={{ minHeight: '48px !important', py: 0 }}>
            <Typography variant="h6" component="div" sx={{ flexGrow: 1, fontSize: '1.1rem' }}>
              HDHomeRun Signal
            </Typography>
          </Toolbar>
        </AppBar>
        <Container maxWidth="md" sx={{ mt: 1, px: 1 }}>
          <SignalMeter />
        </Container>
      </Box>
    </ThemeProvider>
  );
}

export default App;