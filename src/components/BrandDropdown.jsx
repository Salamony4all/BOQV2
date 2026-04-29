import React, { useState, useRef, useEffect } from 'react';
import styles from '../styles/BrandDropdown.module.css';

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
        return selectedBrands === brandName;
    };

    const getSelectedBrandObj = () => {
        if (multiple) return null;
        return brands.find(b => b.name === selectedBrands);
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
                            {selectedBrand.logo && <img src={selectedBrand.logo} alt="" className={styles.triggerLogo} />}
                            <span>{selectedBrand.name}</span>
                        </>
                    ) : (
                        <span className={styles.placeholder}>{placeholder}</span>
                    )}
                </div>
                <span className={styles.triggerArrow}>▼</span>
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
                                    {brand.logo && <img src={brand.logo} alt="" className={styles.optionLogo} />}
                                    <span className={styles.optionName}>{brand.name}</span>
                                    {isSelected(brand.name) && <span className={styles.checkIcon}>✓</span>}
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
                                {brand.logo && <img src={brand.logo} alt="" className={styles.chipLogo} />}
                                <span>{brandName}</span>
                                <button 
                                    className={styles.removeChip}
                                    onClick={() => onRemove(brandName)}
                                >
                                    ✕
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
