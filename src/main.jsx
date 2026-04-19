import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

import { ThemeProvider } from './context/ThemeContext';
import { ProjectProvider } from './context/ProjectContext';
import { CompanyProvider } from './context/CompanyContext';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ThemeProvider>
      <CompanyProvider>
        <ProjectProvider>
          <App />
        </ProjectProvider>
      </CompanyProvider>
    </ThemeProvider>
  </StrictMode>,
);
