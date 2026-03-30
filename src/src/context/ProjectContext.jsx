import { createContext, useContext, useState, useEffect, useCallback } from 'react';

const ProjectContext = createContext(null);

const STORAGE_KEY = 'boqflow_project_settings';

const DEFAULT_PROJECT = {
    projectName: '',
    projectNumber: '',
    clientName: '',
    clientLogo: '',
    locationZone: '',
    siteEngineer: '',
    contractor: '',
    consultant: '',
    includeContractor: true,
    includeConsultant: true,
    issueDate: new Date().toISOString().split('T')[0],
    revision: 'Rev 0',
    mirReference: 'MIR-001',
    brandOrigin: '',
    unitOfMeasure: '',
    originatorName: '',
    originatorDesignation: '',
    clientRepName: '',
    clientRepDesignation: '',
};

export function ProjectProvider({ children }) {
    const [project, setProject] = useState(DEFAULT_PROJECT);

    useEffect(() => {
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            if (stored) {
                const parsed = JSON.parse(stored);
                setProject({ ...DEFAULT_PROJECT, ...parsed });
            }
        } catch (e) {
            console.warn('Failed to load project settings:', e);
        }
    }, []);

    const updateProject = useCallback((updates) => {
        setProject(prev => {
            const next = { ...prev, ...updates };
            try {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
            } catch (e) { }
            return next;
        });
    }, []);

    const resetProject = useCallback(() => {
        const fresh = { ...DEFAULT_PROJECT, issueDate: new Date().toISOString().split('T')[0] };
        setProject(fresh);
        try { localStorage.removeItem(STORAGE_KEY); } catch (e) { }
    }, []);

    return (
        <ProjectContext.Provider value={{ project, updateProject, resetProject }}>
            {children}
        </ProjectContext.Provider>
    );
}

export function useProject() {
    const ctx = useContext(ProjectContext);
    if (!ctx) throw new Error('useProject must be used within ProjectProvider');
    return ctx;
}

export default ProjectContext;
