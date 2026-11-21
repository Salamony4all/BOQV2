import React, { useState } from 'react';
import { useCompanyProfile } from '../context/CompanyContext';
import { useTheme } from '../context/ThemeContext';
import { DEFAULT_AI_SETTINGS } from '../utils/aiConstants';

const PIPELINES = [
  {
    id: 'wordcom_v22',
    label: 'Smart Document Parser',
    subtitle: 'Native Engine',
    badge: 'Recommended',
    color: '#0f766e',
    lightBg: '#f0fdfa',
    lightBorder: '#0d9488',
    darkBg: 'rgba(15, 118, 110, 0.16)',
    gradient: 'linear-gradient(135deg, #0f766e 0%, #0d9488 100%)',
    chips: ['Instant Extraction', 'Preserves Source Headers', 'Native HD Images'],
    desc: 'High-speed native BOQ & specification extractor. Accurately preserves table headers, multi-page layouts, and embedded product images with zero AI token cost.',
    ctaLabel: 'Extract and Consolidate',
    iconType: 'native',
  },
  {
    id: 'default',
    label: 'AI Vision Extractor',
    subtitle: 'Multimodal AI + Native',
    badge: 'AI Powered',
    color: '#7c3aed',
    lightBg: '#f5f3ff',
    lightBorder: '#7c3aed',
    darkBg: 'rgba(124, 58, 237, 0.16)',
    gradient: 'linear-gradient(135deg, #6366f1 0%, #7c3aed 100%)',
    chips: ['Scanned & Visual PDFs', 'Complex Layouts', 'AI + Image Pairing'],
    desc: 'AI vision-powered extraction paired with native image capture. Ideal for scanned BOQs, image-heavy presentations, or non-standard table layouts.',
    ctaLabel: 'Extract with AI Vision',
    iconType: 'ai',
  },
];

