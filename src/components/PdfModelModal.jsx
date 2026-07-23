import React, { useState } from 'react';
import { useCompanyProfile } from '../context/CompanyContext';
import { DEFAULT_AI_SETTINGS } from '../utils/aiConstants';

/* ─── Inline styles for the pipeline cards ─── */
const overlay = {
  position: 'fixed', inset: 0,
  background: 'rgba(0,0,0,0.65)',
  backdropFilter: 'blur(10px)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  zIndex: 9999,
  animation: 'pdmFadeIn 0.25s ease'
};

const modal = {
  background: 'var(--bg-secondary, #1e293b)',
  border: '1px solid var(--border-color, rgba(255,255,255,0.1))',
  borderRadius: '20px',
  width: '580px', maxWidth: '95vw',
  boxShadow: '0 30px 60px rgba(0,0,0,0.5)',
  overflow: 'hidden',
  animation: 'pdmSlideUp 0.35s cubic-bezier(0.16,1,0.3,1)'
};

const PIPELINES = [
  {
    id: 'wordcom',
    label: 'PDF WordCom',
    icon: '📄',
    color: '#0284c7',
    gradient: 'linear-gradient(135deg,#0284c7,#0369a1)',
    desc: 'Our universal WordCom extractor. Best first choice for BOQ/FFE PDFs, preserving layout, images, embedded objects, and complex table structure.',
  },
  {
    id: 'wordcom_vercel',
    label: 'PDF WordCom (Vercel Safe)',
    icon: '⚡',
    color: '#10b981',
    gradient: 'linear-gradient(135deg,#10b981,#059669)',
    desc: 'Cloned Vercel-safe WebAssembly MuPDF parser with Supabase cloud image upload.',
  },
  {
    id: 'default',
    label: 'PDF AI + Native',
    icon: '🧠',
    color: '#7c3aed',
    gradient: 'linear-gradient(135deg,#7c3aed,#4f46e5)',
    desc: 'AI vision-based extraction with native image pairing. Good fallback for standard BOQ PDFs with visual product references.',
  },
];

