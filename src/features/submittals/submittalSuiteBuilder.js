/**
 * Standalone & Fallback Submittal Suite Generator (MAS, MIR, WIR, Delivery Note)
 * Generates contractor/consultant-grade A4 PDFs organized by Division
 * (Loose Furniture -> Custom Joinery -> Architectural Fit-Out) with Official Brand Finishes.
 */

const NAVY = '0F172A';
const ACCENT = '2563EB';
const INK = '1E293B';
const MUTED = '64748B';
const LINE = 'CBD5E1';
const SOFT = 'F8FAFC';

function hexRgb(hex) {
    const clean = String(hex || '#0F172A').replace('#', '');
    return [
        parseInt(clean.slice(0, 2), 16) || 15,
        parseInt(clean.slice(2, 4), 16) || 23,
        parseInt(clean.slice(4, 6), 16) || 42,
    ];
}

function clip(s, n = 90) {
    const t = String(s ?? '').replace(/\s+/g, ' ').trim();
    return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

function containFit(w, h, box) {
    if (!w || !h) return { x: box.x, y: box.y, w: box.w, h: box.h };
    const s = Math.min(box.w / w, box.h / h);
    const rw = w * s;
    const rh = h * s;
    return { x: box.x + (box.w - rw) / 2, y: box.y + (box.h - rh) / 2, w: rw, h: rh };
}

function productTitle(p) {
    return [p.brand, p.model].filter(Boolean).join(' · ') || clip(p.description, 44) || p.sn || 'Specified Item';
}

function drawSubmittalHeader(doc, title, refCode, ctx) {
    const W = doc.internal.pageSize.getWidth();
    doc.setFillColor(...hexRgb(NAVY));
    doc.rect(0, 0, W, 28, 'F');
    doc.setFillColor(...hexRgb(ACCENT));
    doc.rect(0, 28, W, 1.2, 'F');

    const ownLogo = ctx.logo?.onDark;
    if (ownLogo?.dataUrl) {
        const f = containFit(ownLogo.width, ownLogo.height, { x: 10, y: 5, w: 36, h: 17 });
        try { doc.addImage(ownLogo.dataUrl, 'PNG', f.x, f.y, f.w, f.h); } catch { /* ignore */ }
    } else {
        doc.setTextColor(255, 255, 255);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9.5);
        doc.text(clip(ctx.company || 'BOQ Flow', 28), 10, 16);
    }

    const clientLogo = ctx.logo?.client;
    if (clientLogo?.dataUrl) {
        const f = containFit(clientLogo.width, clientLogo.height, { x: W - 46, y: 5, w: 36, h: 17 });
        try { doc.addImage(clientLogo.dataUrl, 'PNG', f.x, f.y, f.w, f.h); } catch { /* ignore */ }
    }

    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.text(title, W / 2, 13, { align: 'center' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(203, 213, 225);
    doc.text(`Ref: ${refCode}  ·  Date: ${ctx.date}`, W / 2, 21.5, { align: 'center' });
    return 33;
}

function drawProjectMetadataBox(doc, y, ctx, extraPair = []) {
    const W = doc.internal.pageSize.getWidth();
    doc.setFillColor(...hexRgb(SOFT));
    doc.setDrawColor(...hexRgb(LINE));
    doc.setLineWidth(0.3);
    doc.roundedRect(10, y, W - 20, 20, 1.8, 1.8, 'FD');

    const rows = [
        ['Project:', clip(ctx.title || 'Project', 36), 'Client:', clip(ctx.client || '—', 34)],
        ['Project No:', clip(ctx.project?.number || '—', 28), 'Location:', clip(ctx.project?.location || '—', 34)],
        ['Contractor:', clip(ctx.project?.contractor || ctx.company || '—', 32), 'Consultant:', clip(ctx.project?.consultant || '—', 32)],
        ['Revision:', clip(ctx.project?.revision || 'Rev 00', 22), extraPair[0] || 'Prepared By:', clip(extraPair[1] || ctx.company || 'BOQ Flow', 32)],
    ];

    doc.setFontSize(7.6);
    rows.forEach((r, idx) => {
        const ry = y + 4.8 + idx * 4.4;
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(...hexRgb(NAVY));
        doc.text(r[0], 13, ry);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(...hexRgb(INK));
        doc.text(r[1], 36, ry);

        doc.setFont('helvetica', 'bold');
        doc.setTextColor(...hexRgb(NAVY));
        doc.text(r[2], W / 2 + 4, ry);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(...hexRgb(INK));
        doc.text(r[3], W / 2 + 28, ry);
    });
    return y + 24;
}

function drawDivisionDividerPage(doc, submissionType, divTitle, count, ctx) {
    const W = doc.internal.pageSize.getWidth();
    const H = doc.internal.pageSize.getHeight();
    doc.setFillColor(...hexRgb(NAVY));
    doc.rect(0, 0, W, H, 'F');
    doc.setFillColor(...hexRgb(ACCENT));
    doc.rect(18, H * 0.42, 42, 1.8, 'F');
    doc.setTextColor(148, 163, 184);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text(submissionType, 18, H * 0.39);
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(22);
    doc.text(String(divTitle || 'Schedule Section').toUpperCase(), 18, H * 0.49);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    doc.setTextColor(203, 213, 225);
    doc.text(`${count} specified item${count === 1 ? '' : 's'} with technical & finish verification`, 18, H * 0.54);
    doc.setFontSize(9);
    doc.text(clip(`${ctx.title}${ctx.client ? ` · ${ctx.client}` : ''}`, 78), 18, H - 18);
}

function drawApprovalFooterBox(doc, startY, labels = ['Submitted By (Contractor)', 'Reviewed By (Consultant)', 'Approved By (Client)']) {
    const W = doc.internal.pageSize.getWidth();
    const H = doc.internal.pageSize.getHeight();
    const y = Math.min(startY, H - 42);
    const boxW = (W - 20 - 8) / 3;
    labels.forEach((lbl, idx) => {
        const x = 10 + idx * (boxW + 4);
        doc.setFillColor(255, 255, 255);
        doc.setDrawColor(...hexRgb(LINE));
        doc.roundedRect(x, y, boxW, 24, 1.5, 1.5, 'FD');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7.2);
        doc.setTextColor(...hexRgb(NAVY));
        doc.text(lbl, x + 3, y + 5);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(...hexRgb(MUTED));
        doc.setFontSize(6.8);
        doc.text('Name / Sign:', x + 3, y + 14);
        doc.line(x + 20, y + 14, x + boxW - 3, y + 14);
        doc.text('Date / Status:', x + 3, y + 20);
        doc.line(x + 20, y + 20, x + boxW - 3, y + 20);
    });
}

function stampFooters(doc, ctx) {
    const pages = doc.internal.getNumberOfPages();
    const W = doc.internal.pageSize.getWidth();
    const H = doc.internal.pageSize.getHeight();
    for (let i = 1; i <= pages; i++) {
        doc.setPage(i);
        doc.setDrawColor(...hexRgb(LINE));
        doc.setLineWidth(0.2);
        doc.line(10, H - 10, W - 10, H - 10);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.5);
        doc.setTextColor(...hexRgb(MUTED));
        doc.text(clip(`${ctx.title} — ${ctx.company}`, 85), 10, H - 6);
        doc.text(`Page ${i} of ${pages}`, W - 10, H - 6, { align: 'right' });
    }
}

