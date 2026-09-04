import React, { useState, useRef, useEffect } from 'react';
import styles from '../styles/BrandDropdown.module.css';
import { getBrandLogo, getBrandLogoFallback } from '../utils/urlUtils';

/**
 * Modern Brand Dropdown Component
 * Supports:
 * - Single/Multiple selection
 * - Search filtering
 * - Brand logos
 * - Premium animations via CSS
 */
const BrandDropdown = ({ 
    brands = [], 
    selectedBrands = [], // Array of brand names or single brand name
    onSelect, 
    onRemove,
    placeholder = "Select Brand...",
    multiple = false,
    label = ""
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const [searchTerm, setSearchTerm] = useState("");
    const dropdownRef = useRef(null);

    // Close dropdown when clicking outside
    useEffect(() => {
        const handleClickOutside = (event) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
                setIsOpen(false);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    const filteredBrands = brands.filter(brand => 
        brand.name.toLowerCase().includes(searchTerm.toLowerCase())
    );

    const handleToggle = () => setIsOpen(!isOpen);

    const handleSelect = (brand) => {
        if (multiple) {
            if (!selectedBrands.includes(brand.name)) {
                onSelect(brand);
            }
        } else {
            onSelect(brand);
            setIsOpen(false);
        }
        setSearchTerm("");
    };

    const isSelected = (brandName) => {
        if (multiple) return selectedBrands.includes(brandName);
        if (!selectedBrands || !brandName) return false;
        return selectedBrands === brandName || String(selectedBrands).toLowerCase().trim() === String(brandName).toLowerCase().trim();
    };

    const getSelectedBrandObj = () => {
        if (!selectedBrands) return null;
        if (multiple) {
            return brands.filter(b => selectedBrands.includes(b.name));
        }
        const val = String(selectedBrands).toLowerCase().trim();
        const found = brands.find(b => b.name === selectedBrands)
            || brands.find(b => b.name && b.name.toLowerCase().trim() === val)
            || brands.find(b => b.name && (b.name.toLowerCase().includes(val) || val.includes(b.name.toLowerCase())));
        if (found) return found;
        // Fallback for newly detected or custom brands not yet in brands array
        if (typeof selectedBrands === 'string' && selectedBrands.trim()) {
            return { name: selectedBrands.trim(), logo: '' };
        }
        return null;
    };

    const selectedBrand = getSelectedBrandObj();

    return (
        <div className={styles.dropdownContainer} ref={dropdownRef}>
            {label && <div className={styles.dropdownLabel}>{label}</div>}
            
            <div 
                className={`${styles.dropdownTrigger} ${isOpen ? styles.isOpen : ""}`}
                onClick={handleToggle}
            >
                <div className={styles.triggerText}>
                    {selectedBrand ? (
                        <>
                            <img src={getBrandLogo(selectedBrand)} alt="" className={styles.triggerLogo} onError={(e) => { e.target.onerror = null; e.target.src = getBrandLogoFallback(selectedBrand); }} />
                            <span>{selectedBrand.name}</span>
                        </>
                    ) : (
                        <span className={styles.placeholder}>{placeholder}</span>
                    )}
                </div>
                <span className={styles.triggerArrow}></span>
            </div>

            {isOpen && (
                <div className={styles.dropdownMenu}>
                    <div className={styles.searchBox}>
                        <input 
                            type="text" 
                            className={styles.searchInput}
                            placeholder="Search brands..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            autoFocus
                        />
                    </div>
                    
                    <div className={styles.optionsList}>
                        {filteredBrands.length > 0 ? (
                            filteredBrands.map(brand => (
                                <div 
                                    key={brand.id || brand.name}
                                    className={`${styles.option} ${isSelected(brand.name) ? styles.isSelected : ""}`}
                                    onClick={() => handleSelect(brand)}
                                >
                                    <img src={getBrandLogo(brand)} alt="" className={styles.optionLogo} onError={(e) => { e.target.onerror = null; e.target.src = getBrandLogoFallback(brand); }} />
                                    <span className={styles.optionName}>{brand.name}</span>
                                    {isSelected(brand.name) && <span className={styles.checkIcon}></span>}
                                </div>
                            ))
                        ) : (
                            <div className={styles.emptyState}>No brands found</div>
                        )}
                    </div>
                </div>
            )}

            {multiple && selectedBrands.length > 0 && Array.isArray(selectedBrands) && (
                <div className={styles.selectedBrandsList}>
                    {selectedBrands.map(brandName => {
                        const brand = brands.find(b => b.name === brandName);
                        if (!brand) return null;
                        return (
                            <div key={brandName} className={styles.brandChip}>
                                <img src={getBrandLogo(brand)} alt="" className={styles.chipLogo} onError={(e) => { e.target.onerror = null; e.target.src = getBrandLogoFallback(brand); }} />
                                <span>{brandName}</span>
                                <button 
                                    className={styles.removeChip}
                                    onClick={() => onRemove(brandName)}
                                >
                                    
                                </button>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

export default BrandDropdown;
