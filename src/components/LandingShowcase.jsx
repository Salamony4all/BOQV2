import { useEffect, useMemo, useRef, useState } from 'react';
import styles from '../styles/Landing.module.css';
import { getFullUrl } from '../utils/urlUtils';

const ROTATING_WORDS = ['Floor Plans', 'Tender BOQs', 'Spec Sheets', 'PDF Schedules'];

const FALLBACK_MATCH_CYCLE = [
    { icon: 'ri-computer-line', label: 'Workstation', score: 97 },
    { icon: 'ri-armchair-line', label: 'Task Chair', score: 95 },
    { icon: 'ri-table-line', label: 'Conference', score: 98 },
    { icon: 'ri-sofa-line', label: 'Lounge Sofa', score: 96 }
];

const EXPORT_CARDS = [
    { code: 'XLSX', tone: 'emerald' },
    { code: 'PPTX', tone: 'amber' },
    { code: 'PDF', tone: 'rose' },
    { code: 'MAS', tone: 'blue' }
];

const EXCLUDE_ACCESSORY_RE = /\b(screen|panel|column|wall|partition|lamp|acoustic|coat|hanger|bin|cable|tray|modesty|return only|accessory|accessories|planter|pod|booth|shelf|shelving|locker|cabinet|pedestal|barstool|bar stool|counter stool|stool|bench|pouf|ottoman|coatstand|whiteboard|flipchart|trolley|divider|bracket|power|socket|box|fabric|leather|sample|cushion|pillow|rug|carpet|sofa bed|mediawall|media wall|reception|lectern|podium)\b/i;
const ULTRA_MODERN_CHAIR_RE = /\b(swivel chairs?|task chairs?|office chairs?|executive chairs?|conference chairs?|meeting chairs?|ergonomic chairs?|lounge chairs?|armchairs?|designer chairs?|shell chairs?|cantilever chairs?|mesh chairs?|visitor chairs?|chairs?)\b/i;
const MODERN_DESK_RE = /\b(executive desks?|office desks?|writing desks?|workstations?|conference tables?|meeting tables?|desks?)\b/i;

/** Upgrade Architonic product image URLs dynamically to uncropped high-resolution WebP. */
function toHighResArchitonicUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') return '';
    try {
        const u = new URL(rawUrl.trim());
        u.searchParams.set('width', '960');
        u.searchParams.set('height', '720');
        u.searchParams.set('fit', 'inside');
        u.searchParams.set('format', 'webp');
        u.searchParams.set('quality', '92');
        return getFullUrl(u.toString());
    } catch {
        return getFullUrl(rawUrl);
    }
}