const PdfModelModal = ({ isOpen, onClose, onExtract, fileName }) => {
  const { aiSettings } = useCompanyProfile();
  const { theme } = useTheme();
  const [selectedPipeline, setSelectedPipeline] = useState('wordcom_v22');

  if (!isOpen) return null;

  const isLight = theme === 'light';
  const currentModel = aiSettings?.model || DEFAULT_AI_SETTINGS.model;
  const chosen = PIPELINES.find(p => p.id === selectedPipeline) || PIPELINES[0];

  const handleExtract = () => {
    const isNative = selectedPipeline === 'wordcom_v22';
    onExtract(currentModel, selectedPipeline, isNative ? {
      fileCount: 1,
      consolidateBoqAndSpecs: true,
      preserveSourceHeaders: true,
      dynamicSpecificationAttributes: true,
      excludeDocumentMetadata: true,
      excludeLogos: true,
      preserveMultipleImages: true
    } : undefined);
  };

  const renderIcon = (iconType) => {
    if (iconType === 'native') {
      return (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="8" y1="13" x2="16" y2="13" />
          <line x1="8" y1="17" x2="16" y2="17" />
          <line x1="10" y1="9" x2="8" y2="9" />
        </svg>
      );
    }
    return (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 2L14.8 8.6L22 9.3L16.5 14L18.2 21L12 17.3L5.8 21L7.5 14L2 9.3L9.2 8.6L12 2Z" />
      </svg>
    );
  };

  return (
    <>
      <style>{`
        @keyframes pdmFadeIn { from { opacity: 0 } to { opacity: 1 } }
        @keyframes pdmSlideUp { from { transform: translateY(18px) scale(0.98); opacity: 0 } to { transform: translateY(0) scale(1); opacity: 1 } }
        .pdm-card { transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1); cursor: pointer; }
        .pdm-card:hover { transform: translateY(-2px); }
        .pdm-extract:hover { transform: translateY(-1px) !important; filter: brightness(1.06); }
        .pdm-cancel:hover { background: ${isLight ? '#f1f5f9' : 'rgba(255,255,255,0.08)'} !important; }
        .pdm-close:hover { background: #ef4444 !important; color: #ffffff !important; }
      `}</style>

      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: isLight ? 'rgba(15, 23, 42, 0.45)' : 'rgba(0, 0, 0, 0.68)',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '20px',
          zIndex: 9999,
          animation: 'pdmFadeIn 0.2s ease'
        }}
      >
        <div
          onClick={e => e.stopPropagation()}
          style={{
            background: isLight ? '#ffffff' : 'var(--bg-secondary, #1e293b)',
            border: isLight ? '1px solid #cbd5e1' : '1px solid var(--border-color, rgba(255,255,255,0.12))',
            borderRadius: '20px',
            width: '580px',
            maxWidth: '95vw',
            maxHeight: '90vh',
            boxShadow: isLight
              ? '0 24px 60px rgba(15, 23, 42, 0.18)'
              : '0 30px 65px rgba(0, 0, 0, 0.55)',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            animation: 'pdmSlideUp 0.28s cubic-bezier(0.16, 1, 0.3, 1)'
          }}
        >
          {/* ── Header ── */}
          <div style={{
            padding: '22px 26px 18px',
            borderBottom: `1px solid ${isLight ? '#e2e8f0' : 'rgba(255,255,255,0.1)'}`,
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: '14px',
            flexShrink: 0
          }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <h2 style={{
                margin: 0,
                fontSize: '1.3rem',
                fontWeight: 800,
                letterSpacing: '-0.02em',
                color: isLight ? '#0f172a' : '#f8fafc'
              }}>
                PDF BOQ Extraction
              </h2>
              <div style={{
                marginTop: '6px',
                display: 'flex',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '8px'
              }}>
                <span style={{
                  fontSize: '0.84rem',
                  color: isLight ? '#475569' : '#94a3b8',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  maxWidth: '100%'
                }}>
                  File: <strong style={{ color: isLight ? '#0f172a' : '#f1f5f9' }}>{fileName || 'Uploaded PDF'}</strong>
                </span>
                {selectedPipeline === 'default' && (
                  <span style={{
                    fontSize: '0.72rem',
                    fontWeight: 700,
                    color: isLight ? '#5b21b6' : '#ddd6fe',
                    background: isLight ? '#ede9fe' : 'rgba(124, 58, 237, 0.22)',
                    border: `1px solid ${isLight ? '#c4b5fd' : 'rgba(167, 139, 250, 0.35)'}`,
                    borderRadius: '999px',
                    padding: '2px 9px'
                  }}>
                    Model: {currentModel}
                  </span>
                )}
              </div>
            </div>

            <button
              type="button"
              className="pdm-close"
              onClick={onClose}
              aria-label="Close modal"
              style={{
                width: 32,
                height: 32,
                borderRadius: '50%',
                border: 'none',
                background: isLight ? '#f1f5f9' : 'rgba(255,255,255,0.08)',
                color: isLight ? '#475569' : '#94a3b8',
                fontSize: '1.25rem',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                transition: 'all 0.2s ease'
              }}
            >
              ×
            </button>
          </div>

          {/* ── Method Selector ── */}
          <div style={{ padding: '20px 26px 22px', overflowY: 'auto' }}>
            <div style={{
              fontSize: '0.74rem',
              fontWeight: 800,
              textTransform: 'uppercase',
              letterSpacing: '0.09em',
              color: isLight ? '#64748b' : '#94a3b8',
              marginBottom: '12px'
            }}>
              Select Extraction Engine
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {PIPELINES.map(p => {
                const isActive = selectedPipeline === p.id;
                const activeBg = isLight ? p.lightBg : p.darkBg;
                const inactiveBg = isLight ? '#f8fafc' : 'rgba(255,255,255,0.03)';
                const inactiveBorder = isLight ? '#cbd5e1' : 'rgba(255,255,255,0.12)';

                return (
                  <div
                    key={p.id}
                    className="pdm-card"
                    role="radio"
                    aria-checked={isActive}
                    tabIndex={0}
                    onClick={() => setSelectedPipeline(p.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setSelectedPipeline(p.id);
                      }
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '14px',
                      padding: '16px 18px',
                      borderRadius: '14px',
                      border: isActive ? `2px solid ${p.color}` : `1.5px solid ${inactiveBorder}`,
                      background: isActive ? activeBg : inactiveBg,
                      boxShadow: isActive ? `0 0 0 3px ${p.color}24, 0 8px 20px ${p.color}18` : 'none',
                    }}
                  >
                    {/* Icon Badge */}
                    <div style={{
                      width: 44,
                      height: 44,
                      borderRadius: '12px',
                      background: isActive ? p.gradient : (isLight ? '#e2e8f0' : 'rgba(255,255,255,0.08)'),
                      color: isActive ? '#ffffff' : (isLight ? '#475569' : '#cbd5e1'),
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                      boxShadow: isActive ? `0 6px 14px ${p.color}38` : 'none',
                      transition: 'all 0.2s ease'
                    }}>
                      {renderIcon(p.iconType)}
                    </div>

                    {/* Text & Feature Chips */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        flexWrap: 'wrap',
                        gap: '8px',
                        marginBottom: '4px'
                      }}>
                        <span style={{
                          fontSize: '0.98rem',
                          fontWeight: 800,
                          color: isActive
                            ? (isLight ? p.color : '#ffffff')
                            : (isLight ? '#0f172a' : '#f1f5f9')
                        }}>
                          {p.label}
                        </span>
                        <span style={{
                          fontSize: '0.66rem',
                          fontWeight: 800,
                          textTransform: 'uppercase',
                          letterSpacing: '0.06em',
                          padding: '2px 8px',
                          borderRadius: '999px',
                          background: isActive ? p.gradient : (isLight ? '#e2e8f0' : 'rgba(255,255,255,0.1)'),
                          color: isActive ? '#ffffff' : (isLight ? '#475569' : '#cbd5e1')
                        }}>
                          {p.badge}
                        </span>
                      </div>

                      <div style={{
                        fontSize: '0.82rem',
                        color: isLight ? '#475569' : '#cbd5e1',
                        lineHeight: 1.48
                      }}>
                        {p.desc}
                      </div>

                      <div style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: '6px',
                        marginTop: '10px'
                      }}>
                        {p.chips.map(chip => (
                          <span
                            key={chip}
                            style={{
                              fontSize: '0.68rem',
                              fontWeight: 700,
                              padding: '3px 8px',
                              borderRadius: '6px',
                              background: isLight
                                ? (isActive ? '#ffffff' : '#eef2f6')
                                : (isActive ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.05)'),
                              border: `1px solid ${isActive ? `${p.color}44` : (isLight ? '#cbd5e1' : 'rgba(255,255,255,0.1)')}`,
                              color: isActive
                                ? (isLight ? p.color : '#f8fafc')
                                : (isLight ? '#475569' : '#94a3b8')
                            }}
                          >
                            {chip}
                          </span>
                        ))}
                      </div>
                    </div>

                    {/* Selection Radio Check */}
                    <div style={{
                      width: 22,
                      height: 22,
                      borderRadius: '50%',
                      flexShrink: 0,
                      marginTop: '2px',
                      border: `2px solid ${isActive ? p.color : (isLight ? '#94a3b8' : 'rgba(255,255,255,0.28)')}`,
                      background: isActive ? p.color : 'transparent',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      transition: 'all 0.2s ease'
                    }}>
                      {isActive && (
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* ── Footer ── */}
          <div style={{
            padding: '16px 26px 20px',
            borderTop: `1px solid ${isLight ? '#e2e8f0' : 'rgba(255,255,255,0.1)'}`,
            background: isLight ? '#f8fafc' : 'rgba(15, 23, 42, 0.28)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '12px',
            flexShrink: 0
          }}>
            <button
              type="button"
              className="pdm-cancel"
              onClick={onClose}
              style={{
                padding: '10px 22px',
                borderRadius: '10px',
                background: isLight ? '#ffffff' : 'transparent',
                border: `1px solid ${isLight ? '#cbd5e1' : 'rgba(255,255,255,0.16)'}`,
                color: isLight ? '#334155' : '#cbd5e1',
                fontWeight: 700,
                cursor: 'pointer',
                fontSize: '0.9rem',
                transition: 'all 0.2s ease'
              }}
            >
              Cancel
            </button>

            <button
              type="button"
              className="pdm-extract"
              onClick={handleExtract}
              style={{
                padding: '11px 28px',
                background: chosen.gradient,
                color: '#ffffff',
                border: 'none',
                borderRadius: '11px',
                fontWeight: 800,
                fontSize: '0.94rem',
                cursor: 'pointer',
                boxShadow: `0 6px 18px ${chosen.color}48`,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                transition: 'all 0.2s ease'
              }}
            >
              {chosen.ctaLabel}
            </button>
          </div>
        </div>
      </div>
    </>
  );
};

export default PdfModelModal;
