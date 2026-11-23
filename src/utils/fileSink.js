// Where BOQ Flow's documents go when they are made: downloaded as usual, or collected
// into a package (the Design & Build package takes the offer, BOQ and submittals as
// they come out of their own generators).

let sink = null;

/** Run `make` and return the files it would have downloaded ([{ name, blob }]), without downloading them. */
export async function captureFiles(make) {
    const previous = sink;
    const files = [];
    sink = files;
    try {
        await make();
    } finally {
        sink = previous;
    }
    return files;
}

/** Save a jsPDF document (or hand it to the package being made). */
export function savePdf(doc, name) {
    if (sink) sink.push({ name, blob: doc.output('blob') });
    else doc.save(name);
}

/** Save a file (or hand it to the package being made). */
export async function saveFile(blob, name) {
    if (sink) {
        sink.push({ name, blob });
        return;
    }
    const { saveAs } = await import('file-saver');
    saveAs(blob, name);
}