function cleanModelLabel(raw) {
    return String(raw || '')
        .replace(/\s*#\d+\b/g, '')
        .replace(/\s*\|\s*[^|]+$/, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function shuffleArray(list) {
    const arr = list.slice();
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

/**
 * Dynamically build an unlimited rotation of high-resolution Architonic modern chairs & desks
 * across all live `allBrands` catalogs (prioritizing shown brands, weighted ~75% ultra-modern chairs).
 */
function buildLiveMatchShowcase(featuredBrands = [], allBrands = [], getBrandLogo, getBrandLogoFallback) {
    if (!Array.isArray(allBrands) || allBrands.length === 0) return [];

    const isGoodArchitonicProductImg = (img) =>
        typeof img === 'string' &&
        img.includes('media.architonic.com') &&
        img.includes('/product/') &&
        !img.includes('img_pro');

    const findFeaturedMatch = (brandName) => {
        const bn = String(brandName || '').toLowerCase().trim();
        if (!bn) return null;
        return featuredBrands.find(feat => {
            const aliases = [feat.name, ...(feat.aliases || [])].map(s => String(s || '').toLowerCase().trim()).filter(Boolean);
            return aliases.some(a => bn === a || (a.length >= 3 && bn.includes(a)));
        }) || null;
    };

    const chairBuckets = [];
    const deskBuckets = [];
    const seenUrls = new Set();

    // Order brands so shown/featured partner brands lead, followed by any additional live catalog brands
    const orderedBrands = [...allBrands].sort((a, b) => {
        const aFeat = findFeaturedMatch(a?.name) ? 0 : 1;
        const bFeat = findFeaturedMatch(b?.name) ? 0 : 1;
        return aFeat - bFeat;
    });

    orderedBrands.forEach((catalogBrand, brandIdx) => {
        if (!catalogBrand || !Array.isArray(catalogBrand.products) || catalogBrand.products.length === 0) return;

        const feat = findFeaturedMatch(catalogBrand.name);
        const displayBrandName = feat ? feat.name : String(catalogBrand.name || '').trim();
        if (!displayBrandName) return;

        const logoUrl = (catalogBrand.logo && catalogBrand.logo.includes('media.architonic.com'))
            ? getFullUrl(catalogBrand.logo)
            : (feat ? getBrandLogo(feat) : (catalogBrand.logo ? getFullUrl(catalogBrand.logo) : getBrandLogoFallback(displayBrandName)));
        const logoFallback = getBrandLogoFallback(displayBrandName);

        const brandChairs = [];
        const brandDesks = [];

        catalogBrand.products.forEach((p, pIdx) => {
            const rawImg = p?.image || p?.imageUrl;
            if (!isGoodArchitonicProductImg(rawImg) || seenUrls.has(rawImg)) return;

            const modelName = cleanModelLabel(p?.model || p?.name);
            const txt = `${p?.mainCategory || ''} ${p?.subCategory || ''} ${modelName}`;
            if (!modelName || EXCLUDE_ACCESSORY_RE.test(txt)) return;

            const isChair = ULTRA_MODERN_CHAIR_RE.test(txt);
            const isDesk = !isChair && MODERN_DESK_RE.test(txt);
            if (!isChair && !isDesk) return;

            seenUrls.add(rawImg);
            const entry = {
                id: `${displayBrandName}-${pIdx}-${rawImg.slice(-16)}`,
                type: isChair ? 'Chair' : 'Desk',
                brandName: displayBrandName,
                logoUrl,
                logoFallback,
                label: modelName,
                imageUrl: toHighResArchitonicUrl(rawImg),
                productUrl: p?.officialProductUrl || p?.websiteUrl || p?.productUrl || '',
                score: 94 + ((brandIdx + pIdx) % 6)
            };

            if (isChair) brandChairs.push(entry);
            else brandDesks.push(entry);
        });

        if (brandChairs.length > 0) chairBuckets.push(shuffleArray(brandChairs));
        if (brandDesks.length > 0) deskBuckets.push(shuffleArray(brandDesks));
    });

    // Round-robin across all brands so consecutive slides always showcase fresh brands with NO cap
    const drainRoundRobin = (buckets) => {
        const out = [];
        const queues = shuffleArray(buckets).map(b => b.slice());
        let active = true;
        while (active) {
            active = false;
            for (const q of queues) {
                if (q.length > 0) {
                    out.push(q.shift());
                    active = true;
                }
            }
        }
        return out;
    };

    const allChairs = drainRoundRobin(chairBuckets);
    const allDesks = drainRoundRobin(deskBuckets);

    // Weight ~75% ultra-modern chairs, ~25% modern desks/tables (3 chairs : 1 desk) with zero limit
    const stream = [];
    let ci = 0;
    let di = 0;
    while (ci < allChairs.length || di < allDesks.length) {
        for (let k = 0; k < 3 && ci < allChairs.length; k++) {
            stream.push(allChairs[ci++]);
        }
        if (di < allDesks.length) {
            stream.push(allDesks[di++]);
        }
    }

    return stream;
}

/** Fades & lifts children into view once when scrolled into the viewport. */
function Reveal({ children, delay = 0, className = '', as: Tag = 'div', style, ...rest }) {
    const ref = useRef(null);
    const [visible, setVisible] = useState(false);

    useEffect(() => {
        const node = ref.current;
        if (!node) return undefined;
        if (typeof IntersectionObserver === 'undefined') {
            setVisible(true);
            return undefined;
        }
        const observer = new IntersectionObserver(
            ([entry]) => {
                if (entry.isIntersecting) {
                    setVisible(true);
                    observer.disconnect();
                }
            },
            { threshold: 0.12 }
        );
        observer.observe(node);
        return () => observer.disconnect();
    }, []);

    return (
        <Tag
            ref={ref}
            className={`${styles.reveal} ${visible ? styles.revealVisible : ''} ${className}`}
            style={{ ...style, transitionDelay: `${delay}ms` }}
            {...rest}
        >
            {children}
        </Tag>
    );
}

/** Counts from 0 to `value` once scrolled into view. */
function CountUp({ value, suffix }) {
    const ref = useRef(null);
    const [display, setDisplay] = useState(0);

    useEffect(() => {
        const node = ref.current;
        if (!node) return undefined;
        const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        if (reduceMotion || typeof IntersectionObserver === 'undefined') {
            setDisplay(value);
            return undefined;
        }
        let frame;
        const observer = new IntersectionObserver(([entry]) => {
            if (!entry.isIntersecting) return;
            observer.disconnect();
            const start = performance.now();
            const duration = 1250;
            const tick = (now) => {
                const t = Math.min(1, (now - start) / duration);
                const eased = 1 - Math.pow(1 - t, 3);
                setDisplay(Math.round(value * eased));
                if (t < 1) frame = requestAnimationFrame(tick);
            };
            frame = requestAnimationFrame(tick);
        }, { threshold: 0.35 });
        observer.observe(node);
        return () => {
            observer.disconnect();
            if (frame) cancelAnimationFrame(frame);
        };
    }, [value]);

    return <span ref={ref}>{display}{suffix}</span>;
}

/** Smooth vertical cycling word for the hero headline. */
function RotatingWord() {
    const [index, setIndex] = useState(0);

    useEffect(() => {
        const id = setInterval(() => setIndex(i => (i + 1) % ROTATING_WORDS.length), 2500);
        return () => clearInterval(id);
    }, []);

    return (
        <span className={styles.rotator} aria-live="polite">
            <span key={index} className={styles.rotatorWord}>{ROTATING_WORDS[index]}</span>
        </span>
    );
}

/** Interactive 3-stage animated motion preview: Blueprint Scan -> Live Architonic Match -> Deliverables Fan. */
function MotionStage({ onPlanClick, onMatchClick, onExportClick, keyActivate, showcaseItems = [] }) {
    const [cycleIdx, setCycleIdx] = useState(0);
    const [brokenIds, setBrokenIds] = useState(() => new Set());

    const liveItems = useMemo(
        () => showcaseItems.filter(item => item.imageUrl && !brokenIds.has(item.id)),
        [showcaseItems, brokenIds]
    );
    const hasPhotos = liveItems.length > 0;
    const total = hasPhotos ? liveItems.length : FALLBACK_MATCH_CYCLE.length;

    useEffect(() => {
        const id = setInterval(() => setCycleIdx(i => (i + 1) % Math.max(1, total)), hasPhotos ? 2800 : 2200);
        return () => clearInterval(id);
    }, [total, hasPhotos]);

    const safeIdx = total > 0 ? cycleIdx % total : 0;
    const activePhoto = hasPhotos ? liveItems[safeIdx] : null;
    const activeFallback = !hasPhotos ? FALLBACK_MATCH_CYCLE[safeIdx] : null;

    // Preload upcoming Architonic image so transitions have zero flash
    useEffect(() => {
        if (!hasPhotos || liveItems.length < 2) return;
        const next = liveItems[(safeIdx + 1) % liveItems.length];
        if (next?.imageUrl) {
            const img = new Image();
            img.src = next.imageUrl;
        }
    }, [safeIdx, hasPhotos, liveItems]);

    // Clicking a live match opens its official product page; fall back to the AI Value Engineer.
const openMatchTarget = () => {
        if (activePhoto?.productUrl) window.open(activePhoto.productUrl, '_blank', 'noopener,noreferrer');
        else onMatchClick?.();
    };

    return (
        <div className={`${styles.stage} ${styles.enter}`} style={{ animationDelay: '440ms' }}>
            {/* Stage 1: Architectural CAD Floor-Plan Laser Scan */}
            <div
                className={`${styles.stageCard} ${styles.stageScan}`}
                onClick={onPlanClick}
                role="button"
                tabIndex={0}
                onKeyDown={keyActivate(onPlanClick)}
                title="Upload Floor Plan (PDF / CAD / Image)"
            >
                <div className={styles.blueprintViewport} aria-hidden="true">
                    <span className={styles.bpSheetBadge}>PLAN · CAD</span>
                    <svg viewBox="0 0 220 148" className={styles.blueprintSvg}>
                        {/* Architectural Dimension Lines (Top & Left) */}
                        <g className={styles.bpDimGroup}>
                            <line x1="20" y1="11" x2="204" y2="11" className={styles.bpDimLine} />
                            <line x1="20" y1="8" x2="20" y2="14" className={styles.bpDimLine} />
                            <line x1="204" y1="8" x2="204" y2="14" className={styles.bpDimLine} />
                            <text x="112" y="9.5" textAnchor="middle" className={styles.bpDimText}>14.2 m</text>

                            <line x1="11" y1="20" x2="11" y2="136" className={styles.bpDimLine} />
                            <line x1="8" y1="20" x2="14" y2="20" className={styles.bpDimLine} />
                            <line x1="8" y1="136" x2="14" y2="136" className={styles.bpDimLine} />
                        </g>

                        {/* North Compass Arrow (Top-Right) */}
                        <g transform="translate(209, 25)" className={styles.bpCompass}>
                            <polygon points="0,-6 3,3 0,1 -3,3" fill="currentColor" />
                            <text x="0" y="10" textAnchor="middle" className={styles.bpDimText}>N</text>
                        </g>

                        {/* Outer Architectural Shell Walls (with doorway/window breaks) */}
                        <path
                            d="M20 20 H66 M106 20 H152 M182 20 H204 V52 M204 88 V136 H132 M114 136 H20 V20"
                            className={styles.bpWall}
                        />
                        {/* Facade Glazing / Window Mullions */}
                        <g className={styles.bpWindow}>
                            <line x1="66" y1="18.5" x2="106" y2="18.5" />
                            <line x1="66" y1="21.5" x2="106" y2="21.5" />
                            <line x1="152" y1="18.5" x2="182" y2="18.5" />
                            <line x1="152" y1="21.5" x2="182" y2="21.5" />
                            <line x1="202.5" y1="52" x2="202.5" y2="88" />
                            <line x1="205.5" y1="52" x2="205.5" y2="88" />
                        </g>

                        {/* Interior Partition Walls with Doorway Openings */}
                        <path
                            d="M126 20 V62 M126 78 V84 M20 80 H68 M84 80 H136 M136 80 V106 M136 122 V136"
                            className={styles.bpPartition}
                        />

                        {/* 90-Degree Architectural Door Swings (Leaf + Curved Swing Arc) */}
                        {/* Door 1: Main Entry (Bottom) */}
                        <line x1="114" y1="136" x2="114" y2="118" className={styles.bpDoorLeaf} />
                        <path d="M114 118 A18 18 0 0 1 132 136" className={styles.bpDoorArc} />
                        {/* Door 2: Boardroom Entry (Middle-Left) */}
                        <line x1="68" y1="80" x2="68" y2="64" className={styles.bpDoorLeaf} />
                        <path d="M68 64 A16 16 0 0 1 84 80" className={styles.bpDoorArc} />
                        {/* Door 3: Executive Office Entry (Middle-Right) */}
                        <line x1="126" y1="62" x2="142" y2="62" className={styles.bpDoorLeaf} />
                        <path d="M142 62 A16 16 0 0 1 126 78" className={styles.bpDoorArc} />
                        {/* Door 4: Lounge Partition Entry */}
                        <line x1="136" y1="106" x2="152" y2="106" className={styles.bpDoorLeaf} />
                        <path d="M152 106 A16 16 0 0 1 136 122" className={styles.bpDoorArc} />

                        {/* ROOM 1 (Top-Left): Boardroom Table + 6 Top-Down Chairs */}
                        <rect x="44" y="38" width="58" height="20" rx="10" className={styles.bpFurniture} />
                        <rect x="52" y="30" width="9" height="5" rx="2" className={styles.bpChair} />
                        <rect x="68" y="30" width="9" height="5" rx="2" className={styles.bpChair} />
                        <rect x="84" y="30" width="9" height="5" rx="2" className={styles.bpChair} />
                        <rect x="52" y="61" width="9" height="5" rx="2" className={styles.bpChair} />
                        <rect x="68" y="61" width="9" height="5" rx="2" className={styles.bpChair} />
                        <rect x="84" y="61" width="9" height="5" rx="2" className={styles.bpChair} />
                        <circle cx="37" cy="48" r="3.5" className={styles.bpChair} />
                        <circle cx="109" cy="48" r="3.5" className={styles.bpChair} />
                        <text x="73" y="50.5" textAnchor="middle" className={styles.bpZoneText}>MEETING</text>

                        {/* ROOM 2 (Top-Right): Executive L-Desk + Swivel Chair + 2 Guest Chairs */}
                        <path d="M152 34 H188 V62 H178 V45 H152 Z" className={styles.bpFurniture} />
                        <circle cx="166" cy="54" r="5" className={styles.bpChair} />
                        <path d="M161 57 Q166 62 171 57" className={styles.bpChairBack} />
                        <rect x="155" y="26" width="8" height="5" rx="2" className={styles.bpChair} />
                        <rect x="171" y="26" width="8" height="5" rx="2" className={styles.bpChair} />

                        {/* ROOM 3 (Bottom-Left): Open Office Bench Cluster + Chairs */}
                        <rect x="34" y="96" width="60" height="24" rx="2" className={styles.bpFurniture} />
                        <line x1="34" y1="108" x2="94" y2="108" className={styles.bpDivider} />
                        <line x1="64" y1="96" x2="64" y2="120" className={styles.bpDivider} />
                        <circle cx="49" cy="90" r="3.5" className={styles.bpChair} />
                        <circle cx="79" cy="90" r="3.5" className={styles.bpChair} />
                        <circle cx="49" cy="126" r="3.5" className={styles.bpChair} />
                        <circle cx="79" cy="126" r="3.5" className={styles.bpChair} />
                        <text x="64" y="135" textAnchor="middle" className={styles.bpZoneText}>WORKSTATIONS</text>

                        {/* ROOM 4 (Bottom-Right): Lounge Sectional Sofa + Round Coffee Table + Plant */}
                        <path d="M156 96 H194 V126 H184 V105 H156 Z" className={styles.bpFurniture} />
                        <line x1="170" y1="96" x2="170" y2="105" className={styles.bpDivider} />
                        <line x1="184" y1="115" x2="194" y2="115" className={styles.bpDivider} />
                        <circle cx="168" cy="118" r="7.5" className={styles.bpFurniture} />
                        <circle cx="195" cy="87" r="4.5" className={styles.bpPlant} />
                        <line x1="192" y1="84" x2="198" y2="90" className={styles.bpPlant} />
                        <line x1="198" y1="84" x2="192" y2="90" className={styles.bpPlant} />
                    </svg>
                    <span className={styles.scanBeam} />
                    <span className={`${styles.pingDot} ${styles.pingA}`} />
                    <span className={`${styles.pingDot} ${styles.pingB}`} />
                    <span className={`${styles.pingDot} ${styles.pingC}`} />
                </div>
                <div className={styles.stageFooter}>
                    <i className="ri-compasses-2-line" />
                    <span>Scan Plan</span>
                </div>
            </div>

            {/* Flow Stream 1 */}
            <div className={styles.stream} aria-hidden="true">
                <span className={styles.streamLine} />
                <span className={styles.streamPulse} />
                <span className={styles.streamPulse} style={{ animationDelay: '1.1s' }} />
            </div>

            {/* Stage 2: Live High-Res Architonic Chair & Desk Matcher */}
            <div
                className={`${styles.stageCard} ${styles.stageMatch}`}
                onClick={openMatchTarget}
                role="button"
                tabIndex={0}
                onKeyDown={keyActivate(openMatchTarget)}
                title={activePhoto ? `${activePhoto.brandName} — ${activePhoto.label}` : 'Open AI Value Engineer'}
            >
                {activePhoto ? (
                    <div key={activePhoto.id} className={styles.photoStage}>
                        {/* Clean Studio Frame showing 100% of the chair/desk without cropping */}
                        <div className={styles.photoCanvas}>
                            <img
                                src={activePhoto.imageUrl}
                                alt={`${activePhoto.brandName} ${activePhoto.label}`}
                                className={styles.matchPhoto}
                                onError={() => {
                                    setBrokenIds(prev => {
                                        const next = new Set(prev);
                                        next.add(activePhoto.id);
                                        return next;
                                    });
                                }}
                            />
                            <span className={styles.photoSweep} aria-hidden="true" />

                            {/* Floating Brand Logo Pill */}
                            <div className={styles.brandBadge}>
                                <img
                                    src={activePhoto.logoUrl}
                                    alt={activePhoto.brandName}
                                    className={styles.brandBadgeLogo}
                                    onError={(e) => {
                                        e.currentTarget.onerror = null;
                                        e.currentTarget.src = activePhoto.logoFallback;
                                    }}
                                />
                            </div>

                            {/* Live Match Confidence Chip */}
                            <span className={styles.scoreChip}>
                                <i className={styles.scoreDot} />
                                {activePhoto.score}%
                            </span>
                        </div>

                        {/* Separate Bottom Caption Strip (never hides furniture base/legs) */}
                        <div className={styles.photoCaption}>
                            <span className={styles.photoModel}>{activePhoto.label}</span>
                            <div className={styles.photoBar}>
                                <span className={styles.photoBarFill} style={{ width: `${activePhoto.score}%` }} />
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className={styles.matchViewport}>
                        <div className={styles.orbitWrap} aria-hidden="true">
                            <span className={styles.orbitOuter} />
                            <span className={styles.orbitInner} />
                            <span className={styles.orbitCore}>
                                <i key={safeIdx} className={`${activeFallback.icon} ${styles.coreIconPop}`} />
                            </span>
                        </div>
                        <div key={safeIdx} className={styles.matchReadout}>
                            <span className={styles.matchName}>{activeFallback.label}</span>
                            <div className={styles.matchBar}>
                                <span className={styles.matchBarFill} style={{ width: `${activeFallback.score}%` }} />
                            </div>
                        </div>
                    </div>
                )}

                <div className={styles.stageFooter}>
                    <i className="ri-sparkling-2-fill" />
                    <span>Match</span>
                </div>
            </div>

            {/* Flow Stream 2 */}
            <div className={styles.stream} aria-hidden="true">
                <span className={styles.streamLine} />
                <span className={`${styles.streamPulse} ${styles.streamPulseGold}`} style={{ animationDelay: '0.45s' }} />
                <span className={`${styles.streamPulse} ${styles.streamPulseGold}`} style={{ animationDelay: '1.55s' }} />
            </div>

            {/* Stage 3: Branded Deliverables Deck */}
            <div
                className={`${styles.stageCard} ${styles.stageExport}`}
                onClick={onExportClick}
                role="button"
                tabIndex={0}
                onKeyDown={keyActivate(onExportClick)}
                title="Open Multi-Budget Offers & Exports"
            >
                <div className={styles.deckViewport} aria-hidden="true">
                    {EXPORT_CARDS.map((card, i) => (
                        <div
                            key={card.code}
                            className={`${styles.deckSheet} ${styles[`deck_${card.tone}`]}`}
                            style={{ '--i': i, '--y': `${Math.abs(i - 1.5) * 3}px` }}
                        >
                            <span className={styles.deckCode}>{card.code}</span>
                            <span className={styles.deckLines}>
                                <i /><i />
                            </span>
                        </div>
                    ))}
                </div>
                <div className={styles.stageFooter}>
                    <i className="ri-slideshow-3-line" />
                    <span>Export</span>
                </div>
            </div>
        </div>
    );
}

export default function LandingShowcase({
    theme,
    logoWhite,
    logoOriginal,
    companyName,
    boqInputRef,
    planInputRef,
    onBoqFiles,
    onPlanFiles,
    onStartNew,
    onOpenValueEngineer,
    onOpenMultiBudget,
    onOpenSettings,
    brands = [],
    allBrands = [],
    brandTotalCount = 0,
    getBrandLogo,
    getBrandLogoFallback
}) {
    const heroRef = useRef(null);
    const heroLogo = theme === 'dark' && logoWhite ? logoWhite : logoOriginal;

    const showcaseItems = useMemo(
        () => buildLiveMatchShowcase(brands, allBrands, getBrandLogo, getBrandLogoFallback),
        [brands, allBrands, getBrandLogo, getBrandLogoFallback]
    );

    const mid = Math.ceil(brands.length / 2);
    const rowOne = brands.slice(0, mid);
    const rowTwo = brands.slice(mid);
    const marqueeRowA = rowOne.length > 0 ? [...rowOne, ...rowOne] : [];
    const marqueeRowB = rowTwo.length > 0 ? [...rowTwo, ...rowTwo] : [];

    const dynamicBrandCount = Math.max(50, brandTotalCount || brands.length || 50);

    const stats = [
        { value: 10, suffix: 'x', label: 'Faster' },
        { value: dynamicBrandCount, suffix: '+', label: 'Brands' },
        { value: 7, suffix: '', label: 'Exports' },
        { value: 100, suffix: '%', label: 'White-Label' }
    ];

    const handleFileInput = (handler) => (e) => {
        const files = Array.from(e.target.files || []).filter(Boolean);
        if (files.length > 0) handler(files);
        e.target.value = '';
    };

    const keyActivate = (fn) => (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            fn();
        }
    };

    const handleHeroPointer = (e) => {
        const el = heroRef.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        el.style.setProperty('--mx', `${e.clientX - rect.left}px`);
        el.style.setProperty('--my', `${e.clientY - rect.top}px`);
    };

    const handleTilePointer = (e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        e.currentTarget.style.setProperty('--tx', `${e.clientX - rect.left}px`);
        e.currentTarget.style.setProperty('--ty', `${e.clientY - rect.top}px`);
    };

    const features = [
        { icon: 'ri-vip-diamond-line', title: 'Value Engineer', onClick: onOpenValueEngineer, featured: true },
        { icon: 'ri-compasses-2-line', title: 'Plan Takeoff', onClick: () => planInputRef.current?.click() },
        { icon: 'ri-layers-line', title: '3-Tier Offers', onClick: onOpenMultiBudget },
        { icon: 'ri-slideshow-line', title: 'PPTX Catalogs', onClick: onOpenMultiBudget },
        { icon: 'ri-file-shield-2-line', title: 'MAS · MIR · WIR', onClick: () => boqInputRef.current?.click() },
        { icon: 'ri-building-4-line', title: 'Fitout', onClick: onOpenMultiBudget },
        { icon: 'ri-global-line', title: 'Brand Harvester', onClick: onOpenSettings }
    ];

    const renderMarqueeItem = (brandItem, i, baseLength) => (
        <button
            type="button"
            key={`${brandItem.name}-${i}`}
            className={styles.marqueeItem}
            onClick={onOpenSettings}
            title={brandItem.name}
            aria-hidden={i >= baseLength ? 'true' : undefined}
            tabIndex={i >= baseLength ? -1 : 0}
        >
            <img
                src={getBrandLogo(brandItem)}
                alt={brandItem.name}
                loading="lazy"
                onError={(e) => {
                    e.currentTarget.onerror = null;
                    e.currentTarget.src = getBrandLogoFallback(brandItem.name);
                }}
            />
        </button>
    );

    return (
        <>
            {/* ===== HERO ===== */}
            <section ref={heroRef} className={styles.hero} onMouseMove={handleHeroPointer}>
                <div className={styles.aurora} aria-hidden="true">
                    <span className={`${styles.blob} ${styles.blobA}`} />
                    <span className={`${styles.blob} ${styles.blobB}`} />
                    <span className={`${styles.blob} ${styles.blobC}`} />
                    <span className={styles.gridOverlay} />
                    <span className={styles.spotlight} />
                </div>

                <div className={styles.heroInner}>
                    <div className={`${styles.badge} ${styles.enter}`} style={{ animationDelay: '0ms' }}>
                        <span className={styles.badgeDot} />
                        AI Estimation Suite
                    </div>

                    <div
                        className={`${styles.logoWrap} ${styles.enter}`}
                        style={{ animationDelay: '70ms' }}
                        onClick={() => window.location.reload()}
                        role="button"
                        tabIndex={0}
                        onKeyDown={keyActivate(() => window.location.reload())}
                    >
                        {heroLogo ? (
                            <img src={heroLogo} alt={companyName || 'BOQ FLOW'} className={styles.heroLogo} />
                        ) : (
                            <div className={styles.wordmark}>
                                <span className={styles.wordBlue}>BOQ</span>
                                <span className={styles.wordGold}>FLOW</span>
                            </div>
                        )}
                    </div>

                    <h1 className={`${styles.headline} ${styles.enter}`} style={{ animationDelay: '140ms' }}>
                        <RotatingWord />
                        <span className={styles.headlineRest}>to branded offers.</span>
                    </h1>

                    <div className={styles.ctaRow}>
                        <label className={`${styles.cta} ${styles.ctaPrimary} ${styles.enter}`} style={{ animationDelay: '220ms' }}>
                            <input
                                ref={boqInputRef}
                                type="file"
                                accept=".xlsx,.xls,.xlsb,.pdf,.png,.jpg,.jpeg"
                                style={{ display: 'none' }}
                                multiple
                                onChange={handleFileInput(onBoqFiles)}
                            />
                            <i className="ri-file-upload-line" />
                            <span>Upload BOQ</span>
                        </label>

                        <label className={`${styles.cta} ${styles.ctaPlan} ${styles.enter}`} style={{ animationDelay: '270ms' }}>
                            <input
                                ref={planInputRef}
                                type="file"
                                accept=".pdf,.png,.jpg,.jpeg"
                                style={{ display: 'none' }}
                                multiple
                                onChange={handleFileInput(onPlanFiles)}
                            />
                            <i className="ri-draft-line" />
                            <span>Floor Plan</span>
                        </label>

                        <button type="button" className={`${styles.cta} ${styles.ctaGhost} ${styles.enter}`} style={{ animationDelay: '320ms' }} onClick={onStartNew}>
                            <i className="ri-equalizer-line" />
                            <span>New BOQ</span>
                        </button>
                    </div>

                    {/* Interactive Motion Pipeline */}
                    <MotionStage
                        onPlanClick={() => planInputRef.current?.click()}
                        onMatchClick={onOpenValueEngineer}
                        onExportClick={onOpenMultiBudget}
                        keyActivate={keyActivate}
                        showcaseItems={showcaseItems}
                    />
                </div>

                <div className={styles.scrollCue} aria-hidden="true">
                    <span />
                </div>
            </section>

            {/* ===== DUAL-ROW BRAND MARQUEE ===== */}
            {marqueeRowA.length > 0 && (
                <section className={styles.marqueeSection}>
                    <div className={styles.marqueeStack}>
                        <div className={styles.marquee}>
                            <div className={styles.marqueeTrack}>
                                {marqueeRowA.map((b, i) => renderMarqueeItem(b, i, rowOne.length))}
                            </div>
                        </div>
                        {marqueeRowB.length > 0 && (
                            <div className={styles.marquee}>
                                <div className={`${styles.marqueeTrack} ${styles.marqueeReverse}`}>
                                    {marqueeRowB.map((b, i) => renderMarqueeItem(b, i, rowTwo.length))}
                                </div>
                            </div>
                        )}
                    </div>
                    <Reveal delay={100} className={styles.marqueeAction}>
                        <button type="button" className={styles.addBrand} onClick={onOpenSettings}>
                            <i className="ri-add-line" /> Add brand
                        </button>
                    </Reveal>
                </section>
            )}

            {/* ===== STATS ===== */}
            <section className={styles.stats}>
                {stats.map((s, i) => (
                    <Reveal key={s.label} delay={i * 80} className={styles.stat}>
                        <div className={styles.statValue}><CountUp value={s.value} suffix={s.suffix} /></div>
                        <div className={styles.statLabel}>{s.label}</div>
                    </Reveal>
                ))}
            </section>

            {/* ===== BENTO FEATURE TILES ===== */}
            <section className={styles.features}>
                {features.map((f, i) => (
                    <Reveal
                        key={f.title}
                        delay={i * 65}
                        className={`${styles.tile} ${f.featured ? styles.tileFeatured : ''}`}
                        onMouseMove={handleTilePointer}
                        onClick={f.onClick}
                        role="button"
                        tabIndex={0}
                        onKeyDown={keyActivate(f.onClick)}
                        title={f.title}
                    >
                        <span className={styles.tileIcon}><i className={f.icon} /></span>
                        <span className={styles.tileTitle}>{f.title}</span>
                        <i className={`ri-arrow-right-up-line ${styles.tileArrow}`} />
                    </Reveal>
                ))}
            </section>

            <footer className={styles.footer}>
                <span className={styles.footerMark}>{companyName || 'BOQ FLOW'}</span>
            </footer>
        </>
    );
}