function getSubmittalItems(ctx) {
    return (ctx.products || []).filter((p) => p && (p.description || p.model || p.brand));
}

async function buildMasPdf(ctx, pictures, jsPDF, autoTable) {
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const W = doc.internal.pageSize.getWidth();
    const items = getSubmittalItems(ctx);
    const baseRef = `MAS-${String(ctx.project?.number || '001').replace(/[^A-Za-z0-9]/g, '').slice(0, 6) || '001'}`;
    let pageUsed = false;
    let activeDiv = '';
    const countsByDiv = items.reduce((m, p) => {
        const k = p.divisionTitle || p.category || 'General';
        m.set(k, (m.get(k) || 0) + 1);
        return m;
    }, new Map());

    items.forEach((p, idx) => {
        const div = p.divisionTitle || p.category || 'General';
        if (div !== activeDiv) {
            if (pageUsed) doc.addPage();
            drawDivisionDividerPage(doc, 'MATERIAL APPROVAL SHEET (MAS)', div, countsByDiv.get(div) || 1, ctx);
            pageUsed = true;
            activeDiv = div;
        }
        doc.addPage();
        pageUsed = true;

        const itemRef = `${baseRef}-${String(idx + 1).padStart(3, '0')}`;
        let y = drawSubmittalHeader(doc, 'MATERIAL APPROVAL SHEET', itemRef, ctx);
        y = drawProjectMetadataBox(doc, y, ctx, ['Sub-Category:', p.subGroup || p.category || div]);

        // Image / Finish swatch preview box
        const pic = pictures?.[p.sourceIndex] || null;
        doc.setFillColor(255, 255, 255);
        doc.setDrawColor(...hexRgb(LINE));
        doc.roundedRect(10, y, W - 20, 56, 2, 2, 'FD');
        if (pic?.dataUrl) {
            const f = containFit(pic.width, pic.height, { x: 14, y: y + 3, w: 68, h: 50 });
            try { doc.addImage(pic.dataUrl, 'JPEG', f.x, f.y, f.w, f.h); } catch { /* ignore */ }
        }
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(11);
        doc.setTextColor(...hexRgb(NAVY));
        doc.text(clip(productTitle(p), 44), 86, y + 10);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8.2);
        doc.setTextColor(...hexRgb(INK));
        const descLines = doc.splitTextToSize(clip(p.description || 'As per tender specification', 260), W - 100);
        doc.text(descLines.slice(0, 4), 86, y + 17);

        // Official Finishes swatches inside the card
        const swatches = (p.finishes || []).slice(0, 3);
        if (swatches.length) {
            swatches.forEach((sw, sIdx) => {
                const sx = 86 + sIdx * 36;
                const sy = y + 43;
                doc.setFillColor(...hexRgb(sw.hex || '#94A3B8'));
                doc.circle(sx + 2.2, sy + 1.5, 2.2, 'F');
                doc.setFont('helvetica', 'bold');
                doc.setFontSize(6.8);
                doc.setTextColor(...hexRgb(INK));
                doc.text(clip(sw.code || sw.name, 16), sx + 6, sy + 2.3);
            });
        }
        y += 61;

        autoTable(doc, {
            startY: y,
            theme: 'grid',
            margin: { left: 10, right: 10 },
            styles: { fontSize: 8.2, cellPadding: 2.2, lineColor: hexRgb(LINE), lineWidth: 0.15, textColor: hexRgb(INK) },
            headStyles: { fillColor: hexRgb(NAVY), textColor: 255, fontStyle: 'bold' },
            head: [['Parameter', 'Submitted Specification']],
            body: [
                ['BOQ Ref / Item No.', String(p.sn || p.code || idx + 1)],
                ['Division & Trade', `${div} / ${p.subGroup || p.category || 'Standard'}`],
                ['Manufacturer / Brand', p.brand || 'Manufacturer / Approved Equivalent'],
                ['Model / Series', p.model || p.skuCode || 'Contract Specification'],
                ['Official Finishes', p.finishSummary || 'Manufacturer Standard Range'],
                ['Quantity & Unit', `${p.qty || 0} ${p.unit || 'Nos'} (${ctx.placedOf ? `${ctx.placedOf(p)} verified in 3D` : 'Per drawing'})`],
                ['Location / Area', p.location || ctx.project?.location || 'As per Floor Plan'],
                ['Compliance Note', 'Submitted for Architect / Consultant Review & Formal Material Approval'],
            ],
            columnStyles: { 0: { fontStyle: 'bold', cellWidth: 48, fillColor: hexRgb(SOFT) } },
        });

        drawApprovalFooterBox(doc, (doc.lastAutoTable?.finalY || 225) + 10);
    });

    if (!pageUsed) {
        drawSubmittalHeader(doc, 'MATERIAL APPROVAL SHEET', baseRef, ctx);
        doc.setFontSize(10);
        doc.setTextColor(...hexRgb(MUTED));
        doc.text('No BOQ items available in this session.', 14, 50);
    }
    stampFooters(doc, ctx);
    return doc.output('blob');
}

