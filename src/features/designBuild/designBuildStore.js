// Design & Build link: one small shared store for the Design & Build modal, so the
// modal (and the 3D model inside it) survives BOQ Flow's own page changes. The
// modal itself is mounted once, next to the app (see DesignBuildDock).
import { useSyncExternalStore } from 'react';

export const DESIGN_BUILD_URL = String(import.meta.env.VITE_DESIGN_BUILD_URL || 'https://design-and-build-v2.vercel.app').replace(/\/+$/, '');

export const DESIGN_BUILD_ORIGIN = (() => {
    try {
        return new URL(DESIGN_BUILD_URL).origin;
    } catch {
        return 'https://design-and-build-v2.vercel.app';
    }
})();

const AUTO_KEY = 'boqflow.designBuild.auto';

const initial = {
    session: 0,         // increases each time a new session opens
    open: false,        // a Design & Build session exists (its iframe is mounted)
    minimized: false,   // modal tucked into a chip; the 3D model stays loaded
    plan: null,         // { file, name, token }
    status: 'idle',     // idle | connecting | building | ready
    stage: '',
    counts: null,       // { walls, glassWalls, curvedWalls, windows, doors, items }
    error: null,
    products: [],       // BOQ lines with their chosen products (sent for furnishing)
    productsToken: 0,
};

let state = { ...initial };
const listeners = new Set();
const emit = () => listeners.forEach((l) => l());

export const designBuild = {
    getState: () => state,
    subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
    },
    set(patch) {
        state = { ...state, ...patch };
        emit();
    },
    /** Send a plan to Design & Build and open its modal. */
    openWithPlan(file) {
        const token = (state.plan?.token || 0) + 1;
        state = {
            ...state,
            session: state.open ? state.session : state.session + 1,
            open: true,
            minimized: false,
            plan: { file, name: file.name, token },
            status: 'connecting',
            stage: 'Opening Design & Build…',
            counts: null,
            error: null,
        };
        emit();
    },
    minimize() {
        designBuild.set({ minimized: true });
    },
    restore() {
        designBuild.set({ minimized: false });
    },
    /** End the session; the 3D model is discarded. */
    close() {
        state = { ...initial, session: state.session };
        emit();
    },
    setProducts(products) {
        designBuild.set({ products, productsToken: state.productsToken + 1 });
    },
};

export function useDesignBuild() {
    return useSyncExternalStore(designBuild.subscribe, designBuild.getState);
}

export function isPdfFile(file) {
    return !!file && (file.type === 'application/pdf' || /\.pdf$/i.test(file.name || ''));
}

/** Whether plan uploads also open Design & Build (on unless the user turned it off). */
export function getAutoDesignBuild() {
    try {
        return localStorage.getItem(AUTO_KEY) !== 'off';
    } catch {
        return true;
    }
}

export function setAutoDesignBuild(on) {
    try {
        localStorage.setItem(AUTO_KEY, on ? 'on' : 'off');
    } catch {
        // storage unavailable: the choice lasts for this visit only
    }
}

if (import.meta.env.DEV && typeof window !== 'undefined') {
    window.__boqDesignBuild = designBuild;
}
