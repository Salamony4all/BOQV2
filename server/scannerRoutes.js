/**
 * Express Router for GCC & Oman Market Scanner (/api/scanner/*)
 * 100% Supabase + Node (zero Railway, zero Python, zero SQLite).
 */

import express from 'express';
import {
  SCOPES,
  STAGES,
  getStats,
  listProjects,
  getNearbyProjects,
  getProjectDetail,
  patchProject,
  addProjectContact,
  getNews,
  runLiveScan,
  runObserverCycle,
  enrichLead,
  enrichBatch,
  getTop10Leads,
  buildTop10Digest,
  getDigests,
  getDigestConfig,
  saveDigestConfig,
  toPublicDigestConfig,
  generateStarterBoqForLead,
  listRegionalCountries,
  getRegionalCountry,
  detectCountryFromCoords,
  getAllRegionalPlatforms,
} from './utils/marketScannerEngine.js';

const scannerRouter = express.Router();

scannerRouter.get('/stats', async (req, res) => {
  try {
    const stats = await getStats({ country: req.query.country || 'ALL' });
    res.json({
      ...stats,
      scopes_meta: SCOPES,
      stages_meta: STAGES,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

scannerRouter.get('/projects', async (req, res) => {
  try {
    const projects = await listProjects({
      country: req.query.country || 'ALL',
      scope: req.query.scope || '',
      city: req.query.city || '',
      stage: req.query.stage || '',
      priority: req.query.priority || '',
      q: req.query.q || '',
      includeNews: req.query.includeNews === 'true' || req.query.includeNews === '1',
      sort: req.query.sort || 'heat',
      limit: req.query.limit ? Number(req.query.limit) : 200,
    });
    res.json({ ok: true, count: projects.length, projects });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

scannerRouter.get('/projects/nearby', async (req, res) => {
  try {
    const out = await getNearbyProjects({
      lat: req.query.lat,
      lng: req.query.lng ?? req.query.lon,
      radiusKm: req.query.radiusKm ?? req.query.radius ?? 60,
      country: req.query.country || 'ALL',
      scope: req.query.scope || '',
    });
    res.json({ ok: true, ...out });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

scannerRouter.get('/regional/nearby', async (req, res) => {
  try {
    const out = await getNearbyProjects({
      lat: req.query.lat,
      lng: req.query.lng ?? req.query.lon,
      radiusKm: req.query.radiusKm ?? req.query.radius ?? 60,
      country: req.query.country || 'ALL',
      scope: req.query.scope || '',
    });
    res.json({ ok: true, ...out });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

scannerRouter.get('/projects/:id', async (req, res) => {
  try {
    const detail = await getProjectDetail(req.params.id);
    if (!detail) return res.status(404).json({ error: 'Project lead not found' });
    res.json({ ok: true, project: detail, ...detail });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

scannerRouter.patch('/projects/:id', async (req, res) => {
  try {
    const updated = await patchProject(req.params.id, req.body || {});
    if (!updated) return res.status(404).json({ error: 'Project lead not found' });
    res.json({ ok: true, project: updated, ...updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

scannerRouter.post('/projects/:id/contacts', async (req, res) => {
  try {
    const updated = await addProjectContact(req.params.id, req.body || {});
    if (!updated) return res.status(404).json({ error: 'Project lead not found' });
    res.json({ ok: true, project: updated, contacts: updated.contacts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

scannerRouter.post('/projects/:id/starter-boq', async (req, res) => {
  try {
    const out = await generateStarterBoqForLead(req.params.id);
    if (!out) return res.status(404).json({ error: 'Project lead not found' });
    res.json(out);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

scannerRouter.post('/projects/:id/enrich', async (req, res) => {
  try {
    const updated = await enrichLead(req.params.id);
    if (!updated) return res.status(404).json({ error: 'Project lead not found' });
    res.json({ ok: true, project: updated, ...updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

scannerRouter.post('/enrich/:id', async (req, res) => {
  try {
    const updated = await enrichLead(req.params.id);
    if (!updated) return res.status(404).json({ error: 'Project lead not found' });
    res.json({ ok: true, project: updated, ...updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

scannerRouter.post('/enrich', async (req, res) => {
  try {
    const out = await enrichBatch({
      limit: req.body?.limit || 6,
      country: req.body?.country || 'ALL',
    });
    res.json(out);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

scannerRouter.get('/news', async (req, res) => {
  try {
    const items = await getNews({
      country: req.query.country || 'ALL',
      q: req.query.q || '',
      limit: req.query.limit ? Number(req.query.limit) : 40,
    });
    res.json({ ok: true, count: items.length, news: items });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

scannerRouter.post('/scan', async (req, res) => {
  try {
    const out = await runLiveScan({
      mode: req.body?.mode || 'standard',
      country: req.body?.country || 'ALL',
    });
    res.json(out);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

scannerRouter.post('/observer/run', async (req, res) => {
  try {
    const out = await runObserverCycle({ limit: req.body?.limit || 12 });
    res.json(out);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

scannerRouter.get('/digest/top10', async (req, res) => {
  try {
    const top10 = await getTop10Leads({ country: req.query.country || 'ALL' });
    res.json({ ok: true, count: top10.length, top10 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

scannerRouter.post('/digest/run', async (req, res) => {
  try {
    const out = await buildTop10Digest({
      country: req.body?.country || 'ALL',
      autoEnrich: Boolean(req.body?.autoEnrich),
      notify: Boolean(req.body?.notify),
    });
    res.json(out);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

scannerRouter.get('/digest/history', async (req, res) => {
  try {
    const digests = await getDigests(req.query.limit ? Number(req.query.limit) : 15);
    res.json({ ok: true, digests });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// These endpoints are open to every visitor, so the saved webhook address is never sent back:
// the response only says whether one is saved (see toPublicDigestConfig).
scannerRouter.get('/digest/config', async (_req, res) => {
  try {
    const config = toPublicDigestConfig(await getDigestConfig());
    res.json({ ok: true, config });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

scannerRouter.post('/digest/config', async (req, res) => {
  try {
    const config = toPublicDigestConfig(await saveDigestConfig(req.body || {}));
    res.json({ ok: true, config });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

scannerRouter.get('/regional/countries', (_req, res) => {
  res.json({ ok: true, countries: listRegionalCountries() });
});

scannerRouter.get('/regional/country/:code', (req, res) => {
  res.json({ ok: true, country: getRegionalCountry(req.params.code) });
});

scannerRouter.get('/regional/detect', (req, res) => {
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng ?? req.query.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return res.status(400).json({ error: 'lat and lng required' });
  }
  res.json({ ok: true, ...detectCountryFromCoords(lat, lng) });
});

scannerRouter.get('/regional/platforms', (_req, res) => {
  res.json({ ok: true, platforms: getAllRegionalPlatforms() });
});

export default scannerRouter;