async function buildInspectionPdf(docType, title, prefix, ctx, jsPDF, autoTable) {
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const items = getSubmittalItems(ctx);
    const refBase = `${prefix}-${String(ctx.project?.number || '001').replace(/[^A-Za-z0-9]/g, '').slice(0, 6) || '001'}`;

    const groups = new Map();
    items.forEach((p) => {
        const div = p.divisionTitle || p.category || 'General Works';
        if (!groups.has(div)) groups.set(div, []);
        groups.get(div).push(p);
    });

    const checklist = docType === 'MIR'
        ? [
            ['1', 'Material matches approved MAS sample & official brand finish tag', 'Yes / No'],
            ['2', 'Delivered quantities reconciled against Packing List & Delivery Note', 'Yes / No'],
            ['3', 'Packaging, surface finish & factory warranty labels intact without damage', 'Yes / No'],
            ['4', 'Country of origin certificate & manufacturer test reports attached', 'Yes / No'],
        ]
        : [
            ['1', 'Approved Shop Drawings & Coordinated MEP Clearances verified on site', 'Yes / No'],
            ['2', 'Substrate, partition plumbness, & slab levels checked prior to installation', 'Yes / No'],
            ['3', 'Installed workmanship, joint alignment & official finish protection verified', 'Yes / No'],
            ['4', 'Snag-free handover clearance for subsequent trade follow-on', 'Yes / No'],
        ];

    let divIdx = 0;
    for (const [div, rows] of groups.entries()) {
        if (divIdx > 0) doc.addPage();
        divIdx++;
        const refCode = `${refBase}-${String(divIdx).padStart(2, '0')}`;
        let y = drawSubmittalHeader(doc, title, refCode, ctx);
        y = drawProjectMetadataBox(doc, y, ctx, ['Trade / Package:', div]);

        autoTable(doc, {
            startY: y,
            theme: 'grid',
            margin: { left: 10, right: 10 },
            styles: { fontSize: 7.8, cellPadding: 2, lineColor: hexRgb(LINE), lineWidth: 0.15, textColor: hexRgb(INK) },
            headStyles: { fillColor: hexRgb(NAVY), textColor: 255, fontStyle: 'bold' },
            head: [['Ref', 'Description', 'Brand / Model', 'Official Finish', 'Qty', 'Unit', 'Inspect Status']],
            body: rows.map((p, i) => [
                String(p.sn || i + 1),
                clip(p.description, 56),
                clip(productTitle(p), 30),
                clip(p.finishSummary || 'Standard', 28),
                String(p.qty || 0),
                p.unit || 'Nos',
                docType === 'MIR' ? '[ ] Pass  [ ] Hold' : '[ ] Approved',
            ]),
            columnStyles: {
                0: { halign: 'center', cellWidth: 12 },
                4: { halign: 'center', cellWidth: 13 },
                5: { halign: 'center', cellWidth: 13 },
                6: { halign: 'center', cellWidth: 26 },
            },
        });

        let cy = (doc.lastAutoTable?.finalY || 140) + 6;
        if (cy > 220) { doc.addPage(); cy = 20; }
        autoTable(doc, {
            startY: cy,
            theme: 'grid',
            margin: { left: 10, right: 10 },
            styles: { fontSize: 7.8, cellPadding: 2, lineColor: hexRgb(LINE), lineWidth: 0.15, textColor: hexRgb(INK) },
            headStyles: { fillColor: [51, 65, 85], textColor: 255, fontStyle: 'bold' },
            head: [['#', `${docType} QA/QC Inspection Verification Item`, 'Compliance']],
            body: checklist,
            columnStyles: { 0: { halign: 'center', cellWidth: 10 }, 2: { halign: 'center', cellWidth: 26 } },
        });

        drawApprovalFooterBox(doc, (doc.lastAutoTable?.finalY || 225) + 8, [
            'Site QC / Contractor',
            'Consultant Discipline Engineer',
            'Client Representative',
        ]);
    }

    if (divIdx === 0) {
        drawSubmittalHeader(doc, title, refBase, ctx);
    }
    stampFooters(doc, ctx);
    return doc.output('blob');
}

