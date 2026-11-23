import { useEffect, useState } from 'react';
import { isPdfPlan, planPicture } from '../utils/planPicture';

/**
 * The plan at `url`: an image as it is, a PDF as a picture of its first page. While the
 * page is drawn a soft placeholder shows; if it cannot be drawn, the browser's own PDF
 * viewer is tried.
 */
export default function PlanPreview({ url, type, name, className, fallbackClassName }) {
    const pdf = isPdfPlan(type, name);
    const [shot, setShot] = useState({ url: null, src: null });

    useEffect(() => {
        if (!url || !pdf) return undefined;
        let live = true;
        planPicture(url).then((src) => {
            if (live) setShot({ url, src });
        });
        return () => {
            live = false;
        };
    }, [url, pdf]);

    if (!url) return null;
    if (!pdf) {
        return /^image\//i.test(type || '') || /\.(png|jpe?g|webp|gif)$/i.test(name || '')
            ? <img src={url} alt={name || 'Plan preview'} className={className} />
            : <div className={fallbackClassName}>Preview unavailable</div>;
    }
    if (shot.url !== url) {
        return (
            <div className={fallbackClassName} role="status" aria-live="polite">
                Preparing the preview…
            </div>
        );
    }
    if (shot.src) return <img src={shot.src} alt={name || 'Plan preview'} className={className} />;
    return (
        <object data={url} type="application/pdf" className={className} aria-label={name || 'Plan preview'}>
            <div className={fallbackClassName}>PDF preview unavailable</div>
        </object>
    );
}
