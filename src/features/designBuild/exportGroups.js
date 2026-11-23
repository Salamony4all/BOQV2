// Which folders of the Design & Build package can be made now, and why not.
// Shared by the export suite panel and the one-click "Download package".

/** { ok, note } for one folder of the package (SUITE_GROUPS entry) and the store's state. */
export function suiteGroupState(g, s) {
    const offer = s.offer?.tables?.length ? s.offer : null;
    switch (g.key) {
        case 'boq':
            // BOQ Flow's own offer PDF and Excel when its table is open, else the package's own BOQ.
            if (s.documents) return { ok: true, note: `Offer PDF and Excel from the ${s.documents.source}, as BOQ Flow's exports make them` };
            return offer ? { ok: true, note: `${offer.tables.length} sheet${offer.tables.length === 1 ? '' : 's'} from the applied offer` } : { ok: false, note: 'Apply an offer first' };
        case 'submittals':
            return s.documents
                ? { ok: true, note: `Material approval, inspection requests and delivery note from the ${s.documents.source}` }
                : { ok: false, note: 'Open the BOQ table in BOQ Flow' };
        case 'ffe': {
            const custom = (s.customItems || []).length;
            const extra = custom ? ` (${custom} custom)` : '';
            const n = s.products.length + custom;
            return n ? { ok: true, note: `${n} products${extra} with pictures, colours, links and where each piece stands` } : { ok: false, note: 'Apply an offer first' };
        }
        case 'renders':
            return { ok: s.renders.length > 0, note: `${s.renders.length} render${s.renders.length === 1 ? '' : 's'}, the approved one first` };
        case 'drawings':
            return { ok: true, note: 'The source drawing, the extracted plan, and the plan with each product\'s photo in place' };
        case 'presentation':
            return { ok: true, note: 'Cover with your logo and project, the space, plan, renders, products, schedule' };
        case 'model':
            return { ok: true, note: 'The 3D scene from Design & Build' };
        default:
            return { ok: true, note: 'Extraction and product placement audit' };
    }
}