async function buildDeliveryNotePdf(ctx, jsPDF, autoTable) {
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const items = getSubmittalItems(ctx);
    const dnRef = `DN-${String(ctx.project?.number || '001').replace(/[^A-Za-z0-9]/g, '').slice(0, 6) || '001'}`;
    let y = drawSubmittalHeader(doc, 'DELIVERY NOTE', dnRef, ctx);
    y = drawProjectMetadataBox(doc, y, ctx, ['Dispatch Status:', 'Packed / Ready for Site Receipt']);

    const body = items.map((p, i) => [
        String(p.sn || i + 1),
        p.divisionTitle || p.category || 'General',
        clip(p.description, 60),
        clip(productTitle(p), 30),
        clip(p.finishSummary || 'Standard', 26),
        String(p.qty || 0),
        p.unit || 'Nos',
        '[ ] Good',
    ]);

    autoTable(doc, {
        startY: y,
        theme: 'grid',
        margin: { left: 10, right: 10 },
        styles: { fontSize: 7.5, cellPadding: 1.8, lineColor: hexRgb(LINE), lineWidth: 0.15, textColor: hexRgb(INK) },
        headStyles: { fillColor: hexRgb(NAVY), textColor: 255, fontStyle: 'bold' },
        head: [['#', 'Division', 'Description', 'Brand / Model', 'Finish', 'Qty', 'Unit', 'Condition']],
        body: body.length ? body : [['1', 'General', 'No items available', '—', '—', '0', 'Nos', '—']],
        columnStyles: {
            0: { halign: 'center', cellWidth: 10 },
            1: { cellWidth: 26 },
            5: { halign: 'center', cellWidth: 12 },
            6: { halign: 'center', cellWidth: 12 },
            7: { halign: 'center', cellWidth: 18 },
        },
    });

    drawApprovalFooterBox(doc, (doc.lastAutoTable?.finalY || 225) + 10, [
        'Dispatched By (Logistics)',
        'Carrier / Driver Signature',
        'Received at Site By (PM / Storekeeper)',
    ]);
    stampFooters(doc, ctx);
    return doc.output('blob');
}

export async function buildFallbackSubmittals(ctx, pictures = []) {
    const { jsPDF } = await import('jspdf');
    const autoTable = (await import('jspdf-autotable')).default;
    const [mas, mir, wir, dn] = await Promise.all([
        buildMasPdf(ctx, pictures, jsPDF, autoTable),
        buildInspectionPdf('MIR', 'MATERIAL INSPECTION REQUEST', 'MIR', ctx, jsPDF, autoTable),
        buildInspectionPdf('WIR', 'WORK INSPECTION REQUEST', 'WIR', ctx, jsPDF, autoTable),
        buildDeliveryNotePdf(ctx, jsPDF, autoTable),
    ]);
    return [
        { path: 'Submittals/MAS.pdf', blob: mas },
        { path: 'Submittals/MIR.pdf', blob: mir },
        { path: 'Submittals/WIR.pdf', blob: wir },
        { path: 'Submittals/Delivery_Note.pdf', blob: dn },
    ];
}
