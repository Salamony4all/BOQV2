/**
 * nodePolyfills.js
 * Polyfills for browser-only Web APIs used by pdfjs-dist in Node.js / Vercel.
 * MUST be imported BEFORE pdfjs-dist is loaded (via server.js static import).
 * These stubs run at module-level and set globalThis before any lazy import fires.
 */

if (typeof globalThis.DOMMatrix === 'undefined') {
    class DOMMatrix {
        constructor(init) {
            this.a = 1; this.b = 0; this.c = 0; this.d = 1; this.e = 0; this.f = 0;
            this.m11 = 1; this.m12 = 0; this.m13 = 0; this.m14 = 0;
            this.m21 = 0; this.m22 = 1; this.m23 = 0; this.m24 = 0;
            this.m31 = 0; this.m32 = 0; this.m33 = 1; this.m34 = 0;
            this.m41 = 0; this.m42 = 0; this.m43 = 0; this.m44 = 1;
            this.is2D = true; this.isIdentity = true;
        }
        multiply() { return new DOMMatrix(); }
        translate() { return new DOMMatrix(); }
        scale() { return new DOMMatrix(); }
        rotate() { return new DOMMatrix(); }
        inverse() { return new DOMMatrix(); }
        transformPoint(p) { return p || { x: 0, y: 0, z: 0, w: 1 }; }
        static fromMatrix() { return new DOMMatrix(); }
        static fromFloat32Array() { return new DOMMatrix(); }
        static fromFloat64Array() { return new DOMMatrix(); }
    }
    globalThis.DOMMatrix = DOMMatrix;
    console.log('🔧 [Polyfill] DOMMatrix patched');
}

if (typeof globalThis.DOMRect === 'undefined') {
    class DOMRect {
        constructor(x = 0, y = 0, w = 0, h = 0) {
            this.x = x; this.y = y; this.width = w; this.height = h;
        }
        get left() { return this.x; }
        get top() { return this.y; }
        get right() { return this.x + this.width; }
        get bottom() { return this.y + this.height; }
        static fromRect(o) { return new DOMRect(o?.x, o?.y, o?.width, o?.height); }
    }
    globalThis.DOMRect = DOMRect;
    console.log('🔧 [Polyfill] DOMRect patched');
}

if (typeof globalThis.DOMPoint === 'undefined') {
    class DOMPoint {
        constructor(x = 0, y = 0, z = 0, w = 1) { this.x = x; this.y = y; this.z = z; this.w = w; }
        static fromPoint(o) { return new DOMPoint(o?.x, o?.y, o?.z, o?.w); }
    }
    globalThis.DOMPoint = DOMPoint;
    console.log('🔧 [Polyfill] DOMPoint patched');
}

if (typeof globalThis.ImageData === 'undefined') {
    class ImageData {
        constructor(dataOrWidth, heightOrWidth) {
            if (typeof dataOrWidth === 'number') {
                this.width = dataOrWidth;
                this.height = heightOrWidth;
                this.data = new Uint8ClampedArray(dataOrWidth * heightOrWidth * 4);
            } else {
                this.data = dataOrWidth;
                this.width = heightOrWidth;
                this.height = dataOrWidth.length / (heightOrWidth * 4);
            }
        }
    }
    globalThis.ImageData = ImageData;
    console.log('🔧 [Polyfill] ImageData patched');
}

if (typeof globalThis.OffscreenCanvas === 'undefined') {
    class OffscreenCanvas {
        constructor(w, h) { this.width = w; this.height = h; }
        getContext() { return null; }
        transferToImageBitmap() { return null; }
    }
    globalThis.OffscreenCanvas = OffscreenCanvas;
    console.log('🔧 [Polyfill] OffscreenCanvas patched');
}

if (typeof globalThis.Path2D === 'undefined') {
    class Path2D {
        constructor() {}
        addPath() {} closePath() {} moveTo() {} lineTo() {}
        bezierCurveTo() {} quadraticCurveTo() {} arc() {}
        arcTo() {} ellipse() {} rect() {}
    }
    globalThis.Path2D = Path2D;
    console.log('🔧 [Polyfill] Path2D patched');
}
