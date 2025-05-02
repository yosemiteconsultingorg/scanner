import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import { PublicClientApplication } from '@azure/msal-browser';
import { MsalProvider } from '@azure/msal-react';
import { msalConfig } from './authConfig';
import { Providers } from '@microsoft/mgt-element'; // Import MGT Providers
import { Msal2Provider } from '@microsoft/mgt-msal2-provider'; // Import Msal2Provider

// Initialize MSAL instance
const msalInstance = new PublicClientApplication(msalConfig);

// Initialize MGT Provider
Providers.globalProvider = new Msal2Provider({
  publicClientApplication: msalInstance as any, // Cast to any to bypass type mismatch
  // Scopes needed by MGT components (ensure they are in msalConfig/graphScopes too)
  scopes: [
    'files.read',
    'files.read.all',
    'sites.read.all',
    'user.read',
    'openid',
    'profile'
    // Add 'offline_access' if needed
  ]
});


ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <MsalProvider instance={msalInstance}>
      <App />
    </MsalProvider>
  </React.StrictMode>,
)
