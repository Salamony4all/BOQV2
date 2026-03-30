import { useState, useEffect, useCallback } from 'react';
import styles from '../styles/ActionBar.module.css';

const CURRENCIES = [
    { code: 'USD', name: 'US Dollar', symbol: '$' },
    { code: 'EUR', name: 'Euro', symbol: '€' },
    { code: 'GBP', name: 'British Pound', symbol: '£' },
    { code: 'AED', name: 'UAE Dirham', symbol: 'د.إ' },
    { code: 'SAR', name: 'Saudi Riyal', symbol: '﷼' },
    { code: 'QAR', name: 'Qatari Riyal', symbol: 'ر.ق' },
    { code: 'OMR', name: 'Omani Rial', symbol: 'ر.ع.' },
    { code: 'KWD', name: 'Kuwaiti Dinar', symbol: 'د.ك' },
    { code: 'BHD', name: 'Bahraini Dinar', symbol: '.د.ب' },
    { code: 'INR', name: 'Indian Rupee', symbol: '₹' },
    { code: 'CNY', name: 'Chinese Yuan', symbol: '¥' }
];

// Fallback rates if API fails (approximate rates as of 2024)
const FALLBACK_RATES = {
    'USD': 1,
    'EUR': 0.92,
    'GBP': 0.79,
    'AED': 3.67,
    'SAR': 3.75,
    'QAR': 3.64,
    'OMR': 0.385,
    'KWD': 0.31,
    'BHD': 0.376,
    'INR': 83.5,
    'CNY': 7.24
};