const PdfModelModal = ({ isOpen, onClose, onExtract, fileName }) => {
  const { aiSettings } = useCompanyProfile();
  const [selectedPipeline, setSelectedPipeline] = useState('wordcom');
  const [doclingOcr, setDoclingOcr] = useState(false);

  if (!isOpen) return null;

  const currentModel = aiSettings?.model || DEFAULT_AI_SETTINGS.model;
  const chosen = PIPELINES.find(p => p.id === selectedPipeline);

  const handleExtract = () => {
    onExtract(currentModel, selectedPipeline);
  };

  return (
    <>
      <style>{`
        @keyframes pdmFadeIn { from { opacity:0 } to { opacity:1 } }
        @keyframes pdmSlideUp { from { transform:translateY(24px);opacity:0 } to { transform:translateY(0);opacity:1 } }
        .pdm-card { transition: all 0.2s ease; cursor: pointer; }
        .pdm-card:hover { transform: translateY(-3px); }
        .pdm-extract:hover { transform: translateY(-2px) !important; box-shadow: 0 12px 40px rgba(124,58,237,0.5) !important; }
      `}</style>

      <div style={overlay} onClick={onClose}>
        <div style={modal} onClick={e => e.stopPropagation()}>

          {/* ── Header ── */}
          <div style={{
            padding: '28px 30px 20px',
            borderBottom: '1px solid var(--border-color, rgba(255,255,255,0.1))',
            position: 'relative'
          }}>
            <h2 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 700, color: 'var(--text-primary, #f8fafc)' }}>
              PDF BOQ Extraction
            </h2>
            <p style={{ margin: '6px 0 0', fontSize: '0.9rem', color: 'var(--text-secondary, #94a3b8)' }}>
              Analyzing: <strong style={{ color: 'var(--text-primary,#f8fafc)' }}>{fileName}</strong>
            </p>
            <p style={{
              margin: '6px 0 0', fontSize: '0.8rem',
              color: 'var(--text-muted, #64748b)',
              background: 'rgba(124,58,237,0.12)', borderRadius: '6px',
              display: 'inline-block', padding: '3px 10px'
            }}>
              AI Model: {currentModel}
            </p>
            <button onClick={onClose} style={{
              position: 'absolute', top: 20, right: 20,
              background: 'none', border: 'none', fontSize: '1.6rem',
              color: 'var(--text-muted, #64748b)', cursor: 'pointer', lineHeight: 1
            }}>×</button>
          </div>

          {/* ── Pipeline Selector ── */}
          <div style={{ padding: '24px 30px' }}>
            <p style={{
              fontSize: '0.8rem', fontWeight: 700, textTransform: 'uppercase',
              letterSpacing: '0.08em', color: 'var(--text-secondary,#94a3b8)',
              marginBottom: '14px'
            }}>
              Extraction Pipeline
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {PIPELINES.map(p => {
                const isActive = selectedPipeline === p.id;
                return (
                  <div
                    key={p.id}
                    className="pdm-card"
                    onClick={() => setSelectedPipeline(p.id)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '16px',
                      padding: '14px 16px',
                      borderRadius: '14px',
                      border: isActive
                        ? `2px solid ${p.color}`
                        : '2px solid var(--border-color, rgba(255,255,255,0.1))',
                      background: isActive
                        ? `${p.color}1a`
                        : 'var(--bg-surface, rgba(255,255,255,0.03))',
                      boxShadow: isActive ? `0 0 0 3px ${p.color}33` : 'none',
                    }}
                  >
                    {/* Icon */}
                    <div style={{
                      width: 46, height: 46, borderRadius: 12, flexShrink: 0,
                      background: p.gradient,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: '1.4rem',
                      boxShadow: `0 4px 12px ${p.color}44`
                    }}>
                      {p.icon}
                    </div>

                    {/* Text */}
                    <div style={{ flex: 1 }}>
                      <div style={{
                        fontSize: '0.97rem', fontWeight: 700,
                        color: isActive ? p.color : 'var(--text-primary, #f8fafc)',
                        marginBottom: '2px'
                      }}>
                        {p.label}
                      </div>
                      <div style={{
                        fontSize: '0.82rem',
                        color: 'var(--text-muted, #64748b)',
                        lineHeight: 1.45
                      }}>
                        {p.desc}
                      </div>
                    </div>

                    {/* Checkmark */}
                    <div style={{
                      width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
                      border: `2px solid ${isActive ? p.color : 'var(--border-color, rgba(255,255,255,0.2))'}`,
                      background: isActive ? p.color : 'transparent',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      transition: 'all 0.2s'
                    }}>
                      {isActive && <span style={{ color: '#fff', fontSize: '0.7rem', fontWeight: 900 }}>✓</span>}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Word COM Info */}
            {selectedPipeline === 'wordcom' && (
              <div style={{
                marginTop: '16px',
                padding: '12px 16px',
                borderRadius: '12px',
                background: 'rgba(139, 92, 246, 0.08)',
                border: '1px dashed rgba(139, 92, 246, 0.3)',
                display: 'flex',
                alignItems: 'flex-start',
                gap: '12px',
                animation: 'pdmFadeIn 0.2s ease'
              }}>
                <span style={{ fontSize: '1.2rem', flexShrink: 0 }}>ℹ️</span>
                <span style={{ fontSize: '0.78rem', color: 'var(--text-muted, #64748b)', lineHeight: 1.5 }}>
                  Requires Windows with Microsoft Word installed. Preserves original layout, formatting, images, and embedded objects.
                </span>
              </div>
            )}

            {/* Word COM Info */}
            {selectedPipeline === 'wordcom' && (
              <div style={{
                marginTop: '16px',
                padding: '12px 16px',
                borderRadius: '12px',
                background: 'rgba(139, 92, 246, 0.08)',
                border: '1px dashed rgba(139, 92, 246, 0.3)',
                display: 'flex',
                alignItems: 'flex-start',
                gap: '12px',
                animation: 'pdmFadeIn 0.2s ease'
              }}>
                <span style={{ fontSize: '1.2rem', flexShrink: 0 }}>ℹ️</span>
                <span style={{ fontSize: '0.78rem', color: 'var(--text-muted, #64748b)', lineHeight: 1.5 }}>
                  Requires Windows with Microsoft Word installed. Preserves original layout, formatting, images, and embedded objects.
                </span>
              </div>
            )}
          </div>

          {/* ── Footer ── */}
          <div style={{
            padding: '16px 30px 24px',
            borderTop: '1px solid var(--border-color, rgba(255,255,255,0.1))',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center'
          }}>
            <button
              onClick={onClose}
              style={{
                padding: '11px 24px', borderRadius: 10,
                background: 'transparent',
                border: '1px solid var(--border-color, rgba(255,255,255,0.15))',
                color: 'var(--text-secondary, #94a3b8)',
                fontWeight: 600, cursor: 'pointer', fontSize: '0.95rem'
              }}
            >
              Cancel
            </button>

            <button
              className="pdm-extract"
              onClick={handleExtract}
              style={{
                padding: '13px 36px',
                background: chosen?.gradient || 'linear-gradient(135deg,#7c3aed,#4f46e5)',
                color: '#fff',
                border: 'none',
                borderRadius: 12,
                fontWeight: 700,
                fontSize: '1rem',
                cursor: 'pointer',
                boxShadow: `0 6px 20px ${chosen?.color || '#7c3aed'}55`,
                display: 'flex', alignItems: 'center', gap: 8,
                transition: 'all 0.25s ease'
              }}
            >
              <span style={{ fontSize: '1.1rem' }}>{chosen?.icon}</span>
              Extract with {chosen?.label}
            </button>
          </div>

        </div>
      </div>
    </>
  );
};

export default PdfModelModal;
