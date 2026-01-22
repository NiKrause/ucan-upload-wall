import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

const globalOverrides = globalThis as typeof globalThis & {
  __HELIA_BOOTSTRAP__?: { peerId: string; addrs: string[] };
};
if (!globalOverrides.__HELIA_BOOTSTRAP__) {
  const peerId = import.meta.env.VITE_HELIA_PEER_ID;
  const addrs = import.meta.env.VITE_HELIA_ADDRS
    ? String(import.meta.env.VITE_HELIA_ADDRS)
        .split(',')
        .map((addr: string) => addr.trim())
        .filter(Boolean)
    : [];
  const derivedPeerId =
    !peerId && addrs.length > 0
      ? addrs[0].split('/p2p/')[1] || ''
      : '';
  const finalPeerId = peerId || derivedPeerId;
  if (finalPeerId && addrs.length > 0) {
    globalOverrides.__HELIA_BOOTSTRAP__ = { peerId: finalPeerId, addrs };
    console.log('🟣 Helia bootstrap configured from env');
  }
}
if (globalOverrides.__HELIA_BOOTSTRAP__) {
  console.log('🟣 Helia bootstrap active:', globalOverrides.__HELIA_BOOTSTRAP__);
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