export default function CostingModal({ isOpen, onClose, initialFactors, onApply }) {
    const [factors, setFactors] = useState(initialFactors || {
        profit: 0,
        freight: 0,
        customs: 0,
        installation: 0,
        vat: 5, // Default VAT 5%
        fromCurrency: 'USD',
        toCurrency: 'OMR',
        exchangeRate: 0.385
    });

    const [isLoadingRate, setIsLoadingRate] = useState(false);
    const [rateError, setRateError] = useState(null);
    const [lastUpdated, setLastUpdated] = useState(null);
    const [isManualRate, setIsManualRate] = useState(false);

    useEffect(() => {
        if (initialFactors) setFactors(initialFactors);
    }, [initialFactors]);

    // Fetch exchange rate from API
    const fetchExchangeRate = useCallback(async (from, to) => {
        if (from === to) {
            setFactors(prev => ({ ...prev, exchangeRate: 1 }));
            setLastUpdated(new Date());
            return;
        }

        setIsLoadingRate(true);
        setRateError(null);
        setIsManualRate(false);

        try {
            // Using free exchangerate-api.com (no API key required for basic usage)
            const response = await fetch(
                `https://api.exchangerate-api.com/v4/latest/${from}`
            );

            if (!response.ok) {
                throw new Error('Failed to fetch exchange rate');
            }

            const data = await response.json();

            if (data.rates && data.rates[to]) {
                const rate = data.rates[to];
                setFactors(prev => ({ ...prev, exchangeRate: parseFloat(rate.toFixed(4)) }));
                setLastUpdated(new Date());
            } else {
                throw new Error(`Rate not found for ${to}`);
            }
        } catch (error) {
            console.error('Exchange rate fetch error:', error);
            setRateError('Could not fetch live rate. Using fallback.');

            // Calculate fallback rate
            const fromRate = FALLBACK_RATES[from] || 1;
            const toRate = FALLBACK_RATES[to] || 1;
            const fallbackRate = toRate / fromRate;
            setFactors(prev => ({ ...prev, exchangeRate: parseFloat(fallbackRate.toFixed(4)) }));
            setLastUpdated(null);
        } finally {
            setIsLoadingRate(false);
        }
    }, []);

    // Fetch rate when currencies change
    useEffect(() => {
        if (isOpen && !isManualRate) {
            fetchExchangeRate(factors.fromCurrency, factors.toCurrency);
        }
    }, [factors.fromCurrency, factors.toCurrency, isOpen, fetchExchangeRate, isManualRate]);

    const handleChange = (key, value) => {
        if (key === 'exchangeRate') {
            setIsManualRate(true);
            setRateError(null);
        }
        setFactors(prev => ({ ...prev, [key]: value }));
    };

    const handleCurrencyChange = (key, value) => {
        setIsManualRate(false);
        setFactors(prev => ({ ...prev, [key]: value }));
    };

    const handleRefreshRate = () => {
        setIsManualRate(false);
        fetchExchangeRate(factors.fromCurrency, factors.toCurrency);
    };

    const totalMarkup = factors.profit + factors.freight + factors.customs + factors.installation;
    const samplePrice = 100;
    const markupMultiplier = 1 + totalMarkup / 100;
    const subtotalPrice = samplePrice * markupMultiplier * factors.exchangeRate;
    const vatAmount = subtotalPrice * ((factors.vat || 0) / 100);
    const convertedPrice = subtotalPrice + vatAmount;

    if (!isOpen) return null;

    return (
        <div className={styles.modalOverlay} onClick={onClose}>
            <div className={styles.costingModal} onClick={e => e.stopPropagation()}>
                <div className={styles.modalHeader}>
                    <h2 className={styles.modalTitle}>💰 Costing Factors</h2>
                    <button className={styles.closeBtn} onClick={onClose}>×</button>
                </div>

                <div className={styles.sectionTitle}>Markups & Margins (%)</div>

                <div className={styles.controlGroup}>
                    <div className={styles.labelRow}>
                        <span>Net Profit</span>
                        <span>{factors.profit}%</span>
                    </div>
                    <input
                        type="range" min="0" max="100" step="1"
                        value={factors.profit}
                        onChange={e => handleChange('profit', parseFloat(e.target.value))}
                        className={styles.slider}
                    />
                </div>

                <div className={styles.controlGroup}>
                    <div className={styles.labelRow}>
                        <span>Freight</span>
                        <span>{factors.freight}%</span>
                    </div>
                    <input
                        type="range" min="0" max="50" step="0.5"
                        value={factors.freight}
                        onChange={e => handleChange('freight', parseFloat(e.target.value))}
                        className={styles.slider}
                    />
                </div>

                <div className={styles.controlGroup}>
                    <div className={styles.labelRow}>
                        <span>Customs</span>
                        <span>{factors.customs}%</span>
                    </div>
                    <input
                        type="range" min="0" max="30" step="1"
                        value={factors.customs}
                        onChange={e => handleChange('customs', parseFloat(e.target.value))}
                        className={styles.slider}
                    />
                </div>

                <div className={styles.controlGroup}>
                    <div className={styles.labelRow}>
                        <span>Installation</span>
                        <span>{factors.installation}%</span>
                    </div>
                    <input
                        type="range" min="0" max="50" step="1"
                        value={factors.installation}
                        onChange={e => handleChange('installation', parseFloat(e.target.value))}
                        className={styles.slider}
                    />
                </div>

                <div className={styles.controlGroup}>
                    <div className={styles.labelRow}>
                        <span>VAT (Tax)</span>
                        <span>{factors.vat}%</span>
                    </div>
                    <input
                        type="range" min="0" max="25" step="1"
                        value={factors.vat}
                        onChange={e => handleChange('vat', parseFloat(e.target.value))}
                        className={styles.slider}
                    />
                </div>

                <div className={styles.sectionTitle}>
                    Currency Exchange
                    {isLoadingRate && <span style={{ marginLeft: 10, fontSize: '0.8em', opacity: 0.7 }}>⏳ Loading...</span>}
                </div>

                <div className={styles.currencyRow}>
                    <div>
                        <label style={{ display: 'block', marginBottom: 5, fontSize: '0.8em' }}>From</label>
                        <select
                            className={styles.select}
                            value={factors.fromCurrency}
                            onChange={e => handleCurrencyChange('fromCurrency', e.target.value)}
                            disabled={isLoadingRate}
                        >
                            {CURRENCIES.map(c => (
                                <option key={c.code} value={c.code}>
                                    {c.symbol} {c.code}
                                </option>
                            ))}
                        </select>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', paddingTop: 20 }}>
                        <span style={{ fontSize: '1.5em' }}>→</span>
                    </div>
                    <div>
                        <label style={{ display: 'block', marginBottom: 5, fontSize: '0.8em' }}>To</label>
                        <select
                            className={styles.select}
                            value={factors.toCurrency}
                            onChange={e => handleCurrencyChange('toCurrency', e.target.value)}
                            disabled={isLoadingRate}
                        >
                            {CURRENCIES.map(c => (
                                <option key={c.code} value={c.code}>
                                    {c.symbol} {c.code}
                                </option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label style={{ display: 'block', marginBottom: 5, fontSize: '0.8em' }}>
                            Rate
                            {isManualRate && <span style={{ color: '#f59e0b', marginLeft: 5 }}>(manual)</span>}
                        </label>
                        <div style={{ display: 'flex', gap: 5 }}>
                            <input
                                type="number" step="0.0001"
                                className={styles.input}
                                value={factors.exchangeRate}
                                onChange={e => handleChange('exchangeRate', parseFloat(e.target.value) || 0)}
                                disabled={isLoadingRate}
                                style={{ width: 80 }}
                            />
                            <button
                                onClick={handleRefreshRate}
                                disabled={isLoadingRate}
                                style={{
                                    background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
                                    border: 'none',
                                    borderRadius: 6,
                                    color: 'white',
                                    padding: '8px 12px',
                                    cursor: isLoadingRate ? 'not-allowed' : 'pointer',
                                    fontSize: '0.9em',
                                    opacity: isLoadingRate ? 0.6 : 1
                                }}
                                title="Refresh live rate"
                            >
                                🔄
                            </button>
                        </div>
                    </div>
                </div>

                {/* Rate info */}
                <div style={{
                    fontSize: '0.75em',
                    marginTop: 8,
                    opacity: 0.7,
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center'
                }}>
                    <span>
                        1 {factors.fromCurrency} = {factors.exchangeRate} {factors.toCurrency}
                    </span>
                    {lastUpdated && (
                        <span style={{ color: '#10b981' }}>
                            ✓ Live rate
                        </span>
                    )}
                    {rateError && (
                        <span style={{ color: '#f59e0b' }}>
                            ⚠ {rateError}
                        </span>
                    )}
                </div>

                {/* Calculation Preview */}
                <div style={{
                    marginTop: 20,
                    padding: 15,
                    background: 'rgba(59, 130, 246, 0.1)',
                    borderRadius: 8,
                    border: '1px solid rgba(59, 130, 246, 0.3)'
                }}>
                    <div style={{ fontSize: '0.85em', fontWeight: 'bold', marginBottom: 10, color: '#3b82f6' }}>
                        📊 Calculation Preview
                    </div>
                    <div style={{ fontSize: '0.8em', display: 'flex', flexDirection: 'column', gap: 5 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span>Base Price ({factors.fromCurrency}):</span>
                            <span>{samplePrice.toFixed(2)}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span>Total Markup ({totalMarkup}%):</span>
                            <span>+{(samplePrice * totalMarkup / 100).toFixed(2)}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span>After Markup:</span>
                            <span>{(samplePrice * markupMultiplier).toFixed(2)} {factors.fromCurrency}</span>
                        </div>
                        <div style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            color: '#94a3b8',
                            fontSize: '0.9em'
                        }}>
                            <span>Subtotal ({factors.toCurrency}):</span>
                            <span>{subtotalPrice.toFixed(2)}</span>
                        </div>
                        <div style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            color: '#94a3b8',
                            fontSize: '0.9em'
                        }}>
                            <span>VAT ({factors.vat}%):</span>
                            <span>{vatAmount.toFixed(2)}</span>
                        </div>
                        <div style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            paddingTop: 8,
                            borderTop: '1px dashed rgba(255,255,255,0.2)',
                            fontWeight: 'bold',
                            color: '#f59e0b'
                        }}>
                            <span>Grand Total ({factors.toCurrency}):</span>
                            <span>{convertedPrice.toFixed(2)}</span>
                        </div>
                    </div>
                </div>

                <button className={styles.applyBtn} onClick={() => onApply(factors)}>
                    Apply Costing
                </button>
            </div>
        </div>
    );
}
