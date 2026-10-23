import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { BrandingProvider } from './components/common/BrandingContext.tsx';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrandingProvider><App /></BrandingProvider>
  </StrictMode>,
);
