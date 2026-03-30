import { useRef, useState } from 'react';
import styles from '../styles/FileUpload.module.css';

function FileUpload({ onFileSelect, disabled, title }) {
    const fileInputRef = useRef(null);
    const [isDragging, setIsDragging] = useState(false);

    const handleDragOver = (e) => {
        e.preventDefault();
        if (!disabled) setIsDragging(true);
    };

    const handleDragLeave = (e) => {
        e.preventDefault();
        setIsDragging(false);
    };

    const handleDrop = (e) => {
        e.preventDefault();
        setIsDragging(false);

        if (disabled) return;

        const files = e.dataTransfer.files;
        if (files.length > 0) {
            handleFile(files[0]);
        }
    };

    const handleFileInput = (e) => {
        if (e.target.files.length > 0) {
            handleFile(e.target.files[0]);
        }
    };

    const handleFile = (file) => {
        const validTypes = [
            'application/vnd.ms-excel',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        ];

        if (!validTypes.includes(file.type)) {
            alert('Please upload a valid Excel file (.xls or .xlsx)');
            return;
        }

        if (file.size > 50 * 1024 * 1024) {
            alert('File size must be less than 50MB');
            return;
        }

        onFileSelect(file);
    };

    return (
        <div className={styles.uploadContainer}>
            <div
                className={`${styles.dropZone} ${isDragging ? styles.dragging : ''} ${disabled ? styles.disabled : ''}`}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => !disabled && fileInputRef.current?.click()}
            >
                <div className={styles.uploadIcon}>📁</div>
                <h3 className={styles.uploadTitle}>
                    {disabled ? 'Processing...' : (title || 'UPLOAD BOQ')}
                </h3>
                <p className={styles.uploadHint}>
                    or click to browse
                </p>
                <p className={styles.uploadFormats}>
                    Supports .xls and .xlsx files (max 50MB)
                </p>

                <input
                    ref={fileInputRef}
                    type="file"
                    accept=".xls,.xlsx,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                    onChange={handleFileInput}
                    style={{ display: 'none' }}
                    disabled={disabled}
                />
            </div>
        </div>
    );
}

export default FileUpload;
